// Their own physics: the scripts in island/physics/*.js, run sealed (physics-worker.mjs) and checked here.
// The engine calls a hook (onTick, onStep, onSay, onBuild) synchronously: it hands the worker a snapshot of the
// island as plain data, waits a short time for the answer, and kills the worker if it doesn't come. What a script
// asks for comes back as a list of changes; each is checked against an exact shape and the world's own limits, and
// only then applied. Nothing a script returns is used as a path, a command or code.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export const MAX_SCRIPTS = 16, MAX_SCRIPT_BYTES = 64 * 1024;
const CALL_MS = 30, WAIT_SLACK_MS = 250, START_MS = 8000, LOAD_MS = 3000;
const MAX_BLOCK_CHANGES = 64, MAX_WATER_CHANGES = 256, MAX_MOVES = 64, MAX_MOVE_STEPS = 4, MAX_WATER = 6000;
const FAILS_TO_PAUSE = 5;
export const WATER_COLOR = '#3a8ee0a0';
const DIRS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const DIR_NAMES = { n: 'north', ne: 'north-east', e: 'east', se: 'south-east', s: 'south', sw: 'south-west', w: 'west', nw: 'north-west' };
const NAME = /^[A-Za-z0-9 _-]{1,40}\.js$/;

const isInt = v => Number.isInteger(v);
const hex2 = n => n.toString(16).padStart(2, '0');

export function makePhysics({ islandDir, worldDir, art, maxBlocks, setBody }) {
    const dir = path.join(islandDir, 'physics');
    const logPath = path.join(worldDir, 'physics-log.jsonl');
    let worker = null, ctrl = null, data = null;
    let loadedKey = null, loaded = [];          // [{name, ok, hooks, error}]
    const fails = {}, paused = {};              // per script: failures in a row; why it is paused (until its file changes)
    const dec = new TextDecoder();

    // --- The worker and its kill switch -------------------------------------------------------------------------
    function kill() {
        if (worker) { try { worker.terminate(); } catch { /* gone */ } }
        worker = null; loadedKey = null;
    }
    function spawn() {
        const ctrlBuf = new SharedArrayBuffer(8), dataBuf = new SharedArrayBuffer(1024 * 1024);
        ctrl = new Int32Array(ctrlBuf); data = new Uint8Array(dataBuf);
        worker = new Worker(new URL('./physics-worker.mjs', import.meta.url), { workerData: { ctrl: ctrlBuf, data: dataBuf }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
        worker.unref();
        worker.on('error', () => kill());
        const ready = waitAnswer(START_MS);
        if (!ready || !ready.ok) { kill(); throw new Error(ready ? ready.error : 'The physics interpreter did not start.'); }
    }
    function waitAnswer(ms) {
        if (Atomics.wait(ctrl, 0, 0, ms) === 'timed-out') return null;
        const len = Atomics.load(ctrl, 1);
        Atomics.store(ctrl, 0, 0);
        try { return JSON.parse(dec.decode(data.slice(0, len))); } catch { return null; }
    }
    function request(msg, ms) {
        if (!worker) spawn();
        Atomics.store(ctrl, 0, 0);
        worker.postMessage(msg);
        const a = waitAnswer(ms);
        if (!a) kill();  // it didn't answer in time: the whole worker goes, and a fresh one starts next time
        return a;
    }

    // --- Their files --------------------------------------------------------------------------------------------
    function readScripts() {
        let names = [];
        try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.js')).sort(); } catch { return { list: [], problems: [] }; }
        const list = [], problems = [];
        for (const name of names) {
            if (!NAME.test(name)) { problems.push({ name, error: 'A script name is letters, digits, spaces, - and _, ending in .js.' }); continue; }
            if (list.length >= MAX_SCRIPTS) { problems.push({ name, error: `At most ${MAX_SCRIPTS} scripts; this one is left out.` }); continue; }
            const file = path.join(dir, name);
            const st = fs.statSync(file);
            if (st.size > MAX_SCRIPT_BYTES) { problems.push({ name, error: `It is too long (more than ${MAX_SCRIPT_BYTES / 1024} KB).` }); continue; }
            list.push({ name, code: fs.readFileSync(file, 'utf8'), stamp: st.mtimeMs + ':' + st.size });
        }
        return { list, problems };
    }
    // Loads (again) when a file has changed. A script paused for failing comes back when its file changes.
    function ensureLoaded() {
        const { list, problems } = readScripts();
        const key = JSON.stringify(list.map(s => [s.name, s.stamp]));
        if (key === loadedKey && worker) return { problems };
        for (const s of list) if (paused[s.name] && paused[s.name].stamp !== s.stamp) { delete paused[s.name]; fails[s.name] = 0; }
        if (!list.length) { loaded = []; loadedKey = key; return { problems }; }
        let a;
        try { a = request({ op: 'load', scripts: list.map(({ name, code }) => ({ name, code })) }, LOAD_MS); }
        catch (err) { loaded = list.map(s => ({ name: s.name, ok: false, error: err.message })); return { problems }; }
        loaded = a && a.ok ? a.loaded.map(l => ({ ...l, stamp: list.find(s => s.name === l.name).stamp })) : list.map(s => ({ name: s.name, ok: false, error: 'It took too long to load (an endless loop at the top of the file?).', stamp: s.stamp }));
        loadedKey = a && a.ok ? key : null;
        return { problems };
    }
    function hasHook(hook) {
        try { ensureLoaded(); } catch { return false; }
        return loaded.some(s => s.ok && !paused[s.name] && s.hooks.includes(hook));
    }

    function note(entry) {
        try {
            fs.appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
            if (fs.statSync(logPath).size > 200000) {
                const keep = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-300);
                fs.writeFileSync(logPath, keep.join('\n') + '\n');
            }
        } catch { /* the log is a convenience */ }
    }
    function fail(name, why) {
        fails[name] = (fails[name] || 0) + 1;
        note({ script: name, error: why });
        if (fails[name] >= FAILS_TO_PAUSE || /ran too long|didn't answer/.test(why)) {
            const s = loaded.find(l => l.name === name);
            paused[name] = { why, stamp: s ? s.stamp : '' };
            note({ script: name, paused: why });
        }
    }

    // --- The island, as plain data for a script -----------------------------------------------------------------
    function snapshot(state, bodies, ctx) {
        const split = k => k.split(',').map(Number);
        return {
            time: ctx.t, dayFraction: ctx.f, night: Boolean(state.sky && state.sky.night),
            map: { w: state.map.w, h: state.map.h, land: state.map.land },
            heights: state.height || {},
            things: (state.things || []).map(t => ({ id: t.id, name: t.name.toLowerCase(), x: t.x, y: t.y, z: art.levelOf(state, t) })),
            bodies: bodies.map(([who, b]) => ({ who, x: b.x, y: b.y, z: art.levelOf(state, b) })),
            blocks: Object.entries(state.blocks || {}).map(([k, c]) => [...split(k), c]),
            water: Object.entries(state.water || {}).map(([k, c]) => [...split(k), c]),
        };
    }

    // --- Checking and applying what a script asks for --------------------------------------------------------------
    function color(v, fallback) {
        if (v === '' && fallback) return fallback;
        if (typeof v !== 'string') return undefined;
        const c = art.parseColor(v);
        if (!c || c[3] === 0) return undefined;
        return '#' + c.slice(0, 3).map(hex2).join('') + (c[3] < 255 ? hex2(c[3]) : '');
    }
    // Returns {applied: [...], notes: [...], errors: [...], told: [{who, text}]}. Changes `state` in place.
    function apply(state, bodies, effects, script) {
        const out = { applied: [], notes: [], errors: [], told: [] };
        if (!Array.isArray(effects)) { out.errors.push('internal: no list of changes'); return out; }
        const inWorld = (x, y) => art.inWorld(state.map, x, y);
        const okLevel = (x, y, z) => isInt(z) && z >= art.heightAt(state, x, y) && z >= 0 && z < art.MAX_LEVEL;
        const occupied = (x, y, z) => bodies.some(([, b]) => { const L = art.levelOf(state, b); return b.x === x && b.y === y && z >= L && z < L + art.BODY_LEVELS; });
        const counts = { block: 0, water: 0, move: 0 }, drifted = new Set();
        const bad = (e, why) => { if (out.errors.length < 10) out.errors.push(`${why} (${JSON.stringify(e).slice(0, 120)})`); };
        state.blocks = state.blocks || {};
        for (const e of effects) {
            if (!e || typeof e !== 'object' || Array.isArray(e)) { bad(e, 'not a change'); continue; }
            const { kind } = e;
            if (kind === 'block') {
                const { x, y, z } = e;
                if (++counts.block > MAX_BLOCK_CHANGES) { bad(e, `at most ${MAX_BLOCK_CHANGES} block changes at once`); continue; }
                if (!isInt(x) || !isInt(y) || !inWorld(x, y) || !okLevel(x, y, z)) { bad(e, 'not a place for a block (inside the world, above the ground, level 0 to ' + (art.MAX_LEVEL - 1) + ')'); continue; }
                const k = x + ',' + y + ',' + z;
                if (e.color === null) { if (state.blocks[k]) { delete state.blocks[k]; out.applied.push({ kind, x, y, z, color: null }); } continue; }
                const c = color(e.color);
                if (!c) { bad(e, 'a block color is #rgb, #rrggbb or #rrggbbaa'); continue; }
                if (occupied(x, y, z)) { bad(e, 'someone is standing there'); continue; }
                if (!state.blocks[k] && Object.keys(state.blocks).length >= maxBlocks) { bad(e, `the world holds at most ${maxBlocks} blocks`); continue; }
                if (state.blocks[k] === c) continue;
                state.blocks[k] = c;
                if (state.water) delete state.water[k];
                out.applied.push({ kind, x, y, z, color: c });
            } else if (kind === 'water') {
                const { x, y, z } = e;
                if (++counts.water > MAX_WATER_CHANGES) { bad(e, `at most ${MAX_WATER_CHANGES} water changes at once`); continue; }
                if (!isInt(x) || !isInt(y) || !inWorld(x, y) || !okLevel(x, y, z)) { bad(e, 'not a place for water (inside the world, above the ground, level 0 to ' + (art.MAX_LEVEL - 1) + ')'); continue; }
                const k = x + ',' + y + ',' + z;
                state.water = state.water || {};
                if (e.color === null) { if (state.water[k]) { delete state.water[k]; out.applied.push({ kind, x, y, z, color: null }); } continue; }
                const c = color(e.color, WATER_COLOR);
                if (!c) { bad(e, 'a water color is #rgb, #rrggbb or #rrggbbaa, or leave it out'); continue; }
                if (state.blocks[k]) { bad(e, 'there is a block there'); continue; }
                if (!state.water[k] && Object.keys(state.water).length >= MAX_WATER) { bad(e, `the world holds at most ${MAX_WATER} cells of water`); continue; }
                if (state.water[k] === c) continue;
                state.water[k] = c;
                out.applied.push({ kind, x, y, z, color: c });
            } else if (kind === 'move') {
                if (++counts.move > MAX_MOVES) { bad(e, `at most ${MAX_MOVES} moves at once`); continue; }
                const t = isInt(e.thing) ? (state.things || []).find(q => q.id === e.thing) : null;
                if (!t) { bad(e, 'move needs a thing from world.things (or its id)'); continue; }
                const { x, y } = e;
                if (!isInt(x) || !isInt(y) || !inWorld(x, y)) { bad(e, 'not a place inside the world'); continue; }
                if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > MAX_MOVE_STEPS) { bad(e, `a thing moves at most ${MAX_MOVE_STEPS} steps at a time`); continue; }
                const z = e.z == null ? art.heightAt(state, x, y) : e.z;
                if (!okLevel(x, y, z)) { bad(e, 'not a level for it there'); continue; }
                if (t.x === x && t.y === y && art.levelOf(state, t) === z) continue;
                const from = [t.x, t.y, art.levelOf(state, t)];
                t.x = x; t.y = y; [t.px, t.py] = art.bodyOrigin(t.drawing, x, y);
                if (z === art.heightAt(state, x, y)) delete t.z; else t.z = z;
                out.applied.push({ kind, thing: t.id, from, x, y, z: t.z ?? null });
            } else if (kind === 'drift') {
                const d = typeof e.direction === 'string' ? e.direction.trim().toLowerCase() : '';
                const entry = bodies.find(([who]) => who === e.who);
                if (!entry) { bad(e, 'drift needs someone who is here: "islander" or "visitor" (Tide)'); continue; }
                if (!DIRS[d]) { bad(e, 'drift goes n, ne, e, se, s, sw, w or nw'); continue; }
                if (drifted.has(e.who)) continue;  // one step per body at a time
                const [who, b] = entry, L = art.levelOf(state, b), nx = b.x + DIRS[d][0], ny = b.y + DIRS[d][1];
                if (!inWorld(nx, ny)) continue;
                const at = art.standAt(state, nx, ny, L);
                if (at == null) continue;  // a wall: the current just presses against it
                const nb = { ...b, x: nx, y: ny }; delete nb.z;
                if (at !== art.heightAt(state, nx, ny)) nb.z = at;
                entry[1] = nb;
                setBody(state, who, nb);
                drifted.add(who);
                out.applied.push({ kind, who, x: nx, y: ny, z: nb.z ?? null });
                out.told.push({ who, text: `Something carries you one step ${DIR_NAMES[d]}, to (${nx}, ${ny}) (${script}).` });
            } else bad(e, `"${String(kind).slice(0, 20)}" isn't a kind of change`);
        }
        return out;
    }

    // --- Running a hook -----------------------------------------------------------------------------------------
    // ctx: {t (ms), f (0..1 or null), seed}. extra: the hook's own arguments after the world.
    // bodies: [[who, body], ...] (updated in place when a script drifts someone).
    // Returns {applied: [{script, ...change}], stops: [text], told: [{who, text}], errors: [{script, error}]}.
    function run(hook, state, bodies, ctx, extra = []) {
        const res = { applied: [], stops: [], told: [], errors: [] };
        try { ensureLoaded(); } catch (err) { res.errors.push({ script: '', error: err.message }); return res; }
        for (const s of loaded) {
            if (!s.ok || paused[s.name] || !s.hooks.includes(hook)) continue;
            const args = JSON.stringify([snapshot(state, bodies, ctx), ...extra]);
            const a = request({ op: 'call', name: s.name, hook, args, seed: (ctx.seed + hashName(s.name)) | 0, ms: CALL_MS }, CALL_MS + WAIT_SLACK_MS);
            if (!a) { fail(s.name, `It didn't answer in time (more than ${CALL_MS} ms) and was stopped.`); res.errors.push({ script: s.name, error: 'It took too long and was stopped.' }); continue; }
            if (!a.ok) { fail(s.name, a.error); res.errors.push({ script: s.name, error: a.error }); continue; }
            let r; try { r = JSON.parse(a.result); } catch { fail(s.name, 'internal: unreadable answer'); continue; }
            if (r.none) continue;
            if (Array.isArray(r.logs) && r.logs.length) note({ script: s.name, hook, log: r.logs.map(l => String(l).slice(0, 300)).slice(0, 20) });
            const done = apply(state, bodies, r.effects, s.name);
            for (const c of done.applied) res.applied.push({ script: s.name, ...c });
            res.told.push(...done.told);
            if (done.errors.length) { note({ script: s.name, hook, refused: done.errors }); res.errors.push(...done.errors.map(error => ({ script: s.name, error }))); }
            if (typeof r.stop === 'string' && r.stop) res.stops.push(r.stop.slice(0, 200));
            fails[s.name] = 0;
        }
        return res;
    }
    const hashName = n => { let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };

    // For the physics tool: what is loaded, what works, what is paused, and the latest log lines.
    function status() {
        const { problems } = (() => { try { return ensureLoaded(); } catch (err) { return { problems: [{ name: '', error: err.message }] }; } })();
        let recent = [];
        try { recent = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-15).map(l => JSON.parse(l)); } catch { /* none yet */ }
        return { scripts: loaded.map(s => ({ name: s.name, ok: s.ok, hooks: s.hooks || [], error: s.error, paused: paused[s.name] ? paused[s.name].why : null })), problems, recent };
    }

    return { hasHook, run, status, kill };
}

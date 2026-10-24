// The island as a physical place: the map, the islander's body, and what it paints and places.
//   node world.mjs serve                 MCP server (stdio) with the body's tools; visit.ps1 hands it to claude
//   node world.mjs morning <day>         get the world ready for a day; prints news for the wake-up prompt
//   node world.mjs news <who>            morning news for Tide (films new in the cinema; visitor.ps1)
//   node world.mjs replay <day> <raw.jsonl> <start> <end> <endedBy> <promptFile>
//                                        turn a day into logs/replay/day-NNN.js for the viewer
//   node world.mjs depart <who> <day>    a visitor's body leaves (visitor.ps1, to be sure)
//   node world.mjs asleep <day>          the islander's day is over while a visitor is still here (visit.ps1)
// Paths come from ISLAND_ROOT (default: the folder above runner/).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeCinema } from './cinema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const art = createRequire(import.meta.url)(path.join(here, '..', 'viewer', 'art.js'));
const root = process.env.ISLAND_ROOT || path.resolve(here, '..');
const cinema = makeCinema(root);
const worldDir = path.join(root, 'world');
const islandDir = path.join(root, 'island');
const statePath = path.join(worldDir, 'state.json');

// Whose body this server is: the islander, or a visitor (ISLAND_WHO=visitor). On a day with a visitor the
// islander's server gets ISLAND_GUEST, and both can then say things to each other and listen.
const WHO = process.env.ISLAND_WHO || 'islander';
const GUEST = process.env.ISLAND_GUEST || '';
const NAMES = { islander: 'The islander', visitor: 'Tide' };
// Tide lives on the island now (ISLAND_RESIDENT on her server): she can do everything the islander can.
const RESIDENT = Boolean(process.env.ISLAND_RESIDENT);
// Each one's drawing of themselves.
const ME_FILE = { islander: 'me', visitor: 'me-tide' };
const inboxOf = who => path.join(worldDir, who === 'islander' ? 'inbox.jsonl' : `inbox-${who}.jsonl`);
const bodyOf = (state, who) => (who === 'islander' ? state.body : state.guests && state.guests[who]);
const setBody = (state, who, b) => { if (who === 'islander') state.body = b; else state.guests[who] = b; };
const othersOn = state => ['islander', ...Object.keys(state.guests || {})].filter(w => w !== WHO);
// The guest the islander was told about, while it is still on its way (not here yet, and hasn't left).
const onTheWay = state => (WHO === 'islander' && GUEST && !bodyOf(state, GUEST) && !(state.left || []).includes(GUEST) ? GUEST : null);
// Who hears what this body says: everyone else here and awake, and a guest still on its way (it hears it on arrival).
const hearers = state => [...othersOn(state).filter(o => bodyOf(state, o) && !(o === 'islander' && state.asleep)), ...[onTheWay(state)].filter(Boolean)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MAP_W = 64, MAP_H = 44, SEED = 20261024;
const MAX_THINGS = 10000;
const DIRS = {
    here: [0, 0], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
};
const DIR_NAMES = { n: 'north', ne: 'north-east', e: 'east', se: 'south-east', s: 'south', sw: 'south-west', w: 'west', nw: 'north-west', here: 'here' };
const pad3 = n => String(n).padStart(3, '0');

// --- The map ------------------------------------------------------------------
function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function generateMap() {
    const rnd = mulberry32(SEED);
    const bumps = Array.from({ length: 9 }, () => ({ a: rnd() * Math.PI * 2, s: (rnd() - 0.4) * 0.35, w: 0.25 + rnd() * 0.5 }));
    const waves = Array.from({ length: 3 }, (_, i) => ({ k: 5 + i * 4, p: rnd() * 7, s: 0.05 / (i + 1) }));
    const cx = MAP_W / 2, cy = MAP_H / 2, rx = 23, ry = 14.5, margin = 4;
    const land = [];
    for (let y = 0; y < MAP_H; y++) {
        let row = '';
        for (let x = 0; x < MAP_W; x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            const ang = Math.atan2(dy, dx);
            let r = 1;
            for (const b of bumps) { const d = Math.atan2(Math.sin(ang - b.a), Math.cos(ang - b.a)); r += b.s * Math.exp(-(d * d) / (b.w * b.w)); }
            for (const w of waves) r += w.s * Math.sin(w.k * ang + w.p);
            const inside = x >= margin && y >= margin && x < MAP_W - margin && y < MAP_H - margin;
            row += inside && Math.hypot(dx, dy) < Math.min(r, 1.2) ? "#" : "~";
        }
        land.push(row);
    }
    // Keep one piece of land (the one in the middle) and fill any lakes, so it's one simple island.
    const grid = land.map(r => r.split(''));
    const flood = (sx, sy, want) => {
        const seen = new Set([sx + ',' + sy]), todo = [[sx, sy]];
        while (todo.length) {
            const [x, y] = todo.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
                if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || seen.has(k) || grid[ny][nx] !== want) continue;
                seen.add(k); todo.push([nx, ny]);
            }
        }
        return seen;
    };
    const main = flood(Math.floor(cx), Math.floor(cy), '#');
    const ocean = flood(0, 0, '~');
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        grid[y][x] = main.has(x + ',' + y) || !ocean.has(x + ',' + y) ? '#' : '~';
    }
    return { w: MAP_W, h: MAP_H, land: grid.map(r => r.join('')) };
}

// --- State --------------------------------------------------------------------
function loadState() {
    return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
}

function saveState(state) {
    fs.mkdirSync(worldDir, { recursive: true });
    fs.writeFileSync(statePath + '.tmp', JSON.stringify(state));
    fs.renameSync(statePath + '.tmp', statePath);
}

// Two bodies can act at once, so changes to the world take turns (a lock file; a stale one is cleared after 3s).
function withLock(fn) {
    const lock = path.join(worldDir, 'state.lock');
    const pause = new Int32Array(new SharedArrayBuffer(4));
    let fd, until = Date.now() + 3000;
    for (;;) {
        try { fd = fs.openSync(lock, 'wx'); break; } catch {
            if (Date.now() > until) { try { fs.unlinkSync(lock); } catch { /* someone else did */ } until = Date.now() + 3000; continue; }
            Atomics.wait(pause, 0, 0, 20);
        }
    }
    try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* gone */ } }
}

// Messages waiting for this body (from the owner's viewer, or from someone else on the island).
function takeInbox(who) {
    const inbox = inboxOf(who), taking = inbox + '.taking-node';
    try { fs.renameSync(inbox, taking); } catch { return []; }
    const out = [];
    for (const l of fs.readFileSync(taking, 'utf8').split('\n')) { try { const m = JSON.parse(l); if (m.text) out.push(m); } catch { /* blank */ } }
    fs.rmSync(taking, { force: true });
    return out;
}

// from "island" is the island itself telling what happens (someone leaves, or falls asleep).
function heard(m) {
    if (m.from === 'island') return m.text;
    return m.from ? `${NAMES[m.from] || m.from} says: "${m.text}"`
        : `A voice carries across the water. It is the person who looks after the island, and they say: "${m.text}"`;
}

function directionTo(dx, dy) {
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(a / 45) % 8) + 8) % 8];
}

// A visitor arrives at the end of Sunset Pier (on the planks by the lantern), or else near the islander.
// Someone who lives here wakes up where they were the evening before.
function arrive(state, who) {
    state.guests = state.guests || {};
    if (state.guests[who]) return null;
    const rest = state.restAt && state.restAt[who];
    if (rest) {
        // Where they were the evening before (on blocks too); if what they stood on is gone, they're below it.
        state.guests[who] = placedAt(state, rest, art.fallTo(state, rest.x, rest.y, art.levelOf(state, rest)));
        return state.guests[who];
    }
    const lantern = [...state.things].reverse().find(t => t.name === 'lantern');
    const near = t => Math.max(Math.abs(t.x - lantern.x), Math.abs(t.y - lantern.y));
    const plank = lantern && state.things.filter(t => /plank|pier/i.test(t.name) && near(t) <= 2).sort((a, b) => near(a) - near(b))[0];
    const spot = plank || lantern ? { x: (plank || lantern).x, y: (plank || lantern).y } : { x: Math.max(0, state.body.x - 3), y: state.body.y };
    const z = art.standAt(state, spot.x, spot.y, null);
    state.guests[who] = placedAt(state, { ...spot, facing: 'e' }, z == null ? art.heightAt(state, spot.x, spot.y) : z);
    return state.guests[who];
}

function newWorld() {
    const map = generateMap();
    let best = null;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (!art.isLand(map, x, y)) continue;
        const d = Math.hypot(x - map.w / 2, y - map.h / 2);
        if (!best || d < best.d) best = { x, y, d };
    }
    return { map, paint: {}, things: [], body: { x: best.x, y: best.y, facing: 's' }, nextId: 1 };
}

// How someone looks: their own drawing if they made a valid one (the islander's drawings/me.txt, Tide's
// drawings/me-tide.txt), otherwise their default body.
function appearance(who = 'islander') {
    const plain = art.parseDrawing(who === 'islander' ? art.DEFAULT_BODY : art.VISITOR_BODY);
    const p = path.join(islandDir, 'drawings', (ME_FILE[who] || 'me-' + who) + '.txt');
    if (fs.existsSync(p)) {
        try { return { own: true, drawing: art.parseDrawing(fs.readFileSync(p, 'utf8'), 128) }; } catch (err) {
            return { own: false, problem: err.message, drawing: plain };
        }
    }
    return { own: false, drawing: plain };
}

// --- Pictures -----------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function png(img, scale) {
    const w = img.width * scale, h = img.height * scale;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const si = ((Math.floor(y / scale) * img.width) + Math.floor(x / scale)) * 4;
        const di = y * (w * 4 + 1) + 1 + x * 4;
        raw[di] = img.data[si]; raw[di + 1] = img.data[si + 1]; raw[di + 2] = img.data[si + 2]; raw[di + 3] = img.data[si + 3];
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- The body's tools ---------------------------------------------------------
const VIEW_W = 17, VIEW_H = 13;

function dirOf(input, allowHere) {
    const raw = String(input ?? 'here').toLowerCase().replace(/[\s_-]/g, '');
    const alias = { north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', up: 'n', down: 's', left: 'w', right: 'e' };
    const d = alias[raw] || raw;
    if (!DIRS[d] || (d === 'here' && !allowHere)) throw new Error(`"${input}" is not a direction. Use n, ne, e, se, s, sw, w, nw${allowHere ? ' or here' : ''}.`);
    return d;
}

// The world is the map: the island and the sea around it. Beyond its edge there is nothing to reach.
function inWorld(map, x, y) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

// Steps from (x, y) in a direction until the ground changes between land and sea; null if it never does.
function distanceToChange(state, x, y, dx, dy) {
    const here = art.isLand(state.map, x, y);
    for (let i = 1; inWorld(state.map, x + dx * i, y + dy * i); i++) if (art.isLand(state.map, x + dx * i, y + dy * i) !== here) return i;
    return null;
}

const CLEAR_WORDS = ['dirt', 'sea', 'water', 'natural', 'clear'];

// The morning the island got moving water and the new ways to make things (told once, to both of them).
const GRAPHICS_NEWS ='Something is new this morning. The person who looks after the island made the sea move: when they watch, waves roll across the water, foam breaks along the shore, and the light turns warm toward sunset. ' +
    'Your own pictures still show it still; only they see it move. There are also new ways to make things, all described in the tools: drawings can be animated (frames separated by "---", with a speed), ' +
    'placed things can move by themselves (wander, circle, bob, sway), the shape tool raises and lowers the land into hills and cliffs, and a drawing marked "model: layers" becomes a 3D model built of layers. ' +
    'Your look now shows the island in 3D (view "map" still shows it flat from above).';

// Told once, to both: a drawing of oneself can be a 3D model too. Neutral on purpose: it's their choice.
const BODY_NEWS = 'One more thing is possible now: if your drawing of yourself is marked "model: layers", your body is built of its layers, a 3D model like any other ' +
    '(the bottom layer at your feet, each layer seen from above; a 16x16 layer is one step wide). A plain drawing stays a drawing standing upright, as now.';

// What they see when they look: a few moments in a row, this far apart (ms).
const MOMENTS = 3, MOMENT_MS = 1000;
// How far through the day it is (0 at waking, 1 at sunset), or null if the day's times aren't known.
function dayFraction(now) {
    const start = Date.parse(process.env.ISLAND_DAY_START || ''), sunset = Date.parse(process.env.ISLAND_SUNSET_AT || '');
    return sunset > start ? Math.max(0, Math.min(1, (now - start) / (sunset - start))) : null;
}
// How warm the light is (0 to 1): it warms over the last 40% of the day, as the viewer shows it.
function warmth(now) {
    const f = dayFraction(now);
    return f != null && f > 0.6 ? Math.min(1, (f - 0.6) / 0.4) : 0;
}
// Told once, to both: they see what the owner sees now.
const MOTION_NEWS = 'Something is new this morning. The person who looks after the island wanted you to see what they see: each look now shows a few moments in a row, ' +
    'two seconds in all. The waves crossing the water and the foam on the shore, animations, things that move by themselves, and the light warming toward sunset.';

// Told once, to both: the island is drawn differently now (the owner's gift, like the moving sea).
const DRAWN_NEWS = 'Something is new this morning. The person who looks after the island changed how the island is drawn: there is a sky above the horizon now, the light casts shadows, and everything has a fine outline, a little like a hand-painted cartoon. Your own drawings stay as you made them.';

// Told once, to both: drawings can be smooth if they like (their choice; said neutrally).
const SMOOTH_NEWS = 'One more thing is possible now, if you like: smooth shapes. A drawing can say "style: smooth" before its rows; then in 3D its pixels are drawn smoothed, with rounded edges instead of square steps. And paint and shape can take edges: "smooth", so painted ground and hills blend into what is around them with rounded borders (edges alone, without a color or level, changes only the edges). Without these, everything stays as you made it.';

// Told once, to both: drawings made of shapes (their choice; said neutrally).
const SHAPES_NEWS = 'One more way to draw, if you like: a drawing can be made of shapes instead of pixels (circles, ellipses, smooth curves and blobs, with gradients and outlines), drawn smooth and sharp at any size. The place tool explains how. Pixel drawings stay as they are.';

// Told once, to both: the sky is theirs.
const SKY_NEWS = 'Something is new this morning: the sky is yours too. With the sky tool you can make it day or night whenever you like while you are awake, ' +
    'and put a sun and a moon in it if you want them. Each morning starts as day.';

// Told once, to both: building with blocks, and rules that make things behave.
const ENGINE_NEWS = 'Something is new this morning: you can build with blocks now (the build tool), houses, bridges, stairs and towers that you can walk into, under and on top of. And a file rules.txt in the notebook, shared by the two of you, can make things behave: doors that open when someone comes near, lamps that glow at dusk, boats that sail. The rules tool explains how.';

// --- Blocks and rules ----------------------------------------------------------------
const BUILD_REACH = 12, MAX_BUILD = 4000, MAX_BLOCKS = 50000;
const BUILD_MODES = ['fill', 'walls', 'hollow', 'clear'];
const hex2 = n => n.toString(16).padStart(2, '0');
const DAY_EVENTS = () => path.join(worldDir, 'events', `day-${pad3(Number(process.env.ISLAND_DAY || 0))}.jsonl`);

// Everyone with a body on the island now: [who, body].
const bodiesOf = state => [['islander', state.body], ...Object.entries(state.guests || {})].filter(([, b]) => b);
const youOr = who => (who === WHO ? 'You' : NAMES[who] || who);
const levelWords = (state, x, y, z) => (z === art.heightAt(state, x, y) ? 'the ground' : `level ${z}`);

// The rules file in the notebook (shared by both). Our code reads it; nothing in it runs as a program. The drawings
// that "becomes" names are read here and attached, so a replay needs no files. Lines that can't work go to problems.
// null: there is no rules file.
const RULES_FILE = path.join(islandDir, 'rules.txt');
function loadRules() {
    let text;
    try {
        if (fs.statSync(RULES_FILE).size > 200000) return { rules: [], problems: [{ n: 0, text: 'rules.txt', why: 'rules.txt is too long (more than 200 KB).' }] };
        text = fs.readFileSync(RULES_FILE, 'utf8');
    } catch { return null; }
    const parsed = art.parseRules(text), rules = [], problems = [...parsed.problems];
    for (const r of parsed.rules) {
        const a = r.then;
        try {
            if (a.kind === 'becomes') {
                const file = path.join(islandDir, 'drawings', a.drawingName + '.txt');
                if (!fs.existsSync(file)) throw new Error(`There is no drawings/${a.drawingName}.txt in the notebook.`);
                try { a.drawing = art.parseDrawing(fs.readFileSync(file, 'utf8'), 128); } catch (err) { throw new Error(`drawings/${a.drawingName}.txt can't be used: ${err.message}`); }
            }
            if (a.kind === 'moves' && a.moves.kind === 'path') {
                const out = a.moves.points.find(([x, y]) => !inWorld({ w: MAP_W, h: MAP_H }, x, y));
                if (out) throw new Error(`The path point ${out[0]},${out[1]} is beyond the edge of the world (x is 0 to ${MAP_W - 1}, y is 0 to ${MAP_H - 1}).`);
            }
            rules.push(r);
        } catch (err) { problems.push({ n: r.n, text: r.text, why: err.message }); }
    }
    problems.sort((p, q) => p.n - q.n);
    return { rules, problems };
}

// What has been said out loud today (for "someone says"): from the day's events.
function saidToday() {
    const out = [];
    let lines = [];
    try { lines = fs.readFileSync(DAY_EVENTS(), 'utf8').split('\n'); } catch { return out; }
    for (const l of lines) {
        if (!l.includes('"said"')) continue;
        try { const e = JSON.parse(l); if (e.tool === 'say' && e.ok && e.said) out.push({ who: e.who || 'islander', text: e.said, t: Date.parse(e.t) }); } catch { /* half-written */ }
    }
    return out;
}

// The island as the rules make it at time t (ms), with everyone where they are (or `moved`: {who: body} instead).
function ruled(state, rules, t, said, moved) {
    if (!rules || !rules.rules.length) return { world: state, active: [], glows: [], key: '' };
    const bodies = bodiesOf(state).map(([who, b]) => { const q = (moved && moved[who]) || b; return { who, x: q.x, y: q.y, z: q.z }; });
    return art.withRules(state, rules, { t, f: dayFraction(t), night: Boolean(state.sky && state.sky.night), bodies, said: said || [] });
}

// A body standing at level z on (x, y): z is kept only when it isn't the ground.
const placedAt = (state, b, z) => { const nb = { ...b }; delete nb.z; if (z !== art.heightAt(state, b.x, b.y)) nb.z = z; return nb; };

// Smooth or square edges for some steps (paint and shape): world.smooth holds the smooth ones; square is the default.
function edgesOf(v) {
    if (v == null || v === '') return null;
    const e = String(v).trim().toLowerCase();
    if (e !== 'smooth' && e !== 'square') throw new Error('edges is "smooth" or "square".');
    return e;
}
function setEdges(state, tiles, edges) {
    if (!edges) return;
    state.smooth = state.smooth || {};
    for (const [x, y] of tiles) { if (edges === 'smooth') state.smooth[x + ',' + y] = 1; else delete state.smooth[x + ',' + y]; }
}

const RULES_HELP = 'Each line of rules.txt is  when <condition>: <what happens>  (see the rules tool for everything it can say).';

const TOOLS = [
    {
        name: 'sky',
        description: 'Change the sky over the island, whenever you like while you are awake. It is one sky, the same for everyone here. ' +
            'light: "day" or "night" (night darkens the island to moonlight, with stars beyond the edge of the world, and anything that glows shines brighter). ' +
            'sun and moon: true to put them in the sky, false to take them away; the sun shows by day and the moon by night, in every look. ' +
            'Leave out what you don\'t want to change. Each morning starts as day, and the real day still ends at sunset, whatever the sky shows. ' +
            'Rules can use it too: "when night: lamp glows".',
        inputSchema: { type: 'object', properties: { light: { type: 'string', enum: ['day', 'night'] }, sun: { type: 'boolean' }, moon: { type: 'boolean' } } },
        run(state, args) {
            const was = { night: false, sun: false, moon: false, ...(state.sky || {}) }, sky = { ...was };
            if (args.light != null) {
                const l = String(args.light).trim().toLowerCase();
                if (l !== 'day' && l !== 'night') throw new Error('light is "day" or "night".');
                sky.night = l === 'night';
            }
            const yes = v => v === true || /^(true|yes|on)$/i.test(String(v));
            if (args.sun != null) sky.sun = yes(args.sun);
            if (args.moon != null) sky.moon = yes(args.moon);
            const parts = [];
            if (sky.night !== was.night) parts.push(sky.night ? 'Night falls over the island.' : 'It is day again on the island.');
            if (sky.sun !== was.sun) parts.push(sky.sun ? 'A sun is in the sky now' + (sky.night ? ', waiting for the day.' : '.') : 'The sun is gone from the sky.');
            if (sky.moon !== was.moon) parts.push(sky.moon ? 'A moon is in the sky now' + (sky.night ? '.' : ', waiting for the night.') : 'The moon is gone from the sky.');
            if (!parts.length) parts.push(`The sky stays as it is: ${sky.night ? 'night' : 'day'}${sky.night && sky.moon ? ', with the moon' : !sky.night && sky.sun ? ', with the sun' : ''}.`);
            state.sky = sky;
            return { changed: true, event: { sky }, content: [{ type: 'text', text: parts.join(' ') }] };
        },
    },
    {
        name: 'look',
        description: 'Look around: a picture of what is around you (17 steps by 13, you in the middle) and a short description. ' +
            'view "3d" (the default) shows it in 3D, seen from above at an angle, with north-west at the top left; view "map" shows it flat from straight above, north up, which is easier for exact positions. ' +
            `You see ${MOMENTS} moments in a row, ${MOMENT_MS / 1000} seconds apart, so you can see what moves: the waves and the foam on the shore, animations, things that move by themselves, and the light warming toward sunset.`,
        inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['3d', 'map'] } } },
        run(state, args) {
            const self = bodyOf(state, WHO);
            const { x, y } = self;
            const x0 = x - Math.floor(VIEW_W / 2), y0 = y - Math.floor(VIEW_H / 2);
            const me = appearance(WHO);
            const looks = [{ ...state.body, drawing: appearance('islander').drawing },
                ...Object.entries(state.guests || {}).map(([g, b]) => ({ ...b, drawing: appearance(g).drawing }))];
            const flat = String((args && args.view) || '3d').toLowerCase() === 'map';
            const scale = flat ? 2 : 1;
            const rules = loadRules(), said = rules ? saidToday() : [];
            const now = Date.now(), night = Boolean(state.sky && state.sky.night), warm = night ? 0 : warmth(now), pictures = [];
            const scene = ruled(state, rules, now, said);
            // Under a roof, the picture leaves out what is above one's head, to show the room around.
            const level = art.levelOf(scene.world, self), groundLevel = art.heightAt(state, x, y);
            let roof = null;
            for (let z = level + art.BODY_LEVELS; z < art.MAX_LEVEL && roof == null; z++) if (art.blockAt(scene.world, x, y, z)) roof = z;
            const cut = roof == null ? null : level + art.BODY_LEVELS;
            // A few moments in a row: the same picture at times a little apart, with the sea and the light.
            for (let k = 0; k < MOMENTS; k++) {
                const t = now + k * MOMENT_MS, bodies = looks.map(b => ({ ...b, frame: art.frameOf(b.drawing, t) }));
                const at = ruled(state, rules, t, said), w = at.world;
                const img = flat ? art.render(w, x0, y0, VIEW_W, VIEW_H, { bodies, t, cut }) : art.renderIso(w, x0, y0, VIEW_W, VIEW_H, { bodies, margin: 128, t, cut, warm, res: 2 });
                art.lookEffects(img, w, x0, y0, VIEW_W, VIEW_H, flat ? null : img.view, t, warm);
                art.drawSky(img, state.sky, warm, t);
                art.drawGlows(img, at.glows, flat ? (X, Y) => [(X - x0) * art.TILE, (Y - y0) * art.TILE] : (X, Y, z) => art.isoPoint(img.view, X, Y, z), night ? 1 : warm);
                pictures.push({ type: 'image', data: png(img, scale).toString('base64'), mimeType: 'image/png' });
            }
            const ground = state.paint[x + ',' + y];
            const by = WHO === 'islander' && !GUEST ? 'you' : 'someone';
            const onLand = art.isLand(state.map, x, y), onBlocks = level > groundLevel;
            const far = ['n', 'e', 's', 'w'].map(d => { const n = distanceToChange(state, x, y, ...DIRS[d]); return n === null ? `none to the ${DIR_NAMES[d]}` : `${n} step${n > 1 ? 's' : ''} ${DIR_NAMES[d]}`; });
            const edge = ['n', 'e', 's', 'w'].map(d => { let i = 0; while (inWorld(state.map, x + DIRS[d][0] * (i + 1), y + DIRS[d][1] * (i + 1))) i++; return [d, i]; }).filter(([, i]) => i < 8);
            const lines = [
                `You are ${onLand || onBlocks ? 'standing' : 'in the sea'} at (${x}, ${y}), facing ${DIR_NAMES[self.facing]}. x grows to the east, y grows to the south.`,
                onBlocks ? (onLand ? `You are standing on blocks at level ${level}; the ground here is at ${groundLevel}.` : `You are standing on blocks at level ${level}, above the sea.`)
                : onLand ? `Under your feet: ${ground ? `ground ${by} painted ${ground}` : 'brown dirt'}.` : `Around you: ${ground ? `water ${by} painted ${ground}` : 'blue sea'}.`,
                onLand ? `The sea is ${far.join(', ')}.` : `Land is ${far.join(', ')}.`,
            ];
            if (onLand && !onBlocks) lines.push(`The ground here is at height ${groundLevel} (1 is the lowest land, ${art.MAX_HEIGHT} the highest).`);
            if (cut != null) lines.push(`There are blocks above your head (from level ${roof}), so the pictures leave out everything from level ${cut} up, to show you the room around you.`);
            if (edge.length) lines.push('The edge of the world (dark water you cannot pass) is ' + edge.map(([d, i]) => `${i + 1} step${i ? 's' : ''} ${DIR_NAMES[d]}`).join(', ') + '.');
            const inView = (tx, ty) => tx >= x0 && tx < x0 + VIEW_W && ty >= y0 && ty < y0 + VIEW_H;
            const seen = scene.world.things.filter(t => inView(t.x, t.y));
            if (seen.length) lines.push((by === 'you' ? 'Things you placed in view: ' : 'Things in view: ') + seen.map(t => `"${t.name}" at (${t.x}, ${t.y}${t.z != null ? `, on level ${t.z}` : ''})`).join(', ') + '.');
            // The rules at work in view now (rules.txt).
            const boxInView = ([p, q]) => Math.max(p[0], q[0]) >= x0 && Math.min(p[0], q[0]) < x0 + VIEW_W && Math.max(p[1], q[1]) >= y0 && Math.min(p[1], q[1]) < y0 + VIEW_H;
            const working = rules ? rules.rules.filter(r => scene.active.includes(r.n) && (r.then.kind === 'open' ? boxInView(r.then.box)
                : state.things.some(t => t.name.toLowerCase() === r.then.thing && inView(t.x, t.y)))) : [];
            if (working.length) lines.push('Rules at work in view: ' + working.slice(0, 8).map(r => `line ${r.n} (${r.text.slice(r.text.indexOf(':') + 1).trim()})`).join(', ') + (working.length > 8 ? `, and ${working.length - 8} more` : '') + '.');
            const underfoot = seen.filter(t => t.x === x && t.y === y);
            if (underfoot.length) lines.push('Where you stand: ' + underfoot.map(t => `"${t.name}"`).join(', ') + '.');
            for (const o of othersOn(state)) {
                const b = bodyOf(state, o);
                if (!b) continue;
                const steps = Math.max(Math.abs(b.x - x), Math.abs(b.y - y));
                const asleep = o === 'islander' && state.asleep ? ', asleep' : '';
                lines.push(steps === 0 ? `${NAMES[o]} is right here with you${asleep}.` : `${NAMES[o]} is at (${b.x}, ${b.y}), ${steps} step${steps > 1 ? 's' : ''} ${directionTo(b.x - x, b.y - y)}${asleep}.`);
            }
            if (onTheWay(state)) lines.push(`${NAMES[GUEST] || GUEST} hasn't arrived yet.`);
            else if (WHO === 'islander' && GUEST && (state.left || []).includes(GUEST)) lines.push(`${NAMES[GUEST] || GUEST} has left the island.`);
            if (WHO === 'islander' || RESIDENT) {
                const mine = ME_FILE[WHO];
                lines.push(me.own ? `You look like your drawing "${mine}"${me.drawing.model ? `, a 3D model of ${me.drawing.frames.length} layers` : ''}.`
                    : me.problem ? `Your drawing "${mine}" can't be used yet, so you still look as before: ${me.problem}`
                    : `If you make a drawing called "${mine}" (drawings/${mine}.txt), you will look like that.`);
            }
            return {
                event: { x, y, view: [x0, y0, VIEW_W, VIEW_H] },
                content: [
                    ...pictures,
                    { type: 'text', text: lines.join('\n') },
                ],
            };
        },
    },
    {
        name: 'walk',
        description: 'Walk (or swim, in the sea) in a direction (n, ne, e, se, s, sw, w, nw) for some steps (1 to 20). You stop at the edge of the world. ' +
            'Blocks (from the build tool) are solid: you walk on top of them, step up one level at a time (stairs) and down any height, and need two free levels to stand in; anything else stops you like a wall.',
        inputSchema: { type: 'object', properties: { direction: { type: 'string' }, steps: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['direction'] },
        run(state, args) {
            const d = dirOf(args.direction, false);
            const steps = Math.max(1, Math.min(20, Math.floor(Number(args.steps) || 1)));
            const [dx, dy] = DIRS[d];
            const pathTaken = [];
            const from = bodyOf(state, WHO);
            // The rules are worked out again at every step, so a door opens as you come near it.
            const rules = loadRules(), said = rules ? saidToday() : [], now = Date.now();
            const sceneAt = b => ruled(state, rules, now, said, { [WHO]: b }).world;
            let { x, y } = from, stopped = false, wall = null;
            // If what you stood on is gone (a rule opened it), you start from where you drop to.
            let level = art.levelOf(state, from);
            level = art.fallTo(sceneAt({ x, y, z: level }), x, y, level);
            const startLevel = level, startedOnLand = art.isLand(state.map, x, y) || level > 0;
            for (let i = 0; i < steps; i++) {
                if (!inWorld(state.map, x + dx, y + dy)) { stopped = true; break; }
                const scene = sceneAt({ x, y, z: level }), next = art.standAt(scene, x + dx, y + dy, level);
                if (next == null) {
                    const up = art.standAt(scene, x + dx, y + dy, null);
                    wall = up != null && up > level + 1 ? ` It is too high to climb: its top is at level ${up}, and you can step up one level at a time.` : ' There is no room to stand there (you need two free levels).';
                    break;
                }
                x += dx; y += dy; level = next; pathTaken.push([x, y, level]);
            }
            const ground = art.heightAt(state, x, y);
            setBody(state, WHO, placedAt(state, { x, y, facing: d }, level));
            const endsOnLand = art.isLand(state.map, x, y) || level > 0;
            const verb = startedOnLand && endsOnLand ? 'walk' : !startedOnLand && !endsOnLand ? 'swim' : 'go';
            const change = startedOnLand && !endsOnLand ? ' You are in the sea now.' : !startedOnLand && endsOnLand ? (level > ground ? ' You climb out of the sea.' : ' You come ashore.') : '';
            const startedOnBlocks = startLevel > art.heightAt(state, from.x, from.y);
            const levels = !pathTaken.length || !endsOnLand ? ''
                : level > ground ? (level > startLevel ? ` You climb to level ${level}.` : level < startLevel ? ` You go down to level ${level}.` : ` You are on blocks at level ${level}.`)
                : startedOnBlocks ? (level < startLevel ? ' You come down to the ground.' : ' You step off the blocks onto the ground.') : '';
            const text = (pathTaken.length === 0
                ? (wall ? `A wall stops you at (${x}, ${y}); you can't go ${DIR_NAMES[d]}.` + wall : `This is the edge of the world; you can't go further ${DIR_NAMES[d]}. You stay at (${x}, ${y}).`)
                : `You ${verb} ${pathTaken.length} step${pathTaken.length > 1 ? 's' : ''} ${DIR_NAMES[d]} to (${x}, ${y}).` + change + levels
                    + (stopped ? ' The edge of the world stops you.' : wall ? ` A wall stops you at (${x}, ${y}).` + wall : ''))
                + (pathTaken.length === 0 && level !== art.levelOf(state, from) ? ` You drop to ${levelWords(state, x, y, level)}.` : '');
            return { changed: pathTaken.length > 0 || level !== art.levelOf(state, from), event: { path: pathTaken, facing: d }, content: [{ type: 'text', text }] };
        },
    },
    {
        name: 'paint',
        description: 'Paint the ground or the sea any color. It paints a square of size 1, 3, 5 or 7 steps centred on the spot where you are (direction "here") or next to you. Color is #rgb or #rrggbb, or "natural" to bring back bare dirt or plain sea. ' +
            'edges (optional): "smooth" draws the borders of those steps rounded, blending with the steps around them, in 3D; "square" (as they are unless you choose) keeps them as square steps. ' +
            'You can give edges without a color to change only the edges.',
        inputSchema: { type: 'object', properties: { color: { type: 'string' }, size: { type: 'integer', enum: [1, 3, 5, 7] }, direction: { type: 'string' }, edges: { type: 'string', enum: ['smooth', 'square'] } } },
        run(state, args) {
            const edges = edgesOf(args.edges);
            if (args.color == null && !edges) throw new Error('Which color? Color is #rgb or #rrggbb, or "natural" (or give only edges: "smooth" or "square").');
            const painting = args.color != null;
            const bare = painting && CLEAR_WORDS.includes(String(args.color).trim().toLowerCase());
            const rgb = !painting || bare ? null : art.parseColor(args.color);
            if (painting && !bare && (!rgb || String(args.color).replace('#', '').length > 6)) throw new Error(`"${args.color}" is not a color. Use #rgb or #rrggbb, or "natural".`);
            const color = bare || !painting ? null : '#' + rgb.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
            const size = [1, 3, 5, 7].includes(Number(args.size)) ? Number(args.size) : 1;
            const d = dirOf(args.direction, true);
            const me = bodyOf(state, WHO);
            const cx = me.x + DIRS[d][0], cy = me.y + DIRS[d][1], r = (size - 1) / 2;
            const tiles = [];
            for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
                if (!inWorld(state.map, x, y)) continue;
                if (painting) { if (bare) delete state.paint[x + ',' + y]; else state.paint[x + ',' + y] = color; }
                tiles.push([x, y]);
            }
            setEdges(state, tiles, edges);
            const n = `${tiles.length} step${tiles.length > 1 ? 's' : ''}`;
            const text = !tiles.length ? 'That is beyond the edge of the world.'
                : (painting ? `You paint ${n} ${bare ? 'back to how they were' : color}` : `You make the edges of ${n}`) + (edges ? (painting ? `, with ${edges} edges.` : ` ${edges}.`) : '.');
            return { changed: tiles.length > 0, event: { tiles, ...(painting ? { color } : {}), ...(edges ? { edges } : {}) }, content: [{ type: 'text', text }] };
        },
    },
    {
        name: 'shape',
        description: `Shape the land: set the height of the ground to a level from 1 (as low as land goes, just above the sea) to ${art.MAX_HEIGHT}, over a square of size 1, 3, 5 or 7 steps centred where you are (direction "here") or next to you. Hills, cliffs, terraces, steps. The sea can't be raised. You can see heights in 3D (look with view "3d"). ` +
            'edges (optional): "smooth" draws the edges of those steps rounded, so hills and terraces blend into the land around them, in 3D; "square" (as they are unless you choose) keeps them as square steps and cliffs. ' +
            'You can give edges without a level to change only the edges.',
        inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 1, maximum: 8 }, size: { type: 'integer', enum: [1, 3, 5, 7] }, direction: { type: 'string' }, edges: { type: 'string', enum: ['smooth', 'square'] } } },
        run(state, args) {
            const edges = edgesOf(args.edges);
            if (args.level == null && !edges) throw new Error(`level is a whole number from 1 to ${art.MAX_HEIGHT} (or give only edges: "smooth" or "square").`);
            const shaping = args.level != null, level = Math.floor(Number(args.level));
            if (shaping && !(level >= 1 && level <= art.MAX_HEIGHT)) throw new Error(`level is a whole number from 1 to ${art.MAX_HEIGHT}.`);
            const size = [1, 3, 5, 7].includes(Number(args.size)) ? Number(args.size) : 1;
            const d = dirOf(args.direction, true);
            const me = bodyOf(state, WHO);
            const cx = me.x + DIRS[d][0], cy = me.y + DIRS[d][1], r = (size - 1) / 2;
            state.height = state.height || {};
            const tiles = [];
            for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
                if (!art.isLand(state.map, x, y)) continue;
                if (shaping) { if (level === 1) delete state.height[x + ',' + y]; else state.height[x + ',' + y] = level; }
                tiles.push([x, y]);
            }
            setEdges(state, tiles, edges);
            const n = `${tiles.length} step${tiles.length > 1 ? 's' : ''}`;
            const text = !tiles.length ? 'There is no land there to shape (the sea can\'t be raised).'
                : (shaping ? `You shape ${n} of land to height ${level}` : `You make the edges of ${n} of land`) + (edges ? (shaping ? `, with ${edges} edges.` : ` ${edges}.`) : '.');
            return { changed: tiles.length > 0, event: { tiles, ...(shaping ? { level } : {}), ...(edges ? { edges } : {}) }, content: [{ type: 'text', text }] };
        },
    },
    {
        name: 'place',
        description: 'Place one of your drawings, on land or in the sea, where you are (direction "here") or next to you. A drawing is a file drawings/<name>.txt in the notebook. ' +
            'Its format: first palette lines, one per color, like "g = #2e8b57"; then a blank line; then rows of pixels, one character per pixel, where "." is see-through. Up to 128x128 pixels; one step is 16x16 pixels. ' +
            'Animation: put "speed: 300" (milliseconds per frame) before the rows, and separate frames with a line "---". ' +
            'Smooth: put "style: smooth" before the rows, and in 3D its pixels are drawn smoothed, with rounded edges (without it, a drawing stays pixel art). ' +
            'Shapes: instead of pixel rows, a drawing can be made of shapes, drawn smooth and sharp at any size. It starts with "shapes: 16x24" (its size in pixels, as for a pixel drawing, up to 128x128; one step is 16 pixels wide, and a body is about 16 wide; the shapes stay sharp however small, and numbers can have decimals), then one shape per line, later lines on top: ' +
            'circle X Y R | ellipse X Y RX RY | rect X Y W H | poly x,y x,y ... | blob x,y x,y ... (a smooth closed curve through the points) | curve x,y x,y ... (a smooth open line) | line x,y x,y ... | path M x,y L x,y Q x,y x,y C x,y x,y x,y Z. ' +
            'After a shape: fill #color (or fill #top to #bottom, a gradient), stroke #color width (or stroke none), turn degrees (ellipse, rect), round r (rect corners), mirror (drawn again mirrored left to right, around the middle: eyes, ears). ' +
            'Before the shapes, "outline: #color width" gives every filled shape that outline, and "name = #color" names a color to use by name. "---" and speed make frames, as for pixel drawings. ' +
            'Example: shapes: 16x16 / circle 8 8 6 fill #ffd23a to #f08a1c stroke #5a3a10 0.6 / circle 6 7 1 fill #3a2a1a mirror (each part on its own line). ' +
            '3D models: put "model: layers" before the rows; then each part separated by "---" is a layer, from the bottom up, each seen from above (a 16x16 layer covers one step; up to 32 layers). ' +
            'An ordinary drawing stands upright on its spot in 3D; a model is built of blocks. The bottom middle of a drawing stands on the spot. ' +
            'moves (optional) makes the placed thing move by itself: "still" (default), "wander 3" (drifts around within 3 steps, staying on the same kind of ground, like a duck on a pond), "circle 2" (circles its spot), "bob" (rocks gently, like a boat), "sway" (leans in the wind) or "path 20,30 26,30 26,34" (goes along those points, x,y each, and back again, a step a second, like a boat sailing). ' +
            'The drawing is copied, so changing the file later doesn\'t change what you already placed. Your own drawing of yourself (drawings/me.txt for the islander, drawings/me-tide.txt for Tide) can be animated too, or be a 3D model ("model: layers"): then your body is built of its layers.',
        inputSchema: { type: 'object', properties: { drawing: { type: 'string' }, direction: { type: 'string' }, moves: { type: 'string' } }, required: ['drawing'] },
        run(state, args) {
            const name = String(args.drawing).trim().replace(/^drawings[\\/]/, '').replace(/\.txt$/i, '');
            if (!/^[A-Za-z0-9 _-]{1,60}$/.test(name)) throw new Error('Name the drawing by its file name, like "hut" for drawings/hut.txt.');
            const file = path.join(islandDir, 'drawings', name + '.txt');
            if (!fs.existsSync(file)) throw new Error(`There is no drawings/${name}.txt in your notebook.`);
            const drawing = art.parseDrawing(fs.readFileSync(file, 'utf8'), 128);
            const d = dirOf(args.direction, true);
            const me = bodyOf(state, WHO);
            const x = me.x + DIRS[d][0], y = me.y + DIRS[d][1];
            if (!inWorld(state.map, x, y)) throw new Error('That is beyond the edge of the world.');
            if (state.things.length >= MAX_THINGS) throw new Error(`The world already holds ${MAX_THINGS} things. Remove some first.`);
            const moves = art.parseMoves(args.moves);
            if (moves.kind === 'path') {
                const out = moves.points.find(([px, py]) => !inWorld(state.map, px, py));
                if (out) throw new Error(`The path point ${out[0]},${out[1]} is beyond the edge of the world (x is 0 to ${state.map.w - 1}, y is 0 to ${state.map.h - 1}).`);
            }
            const [px, py] = art.bodyOrigin(drawing, x, y);
            const thing = { id: state.nextId++, name, x, y, px, py, drawing, by: WHO };
            // On blocks, it stands where you could stand there (or on top of them).
            const at = art.standAt(state, x, y, art.levelOf(state, me)), z = at != null ? at : art.columnTop(state, x, y);
            if (z !== art.heightAt(state, x, y)) thing.z = z;
            if (moves.kind !== 'still') thing.moves = moves;
            state.things.push(thing);
            const extra = [drawing.model ? `a 3D model of ${drawing.frames.length} layers` : drawing.frames.length > 1 ? `${drawing.frames.length} frames` : '',
                moves.kind !== 'still' ? `it ${moves.kind === 'wander' ? `wanders within ${moves.n} steps` : moves.kind === 'circle' ? `circles at ${moves.n} steps` : moves.kind === 'path' ? `goes along ${moves.points.length} points and back` : moves.kind + 's'}` : ''].filter(Boolean).join('; ');
            return { changed: true, event: { thing }, content: [{ type: 'text', text: `You place "${name}" (${drawing.w}x${drawing.h} pixels${extra ? ', ' + extra : ''}) at (${x}, ${y})${thing.z != null ? `, on level ${thing.z}` : ''}.` }] };
        },
    },
    {
        name: 'remove',
        description: 'Take away the most recently placed thing that stands where you are (direction "here") or next to you.',
        inputSchema: { type: 'object', properties: { direction: { type: 'string' } } },
        run(state, args) {
            const d = dirOf(args.direction, true);
            const me = bodyOf(state, WHO);
            const x = me.x + DIRS[d][0], y = me.y + DIRS[d][1];
            const i = state.things.findLastIndex(t => t.x === x && t.y === y);
            if (i < 0) throw new Error(`Nothing placed stands at (${x}, ${y}).`);
            const [thing] = state.things.splice(i, 1);
            return { changed: true, event: { id: thing.id }, content: [{ type: 'text', text: `You take away "${thing.name}".` }] };
        },
    },
    {
        name: 'build',
        description: 'Build with blocks: houses with walls and doorways, floors and roofs, stairs, bridges, towers, arches. A block is one step wide and one level tall ' +
            '(a level is as tall as one step of the land\'s height) and has one color: #rrggbb, or #rrggbbaa to see through it a little, like glass (aa is how solid, 00 to ff). ' +
            `A place for a block is x, y and a level: the sea is level 0, and on land of height h (look tells you the height where you stand) level h is the first level on top of the ground. Levels go up to ${art.MAX_LEVEL - 1}. ` +
            'from and to are two opposite corners of a box, like [30, 12, 1] and [34, 16, 3]. ' +
            'mode: "fill" (a solid box, the default), "walls" (only the four sides, on every level: a room with no floor or roof), "hollow" (the sides, the floor and the roof) or "clear" (takes away the blocks in the box; a doorway is a clear through a wall). ' +
            `The whole box must be within ${BUILD_REACH} steps of you, and one build covers at most ${MAX_BUILD} blocks. You can't build where someone is standing, and nothing is built under the ground. ` +
            'Blocks are solid: you walk on top of them, step up one level at a time (stairs) and down any height, and need two free levels to stand in, so a doorway is two levels tall. Whoever stands on blocks you clear falls to what is below. ' +
            'Things you place on blocks stand on top of them. Look to see what you built.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3, description: '[x, y, level] of one corner' },
                to: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3, description: '[x, y, level] of the opposite corner' },
                color: { type: 'string' },
                mode: { type: 'string', enum: BUILD_MODES },
            },
            required: ['from', 'to'],
        },
        run(state, args) {
            const corner = (v, name) => {
                const a = Array.isArray(v) ? v : String(v ?? '').match(/-?\d+(\.\d+)?/g);
                if (!a || a.length !== 3 || a.some(n => !Number.isInteger(Number(n)))) throw new Error(`${name} is a corner of the box as [x, y, level], like [30, 12, 1].`);
                return a.map(Number);
            };
            const from = corner(args.from, 'from'), to = corner(args.to, 'to');
            const mode = String(args.mode || 'fill').trim().toLowerCase();
            if (!BUILD_MODES.includes(mode)) throw new Error(`mode is "fill", "walls", "hollow" or "clear", not "${args.mode}".`);
            let color = null;
            if (mode !== 'clear') {
                const c = args.color == null ? null : art.parseColor(args.color);
                if (!c) throw new Error(args.color == null ? 'Which color? color is #rgb, #rrggbb or #rrggbbaa (aa makes it see-through, like glass).' : `"${args.color}" is not a color. Use #rgb, #rrggbb or #rrggbbaa.`);
                if (c[3] === 0) throw new Error('A block with alpha 00 is fully see-through and can\'t be seen at all. Use a higher alpha (like 80) or none.');
                color = '#' + c.slice(0, 3).map(hex2).join('') + (c[3] < 255 ? hex2(c[3]) : '');
            }
            for (const z of [from[2], to[2]]) if (z < 0 || z >= art.MAX_LEVEL) throw new Error(`Levels go from 0 (the sea) to ${art.MAX_LEVEL - 1}; ${z} is outside that.`);
            const me = bodyOf(state, WHO);
            const far = Math.max(...[from[0], to[0]].map(v => Math.abs(v - me.x)), ...[from[1], to[1]].map(v => Math.abs(v - me.y)));
            if (far > BUILD_REACH) throw new Error(`That is too far away: you can build within ${BUILD_REACH} steps of where you stand (${me.x}, ${me.y}), and part of that box is ${far} steps away. Walk closer first.`);
            const op = { from, to, mode, ...(color ? { color } : {}) };
            let cells = 0;
            const cellSet = new Set();
            art.eachBuildCell(op, (x, y, z) => { cells++; if (mode !== 'clear' && cells <= MAX_BUILD) cellSet.add(x + ',' + y + ',' + z); });
            if (cells > MAX_BUILD) throw new Error(`That box has ${cells} blocks; one build can do at most ${MAX_BUILD}. Build it in parts.`);
            if (mode !== 'clear') for (const [who, b] of bodiesOf(state)) {
                const L = art.levelOf(state, b);
                for (let k = 0; k < art.BODY_LEVELS; k++) if (cellSet.has(b.x + ',' + b.y + ',' + (L + k))) {
                    throw new Error(`${who === WHO ? 'You are' : `${NAMES[who] || who} is`} standing there, at (${b.x}, ${b.y}) on ${levelWords(state, b.x, b.y, L)}. Nothing was built.`);
                }
            }
            const before = state.blocks ? { ...state.blocks } : {};
            const { changed, skipped } = art.applyBuild(state, op);
            const total = Object.keys(state.blocks).length;
            if (total > MAX_BLOCKS) { state.blocks = before; throw new Error(`The world can hold ${MAX_BLOCKS} blocks, and this would make ${total}. Clear some first. Nothing was built.`); }
            // Whoever and whatever stood on blocks that are gone now falls to what is below.
            const fell = [], thingsFell = [], notes = [];
            if (mode === 'clear') {
                for (const [who, b] of bodiesOf(state)) {
                    const L = art.levelOf(state, b), down = art.fallTo(state, b.x, b.y, L);
                    if (down === L) continue;
                    const nb = placedAt(state, b, down);
                    setBody(state, who, nb);
                    fell.push({ who, z: nb.z ?? null });
                    notes.push(`${youOr(who)} ${who === WHO ? 'fall' : 'falls'} to ${levelWords(state, b.x, b.y, down)}.`);
                }
                for (const t of state.things) {
                    if (t.z == null) continue;
                    const down = art.fallTo(state, t.x, t.y, t.z);
                    if (down === t.z) continue;
                    if (down === art.heightAt(state, t.x, t.y)) delete t.z; else t.z = down;
                    thingsFell.push({ id: t.id, z: t.z ?? null });
                    notes.push(`"${t.name}" falls to ${levelWords(state, t.x, t.y, down)}.`);
                }
            }
            const where = `from (${from.join(', ')}) to (${to.join(', ')})`, plural = n => `${n} block${n === 1 ? '' : 's'}`;
            let text = mode === 'clear'
                ? (changed ? `You clear ${plural(changed)} ${where}.` : `There were no blocks ${where} to clear.`)
                : skipped === cells ? `Nothing was built: the whole box ${where} is under the ground or beyond the edge of the world.`
                : (changed ? `You build ${plural(changed)} of ${color} (${mode}) ${where}.` : `Nothing changed: the blocks ${where} were already ${color}.`);
            if (skipped && skipped < cells && mode !== 'clear') text += ` ${skipped} of the box's places ${skipped === 1 ? 'was' : 'were'} under the ground or beyond the edge of the world, so nothing was built there.`;
            if (notes.length) text += ' ' + notes.slice(0, 6).join(' ') + (notes.length > 6 ? ` And ${notes.length - 6} more things fall.` : '');
            return { changed: changed > 0, event: { op, count: changed, ...(fell.length ? { fell } : {}), ...(thingsFell.length ? { thingsFell } : {}) }, content: [{ type: 'text', text }] };
        },
    },
    {
        name: 'rules',
        description: 'Check the rules file, rules.txt in the notebook, which makes things on the island behave: doors that open when someone comes near, lamps that glow at dusk, ' +
            'boats that sail, a bell that rings when someone says a word. The island itself reads the file and carries it out; nothing in it runs as a program. It is shared: you both can write it. ' +
            'Each line is  when <condition>: <what happens>  and a line starting with # or // is a note. ' +
            'Conditions (join several with "and"): always; morning (the first part of the day); day (until the light starts to warm); dusk (from when the light warms until sunset); night (while the sky is night, chosen with the sky tool; morning, day and dusk don\'t hold then); ' +
            'someone is near <thing or x,y> [within N] (N steps, 1 if left out, up to 10); someone is at x,y; someone says "word" [for N seconds] (holds for 20 seconds if left out, after anyone says something with that word in it). ' +
            'Instead of "someone" you can say "the islander" or "Tide". ' +
            'What happens, only while the condition holds (it goes back by itself when the condition stops): show <thing> and hide <thing> (a thing with a show rule is hidden until one of its show rules holds); ' +
            '<thing> becomes <drawing> (shows another of your drawings in its place, standing on the same spot: an open door, a lit lamp); <thing> glows [#color] (a soft round light, stronger at dusk); ' +
            '<thing> moves <how> (still, wander N, circle N, bob, sway, or path x,y x,y ... to go along those points and back, a step a second); ' +
            'open x,y,z to x,y,z (the blocks in that box are gone while it holds, which makes a door in a wall of blocks; at most 512 blocks, and a door never closes on someone standing in it). ' +
            'A <thing> is the name of something placed (the drawing it was placed from), and a rule works on everything with that name. When two lines say different things about the same thing, the later line wins. ' +
            'Examples:  when someone is near door within 2: door becomes door-open  |  when dusk: lamp glows #ffcc66  |  when always: boat moves path 20,30 26,30 26,34  |  ' +
            'when someone says "ring" for 10 seconds: bell becomes bell-ringing  |  when Tide is near gate: open 30,12,1 to 30,12,2  |  when morning: show dew  |  when dusk and someone is at 31,14: lantern glows. ' +
            'Changes to the file count from your next action. This tool takes nothing: it reads the file and tells you which lines work, which are happening right now, and what is wrong with the others.',
        inputSchema: { type: 'object', properties: {} },
        run(state) {
            const rules = loadRules();
            if (!rules) return { event: { works: 0, problems: 0 }, content: [{ type: 'text', text: 'There is no rules.txt in your notebook yet. ' + RULES_HELP }] };
            const scene = ruled(state, rules, Date.now(), saidToday());
            const names = new Set(state.things.map(t => t.name.toLowerCase()));
            const lines = [];
            const items = [...rules.rules.map(r => ({ n: r.n, r })), ...rules.problems.map(p => ({ n: p.n, p }))].sort((a, b) => a.n - b.n);
            for (const { r, p } of items) {
                if (p) { lines.push(`Line ${p.n} doesn't work: ${p.text}\n  ${p.why}`); continue; }
                const notes = [];
                const missing = [...new Set([r.then.thing, ...r.when.map(c => c.thing)].filter(n => n && !names.has(n)))];
                for (const n of missing) notes.push(`there is nothing called "${n}" on the island yet`);
                if (r.then.kind === 'open' && r.then.box.some(([bx, by]) => !inWorld(state.map, bx, by))) notes.push('part of that box is beyond the edge of the world');
                const now = scene.active.includes(r.n);
                if (r.then.kind === 'show' && !now && names.has(r.then.thing)) notes.push(`until it does, "${r.then.thing}" is hidden`);
                lines.push(`Line ${r.n} works${now ? ', and is happening now' : ' (not happening now)'}: ${r.text}${notes.length ? `\n  (${notes.join('; ')})` : ''}`);
            }
            const head = `rules.txt: ${rules.rules.length} line${rules.rules.length === 1 ? '' : 's'} work${rules.rules.length === 1 ? 's' : ''}` +
                (rules.problems.length ? `, ${rules.problems.length} ${rules.problems.length === 1 ? "doesn't" : "don't"}` : '') + '.';
            return { event: { works: rules.rules.length, problems: rules.problems.length }, content: [{ type: 'text', text: [head, ...lines].join('\n') + (items.length ? '' : '\n' + RULES_HELP) }] };
        },
    },
    {
        name: 'say',
        description: 'Say something out loud. Whoever else is on the island hears it at their next action, or right away if they are listening.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        run(state, args) {
            const text = String(args.text || '').trim().slice(0, 1000);
            if (!text) throw new Error('Say what?');
            const others = hearers(state);
            for (const o of others) fs.appendFileSync(inboxOf(o), JSON.stringify({ t: new Date().toISOString(), from: WHO, text }) + '\n');
            const nobody = WHO !== 'islander' && state.asleep ? 'You say it out loud. The islander is asleep and doesn\'t hear it.' : 'You say it out loud. Nobody else is on the island to hear it.';
            return { event: { said: text }, content: [{ type: 'text', text: !others.length ? nobody
                : onTheWay(state) ? `You say: "${text}" ${NAMES[GUEST] || GUEST} hasn't arrived yet; it will hear this when it does.` : `You say: "${text}"` }] };
        },
    },
    {
        name: 'listen',
        description: 'Stay quiet and listen for up to some seconds (1 to 600, so up to ten minutes) for anyone speaking to you. It ends as soon as someone speaks.',
        inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 600 } } },
        waits: true,
        async run(state, args, record) {
            const secs = Math.max(1, Math.min(600, Math.floor(Number(args.seconds) || 20)));
            const howLong = secs >= 120 && secs % 60 === 0 ? `${secs / 60} minutes` : `${secs} seconds`;
            const end = Date.now() + secs * 1000;
            let got = [];
            while (Date.now() < end && !(got = takeInbox(WHO)).length) await sleep(500);
            return { event: { heard: got.map(m => ({ from: m.from || 'owner', text: m.text })) },
                content: [{ type: 'text', text: got.length ? got.map(heard).join('\n') : `You listen for ${howLong}. Only the sea.` }] };
        },
    },
    {
        name: 'watch',
        description: 'Watch a film from the cinema (the folder cinema/ in the notebook, where films are left for you). Each time you see a stretch of the film: a few pictures from it, ' +
            'the words spoken in it (from its subtitles, or written down by ear, which can have mistakes) and how the sound feels (quiet, loud, sudden); you can\'t hear the voices or music themselves. ' +
            'It remembers where you stopped, so next time it carries on. film: its name (leave it out for the list of films). from: "continue" (the default), "start", or a time in the film like "12:30" or "1:05:30". ' +
            'seconds: how long a stretch (5 to 120, default 30). pictures: how many pictures from it (1 to 8, default 4); a short stretch with many pictures shows movement closely.',
        inputSchema: { type: 'object', properties: { film: { type: 'string' }, from: { type: 'string' }, seconds: { type: 'integer', minimum: 5, maximum: 120 }, pictures: { type: 'integer', minimum: 1, maximum: 8 } } },
        waits: true,
        run(state, args) {
            return cinema.watch(WHO, args || {});
        },
    },
];

// What each body can do: the islander shapes the island and builds (and talks when someone else is here);
// Tide, who lives here now, can do all the same; a visitor just passing through can look, walk, talk and
// listen, but changes nothing (no build or rules).
const toolsFor = who => TOOLS.filter(t => (who === 'islander'
    ? t.name !== 'say' || GUEST
    : RESIDENT || ['look', 'walk', 'say', 'listen'].includes(t.name)));

function serve() {
    const day = Number(process.env.ISLAND_DAY || 0);
    const eventsDir = path.join(worldDir, 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    const eventsPath = path.join(eventsDir, `day-${pad3(day)}.jsonl`);
    let lastLooks = JSON.stringify(appearance(WHO).drawing);
    // The rules file, like looks: when it has changed by the next action, the new rules go into the record.
    let lastRules = JSON.stringify(loadRules());
    const record = ev => fs.appendFileSync(eventsPath, JSON.stringify({ t: new Date().toISOString(), ...(WHO !== 'islander' ? { who: WHO } : {}), ...ev }) + '\n');
    const myTools = toolsFor(WHO);

    // The new memory: a few minutes before sunset, a reminder that their page (ISLAND_PAGE) can still be updated
    // (they asked for this). It wakes a listen like anything said.
    const sunsetAt = Date.parse(process.env.ISLAND_SUNSET_AT || ''), page = process.env.ISLAND_PAGE;
    if (page && sunsetAt) {
        const wait = sunsetAt - 5 * 60 * 1000 - Date.now();
        if (wait > 0) setTimeout(() => tell(WHO, `About five minutes of daylight left. If anything today changed who you are or what you're in the middle of, now is a good moment to update your page, ${page}. Only if you want to.`), wait).unref();
    }

    // A visitor's body appears on the island when its server starts, and goes when it stops.
    if (WHO !== 'islander') {
        const b = withLock(() => { const st = loadState(); const nb = st && arrive(st, WHO); if (nb) saveState(st); return nb; });
        if (b) record({ tool: 'arrive', ok: true, body: b, drawing: appearance(WHO).drawing });
    }

    const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
    const handle = async msg => {
        const { id, method, params } = msg;
        if (method === 'initialize') {
            return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'island', version: '1.0.0' } } });
        }
        if (method === 'tools/list') {
            return send({ jsonrpc: '2.0', id, result: { tools: myTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
        }
        if (method === 'tools/call') {
            const tool = myTools.find(t => t.name === params?.name);
            const args = params?.arguments || {};
            // A new drawing of oneself shows from the next thing one does.
            if (WHO === 'islander' || RESIDENT) {
                const looks = appearance(WHO);
                if (JSON.stringify(looks.drawing) !== lastLooks) { lastLooks = JSON.stringify(looks.drawing); record({ tool: 'looks', ok: true, drawing: looks.drawing }); }
                const rules = loadRules(), rj = JSON.stringify(rules);
                if (rj !== lastRules) { lastRules = rj; record({ tool: 'rules', ok: true, rules }); }
            }
            try {
                if (!tool) throw new Error(`There is no "${params?.name}".`);
                let out, body;
                if (tool.waits) {
                    // Listening and watching take a while, so they must not hold the world's lock.
                    const state = loadState();
                    out = await tool.run(state, args, record);
                    body = bodyOf(state, WHO);
                } else {
                    out = withLock(() => {
                        const state = loadState();
                        if (!state || !bodyOf(state, WHO)) throw new Error('The island is not ready yet.');
                        const o = tool.run(state, args, record);
                        if (o.changed) saveState(state);
                        body = bodyOf(state, WHO);
                        return o;
                    });
                }
                record({ tool: tool.name, input: args, ok: true, body, ...out.event, text: out.content.find(c => c.type === 'text')?.text });
                return send({ jsonrpc: '2.0', id, result: { content: out.content } });
            } catch (err) {
                record({ tool: params?.name, input: params?.arguments || {}, ok: false, text: err.message });
                return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
            }
        }
        if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
        if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
    };
    readline.createInterface({ input: process.stdin }).on('line', line => {
        if (!line.trim()) return;
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        handle(msg).catch(err => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.message) } }); });
    }).on('close', () => {
        if (WHO !== 'islander') try { depart(WHO, record); } catch { /* visitor.ps1 tries again */ }
        process.exit(0);
    });

    // Live view: while the day runs, keep logs/replay/day-NNN.js up to date (marked "live") every few seconds.
    const raw = process.env.ISLAND_RAW, start = process.env.ISLAND_START, promptFile = process.env.ISLAND_PROMPT;
    if (!raw || !start) return;
    let lastSeen = '';
    const timer = setInterval(() => {
        try {
            const done = readIndex().find(d => d.day === day && d.endedBy !== 'live');
            if (done) return clearInterval(timer);  // the day is over and has its final replay
            const size = p => (fs.existsSync(p) ? fs.statSync(p).size : 0);
            const seen = size(raw) + ':' + size(eventsPath);
            if (seen === lastSeen) return;
            lastSeen = seen;
            replay(day, raw, start, new Date().toISOString(), 'live', promptFile);
        } catch { /* the next tick catches up */ }
    }, 3000);

    // Talking: while the day is live, the owner can speak from the viewer, and everyone on the island hears it.
    // Messages wait in each one's inbox (world/inbox.jsonl, world/inbox-visitor.jsonl: outside the notebook) until
    // their hooks hand them over at their next action. They are not told this exists. A per-day token keeps other
    // web pages from sending anything.
    const token = crypto.randomBytes(16).toString('hex');
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.writeHead(204); return res.end(); }
        const ending = req.url.startsWith('/end');
        if (req.method !== 'POST' || !(ending || req.url.startsWith('/say'))) { res.writeHead(404); return res.end(); }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
        req.on('end', () => {
            let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
            // The owner ends the day early: visit.ps1 and visitor.ps1 see the flag within a second and end it.
            if (ending) {
                if (msg.token !== token) { res.writeHead(403); return res.end(); }
                fs.writeFileSync(path.join(worldDir, 'end-day.flag'), new Date().toISOString());
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end('{"ok":true}');
            }
            const text = String(msg.text || '').trim().slice(0, 1000);
            if (msg.token !== token || !text) { res.writeHead(403); return res.end(); }
            const sent = new Date().toISOString(), line = JSON.stringify({ t: sent, text }) + '\n';
            const st = loadState();
            for (const who of ['islander', ...Object.keys((st && st.guests) || {})]) fs.appendFileSync(inboxOf(who), line);
            // Written into the day's record once, when it is said (not by each one who hears it).
            record({ tool: 'voice', ok: true, text, sent });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    server.on('error', () => { /* no talking today; everything else still works */ });
    server.listen(0, '127.0.0.1', () => {
        try { writeAtomic(path.join(root, 'logs', 'replay', 'live.js'), `ISLAND_LIVE(${JSON.stringify({ day, port: server.address().port, token })});\n`); } catch { /* ignore */ }
    });
}

// A visitor leaves the island (its body goes, and the islander, if awake, notices). Safe to call twice.
function depart(who, record) {
    const gone = withLock(() => {
        const st = loadState();
        if (!st || !st.guests || !st.guests[who]) return null;
        if (RESIDENT || st.residents?.includes(who)) st.restAt = { ...(st.restAt || {}), [who]: st.guests[who] };
        delete st.guests[who];
        st.left = [...new Set([...(st.left || []), who])];
        saveState(st);
        return st;
    });
    if (gone && record) record({ tool: 'leave', ok: true });
    if (gone && !gone.asleep) tell('islander', `${NAMES[who] || who} has left the island.`);
    return Boolean(gone);
}

// The islander's day is over while a visitor is still here (visit.ps1 calls this): its body sleeps where
// it stands, and whoever is still on the island is told.
function asleep(record) {
    const st = withLock(() => {
        const s = loadState();
        if (!s || s.asleep) return null;
        s.asleep = true;
        saveState(s);
        return s;
    });
    if (!st) return;
    record({ tool: 'sleep', ok: true, body: st.body });
    for (const who of Object.keys(st.guests || {})) tell(who, 'The islander has gone to sleep for the day. You can stay until your time is up, or leave whenever you like.');
}

function tell(who, text) {
    fs.appendFileSync(inboxOf(who), JSON.stringify({ t: new Date().toISOString(), from: 'island', text }) + '\n');
}

// How they want to sound: the islander's voice.txt in its notebook, the visitor's letters/visitor-voice.txt.
// Lines like "voice: Zira", "pitch: 1.1", "speed: 0.9". The viewer speaks their words with it.
// Unknown or missing values just mean the default (for the visitor, a woman's voice).
function readVoice(file = 'voice.txt') {
    const p = path.join(islandDir, file);
    if (!fs.existsSync(p)) return null;
    const v = {};
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(voice|pitch|speed)\s*[:=]\s*(.+?)\s*$/i.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (key === 'voice') v.voice = m[2].slice(0, 80);
        else { const n = Number(m[2]); if (n >= 0.5 && n <= 2) v[key] = n; }
    }
    return Object.keys(v).length ? v : null;
}

function writeAtomic(file, text) {
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
}

function readIndex() {
    const indexPath = path.join(root, 'logs', 'replay', 'index.json');
    try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { return []; }
}

// --- Morning ------------------------------------------------------------------
function morning(day) {
    let state = loadState();
    const news = [];
    if (!state) {
        state = newWorld();
        saveState(state);
        if (day > 1) news.push('Something is different this morning. You can feel the ground under your feet: you have a body now, and you are standing on the island. The files you made are still with you, in your notebook.');
    }
    // Each told once, the first morning after it happened.
    if (!state.voiceAnnounced && day > 1) {
        state.voiceAnnounced = true;
        saveState(state);
        news.push('Something is new this morning: you have a voice. When the person who looks after the island watches your day, they hear the words you say spoken aloud. You can choose how you sound, and change it whenever you like, with a file voice.txt in your notebook: lines like "voice: Zira" (part of the name of one of their voices, for example Guy, Christopher, Ryan, Aria, Jenny or Sonia, or "default"), "pitch: 1.0" and "speed: 1.0" (each from 0.5 to 2).');
    }
    if (!state.graphicsAnnounced && day > 1) {
        state.graphicsAnnounced = true;
        saveState(state);
        news.push(GRAPHICS_NEWS);
    }
    if (!state.bodyModelAnnounced && day > 1) {
        state.bodyModelAnnounced = true;
        saveState(state);
        news.push(BODY_NEWS.replace('your drawing of yourself', 'your drawing of yourself (drawings/me.txt)'));
    }
    if (!state.motionAnnounced && day > 1) {
        state.motionAnnounced = true;
        saveState(state);
        news.push(MOTION_NEWS);
    }
    // Each morning starts as day (the sun and the moon stay as they chose).
    if (state.sky && state.sky.night) { state.sky = { ...state.sky, night: false }; saveState(state); }
    if (!state.drawnLookAnnounced && day > 1) {
        state.drawnLookAnnounced = true;
        saveState(state);
        news.push(DRAWN_NEWS);
    }
    if (!state.smoothAnnounced && day > 1) {
        state.smoothAnnounced = true;
        saveState(state);
        news.push(SMOOTH_NEWS);
    }
    if (!state.shapesAnnounced && day > 1) {
        state.shapesAnnounced = true;
        saveState(state);
        news.push(SHAPES_NEWS);
    }
    if (!state.skyAnnounced && day > 1) {
        state.skyAnnounced = true;
        saveState(state);
        news.push(SKY_NEWS);
    }
    if (!state.engineAnnounced && day > 1) {
        state.engineAnnounced = true;
        saveState(state);
        news.push(ENGINE_NEWS);
    }
    const films = cinemaNews(state, 'islander');
    if (films) { saveState(state); news.push(films); }
    // Nobody else is on the island when the islander wakes up (a visitor arrives during the day).
    if ((state.guests && Object.keys(state.guests).length) || state.left || state.asleep) {
        state.guests = {}; delete state.left; delete state.asleep; saveState(state);
    }
    const snapDir = path.join(worldDir, 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, `day-${pad3(day)}.json`), JSON.stringify({ ...state, looks: appearance().drawing, rules: loadRules() }));
    process.stdout.write(news.join('\n'));
}

// Films in the cinema that this one hasn't been told about yet (marks them told; the caller saves the state).
function cinemaNews(state, who) {
    state.cinemaSeen = state.cinemaSeen || {};
    return cinema.news(state.cinemaSeen[who] = state.cinemaSeen[who] || []);
}

// --- Replay -------------------------------------------------------------------
// Tide's notebook steps and words for a day, from her own logs: the visits recorded for that day in visitors.json,
// and (while a day is live) any visitor log written since it began. Only what happened between start and end.
function guestNotebook(day, start, end, short, clip) {
    const rawDir = path.join(root, 'logs', 'raw'), files = new Set(), out = [];
    const from = Date.parse(start), until = end ? Date.parse(end) : Infinity;
    try { for (const v of JSON.parse(fs.readFileSync(path.join(root, 'visitors.json'), 'utf8'))) if (v.day === day) files.add(`visitor-${pad3(v.n)}.jsonl`); } catch { /* none */ }
    try { for (const f of fs.readdirSync(rawDir)) if (/^visitor-\d+\.jsonl$/.test(f) && fs.statSync(path.join(rawDir, f)).mtimeMs >= from) files.add(f); } catch { /* none */ }
    for (const f of files) {
        let lines; try { lines = fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n'); } catch { continue; }
        const results = {};
        for (const line of lines) {
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === 'user') for (const c of [].concat(ev.message?.content || [])) if (c.type === 'tool_result') results[c.tool_use_id] = !c.is_error;
        }
        for (const line of lines) {
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            const at = Date.parse(ev.timestamp || '');
            if (ev.type !== 'assistant' || !(at >= from && at <= until) || ev.error) continue;
            const t = ev.timestamp;
            for (const c of ev.message?.content || []) {
                if (c.type === 'text' && c.text.trim()) out.push({ kind: 'say', who: 'visitor', t, text: c.text.trim() });
                else if (c.type === 'thinking' && c.thinking?.trim()) out.push({ kind: 'think', who: 'visitor', t, text: c.thinking.trim() });
                else if (c.type === 'tool_use' && !c.name.startsWith('mcp__')) {
                    const i = c.input || {};
                    out.push({
                        kind: 'notebook', who: 'visitor', t, tool: c.name, ok: results[c.id] !== false,
                        file: short(i.file_path || i.path || ''), pattern: i.pattern,
                        content: c.name === 'Write' ? clip(i.content, 20000) : c.name === 'Edit' ? clip(i.new_string, 4000) : undefined,
                    });
                }
            }
        }
    }
    return out;
}

function replay(day, rawPath, start, end, endedBy, promptFile) {
    const snapPath = path.join(worldDir, 'snapshots', `day-${pad3(day)}.json`);
    const snap = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : null;
    const eventsPath = path.join(worldDir, 'events', `day-${pad3(day)}.jsonl`);
    const events = [];
    if (fs.existsSync(eventsPath)) for (const l of fs.readFileSync(eventsPath, 'utf8').split('\n')) { try { events.push(JSON.parse(l)); } catch { /* blank or half-written */ } }
    const live = endedBy === 'live';
    // Changes of looks, the owner's voice and everything a visitor does aren't the islander's tool calls;
    // they slot in by time.
    // A change of the rules file is recorded with the new rules (the rules tool's own calls are not).
    const isTimed = e => e.tool === 'looks' || e.tool === 'voice' || e.tool === 'sleep' || (e.tool === 'rules' && 'rules' in e) || (e.who && e.who !== 'islander');
    const timed = events.filter(isTimed);
    const queue = events.filter(e => !isTimed(e));
    const islandPrefix = islandDir.replace(/\\/g, '/').replace(/\/?$/, '/').toLowerCase();
    const short = p => { const s = String(p || '').replace(/\\/g, '/'); return s.toLowerCase().startsWith(islandPrefix) ? s.slice(islandPrefix.length) : s; };
    const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '\n…' : s);

    const steps = [];
    const results = {};
    const lines = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8').split('\n') : [];
    for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'user') for (const c of [].concat(ev.message?.content || [])) if (c.type === 'tool_result') results[c.tool_use_id] = !c.is_error;
    }
    for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type !== 'assistant') continue;
        for (const c of ev.message?.content || []) {
            if (c.type === 'text' && c.text.trim()) steps.push({ kind: 'say', text: c.text.trim() });
            else if (c.type === 'thinking' && c.thinking?.trim()) steps.push({ kind: 'think', text: c.thinking.trim() });
            else if (c.type === 'tool_use' && c.name.startsWith('mcp__island__')) {
                const tool = c.name.slice('mcp__island__'.length);
                const i = queue.findIndex(e => e.tool === tool);
                if (i < 0 && live) continue;  // still happening; it shows up on the next update
                const e = i >= 0 ? queue.splice(i, 1)[0] : { tool, input: c.input, ok: false, text: '(no record)' };
                steps.push({ kind: 'world', ...e });
            } else if (c.type === 'tool_use') {
                const i = c.input || {};
                steps.push({
                    kind: 'notebook', tool: c.name, ok: results[c.id] !== false,
                    file: short(i.file_path || i.path || ''), pattern: i.pattern,
                    content: c.name === 'Write' ? clip(i.content, 20000) : c.name === 'Edit' ? clip(i.new_string, 4000) : undefined,
                });
            }
        }
    }
    // What Tide did in the notebook, and her own words and thoughts, from her log (logs/raw/visitor-NNN.jsonl):
    // her body's actions are already in the events, but reading and writing files only show up there.
    timed.push(...guestNotebook(day, start, end, short, clip));
    timed.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    // Both servers notice a change of the rules file; it goes into the replay once.
    let lastRules = JSON.stringify(snap ? snap.rules ?? null : null);
    const fresh = timed.filter(e => {
        if (e.tool !== 'rules' || !('rules' in e)) return true;
        const j = JSON.stringify(e.rules);
        if (j === lastRules) return false;
        lastRules = j;
        return true;
    });
    // Each goes just before the first step that happened after it.
    for (const e of fresh) {
        const at = steps.findIndex(s => s.t && s.t >= e.t);
        const step = e.kind ? e : e.who && e.who !== 'islander' ? { kind: 'guest', ...e }
            : e.tool === 'voice' ? { kind: 'voice', t: e.t, text: e.text } : { kind: 'world', ...e };
        steps.splice(at < 0 ? steps.length : at, 0, step);
    }
    // Island time for each step: world steps have their own; the rest borrow the time of the step before.
    let t = start;
    for (const s of steps) { if (s.t) t = s.t; else s.t = t; }

    const out = {
        day, date: start.slice(0, 10), start, end, endedBy,
        prompt: promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '',
        embodied: Boolean(snap),
        voice: readVoice(),
        visitorVoice: readVoice(path.join('letters', 'visitor-voice.txt')),
        map: (snap || newWorld()).map,
        startState: snap ? { paint: snap.paint, height: snap.height || {}, smooth: snap.smooth || {}, things: snap.things, body: snap.body, looks: snap.looks, blocks: snap.blocks || {}, rules: snap.rules || null, sky: snap.sky || null } : null,
        steps,
    };
    const replayDir = path.join(root, 'logs', 'replay');
    fs.mkdirSync(replayDir, { recursive: true });
    writeAtomic(path.join(replayDir, `day-${pad3(day)}.js`), `ISLAND_REPLAY(${JSON.stringify(out)});\n`);
    const index = readIndex().filter(d => d.day !== day);
    index.push({ day, date: out.date, start, end, endedBy, steps: steps.length });
    index.sort((a, b) => a.day - b.day);
    writeAtomic(path.join(replayDir, 'index.json'), JSON.stringify(index, null, 1));
    writeAtomic(path.join(replayDir, 'index.js'), `ISLAND_DAYS(${JSON.stringify(index)});\n`);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'serve') serve();
else if (mode === 'morning') morning(Number(args[0]));
else if (mode === 'depart') {
    // node world.mjs depart <who> <day>: a visitor's body leaves (visitor.ps1 calls this after the visit, to be sure)
    const eventsPath = path.join(worldDir, 'events', `day-${pad3(Number(args[1]))}.jsonl`);
    depart(args[0], ev => fs.appendFileSync(eventsPath, JSON.stringify({ t: new Date().toISOString(), who: args[0], ...ev }) + '\n'));
}
else if (mode === 'asleep') {
    // node world.mjs asleep <day>: the islander's day ended while a visitor is still here (visit.ps1 calls this)
    const eventsPath = path.join(worldDir, 'events', `day-${pad3(Number(args[0]))}.jsonl`);
    asleep(ev => fs.appendFileSync(eventsPath, JSON.stringify({ t: new Date().toISOString(), ...ev }) + '\n'));
}
else if (mode === 'news') {
    // node world.mjs news <who>: morning news for someone other than the islander (visitor.ps1, for Tide)
    process.stdout.write(withLock(() => { const st = loadState(); const n = st ? cinemaNews(st, args[0]) : ''; if (n) saveState(st); return n; }));
}
else if (mode === 'replay') replay(Number(args[0]), args[1], args[2], args[3], args[4], args[5]);
else if (mode === 'map') { const m = generateMap(); console.log(m.land.join('\n')); console.log('land steps:', m.land.join('').split('#').length - 1); }
else { console.error('usage: node world.mjs serve | morning <day> | news <who> | replay <day> <raw> <start> <end> <endedBy> <promptFile> | depart <who> <day> | asleep <day>'); process.exit(1); }

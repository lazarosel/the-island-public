// The sealed interpreter for their physics scripts (island/physics/*.js), in its own worker thread.
// Each script runs in its own QuickJS context (JavaScript compiled to WebAssembly, in its own memory), with a memory
// cap, a stack cap and a time limit per call. Nothing from Node is given to it: no require, files, network, timers or
// clock. Data goes in as a JSON string and comes back as a JSON string. physics.mjs (the engine side) waits for each
// answer for a short time and kills this whole worker if it doesn't come.
import { workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { newQuickJSWASMModuleFromVariant } = require('quickjs-emscripten-core');
const variant = require('@jitl/quickjs-wasmfile-release-sync').default;

const MEMORY = 8 * 1024 * 1024, STACK = 512 * 1024;
const { ctrl: ctrlBuf, data: dataBuf } = workerData;
const ctrl = new Int32Array(ctrlBuf), data = new Uint8Array(dataBuf);
const enc = new TextEncoder();

// The answer goes into shared memory: ctrl[1] its length, then ctrl[0] = 1 wakes the engine.
function answer(obj) {
    let bytes = enc.encode(JSON.stringify(obj));
    if (bytes.length > data.length) bytes = enc.encode(JSON.stringify({ ok: false, error: 'The answer was too big.' }));
    data.set(bytes);
    Atomics.store(ctrl, 1, bytes.length);
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
}

// Inside each script: the helpers they use, and nothing else. Effects are collected and handed back after each call.
// Date and Math.random are replaced, so the same moment always gives the same answer.
const PRELUDE = `
"use strict";
var __effects = [], __logs = [], __stop = null, __seed = 1;
function __rand() { __seed |= 0; __seed = __seed + 0x6D2B79F5 | 0; var t = Math.imul(__seed ^ __seed >>> 15, 1 | __seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
Math.random = __rand;
var random = __rand;
globalThis.Date = undefined;
function log() { if (__logs.length < 20) __logs.push(Array.prototype.map.call(arguments, function (a) { return typeof a === "string" ? a : JSON.stringify(a); }).join(" ").slice(0, 300)); }
function __push(e) { if (__effects.length >= 400) throw new Error("Too many changes in one go (400 at most)."); __effects.push(e); }
function move(thing, x, y, z) { __push({ kind: "move", thing: thing && typeof thing === "object" ? thing.id : thing, x: x, y: y, z: z == null ? null : z }); }
function setBlock(x, y, z, color) { __push({ kind: "block", x: x, y: y, z: z, color: color }); }
function clearBlock(x, y, z) { __push({ kind: "block", x: x, y: y, z: z, color: null }); }
function setWater(x, y, z, color) { __push({ kind: "water", x: x, y: y, z: z, color: color == null ? "" : color }); }
function clearWater(x, y, z) { __push({ kind: "water", x: x, y: y, z: z, color: null }); }
function drift(who, direction) { __push({ kind: "drift", who: who, direction: direction }); }
function stop(why) { __stop = String(why == null ? "Something stops you." : why).slice(0, 200); }
function __world(w) {
  var blocks = {}, water = {}, heights = w.heights || {};
  (w.blocks || []).forEach(function (b) { blocks[b[0] + "," + b[1] + "," + b[2]] = b[3]; });
  (w.water || []).forEach(function (b) { water[b[0] + "," + b[1] + "," + b[2]] = b[3]; });
  w.blockAt = function (x, y, z) { return blocks[x + "," + y + "," + z] || null; };
  w.waterAt = function (x, y, z) { return water[x + "," + y + "," + z] || null; };
  w.heightAt = function (x, y) { if (!w.isLand(x, y)) return 0; var h = heights[x + "," + y]; return h ? Math.max(1, Math.min(8, h)) : 1; };
  w.isLand = function (x, y) { return y >= 0 && y < w.map.h && x >= 0 && x < w.map.w && w.map.land[y].charAt(x) === "#"; };
  w.thingsNamed = function (name) { name = String(name).toLowerCase(); return w.things.filter(function (t) { return t.name === name; }); };
  w.body = function (who) { return w.bodies.filter(function (b) { return b.who === who; })[0] || null; };
  return w;
}
function __call(hook, argsJson, seed) {
  __effects = []; __logs = []; __stop = null; __seed = seed | 0;
  var f = globalThis[hook];
  if (typeof f !== "function") return JSON.stringify({ none: true });
  var a = JSON.parse(argsJson);
  a[0] = __world(a[0]);
  f.apply(null, a);
  return JSON.stringify({ effects: __effects, logs: __logs, stop: __stop });
}
`;

let Q = null;
const scripts = new Map();  // name -> { rt, vm, hooks, code }

function drop(name) { const s = scripts.get(name); if (!s) return; try { s.vm.dispose(); s.rt.dispose(); } catch { /* already gone */ } scripts.delete(name); }

// A time limit for the code running now: QuickJS checks it as it runs and stops the script when it passes.
let deadline = 0;

// Only scripts whose code changed start again; the others keep running with their variables as they are.
function load(list) {
    for (const name of [...scripts.keys()]) if (!list.some(s => s.name === name)) drop(name);
    const out = [];
    for (const { name, code } of list) {
        const had = scripts.get(name);
        if (had && had.code === code) { out.push({ name, ok: true, hooks: had.hooks, kept: true }); continue; }
        drop(name);
        const rt = Q.newRuntime();
        rt.setMemoryLimit(MEMORY);
        rt.setMaxStackSize(STACK);
        rt.setInterruptHandler(() => Date.now() > deadline);
        const vm = rt.newContext();
        deadline = Date.now() + 200;
        const pre = vm.evalCode(PRELUDE, 'prelude.js');
        if (pre.error) { pre.error.dispose(); vm.dispose(); rt.dispose(); out.push({ name, ok: false, error: 'internal: the prelude failed' }); continue; }
        pre.value.dispose();
        deadline = Date.now() + 200;
        const r = vm.evalCode(code, `physics/${name}`);
        if (r.error) {
            const e = vm.dump(r.error); r.error.dispose();
            out.push({ name, ok: false, error: describe(e) });
            vm.dispose(); rt.dispose();
            continue;
        }
        r.value.dispose();
        const h = vm.evalCode('JSON.stringify(["onTick","onStep","onSay","onBuild"].filter(function (n) { return typeof globalThis[n] === "function"; }))');
        const hooks = h.error ? [] : JSON.parse(vm.getString(h.value));
        (h.error || h.value).dispose();
        scripts.set(name, { rt, vm, hooks, code });
        out.push({ name, ok: true, hooks });
    }
    return out;
}

function call(name, hook, argsJson, seed, ms) {
    const s = scripts.get(name);
    if (!s) return { ok: false, error: 'not loaded' };
    deadline = Date.now() + ms;
    const r = s.vm.evalCode(`__call(${JSON.stringify(hook)}, ${JSON.stringify(argsJson)}, ${seed | 0})`);
    if (r.error) {
        const e = s.vm.dump(r.error); r.error.dispose();
        return { ok: false, error: Date.now() > deadline ? `It ran too long (more than ${ms} ms) and was stopped.` : describe(e) };
    }
    const text = s.vm.getString(r.value); r.value.dispose();
    return { ok: true, result: text };
}

function describe(e) {
    if (e && typeof e === 'object') return String((e.name ? e.name + ': ' : '') + (e.message || '') + (e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : '')).slice(0, 600);
    return String(e).slice(0, 600);
}

newQuickJSWASMModuleFromVariant(variant).then(m => {
    Q = m;
    answer({ ok: true, ready: true });
    parentPort.on('message', msg => {
        try {
            if (msg.op === 'load') answer({ ok: true, loaded: load(msg.scripts) });
            else if (msg.op === 'call') answer(call(msg.name, msg.hook, msg.args, msg.seed, msg.ms));
            else answer({ ok: false, error: 'unknown op' });
        } catch (err) {
            answer({ ok: false, error: describe(err) });
        }
    });
}, err => answer({ ok: false, error: 'QuickJS could not start: ' + describe(err) }));

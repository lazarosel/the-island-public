// Their voices: everything the islander and Tide say out loud, spoken by Kokoro (an open text-to-speech model that runs
// on this PC, in tools/kokoro/, kept out of git) and kept as small Opus files in logs/voice/day-NNN/, which the viewer
// plays live and in replays. Without Kokoro or FFmpeg nothing happens, and the viewer uses the browser's voice as before.
//   node voices.mjs live <day>   during a day: speaks each new line as it is said; ends once world/voices-finish.flag
//                                appears (visit.ps1 makes it at the end of the day) and every line is done
//   node voices.mjs day <day>    speaks any line of that day that has no recording yet (for earlier days too)
// A line's file is named by a hash of who said it and the words (voiceKey), the same as the viewer works it out.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.ISLAND_ROOT || path.resolve(here, '..');
const kokoroDir = path.join(here, '..', 'tools', 'kokoro');
const pad3 = n => String(n).padStart(3, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The same as voiceKey in viewer/index.html: FNV-1a of "who\ntext", as 8 hex digits.
export function voiceKey(who, text) {
    let h = 0x811c9dc5;
    for (const ch of who + '\n' + text) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
}

// The words as spoken: no markdown, and like the viewer, a line in Greek letters stays silent. A place like (56,18) gets
// a space after its comma, or Kokoro reads the comma as a thousands mark ("five thousand six hundred eighteen").
function spoken(text) {
    const clean = String(text || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>|]/g, '').replace(/^\s*[-•]\s+/gm, '')
        .replace(/(\d),(?=\d)/g, '$1, ').trim();
    return clean && !/[Ͱ-Ͽἀ-῿]/.test(clean) ? clean.slice(0, 1000) : '';
}

// Their own choice (voice.txt for the islander, letters/visitor-voice.txt for Tide): a Kokoro voice by its name
// (like am_michael), or one of the browser voice names they chose before, mapped to the closest Kokoro voice.
const NEAREST = {
    christopher: 'am_michael', guy: 'am_eric', eric: 'am_eric', david: 'am_adam', mark: 'am_liam', andrew: 'am_liam', brian: 'am_onyx',
    roger: 'am_fenrir', davis: 'am_echo', tony: 'am_puck', jason: 'am_adam', ryan: 'bm_george', thomas: 'bm_lewis', william: 'bm_daniel',
    liam: 'am_liam', connor: 'bm_fable', steffan: 'am_onyx',
    aria: 'af_heart', jenny: 'af_bella', michelle: 'af_nicole', ana: 'af_sky', emma: 'bf_emma', ava: 'af_nova', sonia: 'bf_emma',
    libby: 'bf_isabella', maisie: 'bf_lily', natasha: 'af_river', clara: 'af_sarah', sara: 'af_sarah', jane: 'af_jessica',
    nancy: 'af_kore', zira: 'af_sarah', hazel: 'bf_alice', susan: 'bf_alice',
};
const DEFAULT = { islander: 'am_michael', visitor: 'af_heart' };
function voiceOf(who, available) {
    const file = path.join(root, 'island', who === 'islander' ? 'voice.txt' : path.join('letters', 'visitor-voice.txt'));
    let name = '', speed = 1;
    try {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = /^\s*(voice|speed)\s*[:=]\s*(.+?)\s*$/i.exec(line);
            if (!m) continue;
            if (m[1].toLowerCase() === 'voice') name = m[2].toLowerCase();
            else speed = Math.max(0.5, Math.min(2, Number(m[2]) || 1));
        }
    } catch { /* no file: the defaults */ }
    const direct = available.includes(name) ? name : null;
    const near = Object.keys(NEAREST).find(k => name.includes(k));
    return { voice: direct || (near && NEAREST[near]) || DEFAULT[who] || DEFAULT.islander, speed };
}

function findFfmpeg() {
    if (process.env.ISLAND_FFMPEG) return process.env.ISLAND_FFMPEG;
    if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0) return 'ffmpeg';
    const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    try {
        for (const d of fs.readdirSync(winget).filter(n => /ffmpeg/i.test(n))) for (const s of fs.readdirSync(path.join(winget, d))) {
            const p = path.join(winget, d, s, 'bin', 'ffmpeg.exe');
            if (fs.existsSync(p)) return p;
        }
    } catch { /* none */ }
    return null;
}

async function loadTts() {
    if (!fs.existsSync(path.join(kokoroDir, 'node_modules', 'kokoro-js'))) return null;
    const { KokoroTTS } = await import(pathToFileURL(path.join(kokoroDir, 'node_modules', 'kokoro-js', 'dist', 'kokoro.js')).href);
    // The model (about 310 MB) downloads on first use into the library's own cache under tools/kokoro/node_modules;
    // after that it loads from there and nothing is fetched.
    return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
}

// Every line the viewer speaks that day: [{who, text}]. What either says out loud (the say tool, in the events; Tide's
// carry who: "visitor"), and the islander's own replies (its text, in its log), as the viewer has them.
const read = file => { try { return fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; } };
function linesOf(day) {
    const out = [];
    for (const l of read(path.join(root, 'world', 'events', `day-${pad3(day)}.jsonl`))) {
        if (!l.includes('"said"')) continue;
        try { const e = JSON.parse(l); if (e.tool === 'say' && e.ok && e.said) out.push({ who: e.who || 'islander', text: e.said }); } catch { /* half-written */ }
    }
    // Their own replies: the islander's log, and Tide's log for the visit on this day (visitors.json, or for a day still
    // running, the newest visitor log).
    const logs = [['islander', path.join(root, 'logs', 'raw', `day-${pad3(day)}.jsonl`)]];
    let n = null;
    try { n = (JSON.parse(fs.readFileSync(path.join(root, 'visitors.json'), 'utf8')).find(v => v.day === day) || {}).n; } catch { /* none */ }
    if (n == null) {
        const vs = fs.existsSync(path.join(root, 'logs', 'raw')) ? fs.readdirSync(path.join(root, 'logs', 'raw')).filter(f => /^visitor-\d+\.jsonl$/.test(f)).sort() : [];
        const newest = vs[vs.length - 1];
        if (newest && fs.statSync(path.join(root, 'logs', 'raw', newest)).mtimeMs > fs.statSync(logs[0][1], { throwIfNoEntry: false })?.birthtimeMs - 60000) n = Number(newest.replace(/\D/g, ''));
    }
    if (n != null) logs.push(['visitor', path.join(root, 'logs', 'raw', `visitor-${pad3(n)}.jsonl`)]);
    for (const [who, file] of logs) for (const l of read(file)) {
        if (!l.includes('"type":"assistant"')) continue;
        try {
            const e = JSON.parse(l);
            for (const c of e.message?.content || []) if (c.type === 'text' && c.text.trim()) out.push({ who, text: c.text.trim() });
        } catch { /* half-written */ }
    }
    return out;
}

async function speakAll(day, tts, ffmpeg, done) {
    const dir = path.join(root, 'logs', 'voice', `day-${pad3(day)}`);
    fs.mkdirSync(dir, { recursive: true });
    const available = Object.keys(tts.voices);
    let made = 0;
    for (const { who, text } of linesOf(day)) {
        const words = spoken(text);
        if (!words) continue;
        const key = voiceKey(who, text), out = path.join(dir, key + (ffmpeg ? '.ogg' : '.wav'));
        if (done.has(key) || fs.existsSync(out)) { done.add(key); continue; }
        const { voice, speed } = voiceOf(who, available);
        try {
            const audio = await tts.generate(words, { voice, speed });
            const wav = path.join(dir, key + '.tmp.wav');
            await audio.save(wav);
            if (ffmpeg) {
                const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', out + '.tmp'], { windowsHide: true });
                fs.rmSync(wav, { force: true });
                if (r.status !== 0) throw new Error('ffmpeg failed');
                fs.renameSync(out + '.tmp', out);
            } else fs.renameSync(wav, out);
            made++;
        } catch (err) { process.stderr.write(`${key}: ${err.message}\n`); }
        done.add(key);
    }
    return made;
}

const [mode, dayArg] = process.argv.slice(2);
const day = Number(dayArg);
if ((mode === 'live' || mode === 'day') && day > 0) {
    const tts = await loadTts().catch(err => { process.stderr.write('Kokoro could not start: ' + err.message + '\n'); return null; });
    if (!tts) process.exit(0);
    const ffmpeg = findFfmpeg(), done = new Set();
    if (mode === 'day') {
        const n = await speakAll(day, tts, ffmpeg, done);
        console.log(`day ${day}: ${n} new line${n === 1 ? '' : 's'} spoken`);
    } else {
        const flag = path.join(root, 'world', 'voices-finish.flag');
        for (;;) {
            const finishing = fs.existsSync(flag);
            await speakAll(day, tts, ffmpeg, done);
            if (finishing) break;
            await sleep(700);
        }
    }
    process.exit(0);
}

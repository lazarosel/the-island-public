// The cinema: films the owner leaves in the notebook's cinema/ folder, and the watch tool's eyes and ears.
// Pictures come from FFmpeg. The words come from subtitles (a .srt or .vtt next to the film, or inside the file),
// or, without them, from Whisper (FFmpeg's whisper filter with a model in tools/whisper/), written down by ear.
// How the sound feels comes from its loudness (FFmpeg's ebur128). Nothing of a film is kept except its words
// (world/cinema-cache/, not in git) and where each one stopped watching (world/cinema-<who>.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';

export const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|mpe?g|ts)$/i;
const PICTURE_W = 512;           // pictures are 512 pixels wide (about 200 tokens each at 16:9)
const EAR_CHUNK = 60;            // Whisper writes down a film a minute at a time, once
const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
// The agents can write text files into cinema/ too. A text "film" could be a playlist or concat script that makes
// FFmpeg fetch URLs or read files outside the island, so FFmpeg may only open real video containers, from disk.
const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,asf,mpeg,mpegts,mpegvideo,flv,ogg';
const input = file => ['-protocol_whitelist', 'file', '-format_whitelist', FORMATS, '-i', file];

// "1:05:30", "12:30", "90" (seconds) -> seconds. 75.5 -> "1:15".
export function parseTime(s) {
    const m = /^\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(String(s)) || /^\s*()()(\d+(?:\.\d+)?)\s*s?\s*$/.exec(String(s));
    return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3]) : null;
}
export function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// .srt or .vtt text -> [{t0, t1, text}]
export function parseSubs(text) {
    const time = s => { const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(s); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + m[4]) : null; };
    const out = [];
    for (const block of String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const at = lines.findIndex(l => l.includes('-->'));
        if (at < 0) continue;
        const [a, b] = lines[at].split('-->');
        const t0 = time(a), t1 = time(b);
        const words = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        if (t0 !== null && words) out.push({ t0, t1: t1 ?? t0, text: words });
    }
    return out;
}

export function makeCinema(root) {
    const dir = path.join(root, 'island', 'cinema');
    const cache = path.join(root, 'world', 'cinema-cache');
    let ffmpegPath;

    // FFmpeg: ISLAND_FFMPEG, or on the PATH, or where winget puts it.
    function ffmpeg() {
        if (ffmpegPath !== undefined) return ffmpegPath;
        ffmpegPath = null;
        if (process.env.ISLAND_FFMPEG) return (ffmpegPath = process.env.ISLAND_FFMPEG);
        if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0) return (ffmpegPath = 'ffmpeg');
        const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
        try {
            for (const d of fs.readdirSync(winget).filter(n => /ffmpeg/i.test(n))) for (const s of fs.readdirSync(path.join(winget, d))) {
                const p = path.join(winget, d, s, 'bin', 'ffmpeg.exe');
                if (fs.existsSync(p)) return (ffmpegPath = p);
            }
        } catch { /* no winget */ }
        return ffmpegPath;
    }

    // The Whisper model, if there is one (tools/whisper/ggml-*.bin, or ISLAND_WHISPER_MODEL).
    function model() {
        if (process.env.ISLAND_WHISPER_MODEL) return fs.existsSync(process.env.ISLAND_WHISPER_MODEL) ? process.env.ISLAND_WHISPER_MODEL : null;
        const wd = path.join(root, 'tools', 'whisper');
        try { const f = fs.readdirSync(wd).filter(n => /^ggml-.*\.bin$/i.test(n)).sort()[0]; return f ? path.join(wd, f) : null; } catch { return null; }
    }

    // Runs FFmpeg hidden (no window); never throws.
    const run = (args, timeout = 180000) => new Promise(resolve => {
        const exe = ffmpeg();
        if (!exe) return resolve({ ok: false, stdout: Buffer.alloc(0), stderr: 'no ffmpeg' });
        execFile(exe, args, { windowsHide: true, encoding: 'buffer', maxBuffer: 64 << 20, cwd: root, timeout },
            (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || Buffer.alloc(0), stderr: String(stderr || '') }));
    });

    function films() {
        try { return fs.readdirSync(dir).filter(n => VIDEO.test(n) && fs.statSync(path.join(dir, n)).isFile()).sort(); } catch { return []; }
    }
    const title = file => file.replace(VIDEO, '');

    function find(name) {
        const want = String(name || '').trim().replace(/^cinema[\\/]/i, '').toLowerCase();
        const all = films();
        return all.find(f => f.toLowerCase() === want) || all.find(f => title(f).toLowerCase() === want)
            || all.find(f => title(f).toLowerCase().includes(want) && want.length >= 3) || null;
    }

    // How long a film is, whether it has sound, and its subtitle tracks (cached per file).
    async function info(file) {
        const full = path.join(dir, file), st = fs.statSync(full);
        const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
        const infoPath = path.join(cache, key + '.info.json');
        try { return JSON.parse(fs.readFileSync(infoPath, 'utf8')); } catch { /* not yet */ }
        const r = await run(['-hide_banner', ...input(full)], 30000);
        const d = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(r.stderr);
        if (!d) throw new Error(`"${title(file)}" can't be played; it may not be a film, or it is damaged.`);
        const subs = [];
        let audio = false, n = 0;
        for (const m of r.stderr.matchAll(/Stream #\d+:\d+(?:\[\w+\])?(?:\((\w+)\))?: (Video|Audio|Subtitle): (\w+)/g)) {
            if (m[2] === 'Audio') audio = true;
            if (m[2] === 'Subtitle') { if (TEXT_SUBS.includes(m[3].toLowerCase())) subs.push({ index: n, lang: m[1] || '' }); n++; }
        }
        const out = { key, duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), audio, subs };
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(infoPath, JSON.stringify(out));
        return out;
    }

    // Subtitles for the whole film: a .srt/.vtt next to it (the same name, maybe with ".en"), or the file's own.
    async function subtitles(file, inf) {
        const base = title(file).toLowerCase();
        const side = fs.readdirSync(dir).filter(n => /\.(srt|vtt)$/i.test(n) && n.toLowerCase().startsWith(base + '.'))
            .sort((a, b) => a.length - b.length || (/\.en(g)?\./i.test(b) ? 1 : 0) - (/\.en(g)?\./i.test(a) ? 1 : 0));
        if (side.length) return parseSubs(fs.readFileSync(path.join(dir, side[0]), 'utf8'));
        if (!inf.subs.length) return null;
        const out = path.join(cache, inf.key + '.srt');
        if (!fs.existsSync(out)) {
            const s = inf.subs.find(x => /^en/i.test(x.lang)) || inf.subs[0];
            const r = await run(['-hide_banner', '-loglevel', 'error', '-y', ...input(path.join(dir, file)), '-map', `0:s:${s.index}`, '-f', 'srt', out]);
            if (!r.ok) { fs.writeFileSync(out, ''); }
        }
        const lines = parseSubs(fs.readFileSync(out, 'utf8'));
        return lines.length ? lines : null;
    }

    // Words written down by ear for [from, to): Whisper, a minute at a time, each minute once.
    async function byEar(file, inf, from, to) {
        const m = model();
        if (!m || !inf.audio) return null;
        // The islander and Tide may watch the same minute at once (two servers): each writes down by ear into its
        // own file, and the shared result is re-read and merged before it is saved.
        const earPath = path.join(cache, inf.key + '.ear.json');
        const saved = () => { try { return JSON.parse(fs.readFileSync(earPath, 'utf8')); } catch { return {}; } };
        let ear = saved();
        const rel = p => path.relative(root, p).replace(/\\/g, '/');
        for (let k = Math.floor(from / EAR_CHUNK); k * EAR_CHUNK < to; k++) {
            if (ear[k]) continue;
            ear = { ...saved(), ...ear };
            if (ear[k]) continue;  // the other one just wrote this minute down
            const out = path.join(cache, `${inf.key}-ear-${k}-${process.pid}.srt`);
            try { fs.rmSync(out, { force: true }); } catch { /* left from before; ffmpeg overwrites it */ }
            const r = await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(k * EAR_CHUNK), '-t', String(EAR_CHUNK), ...input(path.join(dir, file)), '-vn',
                '-af', `aresample=16000,aformat=channel_layouts=mono,whisper=model=${rel(m)}:language=en:queue=20:destination=${rel(out)}:format=srt`, '-f', 'null', '-']);
            if (!r.ok && !fs.existsSync(out)) return null;
            let lines = [];
            try { lines = parseSubs(fs.readFileSync(out, 'utf8')); } catch { /* nothing written down */ }
            try { fs.rmSync(out, { force: true }); } catch { /* cleared later */ }
            ear = { ...saved(), ...ear, [k]: lines.map(l => ({ t0: l.t0 + k * EAR_CHUNK, t1: l.t1 + k * EAR_CHUNK, text: l.text })) };
            const tmp = `${earPath}.${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify(ear));
            try { fs.renameSync(tmp, earPath); } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* fine */ } }
        }
        const all = [];
        for (let k = Math.floor(from / EAR_CHUNK); k * EAR_CHUNK < to; k++) all.push(...(ear[k] || []));
        return all;
    }

    // How the sound feels over [from, from + len): its loudness, in words, and sudden loud moments.
    async function sound(file, from, len) {
        const r = await run(['-hide_banner', '-nostats', '-ss', String(from), '-t', String(len), ...input(path.join(dir, file)), '-vn', '-af', 'ebur128', '-f', 'null', '-'], 60000);
        const pts = [];
        for (const m of r.stderr.matchAll(/t:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.]+|-inf)/g)) pts.push([from + Number(m[1]), m[2] === '-inf' ? -120 : Number(m[2])]);
        if (!pts.length) return null;
        const word = v => (v < -60 ? 'silent' : v < -42 ? 'almost silent' : v < -32 ? 'quiet' : v < -23 ? 'moderate' : v < -15 ? 'loud' : 'very loud');
        // Every 2 seconds, the loudest moment; then runs of the same feeling.
        const buckets = [];
        for (const [t, v] of pts) { const b = Math.floor((t - from) / 2); buckets[b] = Math.max(buckets[b] ?? -120, v); }
        const runs = [];
        buckets.forEach((v, b) => { if (v === undefined) return; const w = word(v); if (!runs.length || runs[runs.length - 1].w !== w) runs.push({ w, t: from + b * 2 }); });
        // Merge runs of one bucket into their neighbours, so it reads as a few changes, not flicker.
        const steady = runs.filter((x, i) => i === 0 || i === runs.length - 1 || (runs[i + 1].t - x.t) > 2);
        const merged = steady.filter((x, i) => i === 0 || x.w !== steady[i - 1].w);
        const said = merged.length > 6 ? `changing often, from ${[...new Set(merged.map(x => x.w))].join(' to ')}`
            : merged.map((x, i) => (i === 0 ? x.w : `${x.w} from ${fmtTime(x.t)}`)).join(', then ');
        const sudden = [];
        for (let i = 10; i < pts.length; i++) {
            const [t, v] = pts[i], before = pts[i - 10][1];
            if (v > -25 && v - before >= 15 && !sudden.some(s => t - s < 3)) sudden.push(t);
        }
        return 'The sound is ' + said + '.' + (sudden.length ? ` A sudden loud sound at ${sudden.slice(0, 3).map(fmtTime).join(', ')}.` : '');
    }

    async function picture(file, t) {
        const r = await run(['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), ...input(path.join(dir, file)), '-frames:v', '1',
            '-vf', `scale=iw*sar:ih,scale=${PICTURE_W}:-2`, '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], 60000);
        return r.stdout.length > 100 ? r.stdout : null;
    }

    const posPath = who => path.join(root, 'world', `cinema-${who}.json`);
    const positions = who => { try { return JSON.parse(fs.readFileSync(posPath(who), 'utf8')); } catch { return {}; } };

    async function wordsKind(file, inf) {
        const base = title(file).toLowerCase();
        if (fs.readdirSync(dir).some(n => /\.(srt|vtt)$/i.test(n) && n.toLowerCase().startsWith(base + '.')) || inf.subs.length) return 'with subtitles';
        return model() && inf.audio ? 'its words written down by ear' : 'no words';
    }

    // The list of films, for watch without a film.
    async function list(who) {
        const all = films();
        if (!all.length) return 'The cinema is empty. No films have been left there.';
        const pos = positions(who), out = [];
        for (const f of all) {
            try {
                const inf = await info(f), at = pos[f] || 0;
                out.push(`"${title(f)}" (${fmtTime(inf.duration)}; ${at >= inf.duration - 1 ? 'you have seen it to the end' : at > 0 ? `you stopped at ${fmtTime(at)}` : 'not started'}; ${await wordsKind(f, inf)})`);
            } catch (e) { out.push(`"${title(f)}" (${e.message})`); }
        }
        return 'Films in the cinema: ' + out.join(', ') + '.';
    }

    // One stretch of a film. Returns {content, event}.
    async function watch(who, args) {
        if (!ffmpeg()) throw new Error('The cinema can\'t play films right now.');
        if (!args.film) return { content: [{ type: 'text', text: await list(who) }], event: { list: true } };
        const file = find(args.film);
        if (!file) throw new Error(`There is no film called "${args.film}" in the cinema. ${await list(who)}`);
        const inf = await info(file), pos = positions(who);
        const f = String(args.from ?? 'continue').trim().toLowerCase();
        let from = /^(continue|)$/.test(f) ? pos[file] || 0 : /^(start|beginning)$/.test(f) ? 0 : parseTime(f);
        if (from === null) throw new Error('from is "continue", "start", or a time in the film like "12:30" or "1:05:30".');
        if (from >= inf.duration - 0.5) {
            if (/^(continue|)$/.test(f)) throw new Error(`You have already watched "${title(file)}" to the end. Watch it from "start" to see it again, or from any time in it.`);
            throw new Error(`"${title(file)}" is only ${fmtTime(inf.duration)} long.`);
        }
        const len = Math.max(5, Math.min(120, Math.floor(Number(args.seconds) || 30)));
        const n = Math.max(1, Math.min(8, Math.floor(Number(args.pictures) || 4)));
        const to = Math.min(inf.duration, from + len), span = to - from;
        const times = Array.from({ length: n }, (_, i) => from + ((i + 0.5) * span) / n);
        const [pics, subs, feel] = await Promise.all([
            Promise.all(times.map(t => picture(file, t))),
            subtitles(file, inf),
            inf.audio ? sound(file, from, span) : Promise.resolve('The film has no sound.'),
        ]);
        const ear = subs ? null : await byEar(file, inf, from, to);
        const lines = (subs || ear || []).filter(l => l.t1 > from && l.t0 < to);
        pos[file] = to;
        fs.writeFileSync(posPath(who), JSON.stringify(pos));

        const content = [{ type: 'text', text: `"${title(file)}", ${fmtTime(from)} to ${fmtTime(to)} (the film is ${fmtTime(inf.duration)} long).` }];
        // Pictures less than a second apart are labelled to the tenth of a second.
        const at = t => fmtTime(t) + (span / n < 1 ? '.' + Math.floor((t % 1) * 10) : '');
        pics.forEach((p, i) => { if (p) content.push({ type: 'text', text: `At ${at(times[i])}:` }, { type: 'image', data: p.toString('base64'), mimeType: 'image/jpeg' }); });
        const said = lines.map(l => `${fmtTime(l.t0)}  ${l.text}`).join('\n');
        content.push({ type: 'text', text: (subs ? (said ? `What is said (from its subtitles):\n${said}` : 'Nothing is said (in its subtitles).')
            : ear ? (said ? `What is said (written down by ear, so there may be mistakes):\n${said}` : 'Nothing is said that could be made out.')
            : 'There are no words for this film (it has no subtitles).') + '\n' + (feel || '') +
            (to >= inf.duration - 0.5 ? '\nThe film ends.' : `\nNext time, watch carries on from ${fmtTime(to)}.`) });
        return { content, event: { film: title(file), from: Math.round(from), to: Math.round(to), pictures: pics.filter(Boolean).length, words: lines.length } };
    }

    // Morning news about films one hasn't been told of yet. seen: the films already told (updated in place).
    function news(seen) {
        const fresh = films().filter(f => !seen.includes(f));
        if (!fresh.length) return '';
        const names = fresh.map(f => `"${title(f)}"`).join(', ');
        const first = !seen.length;
        seen.push(...fresh);
        return first
            ? `Something is new this morning: the person who looks after the island left ${fresh.length > 1 ? 'some films' : 'a film'} for you in a cinema, the folder cinema/ in your notebook: ${names}. ` +
              'You can watch with the watch tool, if and when you like, alone or together. Each time it shows you a stretch of the film as a few pictures, with the words spoken in it and how the sound feels (you can\'t hear the voices or music themselves). It remembers where you stopped.'
            : `A new film is in the cinema: ${names}.`;
    }

    return { films, watch, news, list };
}

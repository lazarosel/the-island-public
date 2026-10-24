// How the island looks. Shared by the islanders' eyes (runner/world.mjs) and the replay viewer,
// so both see exactly the same picture. Two ways of looking: flat from above (render) and 3D (renderIso).
(function (root) {
    const TILE = 16;
    const DIRT = [139, 94, 60];
    const SEA = [47, 111, 179];
    const DEEP = [20, 52, 96];  // beyond the edge of the world
    const MAX_HEIGHT = 8;       // ground can be shaped from 1 (the beach) to 8; the sea is 0
    const LEVEL = 8;            // pixels per height level in 3D
    const SPRITE = 2;           // upright drawings are shown twice as big in 3D (a 16-wide drawing spans a tile)
    const LAYER = 2;            // pixels per layer of a 3D model

    // The body the islander has until it draws its own (drawings/me.txt).
    const DEFAULT_BODY = [
        'k = #2a2a35', 's = #f0d9b5', 'w = #4a7ab0',
        '',
        '................',
        '.....kkkkkk.....',
        '....kssssssk....',
        '....kskssksk....',
        '....kssssssk....',
        '.....kkkkkk.....',
        '......kwwk......',
        '....kwwwwwwk....',
        '...kwwwwwwwwk...',
        '...kwkwwwwkwk...',
        '...kskwwwwksk...',
        '....kkwwwwkk....',
        '.....kwkkwk.....',
        '.....kwkkwk.....',
        '....kkk..kkk....',
        '................',
    ].join('\n');

    // How Tide looks until she draws herself (drawings/me-tide.txt): a woman with long hair and a teal dress.
    const VISITOR_BODY = [
        'k = #3a2a20', 's = #e8c39e', 'h = #6b3f23', 'd = #3f8f8a',
        '',
        '................',
        '.....hhhhhh.....',
        '....hhsssshh....',
        '....hskssksh....',
        '....hssssssh....',
        '...hhhsssshhh...',
        '...hh.kddk.hh...',
        '....kddddddk....',
        '...kddddddddk...',
        '...kskddddksk...',
        '...kddddddddk...',
        '..kddddddddddk..',
        '..kkkkkkkkkkkk..',
        '.....ks..sk.....',
        '.....kk..kk.....',
        '................',
    ].join('\n');

    function hash(x, y, salt) {
        let h = (x * 374761393 + y * 668265263 + (salt || 0) * 2147483647) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    function parseColor(text) {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(text).trim());
        if (!m) return null;
        let h = m[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const n = [0, 2, 4, 6].map(i => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
        return n;
    }

    // A drawing is a text file: palette lines like "r = #c0392b", then rows of pixels ("." or a space is
    // see-through). Before the rows it may also say "speed: 300" (milliseconds per frame), "model: layers", or
    // "style: smooth" (in 3D its pixels are drawn smoothed, with rounded edges; "style: pixel" is the default).
    // A line "---" starts the next frame (an animation), or with "model: layers" the next layer up of a 3D model
    // (the first layer is the bottom; each layer is seen from above).
    // Returns {w, h, palette: {char: [r,g,b,a]}, rows (the first frame), frames: [rows...], frameMs, model, smooth?}.
    function parseDrawing(text, maxSize) {
        maxSize = maxSize || 128;
        // A drawing made of shapes instead of pixels (see parseShapes).
        if (/^\s*shapes\s*:/im.test(String(text).replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim() && !/^\s*(\/\/|#\s)/.test(l)) || '')) return parseShapes(text, maxSize);
        const palette = {};
        const frames = [[]];
        let frameMs = 300, model = false, smooth = false, started = false;
        for (const raw of String(text).replace(/\r/g, '').split('\n')) {
            const line = raw.replace(/\s+$/, '');
            if (!started) {
                const pm = /^\s*(\S)\s*[=:]\s*(#?[0-9a-fA-F]{3,8})\s*$/.exec(line);
                if (pm) {
                    const c = parseColor(pm[2]);
                    if (!c) throw new Error(`"${pm[2]}" is not a color. Use #rgb, #rrggbb or #rrggbbaa.`);
                    palette[pm[1]] = c;
                    continue;
                }
                const dm = /^\s*(speed|model|style)\s*:\s*(\S+)\s*$/i.exec(line);
                if (dm) {
                    if (dm[1].toLowerCase() === 'style') {
                        if (!/^(smooth|pixel)$/i.test(dm[2])) throw new Error('style is "pixel" (the default) or "smooth".');
                        smooth = /^smooth$/i.test(dm[2]);
                    } else if (dm[1].toLowerCase() === 'speed') {
                        const n = Number(dm[2]);
                        if (!(n >= 50 && n <= 5000)) throw new Error('speed is milliseconds per frame, from 50 to 5000.');
                        frameMs = n;
                    } else if (/^layers?$/i.test(dm[2])) model = true;
                    else throw new Error('The only kind of model is "model: layers".');
                    continue;
                }
                if (line.trim() === '' || line.trim().startsWith('//')) continue;
                started = true;
            }
            if (line.trim() === '---') { frames.push([]); continue; }
            frames[frames.length - 1].push(line);
        }
        for (const f of frames) while (f.length && f[f.length - 1].trim() === '') f.pop();
        while (frames.length > 1 && !frames[frames.length - 1].length) frames.pop();
        if (!frames[0].length) throw new Error('The drawing has no rows of pixels.');
        const most = model ? 32 : 16;
        if (frames.length > most) throw new Error(`The drawing has ${frames.length} ${model ? 'layers' : 'frames'}; the most is ${most}.`);
        const w = Math.max(...frames.map(f => Math.max(0, ...f.map(r => r.length))));
        const h = Math.max(...frames.map(f => f.length));
        if (w > maxSize || h > maxSize) throw new Error(`The drawing is ${w}x${h} pixels; the most is ${maxSize}x${maxSize}.`);
        for (const f of frames) for (const r of f) for (const ch of r) {
            if (ch !== '.' && ch !== ' ' && !palette[ch]) throw new Error(`The pixel "${ch}" has no color in the palette.`);
        }
        const padded = frames.map(f => { const rows = f.map(r => r.padEnd(w, '.')); while (rows.length < h) rows.push('.'.repeat(w)); return rows; });
        return { w, h, palette, rows: padded[0], frames: padded, frameMs, model, ...(smooth ? { smooth: true } : {}) };
    }

    // --- Smooth drawings ("style: smooth") ------------------------------------------------------------------
    // A pixel-art upscaler: Scale2x twice (each pixel becomes 4x4, and stair-step diagonals become straight or
    // rounded), then every 2x2 averaged, so the drawing comes out twice its size with soft, rounded edges. In 3D a
    // drawing is shown twice its size anyway, so it takes the same room as before. Returns {w, h, data (RGBA)}.
    const smoothCache = new WeakMap();
    function scale2x(g, w, h) {
        const out = new Array(w * h * 4), at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '.' : g[y * w + x]);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const P = g[y * w + x], A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1), o = (2 * y) * 2 * w + 2 * x;
            out[o] = C === A && C !== D && A !== B ? A : P;
            out[o + 1] = A === B && A !== C && B !== D ? B : P;
            out[o + 2 * w] = D === C && D !== B && C !== A ? C : P;
            out[o + 2 * w + 1] = B === D && B !== A && D !== C ? D : P;
        }
        return out;
    }
    // k: how many picture pixels per drawing pixel (2, 4 or 8; 2 by default, as in 3D at the usual resolution).
    function smoothFrame(d, frame, k) {
        k = k || 2;
        let byFrame = smoothCache.get(d);
        if (!byFrame) smoothCache.set(d, byFrame = {});
        const frames = d.frames || [d.rows], f = (frame || 0) % frames.length, key = f + ':' + k;
        if (byFrame[key]) return byFrame[key];
        const rows = frames[f], g = [];
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { const ch = rows[y][x]; g.push(d.palette[ch] ? ch : '.'); }
        // Scale2x until it is twice the size wanted, then every 2x2 averaged.
        let big = g, bw = d.w, bh = d.h;
        while (bw < d.w * k * 2) { big = scale2x(big, bw, bh); bw *= 2; bh *= 2; }
        const w = d.w * k, h = d.h * k;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let r = 0, gg = 0, b = 0, a = 0;
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const c = d.palette[big[(2 * y + dy) * bw + 2 * x + dx]];
                if (!c) continue;
                const ca = c[3] / 255;
                r += c[0] * ca; gg += c[1] * ca; b += c[2] * ca; a += ca;
            }
            const i = (y * w + x) * 4;
            if (a > 0) { data[i] = r / a; data[i + 1] = gg / a; data[i + 2] = b / a; data[i + 3] = Math.round(255 * a / 4); }
        }
        return (byFrame[key] = { w, h, data });
    }

    // --- Drawings made of shapes -------------------------------------------------------------------------------
    // A drawing that starts with "shapes: WxH" is made of shapes instead of pixel rows, drawn smooth at any size:
    //   shapes: 32x48               its size in drawing pixels (as a pixel drawing's; up to 128x128)
    //   outline: #2a1e2e 1          (optional) every filled shape gets this outline; "outline: none"
    //   skin = #f3d2b8              (optional) a named color
    //   speed: 300                  (optional) and "---" between frames, as for pixel drawings
    //   then one shape per line, later lines on top:
    //   circle X Y R | ellipse X Y RX RY | rect X Y W H | poly x,y x,y ... | blob x,y x,y ... (a smooth closed curve
    //   through the points) | curve x,y x,y ... (a smooth open line) | line x,y x,y ... |
    //   path M x,y L x,y Q x,y x,y C x,y x,y x,y Z
    //   and after it: fill COLOR [to COLOR] (a gradient, top to bottom), stroke COLOR [WIDTH] | stroke none,
    //   turn DEGREES (ellipse, rect), round R (rect), mirror (drawn again, mirrored left to right).
    // Our own code reads and draws it; it is only data.
    const SHAPE_KINDS = ['circle', 'ellipse', 'rect', 'poly', 'blob', 'curve', 'line', 'path'];
    function parseShapes(text, maxSize) {
        const names = {}, frames = [[]];
        let w = 0, h = 0, frameMs = 300, outline = null;
        const color = (tok, n) => {
            const c = names[String(tok).toLowerCase()] || parseColor(tok);
            if (!c) throw new Error(`Line ${n}: "${tok}" is not a color (use #rgb, #rrggbb, #rrggbbaa or a color named before, like "skin = #f3d2b8").`);
            return c;
        };
        const num = (tok, n, what) => {
            const v = Number(tok);
            if (!Number.isFinite(v)) throw new Error(`Line ${n}: "${tok}" should be a number (${what}).`);
            return v;
        };
        const point = (tok, n) => {
            const m = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(tok);
            if (!m) throw new Error(`Line ${n}: "${tok}" should be a point like 12,30.`);
            return [Number(m[1]), Number(m[2])];
        };
        String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n').forEach((raw, i) => {
            const n = i + 1, line = raw.replace(/\s(\/\/|#)\s.*$/, '').trim();
            if (!line || line.startsWith('//') || /^#\s/.test(line)) return;
            let m = /^shapes\s*:\s*(\d+)\s*[x×]\s*(\d+)$/i.exec(line);
            if (m) {
                w = Number(m[1]); h = Number(m[2]);
                if (!(w >= 1 && h >= 1 && w <= maxSize && h <= maxSize)) throw new Error(`Line ${n}: the size is ${w}x${h}; it can be from 1x1 to ${maxSize}x${maxSize}.`);
                return;
            }
            if (/^shapes\s*:/i.test(line)) throw new Error(`Line ${n}: write the size like "shapes: 32x48".`);
            if (!w) throw new Error('A drawing made of shapes starts with its size, like "shapes: 32x48".');
            if ((m = /^speed\s*:\s*(\S+)$/i.exec(line))) {
                const v = Number(m[1]);
                if (!(v >= 50 && v <= 5000)) throw new Error(`Line ${n}: speed is milliseconds per frame, from 50 to 5000.`);
                frameMs = v; return;
            }
            if ((m = /^outline\s*:\s*(.+)$/i.exec(line))) {
                const t = m[1].trim().split(/\s+/);
                outline = /^none$/i.test(t[0]) ? null : { c: color(t[0], n), w: t[1] != null ? num(t[1], n, 'the outline width') : 1 };
                return;
            }
            if ((m = /^([a-z][\w-]{0,30})\s*=\s*(#?[0-9a-f]{3,8})$/i.exec(line)) && !SHAPE_KINDS.includes(m[1].toLowerCase())) { names[m[1].toLowerCase()] = color(m[2], n); return; }
            if (line === '---') { frames.push([]); return; }
            const t = line.split(/\s+/), kind = t[0].toLowerCase();
            if (!SHAPE_KINDS.includes(kind)) throw new Error(`Line ${n}: "${t[0]}" isn't a shape. Shapes: ${SHAPE_KINDS.join(', ')}.`);
            const sh = { kind };
            let k = 1;
            const KEY = /^(fill|stroke|turn|round|mirror|width)$/i;
            if (kind === 'circle' || kind === 'ellipse' || kind === 'rect') {
                const count = kind === 'circle' ? 3 : 4, what = { circle: 'x y r', ellipse: 'x y rx ry', rect: 'x y width height' }[kind];
                if (t.length < 1 + count) throw new Error(`Line ${n}: ${kind} needs ${what}, like "${{ circle: 'circle 16 20 6', ellipse: 'ellipse 16 20 8 5', rect: 'rect 4 10 24 12' }[kind]}".`);
                sh.a = t.slice(1, 1 + count).map(v => num(v, n, what));
                k = 1 + count;
            } else if (kind === 'path') {
                sh.d = [];
                while (k < t.length && !KEY.test(t[k])) {
                    const c = t[k].toUpperCase(), need = { M: 1, L: 1, Q: 2, C: 3, Z: 0 }[c];
                    if (need == null) throw new Error(`Line ${n}: in a path, "${t[k]}" should be M, L, Q, C or Z (each followed by its points).`);
                    const pts = [];
                    for (let j = 1; j <= need; j++) pts.push(point(t[k + j] || '', n));
                    sh.d.push([c, ...pts]); k += need + 1;
                }
                if (!sh.d.length || sh.d[0][0] !== 'M') throw new Error(`Line ${n}: a path starts with M x,y.`);
            } else {
                sh.p = [];
                while (k < t.length && !KEY.test(t[k])) sh.p.push(point(t[k++], n));
                const least = kind === 'line' || kind === 'curve' ? 2 : 3;
                if (sh.p.length < least) throw new Error(`Line ${n}: ${kind} needs at least ${least} points, like "${kind} 4,4 12,8 20,4".`);
                if (sh.p.length > 200) throw new Error(`Line ${n}: at most 200 points in a shape.`);
            }
            const open = kind === 'line' || kind === 'curve';
            while (k < t.length) {
                const key = t[k].toLowerCase();
                if (key === 'fill') {
                    if (open) throw new Error(`Line ${n}: a ${kind} is a line, so it has a stroke, not a fill (use blob or poly for a filled shape).`);
                    sh.fill = [color(t[k + 1] || '', n)];
                    k += 2;
                    if ((t[k] || '').toLowerCase() === 'to') { sh.fill.push(color(t[k + 1] || '', n)); k += 2; }
                } else if (key === 'stroke') {
                    if (/^none$/i.test(t[k + 1] || '')) { sh.stroke = false; k += 2; continue; }
                    sh.stroke = { c: color(t[k + 1] || '', n), w: 1 };
                    k += 2;
                    if (t[k] != null && !KEY.test(t[k])) sh.stroke.w = num(t[k++], n, 'the stroke width');
                } else if (key === 'width') { sh.width = num(t[k + 1], n, 'the width'); k += 2; }
                else if (key === 'turn') { sh.turn = num(t[k + 1], n, 'degrees'); k += 2; }
                else if (key === 'round') { sh.round = num(t[k + 1], n, 'the corner radius'); k += 2; }
                else if (key === 'mirror') { sh.mirror = true; k += 1; }
                else throw new Error(`Line ${n}: "${t[k]}" isn't something a shape can have (fill, stroke, turn, round, mirror, width).`);
            }
            if (sh.width != null) sh.stroke = { ...(sh.stroke || { c: [34, 28, 40, 255] }), w: sh.width };
            if (open && !sh.stroke) sh.stroke = { c: (outline && outline.c) || [34, 28, 40, 255], w: (outline && outline.w) || 1 };
            if (!open && !sh.fill && !sh.stroke) sh.fill = [[0, 0, 0, 255]];
            if (!open && sh.stroke == null && outline) sh.stroke = outline;
            if (sh.stroke === false) delete sh.stroke;
            if (sh.stroke && !(sh.stroke.w > 0 && sh.stroke.w <= 16)) throw new Error(`Line ${n}: a stroke is from 0.1 to 16 pixels wide.`);
            const f = frames[frames.length - 1];
            if (f.length >= 300) throw new Error(`Line ${n}: at most 300 shapes in a frame.`);
            f.push(sh);
        });
        while (frames.length > 1 && !frames[frames.length - 1].length) frames.pop();
        if (!w) throw new Error('A drawing made of shapes starts with its size, like "shapes: 32x48".');
        if (!frames[0].length) throw new Error('The drawing has no shapes yet.');
        if (frames.length > 16) throw new Error(`The drawing has ${frames.length} frames; the most is 16.`);
        return { w, h, vector: true, frames, frameMs, palette: {}, rows: [] };
    }

    // A shape as closed outlines (for filling) and lines (for its stroke), in drawing pixels.
    function shapeGeometry(sh, W) {
        const rot = (pts, cx, cy, deg) => {
            if (!deg) return pts;
            const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
            return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
        };
        const ellipse = (cx, cy, rx, ry) => {
            const n = Math.max(24, Math.ceil(Math.PI * (Math.abs(rx) + Math.abs(ry)) * 2));
            return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos(2 * Math.PI * i / n), cy + ry * Math.sin(2 * Math.PI * i / n)]);
        };
        const spline = (p, closed) => {
            const out = [], n = p.length, at = i => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
            for (let i = 0; i < (closed ? n : n - 1); i++) {
                const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), steps = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2));
                for (let s = 0; s < steps; s++) {
                    const t = s / steps, t2 = t * t, t3 = t2 * t;
                    out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
                }
            }
            if (!closed) out.push(p[n - 1]);
            return out;
        };
        let fills = [], lines = [];
        const a = sh.a;
        if (sh.kind === 'circle') fills = [ellipse(a[0], a[1], a[2], a[2])];
        else if (sh.kind === 'ellipse') fills = [rot(ellipse(a[0], a[1], a[2], a[3]), a[0], a[1], sh.turn)];
        else if (sh.kind === 'rect') {
            const [x, y, w, h] = a, r = Math.max(0, Math.min(sh.round || 0, Math.abs(w) / 2, Math.abs(h) / 2)), pts = [];
            if (!r) pts.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
            else for (const [cx, cy, a0] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]])
                for (let i = 0; i <= 8; i++) { const ang = (a0 + i * 90 / 8) * Math.PI / 180; pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]); }
            fills = [rot(pts, x + w / 2, y + h / 2, sh.turn)];
        } else if (sh.kind === 'poly') fills = [sh.p];
        else if (sh.kind === 'blob') fills = [spline(sh.p, true)];
        else if (sh.kind === 'line') lines = [sh.p];
        else if (sh.kind === 'curve') lines = [spline(sh.p, false)];
        else if (sh.kind === 'path') {
            let cur = null, start = null;
            const bez = (pts, steps) => { for (let s = 1; s <= steps; s++) { const t = s / steps; cur.push(pts.length === 3
                ? [0, 1].map(j => (1 - t) ** 2 * pts[0][j] + 2 * (1 - t) * t * pts[1][j] + t * t * pts[2][j])
                : [0, 1].map(j => (1 - t) ** 3 * pts[0][j] + 3 * (1 - t) ** 2 * t * pts[1][j] + 3 * (1 - t) * t * t * pts[2][j] + t ** 3 * pts[3][j])); } };
            for (const [c, ...pts] of sh.d) {
                const last = cur && cur[cur.length - 1];
                if (c === 'M') { cur = [pts[0]]; start = pts[0]; fills.push(cur); }
                else if (c === 'L') cur.push(pts[0]);
                else if (c === 'Q') bez([last, ...pts], 16);
                else if (c === 'C') bez([last, ...pts], 24);
                else if (c === 'Z' && start) cur.push(start);
            }
        }
        if (sh.mirror) {
            const flip = poly => poly.map(([x, y]) => [W - x, y]).reverse();
            fills = fills.concat(fills.map(flip)); lines = lines.concat(lines.map(flip));
        }
        // A filled shape's stroke goes around its outline.
        const strokes = lines.length ? lines.map(l => ({ pts: l, closed: false })) : fills.map(f => ({ pts: f, closed: true }));
        return { fills, strokes };
    }

    // A stroke as filled outlines: a band along each segment and a round joint at each point (all turning the same
    // way, so together they fill as one).
    function strokeOutlines(line, closed, width) {
        const out = [], r = width / 2, pts = closed ? line.concat([line[0]]) : line;
        const ccw = poly => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a < 0 ? poly.reverse() : poly; };
        for (let i = 0; i + 1 < pts.length; i++) {
            const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
            if (len < 1e-6) continue;
            const nx = -(y1 - y0) / len * r, ny = (x1 - x0) / len * r;
            out.push(ccw([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]));
        }
        const m = Math.max(8, Math.ceil(r * 6));
        for (const [x, y] of pts) out.push(ccw(Array.from({ length: m }, (_, i) => [x + r * Math.cos(2 * Math.PI * i / m), y + r * Math.sin(2 * Math.PI * i / m)])));
        return out;
    }

    // How much of each pixel the outlines cover (0 to 1, smooth edges), nonzero rule, scaled by k, into cov (W x H).
    function coverage(polys, k, W, H, cov) {
        const edges = [];
        let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
        for (const poly of polys) for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], ay = a[1] * k, by = b[1] * k;
            if (ay === by) continue;
            edges.push([a[0] * k, ay, b[0] * k, by]);
            y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by); x0 = Math.min(x0, a[0] * k, b[0] * k); x1 = Math.max(x1, a[0] * k, b[0] * k);
        }
        const box = { x0: Math.max(0, Math.floor(x0)), x1: Math.min(W - 1, Math.ceil(x1)), y0: Math.max(0, Math.floor(y0)), y1: Math.min(H - 1, Math.ceil(y1)) };
        const S = 4, xs = [];
        for (let py = box.y0; py <= box.y1; py++) for (let s = 0; s < S; s++) {
            const y = py + (s + 0.5) / S;
            xs.length = 0;
            for (const [ax, ay, bx, by] of edges) if ((y >= ay && y < by) || (y >= by && y < ay)) xs.push([ax + (y - ay) * (bx - ax) / (by - ay), by > ay ? 1 : -1]);
            xs.sort((p, q) => p[0] - q[0]);
            let wind = 0;
            for (let i = 0; i < xs.length - 1; i++) {
                wind += xs[i][1];
                if (!wind) continue;
                const xa = Math.max(0, xs[i][0]), xb = Math.min(W, xs[i + 1][0]);
                for (let px = Math.floor(xa); px < xb && px < W; px++) cov[py * W + px] += (Math.min(px + 1, xb) - Math.max(px, xa)) / S;
            }
        }
        return box;
    }

    // A frame of a drawing made of shapes, drawn at k picture pixels per drawing pixel: {w, h, data (RGBA)}.
    const shapeCache = new WeakMap();
    function rasterShapes(d, frame, k) {
        let byKey = shapeCache.get(d);
        if (!byKey) shapeCache.set(d, byKey = {});
        const f = (frame || 0) % d.frames.length, key = f + ':' + k;
        if (byKey[key]) return byKey[key];
        const W = Math.round(d.w * k), H = Math.round(d.h * k), data = new Float32Array(W * H * 4), cov = new Float32Array(W * H);
        const paint = (box, c0, c1, top, bottom) => {
            for (let y = box.y0; y <= box.y1; y++) {
                const t = c1 ? Math.max(0, Math.min(1, ((y + 0.5) / k - top) / Math.max(1e-6, bottom - top))) : 0;
                const c = c1 ? [0, 1, 2, 3].map(j => c0[j] + (c1[j] - c0[j]) * t) : c0;
                for (let x = box.x0; x <= box.x1; x++) {
                    const p = y * W + x, a = Math.min(1, cov[p]) * c[3] / 255;
                    cov[p] = 0;
                    if (a <= 0) continue;
                    const i = p * 4, keep = 1 - a;  // "over", with premultiplied color
                    data[i] = c[0] * a + data[i] * keep; data[i + 1] = c[1] * a + data[i + 1] * keep; data[i + 2] = c[2] * a + data[i + 2] * keep; data[i + 3] = a + data[i + 3] * keep;
                }
            }
        };
        for (const sh of d.frames[f]) {
            const g = shapeGeometry(sh, d.w);
            if (sh.fill && g.fills.length) {
                let top = Infinity, bottom = -Infinity;
                for (const poly of g.fills) for (const [, y] of poly) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
                // Each mirrored half is filled on its own (they may overlap).
                const halves = sh.mirror ? [g.fills.slice(0, g.fills.length / 2), g.fills.slice(g.fills.length / 2)] : [g.fills];
                for (const part of halves) paint(coverage(part, k, W, H, cov), sh.fill[0], sh.fill[1], top, bottom);
            }
            if (sh.stroke) for (const st of g.strokes) paint(coverage(strokeOutlines(st.pts, st.closed, sh.stroke.w), k, W, H, cov), sh.stroke.c);
        }
        const out = new Uint8ClampedArray(W * H * 4);
        for (let p = 0; p < W * H; p++) {
            const i = p * 4, a = data[i + 3];
            if (a <= 0) continue;
            out[i] = data[i] / a; out[i + 1] = data[i + 1] / a; out[i + 2] = data[i + 2] / a; out[i + 3] = Math.round(a * 255);
        }
        return (byKey[key] = { w: W, h: H, data: out });
    }

    // Draw a picture {w, h, data} into img at (x0, y0).
    function blit(img, pic, x0, y0) {
        for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
            const i = (y * pic.w + x) * 4;
            if (pic.data[i + 3]) blend(img, x0 + x, y0 + y, [pic.data[i], pic.data[i + 1], pic.data[i + 2], pic.data[i + 3]]);
        }
    }

    // Which frame of a drawing shows at time t (milliseconds).
    function frameOf(d, t) {
        return d.frames && d.frames.length > 1 && !d.model ? Math.floor((t || 0) / (d.frameMs || 300)) % d.frames.length : 0;
    }

    function blend(img, x, y, c) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height || c[3] === 0) return;
        const i = (y * img.width + x) * 4, d = img.data, a = c[3] / 255;
        if (img.ink && c[3] >= 128) { img.ink.id[i >> 2] = img.ink.cur; img.ink.near[i >> 2] = img.ink.curNear; }
        d[i] = Math.round(c[0] * a + d[i] * (1 - a));
        d[i + 1] = Math.round(c[1] * a + d[i + 1] * (1 - a));
        d[i + 2] = Math.round(c[2] * a + d[i + 2] * (1 - a));
        d[i + 3] = 255;
    }

    // --- Ink: the hand-drawn outlines ---------------------------------------------------------------------
    // While a picture is drawn, each solid pixel remembers which surface it belongs to (one plane of ground, one wall
    // of one color, one drawing) and how near it is. Afterwards a dark line goes around everything that stands in
    // front of something else, like the ink lines of a cartoon. Painted ground has no lines inside it.
    const INK = [58, 42, 58];  // the same dark plum as the outlines of the drawings made of shapes
    function inkStart(img) {
        const n = img.width * img.height;
        img.ink = { id: new Int32Array(n), near: new Int32Array(n), keys: new Map(), cur: 0, curNear: 0, count: 0, ids: 0 };
    }
    // What is drawn next belongs to surface `key` (null: a surface of its own), `near` (default: drawn later = nearer).
    function pen(img, key, near) {
        const k = img.ink;
        if (!k) return;
        let id = key == null ? null : k.keys.get(key);
        if (id == null) { id = ++k.ids; if (key != null) k.keys.set(key, id); }
        k.cur = id; k.curNear = near != null ? near : ++k.count;
    }
    // What is drawn next is part of the background (the open sea): no lines between it and the sky's sea.
    function penBackground(img) { if (img.ink) { img.ink.cur = 0; img.ink.curNear = 0; } }
    function inkFinish(img) {
        const k = img.ink;
        if (!k) return;
        delete img.ink;
        const w = img.width, h = img.height, d = img.data, line = new Uint8Array(w * h), R = img.res || 1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const p = y * w + x;
            // Lines are one picture pixel wide at any resolution (img.res pixels).
            const id = k.id[p], near = k.near[p], is = q => k.id[q] !== id && k.near[q] > near;
            for (let r = 1; r <= R; r++) {
                if ((x >= r && is(p - r)) || (x < w - r && is(p + r)) || (y >= r && is(p - r * w)) || (y < h - r && is(p + r * w))) { line[p] = 1; break; }
            }
        }
        for (let p = 0; p < w * h; p++) if (line[p]) {
            const i = p * 4;
            d[i] = Math.round(d[i] * 0.1 + INK[0] * 0.9); d[i + 1] = Math.round(d[i + 1] * 0.1 + INK[1] * 0.9); d[i + 2] = Math.round(d[i + 2] * 0.1 + INK[2] * 0.9); d[i + 3] = 255;
        }
    }

    // Cel shading: the side facing the light (south, drawn on the left) a step darker, the side away from it (east)
    // in a cool shadow, the way shadows are painted in cartoons.
    function cel(c, side) {
        if (side === 'lit') return [c[0] * 0.84, c[1] * 0.84, c[2] * 0.86, 255];
        return [c[0] * 0.6 * 0.8 + 66 * 0.2, c[1] * 0.6 * 0.8 + 70 * 0.2, c[2] * 0.62 * 0.8 + 150 * 0.2, 255];
    }

    // Seen from above. A 3D model shows its layers stacked (the top layer wins).
    function drawDrawing(img, drawing, px, py, frame) {
        if (drawing.vector) return blit(img, rasterShapes(drawing, frame, 1), px, py);
        const layers = drawing.model ? drawing.frames : [drawing.frames ? drawing.frames[(frame || 0) % drawing.frames.length] : drawing.rows];
        for (const rows of layers) for (let y = 0; y < drawing.h; y++) {
            const row = rows[y];
            for (let x = 0; x < drawing.w; x++) {
                const c = drawing.palette[row[x]];
                if (c) blend(img, px + x, py + y, c);
            }
        }
    }

    // A 3D model seen from the front (from the south): for each layer and column, the nearest colored block.
    // Bodies made as models show like this when seen flat; the top layer is the top row.
    function frontView(d) {
        if (!d.model) return d;
        const rows = [];
        for (let l = d.frames.length - 1; l >= 0; l--) {
            let row = '';
            for (let x = 0; x < d.w; x++) {
                let ch = '.';
                for (let y = d.h - 1; y >= 0; y--) if (d.palette[d.frames[l][y][x]]) { ch = d.frames[l][y][x]; break; }
                row += ch;
            }
            rows.push(row);
        }
        return { w: d.w, h: rows.length, palette: d.palette, rows, frames: [rows], frameMs: d.frameMs, model: false };
    }

    // Where a body drawing goes so that its feet stand on tile (tx, ty).
    function bodyOrigin(drawing, tx, ty) {
        return [tx * TILE + Math.floor(TILE / 2) - Math.floor(drawing.w / 2), ty * TILE + TILE - drawing.h];
    }

    function isLand(map, x, y) {
        return y >= 0 && y < map.h && x >= 0 && x < map.w && map.land[y][x] === '#';
    }

    function inWorld(map, x, y) {
        return x >= 0 && y >= 0 && x < map.w && y < map.h;
    }

    // How high the ground is: land from 1 to 8 (shaped with the "shape" tool), the sea 0.
    function heightAt(world, x, y) {
        if (!isLand(world.map, x, y)) return 0;
        const h = world.height && world.height[x + ',' + y];
        return h ? Math.max(1, Math.min(MAX_HEIGHT, h)) : 1;
    }

    // --- Things that move ---------------------------------------------------------------------------------
    // A placed thing may have moves: {kind: still|wander|circle|bob|sway, n}. Where it is at time t is worked
    // out from the time alone, so live and replays always show the same.
    function isAnimated(t) {
        const d = t.drawing;
        return Boolean((d.frames && d.frames.length > 1 && !d.model) || (t.moves && t.moves.kind && t.moves.kind !== 'still'));
    }

    function sameGround(world, ax, ay, bx, by) {
        if (!inWorld(world.map, bx, by)) return false;
        const p = world.paint || {};
        return isLand(world.map, ax, ay) === isLand(world.map, bx, by) && (p[ax + ',' + ay] || '') === (p[bx + ',' + by] || '');
    }

    // The spot a wandering thing heads for during its k-th stretch: near home, on the same kind of ground.
    function wanderSpot(t, k, world) {
        const n = Math.max(1, Math.min(8, t.moves.n || 2));
        for (let i = 0; i < 12; i++) {
            const ox = Math.floor(hash(t.id || 0, k * 12 + i, 5) * (2 * n + 1)) - n;
            const oy = Math.floor(hash(t.id || 0, k * 12 + i, 6) * (2 * n + 1)) - n;
            if (sameGround(world, t.x, t.y, t.x + ox, t.y + oy)) return [ox, oy];
        }
        return [0, 0];
    }

    // How far (in pixels, seen from above) a thing has moved from where it was placed, at time t (ms).
    function motion(t, time, world) {
        const m = t.moves;
        if (!m || !m.kind || m.kind === 'still') return { dx: 0, dy: 0 };
        const s = (t.id || 0) * 7.13, sec = (time || 0) / 1000, n = Math.max(1, Math.min(8, m.n || 1));
        if (m.kind === 'bob') return { dx: 0, dy: Math.round(Math.sin(sec * 2 + s) * 2) };
        if (m.kind === 'sway') return { dx: Math.round(Math.sin(sec * 1.3 + s) * 2), dy: 0 };
        if (m.kind === 'circle') {
            const a = sec * (0.8 / n) + s;
            return { dx: Math.round(Math.cos(a) * n * TILE), dy: Math.round(Math.sin(a) * n * TILE) };
        }
        if (m.kind === 'wander') {
            const seg = 4, k = Math.floor(sec / seg), f0 = (sec % seg) / seg, f = f0 * f0 * (3 - 2 * f0);
            const a = wanderSpot(t, k, world), b = wanderSpot(t, k + 1, world);
            return { dx: Math.round((a[0] + (b[0] - a[0]) * f) * TILE), dy: Math.round((a[1] + (b[1] - a[1]) * f) * TILE) };
        }
        if (m.kind === 'path' && m.points && m.points.length > 1) {
            const [px, py] = pathPoint(m.points, sec);
            return { dx: Math.round((px - t.x) * TILE), dy: Math.round((py - t.y) * TILE) };
        }
        return { dx: 0, dy: 0 };
    }

    // Where a thing on a path is after sec seconds: along the points and back again, a step a second.
    function pathPoint(points, sec) {
        const legs = [];
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            const len = Math.max(1, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
            legs.push(len); total += len;
        }
        let d = sec % (2 * total);
        if (d > total) d = 2 * total - d;
        for (let i = 0; i < legs.length; i++) {
            if (d <= legs[i] || i === legs.length - 1) {
                const f = Math.min(1, d / legs[i]), a = points[i], b = points[i + 1];
                return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            }
            d -= legs[i];
        }
        return points[0];
    }

    // The level a thing stands at while it moves: its own level if it was placed on blocks, the ground under it
    // as it goes along a path, otherwise the ground of its own spot.
    function movingLevel(world, t, m) {
        if (t.z != null) return t.z;
        if (t.moves && t.moves.kind === 'path') return heightAt(world, Math.round(t.x + m.dx / TILE), Math.round(t.y + m.dy / TILE));
        return heightAt(world, t.x, t.y);
    }

    // --- Ground colors --------------------------------------------------------------------------------------
    const colorCache = {};
    const painted = c => colorCache[c] || (colorCache[c] = parseColor(c));

    // The color of pixel (px, py) of tile (wx, wy), seen from above. Higher ground is a little lighter.
    // Clean, like the drawings made of shapes: even colors with a very soft shading, and the sea lighter in the shallows.
    function groundColor(world, wx, wy, px, py) {
        if (!inWorld(world.map, wx, wy)) return DEEP;
        const land = isLand(world.map, wx, wy);
        const p = world.paint && world.paint[wx + ',' + wy];
        let c;
        if (p) c = painted(p);
        else if (land) c = DIRT;
        else {
            // Bands of lighter water that follow the shore, with rounded edges.
            // (from the same soft blend of land and sea that rounds the coast, so the bands follow it)
            const f = shoreDistance(world.map)[wy * world.map.w + wx] <= 2 ? landField(world.map, wx + (px + 0.5) / TILE, wy + (py + 0.5) / TILE) : 0;
            c = f > 0.2 ? [80, 172, 202] : f > 0.03 ? [60, 140, 192] : SEA;
            const wave = py % 8 === 3 && hash(wx, wy * 8 + Math.floor(py / 8), 3) > 0.7 && px > 3 && px < 9;
            if (wave) c = [c[0] * 0.6 + 170 * 0.4, c[1] * 0.6 + 214 * 0.4, c[2] * 0.6 + 240 * 0.4];
        }
        if (land) {
            // Even color with a very soft, wide shading (the clean style of the drawings made of shapes).
            const fx = wx + (px + 0.5) / TILE, fy = wy + (py + 0.5) / TILE, f = 0.97 + 0.06 * smoothNoise(fx * 0.45, fy * 0.45) + 0.03 * Math.sin((fx + fy) * 0.35);
            c = [c[0] * f, c[1] * f, c[2] * f];
        }
        const h = land ? heightAt(world, wx, wy) : 0;
        if (h > 1) { const f = 1 + (h - 1) * 0.06; c = [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]; }
        return vivid(c);
    }

    // Smooth noise from 0 to 1 (for soft light on the land).
    function smoothNoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, s = t => t * t * (3 - 2 * t);
        const a = hash(ix, iy, 50), b = hash(ix + 1, iy, 50), c = hash(ix, iy + 1, 50), d = hash(ix + 1, iy + 1, 50);
        return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
    }

    // The environment's colors shown vivid and bright, like the drawings made of shapes: more saturated and a little
    // lighter, the hue unchanged (their paint keeps its color; only the way the island shows it).
    function vivid(c) {
        const m = (c[0] + c[1] + c[2]) / 3, s = 1.22, l = 1.05;
        return [0, 1, 2].map(i => Math.max(0, Math.min(255, (m + (c[i] - m) * s) * l))).concat(c.length > 3 ? [c[3]] : []);
    }

    // A step's own color, plain: its paint or bare earth, a little lighter the higher it is.
    function baseColor(world, x, y) {
        const p = world.paint && world.paint[x + ',' + y];
        let c = p ? painted(p) : isLand(world.map, x, y) ? DIRT : SEA;
        const h = heightAt(world, x, y);
        if (h > 1) { const f = 1 + (h - 1) * 0.06; c = [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]; }
        return vivid(c);
    }

    // How far each sea step is from land (1 next to it, up to 3), worked out once per map.
    const shoreCache = new WeakMap();
    function shoreDistance(map) {
        if (shoreCache.has(map)) return shoreCache.get(map);
        const d = new Uint8Array(map.w * map.h);
        for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
            if (isLand(map, x, y)) continue;
            let best = 9;
            for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isLand(map, x + dx, y + dy)) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
            d[y * map.w + x] = best;
        }
        shoreCache.set(map, d);
        return d;
    }

    // --- Seen from above ------------------------------------------------------------------------------------
    // Render tiles [x0, x0+tw) x [y0, y0+th) of the world into an RGBA image.
    // world: {map, paint, height, things, blocks}; opts.bodies = [{x, y, drawing, frame}] (or opts.body) draws them too;
    // opts.t is the time for animations (ms); opts.skipAnimated leaves out moving and animated things
    // (or opts.skip(thing) decides which to leave out); opts.cut leaves out blocks from that level up.
    function render(world, x0, y0, tw, th, opts) {
        opts = opts || {};
        const width = tw * TILE, height = th * TILE;
        const img = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        const d = img.data;
        inkStart(img);
        for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
            const wx = x0 + tx, wy = y0 + ty, h = inWorld(world.map, wx, wy) ? heightAt(world, wx, wy) : 0;
            // Ground of one height is one surface: lines only where the land steps up or meets the sea.
            pen(img, 'g' + h + ((world.paint && world.paint[wx + ',' + wy]) || ''), h);
            for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
                const c = groundColor(world, wx, wy, px, py);
                const i = ((ty * TILE + py) * width + tx * TILE + px) * 4;
                d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
                img.ink.id[i >> 2] = img.ink.cur; img.ink.near[i >> 2] = h;
            }
        }
        const tops = flatBlocks(img, world, x0, y0, tw, th, opts.cut);
        img.ink.count = 1000;  // things and bodies stand in front of ground and blocks
        const skip = opts.skip || (opts.skipAnimated ? isAnimated : null);
        for (const t of world.things || []) {
            const anim = isAnimated(t);
            if (skip && skip(t)) continue;
            // Under a roof or inside a wall: seen from above, the blocks hide it.
            const top = tops[t.x + ',' + t.y];
            if (top != null && top >= levelOf(world, t)) continue;
            const m = anim ? motion(t, opts.t, world) : { dx: 0, dy: 0 };
            const px = t.px + m.dx - x0 * TILE, py = t.py + m.dy - y0 * TILE;
            if (px >= width || py >= height || px + t.drawing.w <= 0 || py + t.drawing.h <= 0) continue;
            flatShadow(img, px + t.drawing.w / 2, py + t.drawing.h - 1, t.drawing.w);
            pen(img, null);
            drawDrawing(img, t.drawing, px, py, frameOf(t.drawing, opts.t));
        }
        for (const b of opts.bodies || (opts.body ? [opts.body] : [])) {
            const d = frontView(b.drawing), [bx, by] = bodyOrigin(d, b.x, b.y);
            flatShadow(img, bx - x0 * TILE + d.w / 2, by - y0 * TILE + d.h - 1, d.w);
            pen(img, null);
            drawDrawing(img, d, bx - x0 * TILE, by - y0 * TILE, b.frame || 0);
        }
        inkFinish(img);
        return img;
    }

    // Seen from above: a small soft shadow at the feet of a drawing w pixels wide.
    function flatShadow(img, cx, cy, w) {
        const rx = Math.max(3, Math.min(9, w * 0.35)), ry = Math.max(1.5, rx * 0.35);
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
            const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (e < 1) blend(img, x, y, [52, 60, 132, Math.round(80 * (1 - e * e))]);
        }
    }

    // --- In 3D -------------------------------------------------------------------------------------------------
    // An isometric view: north-west at the top left. A tile is a 32x16 diamond, each height level 8 pixels.
    // Drawings stand upright on their spot (twice their size); "model: layers" drawings are built from blocks.
    // Returns the image plus ox/oy, so a point can be found with isoPoint(view, X, Y, z).
    function isoLayout(x0, y0, tw, th, margin, res) {
        const r = res || 1, width = (tw + th) * 16 * r, height = ((tw + th) * 8 + MAX_HEIGHT * LEVEL + margin) * r;
        return { width, height, ox: th * 16 * r, oy: (margin + MAX_HEIGHT * LEVEL) * r, x0, y0, res: r };
    }

    // Screen point of world position (X, Y) in tiles (fractions allowed) at z pixels up.
    function isoPoint(view, X, Y, z) {
        const x = X - view.x0, y = Y - view.y0, r = view.res || 1;
        return [(x - y) * 16 * r + view.ox, ((x + y) * 8 - (z || 0)) * r + view.oy];
    }

    // The sun is in the south-west: whatever stands taller there casts a shadow toward the north-east.
    // top(x, y): the highest level on a step (land or blocks).
    function inShadow(top, wx, wy, h) {
        for (let k = 1; k <= 4; k++) if (top(wx - k, wy + k) - h >= 2 * k - 1) return true;
        return false;
    }
    const SHADOW = [52, 60, 132];
    const inShade = c => [c[0] * 0.72 * 0.78 + SHADOW[0] * 0.22, c[1] * 0.72 * 0.78 + SHADOW[1] * 0.22, c[2] * 0.75 * 0.78 + SHADOW[2] * 0.22, 255];

    // One step of land or sea in 3D. Where land meets the sea the coast is drawn smooth, not as square steps: the
    // land is where a soft blend of the steps around (land 1, sea 0) is at least a half, so a straight coast stays
    // where it is, a staircase becomes a smooth line and corners are rounded. Every land step keeps a solid middle.
    // Only the picture: walking and building stay on whole steps.
    function landField(map, fx, fy) {
        const x = Math.floor(fx), y = Math.floor(fy);
        let s = 0, t = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const dx = fx - (x + i + 0.5), dy = fy - (y + j + 0.5), w = Math.exp(-2 * (dx * dx + dy * dy));
            t += w;
            if (isLand(map, x + i, y + j)) s += w;
        }
        return s / t;
    }
    const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

    // Where the drawn coast runs along the edge between sea step (x, y) and the land next to it in direction (dx, dy):
    // points [X, Y] (in steps) where the land field is a half, found along the edge's normal. For the foam.
    function coastLine(map, x, y, dx, dy) {
        const out = [];
        for (let k = 0; k <= 6; k++) {
            const t = k / 6, bx = dy ? x + t : dx < 0 ? x : x + 1, by = dx ? y + t : dy < 0 ? y : y + 1;
            const f = s => landField(map, bx + dx * s, by + dy * s);
            let lo = -0.6, hi = 0.6;
            if (f(hi) < 0.5 || f(lo) >= 0.5) continue;
            for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (f(mid) >= 0.5) hi = mid; else lo = mid; }
            out.push([bx + dx * hi, by + dy * hi]);
        }
        return out;
    }

    // The ground in 3D. Where two steps blend, the height at a point is a soft blend of them (the weighted median of
    // the heights around, nearer steps weighing more) and the paint that weighs most shows, so edges are rounded. Steps
    // blend where the land meets the sea (the island's own coast), and where they chose smooth edges (world.smooth,
    // set with paint or shape); what they made stays square otherwise. The middle of every step keeps the step's own
    // height and color, where things and bodies stand. Only the picture: walking and building stay on whole steps.
    const SOFT = 2;  // how soft the edges are (the blend's falloff)
    function stepsAround(world, wx, wy) {
        const steps = [];
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const x = wx + i, y = wy + j, inside = inWorld(world.map, x, y);
            steps.push({ x, y, i, j, h: inside ? heightAt(world, x, y) : 0, land: isLand(world.map, x, y), paint: (inside && world.paint && world.paint[x + ',' + y]) || '',
                smooth: Boolean(inside && world.smooth && world.smooth[x + ',' + y]) });
        }
        // Which of them blend with the middle one: the coast always, otherwise only where one of the two is smooth.
        const mid = steps[4];
        steps.forEach((t, k) => { t.blends = k === 4 || t.land !== mid.land || t.smooth || mid.smooth; });
        // From the highest down (for the median), and the steps grouped by height and paint (for the color).
        steps.order = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(k => steps[k].blends).sort((a, b) => steps[b].h - steps[a].h);
        const groups = {};
        steps.forEach((t, k) => { if (t.blends) (groups[t.h + '|' + t.paint] = groups[t.h + '|' + t.paint] || { h: t.h, members: [] }).members.push(k); });
        steps.groups = Object.values(groups);
        return steps;
    }
    // How much each of the 9 steps around weighs at (u, v) (texels, 0 to 16), summing to 1.
    function weightsAt(u, v, out) {
        let total = 0;
        for (let k = 0; k < 9; k++) {
            const dx = u / 16 - (k % 3 - 1 + 0.5), dy = v / 16 - (Math.floor(k / 3) - 1 + 0.5);
            total += out[k] = Math.exp(-SOFT * (dx * dx + dy * dy));
        }
        for (let k = 0; k < 9; k++) out[k] /= total;
        return out;
    }
    // At (u, v) of the step in the middle of `steps`: the index of the step around that shows there (its height, its
    // ground). The middle of a land step is always its own.
    function groundAt(steps, u, v, w) {
        if (steps[4].land && (u - 8) * (u - 8) + (v - 8) * (v - 8) < 36) return 4;
        let total = 0;
        for (const k of steps.order) total += w[k];
        let acc = 0, H = 0;
        for (const k of steps.order) { acc += w[k]; if (acc >= total / 2) { H = steps[k].h; break; } }
        let best = null, bestW = -1;
        for (const g of steps.groups) {
            if (g.h !== H) continue;
            let sum = 0;
            for (const k of g.members) sum += w[k];
            if (sum > bestW) { bestW = sum; best = g; }
        }
        let k0 = best.members[0];
        for (const k of best.members) if (w[k] > w[k0]) k0 = k;
        return k0;
    }
    const scratchW = new Float64Array(9);
    function heightField(world, fx, fy, cache) {
        const x = Math.floor(fx), y = Math.floor(fy), key = x + ',' + y;
        let steps = cache && cache.get(key);
        if (!steps) { steps = stepsAround(world, x, y); if (cache) cache.set(key, steps); }
        const u = (fx - x) * 16, v = (fy - y) * 16;
        return steps[groundAt(steps, u, v, weightsAt(u, v, scratchW))].h;
    }
    // How much of the blend around (fx, fy) is ground at height H or higher (0 to 1, smooth): for which way a cliff faces.
    function shareAtLeast(world, fx, fy, H, cache) {
        const x = Math.floor(fx), y = Math.floor(fy), key = x + ',' + y;
        let steps = cache && cache.get(key);
        if (!steps) { steps = stepsAround(world, x, y); if (cache) cache.set(key, steps); }
        const w = weightsAt((fx - x) * 16, (fy - y) * 16, scratchW);
        let s = 0;  // all the steps around (blending or not), so a square edge faces the way it does
        for (let k = 0; k < 9; k++) if (steps[k].h >= H) s += w[k];
        return s;
    }

    // The weights for every pixel of a step's diamond at resolution R, worked out once.
    const diamondCache = {};
    function diamondWeights(R) {
        if (diamondCache[R]) return diamondCache[R];
        const W = 32 * R, H = 16 * R, w = new Float64Array(W * (H + 1) * 9);
        for (let dy = 0; dy <= H; dy++) for (let dx = -16 * R; dx < 16 * R; dx++) {
            const u = (dy + dx / 2) / R, v = (dy - dx / 2) / R;
            weightsAt(u, v, w.subarray(((dy * W) + dx + 16 * R) * 9, ((dy * W) + dx + 16 * R) * 9 + 9));
        }
        return (diamondCache[R] = w);
    }

    // The ground at full resolution, in the clean style of the drawings made of shapes: even color with a very soft,
    // wide shading (lighter toward the north-west, where the light comes from), and on green ground a few small clean
    // tufts of grass. c: the step's own color; (fx, fy): where, in steps.
    function paintedGround(c, fx, fy, R) {
        let f = 0.97 + 0.06 * smoothNoise(fx * 0.45, fy * 0.45) + 0.03 * Math.sin((fx + fy) * 0.35);
        const grass = c[1] > c[0] * 1.05 && c[1] > c[2] * 1.05;
        if (grass) {
            // A tuft: two or three short blades in a fan, upright on the screen, a clean darker green.
            const cs = 3, gx = Math.floor(fx * cs), gy = Math.floor(fy * cs);
            if (hash(gx, gy, 71) < 0.35) {
                const ox = (gx + 0.25 + 0.5 * hash(gx, gy, 72)) / cs, oy = (gy + 0.25 + 0.5 * hash(gx, gy, 73)) / cs;
                for (const turn of [-0.45, 0, 0.45]) {
                    const ang = -Math.PI * 0.75 + turn, dx = Math.cos(ang), dy = Math.sin(ang), len = turn ? 0.07 : 0.1;
                    const px = fx - ox, py = fy - oy, along = px * dx + py * dy;
                    if (along < 0 || along > len) continue;
                    const across = Math.abs(px * -dy + py * dx), wide = 0.02 * (1 - along / len * 0.8);
                    if (across < wide) { f *= 0.78; break; }
                }
            }
        }
        return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f), 255];
    }
    // A cliff's color k pixels below its top edge, of a cliff t pixels tall (whole height to the sea, at resolution R): a
    // light rim where the light catches the edge, then a smooth gradient, lighter at the top and darker at the bottom.
    function cliffShade(c, k, t, R) {
        if (k <= R) return [c[0] * 0.7 + 255 * 0.3, c[1] * 0.7 + 245 * 0.3, c[2] * 0.7 + 230 * 0.3, 255];
        const f = 1.08 - 0.3 * Math.min(1, k / Math.max(1, t));
        return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f), 255];
    }

    function isoTile(img, view, world, wx, wy, top) {
        const R = view.res || 1, map = world.map;
        const stepCache = img.steps || (img.steps = new Map()), key = wx + ',' + wy;
        const steps = stepCache.get(key) || stepsAround(world, wx, wy), own = steps[4];
        stepCache.set(key, steps);
        const cache = img.tex || (img.tex = new Map());
        const texOf = t => {
            if (t.tex) return t.tex;
            const dark = top && t.h > 0 && inShadow(top, t.x, t.y, t.h), k = t.x + ',' + t.y + (dark ? 'd' : '');
            if (!cache.has(k)) {
                const tex = [];
                for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) { const c = groundColor(world, t.x, t.y, u, v); tex.push(dark ? inShade(c) : [c[0], c[1], c[2], 255]); }
                cache.set(k, tex);
            }
            return (t.tex = cache.get(k));
        };
        const [sx, sy0] = isoPoint(view, wx, wy, 0).map(Math.round);
        const uniform = steps.every(t => !t.blends || (t.h === own.h && t.paint === own.paint && t.land === own.land));
        // The color at (u, v) of this step, shown by step t: its ground, or the sea with its shallows.
        const shore = shoreDistance(map)[wy * map.w + wx] <= 2 || isLand(map, wx, wy);
        const colorAt = (t, u, v) => {
            if (shore && t.h === 0 && !t.paint && !t.land) {
                const f = landField(map, wx + u / 16, wy + v / 16);
                if (f > 0.2) return vivid([80, 172, 202, 255]);
                if (f > 0.03) return vivid([60, 140, 192, 255]);
            }
            if (t.h === 0 && !t.land) return texOf(t)[(Math.floor(v) & 15) * 16 + (Math.floor(u) & 15)];
            if (!t.base) {
                const b = baseColor(world, t.x, t.y);
                t.dark = top && t.h > 0 && inShadow(top, t.x, t.y, t.h);
                t.base = b;
            }
            const c = paintedGround(t.base, wx + u / 16, wy + v / 16, R);
            return t.dark ? inShade(c) : c;
        };
        // Each area of one height and one color is one surface, so the outlines go around painted areas too.
        const surface = (H, paint) => (H === 0 && !paint ? penBackground(img) : pen(img, 'g' + H + (paint || '')));
        if (uniform) {
            // Square sides where the ground in front (south or east) is lower: lit facing south, shaded facing east.
            const lower = (i, j) => steps[(j + 1) * 3 + i + 1].h < own.h;
            if (own.h > 0 && (lower(0, 1) || lower(1, 0) || lower(1, 1))) {
                const base = colorAt(own, 8, 8), z = own.h * LEVEL * R, top = sy0 - z;
                pen(img, 'cl' + own.h);
                const lit = cel(base, 'lit'), shade = cel(base, 'shade');
                for (let dx = -16 * R; dx < 0; dx++) for (let k = 0; k < z; k++) blend(img, sx + dx, Math.round(top + 8 * R + (dx + 16 * R) / 2 + k), cliffShade(lit, k + 1, z, R));
                pen(img, 'cs' + own.h);
                for (let dx = 0; dx < 16 * R; dx++) for (let k = 0; k < z; k++) blend(img, sx + dx, Math.round(top + 16 * R - dx / 2 + k), cliffShade(shade, k + 1, z, R));
            }
            surface(own.h, own.paint);
            const sy = sy0 - own.h * LEVEL * R;
            for (let dy = 0; dy < 16 * R; dy++) for (let dx = -16 * R; dx < 16 * R; dx++) {
                const u = (dy + dx / 2) / R, v = (dy - dx / 2) / R;
                if (u < 0 || v < 0 || u >= 16 || v >= 16) continue;
                blend(img, sx + dx, sy + dy, colorAt(own, u, v));
            }
            return;
        }
        // Column by column, from the back of the step to the front: each point of ground at its own height, and a
        // cliff below it wherever the ground in front of it is lower (lit where it faces south, shaded facing east).
        const DW = diamondWeights(R), W = 32 * R;
        for (let dx = -16 * R; dx < 16 * R; dx++) {
            let last = null;
            const cliff = (at, Hn) => {
                // Which way it faces, from how the ground at this height thins out: south lit, east in shadow, and
                // in between a blend (so a diagonal coast doesn't flicker between the two).
                const f = (a, b) => shareAtLeast(world, wx + a / 16, wy + b / 16, at.H, stepCache);
                const gx = f(at.u + 1, at.v) - f(at.u - 1, at.v), gy = f(at.u, at.v + 1) - f(at.u, at.v - 1), m = Math.abs(gx) + Math.abs(gy);
                const south = m > 1e-6 ? Math.max(0, Math.min(1, 0.5 + 0.5 * (gx - gy) / m)) : 0.5, k = south * south * (3 - 2 * south);
                const base = colorAt(at.g, 8, 8), L = cel(base, 'lit'), S = cel(base, 'shade');
                const c = [S[0] + (L[0] - S[0]) * k, S[1] + (L[1] - S[1]) * k, S[2] + (L[2] - S[2]) * k, 255];
                pen(img, (south >= 0.5 ? 'cl' : 'cs') + at.H);
                const y = sy0 + at.dy - at.H * LEVEL * R;
                for (let k = 1; k <= (at.H - Hn) * LEVEL * R; k++) blend(img, sx + dx, y + k, cliffShade(c, k, at.H * LEVEL * R, R));
            };
            for (let dy = 0; dy <= 16 * R; dy++) {
                const u = (dy + dx / 2) / R, v = (dy - dx / 2) / R, inside = u >= 0 && v >= 0 && u < 16 && v < 16;
                if (!inside) {
                    // Just past the front of this step: how far the ground drops there.
                    if (last) { const Hn = heightField(world, wx + u / 16, wy + v / 16, stepCache); if (Hn < last.H) cliff(last, Hn); break; }
                    continue;
                }
                const o = ((dy * W) + dx + 16 * R) * 9, g = steps[groundAt(steps, u, v, DW.subarray(o, o + 9))], H = g.h;
                if (last && H < last.H) cliff(last, H);
                surface(H, g.paint);
                blend(img, sx + dx, sy0 + dy - H * LEVEL * R, colorAt(g, u, v));
                last = { H, g, u, v, dy };
            }
        }
    }

    // A soft shadow on the ground under something standing at (X, Y) on level `level`.
    function footShadow(img, view, X, Y, level, d) {
        const R = view.res || 1, [cx, cy] = isoPoint(view, X, Y, level * LEVEL);
        const rx = Math.max(5, Math.min(15, (d.model ? d.w / 2 : d.w * SPRITE) * 0.42)) * R, ry = rx * 0.45;
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
            const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (e < 1) blend(img, x, y, [...SHADOW, Math.round(90 * (1 - e * e))]);
        }
    }

    // An upright drawing, its bottom middle standing at screen point (gx, gy).
    function isoSprite(img, d, gx, gy, frame) {
        const R = img.res || 1, k = SPRITE * R;
        const rows = d.frames ? d.frames[(frame || 0) % d.frames.length] : d.rows;
        const left = Math.round(gx - (d.w * k) / 2), top = Math.round(gy - d.h * k);
        pen(img, null);
        if (d.vector) return blit(img, rasterShapes(d, frame, k), left, top);
        if (d.smooth && !d.model) {
            const sm = smoothFrame(d, frame, k);
            for (let y = 0; y < sm.h; y++) for (let x = 0; x < sm.w; x++) {
                const i = (y * sm.w + x) * 4;
                if (sm.data[i + 3]) blend(img, left + x, top + y, [sm.data[i], sm.data[i + 1], sm.data[i + 2], sm.data[i + 3]]);
            }
            return;
        }
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
            const c = d.palette[rows[y][x]];
            if (!c) continue;
            for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) blend(img, left + x * k + a, top + y * k + b, c);
        }
    }

    // A 3D model: its layers stacked as blocks over its footprint (as placed, seen from above).
    function isoModel(img, view, d, px, py, groundZ) {
        const R = view.res || 1, cells = [];
        d.frames.forEach((rows, l) => {
            for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
                const c = d.palette[rows[y][x]];
                if (c) cells.push([px + x, py + y, l, c]);
            }
        });
        cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2]);
        pen(img, null);
        for (const [u, v, l, c] of cells) {
            const [sx, sy] = isoPoint(view, u / TILE, v / TILE, groundZ + l * LAYER).map(Math.round);
            const top = c, side = cel(c, 'lit');
            for (let a = 0; a < 2 * R; a++) for (let k = 0; k < (LAYER + 1) * R; k++) blend(img, sx + a, sy + k, k < R ? top : side);
        }
    }

    // Where (in pixels seen from above) a model body's footprint starts, so that it is centred on tile (x, y).
    function modelFoot(d, x, y) {
        return [x * TILE + TILE / 2 - d.w / 2, y * TILE + TILE / 2 - d.h / 2];
    }

    // A model on its own, in 3D (for the viewer to draw a body made of blocks as it walks):
    // the image, and (ax, ay), the point in it that stands on the middle of the body's tile.
    function isoModelImage(d) {
        const fw = d.w / TILE, fh = d.h / TILE, top = d.frames.length * LAYER + 4;
        const view = { x0: 0, y0: 0, ox: Math.ceil(fh * 16) + 2, oy: top };
        const width = Math.ceil((fw + fh) * 16) + 6, height = Math.ceil((fw + fh) * 8) + top + 4;
        const img = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        inkStart(img);
        isoModel(img, view, d, 0, 0, 0);
        inkFinish(img);
        const [ax, ay] = isoPoint(view, fw / 2, fh / 2, 0);
        return { img, ax, ay, top: Math.max(0, ay - d.frames.length * LAYER) };
    }

    // Draw a thing standing on its tile; m = its movement offset (seen from above, in pixels).
    function isoThing(img, view, world, t, time) {
        const m = isAnimated(t) ? motion(t, time, world) : { dx: 0, dy: 0 };
        const groundZ = movingLevel(world, t, m) * LEVEL;
        if (t.drawing.model) return isoModel(img, view, t.drawing, t.px + m.dx, t.py + m.dy, groundZ);
        const [gx, gy] = isoPoint(view, t.x + 0.5 + m.dx / TILE, t.y + 0.5 + m.dy / TILE, groundZ);
        isoSprite(img, t.drawing, gx, gy, frameOf(t.drawing, time));
    }

    // Render tiles [x0, x0+tw) x [y0, y0+th) in 3D. Same options as render(); opts.margin is the room left above
    // for tall things (default 160 pixels), and grows by itself for buildings taller than the highest land.
    // On each step: the ground, then its blocks from the bottom up, with whatever stands there (things and bodies)
    // drawn in between, after the blocks under it and before the ones above it (a roof).
    function renderIso(world, x0, y0, tw, th, opts) {
        opts = opts || {};
        const tiles = blocksByTile(world, x0, y0, tw, th);
        let top = 0;
        for (const key in tiles) top = Math.max(top, tiles[key][tiles[key].length - 1] + 1);
        if (opts.cut != null) top = Math.min(top, opts.cut);
        const extra = Math.max(0, top - MAX_HEIGHT) * LEVEL;
        // opts.res draws it that many times finer (the viewer, to show it large without pixel steps); opts.aa draws it
        // twice as fine and then averages every 2x2, so edges come out smooth at the usual size (their looks).
        const res = (opts.res || 1) * (opts.aa ? 2 : 1);
        const view = isoLayout(x0, y0, tw, th, (opts.margin == null ? 160 : opts.margin) + extra, res);
        const img = { width: view.width, height: view.height, data: new Uint8ClampedArray(view.width * view.height * 4), view, res };
        // Background: the sky, and the open sea out to the horizon.
        sky(img, view.oy, opts.warm || 0, res);
        inkStart(img);
        const topAt = (x, y) => { const b = tiles[x + ',' + y]; return Math.max(heightAt(world, x, y), b ? b[b.length - 1] + 1 : 0); };
        const byTile = {};
        const skip = opts.skip || (opts.skipAnimated ? isAnimated : null);
        // Each thing is drawn in the turn of the step it is on at this moment (a boat on a path sails away from home).
        for (const t of world.things || []) {
            if (skip && skip(t)) continue;
            const m = isAnimated(t) ? motion(t, opts.t, world) : { dx: 0, dy: 0 };
            const key = Math.round(t.x + m.dx / TILE) + ',' + Math.round(t.y + m.dy / TILE);
            (byTile[key] = byTile[key] || []).push({ t, m });
        }
        const bodies = {};
        for (const b of opts.bodies || (opts.body ? [opts.body] : [])) (bodies[Math.round(b.x) + ',' + Math.round(b.y)] = bodies[Math.round(b.x) + ',' + Math.round(b.y)] || []).push(b);
        // Back to front: by x + y, then x.
        for (let s = 0; s <= tw + th - 2; s++) for (let tx = Math.max(0, s - th + 1); tx <= Math.min(tw - 1, s); tx++) {
            const wx = x0 + tx, wy = y0 + (s - tx), key = wx + ',' + wy;
            isoTile(img, view, world, wx, wy, topAt);
            const stands = [];
            for (const { t, m } of byTile[key] || []) {
                const level = movingLevel(world, t, m);
                stands.push({ level, draw: () => { footShadow(img, view, t.x + 0.5 + m.dx / TILE, t.y + 0.5 + m.dy / TILE, level, t.drawing); isoThing(img, view, world, t, opts.t); } });
            }
            for (const b of bodies[key] || []) {
                const level = levelOf(world, b), groundZ = level * LEVEL;
                stands.push({ level, draw: () => {
                    footShadow(img, view, b.x + 0.5, b.y + 0.5, level, b.drawing);
                    if (b.drawing.model) return isoModel(img, view, b.drawing, ...modelFoot(b.drawing, b.x, b.y), groundZ);
                    const [gx, gy] = isoPoint(view, b.x + 0.5, b.y + 0.5, groundZ);
                    isoSprite(img, b.drawing, gx, gy, b.frame || 0);
                } });
            }
            stands.sort((a, b) => a.level - b.level);
            const g = heightAt(world, wx, wy);
            const levels = (tiles[key] || []).filter(z => z >= g && (opts.cut == null || z < opts.cut));
            let k = 0;
            for (const st of stands) {
                for (; k < levels.length && levels[k] < st.level; k++) isoBlock(img, view, world, wx, wy, levels[k], world.blocks[wx + ',' + wy + ',' + levels[k]], opts.cut);
                st.draw();
            }
            for (; k < levels.length; k++) isoBlock(img, view, world, wx, wy, levels[k], world.blocks[wx + ',' + wy + ',' + levels[k]], opts.cut);
        }
        // Where the open sky still shows (for the stars at night: drawSky).
        img.skyMask = new Uint8Array(img.width * img.height);
        for (let p = 0; p < Math.min(view.oy, img.height) * img.width; p++) if (!img.ink.id[p] && !(img.cloudy && img.cloudy[p])) img.skyMask[p] = 1;
        // Where water shows (for the waves and the foam, which mustn't be drawn over the land in front of them).
        img.seaMask = new Uint8Array(img.width * img.height);
        for (let p = Math.max(0, view.oy) * img.width; p < img.width * img.height; p++) if (!img.ink.id[p]) img.seaMask[p] = 1;
        inkFinish(img);
        return opts.aa ? halve(img) : img;
    }

    // A picture at half the size, each pixel the average of four (anti-aliasing). Keeps its 3D view in step.
    function halve(img) {
        const W = img.width >> 1, H = img.height >> 1, d = img.data, out = new Uint8ClampedArray(W * H * 4), sky = new Uint8Array(W * H), sea = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4, a = ((2 * y) * img.width + 2 * x) * 4, b = a + 4, c = a + img.width * 4, e = c + 4;
            for (let j = 0; j < 4; j++) out[o + j] = (d[a + j] + d[b + j] + d[c + j] + d[e + j] + 2) >> 2;
            const m = img.skyMask, p = (2 * y) * img.width + 2 * x;
            if (m && m[p] && m[p + 1] && m[p + img.width] && m[p + img.width + 1]) sky[y * W + x] = 1;
            const s2 = img.seaMask;
            if (s2 && (s2[p] || s2[p + 1] || s2[p + img.width] || s2[p + img.width + 1])) sea[y * W + x] = 1;
        }
        const v = img.view, view = { ...v, ox: v.ox / 2, oy: v.oy / 2, res: v.res / 2, width: W, height: H };
        const res = img.res / 2;
        return { width: W, height: H, data: out, view, res, skyMask: sky, seaMask: sea };
    }

    // The sky's colors, from day (warm 0) to just before sunset (warm 1): top, horizon, and the open sea from the
    // horizon down (the same blue as the island's sea, so the two meet without a seam; the light warms both alike).
    function skyColors(warm) {
        const w = Math.max(0, Math.min(1, warm || 0)), mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * w));
        return { top: mix([104, 160, 224], [92, 88, 164]), horizon: mix([206, 230, 247], [255, 178, 128]),
            seaNear: vivid(SEA), seaFar: vivid([40, 98, 162]), cloud: mix([255, 255, 255], [255, 216, 200]), cloudShade: mix([206, 220, 240], [214, 150, 170]) };
    }

    // A painted sky above the horizon (row hy), with a few flat two-tone clouds, and the open sea below it.
    function sky(img, hy, warm, res) {
        const c = skyColors(warm), d = img.data, W = img.width, H = img.height, R = res || 1;
        const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        for (let y = 0; y < H; y++) {
            const col = y < hy ? lerp(c.top, c.horizon, Math.pow(y / Math.max(1, hy), 1.6)) : lerp(c.seaNear, c.seaFar, Math.min(1, (y - hy) / Math.max(1, H - hy)));
            for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; }
        }
        // The sky reflected in the sea just below the horizon, and a thin bright line where they meet.
        for (let y = Math.max(0, hy); y < Math.min(H, hy + 40 * R); y++) for (let x = 0; x < W; x++) blend(img, x, y, [...c.horizon, Math.round(120 * (1 - (y - hy) / (40 * R)) ** 2)]);
        for (let y = hy; y < hy + R; y++) for (let x = 0; x < W && y >= 0 && y < H; x++) blend(img, x, y, [...c.horizon, 150]);
        // Clouds: a few puffs each, white on top and a soft shade underneath.
        const n = Math.max(1, Math.round(W / (220 * R)));
        for (let k = 0; k < n; k++) {
            const cx = (k + 0.2 + hash(k, W / R, 41) * 0.6) * W / n, cy = hy * (0.3 + hash(k, H / R, 42) * 0.4), size = Math.min(hy * 0.22, (16 + hash(k, W / R + H / R, 43) * 20) * R);
            if (cy - size < 0 || cy + size * 0.6 > hy) continue;
            const puffs = [[0, 0, 1], [-1.2, 0.3, 0.65], [1.2, 0.3, 0.7], [-0.55, -0.4, 0.75], [0.65, -0.35, 0.65], [-1.9, 0.45, 0.45], [1.95, 0.45, 0.45]];
            for (const [ox, oy, r] of puffs) {
                const px = cx + ox * size, py = cy + oy * size, rr = r * size;
                for (let y = Math.floor(py - rr); y <= py + rr; y++) for (let x = Math.floor(px - rr * 1.3); x <= px + rr * 1.3; x++) {
                    const e = ((x - px) / (rr * 1.3)) ** 2 + ((y - py) / rr) ** 2;
                    if (e > 1 || y > cy + size * 0.45) continue;
                    blend(img, x, y, [...(y > cy + size * 0.12 ? c.cloudShade : c.cloud), 255]);
                    if (x >= 0 && x < W && y >= 0) (img.cloudy = img.cloudy || new Uint8Array(W * H))[y * W + x] = 1;
                }
            }
        }
    }

    // --- Blocks: building in 3D ---------------------------------------------------------------------------------
    // world.blocks: {"x,y,z": color}. A block fills one step and one level: level z runs from z to z+1, where the sea
    // is at level 0 and land of height h fills levels 0 to h-1, so a block at level h stands on the ground.
    const MAX_LEVEL = 32;          // blocks go up to level 31
    const BODY_LEVELS = 2;         // a body needs two free levels to stand in

    function blockAt(world, x, y, z) { return world.blocks ? world.blocks[x + ',' + y + ',' + z] : undefined; }

    // A build: {from: [x, y, z], to: [x, y, z], mode, color}. mode "fill" (solid), "walls" (only the box's sides),
    // "hollow" (sides, floor and roof) or "clear" (take blocks away). Cells under the ground or outside the world are
    // skipped. Changes world.blocks; returns {changed, skipped}.
    function applyBuild(world, op) {
        world.blocks = world.blocks || {};
        let changed = 0, skipped = 0;
        eachBuildCell(op, (x, y, z) => {
            if (!inWorld(world.map, x, y) || z < heightAt(world, x, y) || z < 0 || z >= MAX_LEVEL) { skipped++; return; }
            const k = x + ',' + y + ',' + z;
            if (op.mode === 'clear') { if (world.blocks[k]) { delete world.blocks[k]; changed++; } }
            else if (world.blocks[k] !== op.color) { world.blocks[k] = op.color; changed++; }
        });
        return { changed, skipped };
    }

    // Every cell a build covers, in its mode (walls and hollow leave the inside out).
    function eachBuildCell(op, fn) {
        const lo = i => Math.min(op.from[i], op.to[i]), hi = i => Math.max(op.from[i], op.to[i]);
        const [x0, y0, z0, x1, y1, z1] = [lo(0), lo(1), lo(2), hi(0), hi(1), hi(2)];
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const side = x === x0 || x === x1 || y === y0 || y === y1;
            if (op.mode === 'walls' && !side) continue;
            if (op.mode === 'hollow' && !side && z !== z0 && z !== z1) continue;
            fn(x, y, z);
        }
    }

    // The level a body can stand at on step (x, y), coming from level `from` (null: from anywhere, e.g. arriving):
    // the top of a block or the ground, with two free levels above. Blocks can be climbed one level at a time
    // (stairs) and dropped from any height; the ground itself is always walkable, as before. null: a wall.
    // The highest surface it can reach wins, so stairs are climbed and a bridge is walked on, not swum under.
    function standAt(world, x, y, from) {
        if (!inWorld(world.map, x, y)) return null;
        const free = z => { for (let k = 0; k < BODY_LEVELS; k++) if (blockAt(world, x, y, z + k)) return false; return true; };
        const g = heightAt(world, x, y);
        if (world.blocks) for (let z = MAX_LEVEL - 1; z >= g; z--) {
            if (blockAt(world, x, y, z) && free(z + 1) && (from == null || z + 1 <= from + 1)) return z + 1;
        }
        return free(g) ? g : null;
    }

    // Where someone at level `from` on step (x, y) ends up if what held them went away: the highest block top or
    // ground at or below that level.
    function fallTo(world, x, y, from) {
        const g = heightAt(world, x, y);
        for (let z = Math.min(from, MAX_LEVEL) - 1; z >= g; z--) if (blockAt(world, x, y, z)) return z + 1;
        return g;
    }

    // Where a body or a thing stands, in levels (bodies and things on blocks carry z; otherwise the ground).
    function levelOf(world, o) {
        const g = heightAt(world, Math.round(o.x), Math.round(o.y));
        return o.z != null ? Math.max(g, o.z) : g;
    }

    // The level just above the highest block on step (x, y), or its ground if there are none.
    function columnTop(world, x, y) {
        for (let z = MAX_LEVEL - 1; z >= 0; z--) if (blockAt(world, x, y, z)) return Math.max(z + 1, heightAt(world, x, y));
        return heightAt(world, x, y);
    }

    // Blocks per step, lowest first (only the steps inside x0, y0, tw, th when given).
    function blocksByTile(world, x0, y0, tw, th) {
        const out = {};
        for (const k in world.blocks || {}) {
            const i = k.lastIndexOf(','), key = k.slice(0, i);
            if (tw != null) {
                const j = key.indexOf(','), x = Number(key.slice(0, j)), y = Number(key.slice(j + 1));
                if (x < x0 || y < y0 || x >= x0 + tw || y >= y0 + th) continue;
            }
            (out[key] = out[key] || []).push(Number(k.slice(i + 1)));
        }
        for (const key in out) out[key].sort((a, b) => a - b);
        return out;
    }

    // One block in 3D: its top and its two faces toward the viewer (faces against another block are left out,
    // unless that block is see-through and this one isn't). Blocks from level `cut` up aren't drawn.
    function isoBlock(img, view, world, x, y, z, color, cut) {
        const c = painted(color), R = view.res || 1;
        if (!c) return;
        const [sx, sy] = isoPoint(view, x, y, (z + 1) * LEVEL).map(Math.round);
        const a = c[3];
        const hides = (bx, by, bz) => {
            if (cut != null && bz >= cut) return false;
            const n = blockAt(world, bx, by, bz), nc = n && painted(n);
            return Boolean(nc) && (nc[3] === 255 || a < 255);
        };
        // One pen per flat face of one color, so a wall or a roof of one color has no lines inside it.
        if (!hides(x, y, z + 1)) {
            pen(img, 'bt' + (z + 1) + color);
            for (let dy = 0; dy < 16 * R; dy++) for (let dx = -16 * R; dx < 16 * R; dx++) {
                const u = (dy + dx / 2) / R, v = (dy - dx / 2) / R;
                if (u < 0 || v < 0 || u >= 16 || v >= 16) continue;
                const f = u < 1 || v < 1 || u >= 15 || v >= 15 ? 0.94 : 1;
                blend(img, sx + dx, sy + dy, [c[0] * f, c[1] * f, c[2] * f, a]);
            }
        }
        for (const [hidden, side, from, to, key] of [[hides(x, y + 1, z), 'lit', -16 * R, 0, 'by' + (y + 1)], [hides(x + 1, y, z), 'shade', 0, 16 * R, 'bx' + (x + 1)]]) {
            if (hidden) continue;
            const f = cel(c, side);
            pen(img, key + color);
            for (let dx = from; dx < to; dx++) {
                const top = dx < 0 ? 8 * R + (dx + 16 * R) / 2 : 16 * R - dx / 2;
                for (let k = 0; k < LEVEL * R; k++) {
                    const e = 1.04 - 0.1 * k / (LEVEL * R);
                    blend(img, sx + dx, Math.round(sy + top + k), [f[0] * e, f[1] * e, f[2] * e, a]);
                }
            }
        }
    }

    // Seen from above: the top block of each step (below `cut`, if given), lighter the higher it is, with a thin
    // darker edge. Returns the level of the top block drawn on each step ({"x,y": z}).
    function flatBlocks(img, world, x0, y0, tw, th, cut) {
        const tiles = blocksByTile(world, x0, y0, tw, th), tops = {};
        for (const key in tiles) {
            const [x, y] = key.split(',').map(Number), g = heightAt(world, x, y);
            const zs = tiles[key].filter(z => z >= g && (cut == null || z < cut));
            if (!zs.length) continue;
            const z = zs[zs.length - 1], c = painted(world.blocks[x + ',' + y + ',' + z]);
            if (!c) continue;
            if (c[3] === 255) tops[key] = z;  // glass lets what is under it show
            pen(img, 'f' + z + world.blocks[x + ',' + y + ',' + z], 100 + z);
            const f = Math.min(1.35, 0.9 + z * 0.03);
            for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
                const e = px === 0 || py === 0 || px === TILE - 1 || py === TILE - 1 ? 0.8 : 1;
                blend(img, (x - x0) * TILE + px, (y - y0) * TILE + py, [Math.min(255, c[0] * f * e), Math.min(255, c[1] * f * e), Math.min(255, c[2] * f * e), c[3]]);
            }
        }
        return tops;
    }

    // --- Rules: things that behave ------------------------------------------------------------------------------
    // A rules file (rules.txt in the notebook) has lines like  when <condition>: <what happens>.
    // Conditions (joined with "and"): always | morning | day | dusk | someone is near <thing or x,y> [within N] |
    //   someone is at x,y | the islander / Tide is near ... | someone says "word" [for N seconds].
    // What happens (while the condition holds): show <thing> | hide <thing> | <thing> becomes <drawing> |
    //   <thing> glows [#color] | <thing> moves <how> | open x,y,z to x,y,z (those blocks are gone).
    // Our own code reads and carries these out; nothing in them runs as a program.
    const unquote = s => String(s).trim().replace(/^["'](.*)["']$/, '$1').trim();
    const COORDS = /^\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)?$/;
    const WHO_WORDS = '(someone|anyone|somebody|anybody|the islander|islander|tide)';
    const whoOf = w => (/tide/i.test(w) ? 'visitor' : /islander/i.test(w) ? 'islander' : null);
    const NAME = /^[a-z0-9 _-]{1,60}$/;
    function thingName(text) {
        const n = unquote(text).toLowerCase().replace(/^the\s+/, '');
        if (!NAME.test(n)) throw new Error(`"${unquote(text)}" isn't the name of a thing (the name of the drawing it was placed from, like "door").`);
        return n;
    }

    // How a placed thing moves: "still", "wander 3", "circle 2", "bob", "sway", or "path x,y x,y ..." (goes along
    // the points and back, a step a second).
    function parseMoves(text) {
        const s = String(text || 'still').trim().toLowerCase();
        const p = /^path\s+(.+)$/.exec(s);
        if (p) {
            const pts = (p[1].match(/-?\d+\s*,\s*-?\d+/g) || []).map(q => q.split(',').map(Number));
            if (pts.length < 2 || pts.length > 16) throw new Error('A path needs 2 to 16 points, like "path 20,30 25,30 25,35".');
            return { kind: 'path', points: pts };
        }
        const m = /^(still|wander|circle|bob|sway)(?:\s+(\d+))?$/.exec(s);
        if (!m) throw new Error(`moves can be "still", "wander N", "circle N", "bob", "sway" (N is 1 to 8 steps) or "path x,y x,y ...", not "${text}".`);
        const n = Math.max(1, Math.min(8, Number(m[2]) || (m[1] === 'wander' ? 2 : 1)));
        return { kind: m[1], n };
    }

    function parseCondition(text) {
        const s = text.trim(), l = s.toLowerCase();
        if (['always', 'morning', 'day', 'dusk', 'night'].includes(l)) return { kind: l };
        let m = new RegExp(`^${WHO_WORDS}\\s+(?:is\\s+)?(near|at)\\s+(.+?)(?:\\s+within\\s+(\\d+)(?:\\s+steps?)?)?$`, 'i').exec(s);
        if (m) {
            const at = m[2].toLowerCase() === 'at', c = COORDS.exec(m[3].trim());
            if (at && !c) throw new Error(`"at" needs a place like 30,12 (for a thing, use "near ${unquote(m[3])}").`);
            if (m[4] != null && Number(m[4]) > 10) throw new Error('"within" goes up to 10 steps.');
            const within = at ? 0 : Math.max(0, Math.min(10, Number(m[4] || 1)));
            return c ? { kind: 'near', who: whoOf(m[1]), x: Number(c[1]), y: Number(c[2]), within } : { kind: 'near', who: whoOf(m[1]), thing: thingName(m[3]), within };
        }
        m = new RegExp(`^${WHO_WORDS}\\s+says\\s+(?:(["'])(.+?)\\2|(\\S+))(?:\\s+for\\s+(\\d+)\\s*(?:seconds?|s)?)?$`, 'i').exec(s);
        if (m) return { kind: 'says', who: whoOf(m[1]), word: (m[3] || m[4]).toLowerCase(), seconds: Math.max(1, Math.min(600, Number(m[5] || 20))) };
        throw new Error(`"${s}" isn't a condition I know. Conditions: always, morning, day, dusk, someone is near <thing or x,y> [within N], someone is at x,y, someone says "word" [for N seconds] (or the islander / Tide instead of someone).`);
    }

    function parseAction(text) {
        const s = text.trim();
        let m = /^(show|hide)\s+(.+)$/i.exec(s);
        if (m) return { kind: m[1].toLowerCase(), thing: thingName(m[2]) };
        m = /^open\s+(.+?)\s+to\s+(.+)$/i.exec(s);
        if (m) {
            const a = COORDS.exec(m[1].trim()), b = COORDS.exec(m[2].trim());
            if (!a || !b || a[3] == null || b[3] == null) throw new Error('open needs two corners with levels, like "open 30,12,1 to 30,12,2".');
            const box = [[+a[1], +a[2], +a[3]], [+b[1], +b[2], +b[3]]];
            const n = (Math.abs(box[0][0] - box[1][0]) + 1) * (Math.abs(box[0][1] - box[1][1]) + 1) * (Math.abs(box[0][2] - box[1][2]) + 1);
            if (n > 512) throw new Error(`open covers at most 512 blocks; this box has ${n}.`);
            return { kind: 'open', box };
        }
        if (/^open\b/i.test(s)) throw new Error('open needs two corners with levels, like "open 30,12,1 to 30,12,2".');
        m = /^(.+?)\s+becomes\s+(.+)$/i.exec(s);
        if (m) {
            const name = unquote(m[2]).replace(/^drawings[\\/]/i, '').replace(/\.txt$/i, '');
            if (!/^[A-Za-z0-9 _-]{1,60}$/.test(name)) throw new Error(`"${name}" isn't a drawing name; use the file name, like "door-open" for drawings/door-open.txt.`);
            return { kind: 'becomes', thing: thingName(m[1]), drawingName: name };
        }
        m = /^(.+?)\s+glows(?:\s+(\S+))?$/i.exec(s);
        if (m) {
            if (m[2] && !parseColor(m[2])) throw new Error(`"${m[2]}" is not a color. Use #rgb or #rrggbb.`);
            return { kind: 'glows', thing: thingName(m[1]), color: m[2] ? '#' + m[2].replace('#', '').toLowerCase() : '#ffd27a' };
        }
        m = /^(.+?)\s+moves\s+(.+)$/i.exec(s);
        if (m) return { kind: 'moves', thing: thingName(m[1]), moves: parseMoves(unquote(m[2])) };
        throw new Error(`"${s}" isn't something I know how to do. What can happen: show <thing>, hide <thing>, <thing> becomes <drawing>, <thing> glows [#color], <thing> moves <how>, open x,y,z to x,y,z.`);
    }

    // rules.txt -> {rules: [{n, text, when: [conditions], then: action}], problems: [{n, text, why}]}. n is the line
    // number. A line starting with # or // is a note, and so is anything after " // " or " # " on a line.
    function parseRules(text) {
        const rules = [], problems = [];
        String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').forEach((raw, i) => {
            const line = raw.replace(/\s(\/\/|#)\s.*$/, '').trim(), n = i + 1;
            if (!line || line.startsWith('#') || line.startsWith('//')) return;
            try {
                const m = /^when\s+(.+?)\s*:\s*(.+)$/i.exec(line);
                if (!m) throw new Error(/^when\b/i.test(line) ? 'It needs a ":" between the condition and what happens.' : 'A rule looks like  when <condition>: <what happens>');
                if (rules.length >= 200) throw new Error('At most 200 rules; this one is left out.');
                rules.push({ n, text: line, when: m[1].split(/\s+and\s+/i).map(parseCondition), then: parseAction(m[2]) });
            } catch (err) { problems.push({ n, text: line, why: err.message }); }
        });
        return { rules, problems };
    }

    // The world as the rules make it at this moment. ctx: {t (ms), f (how far through the day, 0 to 1, or null),
    // bodies: [{who, x, y, z}], said: [{who, text, t (ms)}]}. Returns {world (a copy where needed), active: [rule n],
    // glows: [{x, y, z, color}], key (changes whenever what the rules do changes)}.
    // When two rules say different things about the same thing, the later line wins.
    function withRules(world, rules, ctx) {
        const list = (rules && rules.rules) || [];
        if (!list.length) return { world, active: [], glows: [], key: '' };
        ctx = ctx || {};
        const named = name => (world.things || []).filter(t => t.name.toLowerCase() === name);
        const holds = c => {
            if (c.kind === 'always') return true;
            const f = ctx.f;
            // Night is whatever they chose with the sky tool; the times of day don't hold while it is night.
            if (c.kind === 'night') return Boolean(ctx.night);
            if (ctx.night && (c.kind === 'morning' || c.kind === 'day' || c.kind === 'dusk')) return false;
            if (c.kind === 'morning') return f != null && f < 0.2;
            if (c.kind === 'day') return f == null || f <= 0.6;
            if (c.kind === 'dusk') return f != null && f > 0.6;
            const bodies = (ctx.bodies || []).filter(b => !c.who || b.who === c.who);
            if (c.kind === 'near') {
                const spots = c.thing ? named(c.thing).map(t => [t.x, t.y]) : [[c.x, c.y]];
                return bodies.some(b => spots.some(([x, y]) => Math.max(Math.abs(Math.round(b.x) - x), Math.abs(Math.round(b.y) - y)) <= c.within));
            }
            if (c.kind === 'says') return (ctx.said || []).some(s => (!c.who || s.who === c.who) && String(s.text).toLowerCase().includes(c.word) && ctx.t >= s.t && ctx.t - s.t <= c.seconds * 1000);
            return false;
        };
        const active = list.filter(r => r.when.every(holds));
        const shown = {}, change = {}, glows = [];
        let blocks = world.blocks;
        const take = (p, q, keep) => {
            let gone = 0;
            for (let z = Math.min(p[2], q[2]); z <= Math.max(p[2], q[2]); z++) for (let y = Math.min(p[1], q[1]); y <= Math.max(p[1], q[1]); y++)
                for (let x = Math.min(p[0], q[0]); x <= Math.max(p[0], q[0]); x++) {
                    const k = x + ',' + y + ',' + z;
                    if (!blocks || !blocks[k] || (keep && !keep(x, y, z))) continue;
                    if (blocks === world.blocks) blocks = { ...world.blocks };
                    delete blocks[k]; gone++;
                }
            return gone;
        };
        // "show X": X is hidden unless one of its show rules holds.
        for (const r of list) if (r.then.kind === 'show') shown[r.then.thing] = shown[r.then.thing] || false;
        for (const r of active) {
            const a = r.then;
            if (a.kind === 'show') shown[a.thing] = true;
            else if (a.kind === 'hide') shown[a.thing] = false;
            else if (a.kind === 'open') take(a.box[0], a.box[1]);
            else (change[a.thing] = change[a.thing] || []).push(a);
        }
        // A door doesn't close on someone standing in it: blocks a rule opens stay open where a body is.
        const kept = [];
        for (const r of list) {
            if (r.then.kind !== 'open' || active.includes(r)) continue;
            for (const b of ctx.bodies || []) {
                const bx = Math.round(b.x), by = Math.round(b.y), L = levelOf(world, b), [p, q] = r.then.box;
                const inside = (v, i) => v >= Math.min(p[i], q[i]) && v <= Math.max(p[i], q[i]);
                if (!inside(bx, 0) || !inside(by, 1) || Math.max(p[2], q[2]) < L || Math.min(p[2], q[2]) > L + BODY_LEVELS - 1) continue;
                if (take([bx, by, L], [bx, by, L + BODY_LEVELS - 1], (x, y, z) => inside(z, 2))) kept.push(r.n + '@' + bx + ',' + by);
            }
        }
        const things = [];
        for (const t of world.things || []) {
            const name = t.name.toLowerCase();
            if (shown[name] === false) continue;
            let u = t;
            for (const a of change[name] || []) {
                if (a.kind === 'becomes' && a.drawing) { const [px, py] = bodyOrigin(a.drawing, t.x, t.y); u = { ...u, drawing: a.drawing, px, py }; }
                else if (a.kind === 'moves') u = { ...u, moves: a.moves };
                else if (a.kind === 'glows') glows.push({ x: t.x, y: t.y, z: levelOf(world, t), color: a.color });
            }
            things.push(u);
        }
        const n = active.map(r => r.n);
        return { world: { ...world, things, blocks }, active: n, glows, key: n.join(',') + (kept.length ? '|' + kept.join(';') : '') };
    }

    // Glows: soft round light around things, stronger toward evening, with a bright core (bloom).
    // at(X, Y, zPixels) -> image point.
    function drawGlows(img, glows, at, warm) {
        for (const g of glows || []) {
            const c = parseColor(g.color) || [255, 210, 122];
            const [cx, cy] = at(g.x + 0.5, g.y + 0.5, g.z * LEVEL + 10), r = 30 * (img.res || 1), strength = 0.3 + 0.45 * Math.min(1, warm || 0);
            const core = [Math.round(c[0] * 0.4 + 255 * 0.6), Math.round(c[1] * 0.4 + 255 * 0.6), Math.round(c[2] * 0.4 + 255 * 0.6)];
            for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
                const d = Math.hypot(x - cx, y - cy) / r;
                if (d >= 1) continue;
                blend(img, x, y, [c[0], c[1], c[2], Math.round(255 * strength * (1 - d) * (1 - d))]);
                if (d < 0.3) blend(img, x, y, [...core, Math.round(255 * strength * (1 - d / 0.3))]);
            }
        }
    }

    // --- The moving sea and the light, for their own eyes -------------------------------------------------
    // The same sea the viewer draws (crests drifting across the water, foam breaking on the shore) and the warm
    // light toward sunset, drawn into a picture at time t (ms). view: the 3D view from renderIso, or null for a
    // flat picture of tiles from (x0, y0). warm: 0 (day) to 1 (just before sunset).
    function lookEffects(img, world, x0, y0, tw, th, view, t, warm) {
        const sec = (t || 0) / 1000, R = (view && view.res) || 1;
        const at = (X, Y) => (view ? isoPoint(view, X, Y, 0) : [(X - x0) * TILE, (Y - y0) * TILE]);
        // A line one picture pixel thick (R pixels at a finer resolution).
        const line = (a, b, c) => {
            const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
            for (let i = 0; i <= n; i++) for (let o = 0; o < R; o++) {
                const x = Math.round(a[0] + (b[0] - a[0]) * i / n), y = Math.round(a[1] + (b[1] - a[1]) * i / n) + o;
                if (view && img.seaMask && !img.seaMask[y * img.width + x]) continue;  // only on water that shows
                blend(img, x, y, c);
            }
        };
        for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) {
            if (!inWorld(world.map, x, y) || isLand(world.map, x, y)) continue;
            const painted = Boolean(world.paint && world.paint[x + ',' + y]), ph = hash(x, y, 9);
            for (let k = 0; k < 2; k++) {
                const f = (sec * 0.12 + ph + k * 0.5) % 1;
                const u = (f + 0.15 * Math.sin(sec * 0.7 + ph * 6) + 1) % 1, v = k * 0.5 + 0.25 + 0.08 * Math.sin(sec + ph * 9);
                const [sx, sy] = at(x + u, y + v), len = (view ? 6 : 4) * R;
                const alpha = Math.round(255 * (painted ? 0.45 : 0.9) * 0.4 * Math.sin(f * Math.PI));
                line([sx - len / 2, sy], [sx + len / 2, sy], [205, 228, 255, alpha]);
            }
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                if (!isLand(world.map, x + dx, y + dy)) continue;
                const e = 0.1 + 0.06 * Math.sin(sec * 1.1 + x + y);
                const a = Math.round(255 * Math.max(0, 0.3 + 0.3 * Math.sin(sec * 1.6 + x * 0.9 + y * 1.3)));
                // Along the rounded coast (in 3D), a little out to sea.
                const pts = (view ? coastLine(world.map, x, y, dx, dy) : dy ? [[x, dy < 0 ? y : y + 1], [x + 1, dy < 0 ? y : y + 1]] : [[dx < 0 ? x : x + 1, y], [dx < 0 ? x : x + 1, y + 1]])
                    .map(([X, Y]) => at(X - dx * e, Y - dy * e));
                for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i], [255, 255, 255, a]);
            }
        }
        if (warm > 0) {
            const c = [255, 140, 60, Math.round(255 * 0.16 * Math.min(1, warm))];
            for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) blend(img, x, y, c);
        }
    }

    // --- The sky, as they choose it (the sky tool): day or night, and a sun and a moon if they want them ------
    // sky: {night, sun, moon}. Night darkens everything to moonlight, with stars in the dark beyond the world; the sun
    // shows by day and the moon by night, in the top right corner. warm (0 to 1) lowers and reddens the sun toward
    // sunset. Glows are drawn after this, so lights shine in the dark.
    const NIGHT = [8, 14, 40, 150];
    function drawSky(img, sky, warm, t) {
        sky = sky || {};
        const R = img.res || 1, W = img.width, cx = W - 34 * R;
        if (sky.night) {
            const stars = [];
            for (let y = 0; y < img.height; y++) for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4, d = img.data;
                const open = img.skyMask ? img.skyMask[y * W + x] : d[i] === DEEP[0] && d[i + 1] === DEEP[1] && d[i + 2] === DEEP[2];
                if (open && hash(x, y, 11) > 1 - 0.005 / (R * R)) stars.push([x, y]);
            }
            for (let y = 0; y < img.height; y++) for (let x = 0; x < W; x++) blend(img, x, y, NIGHT);
            for (const [x, y] of stars) for (let a = 0; a < R; a++) for (let b = 0; b < R; b++) blend(img, x + a, y + b, [255, 255, 240, Math.round(140 + 115 * hash(x, y, Math.floor((t || 0) / 700)))]);
            if (sky.moon) {
                const cy = 30 * R, r = 11 * R;
                for (let y = cy - r * 3; y <= cy + r * 3; y++) for (let x = cx - r * 3; x <= cx + r * 3; x++) {
                    const d = Math.hypot(x - cx, y - cy);
                    if (d <= r) {
                        const crater = Math.hypot(x - cx + 4 * R, y - cy + 2 * R) < 3 * R || Math.hypot(x - cx - 3 * R, y - cy - 4 * R) < 2 * R || Math.hypot(x - cx - 2 * R, y - cy + 4 * R) < 2 * R;
                        blend(img, x, y, crater ? [190, 196, 210, 255] : [232, 236, 245, 255]);
                    } else if (d <= r * 3) blend(img, x, y, [200, 210, 255, Math.round(60 * (1 - (d - r) / (r * 2)) ** 2)]);
                }
            }
        } else if (sky.sun) {
            const w = Math.min(1, warm || 0), cy = (30 + Math.round(w * 22)) * R, r = 12 * R;
            const core = [255, Math.round(222 - 70 * w), Math.round(90 - 50 * w)];
            for (let y = cy - r * 4; y <= cy + r * 4; y++) for (let x = cx - r * 4; x <= cx + r * 4; x++) {
                const d = Math.hypot(x - cx, y - cy);
                if (d <= r) blend(img, x, y, [...core, 255]);
                else if (d <= r * 4) blend(img, x, y, [255, Math.round(230 - 60 * w), 120, Math.round(90 * (1 - (d - r) / (r * 3)) ** 2)]);
            }
        }
    }

    const api = {
        TILE, DIRT, SEA, DEEP, MAX_HEIGHT, LEVEL, SPRITE, LAYER, DEFAULT_BODY, VISITOR_BODY,
        parseColor, parseDrawing, parseShapes, rasterShapes, smoothFrame, coastLine, frameOf, drawDrawing, bodyOrigin, frontView, modelFoot, isoModelImage, isLand, inWorld, heightAt,
        isAnimated, motion, pathPoint, movingLevel, groundColor, render, renderIso, lookEffects, isoLayout, isoPoint, isoSprite, isoThing, hash,
        skyColors, INK,
        MAX_LEVEL, BODY_LEVELS, blockAt, applyBuild, eachBuildCell, standAt, fallTo, levelOf, columnTop, blocksByTile, isoBlock, flatBlocks,
        parseMoves, parseCondition, parseAction, parseRules, withRules, drawGlows, drawSky,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.IslandArt = api;
})(this);

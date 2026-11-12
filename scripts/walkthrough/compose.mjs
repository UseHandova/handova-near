/**
 * Turns scripts/walkthrough/record.mjs footage into the MP4: straight cuts between the two browser
 * windows (whoever is acting), the narration on top. No overlays, captions or transitions; the
 * subtitles go in a separate .srt next to the video, with the transcript as .txt.
 *
 *   node scripts/walkthrough/compose.mjs demo-out/walk demo-out/walk/handova-walkthrough.mp4
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REC = resolve(process.argv[2] ?? 'demo-out/walk');
const OUT = resolve(process.argv[3] ?? join(REC, 'handova-walkthrough.mp4'));
const FF = process.env.FFMPEG ?? 'ffmpeg';
const TMP = join(REC, 'compose');
mkdirSync(TMP, { recursive: true });
const ff = (args) => execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const tl = JSON.parse(readFileSync(join(REC, 'timeline.json'), 'utf8'));
const video = (who) => join(REC, who, readdirSync(join(REC, who)).find((f) => f.endsWith('.webm')));
const secs = (p) => Number(execFileSync('afinfo', [p]).toString().match(/estimated duration: ([\d.]+)/)[1]);

// One shot per run of lines on the same window, from its first line until the next window's line.
const L = tl.lines;
const shots = [];
L.forEach((l, i) => {
  const from = i === 0 ? 0 : l.start / 1000;
  const to = (i + 1 < L.length ? L[i + 1].start : tl.total) / 1000;
  const last = shots.at(-1);
  if (last && last.who === l.who) last.to = to; else shots.push({ who: l.who, from, to });
});
const files = shots.map((s, k) => {
  const out = join(TMP, `shot-${String(k).padStart(2, '0')}.mp4`);
  ff(['-ss', String(tl.offsets[s.who] / 1000 + s.from), '-i', video(s.who), '-t', String(s.to - s.from),
    '-vf', 'fps=30,setsar=1', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
  return out;
});
const list = join(TMP, 'shots.txt');
writeFileSync(list, files.map((p) => `file '${p}'`).join('\n'));
const joined = join(TMP, 'video.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

const total = tl.total / 1000;
const audio = L.map((l) => join(REC, l.audio));
let f = '';
audio.forEach((_, i) => { f += `[${i + 1}:a]aresample=48000,adelay=${L[i].start}|${L[i].start}[a${i}];`; });
f += `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,apad,atrim=0:${total}[a]`;
const full = join(TMP, 'full.mp4');
ff(['-i', joined, ...audio.flatMap((p) => ['-i', p]), '-filter_complex', f, '-map', '0:v', '-map', '[a]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-t', String(total), full]);

// Waiting on the network while nobody speaks (the AI drafting, a transaction confirming) is cut, as
// anyone trims a screen recording: the first 0.4 s of the wait and the moment it lands stay in.
const said = L.map((l, i) => [l.start / 1000 - 0.15, l.start / 1000 + secs(audio[i]) + 0.25]);
let cuts = [];
for (const [a, b] of tl.waits ?? []) {
  let pieces = [[a / 1000 + 0.4, b / 1000 - 0.2]];
  for (const [s, e] of said) pieces = pieces.flatMap(([x, y]) => [[x, Math.min(y, s)], [Math.max(x, e), y]]);
  cuts.push(...pieces.filter(([x, y]) => y - x > 0.4));
}
cuts.sort((p, q) => p[0] - q[0]);
cuts = cuts.reduce((m, c) => { const last = m.at(-1); if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]); else m.push([...c]); return m; }, []);
const keep = [];
let at = 0;
for (const [x, y] of cuts) { if (x > at) keep.push([at, x]); at = Math.max(at, y); }
keep.push([at, total]);
let kf = '';
keep.forEach(([x, y], i) => { kf += `[0:v]trim=${x}:${y},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${x}:${y},asetpts=PTS-STARTPTS[a${i}];`; });
kf += `${keep.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${keep.length}:v=1:a=1[v][a]`;
ff(['-i', full, '-filter_complex', kf, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', OUT]);
/** Where a moment of the uncut recording lands in the finished video. */
const mapT = (t) => keep.reduce((acc, [x, y]) => acc + Math.max(0, Math.min(t, y) - x), 0);
const length = mapT(total);

const stamp = (x) => {
  const ms = Math.round(x * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const subs = L.flatMap((l, i) => {
  const a0 = mapT(l.start / 1000), len = secs(audio[i]);
  const parts = l.text.match(/[^.?!:]+[.?!:]+(\s|$)/g) ?? [l.text];
  let at = a0;
  return parts.map((t) => { const a = at; at += (len * t.length) / l.text.length; return { a, b: at, t: t.trim() }; });
});
writeFileSync(OUT.replace(/\.mp4$/, '.srt'), subs.map((s, i) => `${i + 1}\n${stamp(s.a)} --> ${stamp(s.b)}\n${s.t}\n`).join('\n'));
writeFileSync(OUT.replace(/\.mp4$/, '.txt'), `${L.map((l) => l.text).join('\n\n')}\n`);
console.log(`wrote ${OUT} (${Math.floor(length / 60)}:${String(Math.round(length % 60)).padStart(2, '0')}, ${shots.length} shots, ${cuts.length} waits trimmed, ${Math.round(total - length)}s)`);

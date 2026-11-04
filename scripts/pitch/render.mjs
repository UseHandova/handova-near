/**
 * Renders the 60-second pitch for X: 1080×1080 MP4 from scripts/pitch/scene.html, frame by frame, with the
 * narration from voice-pitch/ (see script.mjs) and captions burned in. Also writes an .srt beside it.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/pitch/render.mjs <out.mp4>           # whole video
 *   FFMPEG=... node scripts/pitch/render.mjs <dir> --stills 3,9,20           # single frames, for checking
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { CAPTIONS, LINES } from './script.mjs';

const OUT = resolve(process.argv[2] ?? 'handova-pitch.mp4');
const stills = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : null;
const FF = process.env.FFMPEG ?? 'ffmpeg';
const VOICE = process.env.PITCH_VOICE ?? 'voice-pitch';
const SPEED = Number(process.env.PITCH_SPEED ?? 1.12);
const GAP = 0.3, LEAD = 0.25, TAIL = 2.2, FPS = 30;

const secs = (p) => Number(execFileSync('afinfo', [p]).toString().match(/estimated duration: ([\d.]+)/)[1]);
const ids = Object.keys(LINES);
const clips = [];
let t = LEAD;
for (const id of ids) {
  const file = join(VOICE, `${id}.mp3`);
  const d = secs(file) / SPEED;
  clips.push({ id, file, start: t, end: t + d });
  t += d + GAP;
}
const total = clips.at(-1).end + TAIL;

// Scene n runs from its line's start to the next line's start.
const scenes = clips.map((c, i) => ({ id: `s${i + 1}`, start: i ? c.start : 0, end: clips[i + 1]?.start ?? total }));

/** Caption screens for a line, each shown for its share of the clip by word count. */
function captions(c) {
  const count = (x) => x.split(' ').length;
  const per = (c.end - c.start) / CAPTIONS[c.id].reduce((n, x) => n + count(x), 0);
  let at = c.start;
  return CAPTIONS[c.id].map((text) => {
    const a = at;
    at += count(text) * per;
    let cut = 0;
    if (text.length > 36) { const mid = text.length / 2; cut = [...text.matchAll(/ /g)].map((m) => m.index).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0]; }
    return { a, b: at, text, lines: cut ? [text.slice(0, cut), text.slice(cut + 1)] : [text] };
  });
}
const caps = clips.slice(0, -1).flatMap(captions);
const srtCaps = clips.flatMap(captions);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
const file = (p) => pathToFileURL(resolve(p)).href;
await page.goto(`${file('scripts/pitch/scene.html')}?shot=${encodeURIComponent(file('docs/screenshots/03-listing.png'))}&logo=${encodeURIComponent(file('public/handova-mark.svg'))}`);
await page.evaluate(async (tl) => { await document.fonts.ready; window.setup(tl); }, { scenes, caps });
await page.waitForTimeout(800);

if (stills) {
  mkdirSync(OUT, { recursive: true });
  for (const s of stills) {
    await page.evaluate((x) => window.seek(x), s);
    await page.screenshot({ path: join(OUT, `t${String(s).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 80 });
  }
  console.log(JSON.stringify(scenes.map((s) => [s.id, +s.start.toFixed(1)])), 'total', total.toFixed(1));
  await browser.close();
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const inputs = clips.flatMap((c) => ['-i', c.file]);
const af = clips.map((c, i) => `[${i + 1}:a]atempo=${SPEED},adelay=${Math.round(c.start * 1000)}|${Math.round(c.start * 1000)},aresample=48000[a${i}];`).join('')
  + `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${total}[a]`;
const enc = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...inputs,
  '-filter_complex', af, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-t', String(total), OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
const frames = Math.ceil(total * FPS);
for (let f = 0; f < frames; f++) {
  await page.evaluate((x) => window.seek(x), f / FPS);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r));
}
enc.stdin.end();
await new Promise((r) => enc.on('close', r));
await browser.close();

const stamp = (x) => { const ms = Math.round(x * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
writeFileSync(OUT.replace(/\.mp4$/, '.srt'), srtCaps.map((c, i) => `${i + 1}\n${stamp(c.a)} --> ${stamp(c.b)}\n${c.text}\n`).join('\n'));
console.log(`wrote ${OUT} (${total.toFixed(1)}s, ${frames} frames)`);

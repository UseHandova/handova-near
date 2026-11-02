/**
 * Turns the footage from scripts/record-demo.mjs into the demo video (1920×1080 MP4):
 * landing page (who is presenting) → the phones side by side with captions and narration, silences
 * fast-forwarded → closing card.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/compose-demo.mjs <recording-dir> <out.mp4>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HELLO, INTRO, OUTRO } from './demo-voiceover.mjs';

const REC = resolve(process.argv[2]);
const OUT = resolve(process.argv[3] ?? 'handova-demo.mp4');
const FF = process.env.FFMPEG ?? 'ffmpeg';
const VOICE = process.env.DEMO_VOICE ?? 'Daniel';
const VOICE_DIR = process.env.DEMO_AUDIO; // recorded outro clip, as in record-demo.mjs
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const BG = '0x0d1611';
const GREEN = '0x1f9e61';
const TMP = join(REC, 'compose');
mkdirSync(TMP, { recursive: true });
const ff = (args) => execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const tl = JSON.parse(readFileSync(join(REC, 'timeline.json'), 'utf8'));

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += ' ' + w;
  }
  return [...lines, line.trim()].join('\n');
}
function textfile(name, text) {
  const p = join(TMP, `${name}.txt`);
  writeFileSync(p, text);
  return p.replace(/:/g, '\\:');
}
function speak(name, text) {
  const recorded = VOICE_DIR && ['wav', 'mp3', 'm4a', 'aiff'].map((ext) => join(VOICE_DIR, `${name}.${ext}`)).find(existsSync);
  if (VOICE_DIR && !recorded) throw new Error(`No recorded clip for "${name}" in ${VOICE_DIR}`);
  const p = recorded || join(TMP, `${name}.aiff`);
  if (!recorded) execFileSync('say', ['-v', VOICE, '-r', '178', '-o', p, text]);
  return { p, secs: Number(execFileSync('afinfo', [p]).toString().match(/estimated duration: ([\d.]+)/)[1]) };
}
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

/** A title card: big title and lines of text, each centred, with narration. */
function card(name, title, lines, narration, minSecs) {
  const voice = speak(name, narration);
  const secs = Math.max(minSecs, voice.secs + 1.2);
  const top = 540 - (150 + lines.length * 70) / 2;
  const draw = [
    `drawtext=fontfile='${BOLD}':textfile='${textfile(name + '-t', title)}':fontsize=110:fontcolor=white:x=(w-text_w)/2:y=${top}`,
    `drawbox=x=(iw-180)/2:y=${top + 140}:w=180:h=6:color=${GREEN}:t=fill`,
    ...lines.map((line, i) => `drawtext=fontfile='${i === lines.length - 1 ? BOLD : FONT}':textfile='${textfile(`${name}-l${i}`, line)}':fontsize=46:fontcolor=${i === lines.length - 1 ? 'white' : '0xd2d8d4'}:x=(w-text_w)/2:y=${top + 190 + i * 70}`),
  ].join(',');
  const out = join(TMP, `${name}.mp4`);
  ff(['-f', 'lavfi', '-i', `color=c=${BG}:s=1920x1080:d=${secs}:r=30`, '-i', voice.p, '-filter_complex', `[0:v]${draw}[v];[1:a]apad,atrim=0:${secs}[a]`, '-map', '[v]', '-map', '[a]', ...ENC, '-t', String(secs), out]);
  return out;
}

// Opening: the landing page full screen with a title strip, HELLO then INTRO spoken, captioned.
const video = (who) => join(REC, who, readdirSync(join(REC, who)).find((f) => f.endsWith('.webm')));
const lp = JSON.parse(readFileSync(join(REC, 'landing.json'), 'utf8'));
const intro = (() => {
  const secs = (lp.end - lp.start) / 1000;
  const helloAt = lp.gap;
  const introAt = lp.gap + lp.hello + lp.gap;
  const cap = (name, text, from, to) =>
    `drawtext=fontfile='${FONT}':textfile='${textfile(name, wrap(text, 95))}':fontsize=30:line_spacing=8:fontcolor=white:box=1:boxcolor=0x000000@0.6:boxborderw=14:x=(w-text_w)/2:y=h-text_h-26:enable='between(t,${from / 1000},${to / 1000})'`;
  const draw = [
    // Title in the empty margin left of the page column.
    `drawtext=fontfile='${BOLD}':text='Handova':fontsize=96:fontcolor=0x111814:x=110:y=360`,
    `drawbox=x=114:y=482:w=140:h=6:color=${GREEN}:t=fill`,
    `drawtext=fontfile='${FONT}':text='NEAR Hackathon submission':fontsize=40:fontcolor=0x4a5550:x=112:y=520`,
    `drawtext=fontfile='${FONT}':text='by Philip':fontsize=40:fontcolor=0x4a5550:x=112:y=576`,
    cap('cap-hello', HELLO, helloAt, introAt),
    cap('cap-intro', INTRO, introAt, secs * 1000),
    `drawtext=fontfile='${FONT}':text='NEAR testnet · real app':fontsize=20:fontcolor=0x6c7671:x=w-text_w-24:y=h-40`,
  ].join(',');
  const out = join(TMP, 'landing.mp4');
  ff([
    '-ss', String(lp.start / 1000), '-i', video('landing'), '-i', join(REC, lp.hello_audio), '-i', join(REC, lp.intro_audio),
    '-filter_complex',
    `[0:v]scale=1920:1080,setsar=1,${draw}[v];[1:a]adelay=${helloAt}|${helloAt},aresample=48000[h];[2:a]adelay=${introAt}|${introAt},aresample=48000[i];[h][i]amix=inputs=2:normalize=0,apad,atrim=0:${secs}[a]`,
    '-map', '[v]', '-map', '[a]', ...ENC, '-t', String(secs), out,
  ]);
  return out;
})();

// Main section: the phones.
const total = tl.total / 1000;
const phones = tl.phones ?? ['landlord', 'nurse', 'mum'];
const PH = phones.length > 3 ? 740 : 820;
const PW = Math.round((PH * 390) / 664); // iPhone 13 profile: visible page is 390×664
const xs = Object.fromEntries(phones.map((who, i) => [who, Math.round((1920 * (i + 0.5)) / phones.length - PW / 2)]));
const label = { landlord: 'Ade · landlord · Lagos', nurse: 'Daughter · nurse · London', mum: 'Mum · tenant · Lagos', tolu: 'Tolu · next tenant' };
const Y = 70;
let f = `color=c=${BG}:s=1920x1080:d=${total}:r=30[bg];`;
phones.forEach((who, i) => { f += `[${i}:v]crop=390:664:0:0,scale=${PW}:${PH}:flags=lanczos,setsar=1[p${i}];`; });
phones.forEach((who, i) => { f += `${i === 0 ? '[bg]' : `[o${i - 1}]`}[p${i}]overlay=${xs[who]}:${Y}:shortest=0[o${i}];`; });
const draws = [];
for (const who of phones) {
  draws.push(`drawtext=fontfile='${BOLD}':textfile='${textfile('label-' + who, label[who])}':fontsize=26:fontcolor=0xd2d8d4:x=${xs[who] + PW / 2}-text_w/2:y=28`);
}
tl.captions.forEach((c, i) => {
  const a = (c.start / 1000).toFixed(2);
  const b = ((c.end ?? c.start + 4000) / 1000).toFixed(2);
  const x = xs[c.who] - 8;
  draws.push(`drawbox=x=${x}:y=${Y - 8}:w=${PW + 16}:h=${PH + 16}:color=${GREEN}:t=6:enable='between(t,${a},${b})'`);
  draws.push(`drawtext=fontfile='${FONT}':textfile='${textfile('cap' + i, wrap(c.text, 95))}':fontsize=30:line_spacing=8:fontcolor=white:box=1:boxcolor=0x000000@0.55:boxborderw=14:x=(w-text_w)/2:y=h-text_h-26:enable='between(t,${a},${b})'`);
});
draws.push(`drawtext=fontfile='${FONT}':text='NEAR testnet · real transactions':fontsize=20:fontcolor=0x6c7671:x=w-text_w-24:y=h-40`);
f += `[o${phones.length - 1}]${draws.join(',')}[v];`;
// Narration clips placed at their caption times.
const audioInputs = tl.captions.map((c) => join(REC, c.audio));
audioInputs.forEach((_, i) => { f += `[${phones.length + i}:a]adelay=${tl.captions[i].start}|${tl.captions[i].start},aresample=48000[a${i}];`; });
f += `${audioInputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,apad,atrim=0:${total}[a]`;
const main = join(TMP, 'main.mp4');
ff([...phones.flatMap((who) => ['-i', video(who)]), ...audioInputs.flatMap((p) => ['-i', p]), '-filter_complex', f, '-map', '[v]', '-map', '[a]', ...ENC, '-t', String(total), main]);

// Tighten the silences: while nobody speaks (a transaction confirming, a page loading) the footage is
// fast-forwarded so each pause lasts about GAP_SECS, between 1.5× and 8× speed. Narration plays at 1×.
const GAP_SECS = Number(process.env.DEMO_GAP_SECS ?? 0.6);
const clipSecs = (p) => Number(execFileSync('afinfo', [p]).toString().match(/estimated duration: ([\d.]+)/)[1]);
const segments = [];
let at = 0;
tl.captions.forEach((c, i) => {
  const s = c.start / 1000;
  if (s > at) segments.push({ from: at, to: s, speed: null });
  const speechEnd = Math.min(s + clipSecs(audioInputs[i]) + 0.25, total);
  segments.push({ from: s, to: speechEnd, speed: 1 });
  at = speechEnd;
});
if (total > at) segments.push({ from: at, to: total, speed: null });
for (const g of segments) if (g.speed === null) g.speed = Math.min(8, Math.max(1.5, (g.to - g.from) / GAP_SECS));
const tight = join(TMP, 'main-tight.mp4');
const parts = segments.filter((g) => g.to - g.from > 0.05);
let tf = '';
parts.forEach((g, i) => {
  tf += `[0:v]trim=${g.from}:${g.to},setpts=(PTS-STARTPTS)/${g.speed}[v${i}];`;
  tf += `[0:a]atrim=${g.from}:${g.to},asetpts=PTS-STARTPTS,atempo=${g.speed}[a${i}];`;
});
tf += `${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`;
ff(['-i', main, '-filter_complex', tf, '-map', '[v]', '-map', '[a]', ...ENC, tight]);
const saved = parts.reduce((t, g) => t + (g.to - g.from) * (1 - 1 / g.speed), 0);
console.log(`silences tightened: ${Math.round(total)}s → ${Math.round(total - saved)}s`);

const outro = card('outro', 'Handova', ['Rent without the agent. Without the fear.', 'Thank you for watching'], OUTRO, 6);

const list = join(TMP, 'list.txt');
writeFileSync(list, [intro, tight, outro].map((p) => `file '${p}'`).join('\n'));
// Played a little faster (default 1.2×) so it moves briskly; atempo keeps the voice's pitch.
const SPEED = Number(process.env.DEMO_SPEED ?? 1.2);
if (SPEED === 1) ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
else ff(['-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', `[0:v]setpts=PTS/${SPEED}[v];[0:a]atempo=${SPEED}[a]`, '-map', '[v]', '-map', '[a]', ...ENC, '-movflags', '+faststart', OUT]);
console.log(`wrote ${OUT}`);

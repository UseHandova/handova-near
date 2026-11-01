/**
 * Turns the footage from scripts/record-demo.mjs into the demo video (1920×1080 MP4):
 * intro card → three phones side by side with captions and narration → outro card.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/compose-demo.mjs <recording-dir> <out.mp4>
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REC = resolve(process.argv[2]);
const OUT = resolve(process.argv[3] ?? 'handova-demo.mp4');
const FF = process.env.FFMPEG ?? 'ffmpeg';
const VOICE = process.env.DEMO_VOICE ?? 'Daniel';
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
  const p = join(TMP, `${name}.aiff`);
  execFileSync('say', ['-v', VOICE, '-r', '178', '-o', p, text]);
  return { p, secs: Number(execFileSync('afinfo', [p]).toString().match(/estimated duration: ([\d.]+)/)[1]) };
}
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

/** A title card: big title, lines of text, narration. */
function card(name, title, lines, narration, minSecs) {
  const voice = speak(name, narration);
  const secs = Math.max(minSecs, voice.secs + 1.2);
  const draw = [
    `drawtext=fontfile='${BOLD}':textfile='${textfile(name + '-t', title)}':fontsize=84:fontcolor=white:x=(w-text_w)/2:y=230`,
    `drawtext=fontfile='${FONT}':textfile='${textfile(name + '-l', lines.join('\n'))}':fontsize=40:line_spacing=22:fontcolor=0xd2d8d4:x=(w-text_w)/2:y=400`,
    `drawbox=x=(iw-180)/2:y=360:w=180:h=6:color=${GREEN}:t=fill`,
  ].join(',');
  const out = join(TMP, `${name}.mp4`);
  ff(['-f', 'lavfi', '-i', `color=c=${BG}:s=1920x1080:d=${secs}:r=30`, '-i', voice.p, '-filter_complex', `[0:v]${draw}[v];[1:a]apad,atrim=0:${secs}[a]`, '-map', '[v]', '-map', '[a]', ...ENC, '-t', String(secs), out]);
  return out;
}

const intro = card(
  'intro',
  'Handova',
  ['Rent a home in Lagos straight from the landlord.', 'Rent waits in escrow on NEAR until you move in.', 'Your caution fee comes back, held by a lease NFT.', 'Family abroad can pay from any chain.'],
  'In Lagos, renting a home often means paying a full year up front, plus agent fees, to people you have just met. Getting your caution deposit back depends on goodwill. Handova puts the rent in escrow on NEAR.',
  8,
);

// Main section: three phones.
const video = (who) => join(REC, who, readdirSync(join(REC, who)).find((f) => f.endsWith('.webm')));
const total = tl.total / 1000;
const PH = 820;
const PW = Math.round((PH * 390) / 664); // iPhone 13 profile: visible page is 390×664
const xs = { landlord: 400 - PW / 2, nurse: 960 - PW / 2, mum: 1520 - PW / 2 };
const label = { landlord: 'Ade · landlord · Lagos', nurse: 'Daughter · nurse · London', mum: 'Mum · tenant · Lagos' };
const Y = 70;
let f = `color=c=${BG}:s=1920x1080:d=${total}:r=30[bg];`;
['landlord', 'nurse', 'mum'].forEach((who, i) => { f += `[${i}:v]crop=390:664:0:0,scale=${PW}:${PH}:flags=lanczos,setsar=1[p${i}];`; });
f += `[bg][p0]overlay=${xs.landlord}:${Y}[o0];[o0][p1]overlay=${xs.nurse}:${Y}[o1];[o1][p2]overlay=${xs.mum}:${Y}[o2];`;
const draws = [];
for (const who of ['landlord', 'nurse', 'mum']) {
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
f += `[o2]${draws.join(',')}[v];`;
// Narration clips placed at their caption times.
const audioInputs = tl.captions.map((c) => join(REC, c.audio));
audioInputs.forEach((_, i) => { f += `[${3 + i}:a]adelay=${tl.captions[i].start}|${tl.captions[i].start},aresample=48000[a${i}];`; });
f += `${audioInputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,apad,atrim=0:${total}[a]`;
const main = join(TMP, 'main.mp4');
ff(['-i', video('landlord'), '-i', video('nurse'), '-i', video('mum'), ...audioInputs.flatMap((p) => ['-i', p]), '-filter_complex', f, '-map', '[v]', '-map', '[a]', ...ENC, '-t', String(total), main]);

const outro = card(
  'outro',
  'Built on NEAR',
  [
    'Rust escrow + NEP-171 lease NFT that holds the caution fee',
    'Gasless: NEP-366 relayer · named accounts with device keys',
    'Pay from any chain: NEAR Intents 1Click (simulated deposit on testnet)',
    'NEAR AI Cloud: voice note → listing, verified TEE receipt',
    '31 contract tests · 3 sandbox tests · 20 browser end-to-end tests',
    'github.com/UseHandova/handova-near',
  ],
  'Everything you saw ran on NEAR testnet: a Rust escrow and lease NFT, gasless transactions, NEAR Intents, and NEAR AI. Handova. Rent without the agent, and without the fear.',
  12,
);

const list = join(TMP, 'list.txt');
writeFileSync(list, [intro, main, outro].map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
console.log(`wrote ${OUT}`);

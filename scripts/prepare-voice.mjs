/**
 * Cleans up voice clips you recorded yourself so they sound even: trims the silence at both ends,
 * removes low rumble, and levels the loudness (EBU R128, -16 LUFS, the usual level for online video).
 * Checks that every narration line has a clip and says which are missing.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/prepare-voice.mjs <your-clips-dir> [out-dir=voice-own]
 *
 * Clips are named after the line ids in scripts/demo-voiceover.mjs (hello.m4a, intro.m4a, ll1.m4a, …);
 * any common format works (.m4a from iPhone Voice Memos, .mp3, .wav, .aac, .ogg, .webm).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HELLO, INTRO, OUTRO, SCRIPT } from './demo-voiceover.mjs';

const IN = process.argv[2];
const OUT = process.argv[3] ?? 'voice-own';
const FF = process.env.FFMPEG ?? 'ffmpeg';
if (!IN || !existsSync(IN)) {
  console.error('Usage: node scripts/prepare-voice.mjs <folder with your recordings> [out-dir]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const ids = Object.keys({ hello: HELLO, intro: INTRO, ...SCRIPT, outro: OUTRO });
const files = readdirSync(IN);
const missing = [];
// Trim leading/trailing silence (reverse trick for the end), cut rumble, level loudness.
const filter = [
  'highpass=f=80',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
].join(',');

for (const id of ids) {
  const src = files.find((f) => f.toLowerCase().replace(/\.[^.]+$/, '') === id);
  if (!src) { missing.push(id); continue; }
  const out = join(OUT, `${id}.wav`);
  execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', join(IN, src), '-af', filter, '-ar', '48000', '-ac', '1', out]);
  const secs = Number(execFileSync('afinfo', [out]).toString().match(/estimated duration: ([\d.]+)/)[1]);
  console.log(`${id.padEnd(6)} ${secs.toFixed(1)}s  ← ${src}`);
}
if (missing.length) {
  console.error(`\nMissing ${missing.length} clip(s): ${missing.join(', ')}. Record them (see docs/media/record-your-voice.md) and run again.`);
  process.exit(1);
}
console.log(`\nAll ${ids.length} clips are ready in ${OUT}/. Next: DEMO_AUDIO=${OUT} node scripts/record-demo.mjs demo-out`);

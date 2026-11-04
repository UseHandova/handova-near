/**
 * Helps turn a presenter's recording into the demo's narration clips, and checks the words against the script.
 * Transcribes on this computer with whisper.cpp, so the audio goes nowhere.
 *
 *   brew install whisper-cpp
 *   curl -L -o ~/.cache/whisper/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/voice-note.mjs split <recording> [out-dir=my-voice]
 *   FFMPEG=/path/to/ffmpeg node scripts/voice-note.mjs check [clips-dir=my-voice]
 *
 * split: one long recording, lines read in order with about 3 seconds between them. Finds each line by its
 * words, so a retake is fine: the last take of a line wins. check: lists every clip whose words differ.
 * A flagged line means "listen to this", because an accent can make the transcript wrong, not the reading.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELLO, INTRO, OUTRO, SCRIPT } from './demo-voiceover.mjs';

const FF = process.env.FFMPEG ?? 'ffmpeg';
const MODEL = process.env.WHISPER_MODEL ?? join(homedir(), '.cache/whisper/ggml-small.en.bin');
const LINES = { hello: HELLO, intro: INTRO, ...SCRIPT, outro: OUTRO };
const GAP_SECS = Number(process.env.VOICE_GAP_SECS ?? 1.5); // a pause this long separates two lines
const MATCH = 0.5; // a passage with this share of a line's words is a whole take of it

if (!existsSync(MODEL)) { console.error(`No Whisper model at ${MODEL}. See the top of this file.`); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'voice-note-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

/** Lower case words, with the ways Whisper may write brand names folded together. */
const words = (text) => text.toLowerCase()
  .replace(/\bu\.?\s?s\.?\s?d\.?\s?c\.?\b/g, 'usdc').replace(/\bu\.?\s?s\.?\s?d\.?\s?t\.?\b/g, 'usdt')
  .replace(/\bn\.?\s?f\.?\s?t\.?\b/g, 'nft').replace(/\bd\.?\s?a\.?\s?o\.?\b/g, 'dao')
  .replace(/\bhand\s?over\b|\bhandover\b/g, (m) => m.replace(' ', '')).replace(/[^a-z0-9' -]/g, ' ').replace(/-/g, ' ')
  .split(/\s+/).filter(Boolean);

function transcribe(wav) {
  const r = spawnSync('whisper-cli', ['-m', MODEL, '-f', wav, '-nt', '-np', '-l', 'en'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`whisper-cli failed: ${r.error?.message ?? r.stderr}`);
  return r.stdout.replace(/\s+/g, ' ').trim();
}

const toWav = (src, dst, from, to) => execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...(from === undefined ? [] : ['-ss', String(from), '-to', String(to)]), '-i', src, '-ar', '16000', '-ac', '1', dst]);

/** Close enough to be the same word: Whisper often writes a Nigerian name or an accent a letter or two off. */
function same(x, y) {
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 3) return false;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[y.length] <= (Math.max(x.length, y.length) > 6 ? 2 : 1);
}

/** Longest common subsequence: the words of `a` said in order in `b`, and how much of the line that is. */
function compare(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = same(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const missing = [], extra = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) { i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) missing.push(a[i++]); else extra.push(b[j++]);
  }
  missing.push(...a.slice(i)); extra.push(...b.slice(j));
  return { said: t[0][0], score: t[0][0] / Math.max(a.length, b.length, 1), missing, extra };
}

const likelyWrong = [], listenTo = [];

function report(id, heard) {
  const line = words(LINES[id]);
  const { missing, extra } = compare(line, words(heard));
  if (!missing.length && !extra.length) return true;
  // A word or two off is usually Whisper mishearing an accent or a name; a big gap is usually a real change.
  (missing.length / line.length >= 0.3 ? likelyWrong : listenTo).push(id);
  console.log(`\n✗ ${id}\n  script: ${LINES[id]}\n  heard:  ${heard}\n  missing: ${missing.join(' ') || '-'}\n  extra:   ${extra.join(' ') || '-'}`);
  return false;
}

function summary() {
  if (likelyWrong.length) console.log(`Likely wrong, listen first: ${likelyWrong.join(', ')}`);
  if (listenTo.length) console.log(`Small differences, probably mishearings: ${listenTo.join(', ')}`);
}

/** Stretches of speech in a recording, from ffmpeg's silence detector. */
function passages(src) {
  const log = spawnSync(FF, ['-hide_banner', '-i', src, '-af', `silencedetect=noise=-38dB:d=${GAP_SECS}`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const length = (() => { const m = log.match(/Duration: (\d+):(\d+):([\d.]+)/); if (!m) throw new Error(`${src} isn't a recording ffmpeg can read.`); return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); })();
  const out = [];
  let at = 0;
  for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') { if (Number(m[2]) - at > 0.3) out.push({ from: Math.max(0, at - 0.15), to: Number(m[2]) + 0.15 }); } else at = Number(m[2]);
  }
  if (length - at > 0.3) out.push({ from: Math.max(0, at - 0.15), to: length });
  return out;
}

/**
 * Gives each passage a line, in reading order: the choice that matches the most words overall, so a line read
 * wrongly still lands in its own place. Passages on one line are retakes if they repeat the same words (the
 * last wins), or pieces of one take if they add new words, as when a long pause splits the line.
 */
function takes(parts) {
  const ids = Object.keys(LINES);
  const said = parts.map((p) => ids.map((id) => compare(words(LINES[id]), words(p.text)).said));
  const SKIP = 3; // cost of leaving a line out
  let best = ids.map((_, l) => said[0][l] - l * SKIP);
  const from = [ids.map(() => -1)];
  for (let i = 1; i < parts.length; i++) {
    const next = [], back = [];
    for (let l = 0; l < ids.length; l++) {
      let top = -Infinity, at = 0;
      for (let k = 0; k <= l; k++) {
        const v = best[k] - Math.max(0, l - k - 1) * SKIP;
        if (v > top) { top = v; at = k; }
      }
      next.push(top + said[i][l]);
      back.push(at);
    }
    best = next;
    from.push(back);
  }
  let l = best.indexOf(Math.max(...best));
  const line = new Array(parts.length);
  for (let i = parts.length - 1; i >= 0; i--) { line[i] = l; l = from[i][l]; }
  const out = {};
  parts.forEach((p, i) => {
    const id = ids[line[i]], script = words(LINES[id]), alone = said[i][line[i]];
    if (!out[id]) { out[id] = { id, from: p.from, to: p.to, heard: p.text }; return; }
    // New words of the line: the next piece of the same take. The same words again: a retake.
    if (compare(script, words(`${out[id].heard} ${p.text}`)).said >= Math.max(alone, compare(script, words(out[id].heard)).said) + 2) {
      out[id].to = p.to;
      out[id].heard += ` ${p.text}`;
    } else if (alone / script.length >= MATCH) out[id] = { id, from: p.from, to: p.to, heard: p.text };
    else console.log(`  skipped at ${p.from.toFixed(1)}s: "${p.text.slice(0, 70)}"`);
  });
  return out;
}

function split(src, dir) {
  if (!existsSync(src)) { console.error(`Can't find ${src}. Check the path and try again.`); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  const parts = passages(src);
  console.log(`${parts.length} passages of speech found`);
  parts.forEach((p, i) => { const w = join(tmp, `p${i}.wav`); toWav(src, w, p.from, p.to); p.text = transcribe(w); });
  const take = takes(parts);
  for (const t of Object.values(take)) execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t.from), '-to', String(t.to), '-i', src, '-ar', '48000', '-ac', '1', join(dir, `${t.id}.wav`)]);
  const missing = Object.keys(LINES).filter((id) => !take[id]);
  console.log(`${Object.keys(take).length} of ${Object.keys(LINES).length} lines cut into ${dir}/`);
  if (missing.length) console.log(`Not found: ${missing.join(', ')}`);
  const clean = Object.values(take).filter((t) => report(t.id, t.heard)).length;
  console.log(`\n${clean} lines match the script word for word.`);
  summary();
  process.exitCode = missing.length ? 1 : 0;
}

function check(dir) {
  const files = readdirSync(dir);
  let clean = 0;
  const missing = [];
  for (const id of Object.keys(LINES)) {
    const f = files.find((x) => x.toLowerCase().replace(/\.[^.]+$/, '') === id);
    if (!f) { missing.push(id); continue; }
    const w = join(tmp, `${id}.wav`);
    toWav(join(dir, f), w);
    if (report(id, transcribe(w))) clean++;
  }
  console.log(`\n${clean} of ${Object.keys(LINES).length} lines match the script word for word.`);
  summary();
  if (missing.length) console.log(`No clip for: ${missing.join(', ')}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'split' && a) split(a, b ?? 'my-voice');
else if (cmd === 'check') check(a ?? 'my-voice');
else { console.error('Usage: node scripts/voice-note.mjs split <recording> [out-dir] | check [clips-dir]'); process.exit(1); }

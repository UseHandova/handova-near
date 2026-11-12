/**
 * Makes the walkthrough narration with YarnGPT, one clip per line (default voice: umar). Clips already
 * in the folder are skipped, so a failed run can be started again. Each clip costs YarnGPT credits.
 *
 *   node --env-file=.env scripts/walkthrough/voice.mjs [out-dir=voice-walkthrough] [voice=umar]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINES } from './script.mjs';

const API = 'https://api.yarngpt.ai/api/v1';
const KEY = process.env.YARNGPT_API_KEY;
if (!KEY) { console.error('Set YARNGPT_API_KEY in .env and run again.'); process.exit(1); }
const OUT = process.argv[2] ?? 'voice-walkthrough';
const VOICE = process.argv[3] ?? 'umar';
mkdirSync(OUT, { recursive: true });

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = body.error ?? {}; throw new Error(`YarnGPT ${res.status} ${e.code ?? ''}: ${e.user_message ?? e.message ?? res.statusText}`); }
  return body;
}
// Said the way people say them, not letter by letter.
const spoken = (t) => t.replace(/\bNEAR\b/g, 'Near').replace(/\bUSDC\b/g, 'U.S.D.C.').replace(/\bNFT\b/g, 'N.F.T.').replace(/\bDAO\b/g, 'dao');

for (const { id, text } of LINES) {
  const file = join(OUT, `${id}.mp3`);
  if (existsSync(file)) { console.log(`${id}: already there`); continue; }
  const job = await call('/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `handova-walk-${VOICE}-${id}-${text.length}` },
    body: JSON.stringify({ text: spoken(text), output_format: 'mp3', voice: VOICE }),
  });
  let s;
  for (;;) {
    s = await call(`/status/${job.job_id}`);
    if (s.status === 'completed' || s.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (s.status === 'failed') throw new Error(`${id}: ${s.user_message ?? 'YarnGPT could not make this clip'}`);
  const audio = await fetch(s.audio_url);
  if (!audio.ok) throw new Error(`${id}: download failed (${audio.status}); run again`);
  writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
  console.log(`${id}: ${file}`);
}

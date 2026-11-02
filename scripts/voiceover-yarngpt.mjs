/**
 * Generates the demo narration with YarnGPT (Nigerian voices) as one clip per line, ready for
 * DEMO_AUDIO=<dir> in record-demo.mjs and compose-demo.mjs. Each clip costs YarnGPT credits.
 *
 *   YARNGPT_API_KEY=... node scripts/voiceover-yarngpt.mjs --voices        # list voice ids
 *   YARNGPT_API_KEY=... node scripts/voiceover-yarngpt.mjs voice [voiceId]  # write voice/<id>.mp3
 *
 * Clips already in the folder are skipped, so a failed run can simply be started again.
 * Docs: https://yarngpt.ai/api-docs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELLO, INTRO, OUTRO, SCRIPT } from './demo-voiceover.mjs';

const API = 'https://api.yarngpt.ai/api/v1';
const KEY = process.env.YARNGPT_API_KEY;
if (!KEY) {
  console.error('Set YARNGPT_API_KEY (create one on your YarnGPT Account page) and run again.');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${KEY}` };

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Error(`YarnGPT ${res.status} ${e.code ?? ''}: ${e.user_message ?? e.message ?? res.statusText} (trace ${e.trace_id ?? '-'})`);
  }
  return body;
}

if (process.argv[2] === '--voices') {
  console.log(JSON.stringify(await call('/voices'), null, 2));
  process.exit(0);
}

const OUT = process.argv[2] ?? 'voice';
const VOICE = process.argv[3] ?? process.env.YARNGPT_VOICE;
mkdirSync(OUT, { recursive: true });
// YarnGPT may read the brand names letter by letter or oddly; spell them the way they are said.
const spoken = (text) => text.replace(/\bNEAR\b/g, 'Near').replace(/\bUSDC\b/g, 'U.S.D.C.');
const lines = { hello: HELLO, intro: INTRO, ...SCRIPT, outro: OUTRO };

for (const [id, text] of Object.entries(lines)) {
  const file = join(OUT, `${id}.mp3`);
  if (existsSync(file)) { console.log(`${id}: already there, skipped`); continue; }
  const job = await call('/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `handova-demo-${VOICE ?? 'default'}-${id}-${text.length}` },
    body: JSON.stringify({ text: spoken(text), output_format: 'mp3', ...(VOICE ? { voice: VOICE } : {}) }),
  });
  let status;
  for (;;) {
    status = await call(`/status/${job.job_id}`);
    if (status.status === 'completed' || status.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (status.status === 'failed') throw new Error(`${id}: ${status.user_message ?? 'YarnGPT could not make this clip'}`);
  const audio = await fetch(status.audio_url);
  if (!audio.ok) throw new Error(`${id}: download failed (${audio.status}); run again to retry`);
  writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
  console.log(`${id}: ${file}`);
}
console.log(`\nAll ${Object.keys(lines).length} clips are in ${OUT}/. Next: DEMO_AUDIO=${OUT} node scripts/record-demo.mjs demo-out`);

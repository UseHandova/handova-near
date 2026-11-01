/**
 * Independent judging-panel review of this repo by several models on NEAR AI Cloud.
 *
 *   bun run scripts/ai-review.ts [extra-notes-file]
 *
 * Builds one packet (hackathon rules, README, key source, git log, test results) and asks each
 * model, separately, to score the project as a hackathon judge and be brutally honest.
 * Writes docs/ai-review-<date>/<model>.md and prints a short summary. Needs NEARAI_API_KEY.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MODELS = (process.env.REVIEW_MODELS ?? 'anthropic/claude-fable-5-1,openai/gpt-5.5,moonshotai/kimi-k3,z-ai/glm-5.3,google/gemini-3.8-flash').split(',');
const KEY = process.env.NEARAI_API_KEY;
if (!KEY) throw new Error('NEARAI_API_KEY is not set');

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : `(missing: ${p})`);
const file = (p: string) => `\n===== FILE: ${p} =====\n${read(p)}`;
const sh = (c: string) => execSync(c, { encoding: 'utf8' });

const notes = process.argv[2] ? read(process.argv[2]) : '';
const packet = [
  '# PACKET FOR REVIEW: Handova (NEAR edition)',
  `Date: ${new Date().toISOString().slice(0, 10)}. Hackathon development ends 2026-11-14 23:59 UTC. The team expects thousands of submissions.`,
  notes && `\n## Notes from the team (current status, honest)\n${notes}`,
  file('docs/HACKATHON.md'),
  file('README.md'),
  file('REPRODUCE.md'),
  file('contract/src/lib.rs'),
  file('contract/src/escrow.rs'),
  file('contract/src/nft.rs'),
  file('server/near/relayer.ts'),
  file('server/near/accounts.ts'),
  file('server/near/intents.ts'),
  `\n===== git log (all commits) =====\n${sh('git log --format="%h %ad %s" --date=short')}`,
  `\n===== repository files =====\n${sh('git ls-files | grep -v "^bun.lock$"')}`,
].filter(Boolean).join('\n');

const PROMPT = `You are one of the judges and AI screeners of NEAR HACKATHON (rules and tracks are in the packet). Thousands of teams submit. Review the project "Handova" from the packet as you would in judging: what is really built (check the code, not only the README), how deep and correct the NEAR usage is, real-world impact, originality, completeness, reproducibility, and how it compares with what strong hackathon winners look like.

Be as harsh as the real judging panel. Most of the thousands of entries win nothing, so start from "this does not place" and let only evidence in the code and tests move you. Don't trust README claims you can't verify in the code. Penalise anything unfinished, simulated, or not used by real people. If you don't think it wins, say so plainly and explain why. No flattery, no encouragement, no hedging filler.

Answer in Markdown with exactly these sections:
1. **Verdict** (3-5 sentences).
2. **Scores (0-10)** table: Problem & real-world impact; Depth/correctness of NEAR usage; Originality; Completeness/polish; Reproducibility for AI screeners; Demo-ability; Overall.
3. **Track fit**: which track ids to submit to, each with a 0-10 fit score and one line.
4. **Chance of winning**: your honest probability estimates for (a) top 3 in the best track, (b) 1st in that track, (c) grand prize — with the reasoning and assumptions.
5. **What an AI screener will flag** (bugs, gaps, inconsistencies between README and code, risky claims).
6. **Code/security issues you found** (be specific: file + what is wrong). Say "none found" only if you looked.
7. **Top 10 improvements for the remaining days**, ranked by impact on winning, each with effort (S/M/L).
8. **What would make you vote for it as the winner** (the one or two things that would change your mind).`;

const outDir = `docs/ai-review-${new Date().toISOString().slice(0, 10)}${process.env.REVIEW_TAG ? `-${process.env.REVIEW_TAG}` : ""}`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/packet.md`, packet);
console.log(`Packet: ~${Math.round(packet.length / 4).toLocaleString()} tokens → ${MODELS.length} models`);

async function review(model: string) {
  const body: any = {
    model,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: packet },
    ],
    max_tokens: Number(process.env.REVIEW_MAX_TOKENS ?? 24000),
  };
  if (!model.startsWith('google/')) body.reasoning_effort = process.env.REVIEW_REASONING ?? 'medium';
  const t0 = Date.now();
  let r = await fetch('https://cloud-api.near.ai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok && body.reasoning_effort) {
    delete body.reasoning_effort; // some providers reject the parameter
    r = await fetch('https://cloud-api.near.ai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${model}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  const text: string = j.choices?.[0]?.message?.content ?? '';
  const file = `${outDir}/${model.replace(/\//g, '_')}.md`;
  writeFileSync(file, `> Review by **${model}** via NEAR AI Cloud, ${new Date().toISOString()} (${Math.round((Date.now() - t0) / 1000)}s, ${j.usage?.prompt_tokens ?? '?'} in / ${j.usage?.completion_tokens ?? '?'} out tokens)\n\n${text}\n`);
  return { model, file, chars: text.length };
}

const results = await Promise.allSettled(MODELS.map(review));
for (const r of results) console.log(r.status === 'fulfilled' ? `✓ ${r.value.model} → ${r.value.file}` : `✗ ${(r.reason as Error).message}`);

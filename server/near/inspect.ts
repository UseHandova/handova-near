/**
 * Move-out inspection with NEAR AI: compares the listing's photos (the condition the landlord advertised)
 * with photos taken at move-out, lists clear damage and suggests how much of the caution fee the landlord
 * could fairly keep. Every answer has a signed receipt the server checks against NEAR AI's attestation
 * report (see ai.ts). The "before" photos are the ones in the listing details the escrow copied onto the
 * lease when the tenant paid, so editing the listing later can't change them.
 *
 * Advice only. The landlord and the tenant agree a split, or the arbiter (a DAO council) decides; the
 * escrow never reads this. Only the landlord or the lease holder can ask, proven with a NEP-413 signed
 * message, and only while the move-out is being reviewed or disputed. Inspections are kept in a file on
 * Handova's server, with who asked for each. That is a record we run, not an on-chain one.
 */
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PublicKey } from 'near-api-js';
import { nep413Hash } from '../../shared/nep413';
import { verifiedJson, VISION_MODEL, type Receipt } from './ai';
import { deploy, env } from './config';
import { provider, view } from './chain';
import { RateLimit } from './rate-limit';
import { readMediaFile } from '../media';

export interface InspectionResult {
  issues: { area: string; issue: string; severity: 'minor' | 'moderate' | 'major' }[];
  normalWearOnly: boolean;
  /** Share of the caution fee (0–100) the landlord could fairly keep. */
  suggestedDeductionPercent: number;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface Inspection {
  at: number;
  requestedBy: string;
  before: string[];
  after: string[];
  result: InspectionResult;
  receipt: Receipt;
}

const PROMPT = `You help settle a caution-fee (security deposit) question on Handova, a Lagos rental platform.
You get BEFORE photos (from the listing, the condition the landlord advertised) and AFTER photos (taken at move-out).
List only clear damage visible in the AFTER photos that is not in the BEFORE photos: broken fittings, holes, burns,
stains that need repair, missing items. Ignore normal wear and tear, dust or mess that cleaning fixes, and differences
in lighting, angle or furniture. If the photos don't show the same rooms, say so and keep the deduction low.
Return ONLY JSON:
{"issues":[{"area":"e.g. kitchen door","issue":"short description","severity":"minor"|"moderate"|"major"}],
 "normalWearOnly": true/false,
 "suggestedDeductionPercent": integer 0-100 (share of the caution fee to cover repairs; 0 if nothing clear),
 "summary": "one or two plain sentences for the tenant and the landlord",
 "confidence": "low"|"medium"|"high"}
You never decide. The tenant and landlord agree, or a council decides.`;

/** Keep the model's answer within the rules whatever it returns. */
export function cleanResult(r: Partial<InspectionResult>): InspectionResult {
  const sev = (s: unknown) => (s === 'major' || s === 'moderate' ? s : 'minor');
  return {
    issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 12).map((i: any) => ({ area: String(i?.area ?? '').slice(0, 80), issue: String(i?.issue ?? '').slice(0, 200), severity: sev(i?.severity) })),
    normalWearOnly: !!r.normalWearOnly,
    suggestedDeductionPercent: Math.max(0, Math.min(100, Math.round(Number(r.suggestedDeductionPercent) || 0))),
    summary: String(r.summary ?? '').slice(0, 500),
    confidence: r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low',
  };
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
/** Photos are read from Handova's own media store by name, never fetched from a URL the caller chose. */
const MEDIA_RE = /^https?:\/\/[^/]+\/api\/media\/([a-f0-9]{24}\.(jpg|png|webp))$/;


export function mountInspect(app: Express) {
  const dataFile = env('INSPECTION_DATA_FILE') ?? 'server/data/inspections.json';
  const challenges = new Map<string, { accountId: string; leaseId: number; message: string; expiresAt: number }>();
  const perIp = new RateLimit(20, 60 * 60_000);
  const perLease = new RateLimit(6, 24 * 60 * 60_000);

  const load = (): Record<string, Inspection[]> => {
    try { return JSON.parse(readFileSync(dataFile, 'utf8')); } catch { return {}; }
  };
  const save = (s: Record<string, Inspection[]>) => {
    if (!existsSync(dirname(dataFile))) mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(s), { mode: 0o600 });
  };

  /** A stored photo as a data URL (the model gets the exact bytes hashed in the receipt). */
  function dataUrl(url: string): string {
    const name = url.match(MEDIA_RE)?.[1] ?? '';
    const bytes = readMediaFile(name);
    if (!bytes) throw new Error(`photo not found: ${name}`);
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `data:${type};base64,${bytes.toString('base64')}`;
  }

  app.get('/api/ai/inspections', (req, res) => {
    res.json({ inspections: load()[String(Number(req.query.leaseId))] ?? [] });
  });

  app.get('/api/ai/inspect/challenge', (req, res) => {
    const accountId = String(req.query.accountId ?? '');
    const leaseId = Number(req.query.leaseId);
    if (!ACCOUNT_RE.test(accountId) || !Number.isInteger(leaseId)) return res.status(400).json({ error: 'Missing account or lease.' });
    const nonce = randomBytes(32).toString('base64');
    const message = `Handova move-out inspection\n\nI, ${accountId}, ask NEAR AI to compare the move-out photos of lease #${leaseId} with the listing photos.\n\nIssued: ${new Date().toISOString()}`;
    challenges.set(nonce, { accountId, leaseId, message, expiresAt: Date.now() + 10 * 60_000 });
    res.json({ nonce, message, recipient: deploy.escrow });
  });

  app.post('/api/ai/inspect', async (req, res) => {
    if (!env('NEARAI_API_KEY')) return res.status(503).json({ error: 'AI inspections are switched off on this server.' });
    if (!perIp.take(req.ip ?? 'ip')) return res.status(429).json({ error: 'Too many inspections. Try again later.' });
    const { accountId, nonce, signature, publicKey, after } = req.body ?? {};
    const c = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (typeof nonce === 'string') challenges.delete(nonce);
    if (!c || c.expiresAt < Date.now() || c.accountId !== accountId) return res.status(401).json({ error: 'Your request expired. Try again.' });
    try {
      const ok = PublicKey.from(String(publicKey)).verify(nep413Hash({ message: c.message, nonce: Buffer.from(nonce, 'base64'), recipient: deploy.escrow }), Buffer.from(String(signature), 'base64'));
      const key: any = ok ? await provider.viewAccessKey({ accountId, publicKey: String(publicKey) }) : null;
      if (key?.permission !== 'FullAccess') throw new Error('bad key');
    } catch {
      return res.status(401).json({ error: "We couldn't confirm you control this account." });
    }

    const lease: any = await view(deploy.escrow, 'get_lease', { lease_id: c.leaseId }).catch(() => null);
    if (!lease) return res.status(404).json({ error: `Lease #${c.leaseId} doesn't exist.` });
    const holder = lease.nft_holder ?? lease.tenant;
    if (accountId !== lease.landlord && accountId !== holder) return res.status(403).json({ error: 'Only the landlord or the tenant holding the lease can ask for an inspection.' });
    if (lease.status !== 'Ending' && lease.status !== 'Disputed') return res.status(409).json({ error: 'Inspections are for the move-out review or a caution dispute.' });
    const afterUrls = (Array.isArray(after) ? after : []).map(String).filter((u) => MEDIA_RE.test(u)).slice(0, 3);
    if (!afterUrls.length) return res.status(400).json({ error: 'Add at least one move-out photo.' });
    if (!perLease.take(String(c.leaseId))) return res.status(429).json({ error: 'This lease has had enough inspections today.' });

    let beforeUrls: string[] = [];
    try { beforeUrls = (JSON.parse(lease.property_ref).p ?? []).map(String).filter((u: string) => MEDIA_RE.test(u)).slice(0, 3); } catch { /* listing without photos */ }

    try {
      const beforeImgs = beforeUrls.map(dataUrl);
      const afterImgs = afterUrls.map(dataUrl);
      const content: unknown[] = [{ type: 'text', text: beforeImgs.length ? `BEFORE (listing) photos: ${beforeImgs.length}. AFTER (move-out) photos: ${afterImgs.length}.` : 'There are no BEFORE photos: judge only obvious damage in the AFTER photos and keep confidence low.' }];
      beforeImgs.forEach((u, i) => content.push({ type: 'text', text: `BEFORE ${i + 1}` }, { type: 'image_url', image_url: { url: u } }));
      afterImgs.forEach((u, i) => content.push({ type: 'text', text: `AFTER ${i + 1}` }, { type: 'image_url', image_url: { url: u } }));
      const { data, receipt } = await verifiedJson<InspectionResult>(VISION_MODEL, [{ role: 'system', content: PROMPT }, { role: 'user', content }], 1500);
      const inspection: Inspection = { at: Date.now(), requestedBy: accountId, before: beforeUrls, after: afterUrls, result: cleanResult(data), receipt };
      const all = load();
      all[String(c.leaseId)] = [...(all[String(c.leaseId)] ?? []), inspection];
      save(all);
      res.json({ inspection });
    } catch (e) {
      console.error('inspect:', (e as Error).message.slice(0, 300));
      res.status(502).json({ error: "NEAR AI couldn't compare the photos. Try again, or settle it without the AI." });
    }
  });
}

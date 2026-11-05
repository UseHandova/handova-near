/**
 * Landlord identity verification with Didit (hosted ID document + liveness + face match), recorded on NEAR.
 *
 *   1. GET  /api/verify/challenge?accountId=…   → a one-time NEP-413 message for the landlord to sign
 *   2. POST /api/verify/didit/session            → checks the signature (the caller controls the account),
 *                                                  starts a Didit session, returns Didit's page URL
 *   3. The landlord does the ID + selfie steps on Didit, which sends them back to the app
 *   4. POST /api/verify/didit/complete|resume    → reads Didit's decision; if approved, the verifier
 *                                                  account calls `set_verified(account, true)` on the escrow
 *
 * Only an approved landlord gets the on-chain badge, which tenants see on listings and which lifts the
 * 3-home limit. One ID document can verify one account; IDs are
 * kept only as a keyed hash. Personal data (names, ID numbers, photos) is never logged or stored: Didit holds it.
 */
import type { Express, Request, Response } from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PublicKey, teraToGas } from 'near-api-js';
import { nep413Hash } from '../../shared/nep413';
import { deploy, env } from './config';
import { provider, verifier, view } from './chain';
import { RateLimit } from './rate-limit';

const CHALLENGE_TTL_MS = 10 * 60_000;
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

interface Store {
  /** Keyed hash of an ID document (issuing country + number) → the one account it verified. */
  idHashes: Record<string, string>;
  /** Didit session id → the account that started it, so a result can only credit that account. */
  sessions: Record<string, { accountId: string; createdAt: number }>;
}

interface DiditFeature { status?: string; document_number?: string; personal_number?: string; full_name?: string; issuing_state?: string }
interface DiditDecision {
  status?: string;
  vendor_data?: string;
  id_verifications?: DiditFeature[] | null;
  liveness_checks?: DiditFeature[] | null;
  face_matches?: DiditFeature[] | null;
}

type Outcome = { status: number; body: Record<string, unknown> };

export function mountVerify(app: Express) {
  const apiKey = env('DIDIT_API_KEY');
  const workflowId = env('DIDIT_WORKFLOW_ID');
  const diditBase = env('DIDIT_BASE_URL') ?? 'https://verification.didit.me';
  const dataFile = env('VERIFICATION_DATA_FILE') ?? 'server/data/verifications.json';
  // Where Didit may send people back to: our own app only.
  const returnUrls = (env('VERIFY_RETURN_URLS') ?? 'https://handova-near.vercel.app,http://localhost:5188')
    .split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
  const pepper = env('ID_PEPPER') ?? createHash('sha256').update(`handova-id:${env('VERIFIER_NEAR_PRIVATE_KEY') ?? ''}`).digest('hex');
  const ready = () => !!(apiKey && workflowId && verifier);

  const challenges = new Map<string, { accountId: string; message: string; expiresAt: number }>();
  const perAccount = new RateLimit(5, 24 * 60 * 60_000);
  const perIp = new RateLimit(30, 60 * 60_000);

  const load = (): Store => {
    try {
      const s = JSON.parse(readFileSync(dataFile, 'utf8'));
      return { idHashes: s.idHashes ?? {}, sessions: s.sessions ?? {} };
    } catch {
      return { idHashes: {}, sessions: {} };
    }
  };
  const save = (s: Store) => {
    if (!existsSync(dirname(dataFile))) mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  const idHash = (s: string) => createHmac('sha256', pepper).update(s).digest('hex');
  const fail = (res: Response, status: number, code: string, error: string) => res.status(status).json({ ok: false, code, error });
  const out = (status: number, code: string, error: string): Outcome => ({ status, body: { ok: false, code, error } });

  const isVerified = (accountId: string) => view<boolean>(deploy.escrow, 'is_verified', { account_id: accountId }).catch(() => false);

  const didit = (path: string, init: RequestInit = {}) =>
    fetch(`${diditBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });

  /** The caller signed our single-use NEP-413 challenge with a full-access key of `accountId`. */
  async function ownsAccount(body: any): Promise<[number, string, string] | null> {
    const { accountId, nonce, signature, publicKey } = body ?? {};
    if (typeof accountId !== 'string' || !ACCOUNT_RE.test(accountId)) return [400, 'bad_account', 'That is not a NEAR account name.'];
    const c = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (typeof nonce === 'string') challenges.delete(nonce);
    if (!c || c.expiresAt < Date.now() || c.accountId !== accountId) return [401, 'bad_challenge', 'Your verification request expired. Start again.'];
    try {
      const hash = nep413Hash({ message: c.message, nonce: Buffer.from(nonce, 'base64'), recipient: deploy.escrow });
      const sig = Buffer.from(String(signature), 'base64');
      if (!PublicKey.from(String(publicKey)).verify(hash, sig)) return [401, 'bad_signature', "We couldn't confirm you control this account. Try again."];
      const key: any = await provider.viewAccessKey({ accountId, publicKey: String(publicKey) });
      if (key?.permission !== 'FullAccess') return [401, 'bad_signature', 'Sign with your account key, not an app-limited key.'];
    } catch {
      return [401, 'bad_signature', "We couldn't confirm you control this account. Try again."];
    }
    return null;
  }

  /** Write the badge on NEAR and remember which account this ID verified. */
  async function recordVerified(accountId: string, hash: string): Promise<string> {
    const outcome: any = await verifier!.callFunctionRaw({
      contractId: deploy.escrow,
      methodName: 'set_verified',
      args: { account_id: accountId, verified: true },
      gas: teraToGas('30'),
    });
    const s = load();
    s.idHashes[hash] = accountId;
    save(s);
    const tx = outcome?.transaction?.hash ?? '';
    console.log(`[verify] ${accountId} verified on-chain (${tx})`);
    return tx;
  }

  /** Read Didit's decision for one of our sessions; if approved, record the badge. */
  async function finish(sessionId: string): Promise<Outcome> {
    const session = load().sessions[sessionId];
    if (!session) return out(404, 'unknown_session', "We couldn't find that verification. Start again.");
    const r = await didit(`/v3/session/${sessionId}/decision/`).catch(() => null);
    const d = (await r?.json().catch(() => null)) as DiditDecision | null;
    if (!r?.ok || !d) return out(502, 'provider_error', "Couldn't read the verification result. Try again in a minute.");
    if (d.vendor_data !== session.accountId) return out(409, 'session_mismatch', 'This verification belongs to a different account.');

    const status = d.status ?? '';
    if (status === 'In Review') return { status: 202, body: { ok: false, code: 'in_review', error: 'A person at Didit is reviewing your documents. This usually takes a few minutes. Check back soon.' } };
    if (['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted'].includes(status)) return out(409, 'not_finished', "Verification isn't finished yet. Complete the steps on the Didit page.");
    if (['Expired', 'Abandoned', 'Kyc Expired'].includes(status)) return out(410, 'expired', 'That verification expired. Start again.');

    const doc = d.id_verifications?.[0];
    const failed = [
      doc?.status !== 'Approved' && 'your ID document',
      d.liveness_checks?.[0] && d.liveness_checks[0].status !== 'Approved' && 'the liveness check',
      d.face_matches?.[0] && d.face_matches[0].status !== 'Approved' && 'matching your face to your ID',
    ].filter(Boolean);
    if (status !== 'Approved' || failed.length) {
      return out(422, 'declined', `Verification didn't pass${failed.length ? ` (${failed.join(', ')})` : ''}. Use a clear photo of a valid ID and follow the selfie steps in good light.`);
    }

    // One ID document ↔ one account.
    const idNumber = (doc?.personal_number || doc?.document_number || '').replace(/\s/g, '').toUpperCase();
    if (!idNumber) return out(422, 'declined', "We couldn't read the number on your ID. Try again with a clearer photo.");
    const hash = idHash(`${doc?.issuing_state ?? ''}:${idNumber}`);
    const linked = load().idHashes[hash];
    if (linked && linked !== session.accountId) return out(409, 'id_in_use', 'This ID is already linked to another Handova account.');

    try {
      const txHash = await recordVerified(session.accountId, hash);
      const s = load();
      delete s.sessions[sessionId];
      save(s);
      return { status: 200, body: { ok: true, txHash, firstName: (doc?.full_name ?? '').split(' ')[0] || null } };
    } catch (e) {
      console.error('[verify] on-chain write failed:', (e as Error).message);
      return out(502, 'chain_error', "You passed the check, but your badge couldn't be saved on NEAR. Try again in a minute.");
    }
  }

  app.get('/api/verify/config', (_req, res) => {
    res.json({ provider: ready() ? 'didit' : null, recipient: deploy.escrow });
  });

  app.get('/api/verify/status', async (req, res) => {
    const accountId = String(req.query.accountId ?? '');
    if (!ACCOUNT_RE.test(accountId)) return fail(res, 400, 'bad_account', 'That is not a NEAR account name.');
    res.json({ verified: await isVerified(accountId) });
  });

  app.get('/api/verify/challenge', (req, res) => {
    const accountId = String(req.query.accountId ?? '');
    if (!ACCOUNT_RE.test(accountId)) return fail(res, 400, 'bad_account', 'That is not a NEAR account name.');
    const nonce = randomBytes(32).toString('base64');
    const message = `Handova identity check\n\nI control ${accountId} and agree to have my identity checked by Didit for a verified-landlord badge on NEAR.\n\nIssued: ${new Date().toISOString()}`;
    challenges.set(nonce, { accountId, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    res.json({ nonce, message, recipient: deploy.escrow });
  });

  /** Start Didit's hosted check for an account the caller proved they control. */
  app.post('/api/verify/didit/session', async (req: Request, res: Response) => {
    if (!perIp.take(req.ip ?? 'ip')) return fail(res, 429, 'too_many_attempts', 'Too many attempts. Try again later.');
    const owner = await ownsAccount(req.body);
    if (owner) return fail(res, ...owner);
    const accountId: string = req.body.accountId;
    if (!ready()) return fail(res, 503, 'not_configured', 'Identity checks are switched off on this server right now.');
    if (await isVerified(accountId)) return res.json({ ok: true, alreadyVerified: true });
    if (!perAccount.take(accountId)) return fail(res, 429, 'too_many_attempts', 'Too many attempts today. Try again tomorrow.');

    const asked = typeof req.body.returnTo === 'string' ? req.body.returnTo.replace(/\/$/, '') : '';
    const back = returnUrls.includes(asked) ? asked : returnUrls[0];
    const r = await didit('/v3/session/', {
      method: 'POST',
      // Didit appends ?verificationSessionId=…&status=… to the callback; the app picks it up on load.
      body: JSON.stringify({ workflow_id: workflowId, vendor_data: accountId, callback: `${back}/`, metadata: { app: 'handova-near' } }),
    }).catch(() => null);
    const body = (await r?.json().catch(() => ({}))) as { session_id?: string; url?: string; detail?: string };
    if (!r?.ok || !body.session_id || !body.url) {
      console.error(`[verify] Didit session failed (HTTP ${r?.status ?? 'network'})`, body?.detail ?? '');
      return fail(res, 502, 'provider_error', "Couldn't start the identity check. Try again in a minute.");
    }
    const s = load();
    s.sessions[body.session_id] = { accountId, createdAt: Date.now() };
    save(s);
    res.json({ ok: true, url: body.url, sessionId: body.session_id });
  });

  /** Back from Didit: collect the result of one session. */
  app.post('/api/verify/didit/complete', async (req, res) => {
    const sessionId = String(req.body?.sessionId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return fail(res, 400, 'bad_session', 'That verification link is not valid.');
    if (!ready()) return fail(res, 503, 'not_configured', 'Identity checks are switched off on this server right now.');
    const r = await finish(sessionId);
    res.status(r.status).json(r.body);
  });

  /**
   * Collect a finished session the landlord never came back for (closed tab, finished on another phone
   * through Didit's QR code). Only ever credits the account bound to the session.
   */
  app.post('/api/verify/didit/resume', async (req, res) => {
    const accountId = String(req.body?.accountId ?? '');
    if (!ACCOUNT_RE.test(accountId)) return fail(res, 400, 'bad_account', 'That is not a NEAR account name.');
    if (!ready()) return res.json({ ok: false, code: 'not_configured' });
    const mine = Object.entries(load().sessions)
      .filter(([, v]) => v.accountId === accountId)
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, 5);
    let pending: Outcome | null = null;
    for (const [id] of mine) {
      const r = await finish(id);
      if (r.body.ok) return res.json(r.body);
      if (r.body.code === 'in_review' && !pending) pending = r;
    }
    res.json(pending?.body ?? { ok: false, code: 'none' });
  });
}

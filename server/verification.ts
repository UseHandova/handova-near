/**
 * Landlord identity verification (KYC) — NIN + selfie face-match via Dojah, recorded onchain.
 *
 * Flow:
 *   1. GET  /api/verify/challenge?address=0x…  → one-time message for the landlord's wallet to sign
 *   2. POST /api/verify  { address, nonce, signature, nin, selfie }
 *        - proves the caller controls `address` (EOA, ERC-1271 or ERC-6492 smart-account signature)
 *        - one NIN can verify only one Handova account (stored as an HMAC, never the raw NIN)
 *        - Dojah checks the NIN with NIMC and face-matches the selfie against the NIN photo
 *        - on a match the verifier key calls RentFlowEscrow.setVerified(address, true)
 *
 * Personal data (NIN, selfie, names) is never logged or written to disk.
 */

import express, { type Express, type Request as Req, type Response as Res } from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, createWalletClient, isAddress, isHex, type Address, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN } from '../src/lib/network';
import { arcTransport } from '../src/lib/arc-rpc';

const ESCROW_VERIFY_ABI = [
  { inputs: [{ name: 'landlord', type: 'address' }, { name: 'verified', type: 'bool' }], name: 'setVerified', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'verifiedAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export interface VerificationConfig {
  rpcUrl: string;
  /** Chain the verifier signs for; defaults to Arc Testnet. */
  chain?: Chain;
  escrowAddress?: Address;
  verifierPrivateKey?: Hex;
  dojahAppId?: string;
  dojahSecretKey?: string;
  dojahBaseUrl: string;
  /** Secret used to HMAC NINs for the one-NIN-one-account check. */
  ninPepper: string;
  dataFile: string;
  /** Minimum face-match confidence (Dojah default is 90). */
  threshold: number;
  /** Dojah sandbox: no NIMC access, only Dojah's test NINs exist. */
  sandbox?: boolean;
  /** Didit (free tier: ID document + liveness + face match via a hosted page). */
  diditApiKey?: string;
  diditWorkflowId?: string;
  diditBaseUrl?: string;
  /** Origins the Didit hosted page may send users back to (e.g. http://localhost:5175). */
  appOrigins?: string[];
  /** 'didit' | 'dojah'. Defaults to Didit when configured. */
  provider?: 'didit' | 'dojah';
}

export function configFromEnv(env = process.env): VerificationConfig {
  const verifierPrivateKey = env.VERIFIER_PRIVATE_KEY as Hex | undefined;
  return {
    rpcUrl: env.ARC_RPC_URL || '', // empty = Arc's official endpoints with failover (src/lib/arc-rpc.ts)
    escrowAddress: (env.ESCROW_ADDRESS || env.VITE_ESCROW_ADDRESS) as Address | undefined,
    verifierPrivateKey,
    dojahAppId: env.DOJAH_APP_ID || undefined,
    dojahSecretKey: env.DOJAH_SECRET_KEY || undefined,
    dojahBaseUrl: env.DOJAH_BASE_URL || (env.DOJAH_ENV === 'production' ? 'https://api.dojah.io' : 'https://sandbox.dojah.io'),
    ninPepper: env.NIN_PEPPER || createHash('sha256').update(`rentflow-nin:${verifierPrivateKey ?? ''}`).digest('hex'),
    dataFile: env.VERIFICATION_DATA_FILE || 'server/data/verifications.json',
    threshold: Number(env.KYC_MATCH_THRESHOLD || 90),
    sandbox: !env.DOJAH_BASE_URL && env.DOJAH_ENV !== 'production',
    diditApiKey: env.DIDIT_API_KEY || undefined,
    diditWorkflowId: env.DIDIT_WORKFLOW_ID || undefined,
    diditBaseUrl: env.DIDIT_BASE_URL || 'https://verification.didit.me',
    appOrigins: (env.APP_ORIGINS || [env.APP_URL, 'http://localhost:5175'].filter(Boolean).join(','))
      .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean),
    provider: env.KYC_PROVIDER === 'dojah' || env.KYC_PROVIDER === 'didit' ? env.KYC_PROVIDER : undefined,
  };
}

interface Store {
  /** HMAC of a government ID number (NIN or document number) → the one account it verified. */
  ninHashes: Record<string, Address>;
  /** Didit session id → account that started it (so a result can only credit that account). */
  diditSessions?: Record<string, { address: Address; createdAt: number }>;
}

const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS_PER_DAY = 5;
const MAX_SELFIE_BYTES = 4 * 1024 * 1024;

const challengeMessage = (address: Address, nonce: string, issuedAt: string) =>
  `Handova identity verification\n\nI confirm I own this Handova account and consent to my identity being checked.\n\nAccount: ${address}\nNonce: ${nonce}\nIssued: ${issuedAt}`;

export function mountVerification(app: Express, config: VerificationConfig = configFromEnv()) {
  const chain = config.chain ?? CHAIN;
  const publicClient = createPublicClient({ chain, transport: arcTransport(config.rpcUrl || undefined) });
  const verifier = config.verifierPrivateKey ? privateKeyToAccount(config.verifierPrivateKey) : null;
  const walletClient = verifier ? createWalletClient({ account: verifier, chain, transport: arcTransport(config.rpcUrl || undefined) }) : null;

  const challenges = new Map<string, { address: Address; message: string; expiresAt: number }>();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  const loadStore = (): Store => {
    try { return JSON.parse(readFileSync(config.dataFile, 'utf8')) as Store; } catch { return { ninHashes: {} }; }
  };
  const saveStore = (store: Store) => {
    if (!existsSync(dirname(config.dataFile))) mkdirSync(dirname(config.dataFile), { recursive: true });
    writeFileSync(config.dataFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  };
  const ninHash = (nin: string) => createHmac('sha256', config.ninPepper).update(nin).digest('hex');

  const fail = (res: Res, status: number, code: string, error: string, extra: object = {}) =>
    res.status(status).json({ ok: false, code, error, ...extra });

  const providerReady = () => !!(config.dojahAppId && config.dojahSecretKey);
  const diditReady = () => !!(config.diditApiKey && config.diditWorkflowId);
  const chainReady = () => !!(walletClient && config.escrowAddress);
  const activeProvider = (): 'didit' | 'dojah' | null =>
    config.provider === 'dojah' ? (providerReady() ? 'dojah' : null)
      : config.provider === 'didit' ? (diditReady() ? 'didit' : null)
        : diditReady() ? 'didit' : providerReady() ? 'dojah' : null;

  /** Checks a single-use challenge signed by `address` (EOA, ERC-1271 or ERC-6492). Returns an error tuple or null. */
  async function checkOwnership(address: unknown, nonce: unknown, signature: unknown): Promise<[number, string, string] | null> {
    if (typeof address !== 'string' || !isAddress(address)) return [400, 'bad_address', 'Invalid account address.'];
    const challenge = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (typeof nonce === 'string') challenges.delete(nonce);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.address.toLowerCase() !== address.toLowerCase()) {
      return [401, 'bad_challenge', 'Your verification session expired. Please try again.'];
    }
    if (typeof signature !== 'string' || !isHex(signature)) return [401, 'bad_signature', 'Could not confirm you own this account.'];
    let signed = false;
    try { signed = await publicClient.verifyMessage({ address, message: challenge.message, signature }); } catch { signed = false; }
    return signed ? null : [401, 'bad_signature', 'Could not confirm you own this account.'];
  }

  /** Per-account daily attempt limit. Returns true when the caller is over the limit. */
  function overLimit(address: string): boolean {
    const key = address.toLowerCase();
    const now = Date.now();
    const a = attempts.get(key);
    if (a && a.resetAt > now && a.count >= MAX_ATTEMPTS_PER_DAY) return true;
    attempts.set(key, !a || a.resetAt < now ? { count: 1, resetAt: now + 86_400_000 } : { ...a, count: a.count + 1 });
    return false;
  }

  /** Write the badge onchain and remember which account this identity verified. */
  async function recordVerified(address: Address, idHash: string): Promise<Hex> {
    const txHash = await walletClient!.writeContract({
      address: config.escrowAddress!, abi: ESCROW_VERIFY_ABI, functionName: 'setVerified', args: [address, true],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error('setVerified reverted');
    const store = loadStore();
    store.ninHashes[idHash] = address;
    saveStore(store);
    console.log(`[Verify] ${address} verified onchain (${txHash})`);
    return txHash;
  }

  app.get('/api/verify/config', (_req, res) => {
    const provider = activeProvider();
    res.json({ provider, onchain: chainReady(), sandbox: provider === 'dojah' && !!config.sandbox });
  });

  app.get('/api/verify/challenge', (req: Req, res: Res) => {
    const address = String(req.query.address ?? '');
    if (!isAddress(address)) return fail(res, 400, 'bad_address', 'Invalid account address.');
    const nonce = randomBytes(16).toString('hex');
    const message = challengeMessage(address, nonce, new Date().toISOString());
    challenges.set(nonce, { address, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    res.json({ nonce, message });
  });

  app.post('/api/verify', express.json({ limit: '6mb' }), async (req: Req, res: Res) => {
    const { address, nonce, signature, nin, selfie } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof address !== 'string' || !isAddress(address)) return fail(res, 400, 'bad_address', 'Invalid account address.');
    if (activeProvider() === 'didit') return fail(res, 409, 'use_didit', 'Please use the new verification flow — refresh the page.');
    if (typeof nin !== 'string' || !/^\d{11}$/.test(nin)) return fail(res, 400, 'bad_nin', 'Your NIN must be exactly 11 digits.');
    if (typeof selfie !== 'string' || !selfie) return fail(res, 400, 'bad_selfie', 'Please take a selfie.');
    const selfieB64 = selfie.replace(/^data:image\/[a-z]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(selfieB64) || selfieB64.length * 0.75 > MAX_SELFIE_BYTES) {
      return fail(res, 400, 'bad_selfie', 'That photo could not be used. Please take a new selfie.');
    }

    // 1. Wallet ownership — single-use challenge signed by the account.
    const ownership = await checkOwnership(address, nonce, signature);
    if (ownership) return fail(res, ...ownership);

    if (!providerReady()) return fail(res, 503, 'not_configured', 'Identity verification is not available yet. Please try again later.');
    if (!chainReady()) return fail(res, 503, 'not_configured', 'Identity verification is not available yet. Please try again later.');

    // 2. Rate limit per account.
    const key = address.toLowerCase();
    if (overLimit(address)) return fail(res, 429, 'too_many_attempts', 'Too many attempts today. Please try again tomorrow.');

    // 3. One NIN ↔ one account.
    const store = loadStore();
    const hash = ninHash(nin);
    const linked = store.ninHashes[hash];
    if (linked && linked.toLowerCase() !== key) {
      return fail(res, 409, 'nin_in_use', 'This NIN is already linked to another Handova account.');
    }

    // 4. Dojah: NIN lookup + selfie face match.
    let dojah: Response;
    try {
      dojah = await fetch(`${config.dojahBaseUrl}/api/v1/kyc/nin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', AppId: config.dojahAppId!, Authorization: config.dojahSecretKey! },
        body: JSON.stringify({ nin, selfie_image: selfieB64, threshold: config.threshold }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return fail(res, 502, 'provider_unreachable', 'The verification service did not respond. Please try again.');
    }
    const body = await dojah.json().catch(() => ({})) as {
      entity?: { first_name?: string; selfie_verification?: { match?: boolean; confidence_value?: number } };
      error?: string;
    };
    if (dojah.status === 401 || dojah.status === 402) {
      console.error(`[Verify] Dojah rejected our credentials or balance (HTTP ${dojah.status})`);
      return fail(res, 503, 'not_configured', 'Identity verification is not available right now. Please try again later.');
    }
    if (dojah.status === 429) return fail(res, 429, 'provider_busy', 'The verification service is busy. Please try again in a minute.');
    if (!dojah.ok || !body.entity) {
      if (config.sandbox) {
        return fail(res, 422, 'sandbox_nin', 'Handova is in test mode, which can\'t check real NINs yet. Use the test NIN 70123456789 for now — real NIN checks switch on at launch.');
      }
      return fail(res, 422, 'nin_not_found', 'We could not find that NIN. Check the number on your NIN slip and try again.');
    }
    const match = body.entity.selfie_verification;
    if (!match?.match) {
      return fail(res, 422, 'face_mismatch', 'Your selfie did not match the photo on your NIN record. Take a clear, well-lit selfie facing the camera and try again.', {
        confidence: match?.confidence_value ?? null,
      });
    }

    // 5. Record onchain, then remember the NIN hash.
    try {
      const txHash = await recordVerified(address, hash);
      res.json({ ok: true, txHash, firstName: body.entity.first_name ?? null });
    } catch (err) {
      console.error('[Verify] Onchain write failed:', err instanceof Error ? err.message : err);
      return fail(res, 502, 'chain_error', 'You passed the check, but we could not save your badge. Please try again.');
    }
  });

  // ── Didit: hosted ID document + liveness + face match ─────────────────────
  interface DiditFeature { status?: string; score?: number; document_type?: string; document_number?: string; personal_number?: string; full_name?: string; issuing_state?: string }
  interface DiditDecision {
    status?: string; vendor_data?: string;
    id_verifications?: DiditFeature[] | null; liveness_checks?: DiditFeature[] | null; face_matches?: DiditFeature[] | null;
  }

  const didit = (path: string, init: RequestInit = {}) => fetch(`${config.diditBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.diditApiKey!, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });

  /** Start a hosted verification for a wallet the caller proved they own. */
  app.post('/api/verify/didit/session', express.json(), async (req: Req, res: Res) => {
    const { address, nonce, signature, returnTo } = (req.body ?? {}) as Record<string, unknown>;
    const ownership = await checkOwnership(address, nonce, signature);
    if (ownership) return fail(res, ...ownership);
    const account = address as Address;
    if (!diditReady() || !chainReady()) return fail(res, 503, 'not_configured', 'Identity verification is not available yet. Please try again later.');

    const already = await publicClient.readContract({ address: config.escrowAddress!, abi: ESCROW_VERIFY_ABI, functionName: 'verifiedAt', args: [account] }).catch(() => 0n);
    if (already > 0n) return res.json({ ok: true, alreadyVerified: true });
    if (overLimit(account)) return fail(res, 429, 'too_many_attempts', 'Too many attempts today. Please try again tomorrow.');

    // Only send people back to our own app.
    const origin = typeof returnTo === 'string' ? returnTo.replace(/\/$/, '') : '';
    const back = config.appOrigins?.includes(origin) ? origin : config.appOrigins?.[0];
    const r = await didit('/v3/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: config.diditWorkflowId, vendor_data: account,
        // No query string of our own: Didit appends ?verificationSessionId=…&status=… to this URL.
        callback: back ? `${back}/landlord` : undefined, metadata: { app: 'rentflow' },
      }),
    }).catch(() => null);
    const body = await r?.json().catch(() => ({})) as { session_id?: string; url?: string; detail?: string } | undefined;
    if (!r || !r.ok || !body?.session_id || !body.url) {
      console.error(`[Verify] Didit session failed (HTTP ${r?.status ?? 'network'})`, body?.detail ?? '');
      return fail(res, r?.status === 401 || r?.status === 403 ? 503 : 502, 'provider_error', 'Could not start verification. Please try again.');
    }
    const store = loadStore();
    store.diditSessions = { ...(store.diditSessions ?? {}), [body.session_id]: { address: account, createdAt: Date.now() } };
    saveStore(store);
    res.json({ ok: true, url: body.url, sessionId: body.session_id });
  });

  type Outcome = { status: number; body: Record<string, unknown> };
  const out = (status: number, code: string, error: string): Outcome => ({ status, body: { ok: false, code, error } });

  /** Read Didit's decision for one of our sessions and, if approved, record the badge onchain. */
  async function finishSession(sessionId: string): Promise<Outcome> {
    const session = loadStore().diditSessions?.[sessionId];
    if (!session) return out(404, 'unknown_session', 'We could not find that verification. Please start again.');

    const r = await didit(`/v3/session/${sessionId}/decision/`).catch(() => null);
    const d = await r?.json().catch(() => ({})) as DiditDecision | undefined;
    if (!r || !r.ok || !d) return out(502, 'provider_error', 'Could not read the verification result. Please try again.');
    if ((d.vendor_data ?? '').toLowerCase() !== session.address.toLowerCase()) return out(409, 'session_mismatch', 'This verification belongs to a different account.');

    const status = d.status ?? '';
    if (status === 'In Review') return { status: 202, body: { ok: false, code: 'in_review', error: 'Your documents are being reviewed by a person. This usually takes a few minutes — check back soon.' } };
    if (['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted'].includes(status)) return out(409, 'not_finished', 'Verification isn\'t finished yet. Complete the steps on the verification page.');
    if (['Expired', 'Abandoned', 'Kyc Expired'].includes(status)) return out(410, 'expired', 'That verification expired. Please start again.');

    const doc = d.id_verifications?.[0];
    const failed = [
      doc?.status !== 'Approved' && 'your ID document',
      d.liveness_checks?.[0] && d.liveness_checks[0].status !== 'Approved' && 'the liveness check',
      d.face_matches?.[0] && d.face_matches[0].status !== 'Approved' && 'matching your face to your ID',
    ].filter(Boolean);
    if (status !== 'Approved' || failed.length) {
      return out(422, 'declined', `Verification didn't pass${failed.length ? ` (${failed.join(', ')})` : ''}. Use a clear photo of a valid ID and follow the selfie steps in good light.`);
    }

    // One identity document ↔ one account.
    const idNumber = (doc?.personal_number || doc?.document_number || '').replace(/\s/g, '').toUpperCase();
    if (!idNumber) return out(422, 'declined', 'We could not read the number on your ID. Please try again with a clearer photo.');
    const idHash = ninHash(`${doc?.issuing_state ?? ''}:${idNumber}`);
    const linked = loadStore().ninHashes[idHash];
    if (linked && linked.toLowerCase() !== session.address.toLowerCase()) {
      return out(409, 'nin_in_use', 'This ID is already linked to another Handova account.');
    }

    try {
      const txHash = await recordVerified(session.address, idHash);
      const store = loadStore();
      if (store.diditSessions) delete store.diditSessions[sessionId];
      saveStore(store);
      return { status: 200, body: { ok: true, txHash, firstName: (doc?.full_name ?? '').split(' ')[0] || null } };
    } catch (err) {
      console.error('[Verify] Onchain write failed:', err instanceof Error ? err.message : err);
      return out(502, 'chain_error', 'You passed the check, but we could not save your badge. Please try again.');
    }
  }

  /** After the hosted flow: collect the result for a specific session. */
  app.post('/api/verify/didit/complete', express.json(), async (req: Req, res: Res) => {
    const { sessionId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return fail(res, 400, 'bad_session', 'Invalid verification session.');
    if (!diditReady() || !chainReady()) return fail(res, 503, 'not_configured', 'Identity verification is not available yet. Please try again later.');
    const r = await finishSession(sessionId);
    res.status(r.status).json(r.body);
  });

  /**
   * Collect any finished session this account started but never came back for (closed tab, finished on
   * another device via Didit's QR code, broken redirect). Only ever credits the account bound to the session.
   */
  app.post('/api/verify/didit/resume', express.json(), async (req: Req, res: Res) => {
    const { address } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof address !== 'string' || !isAddress(address)) return fail(res, 400, 'bad_address', 'Invalid account address.');
    if (!diditReady() || !chainReady()) return res.json({ ok: false, code: 'not_configured' });
    const mine = Object.entries(loadStore().diditSessions ?? {})
      .filter(([, v]) => v.address.toLowerCase() === address.toLowerCase())
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, 5);
    let pending: Outcome | null = null;
    for (const [sessionId] of mine) {
      const r = await finishSession(sessionId);
      if (r.body.ok) return res.json(r.body);
      if (r.body.code === 'in_review' && !pending) pending = r;
    }
    res.json(pending?.body ?? { ok: false, code: 'none' });
  });
}

/**
 * Sign-in sessions for the app's API. The user signs ONE challenge with their passkey wallet
 * (EOA, ERC-1271 or ERC-6492 signature); the server returns a session token valid for 7 days,
 * so reviews, repair requests etc. don't trigger Face ID every time.
 *
 *   GET  /api/auth/challenge?address=0x…   → { nonce, message }
 *   POST /api/auth/session { address, nonce, signature } → { token, expiresAt }
 *   Authorization: Bearer <token>  on authenticated routes
 */

import type { Express, Request, Response } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, isAddress, isHex, type Address } from 'viem';
import { CHAIN } from '../src/lib/network';
import { arcTransport } from '../src/lib/arc-rpc';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60_000;

export const chainClient = createPublicClient({
  chain: CHAIN,
  transport: arcTransport(process.env.ARC_RPC_URL),
});

const secret = () => process.env.SESSION_SECRET
  || createHash('sha256').update(`rentflow-session:${process.env.VERIFIER_PRIVATE_KEY ?? process.env.BOT_SECRET ?? 'dev'}`).digest('hex');

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');
/** HMAC with the server session secret, for other short-lived signed tokens. */
export const serverHmac = sign;

export function issueToken(address: Address, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `${address.toLowerCase()}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** Address from a valid session token, or null. */
export function verifyToken(token: string | undefined): Address | null {
  if (!token) return null;
  const [address, exp, mac] = token.split('.');
  if (!address || !exp || !mac || !isAddress(address) || Number(exp) < Date.now()) return null;
  const expected = sign(`${address}.${exp}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return address as Address;
}

/** Session address for a request, or sends 401 and returns null. */
export function requireSession(req: Request, res: Response): Address | null {
  const address = verifyToken(req.header('authorization')?.replace(/^Bearer\s+/i, ''));
  if (!address) {
    res.status(401).json({ ok: false, code: 'unauthenticated', error: 'Please sign in again.' });
    return null;
  }
  return address;
}

export function mountAuth(app: Express) {
  const challenges = new Map<string, { address: string; message: string; expiresAt: number }>();

  app.get('/api/auth/challenge', (req: Request, res: Response) => {
    const address = String(req.query.address ?? '');
    if (!isAddress(address)) { res.status(400).json({ ok: false, error: 'Invalid address.' }); return; }
    const nonce = randomBytes(16).toString('hex');
    const message = `Sign in to Handova\n\nAccount: ${address}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
    challenges.set(nonce, { address: address.toLowerCase(), message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    // Drop expired challenges so the map can't grow without bound.
    for (const [k, v] of challenges) if (v.expiresAt < Date.now()) challenges.delete(k);
    res.json({ nonce, message });
  });

  app.post('/api/auth/session', async (req: Request, res: Response) => {
    const { address, nonce, signature } = (req.body ?? {}) as Record<string, unknown>;
    const c = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (typeof address !== 'string' || !isAddress(address) || !c || c.expiresAt < Date.now() || c.address !== address.toLowerCase()) {
      if (typeof nonce === 'string') challenges.delete(nonce);
      res.status(401).json({ ok: false, code: 'bad_challenge', error: 'Sign-in expired. Please try again.' });
      return;
    }
    if (typeof signature !== 'string' || !isHex(signature)) { res.status(401).json({ ok: false, code: 'bad_signature', error: 'Could not confirm you own this account.' }); return; }
    // Smart-account signatures are checked with a chain call. If the RPC fails, that's "try again",
    // not "not your account" — and the challenge stays valid so the same signature can be resent.
    let ok: boolean | null = null;
    for (let attempt = 0; attempt < 3 && ok === null; attempt++) {
      try { ok = await chainClient.verifyMessage({ address, message: c.message, signature }); }
      catch { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); }
    }
    if (ok === null) { res.status(503).json({ ok: false, code: 'chain_unavailable', error: 'Couldn\'t reach the blockchain to confirm your sign-in. Please try again in a moment.' }); return; }
    challenges.delete(nonce as string);
    if (!ok) { res.status(401).json({ ok: false, code: 'bad_signature', error: 'Could not confirm you own this account.' }); return; }
    res.json({ ok: true, ...issueToken(address) });
  });
}

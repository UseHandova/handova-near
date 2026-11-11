/**
 * Proving who you are to Handova's server, once: the person signs a NEP-413 message (no transaction, no
 * gas) with a full-access key of their account, and gets a token for 7 days. Accounts made on this
 * device or with a passkey sign silently; a wallet asks once. Used where the server keeps shared state
 * that isn't on-chain (viewings).
 *
 * The token is an HMAC over the account ID and expiry. With no AUTH_SECRET set, a random one is made at
 * start-up, so tokens end when the server restarts and the app simply asks again.
 */
import type { Express, Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PublicKey } from 'near-api-js';
import { nep413Hash } from '../../shared/nep413';
import { deploy, env } from './config';
import { provider } from './chain';

const SECRET = env('AUTH_SECRET') ?? randomBytes(32).toString('hex');
const TOKEN_DAYS = 7;
const challenges = new Map<string, { accountId: string; message: string; expiresAt: number }>();

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64url');

export function issueToken(accountId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ a: accountId, e: now + TOKEN_DAYS * 86_400_000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The account a token belongs to, or null if it is forged or expired. */
export function tokenAccount(token: string, now = Date.now()): string | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof a === 'string' && typeof e === 'number' && e > now ? a : null;
  } catch {
    return null;
  }
}

/** The signed-in account, or a 401 already sent. */
export function requireAccount(req: Request, res: Response): string | null {
  const h = String(req.headers.authorization ?? '');
  const accountId = h.startsWith('Handova ') ? tokenAccount(h.slice(8)) : null;
  if (!accountId) {
    res.status(401).json({ error: 'Please confirm it is you, then try again.', code: 'auth' });
    return null;
  }
  return accountId;
}

export function mountAuth(app: Express) {
  app.get('/api/auth/challenge', (req, res) => {
    const accountId = String(req.query.accountId ?? '');
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return res.status(400).json({ error: 'Unknown account.' });
    for (const [k, c] of challenges) if (c.expiresAt < Date.now()) challenges.delete(k);
    const nonce = randomBytes(32).toString('base64');
    const message = `Sign in to Handova\n\nI, ${accountId}, confirm it is me. This is not a transaction and costs nothing.\n\nIssued: ${new Date().toISOString()}`;
    challenges.set(nonce, { accountId, message, expiresAt: Date.now() + 10 * 60_000 });
    res.json({ nonce, message, recipient: deploy.escrow });
  });

  app.post('/api/auth/session', async (req, res) => {
    const { accountId, nonce, signature, publicKey } = req.body ?? {};
    const c = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (typeof nonce === 'string') challenges.delete(nonce);
    if (!c || c.expiresAt < Date.now() || c.accountId !== accountId) return res.status(401).json({ error: 'That sign-in request expired. Try again.' });
    try {
      const ok = PublicKey.from(String(publicKey)).verify(nep413Hash({ message: c.message, nonce: Buffer.from(nonce, 'base64'), recipient: deploy.escrow }), Buffer.from(String(signature), 'base64'));
      const key: any = ok ? await provider.viewAccessKey({ accountId, publicKey: String(publicKey) }) : null;
      if (key?.permission !== 'FullAccess') throw new Error('bad key');
    } catch {
      return res.status(401).json({ error: "We couldn't confirm you control this account." });
    }
    res.json({ token: issueToken(accountId), accountId });
  });
}

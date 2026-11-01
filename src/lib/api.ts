/**
 * Authenticated calls to the Handova server. The first call signs one challenge with the passkey
 * wallet (a single Face ID / fingerprint prompt) and gets a 7-day session token; later calls reuse it.
 */

import type { SmartAccount } from 'viem/account-abstraction';

const key = (address: string) => `rf-session:${address.toLowerCase()}`;
const inflight = new Map<string, Promise<string>>();

function stored(address: string): string | null {
  try {
    const raw = localStorage.getItem(key(address));
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return expiresAt > Date.now() + 60_000 ? token : null;
  } catch { return null; }
}

async function signIn(account: SmartAccount): Promise<string> {
  const ch = await fetch(`/api/auth/challenge?address=${account.address}`);
  if (!ch.ok) throw new Error('Could not reach Handova. Check your connection.');
  const { nonce, message } = await ch.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message });
  // The server may briefly fail to reach the blockchain (503): resend the same signature — no new prompt.
  let res = await fetch('/api/auth/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, nonce, signature }),
  });
  for (let attempt = 1; attempt < 3 && res.status === 503; attempt++) {
    await new Promise(r => setTimeout(r, 1500 * attempt));
    res = await fetch('/api/auth/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address, nonce, signature }),
    });
  }
  const body = await res.json().catch(() => ({})) as { ok?: boolean; token?: string; expiresAt?: number; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? 'Sign-in failed. Please try again.');
  try { localStorage.setItem(key(account.address), JSON.stringify({ token: body.token, expiresAt: body.expiresAt })); } catch { /* storage unavailable */ }
  return body.token;
}

/** A valid session token for this account (prompts the passkey once if needed). */
export function getSession(account: SmartAccount): Promise<string> {
  const cached = stored(account.address);
  if (cached) return Promise.resolve(cached);
  const k = account.address.toLowerCase();
  // Several components may ask at once — share one sign-in prompt.
  if (!inflight.has(k)) inflight.set(k, signIn(account).finally(() => inflight.delete(k)));
  return inflight.get(k)!;
}

/** True when a session token is already stored, so a call won't prompt the passkey. */
export function hasSession(address: string): boolean {
  return stored(address) !== null;
}

export function clearSession(address: string) {
  try { localStorage.removeItem(key(address)); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** JSON request with the session token; signs in again once if the session expired. */
export async function api<T = Record<string, unknown>>(account: SmartAccount, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getSession(account);
    const res = await fetch(path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const body = await res.json().catch(() => ({})) as T & { ok?: boolean; error?: string; code?: string };
    if (res.status === 401 && attempt === 0) { clearSession(account.address); continue; }
    if (!res.ok) throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status, body.code);
    return body;
  }
  throw new ApiError('Please sign in again.', 401, 'unauthenticated');
}

/** Unauthenticated GET for public data. */
export async function publicApi<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? 'Could not load data.', res.status);
  return body;
}

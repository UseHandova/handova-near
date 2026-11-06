/** RPC access and the server's own NEAR accounts (relayer, account creator, verifier). */
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { env } from './config';
import { rpcUrls } from './rpc';
import { timedFetch } from '../../shared/timed-fetch';

/**
 * near-api-js calls RPCs with no time limit. A connection that drops mid-request then waits forever
 * while holding the account's nonce lock, and every later transaction from that key queues behind it
 * (we saw one relay wait 31 minutes). So every request this server makes ends within 20 seconds.
 */
globalThis.fetch = timedFetch(globalThis.fetch, 20_000);

/** The configured RPC first, then fallbacks (see rpc.ts): free public RPCs rate-limit bursts. */
export const provider = new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 2, wait: 500 })));

/** The RPC was busy or unreachable, so it said nothing about the transaction itself. */
export function rpcUnavailable(e: unknown): boolean {
  const cause = (e as { cause?: unknown })?.cause;
  if (typeof cause === 'number' && (cause === 408 || cause === 429 || cause >= 500)) return true;
  // Our own time limit (timedFetch) cut the request off.
  if ((e as Error)?.name === 'TimeoutError') return true;
  return /Exceeded \d+ attempts|rate limit|-429|Timeout error|Bad Gateway|unavailable|Internal server error|fetch failed|Unable to connect|ECONN|socket|took too long|timed out/i.test((e as Error)?.message ?? '');
}

/** Try each sender in turn, moving on only when an RPC is busy or silent. Resending is safe: a signed transaction has one hash. */
export async function firstAvailable<T>(senders: (() => Promise<T>)[], limitMs = 25_000): Promise<T> {
  let last: unknown;
  for (const send of senders) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silent = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The RPC took too long')), limitMs); });
    try {
      return await Promise.race([send(), silent]);
    } catch (e) {
      if (!rpcUnavailable(e)) throw e;
      console.warn(`send: RPC busy, trying the next one: ${(e as Error).message?.slice(0, 120)}`);
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/**
 * For accounts that sign: reads use the failover wrapper, but it turns every error into "exceeded
 * providers", which would hide real errors (not enough balance) and break near-api-js's automatic
 * retry on a stale nonce. So sends fail over here instead, and real errors come straight back.
 */
const senders = rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 2, wait: 500 }));
export const signingProvider = new Proxy(provider, {
  get(target, prop, receiver) {
    if (prop === 'sendTransactionUntil' || prop === 'sendTransaction' || prop === 'sendTransactionAsync') {
      return (...args: unknown[]) => firstAvailable(senders.map((p) => () => (p as any)[prop](...args)));
    }
    const v = Reflect.get(target, prop, receiver);
    return typeof v === 'function' ? v.bind(target) : v;
  },
}) as FailoverRpcProvider;

/** NEAR (in whole units, approximate) available to a server account, or null if it can't be read. */
export async function nearBalance(account: Account | null): Promise<number | null> {
  if (!account) return null;
  try {
    const a: any = await provider.viewAccount({ accountId: account.accountId });
    return Number(BigInt(a.amount) / 10n ** 18n) / 1e6;
  } catch {
    return null;
  }
}

/** Retry a send on network errors (not on contract failures or nonce/expiry problems). */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (i >= tries || /nonce|expired|DelegateAction|panicked|AccountAlreadyExists|already exists/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

function serverAccount(idVar: string, keyVar: string): Account | null {
  const id = env(idVar);
  const key = env(keyVar);
  return id && key ? new Account(id, signingProvider, key as KeyPairString) : null;
}

/** Pays gas for users' signed delegate actions (NEP-366) and runs the keeper. */
export const relayer = serverAccount('RELAYER_ACCOUNT_ID', 'RELAYER_PRIVATE_KEY');
/** Owns `accountParent`; creates `<name>.<accountParent>` accounts. */
export const creator = serverAccount('CREATOR_ACCOUNT_ID', 'CREATOR_PRIVATE_KEY');
/** Marks ID-verified landlords on the escrow contract. */
export const verifier = serverAccount('VERIFIER_ACCOUNT_ID', 'VERIFIER_NEAR_PRIVATE_KEY');

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    // Not the failover wrapper: it takes "no such account" for a failure and asks every RPC in turn.
    await firstAvailable(senders.map((p) => () => p.viewAccount({ accountId })), 8_000);
    return true;
  } catch {
    return false;
  }
}

export { summarize } from '../../shared/outcome';

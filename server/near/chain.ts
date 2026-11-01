/** RPC access and the server's own NEAR accounts (relayer, account creator, verifier). */
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { env } from './config';
import { rpcUrls } from './rpc';

/** The configured RPC first, then fallbacks (see rpc.ts): free public RPCs rate-limit bursts. */
export const provider = new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 2, wait: 500 })));

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
  return id && key ? new Account(id, provider, key as KeyPairString) : null;
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
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

export { summarize } from '../../shared/outcome';

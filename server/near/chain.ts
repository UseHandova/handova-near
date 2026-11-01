/** RPC access and the server's own NEAR accounts (relayer, account creator, verifier). */
import { Account, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { deploy, env } from './config';

export const provider = new JsonRpcProvider({ url: deploy.rpc });

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

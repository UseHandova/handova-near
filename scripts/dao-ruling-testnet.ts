/**
 * Proves on NEAR testnet that the Handova council (a 2-of-3 Sputnik DAO) settles a caution dispute on the
 * public escrow: the DAO itself calls resolve_dispute, and one vote is not enough.
 *
 *   bun scripts/dao-ruling-testnet.ts [--api https://handova-near.vercel.app]
 *
 * Creates two throwaway Handova accounts (landlord, tenant), rents a home and moves out, the landlord
 * claims part of the caution and the two sides do not agree. Then the council rules. Votes are signed
 * with CREATOR_* and VERIFIER_* from .env, the two council members whose keys the team holds. Ends by
 * pausing the listing, and prints every transaction hash.
 */
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { readFileSync } from 'node:fs';

const API = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'https://handova-near.vercel.app').replace(/\/$/, '');
const deploy = JSON.parse(readFileSync('deploy/testnet.json', 'utf8'));
const provider = new JsonRpcProvider({ url: deploy.rpc });
const USDC = 1_000_000n;
const TGAS = 1_000_000_000_000n;
const milliNear = (n: number) => BigInt(n) * 10n ** 21n;

async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j as T;
}

// Direct transactions reserve gas at the maximum price, more than a new account's 0.05 NEAR; the app sends
// these through the gasless relayer instead. Here the relayer account (from .env) tops the accounts up.
const funder = new Account(process.env.RELAYER_ACCOUNT_ID!, provider, process.env.RELAYER_PRIVATE_KEY as KeyPairString);
const memberA = new Account(process.env.CREATOR_ACCOUNT_ID!, provider, process.env.CREATOR_PRIVATE_KEY as KeyPairString);
const memberB = new Account(process.env.VERIFIER_ACCOUNT_ID!, provider, process.env.VERIFIER_NEAR_PRIVATE_KEY as KeyPairString);

async function newAccount(label: string, near: number): Promise<Account> {
  const kp = KeyPair.fromRandom('ed25519');
  const { accountId } = await api<{ accountId: string }>('/api/accounts', { name: `${label}-${Date.now().toString(36)}`, publicKey: kp.getPublicKey().toString() });
  await funder.transfer({ receiverId: accountId, amount: milliNear(near * 1000) });
  console.log(`  ${label}: ${accountId}`);
  return new Account(accountId, provider, kp.toString() as KeyPairString);
}

const view = <T>(contractId: string, method: string, args: object = {}) => provider.callFunction({ contractId, method, args }) as Promise<T>;

/** Sends a call and prints its hash; returns the method's result. */
async function call(label: string, a: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) {
  const outcome = await a.callFunctionRaw({ contractId, methodName, args, deposit, gas });
  console.log(`  ${label}: ${outcome.transaction.hash}`);
  const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
  return value ? JSON.parse(Buffer.from(value, 'base64').toString()) : undefined;
}

const lease = (id: number) => view<any>(deploy.escrow, 'get_lease', { lease_id: id });

console.log('▶ Accounts');
const landlord = await newAccount('dao-landlord', 0.1);
const tenant = await newAccount('dao-tenant', 0.2);
await api('/api/faucet', { accountId: tenant.accountId });

console.log('▶ Rent a home, then move out');
const listingId = await call('create_listing', landlord, deploy.escrow, 'create_listing', { rent: String(10n * USDC), caution: String(4n * USDC), term_months: 12, property_ref: 'dao-ruling-check' });
await call('pay', tenant, deploy.token, 'ft_transfer_call', { receiver_id: deploy.escrow, amount: String(14n * USDC), msg: JSON.stringify({ listing_id: Number(listingId), rent: String(10n * USDC), caution: String(4n * USDC), term_months: 12 }) }, 1n, 150n * TGAS);
const leases = await view<any[]>(deploy.escrow, 'get_leases_for', { account_id: tenant.accountId });
const leaseId = leases.at(-1).id as number;
await call('confirm_move_in', tenant, deploy.escrow, 'confirm_move_in', { lease_id: leaseId });
await call('move_out', tenant, deploy.escrow, 'move_out', { lease_id: leaseId });

console.log('▶ The landlord claims 3 of the 4 USDC caution');
await call('dispute_caution', landlord, deploy.escrow, 'dispute_caution', { lease_id: leaseId, landlord_claim: String(3n * USDC), reason: 'Broken kitchen door' });
const dao = (await lease(leaseId)).arbiter as string;
console.log(`  lease #${leaseId} is ${(await lease(leaseId)).status}; its arbiter is ${dao}`);

console.log('▶ The council rules: the landlord keeps 1 USDC');
const { proposal_bond } = await view<{ proposal_bond: string }>(dao, 'get_policy');
const proposal = {
  description: `[Handova] Lease #${leaseId}: landlord keeps 1.00 USDC of the caution`,
  kind: { FunctionCall: { receiver_id: deploy.escrow, actions: [{ method_name: 'resolve_dispute', args: Buffer.from(JSON.stringify({ lease_id: leaseId, landlord_amount: String(USDC) })).toString('base64'), deposit: '0', gas: String(60n * TGAS) }] } },
};
const id = await call('add_proposal', memberA, dao, 'add_proposal', { proposal }, BigInt(proposal_bond), 50n * TGAS);
await call(`vote 1 of 2 (${memberA.accountId})`, memberA, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: proposal.kind }, 0n, 200n * TGAS);
const afterOne = (await lease(leaseId)).status;
console.log(`  after one vote the lease is still ${afterOne}`);
if (afterOne !== 'Disputed') throw new Error('One vote should not be enough');
await call(`vote 2 of 2 (${memberB.accountId})`, memberB, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: proposal.kind }, 0n, 200n * TGAS);

const closed = await lease(leaseId);
const { status } = await view<{ status: string }>(dao, 'get_proposal', { id });
console.log(`  proposal #${id}: ${status} · lease #${leaseId}: ${closed.status} · landlord ${Number(closed.caution_to_landlord) / 1e6} USDC · tenant ${Number(closed.caution_to_holder) / 1e6} USDC`);
if (closed.status !== 'Closed' || closed.caution_to_landlord !== String(USDC)) throw new Error('The ruling did not settle the lease');

await call('pause listing', landlord, deploy.escrow, 'update_listing', { listing_id: Number(listingId), available: false });
console.log(`✔ Ruled by the DAO. ${deploy.explorer}/address/${dao}`);

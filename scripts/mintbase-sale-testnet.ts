/**
 * Proves on NEAR testnet that a Handova lease NFT sells through Mintbase's open market contract
 * (NEP-178 approval + NEP-199 payout), and only to the person the landlord agreed to.
 *
 *   bun scripts/mintbase-sale-testnet.ts [--api https://handova-near.vercel.app]
 *
 * Creates three throwaway Handova accounts (landlord, tenant, buyer) through the API (topped up with a
 * little testnet NEAR by the relayer account in .env), gets them test
 * USDC from the faucet, rents a home, then: the tenant offers the lease and the landlord agrees, the
 * tenant lists the lease NFT on market-v2-beta.mintspace2.testnet for USDC, and the buyer buys it there.
 * Checks the buyer now holds the NFT (and the caution right) and the tenant was paid by the market.
 */
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { readFileSync } from 'node:fs';

const API = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'https://handova-near.vercel.app').replace(/\/$/, '');
const MARKET = process.env.MINTBASE_MARKET ?? 'market-v2-beta.mintspace2.testnet';
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

async function newAccount(label: string, near: number): Promise<Account> {
  const kp = KeyPair.fromRandom('ed25519');
  const { accountId } = await api<{ accountId: string }>('/api/accounts', { name: `${label}-${Date.now().toString(36)}`, publicKey: kp.getPublicKey().toString() });
  await funder.transfer({ receiverId: accountId, amount: milliNear(near * 1000) });
  console.log(`  ${label}: ${accountId}`);
  return new Account(accountId, provider, kp.toString() as KeyPairString);
}

const view = <T>(contractId: string, method: string, args: object) => provider.callFunction({ contractId, method, args }) as Promise<T>;
const usdcOf = async (a: Account) => BigInt(await view<string>(deploy.token, 'ft_balance_of', { account_id: a.accountId }));
const call = (a: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  a.callFunction({ contractId, methodName, args, deposit, gas });

console.log('▶ Accounts');
const landlord = await newAccount('mb-landlord', 0.1);
const tenant = await newAccount('mb-tenant', 0.2);
const buyer = await newAccount('mb-buyer', 0.35);
await api('/api/faucet', { accountId: tenant.accountId });
await api('/api/faucet', { accountId: buyer.accountId });

console.log('▶ Rent a home');
const listingId = await call(landlord, deploy.escrow, 'create_listing', { rent: String(10n * USDC), caution: String(2n * USDC), term_months: 12, property_ref: 'mintbase-check' }, 0n, 25n * TGAS);
await call(tenant, deploy.token, 'ft_transfer_call', { receiver_id: deploy.escrow, amount: String(12n * USDC), msg: JSON.stringify({ listing_id: Number(listingId) }) }, 1n, 100n * TGAS);
const leases = await view<any[]>(deploy.escrow, 'get_leases_for', { account_id: tenant.accountId });
const leaseId = leases.at(-1).id as number;
await call(tenant, deploy.escrow, 'confirm_move_in', { lease_id: leaseId });
console.log(`  lease #${leaseId} active; lease NFT "${leaseId}" held by the tenant`);

const price = 5n * USDC;
console.log('▶ List the lease on Mintbase');
await call(tenant, deploy.escrow, 'offer_takeover', { lease_id: leaseId, price: String(price) });
await call(tenant, MARKET, 'deposit_storage', {}, milliNear(10), 30n * TGAS);
await call(tenant, deploy.escrow, 'nft_approve', { token_id: String(leaseId), account_id: MARKET, msg: JSON.stringify({ price: String(price), ft_contract: deploy.token }) }, milliNear(5), 100n * TGAS);
console.log(`  listed on ${MARKET} for ${price / USDC} USDC`);

const buy = () => call(buyer, deploy.token, 'ft_transfer_call', {
  receiver_id: MARKET, amount: String(price), msg: JSON.stringify({ nft_contract_id: deploy.escrow, token_id: String(leaseId) }),
}, 1n, 300n * TGAS);

console.log('▶ Buy before the landlord agreed (must fail and refund)');
const before = await usdcOf(buyer);
await buy().catch(() => {});
const owner1 = (await view<any>(deploy.escrow, 'nft_token', { token_id: String(leaseId) })).owner_id;
console.log(`  NFT owner: ${owner1} · buyer refunded: ${(await usdcOf(buyer)) === before}`);
if (owner1 !== tenant.accountId) throw new Error('sold without the landlord agreeing');

console.log('▶ The buyer asks, the landlord agrees to them; buy on Mintbase');
await call(buyer, deploy.escrow, 'request_takeover', { lease_id: leaseId }, 0n, 30n * TGAS);
await call(landlord, deploy.escrow, 'consent_takeover', { lease_id: leaseId }, 0n, 30n * TGAS);
// Mintbase drops a listing whose sale was refused, without freeing its storage: deposit again and re-list.
// (The app only offers Mintbase once the landlord has agreed, so this doesn't happen there.)
await call(tenant, MARKET, 'deposit_storage', {}, milliNear(10), 30n * TGAS);
await call(tenant, deploy.escrow, 'nft_approve', { token_id: String(leaseId), account_id: MARKET, msg: JSON.stringify({ price: String(price), ft_contract: deploy.token }) }, milliNear(5), 100n * TGAS);
const tenantBefore = await usdcOf(tenant);
await buy();
const token = await view<any>(deploy.escrow, 'nft_token', { token_id: String(leaseId) });
const lease = await view<any>(deploy.escrow, 'get_lease', { lease_id: leaseId });
const paid = (await usdcOf(tenant)) - tenantBefore;
console.log(`  NFT owner: ${token.owner_id} · lease tenant: ${lease.tenant} · tenant received ${Number(paid) / 1e6} USDC`);
if (token.owner_id !== buyer.accountId || lease.tenant !== buyer.accountId) throw new Error('sale did not complete');
console.log(`✔ Sold through Mintbase's market. ${deploy.explorer}/address/${deploy.escrow}`);

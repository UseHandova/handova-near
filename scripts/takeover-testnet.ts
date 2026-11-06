/**
 * One lease from start to finish on NEAR testnet, with a takeover in the middle: the caution fee
 * follows the lease NFT to the new tenant and is paid to them at move-out.
 *
 *   bun scripts/takeover-testnet.ts
 *
 * 1. Landlord lists a home (signed by the landlord, with the refundable storage deposit).
 * 2. Ade pays rent + caution, the landlord hands over, Ade moves in and gets the lease NFT.
 * 3. Ade offers the lease for takeover; Tolu asks; the landlord agrees to Tolu by name.
 * 4. Tolu pays Ade's price into the escrow; the NFT and the caution right move to Tolu.
 * 5. Tolu moves out, the landlord approves, the caution is paid to Tolu, who withdraws it.
 *
 * Every step except the listing is gasless (NEP-366). Needs .env with RELAYER_* and CREATOR_* keys.
 */
import { Account, KeyPair } from 'near-api-js';
import { app } from '../server/index';
import { deploy } from '../server/near/config';
import { provider, view } from '../server/near/chain';
import { gaslessCall, type RelayResult } from '../shared/gasless';
import { summarize } from '../shared/outcome';
import { fromUnits, toUnits } from '../shared/units';

const RENT = toUnits(10);
const CAUTION = toUnits(4);
const PRICE = toUnits(3);
const tx = (h: string) => `${deploy.explorer}/txns/${h}`;

const server = app.listen(0);
const API = `http://localhost:${(server.address() as any).port}`;

async function api(path: string, body?: object) {
  const r = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error} ${j.detail ?? ''}`);
  return j;
}

async function newPerson(label: string, role: 'landlord' | 'tenant'): Promise<Account> {
  const key = KeyPair.fromRandom('ed25519');
  const { accountId, hash } = await api('/api/accounts', { name: `${label}-${Date.now().toString(36)}`, publicKey: key.getPublicKey().toString(), role });
  console.log(`  ✓ ${accountId} created   ${tx(hash)}`);
  return new Account(accountId, provider, key.toString() as any);
}

function step(r: RelayResult, what: string, how = 'gasless') {
  if (!r.ok) throw new Error(`${what} failed: ${r.error}`);
  const events = r.events.filter((e) => e.standard === 'handova' || e.standard === 'nep171').map((e) => e.event);
  console.log(`  ✓ ${what} (${how}) [${events.join(', ')}]   ${tx(r.hash)}`);
  return r;
}

const call = (who: Account, method: string, args: object) => gaslessCall(API, who, deploy.escrow, method, args);
const pay = (who: Account, amount: bigint, msg: object) =>
  gaslessCall(API, who, deploy.token, 'ft_transfer_call', { receiver_id: deploy.escrow, amount: amount.toString(), msg: JSON.stringify(msg) }, { deposit: 1n, gas: 150_000_000_000_000n });
const usdc = async (id: string) => BigInt(await view<string>(deploy.token, 'ft_balance_of', { account_id: id }));

/** Read again until the chain shows the step just made: the relayer answers before every RPC node has it. */
async function settled<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    const v = await read();
    if (done(v) || i >= 15) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const owner = (id: number) => settled(() => view<any>(deploy.escrow, 'nft_token', { token_id: String(id) }), (t) => t != null).then((t) => t.owner_id as string);

try {
  console.log(`\nHandova takeover on NEAR ${deploy.network} — escrow ${deploy.escrow}\n`);
  console.log('1) Accounts');
  const landlord = await newPerson('tk-landlord', 'landlord');
  const ade = await newPerson('tk-ade', 'tenant');
  const tolu = await newPerson('tk-tolu', 'tenant');
  await api('/api/faucet', { accountId: ade.accountId });
  await api('/api/faucet', { accountId: tolu.accountId });

  console.log('\n2) The landlord lists a home');
  const { listing_deposit } = await view<{ listing_deposit: string }>(deploy.escrow, 'get_config');
  const listed = step(
    summarize(await landlord.callFunctionRaw({
      contractId: deploy.escrow, methodName: 'create_listing', gas: 10_000_000_000_000n, deposit: BigInt(listing_deposit),
      args: { rent: RENT.toString(), caution: CAUTION.toString(), term_months: 12, property_ref: 'takeover-check' },
    })),
    'create_listing',
    `signed by the landlord, ${fromUnits(listing_deposit, 24)} NEAR refundable deposit`,
  );
  const listingId = listed.events.find((e) => e.event === 'listing_created')!.data[0].listing_id;

  console.log(`\n3) Ade pays and moves in (listing #${listingId})`);
  const paid = step(await pay(ade, RENT + CAUTION, { listing_id: listingId, rent: RENT.toString(), caution: CAUTION.toString(), term_months: 12 }), 'ft_transfer_call → escrow');
  const leaseId = paid.events.find((e) => e.event === 'lease_paid')!.data[0].lease_id as number;
  step(await call(landlord, 'mark_handover', { lease_id: leaseId }), 'landlord mark_handover');
  step(await call(ade, 'confirm_move_in', { lease_id: leaseId }), 'Ade confirm_move_in');
  console.log(`  → lease NFT #${leaseId} owned by ${await owner(leaseId)}`);

  console.log('\n4) Takeover: Ade offers, Tolu asks, the landlord agrees to Tolu by name');
  step(await call(ade, 'offer_takeover', { lease_id: leaseId, price: PRICE.toString() }), `Ade offer_takeover for ${fromUnits(PRICE)} USDC`);
  step(await call(tolu, 'request_takeover', { lease_id: leaseId }), 'Tolu request_takeover');
  step(await call(landlord, 'consent_takeover', { lease_id: leaseId, buyer: tolu.accountId }), 'landlord consent_takeover(Tolu)');
  step(await pay(tolu, PRICE, { take_over: leaseId }), 'Tolu pays the takeover price into the escrow');
  const holder = await settled(() => owner(leaseId), (o) => o === tolu.accountId);
  if (holder !== tolu.accountId) throw new Error(`the NFT is still with ${holder}`);
  console.log(`  → lease NFT #${leaseId} now owned by ${holder}; the ${fromUnits(CAUTION)} USDC caution right moved with it`);

  console.log('\n5) Tolu moves out; the caution is paid to Tolu, the holder');
  step(await call(tolu, 'move_out', { lease_id: leaseId }), 'Tolu move_out');
  step(await call(landlord, 'approve_move_out', { lease_id: leaseId }), 'landlord approve_move_out');
  const before = await usdc(tolu.accountId);
  step(await call(tolu, 'withdraw', {}), 'Tolu withdraw');
  const got = (await settled(() => usdc(tolu.accountId), (b) => b > before)) - before;
  step(await call(ade, 'withdraw', {}), 'Ade withdraw (the takeover price)');
  const lease = await view<any>(deploy.escrow, 'get_lease', { lease_id: leaseId });
  console.log(`  → lease #${leaseId} ${lease.status}; caution to holder ${fromUnits(lease.caution_to_holder)} USDC (${lease.closed_holder}); Tolu withdrew ${fromUnits(got)} USDC`);
  if (lease.status !== 'Closed' || lease.closed_holder !== tolu.accountId || got !== CAUTION) throw new Error('the caution did not go to the new holder');
  console.log(`\n✔ Done. ${deploy.explorer}/address/${deploy.escrow}\n`);
} catch (e) {
  console.error('\n✗', (e as Error).message);
  process.exitCode = 1;
} finally {
  server.close();
}

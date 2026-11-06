/**
 * The whole Handova story on NEAR testnet, end to end, through the real API and contracts:
 *
 *   bun run demo
 *
 * 1. Three people get named NEAR accounts (keys made on "their device" = this script).
 * 2. The landlord lists a home, with a refundable storage deposit from the NEAR their account starts with.
 * 3. A nurse abroad pays rent + caution for her mum — one gasless ft_transfer_call.
 * 4. The landlord marks the handover; mum confirms move-in → rent to landlord, lease NFT to mum.
 * 5. The landlord withdraws the rent. Mum moves out, the landlord approves, the caution comes back.
 *
 * The tenant and payer never need NEAR: the relayer pays their gas (NEP-366 meta transactions).
 * Needs .env with RELAYER_* and CREATOR_* keys (see .env.example). Uses deploy/testnet.json.
 */
import { Account, KeyPair } from 'near-api-js';
import { app } from '../server/index';
import { deploy } from '../server/near/config';
import { provider, view } from '../server/near/chain';
import { gaslessCall, type RelayResult } from '../shared/gasless';
import { summarize } from '../shared/outcome';
import { fromUnits, toUnits } from '../shared/units';

const RENT = toUnits(1200);
const CAUTION = toUnits(150);
const tx = (h: string) => `${deploy.explorer}/txns/${h}`;

const server = app.listen(0);
const API = `http://localhost:${(server.address() as any).port}`;

async function api(path: string, body?: object) {
  const r = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error} ${j.detail ?? ''}`);
  return j;
}

async function newPerson(label: string): Promise<Account> {
  const key = KeyPair.fromRandom('ed25519'); // generated on the user's device
  const name = `${label}-${Date.now().toString(36)}`;
  const role = label === 'landlord' ? 'landlord' : 'tenant';
  const { accountId, hash } = await api('/api/accounts', { name, publicKey: key.getPublicKey().toString(), role });
  console.log(`  ✓ ${accountId} created   ${tx(hash)}`);
  return new Account(accountId, provider, key.toString() as any);
}

function step(r: RelayResult, what: string, how = 'gasless') {
  if (!r.ok) throw new Error(`${what} failed: ${r.error}`);
  const events = r.events.filter((e) => e.standard === 'handova' || e.standard === 'nep171').map((e) => e.event);
  console.log(`  ✓ ${what} (${how}) [${events.join(', ')}]   ${tx(r.hash)}`);
  return r;
}

const usdc = async (id: string) => BigInt(await view<string>(deploy.token, 'ft_balance_of', { account_id: id }));
const near = async (id: string) => (await provider.viewAccount({ accountId: id })).amount;

/** Read again until the chain shows the step just made: the relayer answers before every RPC node has it. */
async function settled<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    const v = await read();
    if (done(v) || i >= 15) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

try {
  console.log(`\nHandova on NEAR ${deploy.network} — escrow ${deploy.escrow}, token ${deploy.token}\n`);
  console.log('1) Accounts');
  const landlord = await newPerson('landlord');
  const nurse = await newPerson('nurse');
  const mum = await newPerson('mum');
  await api('/api/faucet', { accountId: nurse.accountId });
  console.log(`  ✓ ${nurse.accountId} got 2,000 test USDC`);
  const nurseNearBefore = await near(nurse.accountId);

  console.log('\n2) Landlord lists a 2-bed in Yaba: 1,200 USDC rent + 150 USDC caution, 12 months');
  // The listing pays for its own storage, so the landlord signs it with the deposit (the relayer never attaches NEAR).
  const { listing_deposit } = await view<{ listing_deposit: string }>(deploy.escrow, 'get_config');
  const listed = step(
    summarize(await landlord.callFunctionRaw({
      contractId: deploy.escrow, methodName: 'create_listing', gas: 10_000_000_000_000n, deposit: BigInt(listing_deposit),
      args: { rent: RENT.toString(), caution: CAUTION.toString(), term_months: 12, property_ref: 'demo:yaba-2bed' },
    })),
    'create_listing',
    `signed by the landlord, ${fromUnits(listing_deposit, 24)} NEAR refundable deposit`,
  );
  const listingId = listed.events.find((e) => e.event === 'listing_created')!.data[0].listing_id;

  console.log(`\n3) The nurse pays for mum from abroad (listing #${listingId})`);
  const paid = step(
    await gaslessCall(API, nurse, deploy.token, 'ft_transfer_call', {
      receiver_id: deploy.escrow, amount: (RENT + CAUTION).toString(), msg: JSON.stringify({ listing_id: listingId, tenant: mum.accountId, rent: RENT.toString(), caution: CAUTION.toString(), term_months: 12 }),
    }, { deposit: 1n, gas: 150_000_000_000_000n }),
    'ft_transfer_call → escrow',
  );
  const leaseEvent = paid.events.find((e) => e.event === 'lease_paid');
  if (!leaseEvent) throw new Error('Payment was refunded — check the listing is open');
  const leaseId = leaseEvent.data[0].lease_id;
  console.log(`  → lease #${leaseId} Pending; ${fromUnits(RENT + CAUTION)} USDC held in escrow`);

  console.log('\n4) Handover and move-in');
  step(await gaslessCall(API, landlord, deploy.escrow, 'mark_handover', { lease_id: leaseId }), 'landlord mark_handover');
  step(await gaslessCall(API, mum, deploy.escrow, 'confirm_move_in', { lease_id: leaseId }), 'mum confirm_move_in');
  const token: any = await settled(() => view(deploy.escrow, 'nft_token', { token_id: String(leaseId) }), (t) => t != null);
  console.log(`  → lease NFT #${token.token_id} owned by ${token.owner_id}: "${token.metadata.title}"`);
  console.log(`    ${token.metadata.description}`);

  console.log('\n5) Landlord withdraws the rent');
  step(await gaslessCall(API, landlord, deploy.escrow, 'withdraw', {}), 'landlord withdraw');
  console.log(`  → landlord USDC: ${fromUnits(await usdc(landlord.accountId))} (no agent fee)`);

  console.log('\n6) Move-out and caution refund');
  step(await gaslessCall(API, mum, deploy.escrow, 'move_out', { lease_id: leaseId }), 'mum move_out');
  step(await gaslessCall(API, landlord, deploy.escrow, 'approve_move_out', { lease_id: leaseId }), 'landlord approve_move_out');
  step(await gaslessCall(API, mum, deploy.escrow, 'withdraw', {}), 'mum withdraw');
  console.log(`  → mum USDC: ${fromUnits(await settled(() => usdc(mum.accountId), (b) => b > 0n))} — caution returned to the NFT holder`);

  const nurseNearAfter = await near(nurse.accountId);
  const after: any = await settled(() => view<any>(deploy.escrow, 'nft_token', { token_id: String(leaseId) }), (t) => !/Active/.test(t?.metadata?.title ?? ''));
  console.log(`\n✔ Done. Lease NFT now reads: "${after.metadata.title}"`);
  const spent = BigInt(nurseNearBefore) - BigInt(nurseNearAfter);
  console.log(`  Gas: the relayer paid all of it. The nurse's NEAR balance changed by ${spent} yoctoNEAR.`);
  console.log(`  Lease: near contract call-function as-read-only ${deploy.escrow} get_lease json-args '{"lease_id":${leaseId}}' network-config testnet now\n`);
} catch (e) {
  console.error('\n✗', (e as Error).message);
  process.exitCode = 1;
} finally {
  server.close();
}

/**
 * Checks every on-chain claim in the README against NEAR testnet, read-only, in about a minute:
 *
 *   bun run verify:live
 *
 * No keys, no accounts, no .env. Each line is ✓ or ✗ with what was expected and what was found;
 * the exit code is 1 if anything doesn't match. If you built the contract
 * (`cd contract && cargo near build non-reproducible-wasm`), your wasm is compared to the deployed code too.
 * Network values come from deploy/testnet.json; the expected values are the ones in docs/EVIDENCE.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import deploy from '../deploy/testnet.json';

const RPCS = [deploy.rpc, 'https://rpc.testnet.near.org'];
const CODE_HASH = '76d4GThLisp93P62BHtXs8Q2zy8TSj96f6JfVbKDJvZo';
const COUNCIL = ['council-1.handova.testnet', 'council-2.handova.testnet', 'tester1604.testnet'];
const SERVER_ACCOUNTS = ['handova.testnet', 'verifier.handova.testnet', 'handova-relayer.testnet'];
const WEEK_SECS = 7 * 24 * 60 * 60;

async function rpc(method: string, params: object): Promise<any> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`No RPC answered (${RPCS.join(', ')}): ${(last as Error)?.message}`);
}

const query = (params: object) => rpc('query', { finality: 'final', ...params });
async function view<T = any>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await query({ request_type: 'call_function', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString());
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer): string {
  let n = BigInt('0x' + bytes.toString('hex'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  return s;
}

let failed = 0;
function check(claim: string, ok: boolean, found: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${claim}\n      ${found}`);
}

const escrow = deploy.escrow;
console.log(`\nHandova live check: ${escrow} on NEAR ${deploy.network}\n`);

console.log('The code');
const account = await query({ request_type: 'view_account', account_id: escrow });
check('Deployed code is the published build', account.code_hash === CODE_HASH, `code_hash ${account.code_hash} (expected ${CODE_HASH})`);
const keys = (await query({ request_type: 'view_access_key_list', account_id: escrow })).keys;
check('Nobody can change it: the escrow account has no keys', keys.length === 0, `${keys.length} access keys`);
const wasmDir = 'contract/target/near';
const wasm = existsSync(wasmDir) && readdirSync(wasmDir).find((f) => f.endsWith('.wasm'));
if (wasm) {
  const local = base58(createHash('sha256').update(readFileSync(`${wasmDir}/${wasm}`)).digest());
  check('Your local build matches the deployed code', local === account.code_hash, `${wasm}: ${local}`);
} else {
  console.log('    (no local build in contract/target/near; build it to compare your own wasm)');
}

console.log('\nWho holds power');
const cfg = await view(escrow, 'get_config');
check('The council DAO is the arbiter and the owner', cfg.arbiter === deploy.arbiter && cfg.owner === deploy.arbiter, `arbiter ${cfg.arbiter}, owner ${cfg.owner}`);
const t = cfg.timeouts;
check('Every waiting period is 7 days', [t.cancel_after_secs, t.move_out_review_secs, t.dispute_secs].every((s) => s === WEEK_SECS), JSON.stringify(t));
const policy = await view(deploy.arbiter, 'get_policy');
const members: string[] = policy.roles.flatMap((r: any) => r.kind.Group ?? []).sort();
check('Council: 2 of 3 votes, the three team accounts', JSON.stringify(members) === JSON.stringify(COUNCIL) && policy.default_vote_policy.threshold === '2', `members ${members.join(', ')}; threshold ${JSON.stringify(policy.default_vote_policy.threshold)}`);
check('No account the API server signs with sits on the council', !members.some((m) => SERVER_ACCOUNTS.includes(m)), `server accounts: ${SERVER_ACCOUNTS.join(', ')}`);
const vKeys = (await query({ request_type: 'view_access_key_list', account_id: deploy.verifier })).keys;
const limited = vKeys.find((k: any) => k.access_key.permission.FunctionCall?.receiver_id === escrow && JSON.stringify(k.access_key.permission.FunctionCall.method_names) === '["set_verified"]');
check("The verifier has a key that can only call set_verified (the server's)", !!limited, `${vKeys.length} keys on ${deploy.verifier}`);

console.log('\nMoney');
const balance = await view<string>(deploy.token, 'ft_balance_of', { account_id: escrow });
check("The escrow's USDC equals what it owes (total_held)", balance === cfg.total_held, `ft_balance_of ${balance}, total_held ${cfg.total_held}`);
check('Listings pay their own storage', cfg.listing_deposit === '60000000000000000000000' && cfg.lease_storage === '40960000000000000000000', `listing_deposit ${cfg.listing_deposit}, lease_storage ${cfg.lease_storage}`);

console.log('\nLeases');
const lease = (id: number) => view(escrow, 'get_lease', { lease_id: id });
const l4 = await lease(4);
check('Lease #4: family paid, the caution went to the NFT holder (mum)', l4.status === 'Closed' && l4.payer !== l4.tenant && l4.closed_holder === l4.tenant && l4.caution_to_holder === l4.caution, `${l4.status}; payer ${l4.payer}, holder ${l4.closed_holder}, caution ${l4.caution} → holder ${l4.caution_to_holder}`);
const l5 = await lease(5);
const nft5 = await view(escrow, 'nft_token', { token_id: '5' });
check('Lease #5: taken over, the caution went to the new holder', l5.status === 'Closed' && l5.payer !== l5.closed_holder && nft5.owner_id === l5.closed_holder && l5.caution_to_holder === l5.caution, `${l5.status}; first payer ${l5.payer}, holder ${l5.closed_holder} owns NFT #5 ("${nft5.metadata.title}"), caution → holder ${l5.caution_to_holder}`);
const l1 = await lease(1);
check('Lease #1: sold on Mintbase to the buyer the landlord named', l1.tenant === l1.nft_holder && l1.payer !== l1.tenant && l1.takeover === null, `tenant and holder ${l1.tenant}, first tenant ${l1.payer}`);
const l3 = await lease(3);
check('Lease #3: the council split a disputed caution', l3.status === 'Closed' && l3.caution_to_landlord === '1000000' && l3.caution_to_holder === '3000000', `${l3.status}; landlord ${l3.caution_to_landlord}, holder ${l3.caution_to_holder}`);

console.log(failed ? `\n✗ ${failed} check(s) did not match.\n` : '\n✔ Every on-chain claim checked out.\n');
process.exit(failed ? 1 : 0);

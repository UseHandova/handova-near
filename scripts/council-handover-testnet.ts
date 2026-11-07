/**
 * Takes the server's keys out of Handova's power on testnet, and prints every transaction hash.
 *
 *   bun scripts/council-handover-testnet.ts
 *
 * Before: the Railway server held the keys of two of the council's three seats (handova.testnet, which
 * creates accounts, and verifier.handova.testnet), so whoever took the server held a 2-of-3 majority.
 * It also held the escrow's owner key and a full-access verifier key.
 *
 * 1. Two council accounts whose keys stay in this machine's NEAR keychain (~/.near-credentials), never
 *    on a server: council-1 and council-2.handova.testnet.
 * 2. Council votes: add both, then remove verifier.handova.testnet and handova.testnet. Members after:
 *    tester1604.testnet, council-1, council-2. Still team accounts, but none is held by the server.
 * 3. The escrow's owner becomes the council DAO: changing the arbiter or the verifier for future leases
 *    takes a 2-of-3 vote.
 * 4. The verifier account's only key the server holds becomes a function-call key that can call only
 *    set_verified on the escrow. Its old full-access key is deleted; a new one is kept in the keychain.
 *    .env is rewritten with the new verifier key; copy it to the host's env after.
 *
 * Each step checks the chain first, so running it again skips what's already done.
 * Needs CREATOR_* and VERIFIER_* in .env (the keys being retired).
 */
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const deploy = JSON.parse(readFileSync('deploy/testnet.json', 'utf8'));
const provider = new JsonRpcProvider({ url: deploy.rpc });
const TGAS = 1_000_000_000_000n;
const tx = (h: string) => `${deploy.explorer}/txns/${h}`;
const dao: string = deploy.arbiter;
const COUNCIL = ['council-1', 'council-2'].map((n) => `${n}.${deploy.accountParent}`);

const creator = new Account(process.env.CREATOR_ACCOUNT_ID!, provider, process.env.CREATOR_PRIVATE_KEY as KeyPairString);
const verifierKey = process.env.VERIFIER_NEAR_PRIVATE_KEY as KeyPairString;
const verifier = new Account(process.env.VERIFIER_ACCOUNT_ID!, provider, verifierKey);

const keychainDir = join(homedir(), '.near-credentials', deploy.network);
const keychainFile = (id: string) => join(keychainDir, `${id}.json`);
function saveKey(id: string, kp: KeyPair) {
  mkdirSync(keychainDir, { recursive: true });
  writeFileSync(keychainFile(id), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
}
const fromKeychain = (id: string) => new Account(id, provider, JSON.parse(readFileSync(keychainFile(id), 'utf8')).private_key as KeyPairString);

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) => provider.callFunction({ contractId, method, args }) as Promise<T>;
const exists = (id: string) => provider.viewAccount({ accountId: id }).then(() => true, () => false);
const members = async () => (await view<any>(dao, 'get_policy')).roles.find((r: any) => r.name === 'council').kind.Group as string[];

async function send(what: string, from: Account, receiverId: string, acts: ReturnType<typeof actions.transfer>[]) {
  const o: any = await from.signAndSendTransaction({ receiverId, actions: acts, throwOnFailure: false });
  const failed = o.status?.Failure ?? o.receipts_outcome?.find((r: any) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failed) throw new Error(`${what} failed: ${JSON.stringify(failed)}   ${tx(o.transaction.hash)}`);
  console.log(`  ✓ ${what}   ${tx(o.transaction.hash)}`);
  return o;
}
const call = (what: string, from: Account, contractId: string, method: string, args: object, deposit = 0n, gas = 50n * TGAS) =>
  send(what, from, contractId, [actions.functionCall(method, args, gas, deposit)]);

/** A council proposal, voted through by two members (the first one proposes). */
async function vote(what: string, kind: object, a: Account, b: Account) {
  const { proposal_bond } = await view<{ proposal_bond: string }>(dao, 'get_policy');
  const o = await call(`propose: ${what} (by ${a.accountId})`, a, dao, 'add_proposal', { proposal: { description: `[Handova] ${what}`, kind } }, BigInt(proposal_bond));
  const id = JSON.parse(Buffer.from(o.status.SuccessValue, 'base64').toString());
  await call(`vote 1 of 2 on #${id} (${a.accountId})`, a, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: kind }, 0n, 200n * TGAS);
  await call(`vote 2 of 2 on #${id} (${b.accountId})`, b, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: kind }, 0n, 200n * TGAS);
  const p = await view<any>(dao, 'get_proposal', { id });
  if (p.status !== 'Approved') throw new Error(`proposal #${id} is ${p.status}`);
}

console.log(`\nHandova council handover on NEAR ${deploy.network}: escrow ${deploy.escrow}, council ${dao}\n`);
console.log(`Before: council ${(await members()).join(', ')}; owner ${(await view<any>(deploy.escrow, 'get_config')).owner}\n`);

console.log('1) Council accounts whose keys stay off the server');
for (const id of COUNCIL) {
  if (await exists(id)) { console.log(`  · ${id} exists`); continue; }
  const kp = KeyPair.fromRandom('ed25519');
  saveKey(id, kp); // saved before the account exists, so the key can't be lost
  await send(`create ${id} (key in ${keychainFile(id)})`, creator, id, [actions.createAccount(), actions.transfer(nearToYocto('0.5')), actions.addFullAccessKey(kp.getPublicKey())]);
}
const [c1, c2] = COUNCIL.map(fromKeychain);

console.log('\n2) Council votes');
const role = (member_id: string, add: boolean) => (add ? { AddMemberToRole: { member_id, role: 'council' } } : { RemoveMemberFromRole: { member_id, role: 'council' } });
for (const c of [c1, c2]) if (!(await members()).includes(c.accountId)) await vote(`add ${c.accountId} to the council`, role(c.accountId, true), creator, verifier);
if ((await members()).includes(verifier.accountId)) await vote(`remove ${verifier.accountId}: its key is on the API server`, role(verifier.accountId, false), creator, c1);
if ((await members()).includes(creator.accountId)) await vote(`remove ${creator.accountId}: its key is on the API server`, role(creator.accountId, false), c1, c2);

console.log('\n3) The escrow\'s owner becomes the council');
if ((await view<any>(deploy.escrow, 'get_config')).owner === creator.accountId) await call(`set_owner(${dao})`, creator, deploy.escrow, 'set_owner', { owner: dao });
else console.log('  · already done');

console.log('\n4) The verifier key on the server can only call set_verified');
const keys: any[] = (await provider.viewAccessKeyList({ accountId: verifier.accountId })).keys;
const current = KeyPair.fromString(verifierKey).getPublicKey().toString();
if (keys.find((k) => k.public_key === current)?.access_key.permission === 'FullAccess') {
  const fc = KeyPair.fromRandom('ed25519');
  const full = KeyPair.fromRandom('ed25519');
  if (existsSync(keychainFile(verifier.accountId))) throw new Error(`${keychainFile(verifier.accountId)} exists; move it aside first`);
  saveKey(verifier.accountId, full);
  await send(`${verifier.accountId}: add a set_verified-only key, keep a full-access key off the server, delete the old one`, verifier, verifier.accountId, [
    actions.addFunctionCallAccessKey(fc.getPublicKey(), deploy.escrow, ['set_verified'], nearToYocto('0.25')),
    actions.addFullAccessKey(full.getPublicKey()),
    actions.deleteKey(KeyPair.fromString(verifierKey).getPublicKey()),
  ]);
  const env = readFileSync('.env', 'utf8').replace(/^VERIFIER_NEAR_PRIVATE_KEY=.*$/m, `VERIFIER_NEAR_PRIVATE_KEY=${fc.toString()}`);
  writeFileSync('.env', env);
  console.log(`  → .env now holds the set_verified-only key (${fc.getPublicKey().toString()}); copy it to the host`);
} else console.log('  · already done');

const after = await provider.viewAccessKeyList({ accountId: verifier.accountId });
console.log(`\nAfter: council ${(await members()).join(', ')}; owner ${(await view<any>(deploy.escrow, 'get_config')).owner}`);
console.log(`       ${verifier.accountId} keys: ${after.keys.map((k: any) => (k.access_key.permission === 'FullAccess' ? 'full access (keychain only)' : `function call ${JSON.stringify(k.access_key.permission.FunctionCall.method_names)} on ${k.access_key.permission.FunctionCall.receiver_id}`)).join('; ')}\n`);

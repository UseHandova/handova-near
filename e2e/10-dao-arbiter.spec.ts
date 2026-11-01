/** A Sputnik DAO council (2 of 3) settles a caution dispute; the DAO itself calls the escrow. */
import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';
import { generateSeedPhrase } from 'near-api-js/seed-phrase';
import { activeLease, apiPost, arbiter, chain, disputed, expect, expectLease, signInWithPhrase, signUp, test, toast } from './helpers';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deploy, secrets } from './env';

/** The DAO and its council are created once and reused (a DAO costs 6 testnet NEAR). */
const DAO_FILE = 'deploy/dao.e2e.json';

const provider = new JsonRpcProvider({ url: deploy.rpc });
const owner = new Account(secrets.CREATOR_ACCOUNT_ID, provider, secrets.CREATOR_PRIVATE_KEY as KeyPairString);
const members: Array<{ accountId: string; seedPhrase: string }> = [];
let dao = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (existsSync(DAO_FILE)) {
    const saved = JSON.parse(readFileSync(DAO_FILE, 'utf8'));
    if (saved.escrow === deploy.escrow) {
      dao = saved.dao;
      members.push(...saved.members);
      await owner.callFunction({ contractId: deploy.escrow, methodName: 'set_arbiter', args: { arbiter: dao }, gas: teraToGas('30') });
      return;
    }
  }
  for (let i = 0; i < 3; i++) {
    const { seedPhrase, keyPair } = generateSeedPhrase();
    const r = await apiPost('/api/accounts', { name: `council${i}-${Date.now().toString(36)}`, publicKey: keyPair.getPublicKey().toString() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Proposal bond (0.1 NEAR) and gas come from the member's own account.
    await owner.transfer({ receiverId: r.body.accountId, amount: nearToYocto('0.5') });
    members.push({ accountId: r.body.accountId, seedPhrase });
  }
  const name = `e2e-council-${Date.now().toString(36)}`;
  const policy = {
    roles: [{ name: 'council', kind: { Group: members.map((m) => m.accountId) }, permissions: ['*:*'], vote_policy: {} }],
    default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: '2' },
    proposal_bond: nearToYocto('0.1').toString(),
    proposal_period: '604800000000000',
    bounty_bond: nearToYocto('0.1').toString(),
    bounty_forgiveness_period: '86400000000000',
  };
  await owner.callFunction({
    contractId: 'sputnikv2.testnet',
    methodName: 'create',
    args: { name, args: Buffer.from(JSON.stringify({ config: { name, purpose: 'Handova e2e arbiter', metadata: '' }, policy })).toString('base64') },
    deposit: nearToYocto('6'),
    gas: teraToGas('300'),
  });
  dao = `${name}.sputnikv2.testnet`;
  writeFileSync(DAO_FILE, JSON.stringify({ escrow: deploy.escrow, dao, members }, null, 2));
  await owner.callFunction({ contractId: deploy.escrow, methodName: 'set_arbiter', args: { arbiter: dao }, gas: teraToGas('30') });
});

test.afterAll(async () => {
  // Hand the role back to the plain arbiter account the other specs use.
  await owner.callFunction({ contractId: deploy.escrow, methodName: 'set_arbiter', args: { arbiter: arbiter().accountId }, gas: teraToGas('30') });
});

test('caution dispute decided by a 2-of-3 DAO council', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const a = await phone('council-a');
  const b = await phone('council-b');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  await signInWithPhrase(a, members[0].accountId, members[0].seedPhrase);
  await signInWithPhrase(b, members[1].accountId, members[1].seedPhrase);
  expect((await chain.config()).arbiter).toBe(dao);

  const { leaseId, rent, caution } = await activeLease(ll, tn, tenant);
  await disputed(ll, tn, leaseId, (Number(caution) / 1e6).toFixed(2));

  // Parties see who decides.
  await tn.goto(`/#/lease/${leaseId}`);
  await expect(tn.getByText('Decided by the arbiter DAO')).toBeVisible();

  // Council member A proposes: landlord keeps 1 USDC. Then A and B approve.
  await a.goto(`/#/lease/${leaseId}`);
  await a.getByLabel('DAO ruling amount').fill('1');
  await a.getByRole('button', { name: 'Propose this split' }).click();
  await toast(a, /Proposed to the council/);
  await a.getByRole('button', { name: 'Approve' }).click();
  await toast(a, /Vote recorded/);
  expect((await chain.lease(leaseId)).status).toBe('Disputed'); // one vote isn't enough

  await b.goto(`/#/lease/${leaseId}`);
  await b.getByRole('button', { name: 'Approve' }).click();
  await toast(b, /Vote recorded/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(landlord)).toBe(rent + 1_000_000n);
  expect(await chain.escrowBalance(tenant)).toBe(caution - 1_000_000n);
  await b.reload();
  await expect(b.getByText(/Proposal #\d+: Landlord keeps 1.00 USDC/)).toBeVisible();
});

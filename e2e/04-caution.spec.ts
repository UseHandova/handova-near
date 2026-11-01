import { act, activeLease, apiPost, arbiter, chain, disputed, expect, expectLease, signInWithPhrase, signUp, test, toast, waitPeriod, openLease } from './helpers';

const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);

test('caution dispute settled by agreement', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId, rent, caution } = await activeLease(ll, tn, tenant);
  await disputed(ll, tn, leaseId, usdc(caution));
  const keep = caution / 4n;

  await openLease(tn, leaseId);
  await expect(tn.getByText(/Broken kitchen door/)).toBeVisible();
  await tn.getByPlaceholder(/USDC, 0 to/).fill(usdc(keep));
  await tn.getByRole('button', { name: 'Propose' }).click();
  await toast(tn, /Proposal sent/);
  await expectLease(leaseId, 'Disputed');

  await openLease(ll, leaseId);
  await ll.getByPlaceholder(/USDC, 0 to/).fill(usdc(keep));
  await ll.getByRole('button', { name: 'Propose' }).click();
  await toast(ll, /Proposal sent/);
  await expectLease(leaseId, 'Closed');
  const l = await chain.lease(leaseId);
  expect(BigInt(l.caution_to_landlord) + BigInt(l.caution_to_holder)).toBe(caution);
  expect(await chain.escrowBalance(landlord)).toBe(rent + BigInt(l.caution_to_landlord));
  expect(await chain.escrowBalance(tenant)).toBe(BigInt(l.caution_to_holder));
});

test('caution dispute decided by the arbiter', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const ar = await phone('arbiter');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const a = arbiter();
  await signInWithPhrase(ar, a.accountId, a.seedPhrase);
  const { leaseId, rent, caution } = await activeLease(ll, tn, tenant);
  await disputed(ll, tn, leaseId, usdc(caution));

  await openLease(ar, leaseId);
  await ar.getByLabel('Arbiter amount').fill('1.00');
  await ar.getByRole('button', { name: 'Decide' }).click();
  await toast(ar, /Decision recorded/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(landlord)).toBe(rent + 1_000_000n);
  expect(await chain.escrowBalance(tenant)).toBe(caution - 1_000_000n);
});

test('dispute nobody settles: 50/50 after the window', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId, rent, caution } = await activeLease(ll, tn, tenant);
  await disputed(ll, tn, leaseId, usdc(caution));
  await openLease(tn, leaseId);
  await expect(tn.getByRole('button', { name: /Settle 50\/50/ })).toHaveCount(0);
  await waitPeriod(tn);
  await act(tn, leaseId, /Settle 50\/50/, /Settled 50\/50/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(landlord)).toBe(rent + caution / 2n);
  expect(await chain.escrowBalance(tenant)).toBe(caution - caution / 2n);
});

test('landlord silent after move-out: tenant claims the caution', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId, caution } = await activeLease(ll, tn, tenant);
  await act(tn, leaseId, /moving out/, /Move-out started/);
  await expect(tn.getByText(/the caution comes back automatically/)).toBeVisible();
  await waitPeriod(tn);
  await act(tn, leaseId, /Return the caution now/, /Caution returned/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(tenant)).toBe(caution);
  // Too late for the landlord to dispute: the button is gone.
  await openLease(ll, leaseId);
  await expect(ll.getByRole('button', { name: 'Open a dispute' })).toHaveCount(0);
});

test('the keeper closes a review nobody acted on', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId, caution } = await activeLease(ll, tn, tenant);
  await act(tn, leaseId, /moving out/, /Move-out started/);
  await waitPeriod(tn);
  const r = await apiPost('/api/near/keeper/run', {}, true);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.log.join('\n')).toContain(`claim_caution(${leaseId}) ok`);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(tenant)).toBe(caution);
});

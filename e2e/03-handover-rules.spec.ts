import { act, apiPost, arbiter, chain, expect, expectLease, faucet, listHome, pay, signInWithPhrase, signUp, test, toast, waitPeriod } from './helpers';

test('tenant silent after handover: a verified landlord claims the rent', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  expect((await apiPost('/api/near/verify-landlord', { accountId: landlord }, true)).status).toBe(200);
  const listingId = await listHome(ll, { title: 'Silent tenant', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(tenant);
  const leaseId = await pay(tn, listingId);
  await act(ll, leaseId, /handed over the keys/, /Handover marked/);
  await expect(ll.getByText(/you can claim in/)).toBeVisible();
  await expect(ll.getByRole('button', { name: /Claim the rent/ })).toHaveCount(0);
  // The tenant can no longer cancel once the handover is marked.
  await tn.goto(`/#/lease/${leaseId}`);
  await expect(tn.getByRole('button', { name: /Cancel and get a full refund/ })).toHaveCount(0);
  await waitPeriod(ll);
  await act(ll, leaseId, /Claim the rent/, /Move-in claimed/);
  await expectLease(leaseId, 'Active');
  expect(await chain.escrowBalance(landlord)).toBe(BigInt((await chain.lease(leaseId)).rent));
  expect((await chain.nft(leaseId)).owner_id).toBe(tenant);
});

test('fake handover: tenant disputes, landlord cannot claim, arbiter refunds; second case arbiter rules moved in', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const ar = await phone('arbiter');
  const landlord = await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const a = arbiter();
  await signInWithPhrase(ar, a.accountId, a.seedPhrase);

  const l1 = await listHome(ll, { title: 'Fake handover', rentNgn: 20_000, cautionNgn: 5_000 });
  const l2 = await listHome(ll, { title: 'Real handover', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(tenant);
  const lease1 = await pay(tn, l1);
  const lease2 = await pay(tn, l2);
  for (const id of [lease1, lease2]) {
    await act(ll, id, /handed over the keys/, /Handover marked/);
    await tn.goto(`/#/lease/${id}`);
    await tn.getByPlaceholder(/What happened/).fill('No keys, house locked');
    await tn.getByRole('button', { name: "I didn't get the keys" }).click();
    await toast(tn, /Dispute sent/);
  }
  expect((await chain.lease(lease1)).move_in_dispute).toBe('No keys, house locked');

  await waitPeriod(ll);
  await ll.goto(`/#/lease/${lease1}`);
  await expect(ll.getByText(/The tenant disputed the handover/)).toBeVisible();
  await expect(ll.getByRole('button', { name: /Claim the rent/ })).toHaveCount(0);

  // The arbiter finds both on the desk.
  await ar.goto('/#/account');
  await ar.getByRole('link', { name: 'Arbiter desk' }).click();
  await expect(ar.getByText(`Lease #${lease1}`)).toBeVisible();
  await expect(ar.getByText(`Lease #${lease2}`)).toBeVisible();

  await act(ar, lease1, /no handover — refund the payer/, /Ruled: refund/);
  await expectLease(lease1, 'Cancelled');
  const r1 = await chain.lease(lease1);
  expect(await chain.escrowBalance(tenant)).toBe(BigInt(r1.rent) + BigInt(r1.caution));

  await act(ar, lease2, /the tenant moved in/, /Ruled: moved in/);
  await expectLease(lease2, 'Active');
  expect(await chain.escrowBalance(landlord)).toBe(BigInt((await chain.lease(lease2)).rent));
});

test('unverified landlord cannot collect by silence; an arbiter who stays silent means a refund', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const l1 = await listHome(ll, { title: 'Unverified silence', rentNgn: 20_000, cautionNgn: 5_000 });
  const l2 = await listHome(ll, { title: 'Silent arbiter', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(tenant);
  const lease1 = await pay(tn, l1);
  const lease2 = await pay(tn, l2);
  await act(ll, lease1, /handed over the keys/, /Handover marked/);
  await act(ll, lease2, /handed over the keys/, /Handover marked/);
  await tn.goto(`/#/lease/${lease2}`);
  await tn.getByPlaceholder(/What happened/).fill('Keys never arrived');
  await tn.getByRole('button', { name: "I didn't get the keys" }).click();
  await toast(tn, /Dispute sent/);

  await waitPeriod(ll);
  // Fake-listing protection: an unverified landlord never gets a claim button.
  await ll.goto(`/#/lease/${lease1}`);
  await expect(ll.getByText(/Only ID-verified landlords can collect/)).toBeVisible();
  await expect(ll.getByRole('button', { name: /Claim the rent/ })).toHaveCount(0);
  expect((await chain.lease(lease1)).status).toBe('Pending');

  // The arbiter never ruled: anyone can refund the payer.
  await act(tn, lease2, /arbiter didn't decide in time/, /Refunded/);
  await expectLease(lease2, 'Cancelled');
  const l = await chain.lease(lease2);
  expect(await chain.escrowBalance(tenant)).toBe(BigInt(l.rent) + BigInt(l.caution));
});

import { act, chain, expect, expectLease, faucet, listHome, pay, signUp, test, toast, waitPeriod, withdrawAll, openLease } from './helpers';

test('family abroad pays for mum; only mum confirms; she gets the NFT', async ({ phone }) => {
  const ll = await phone('landlord');
  const nurse = await phone('nurse');
  const mumP = await phone('mum');
  await signUp(ll, 'll');
  const payer = await signUp(nurse, 'nurse');
  const mum = await signUp(mumP, 'mum');
  const listingId = await listHome(ll, { title: 'Family pays', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(payer);
  const leaseId = await pay(nurse, listingId, { forTenant: mum });
  expect(await chain.lease(leaseId)).toMatchObject({ tenant: mum, payer, status: 'Pending' });
  await expect(nurse.getByText(/by nurse-.* for mum-/)).toBeVisible();
  await expect(nurse.getByRole('button', { name: /confirm move-in/ })).toHaveCount(0);

  await nurse.goto('/#/rentals');
  await expect(nurse.getByText(/You paid for mum-/)).toBeVisible();

  await act(ll, leaseId, /handed over the keys/, /Handover marked/);
  await act(mumP, leaseId, /confirm move-in/, /Moved in!/);
  await expectLease(leaseId, 'Active');
  expect((await chain.nft(leaseId)).owner_id).toBe(mum);
});

test('no handover in time: the payer cancels and gets everything back', async ({ phone }) => {
  const ll = await phone('landlord');
  const nurse = await phone('nurse');
  await signUp(ll, 'll');
  const payer = await signUp(nurse, 'nurse');
  const mumP = await phone('mum');
  const mum = await signUp(mumP, 'mum');
  const listingId = await listHome(ll, { title: 'Slow landlord', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(payer);
  const before = await chain.usdc(payer);
  const leaseId = await pay(nurse, listingId, { forTenant: mum });
  const total = BigInt((await chain.lease(leaseId)).rent) + BigInt((await chain.lease(leaseId)).caution);

  await openLease(nurse, leaseId);
  await expect(nurse.getByText(/can cancel for a full refund/)).toBeVisible();
  await expect(nurse.getByRole('button', { name: /Cancel and get a full refund/ })).toHaveCount(0);
  await waitPeriod(nurse);
  await act(nurse, leaseId, /Cancel and get a full refund/, /Cancelled/);
  await expectLease(leaseId, 'Cancelled');
  expect(await chain.escrowBalance(payer)).toBe(total);
  expect(await chain.escrowBalance(mum)).toBe(0n);
  await withdrawAll(nurse);
  expect(await chain.usdc(payer)).toBe(before);
  expect((await chain.listing(listingId)).active_lease).toBeNull();
});

test('landlord declines before move-in: tenant refunded in full', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const listingId = await listHome(ll, { title: 'Declined', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(tenant);
  const leaseId = await pay(tn, listingId);
  const l = await chain.lease(leaseId);
  await act(ll, leaseId, /Decline and refund/, /Declined/);
  await expectLease(leaseId, 'Cancelled');
  expect(await chain.escrowBalance(tenant)).toBe(BigInt(l.rent) + BigInt(l.caution));
  await openLease(tn, leaseId);
  await expect(tn.getByText('Cancelled · refunded').first()).toBeVisible();
});

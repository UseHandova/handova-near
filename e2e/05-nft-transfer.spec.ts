import { act, activeLease, chain, expect, expectLease, signUp, test, toast, openLease } from './helpers';

test('lease handed to family for free, only after the landlord agrees: the caution right moves with it', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const nw = await phone('new-tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const newTenant = await signUp(nw, 'nt');
  const { leaseId, caution } = await activeLease(ll, tn, tenant);

  // Free handover: offer at 0, the new tenant asks, the landlord agrees to them, the holder hands it over.
  await openLease(tn, leaseId);
  await tn.getByLabel('Takeover price').fill('0');
  await tn.getByRole('button', { name: 'Offer for takeover' }).click();
  await toast(tn, /Offer published/);
  await act(nw, leaseId, /Ask to take over this lease/, /Asked/);
  await act(ll, leaseId, /Agree to .* taking over/, /Agreed/);
  await openLease(tn, leaseId);
  await tn.getByRole('button', { name: /Hand the lease to/ }).click();
  await toast(tn, /Lease handed to/);
  await expect.poll(async () => (await chain.lease(leaseId)).nft_holder).toBe(newTenant);
  expect((await chain.nft(leaseId)).owner_id).toBe(newTenant);

  await tn.reload();
  await expect(tn.getByRole('button', { name: /moving out/ })).toHaveCount(0);
  await nw.goto('/#/rentals');
  await expect(nw.getByText(`Lease #${leaseId}`)).toBeVisible();

  await act(nw, leaseId, /moving out/, /Move-out started/);
  // Locked during review: no takeover offer can be made.
  await expect(nw.getByRole('button', { name: 'Offer for takeover' })).toHaveCount(0);
  expect((await chain.lease(leaseId)).tenant).toBe(newTenant);
  await act(ll, leaseId, /return the caution/, /Approved/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(newTenant)).toBe(caution);
  expect(await chain.escrowBalance(tenant)).toBe(0n);
});

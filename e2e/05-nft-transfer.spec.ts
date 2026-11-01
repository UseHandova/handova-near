import { act, activeLease, chain, expect, expectLease, signUp, test, toast } from './helpers';

test('lease NFT passed to a new tenant: the caution right moves with it', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const nw = await phone('new-tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const newTenant = await signUp(nw, 'nt');
  const { leaseId, caution } = await activeLease(ll, tn, tenant);

  await tn.goto(`/#/lease/${leaseId}`);
  await tn.getByPlaceholder(/name {2}or {2}name\./).fill(newTenant.split('.')[0]);
  await tn.getByRole('button', { name: 'Send lease NFT' }).click();
  await toast(tn, /Lease NFT sent/);
  await expect.poll(async () => (await chain.lease(leaseId)).nft_holder).toBe(newTenant);
  expect((await chain.nft(leaseId)).owner_id).toBe(newTenant);

  await tn.reload();
  await expect(tn.getByRole('button', { name: /moving out/ })).toHaveCount(0);
  await nw.goto('/#/rentals');
  await expect(nw.getByText(`Lease #${leaseId}`)).toBeVisible();

  await act(nw, leaseId, /moving out/, /Move-out started/);
  // Locked during review: the transfer box is gone.
  await expect(nw.getByRole('button', { name: 'Send lease NFT' })).toHaveCount(0);
  await act(ll, leaseId, /return the caution/, /Approved/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(newTenant)).toBe(caution);
  expect(await chain.escrowBalance(tenant)).toBe(0n);
});

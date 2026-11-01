import { chain, expect, faucet, listHome, pay, signUp, test, toast } from './helpers';

test('landlord pauses, resumes and reprices; price locks while a lease is open', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const listingId = await listHome(ll, { title: 'Controls', rentNgn: 20_000, cautionNgn: 5_000 });

  await ll.getByRole('button', { name: 'Pause listing' }).click();
  await toast(ll, /Listing paused/);
  await expect.poll(async () => (await chain.listing(listingId)).available).toBe(false);
  await tn.goto(`/#/home/${listingId}`);
  await expect(tn.getByRole('button', { name: 'Paused by the landlord' })).toBeDisabled();

  await ll.getByRole('button', { name: 'Resume listing' }).click();
  await toast(ll, /Listing open again/);
  const oldRent = BigInt((await chain.listing(listingId)).rent);
  await ll.getByLabel('New rent in Naira').fill('30000');
  await ll.getByRole('button', { name: 'Save price' }).click();
  await toast(ll, /Price updated/);
  await expect.poll(async () => BigInt((await chain.listing(listingId)).rent)).toBeGreaterThan(oldRent);

  await faucet(tenant);
  const leaseId = await pay(tn, listingId);
  expect(BigInt((await chain.lease(leaseId)).rent)).toBe(BigInt((await chain.listing(listingId)).rent));
  await ll.goto(`/#/home/${listingId}`);
  await expect(ll.getByText(`Lease #${leaseId} is open on this home.`)).toBeVisible();
  await expect(ll.getByRole('button', { name: 'Save price' })).toHaveCount(0);
  await tn.goto(`/#/home/${listingId}`);
  await expect(tn.getByRole('button', { name: 'Taken' })).toBeDisabled();
});

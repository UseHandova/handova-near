import { act, apiPost, chain, expect, expectLease, faucet, listHome, pay, signInWithPhrase, signUp, test, toast, withdrawAll, openLease } from './helpers';

test('list → pay → handover → move-in → NFT → landlord paid → move-out → caution back', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const landlord = await signUp(ll, 'ade');
  const tenant = await signUp(tn, 'tolu');

  // Verified badge comes from the verifier key, through the admin API.
  const v = await apiPost('/api/near/verify-landlord', { accountId: landlord }, true);
  expect(v.status, JSON.stringify(v.body)).toBe(200);

  const listingId = await listHome(ll, { title: 'E2E 2-bed in Yaba', rentNgn: 20_000, cautionNgn: 5_000 });
  const listing = await chain.listing(listingId);
  expect(listing.landlord).toBe(landlord);
  expect(listing.landlord_verified).toBe(true);
  const rent = BigInt(listing.rent);
  const caution = BigInt(listing.caution);

  // Tenant sees it on the home page, with the verified badge.
  await tn.goto('/');
  await tn.getByText('E2E 2-bed in Yaba').first().click();
  await expect(tn.getByText('ID verified')).toBeVisible();

  // Faucet button inside the pay sheet, then pay.
  await tn.getByRole('button', { name: /into escrow/ }).click();
  await tn.getByRole('button', { name: /Get 2,000 test USDC/ }).click();
  await toast(tn, /Added 2,000 test USDC/);
  await tn.getByRole('button', { name: /^Pay [\d,.]+ USDC$/ }).click();
  await tn.waitForURL(/#\/lease\/\d+/);
  const leaseId = Number(tn.url().split('/').pop());
  await expect(tn.getByText('In escrow · waiting for move-in')).toBeVisible();
  let lease = await chain.lease(leaseId);
  expect(lease).toMatchObject({ status: 'Pending', tenant, payer: tenant, landlord });
  expect(await chain.usdc(tenant)).toBe(2_000n * 1_000_000n - rent - caution);

  await act(ll, leaseId, /handed over the keys/, /Handover marked/);
  await act(tn, leaseId, /confirm move-in/, /Moved in!/);
  await expectLease(leaseId, 'Active');
  await expect(tn.locator('img[alt^="Handova lease"]')).toBeVisible();
  const nft = await chain.nft(leaseId);
  expect(nft.owner_id).toBe(tenant);
  expect(nft.metadata.title).toContain('Active');
  expect(JSON.parse(nft.metadata.extra).caution_held).toBe(caution.toString());

  expect(await chain.escrowBalance(landlord)).toBe(rent);
  await withdrawAll(ll);
  expect(await chain.usdc(landlord)).toBe(rent);
  expect(await chain.escrowBalance(landlord)).toBe(0n);

  // Landlord's dashboard and the tenant's rentals list show the lease.
  await ll.goto('/#/landlord');
  await expect(ll.getByText(`Lease #${leaseId}`).first()).toBeVisible();
  await tn.goto('/#/rentals');
  await expect(tn.getByText(`Lease #${leaseId}`)).toBeVisible();

  await act(tn, leaseId, /moving out/, /Move-out started/);
  await act(ll, leaseId, /return the caution/, /Approved/);
  await expectLease(leaseId, 'Closed');
  lease = await chain.lease(leaseId);
  expect(BigInt(lease.caution_to_holder)).toBe(caution);
  await withdrawAll(tn);
  expect(await chain.usdc(tenant)).toBe(2_000n * 1_000_000n - rent);
  expect((await chain.nft(leaseId)).metadata.title).toContain('Closed');
  await openLease(tn, leaseId);
  await expect(tn.getByText('Finished')).toBeVisible();

  // Listing is open again.
  expect((await chain.listing(listingId)).active_lease).toBeNull();
});

test('recovery phrase: back it up, sign out, restore on a new phone', async ({ phone }) => {
  const a = await phone('phone-a');
  const accountId = await signUp(a, 'phrase');
  await a.goto('/#/account');
  await expect(a.getByText('Write down your recovery phrase')).toBeVisible();
  await a.getByRole('button', { name: 'Show phrase' }).click();
  const words = await a.locator('ol li').allInnerTexts();
  const phrase = words.map((w) => w.replace(/^\d+\.\s*/, '').trim()).join(' ');
  expect(phrase.split(' ')).toHaveLength(12);
  await a.getByRole('button', { name: "I've written it down" }).click();
  await expect(a.getByText('Write down your recovery phrase')).toBeHidden();
  await a.getByRole('button', { name: 'Sign out' }).click();
  await expect(a.locator('header').getByRole('button', { name: 'Get started' })).toBeVisible();

  const b = await phone('phone-b');
  // Wrong phrase is refused with a clear message.
  await b.goto('/');
  await b.getByRole('button', { name: 'Get started' }).first().click();
  await b.getByText('I have a recovery phrase').click();
  await b.locator('#rid').fill(accountId);
  await b.locator('#phrase').fill('abandon '.repeat(11) + 'about');
  await b.getByRole('button', { name: 'Restore' }).click();
  await toast(b, /doesn't match this account/);
  await b.keyboard.press('Escape');

  await signInWithPhrase(b, accountId, phrase);
  await expect(b.locator('header').getByText(accountId)).toBeVisible();
});

test('name already taken is shown before creating', async ({ phone }) => {
  const a = await phone('a');
  const taken = (await signUp(a, 'taken')).split('.')[0];
  const b = await phone('b');
  await b.goto('/');
  await b.getByRole('button', { name: 'Get started' }).first().click();
  await b.getByText('Create with a name instead').click();
  await b.locator('#name').fill(taken);
  await expect(b.getByText('That name is taken. Try another.')).toBeVisible();
  await expect(b.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await faucet((await chain.config()).owner); // faucet works for any existing account
});

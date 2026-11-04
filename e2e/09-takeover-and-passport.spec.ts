import { act, activeLease, chain, expect, expectLease, faucet, signUp, test, toast, openLease } from './helpers';

test('lease takeover: holder offers, a new tenant asks, the landlord agrees to them, they buy it and get the caution right', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const nw = await phone('new-tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const buyer = await signUp(nw, 'buyer');
  const { leaseId, caution } = await activeLease(ll, tn, tenant);

  await openLease(tn, leaseId);
  await tn.getByLabel('Takeover price').fill('5');
  await tn.getByRole('button', { name: 'Offer for takeover' }).click();
  await toast(tn, /Offer published/);
  await expect.poll(async () => (await chain.lease(leaseId)).takeover?.price).toBe('5000000');

  // The would-be tenant finds it on the home page and asks; nothing is buyable yet.
  await nw.goto('/');
  await nw.reload();
  await nw.getByText(`Lease #${leaseId} · listing`).click();
  await expect(nw.getByRole('button', { name: /Take over this lease/ })).toHaveCount(0);
  await nw.getByRole('button', { name: 'Ask to take over this lease' }).click();
  await toast(nw, /Asked/);
  await expect.poll(async () => (await chain.lease(leaseId)).takeover?.buyer).toBe(buyer);

  // The landlord sees the buyer's passport and agrees to that person.
  await openLease(ll, leaseId);
  await expect(ll.getByText(/Rental passport:/)).toBeVisible();
  await ll.getByRole('button', { name: /Agree to .* taking over/ }).click();
  await toast(ll, /Agreed/);

  await openLease(nw, leaseId);
  await faucet(buyer);
  await nw.getByRole('button', { name: /Take over this lease for 5.00 USDC/ }).click();
  await toast(nw, /You took over the lease/);
  const l = await chain.lease(leaseId);
  expect(l.tenant).toBe(buyer);
  expect(l.nft_holder).toBe(buyer);
  expect(l.takeover).toBeNull();
  expect(await chain.escrowBalance(tenant)).toBe(5_000_000n);

  await act(nw, leaseId, /moving out/, /Move-out started/);
  await act(ll, leaseId, /return the caution/, /Approved/);
  await expectLease(leaseId, 'Closed');
  expect(await chain.escrowBalance(buyer)).toBe(caution);
});

test('rental passport: a finished lease shows on the tenant passport and to the next landlord', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId, listingId } = await activeLease(ll, tn, tenant);
  await act(tn, leaseId, /moving out/, /Move-out started/);
  await act(ll, leaseId, /return the caution/, /Approved/);
  await expectLease(leaseId, 'Closed');

  await tn.goto('/#/account');
  await tn.getByRole('link', { name: /My rental passport/ }).click();
  await expect(tn.getByText('Every caution fee returned in full')).toBeVisible();
  const r = await chain.passport(tenant);
  expect(r).toMatchObject({ leases_completed: 1, caution_returned_in_full: 1, caution_partly_kept: 0, leases_moved_in: 1, months_rented: 0 });

  // The same tenant rents again: the landlord sees the record before handing over keys.
  await tn.goto(`/#/home/${listingId}`);
  await tn.getByRole('button', { name: /into escrow/ }).click();
  await tn.getByRole('button', { name: /^Pay [\d,.]+ USDC$/ }).click();
  await tn.waitForURL(/#\/lease\/\d+/);
  const second = Number(tn.url().split('/').pop());
  await openLease(ll, second);
  await expect(ll.getByText(/finished 1 lease; caution returned in full 1 time/)).toBeVisible();
});

test('the app speaks Yorùbá, Hausa, Igbo and Pidgin, and remembers the choice', async ({ phone }) => {
  const p = await phone('reader');
  await p.goto('/');
  await p.getByLabel('Language').selectOption('yo');
  await expect(p.getByText('Kò sí owó aṣojú.')).toBeVisible();
  await expect(p.getByRole('link', { name: 'Àwọn ilé' }).first()).toBeVisible();
  await p.reload();
  await expect(p.getByText('Kò sí owó aṣojú.')).toBeVisible();
  await p.getByLabel('Èdè').selectOption('ha');
  await expect(p.getByText('Babu kuɗin wakili.')).toBeVisible();
  await p.getByLabel('Harshe').selectOption('pcm');
  await expect(p.getByText('No agent money.')).toBeVisible();
  await p.getByLabel('Language').selectOption('ig');
  await expect(p.getByText('Ọ dịghị ụgwọ onye nnọchite.')).toBeVisible();
  await p.getByLabel('Asụsụ').selectOption('en');
  await expect(p.getByText('No agent fee.')).toBeVisible();
});

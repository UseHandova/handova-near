import { act, activeLease, chain, expect, faucet, fundNear, openLease, signUp, test, toast } from './helpers';

test('landlord cash-out: live NEAR Intents quote to USDT on TRON; a wrong address is refused', async ({ phone }) => {
  const ll = await phone('landlord');
  await signUp(ll, 'll');
  await ll.goto('/#/account');
  await expect(ll.getByText('Cash out to an exchange or another chain')).toBeVisible();
  await ll.getByLabel('Amount (USDC)').fill('150');
  await ll.getByLabel('Receive').selectOption({ label: 'USDT on TRON (TRC-20)' });
  await ll.locator('#co-to').fill('not-an-address');
  await ll.getByRole('button', { name: 'Get a live quote' }).click();
  await toast(ll, /doesn't look right/);
  await ll.locator('#co-to').fill('TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G');
  await ll.getByRole('button', { name: 'Get a live quote' }).click();
  await expect(ll.getByText('150.00 USDC on NEAR')).toBeVisible({ timeout: 30_000 });
  await expect(ll.getByText(/USDT on TRON/).last()).toBeVisible();
  await expect(ll.getByText(/On testnet nothing is sent/)).toBeVisible();
});

test("lease sold on Mintbase's market: listed after the landlord agrees, bought there, the caution right moves", async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  const by = await phone('buyer');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const buyer = await signUp(by, 'buyer');
  const { leaseId } = await activeLease(ll, tn, tenant);

  await openLease(tn, leaseId);
  await tn.getByLabel('Takeover price').fill('3');
  await tn.getByRole('button', { name: 'Offer for takeover' }).click();
  await toast(tn, /Offer published/);
  await act(by, leaseId, /Ask to take over this lease/, /Asked/);
  await act(ll, leaseId, /Agree to .* taking over/, /Agreed/);

  // Listing isn't gasless: without NEAR of its own, a new account is told what to do.
  await openLease(tn, leaseId);
  await tn.getByRole('button', { name: /Also list on Mintbase/ }).click();
  await toast(tn, /too little NEAR/);
  await fundNear(tenant, '0.2');
  await openLease(tn, leaseId);
  await tn.getByRole('button', { name: /Also list on Mintbase/ }).click();
  await toast(tn, /Listed on Mintbase/);

  await faucet(buyer);
  await openLease(by, leaseId);
  await by.getByRole('button', { name: /Buy on Mintbase/ }).click();
  await toast(by, /Bought on Mintbase/);
  const l = await chain.lease(leaseId);
  expect(l.tenant).toBe(buyer);
  expect(l.nft_holder).toBe(buyer);
});

test('AI move-out inspection: the landlord adds a photo, NEAR AI advises with a verified receipt', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const { leaseId } = await activeLease(ll, tn, tenant);
  await act(tn, leaseId, /moving out/, /Move-out started/);

  await openLease(ll, leaseId);
  await expect(ll.getByText('AI move-out inspection')).toBeVisible();
  await ll.locator('input[type=file][accept^="image"]').last().setInputFiles('e2e/fixtures/room-after.jpg');
  await expect(ll.getByRole('button', { name: 'Remove photo' })).toBeVisible({ timeout: 30_000 });
  await ll.getByRole('button', { name: /Compare with NEAR AI/ }).click();
  await toast(ll, /NEAR AI compared the photos/);
  await expect(ll.getByText(/Suggested: landlord keeps/)).toBeVisible();
  await expect(ll.getByText("Receipt checked against NEAR AI's report")).toBeVisible();
  // The tenant sees the same advice.
  await openLease(tn, leaseId);
  await expect(tn.getByText(/Suggested: landlord keeps/)).toBeVisible();
});

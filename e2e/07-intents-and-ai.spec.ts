import { chain, expect, signUp, test, toast } from './helpers';
import { secrets } from './env';

test('pay from another chain: live NEAR Intents quote, then (testnet) simulated arrival pays the escrow', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('payer');
  await signUp(ll, 'll');
  const payer = await signUp(tn, 'payer');
  await ll.goto('/#/list');
  await ll.locator('#t').fill('Intents home');
  await ll.locator('#a').fill('Lekki');
  await ll.locator('#r').fill('20000');
  await ll.locator('#cf').fill('5000');
  await ll.getByRole('button', { name: /Publish on NEAR/ }).click();
  await ll.waitForURL(/#\/home\/\d+/);
  const listingId = Number(ll.url().split('/').pop());

  await tn.goto(`/#/home/${listingId}`);
  await tn.getByRole('button', { name: /into escrow/ }).click();
  await tn.getByText('Any other chain').click();
  await expect(tn.locator('#coin')).toHaveValue(/base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/);
  await tn.locator('#refund').fill('0x2527D02599Ba641c19FEa793cD0F167589a0f10D');
  await tn.getByRole('button', { name: /Get a quote/ }).click();
  await expect(tn.getByText('Testnet preview.')).toBeVisible();
  await expect(tn.getByText(/You send/).locator('..')).toContainText(/[\d.]+ USDC on Base/);

  // Solana USDC quotes too.
  await tn.locator('#coin').selectOption({ label: 'USDC on Solana' });
  await tn.locator('#refund').fill('13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK');
  await tn.getByRole('button', { name: /Get a quote/ }).click();
  await expect(tn.getByText(/You send/).locator('..')).toContainText(/USDC on Solana/);

  await tn.getByRole('button', { name: /Simulate arrival and pay escrow/ }).click();
  await tn.waitForURL(/#\/lease\/\d+/);
  const leaseId = Number(tn.url().split('/').pop());
  expect(await chain.lease(leaseId)).toMatchObject({ status: 'Pending', payer, tenant: payer });
});

test('voice-note style text → NEAR AI draft with a verified TEE receipt → publish', async ({ phone }) => {
  test.skip(!secrets.NEARAI_API_KEY, 'NEARAI_API_KEY not set in .env.e2e');
  const ll = await phone('landlord');
  const landlord = await signUp(ll, 'll');
  await ll.goto('/#/list');
  await ll.getByPlaceholder(/2 bedroom flat for Yaba/).fill('Abeg I get self contain for Surulere off Adeniran Ogunsanya. Prepaid meter, borehole, fenced, tiles. Rent na 900k per year, caution 100k.');
  await ll.getByRole('button', { name: /Draft with NEAR AI/ }).click();
  await toast(ll, /Draft ready/);
  await expect(ll.locator('#a')).toHaveValue(/Surulere/);
  await expect(ll.locator('#r')).toHaveValue('900000');
  await expect(ll.locator('#cf')).toHaveValue('100000');
  await expect(ll.getByText('Drafted by NEAR AI, receipt checked')).toBeVisible();
  await ll.getByRole('button', { name: /Publish on NEAR/ }).click();
  await ll.waitForURL(/#\/home\/\d+/);
  const listing = await chain.listing(Number(ll.url().split('/').pop()));
  expect(listing.landlord).toBe(landlord);
  expect(JSON.parse(listing.property_ref).a).toMatch(/Surulere/);
});

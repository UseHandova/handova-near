import { agreeViewing, chain, expect, faucet, listHome, signUp, test } from './helpers';

test('checkout widget: a button on another site opens Handova, the payer pays into escrow, the site gets the lease', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('payer');
  await signUp(ll, 'll');
  const payer = await signUp(tn, 'payer');
  const listingId = await listHome(ll, { title: 'Checkout widget home', rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(payer);

  await agreeViewing(tn, ll, listingId);

  // The sample merchant page loads only checkout.js and marks a button with data-handova-listing.
  await tn.goto(`/checkout-demo.html?listing=${listingId}`);
  const [popup] = await Promise.all([tn.waitForEvent('popup'), tn.getByRole('button', { name: 'Pay rent from any chain' }).click()]);
  await expect(popup).toHaveURL(new RegExp(`#/checkout/${listingId}$`));

  // The pay sheet opens by itself in the checkout window.
  const payBtn = popup.getByRole('button', { name: /^Pay [\d,.]+ USDC$/ });
  await expect(payBtn).toBeEnabled();
  await payBtn.click();

  // The merchant page hears about the payment; the lease is on-chain, waiting for move-in.
  await expect(tn.getByRole('status')).toContainText(/Paid into escrow\. Lease #\d+ for /);
  const leaseId = Number((await tn.getByRole('status').innerText()).match(/Lease #(\d+)/)![1]);
  expect(await chain.lease(leaseId)).toMatchObject({ status: 'Pending', listing_id: listingId, payer, tenant: payer });
  await expect(tn.getByRole('button', { name: 'Paid' })).toBeDisabled();
});

import type { Page } from '@playwright/test';
import { apiPost, expect, listHome, signUp, test, toast } from './helpers';
import { API } from './env';

const soon = (p: Page, mins: number) => p.evaluate((m) => { const ms = Date.now() + m * 60_000; return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }, mins);
const status = async (listingId: number, tenant: string) => (await (await fetch(`${API}/api/viewings/status?listingId=${listingId}&tenant=${tenant}`)).json()) as { canPay: boolean; viewing: { status: string } | null };

test('viewing before paying: request, landlord suggests a time, tenant accepts, both agree, then pay opens', async ({ phone }) => {
  const ll = await phone('landlord');
  const tn = await phone('tenant');
  await signUp(ll, 'll');
  const tenant = await signUp(tn, 'tn');
  const listingId = await listHome(ll, { title: 'Viewing first', rentNgn: 20_000, cautionNgn: 5_000 });

  // No viewing yet: no pay button, and the server says no.
  await tn.goto(`/#/home/${listingId}`);
  await expect(tn.getByRole('button', { name: 'Payment opens after the viewing' })).toBeDisabled();
  await expect(tn.getByRole('button', { name: /into escrow/ })).toHaveCount(0);
  expect(await status(listingId, tenant)).toMatchObject({ canPay: false, viewing: null });
  // Changing a viewing needs proof of who you are.
  expect((await apiPost('/api/viewings', { listingId, slotAt: Date.now() + 600_000, name: 'X', phone: '08031234567' })).status).toBe(401);

  await tn.locator('#vt').fill(await soon(tn, 2));
  await tn.locator('#vn').fill('Bisi');
  await tn.locator('#vp').fill('0803 123 4567');
  await tn.getByRole('button', { name: 'Ask for a viewing' }).click();
  await toast(tn, /Viewing request sent/);
  await expect(tn.getByText(/Waiting for the landlord to approve/)).toBeVisible();

  // Everyone sees the interest (a count, no names); the tenant saves the home for later.
  await expect(tn.getByText('1 person booked a viewing')).toBeVisible();
  await ll.goto(`/#/home/${listingId}`);
  await ll.reload();
  await expect(ll.getByText('1 person booked a viewing')).toBeVisible();
  await tn.getByRole('button', { name: 'Save this home for later' }).click();
  await toast(tn, /Saved/);
  await tn.goto('/');
  await tn.getByRole('tab', { name: /Saved \(1\)/ }).click();
  await expect(tn.locator('a[href^="#/home/"]')).toHaveCount(1);
  await expect(tn.locator(`a[href="#/home/${listingId}"]`)).toBeVisible();
  await tn.goto(`/#/home/${listingId}`);

  // The landlord sees who and when, and suggests another time.
  await ll.goto(`/#/home/${listingId}`);
  const card = ll.locator('[data-viewing]').filter({ hasText: 'Bisi' });
  await expect(card.getByRole('link', { name: '+2348031234567' })).toBeVisible();
  // Before deciding, the landlord sees the requester's rental passport (a new renter has none yet).
  await expect(card.getByText(/Rental passport: .*has no finished Handova leases yet/)).toBeVisible();
  await card.getByRole('button', { name: 'Suggest another time' }).click();
  await card.locator('input[type="datetime-local"]').fill(await soon(ll, 5));
  await card.getByRole('button', { name: 'Send this time' }).click();
  await toast(ll, /New time sent/);

  // The tenant accepts it, views, and agrees; the landlord hasn't yet, so pay stays shut.
  await tn.reload();
  await expect(tn.getByText(/The landlord suggested/)).toBeVisible();
  await tn.getByRole('button', { name: 'Accept this time' }).click();
  await toast(tn, /Viewing confirmed/);
  await tn.getByRole('button', { name: /I viewed it and agree/ }).click();
  await toast(tn, /You agreed\. Waiting for the landlord/);
  await expect(tn.getByRole('button', { name: 'Payment opens after the viewing' })).toBeDisabled();
  expect(await status(listingId, tenant)).toMatchObject({ canPay: false, viewing: { status: 'approved' } });

  // The landlord agrees: now the tenant can pay.
  await ll.reload();
  await card.getByRole('button', { name: /I agree to rent to them/ }).click();
  await toast(ll, /Agreed\. The tenant can pay now/);
  await expect(card.getByText(/You both agreed/)).toBeVisible();
  expect(await status(listingId, tenant)).toMatchObject({ canPay: true, viewing: { status: 'agreed' } });
  await tn.reload();
  await expect(tn.getByText(/you both agreed/i)).toBeVisible();
  await tn.getByRole('button', { name: /into escrow/ }).click();
  await expect(tn.getByRole('button', { name: /^Pay [\d,.]+ USDC$/ }).or(tn.getByRole('button', { name: /Get 2,000 test USDC/ })).first()).toBeVisible();
});

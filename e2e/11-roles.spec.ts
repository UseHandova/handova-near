import { expect, signUp, test } from './helpers';

test('roles: chosen at sign-up, menu follows the role, switchable on the Account page', async ({ phone }) => {
  const nav = (p: Awaited<ReturnType<typeof phone>>) => p.locator('nav').last();

  // A tenant sees "My rentals", not the landlord page.
  const tn = await phone('tenant');
  await signUp(tn, 'renter', 'tenant');
  await expect(nav(tn).getByRole('link', { name: 'My rentals' })).toBeVisible();
  await expect(nav(tn).getByRole('link', { name: 'Landlord' })).toHaveCount(0);

  // Switching on the Account page swaps the menu, and it sticks after a reload.
  await tn.goto('/#/account');
  await tn.getByRole('radio', { name: 'Landlord' }).click();
  await expect(nav(tn).getByRole('link', { name: 'Landlord' })).toBeVisible();
  await expect(nav(tn).getByRole('link', { name: 'My rentals' })).toHaveCount(0);
  await tn.reload();
  await expect(nav(tn).getByRole('link', { name: 'Landlord' })).toBeVisible();

  // A new landlord lands on their landlord page.
  const ll = await phone('landlord');
  await signUp(ll, 'owner', 'landlord');
  await expect(ll).toHaveURL(/#\/landlord/);
  await expect(nav(ll).getByRole('link', { name: 'Landlord' })).toBeVisible();
  await expect(nav(ll).getByRole('link', { name: 'My rentals' })).toHaveCount(0);

  // The sign-up button stays off until a role is picked.
  const nw = await phone('newcomer');
  await nw.goto('/');
  await nw.getByRole('button', { name: 'Get started' }).first().click();
  await nw.getByText('Create with a name instead').click();
  await nw.locator('#name').fill(`pick-${Date.now().toString(36)}`);
  await expect(nw.getByText(/is free/)).toBeVisible();
  await expect(nw.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await nw.getByRole('radio', { name: /looking for a home/ }).click();
  await expect(nw.getByRole('button', { name: 'Create account' })).toBeEnabled();
});

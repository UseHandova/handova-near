import { expect, test, toast } from './helpers';
test('wallet pop-up blocked: says so at once', async ({ phone }) => {
  const p = await phone('tenant');
  await p.addInitScript(() => { if (window === window.top) window.open = () => null; });
  await p.goto('/');
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.getByText('I have a NEAR wallet').click();
  await p.getByText('Meteor Wallet').click();
  await p.frameLocator('iframe').last().getByText('Meteor Web').click();
  await toast(p, /blocked the wallet window/);
  await expect(p.locator('.modal-container')).toHaveCount(0);
  await p.getByRole('button', { name: /I have a NEAR wallet/ }).click();
  await expect(p.getByText('Meteor Wallet')).toBeVisible();
});

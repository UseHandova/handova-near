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

test('wallet pop-up window refused but a tab allowed (Arc): the wallet opens in a tab', async ({ phone }) => {
  const p = await phone('tenant');
  await p.addInitScript(() => { if (window === window.top) { const o = window.open; window.open = (u?: string | URL, t?: string, f?: string) => (f ? null : o.call(window, u, t)); } });
  await p.goto('/');
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.getByText('I have a NEAR wallet').click();
  await p.getByText('Meteor Wallet').click();
  const [tab] = await Promise.all([p.waitForEvent('popup'), p.frameLocator('iframe').last().getByText('Meteor Web').click()]);
  expect(tab.url()).toContain('wallet.meteorwallet.app');
  await tab.close();
});

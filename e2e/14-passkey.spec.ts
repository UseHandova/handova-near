import type { Page } from '@playwright/test';
import { chain, expect, test, toast } from './helpers';
import { deploy } from './env';

/** Chromium's virtual fingerprint reader: a platform passkey with the PRF extension, always verified. */
async function fingerprintReader(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
}

test('fingerprint: creates a named account with a key only the passkey can rebuild; signs in again from the same passkey', async ({ phone }) => {
  const tn = await phone('tenant');
  await fingerprintReader(tn);
  await tn.goto('/');
  await tn.getByRole('button', { name: 'Get started' }).first().click();
  await tn.getByText('Create with fingerprint').click();
  await tn.getByRole('radio', { name: /looking for a home/ }).click();
  await tn.getByRole('button', { name: 'Continue with fingerprint' }).click();
  await toast(tn, /Welcome! Your account is ready/);

  // Handova picked the name; the account exists on-chain with exactly one key: the passkey-seeded one.
  const accountId = (await tn.locator('header').getByText(new RegExp(`\\.${deploy.accountParent.replace(/\./g, '\\.')}$`)).first().innerText()).trim();
  expect(accountId).toMatch(/^[a-z]+-[a-z]+-\d\d\./);
  const keys = await chain.keys(accountId);
  expect(keys).toHaveLength(1);
  // No phrase was made, so there is nothing to back up.
  await tn.goto('/#/account');
  await expect(tn.getByText(/recovery phrase/i)).toHaveCount(0);

  // Sign out and back in: the same fingerprint gives the same key, and the key finds the account.
  await tn.getByRole('button', { name: /Sign out/ }).click();
  await tn.getByRole('button', { name: 'Get started' }).first().click();
  await tn.getByText('Sign in with fingerprint').click();
  await toast(tn, /Signed in/);
  await expect(tn.locator('header').getByText(accountId)).toBeVisible();
});

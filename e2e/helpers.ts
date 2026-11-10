import { expect, test as base, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, nearToYocto, type KeyPairString } from 'near-api-js';
import { API, STATE_FILE, deploy, secrets } from './env';

export const WAIT_SECS = 20; // the e2e deployment's waiting period for every rule
export const USDC = 1_000_000n;

const provider = new JsonRpcProvider({ url: deploy.rpc });
/** Reads the chain for assertions; a free RPC's rate limit (sent as a JSON error) is waited out, not a test failure. */
export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = deploy.escrow): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return (await provider.callFunction({ contractId, method, args })) as T;
    } catch (e) {
      if (i >= 5 || !/-429|Rate limits exceeded/.test((e as Error).message ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

export const chain = {
  lease: (id: number) => view<any>('get_lease', { lease_id: id }),
  listing: (id: number) => view<any>('get_listing', { listing_id: id }),
  escrowBalance: async (acc: string) => BigInt(await view<string>('balance_of', { account_id: acc })),
  usdc: async (acc: string) => BigInt(await view<string>('ft_balance_of', { account_id: acc }, deploy.token)),
  nft: (id: number) => view<any>('nft_token', { token_id: String(id) }),
  config: () => view<any>('get_config'),
  passport: (acc: string) => view<any>('rental_record', { account_id: acc }),
  keys: async (acc: string) => (await provider.viewAccessKeyList({ accountId: acc })).keys,
};

export function arbiter(): { accountId: string; seedPhrase: string } {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')).arbiter;
}

/** Give an account NEAR of its own, for what the relayer won't pay (Mintbase listing). */
export async function fundNear(accountId: string, near: string) {
  const funder = new Account(secrets.RELAYER_ACCOUNT_ID!, provider, secrets.RELAYER_PRIVATE_KEY as KeyPairString);
  await funder.transfer({ receiverId: accountId, amount: nearToYocto(near) });
}

export async function apiPost(path: string, body: object, admin = false) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(admin ? { authorization: `Bearer ${secrets.ADMIN_SECRET}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

/** Each "phone" is a separate browser context (its own storage = its own device key). */
export const test = base.extend<{ phone: (label: string) => Promise<Page> }>({
  phone: async ({ browser }: { browser: Browser }, use, testInfo) => {
    const errors: string[] = [];
    const pages: Page[] = [];
    await use(async (label: string) => {
      const ctx = await browser.newContext({ ...testInfo.project.use, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
      page.on('console', (m) => {
        // Expected 4xx from the API (e.g. a name check) are shown to the user, not app bugs.
        if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`[${label}] ${m.text()}`);
      });
      pages.push(page);
      return page;
    });
    for (const [i, p] of pages.entries()) {
      await testInfo.attach(`screen-${i}`, { body: await p.screenshot().catch(() => Buffer.from('')), contentType: 'image/png' });
      await p.context().close();
    }
    expect(errors, 'browser console errors').toEqual([]);
  },
});
export { expect };

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/** Expect a toast; fail fast with its text if an error toast shows instead. */
export async function toast(page: Page, text: RegExp) {
  const ok = page.getByRole('status').filter({ hasText: text });
  await expect(ok.or(page.getByRole('status').filter({ has: page.locator('.text-danger') })).first()).toBeVisible();
  const shown = (await page.getByRole('status').allInnerTexts()).join(' | ');
  expect(shown, 'toast').toMatch(text);
}

/** Create a Handova account through the UI; returns the full account ID. */
/** Creates a Handova account. Labels "ll", "ade" or containing "landlord" sign up as a landlord, the rest as tenants. */
export async function signUp(page: Page, label: string, role: 'tenant' | 'landlord' = /^(ll|ade)$|landlord/i.test(label) ? 'landlord' : 'tenant'): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).first().click();
  await page.getByText('Create with a name instead').click();
  const name = `${label}-${uid()}`;
  await page.locator('#name').fill(name);
  await expect(page.getByText(/is free/)).toBeVisible();
  await page.getByRole('radio', { name: role === 'landlord' ? /I rent out homes/ : /looking for a home/ }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await toast(page, /Welcome! Your account is/);
  const accountId = `${name}.${deploy.accountParent}`;
  await expect(page.locator('header').getByText(accountId)).toBeVisible();
  return accountId;
}

export async function faucet(accountId: string) {
  const r = await apiPost('/api/faucet', { accountId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** List a home through the form (no AI); returns the listing ID. */
export async function listHome(page: Page, o: { title: string; area?: string; rentNgn: number; cautionNgn: number }): Promise<number> {
  await page.goto('/#/list');
  await page.locator('#t').fill(o.title);
  await page.locator('#a').fill(o.area ?? 'Yaba');
  await page.locator('#b').fill('2');
  await page.locator('#r').fill(String(o.rentNgn));
  await page.locator('#cf').fill(String(o.cautionNgn));
  await page.getByRole('button', { name: /Publish on NEAR/ }).click();
  await page.waitForURL(/#\/home\/\d+/);
  return Number(page.url().split('/').pop());
}

/** Pay rent + caution into escrow from the listing page (USDC on NEAR); returns the lease ID. */
export async function pay(page: Page, listingId: number, opts: { forTenant?: string } = {}): Promise<number> {
  await page.goto(`/#/home/${listingId}`);
  await page.reload(); // same-hash navigation doesn't reload; we want fresh chain state
  await page.getByRole('button', { name: /into escrow/ }).click();
  await expect(page.getByText('How do you want to pay?')).toBeVisible();
  if (opts.forTenant) {
    await page.getByRole('button', { name: 'Someone else' }).click();
    await page.getByPlaceholder(/mum/).fill(opts.forTenant);
  }
  const payBtn = page.getByRole('button', { name: /^Pay [\d,.]+ USDC$/ });
  await expect(payBtn).toBeEnabled();
  await payBtn.click();
  await page.waitForURL(/#\/lease\/\d+/);
  return Number(page.url().split('/').pop());
}

/** Open a lease with fresh chain state (same-hash navigation would not reload the page). */
export async function openLease(page: Page, leaseId: number) {
  await page.goto(`/#/lease/${leaseId}`);
  await page.reload();
}

/** Open a lease and press a button; wait for the success toast. */
export async function act(page: Page, leaseId: number, button: RegExp, done: RegExp) {
  await openLease(page, leaseId);
  await page.getByRole('button', { name: button }).click();
  await toast(page, done);
}

export async function withdrawAll(page: Page) {
  await page.goto('/#/account');
  await page.getByRole('button', { name: /Withdraw to my account/ }).click();
  await toast(page, /Withdrawn to your NEAR account/);
}

export async function signInWithPhrase(page: Page, accountId: string, seedPhrase: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).first().click();
  await page.getByText('I have a recovery phrase').click();
  await page.locator('#rid').fill(accountId);
  await page.locator('#phrase').fill(seedPhrase);
  await page.getByRole('button', { name: 'Restore' }).click();
  await toast(page, /Account restored/);
  // A new device doesn't know the role yet: Handova asks once.
  await page.getByText('How will you use Handova?').waitFor();
  await page.getByRole('radio', { name: /looking for a home/ }).click();
  await expect(page.getByText('How will you use Handova?')).toBeHidden();
}

/** Let a contract waiting period pass (plus a margin for block time and clock skew). */
export const waitPeriod = (page: Page) => page.waitForTimeout((WAIT_SECS + 4) * 1000);

/** Wait until a lease reaches a status on-chain (the UI refreshes after each action). */
export async function expectLease(id: number, status: string) {
  await expect.poll(async () => (await chain.lease(id)).status, { timeout: 30_000 }).toBe(status);
}

/** Landlord lists, tenant gets test USDC, pays, landlord hands over, tenant confirms. Returns IDs and amounts. */
export async function activeLease(ll: Page, tn: Page, tenant: string, title = `E2E home ${Date.now().toString(36)}`) {
  const listingId = await listHome(ll, { title, rentNgn: 20_000, cautionNgn: 5_000 });
  await faucet(tenant);
  const leaseId = await pay(tn, listingId);
  await act(ll, leaseId, /handed over the keys/, /Handover marked/);
  await act(tn, leaseId, /confirm move-in/, /Moved in!/);
  await expectLease(leaseId, 'Active');
  const l = await chain.lease(leaseId);
  return { listingId, leaseId, rent: BigInt(l.rent), caution: BigInt(l.caution) };
}

/** Start move-out as the holder and have the landlord dispute `claimUsdc` of the caution. */
export async function disputed(ll: Page, holder: Page, leaseId: number, claimUsdc: string) {
  await act(holder, leaseId, /moving out/, /Move-out started/);
  await ll.goto(`/#/lease/${leaseId}`);
  await ll.getByPlaceholder(/Amount in USDC/).fill(claimUsdc);
  await ll.getByPlaceholder('What was damaged?').fill('Broken kitchen door');
  await ll.getByRole('button', { name: 'Open a dispute' }).click();
  await toast(ll, /Dispute opened/);
  await expectLease(leaseId, 'Disputed');
}

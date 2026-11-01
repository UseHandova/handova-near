/**
 * Records the demo video's raw footage from the real app on NEAR testnet: four phones (landlord,
 * nurse abroad, mum, next tenant) going through the whole story. Writes per-phone videos, a caption
 * timeline, narration clips (macOS `say`) and README screenshots. scripts/compose-demo.mjs turns it
 * into the MP4.
 *
 *   bun run server & bun run dev        # the app on :5188 (main testnet deployment)
 *   node scripts/record-demo.mjs <out-dir>
 */
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'demo-out';
const URL = process.env.DEMO_URL ?? 'http://localhost:5188/';
const VOICE = process.env.DEMO_VOICE ?? 'Daniel';
const SHOTS = 'docs/screenshots';
const PHONES = ['landlord', 'nurse', 'mum', 'tolu'];
mkdirSync(join(OUT, 'audio'), { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const SCRIPT = {
  ll1: 'Ade is a landlord in Lagos. He creates a Handova account. The key is made on his phone. No wallet app, no gas.',
  ll2: 'He describes his flat in Pidgin. NEAR AI drafts the listing inside a secure enclave, and the server checks the enclave signature.',
  ll3: "He checks every field and publishes it on NEAR. Handova's relayer pays the gas.",
  mum: 'Mum lives in Lagos. She gets an account too.',
  nr1: 'Her daughter is a nurse in London. She finds the flat. No agent fee.',
  nr2: 'She pays for her mum. With USDC on NEAR, or from Base, Solana, or Ethereum through NEAR Intents.',
  nr3: 'This is a live NEAR Intents quote. On testnet the deposit is simulated, because Intents only runs on mainnet.',
  nr4: 'One transaction. Rent and caution are now locked in the escrow contract. Not with the landlord, and not with Handova.',
  ll4: 'Ade hands over the keys, and marks the handover.',
  mm1: 'Mum confirms she has moved in. Only now is the landlord paid.',
  mm2: 'Mum now holds a lease NFT. It holds her caution fee. Its picture and status are drawn on chain, and change with the lease.',
  mm3: 'Handova speaks Yoruba, Hausa, Igbo and Pidgin, as well as English.',
  ll5: 'Ade withdraws his rent. The full amount.',
  mm4: 'Months later, mum has to move to Abuja. Instead of losing her rent, she offers the rest of her lease to a new tenant.',
  ll6: "Ade can see the tenant's rental passport. A lease never changes hands without him, so he agrees.",
  to1: 'Tolu needs a flat. He finds the lease on the home page.',
  to2: 'He takes it over in one payment. Mum is paid, and the lease NFT, with its caution right, moves to Tolu.',
  to3: 'At the end of his stay, Tolu moves out.',
  ll7: 'Ade claims part of the caution for a broken door.',
  to4: 'If they cannot agree, a council DAO on NEAR decides. Two of three votes, no single judge. Tolu offers to settle instead.',
  ll8: 'Ade agrees. The split is paid out by the contract.',
  to5: 'Tolu withdraws the rest of his caution. His finished lease now shows on his rental passport, for his next landlord to see.',
};

// Narration first, so each step can wait until its line has been spoken.
const duration = {};
for (const [id, text] of Object.entries(SCRIPT)) {
  const file = join(OUT, 'audio', `${id}.aiff`);
  execFileSync('say', ['-v', VOICE, '-r', '178', '-o', file, text]);
  const info = execFileSync('afinfo', [file]).toString();
  duration[id] = Number(info.match(/estimated duration: ([\d.]+)/)[1]) * 1000;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
const phones = {};
for (const who of PHONES) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], recordVideo: { dir: join(OUT, who), size: { width: 390, height: 664 } } });
  phones[who] = await ctx.newPage();
}
const t0 = Date.now();
const captions = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Show a caption on a phone and make sure the step lasts as long as its narration. */
async function step(id, who, fn) {
  const start = Date.now() - t0;
  captions.push({ id, who, text: SCRIPT[id], start, audio: `audio/${id}.aiff` });
  await fn(phones[who]);
  const left = duration[id] + 700 - (Date.now() - t0 - start);
  if (left > 0) await pause(left);
  captions[captions.length - 1].end = Date.now() - t0;
}
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`) });
const toast = (p, re) => p.getByRole('status').filter({ hasText: re }).first().waitFor({ timeout: 90_000 });
const openLease = async (p, id) => { await p.goto(`${URL}#/lease/${id}`); await p.reload(); await p.waitForTimeout(1200); };
const uid = Date.now().toString(36).slice(-5);

async function signUp(p, name) {
  await p.goto(URL);
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.getByText('New to crypto? Create an account').click();
  await p.locator('#name').pressSequentially(name, { delay: 60 });
  await p.getByText(/is free/).waitFor();
  await p.getByRole('button', { name: 'Create account' }).click();
  await toast(p, /Welcome! Your account is/);
}

async function withdraw(p) {
  await p.goto(`${URL}#/account`);
  await p.getByRole('button', { name: /Withdraw to my account/ }).click();
  await toast(p, /Withdrawn/);
}

try {
  for (const p of Object.values(phones)) await p.goto(URL);
  await pause(1500);
  await shot(phones.landlord, '01-home');

  let listingId;
  await step('ll1', 'landlord', (p) => signUp(p, `ade-${uid}`));
  await step('ll2', 'landlord', async (p) => {
    await p.goto(`${URL}#/list`);
    await p.getByPlaceholder(/2 bedroom flat for Yaba/).pressSequentially('I get 2 bedroom flat for Yaba near Unilag. Prepaid meter, borehole, tiles. Rent na 1.8m per year, caution 200k.', { delay: 18 });
    await p.getByRole('button', { name: /Draft with NEAR AI/ }).click();
    await toast(p, /Draft ready/);
    await p.getByText(/verified NEAR AI enclave/).click();
    await p.waitForTimeout(600);
    await shot(p, '02-ai-draft');
  });
  await step('ll3', 'landlord', async (p) => {
    await p.locator('#t').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Publish on NEAR/ }).click();
    await p.waitForURL(/#\/home\/\d+/, { timeout: 90_000 });
    listingId = Number(p.url().split('/').pop());
    await p.waitForTimeout(1200);
  });

  const mumName = `mum-${uid}`;
  await step('mum', 'mum', (p) => signUp(p, mumName));

  await step('nr1', 'nurse', async (p) => {
    await signUp(p, `nurse-${uid}`);
    await p.goto(`${URL}#/home/${listingId}`);
    await p.waitForTimeout(1500);
    await shot(p, '03-listing');
    await p.mouse.wheel(0, 500);
  });
  await step('nr2', 'nurse', async (p) => {
    await p.getByRole('button', { name: /into escrow/ }).click();
    await p.getByRole('button', { name: 'Someone else' }).click();
    await p.getByPlaceholder(/mum/).pressSequentially(mumName, { delay: 50 });
    await p.getByText('Any other chain').click();
    await p.waitForTimeout(800);
  });
  await step('nr3', 'nurse', async (p) => {
    await p.locator('#refund').pressSequentially('0x2527D02599Ba641c19FEa793cD0F167589a0f10D', { delay: 15 });
    await p.getByRole('button', { name: /Get a quote/ }).click();
    await p.getByText('Testnet preview.').waitFor({ timeout: 60_000 });
    await p.getByText('You send').scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await shot(p, '04-intents-quote');
  });
  let leaseId;
  await step('nr4', 'nurse', async (p) => {
    await p.getByRole('button', { name: /Simulate arrival and pay escrow/ }).click();
    await p.waitForURL(/#\/lease\/\d+/, { timeout: 90_000 });
    leaseId = Number(p.url().split('/').pop());
    await p.waitForTimeout(1500);
    await shot(p, '05-lease-in-escrow');
  });

  await step('ll4', 'landlord', async (p) => {
    await openLease(p, leaseId);
    await p.getByRole('button', { name: /handed over the keys/ }).click();
    await toast(p, /Handover marked/);
  });
  await step('mm1', 'mum', async (p) => {
    await openLease(p, leaseId);
    await p.getByRole('button', { name: /confirm move-in/ }).click();
    await toast(p, /Moved in!/);
  });
  await step('mm2', 'mum', async (p) => {
    const img = p.locator('img[alt^="Handova lease"]');
    await img.waitFor({ timeout: 30_000 });
    await img.scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await shot(p, '06-lease-nft');
  });
  await step('mm3', 'mum', async (p) => {
    await p.goto(URL);
    await p.getByLabel('Language').selectOption('yo');
    await p.waitForTimeout(2500);
    await shot(p, '09-yoruba');
    await p.getByLabel('Èdè').selectOption('en');
  });
  await step('ll5', 'landlord', async (p) => {
    await withdraw(p);
    await p.waitForTimeout(1200);
    await shot(p, '07-landlord-paid');
  });

  // Chapter two: the lease changes hands.
  await step('mm4', 'mum', async (p) => {
    await openLease(p, leaseId);
    await p.getByLabel('Takeover price').pressSequentially('600', { delay: 80 });
    await p.getByRole('button', { name: 'Offer for takeover' }).click();
    await toast(p, /Offer published/);
  });
  await step('ll6', 'landlord', async (p) => {
    await openLease(p, leaseId);
    await p.getByText(/Rental passport:/).scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot(p, '10-landlord-consent');
    await p.getByRole('button', { name: 'Agree to this takeover' }).click();
    await toast(p, /Agreed/);
  });
  await step('to1', 'tolu', async (p) => {
    await signUp(p, `tolu-${uid}`);
    await p.goto(URL);
    await p.reload();
    await p.getByText('Take over a lease').first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot(p, '11-takeover-offers');
  });
  await step('to2', 'tolu', async (p) => {
    await p.getByText(`Lease #${leaseId} · listing`).click();
    await p.getByRole('button', { name: /Take over this lease/ }).click();
    await toast(p, /You took over the lease/);
    await p.waitForTimeout(1200);
  });
  await step('to3', 'tolu', async (p) => {
    await openLease(p, leaseId);
    await p.getByRole('button', { name: /moving out/ }).click();
    await toast(p, /Move-out started/);
  });
  await step('ll7', 'landlord', async (p) => {
    await openLease(p, leaseId);
    await p.getByPlaceholder(/Amount in USDC/).pressSequentially('20', { delay: 80 });
    await p.getByPlaceholder('What was damaged?').pressSequentially('Broken kitchen door', { delay: 40 });
    await p.getByRole('button', { name: 'Open a dispute' }).click();
    await toast(p, /Dispute opened/);
  });
  await step('to4', 'tolu', async (p) => {
    await openLease(p, leaseId);
    await p.getByText('Decided by the arbiter DAO').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot(p, '12-dao-arbiter');
    await p.getByPlaceholder(/USDC, 0 to/).first().pressSequentially('10', { delay: 80 });
    await p.getByRole('button', { name: 'Propose', exact: true }).click();
    await toast(p, /Proposal sent/);
  });
  await step('ll8', 'landlord', async (p) => {
    await openLease(p, leaseId);
    await p.getByPlaceholder(/USDC, 0 to/).first().pressSequentially('10', { delay: 80 });
    await p.getByRole('button', { name: 'Propose', exact: true }).click();
    await toast(p, /Proposal sent/);
  });
  await step('to5', 'tolu', async (p) => {
    await withdraw(p);
    const tolu = (await p.locator('header button').last().innerText()).trim();
    await p.goto(`${URL}#/passport/${tolu}`);
    await p.waitForTimeout(2500);
    await shot(p, '13-passport');
  });
  await pause(1500);
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ total: Date.now() - t0, phones: PHONES, listingId, leaseId, captions }, null, 2));
  console.log(`recorded ${Math.round((Date.now() - t0) / 1000)}s — listing ${listingId}, lease ${leaseId}`);
} finally {
  for (const p of Object.values(phones)) await p.context().close(); // flushes the videos
  await browser.close();
}

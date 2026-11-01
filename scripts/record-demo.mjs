/**
 * Records the demo video's raw footage from the real app on NEAR testnet: three phones (landlord,
 * nurse abroad, mum) going through the whole story. Writes per-phone videos, a caption timeline,
 * narration clips (macOS `say`) and README screenshots. scripts/compose-demo.mjs turns it into the MP4.
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
  ll5: 'Ade withdraws his rent. The full amount.',
  mm3: 'A year later, mum moves out. Ade has seven days to review the home.',
  ll6: 'He approves. The caution fee goes back to whoever holds the lease NFT.',
  mm4: 'Mum withdraws her caution. If the landlord had disputed it, they could agree a split, or the arbiter decides, or it splits fifty fifty after seven days.',
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
for (const who of ['landlord', 'nurse', 'mum']) {
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
    await p.goto(URL);
    await p.waitForTimeout(1200);
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
    await p.goto(`${URL}#/lease/${leaseId}`);
    await p.getByRole('button', { name: /handed over the keys/ }).click();
    await toast(p, /Handover marked/);
  });
  await step('mm1', 'mum', async (p) => {
    await p.goto(`${URL}#/lease/${leaseId}`);
    await p.waitForTimeout(800);
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
  await step('ll5', 'landlord', async (p) => {
    await p.goto(`${URL}#/account`);
    await p.getByRole('button', { name: /Withdraw to my account/ }).click();
    await toast(p, /Withdrawn/);
    await p.waitForTimeout(1500);
    await shot(p, '07-landlord-paid');
  });
  await step('mm3', 'mum', async (p) => {
    await p.getByRole('button', { name: /moving out/ }).click();
    await toast(p, /Move-out started/);
  });
  await step('ll6', 'landlord', async (p) => {
    await p.goto(`${URL}#/lease/${leaseId}`);
    await p.getByRole('button', { name: /return the caution/ }).click();
    await toast(p, /Approved/);
  });
  await step('mm4', 'mum', async (p) => {
    await p.goto(`${URL}#/account`);
    await p.getByRole('button', { name: /Withdraw to my account/ }).click();
    await toast(p, /Withdrawn/);
    await p.goto(`${URL}#/lease/${leaseId}`);
    await p.waitForTimeout(2500);
    await shot(p, '08-lease-closed');
  });
  await pause(1500);
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ total: Date.now() - t0, listingId, leaseId, captions }, null, 2));
  console.log(`recorded ${Math.round((Date.now() - t0) / 1000)}s — listing ${listingId}, lease ${leaseId}`);
} finally {
  for (const p of Object.values(phones)) await p.context().close(); // flushes the videos
  await browser.close();
}

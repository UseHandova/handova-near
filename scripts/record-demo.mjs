/**
 * Records the demo video's raw footage from the real app on NEAR testnet: the landing page, then four phones (landlord,
 * nurse abroad, mum, next tenant) going through the whole story. Writes per-phone videos, a caption
 * timeline, narration clips (macOS `say`) and README screenshots. scripts/compose-demo.mjs turns it
 * into the MP4.
 *
 *   bun run server & bun run dev        # the app on :5188 (main testnet deployment)
 *   node scripts/record-demo.mjs <out-dir>
 */
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELLO, INTRO, SCRIPT } from './demo-voiceover.mjs';

const OUT = process.argv[2] ?? 'demo-out';
const URL = process.env.DEMO_URL ?? 'http://localhost:5188/';
const VOICE = process.env.DEMO_VOICE ?? 'Daniel';
// Folder of recorded voice clips named <id>.wav/.mp3/.m4a (see docs/media/voiceover-script.md); else macOS `say`.
const VOICE_DIR = process.env.DEMO_AUDIO;
const SHOTS = 'docs/screenshots';
const PHONES = ['landlord', 'nurse', 'mum', 'tolu'];
const PHOTOS = (process.env.DEMO_PHOTOS ?? 'listings/yaba-1.jpg,listings/yaba-3.jpg').split(',');
mkdirSync(join(OUT, 'audio'), { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// Narration first, so each step can wait until its line has been spoken.
const duration = {};
const audio = {};
for (const [id, text] of Object.entries({ hello: HELLO, intro: INTRO, ...SCRIPT })) {
  const recorded = VOICE_DIR && ['wav', 'mp3', 'm4a', 'aiff'].map((ext) => join(VOICE_DIR, `${id}.${ext}`)).find(existsSync);
  if (VOICE_DIR && !recorded) throw new Error(`No recorded clip for "${id}" in ${VOICE_DIR} (expected ${id}.wav, .mp3 or .m4a)`);
  audio[id] = `audio/${id}.${recorded ? recorded.split('.').pop() : 'aiff'}`;
  const file = join(OUT, audio[id]);
  if (recorded) copyFileSync(recorded, file);
  else execFileSync('say', ['-v', VOICE, '-r', '178', '-o', file, text]);
  const info = execFileSync('afinfo', [file]).toString();
  duration[id] = Number(info.match(/estimated duration: ([\d.]+)/)[1]) * 1000;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Opening scene: the landing page full screen, scrolled slowly while HELLO and INTRO are spoken.
const landingCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: join(OUT, 'landing'), size: { width: 1920, height: 1080 } } });
const landingT0 = Date.now();
const landingPage = await landingCtx.newPage();
await landingPage.goto(URL);
await landingPage.getByRole('heading', { name: 'Homes' }).waitFor();
await pause(2500); // listings and fonts settle
const landing = { start: Date.now() - landingT0, hello: duration.hello, intro: duration.intro, gap: 600 };
await pause(landing.gap + duration.hello + landing.gap);
// During INTRO: glide down to the homes, rest the pointer on a home with a video so it plays, then
// glide on to the page numbers.
const introStart = Date.now();
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const glide = async (from, to, ms) => {
  for (let t = 0; t <= ms; t += 40) {
    await landingPage.evaluate((y) => scrollTo(0, y), Math.round(from + (to - from) * ease(Math.min(1, t / ms))));
    await pause(40);
  }
};
const gridY = await landingPage.getByRole('heading', { name: 'Homes' }).evaluate((el) => el.getBoundingClientRect().top + scrollY - 100);
await glide(0, gridY, duration.intro * 0.3);
const withVideo = landingPage.locator('a[href^="#/home/"]').filter({ has: landingPage.locator('video') }).first();
if (await withVideo.count()) {
  const box = await withVideo.boundingBox();
  await landingPage.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 30 });
  await pause(duration.intro * 0.4);
  await landingPage.screenshot({ path: join(SHOTS, '00-desktop-home.png') });
  await landingPage.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 20 });
}
const bottom = await landingPage.evaluate(() => document.documentElement.scrollHeight - innerHeight);
await glide(gridY, bottom, Math.max(1500, duration.intro - (Date.now() - introStart)));
await pause(landing.gap);
landing.end = Date.now() - landingT0;
await landingCtx.close();
writeFileSync(join(OUT, 'landing.json'), JSON.stringify({ ...landing, hello_audio: audio.hello, intro_audio: audio.intro }, null, 2));

const phones = {};
for (const who of PHONES) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], recordVideo: { dir: join(OUT, who), size: { width: 390, height: 664 } } });
  phones[who] = await ctx.newPage();
}
const t0 = Date.now();
const captions = [];

/** Show a caption on a phone and make sure the step lasts as long as its narration. */
async function step(id, who, fn) {
  const start = Date.now() - t0;
  captions.push({ id, who, text: SCRIPT[id], start, audio: audio[id] });
  await fn(phones[who]);
  const left = duration[id] + 700 - (Date.now() - t0 - start);
  if (left > 0) await pause(left);
  captions[captions.length - 1].end = Date.now() - t0;
}
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`) });
const toast = (p, re) => p.getByRole('status').filter({ hasText: re }).first().waitFor({ timeout: 90_000 });
const openLease = async (p, id) => { await p.goto(`${URL}#/lease/${id}`); await p.reload(); await p.waitForTimeout(1200); };
const uid = Date.now().toString(36).slice(-5);

async function signUp(p, name, role = 'tenant') {
  await p.goto(URL);
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.getByText('New to crypto? Create an account').click();
  await p.locator('#name').pressSequentially(name, { delay: 60 });
  await p.getByText(/is free/).waitFor();
  await p.getByRole('radio', { name: role === 'landlord' ? /I rent out homes/ : /looking for a home/ }).click();
  await p.waitForTimeout(500);
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
  await step('ll1', 'landlord', (p) => signUp(p, `ade-${uid}`, 'landlord'));
  await step('ll1b', 'landlord', async (p) => {
    // Signing up as a landlord lands on the landlord page, which offers the Didit ID check.
    await p.getByText('Get the verified landlord badge').scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await shot(p, '01-verify-landlord');
  });
  await step('ll2', 'landlord', async (p) => {
    await p.goto(`${URL}#/list`);
    await p.getByPlaceholder(/2 bedroom flat for Yaba/).pressSequentially('I get flat for Yaba. AC for the rooms, POP ceiling with downlights. Rent na 2 million per year, caution 200k.', { delay: 18 });
    await p.getByRole('button', { name: /Draft with NEAR AI/ }).click();
    await toast(p, /Draft ready/);
    await p.getByText(/verified NEAR AI enclave/).click();
    await p.waitForTimeout(600);
    await shot(p, '02-ai-draft');
  });
  await step('ll3', 'landlord', async (p) => {
    await p.locator('#t').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    // Real photos of the flat, if present (listings/ is git-ignored; without them the listing has none).
    const photoInput = p.locator('input[type=file][accept^="image"]');
    let added = 0;
    for (const f of PHOTOS.filter(existsSync)) {
      await p.getByText('Photos (up to 4)').scrollIntoViewIfNeeded(); // the input itself is hidden
      await photoInput.setInputFiles(f);
      await p.getByRole('button', { name: 'Remove photo' }).nth(added++).waitFor({ timeout: 30_000 });
    }
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
  await step('ll5b', 'landlord', async (p) => {
    await p.getByText('Cash out to an exchange or another chain').scrollIntoViewIfNeeded();
    await p.locator('#co-to').pressSequentially('TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G', { delay: 12 });
    await p.getByRole('button', { name: 'Get a live quote' }).click();
    await p.getByText(/You receive/).waitFor({ timeout: 30_000 });
    await p.getByText(/You receive/).scrollIntoViewIfNeeded();
    await shot(p, '08-cash-out');
  });

  // Chapter two: the lease changes hands.
  await step('mm4', 'mum', async (p) => {
    await openLease(p, leaseId);
    await p.getByLabel('Takeover price').pressSequentially('600', { delay: 80 });
    await p.getByRole('button', { name: 'Offer for takeover' }).click();
    await toast(p, /Offer published/);
  });
  await step('to1', 'tolu', async (p) => {
    await signUp(p, `tolu-${uid}`);
    await p.goto(URL);
    await p.reload();
    await p.getByText('Take over a lease').first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot(p, '11-takeover-offers');
    await p.getByText(`Lease #${leaseId} · listing`).click();
    await p.getByRole('button', { name: 'Ask to take over this lease' }).click();
    await toast(p, /Asked/);
  });
  await step('ll6', 'landlord', async (p) => {
    await openLease(p, leaseId);
    await p.getByText(/Rental passport:/).scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot(p, '10-landlord-consent');
    await p.getByRole('button', { name: /Agree to .* taking over/ }).click();
    await toast(p, /Agreed/);
  });
  await step('to2', 'tolu', async (p) => {
    await openLease(p, leaseId);
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
  const filmed = Date.now() - t0; // the video ends here; what follows is cleanup
  // Off camera: Ade pauses the demo listing so repeated recordings don't fill the home page with copies.
  await phones.landlord.goto(`${URL}#/home/${listingId}`);
  await phones.landlord.getByRole('button', { name: 'Pause listing' }).click().catch(() => {});
  await toast(phones.landlord, /Listing paused/).catch(() => console.warn(`could not pause listing ${listingId}; pause it from the landlord account`));
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ total: filmed, phones: PHONES, listingId, leaseId, captions }, null, 2));
  console.log(`recorded ${Math.round((Date.now() - t0) / 1000)}s — listing ${listingId}, lease ${leaseId}`);
} finally {
  for (const p of Object.values(phones)) await p.context().close(); // flushes the videos
  await browser.close();
}

/**
 * Records the walkthrough: the real app on NEAR testnet in full-size desktop Chromium windows
 * (1920×1080, the page fills the frame), driven like a person would: the pointer moves to what it
 * clicks, text is typed, pages scroll. Two windows, the tenant's (ada) and the landlord's (ade); the
 * video cuts to whoever is acting. Each step lasts as long as its narration clip.
 *
 *   PORT=3011 VIEWING_MIN_LEAD_MIN=0 VIEWING_OPENS_BEFORE_MIN=60 bun run server     # the viewing happens on camera
 *   VITE_API_PROXY=http://localhost:3011 bunx vite --config web/vite.config.ts --port 5199
 *   DEMO_URL=http://localhost:5199/ DEMO_AUDIO=voice-walkthrough node scripts/walkthrough/record.mjs demo-out/walk
 *
 * DEMO_AUDIO is a folder of clips named after the line ids (w01.mp3 …); without it macOS `say` stands in.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINES } from './script.mjs';

const OUT = process.argv[2] ?? 'demo-out/walk';
const URL = process.env.DEMO_URL ?? 'http://localhost:5199/';
const VOICE_DIR = process.env.DEMO_AUDIO;
const W = 1920, H = 1080;
const PHOTOS = ['listings/yaba-1.jpg', 'listings/yaba-3.jpg', 'listings/yaba-2.jpg'].filter(existsSync);
mkdirSync(join(OUT, 'audio'), { recursive: true });

// Narration first: each step lasts at least as long as its clip.
const secsOf = (f) => Number(execFileSync('afinfo', [f]).toString().match(/estimated duration: ([\d.]+)/)[1]);
const clip = {};
for (const { id, text } of LINES) {
  const own = VOICE_DIR && ['wav', 'mp3', 'm4a'].map((e) => join(VOICE_DIR, `${id}.${e}`)).find(existsSync);
  if (VOICE_DIR && !own) throw new Error(`No clip for ${id} in ${VOICE_DIR}`);
  const file = join(OUT, 'audio', `${id}.${own ? own.split('.').pop() : 'aiff'}`);
  if (own) copyFileSync(own, file);
  else execFileSync('say', ['-v', process.env.DEMO_VOICE ?? 'Daniel', '-r', '175', '-o', file, text]);
  clip[id] = { file: file.slice(OUT.length + 1), ms: secsOf(file) * 1000 };
}

// A visible mouse pointer (headless recordings have none) and a soft ring where it clicks.
const POINTER = `(() => {
  const put = () => {
    if (document.getElementById('__ptr')) return;
    const p = document.createElement('div');
    p.id = '__ptr';
    p.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    let at = [960, 540];
    try { at = JSON.parse(sessionStorage.getItem('__ptr') || '[960,540]'); } catch {}
    p.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;transform:translate(' + at[0] + 'px,' + at[1] + 'px)';
    document.documentElement.appendChild(p);
  };
  addEventListener('mousemove', (e) => {
    put();
    document.getElementById('__ptr').style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    try { sessionStorage.setItem('__ptr', JSON.stringify([e.clientX, e.clientY])); } catch {}
  }, true);
  addEventListener('mousedown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(31,158,97,.9);background:rgba(31,158,97,.18);transition:transform .4s ease-out,opacity .4s ease-out;left:' + e.clientX + 'px;top:' + e.clientY + 'px';
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.7)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 500);
  }, true);
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', put) : put();
})();`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const WHO = ['ada', 'ade', 'sis'];
const pages = {};
const opened = {};
const mouse = {};
for (const who of WHO) {
  opened[who] = Date.now();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: join(OUT, who), size: { width: W, height: H } } });
  await ctx.addInitScript(POINTER);
  pages[who] = await ctx.newPage();
  mouse[who] = [W / 2, H / 2];
}
const page = (p) => WHO.find((w) => pages[w] === p);

// ---- moving like a person ----
async function moveTo(p, x, y) {
  const [fx, fy] = mouse[page(p)];
  const steps = Math.max(12, Math.min(45, Math.round(Math.hypot(x - fx, y - fy) / 22)));
  await p.mouse.move(x, y, { steps });
  mouse[page(p)] = [x, y];
}
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
async function glide(p, to, ms = 900) {
  const from = await p.evaluate(() => scrollY);
  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  to = Math.max(0, Math.min(max, to));
  if (Math.abs(to - from) < 4) return;
  for (let t = 0; t <= ms; t += 30) {
    await p.evaluate((y) => scrollTo(0, y), Math.round(from + (to - from) * ease(Math.min(1, t / ms))));
    await pause(30);
  }
}
/** Scroll so the element sits about a third down the window (like reading down to it). */
async function bring(p, loc, ms) {
  await waiting(loc.waitFor({ state: 'visible', timeout: 90_000 }));
  const inSheet = await loc.evaluate((el) => !!el.closest('[role="dialog"]'));
  if (inSheet) { await loc.scrollIntoViewIfNeeded(); return; }
  const top = await loc.evaluate((el) => el.getBoundingClientRect().top + scrollY);
  const y = await p.evaluate(() => scrollY);
  if (top < y + 90 || top > y + H - 160) await glide(p, top - H * 0.33, ms);
}
async function click(p, loc, wait = 250) {
  loc = loc.first();
  await bring(p, loc);
  await waiting(loc.click({ trial: true, timeout: 120_000 })); // e.g. a button that enables once a balance loads
  const b = await loc.boundingBox();
  await moveTo(p, b.x + b.width / 2, b.y + b.height / 2);
  await pause(wait);
  await loc.click();
}
async function type(p, loc, text, delay = 45) {
  await click(p, loc, 150);
  await loc.pressSequentially(text, { delay });
}
async function hover(p, loc, ms = 800) {
  loc = loc.first();
  await bring(p, loc);
  const b = await loc.boundingBox();
  await moveTo(p, b.x + b.width / 2, b.y + Math.min(b.height / 2, 120));
  await pause(ms);
}
// ---- the timeline ----
let t0 = Date.now() + 3_600_000; // set once both windows are open and loaded
const T0 = () => t0;
/** Stretches spent waiting on the network (AI draft, a transaction, a reload); compose.mjs cuts the silent part of each. */
const waits = [];
async function waiting(promise) {
  const a = Date.now();
  try { return await promise; } finally { waits.push([a - t0, Date.now() - t0]); }
}
const toast = (p, re) => waiting(p.getByRole('status').filter({ hasText: re }).first().waitFor({ timeout: 120_000 }));
const reload = async (p) => { await waiting(p.reload().then(() => p.waitForLoadState('networkidle').catch(() => {}))); await pause(700); };
const lines = [];
async function step(id, fn) {
  const L = LINES.find((l) => l.id === id);
  const start = Date.now() - T0();
  lines.push({ id, who: L.who, text: L.text, audio: clip[id].file, start });
  await fn(pages[L.who]);
  const left = clip[id].ms + 250 - (Date.now() - T0() - start);
  if (left > 0) await pause(left);
}

const uid = Date.now().toString(36).slice(-4);
async function signUp(p, name, landlord) {
  await click(p, p.getByRole('button', { name: 'Get started' }));
  await click(p, p.getByText('Create with a name instead'));
  await type(p, p.locator('#name'), name, 70);
  await waiting(p.getByText(/is free/).waitFor());
  await click(p, p.getByRole('radio', { name: landlord ? /I rent out homes/ : /looking for a home/ }));
  await click(p, p.getByRole('button', { name: 'Create account' }));
  await toast(p, /Welcome! Your account is/);
}

let listingId, leaseId, title;
try {
  for (const who of WHO) {
    await pages[who].goto(URL);
    await pages[who].getByRole('heading', { name: 'Homes' }).waitFor();
  }
  // The video opens on a finished page: top of the home page, every photo in view loaded.
  for (const who of WHO) {
    await pages[who].evaluate(() => scrollTo(0, 0));
    await pages[who].waitForFunction(() => {
      const imgs = [...document.querySelectorAll('a[href^="#/home/"] img')].filter((i) => i.getBoundingClientRect().top < innerHeight);
      return imgs.length >= 3 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }, null, { timeout: 120_000 });
  }
  // Off camera: the sister already has an account, and waits on the home page.
  await signUp(pages.sis, `sis-${uid}`, false);
  await pages.sis.evaluate(() => scrollTo(0, 0));
  waits.length = 0;
  await pause(1500);
  t0 = Date.now();

  // Intro and problem: the page stays at the top while the presenter talks.
  await step('w01', async (p) => { await pause(600); await moveTo(p, 760, 420); });
  await step('w02', async (p) => {
    await pause(2500);
    await hover(p, p.locator('h1'), 4000);
    await moveTo(p, 560, 560);
  });
  // "Handova fixes this": the three promises on the right of the hero.
  await step('w03', async (p) => {
    for (const t of ['Rent held until move-in', 'Caution comes back', 'Pay from any chain']) await hover(p, p.getByText(t, { exact: true }), 3200);
  });
  await step('w04', async (p) => {
    await bring(p, p.getByRole('heading', { name: 'Homes' }), 1200);
    const withVideo = p.locator('a[href^="#/home/"]').filter({ has: p.locator('video') });
    await hover(p, (await withVideo.count()) ? withVideo : p.locator('a[href^="#/home/"]'), 2500);
    const busy = p.getByText(/booked a viewing/);
    if (await busy.count()) await hover(p, busy, 1200);
    await glide(p, 0, 1000);
    const lang = p.getByLabel('Language');
    await hover(p, lang, 300);
    await lang.selectOption('yo');
    await pause(2200);
    await p.getByLabel('Èdè').selectOption('en');
    await pause(500);
  });

  await step('w05', async (p) => signUp(p, `ade-${uid}`, true));
  await step('w06', async (p) => {
    await click(p, p.locator('header').getByRole('link', { name: 'Landlord' }));
    await pause(800);
    const list = p.locator('a[href="#/list"]');
    if (await list.count()) await click(p, list); else await p.goto(`${URL}#/list`);
    await type(p, p.getByPlaceholder(/2 bedroom flat for Yaba/), 'I get 2 bedroom flat for Yaba. AC for the rooms, POP ceiling, steady water. Rent na 2 million per year, caution 200k.', 22);
    await click(p, p.getByRole('button', { name: /Draft with NEAR AI/ }));
    await toast(p, /Draft ready/);
    await click(p, p.getByText('Drafted by NEAR AI, receipt checked'));
    await pause(1500);
  });
  await step('w07', async (p) => {
    await hover(p, p.locator('#t'), 1000);
    title = await p.locator('#t').inputValue();
    const input = p.locator('input[type=file][accept^="image"]');
    for (const [i, f] of PHOTOS.entries()) {
      await hover(p, p.getByText('Photos (up to 4)'), 400);
      await input.setInputFiles(f);
      await p.getByRole('button', { name: 'Remove photo' }).nth(i).waitFor({ timeout: 30_000 });
    }
    await hover(p, p.getByText(/Caution/).first(), 900);
    await click(p, p.getByRole('button', { name: /Publish on NEAR/ }));
    await waiting(p.waitForURL(/#\/home\/\d+/, { timeout: 120_000 }));
    listingId = Number(p.url().split('/').pop());
    await pause(1200);
  });

  await step('w08', async (p) => {
    await signUp(p, `ada-${uid}`, false);
    await reload(p);
    await bring(p, p.getByRole('heading', { name: 'Homes' }), 1000);
    let card = p.locator(`a[href="#/home/${listingId}"]`);
    if (!(await card.count())) { await p.goto(`${URL}#/home/${listingId}`); } else await click(p, card);
    await pause(1500);
    await click(p, p.getByRole('button', { name: 'Save this home for later' }));
    await toast(p, /Saved/);
  });
  await step('w09', async (p) => {
    await bring(p, p.locator('#viewing'), 1000);
    const soon = await p.evaluate(() => { const ms = Date.now() + 10 * 60_000; return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16); });
    await click(p, p.locator('#vt'));
    await p.locator('#vt').fill(soon);
    await type(p, p.locator('#vn'), 'Ada Okafor', 60);
    await type(p, p.locator('#vp'), '0803 123 4567', 60);
    await click(p, p.getByRole('button', { name: 'Ask for a viewing' }));
    await toast(p, /Viewing request sent/);
    await hover(p, p.getByText('1 person booked a viewing'), 1000);
  });
  await step('w10', async (p) => {
    await reload(p);
    const card = p.locator('[data-viewing]').filter({ hasText: 'Ada Okafor' }).first();
    await hover(p, card, 1500);
    await click(p, card.getByRole('button', { name: 'Approve' }));
    await toast(p, /Viewing approved/);
    await pause(800);
    await click(p, card.getByRole('button', { name: /I agree to rent to them/ }));
    await toast(p, /agreed/i);
  });
  await step('w11', async (p) => {
    await reload(p);
    await click(p, p.getByRole('button', { name: /I viewed it and agree/ }));
    await toast(p, /You can pay now/);
  });
  // Ada can pay herself: the pay window, for her, with both ways to pay. Then she leaves it to her sister.
  await step('w12a', async (p) => {
    await click(p, p.getByRole('button', { name: /into escrow/ }));
    await pause(500);
    const dialog = p.getByRole('dialog');
    await hover(p, dialog.getByText('USDC on NEAR', { exact: true }), 1300);
    await click(p, dialog.getByText('Any other chain'));
    await hover(p, dialog.getByText(/Base, Solana, Ethereum/), 1500);
    await click(p, dialog.getByRole('button', { name: 'Close' }));
  });
  // Her sister in London, signed in before the video started, opens the link Ada sent her and pays for Ada.
  await step('w12', async (p) => {
    const forOther = p.getByText('Pay for someone else').filter({ visible: true }).first();
    await waiting(p.goto(`${URL}#/home/${listingId}`).then(() => forOther.waitFor()));
    await click(p, forOther);
    await pause(600);
    await type(p, p.getByRole('dialog').getByPlaceholder(/mum/), `ada-${uid}`, 70);
    await click(p, p.getByRole('dialog').getByText('Any other chain'));
    await type(p, p.locator('#refund'), '0x2527D02599Ba641c19FEa793cD0F167589a0f10D', 12);
    await click(p, p.getByRole('button', { name: /Get a quote/ }));
    await waiting(p.getByText('Testnet preview.').waitFor({ timeout: 60_000 }));
    await hover(p, p.getByText('You send'), 1500);
  });
  await step('w13', async (p) => {
    await click(p, p.getByRole('button', { name: /Simulate arrival and pay escrow/ }));
    await waiting(p.waitForURL(/#\/lease\/\d+/, { timeout: 120_000 }));
    leaseId = Number(p.url().split('/').pop());
    await pause(1500);
    await moveTo(p, 700, 400);
  });

  await step('w14', async (p) => {
    await click(p, p.locator('header').getByRole('link', { name: 'Landlord' }));
    await pause(1500);
    const link = p.locator(`a[href="#/lease/${leaseId}"]`);
    if (await link.count()) await click(p, link); else await p.goto(`${URL}#/lease/${leaseId}`);
    await reload(p);
    await click(p, p.getByRole('button', { name: /handed over the keys/ }));
    await toast(p, /Handover marked/);
  });
  await step('w15', async (p) => {
    // Her sister paid, so Ada finds the lease under My rentals.
    await click(p, p.locator('header').getByRole('link', { name: 'My rentals' }));
    await click(p, p.locator(`a[href="#/lease/${leaseId}"]`));
    await reload(p);
    await click(p, p.getByRole('button', { name: /confirm move-in/ }));
    await toast(p, /Moved in!/);
  });
  await step('w16', async (p) => {
    const img = p.locator('img[alt^="Handova lease"]');
    await waiting(img.waitFor({ timeout: 60_000 }));
    await hover(p, img, 2500);
  });
  await step('w17', async (p) => {
    await click(p, p.locator('header').getByRole('link', { name: 'Account' }));
    await click(p, p.getByRole('button', { name: /Withdraw to my account/ }));
    await toast(p, /Withdrawn/);
  });
  await step('w18', async (p) => {
    await reload(p);
    await click(p, p.getByRole('button', { name: /moving out/ }));
    await toast(p, /Move-out started/);
  });
  await step('w19', async (p) => {
    await click(p, p.locator('header').getByRole('link', { name: 'Landlord' }));
    await pause(1200);
    const link = p.locator(`a[href="#/lease/${leaseId}"]`);
    if (await link.count()) await click(p, link); else await p.goto(`${URL}#/lease/${leaseId}`);
    await reload(p);
    const dispute = p.getByRole('button', { name: 'Open a dispute' });
    if (await dispute.count()) await hover(p, dispute, 1200);
    await click(p, p.getByRole('button', { name: /return the caution/ }));
    await toast(p, /Approved/);
  });
  await step('w20', async (p) => {
    await click(p, p.locator('header').getByRole('link', { name: 'Account' }));
    await click(p, p.getByRole('button', { name: /Withdraw to my account/ }));
    await toast(p, /Withdrawn/);
    await pause(800);
    const me = (await p.locator('header button').last().innerText()).trim();
    const pass = p.locator(`a[href^="#/passport/"]`);
    if (await pass.count()) await click(p, pass); else await p.goto(`${URL}#/passport/${me}`);
    await pause(1500);
    await glide(p, 400, 1500);
  });
  await step('w21', async (p) => {
    await pause(1500);
    await click(p, p.locator('header a[href="#/"]').first());
    await pause(1200);
    await moveTo(p, 760, 420);
  });
  await pause(800);
  const total = Date.now() - t0;
  // Off camera: pause the demo listing so repeated recordings don't fill the home page with copies.
  await pages.ade.goto(`${URL}#/home/${listingId}`);
  await pages.ade.getByRole('button', { name: 'Pause listing' }).click().catch(() => {});
  await toast(pages.ade, /Listing paused/).catch(() => console.warn(`could not pause listing ${listingId}`));
  const offsets = Object.fromEntries(WHO.map((w) => [w, t0 - opened[w]]));
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ total, offsets, listingId, leaseId, title, lines, waits }, null, 2));
  console.log(`recorded ${Math.round(total / 1000)}s — listing ${listingId}, lease ${leaseId}`);
} catch (e) {
  for (const who of WHO) await pages[who].screenshot({ path: join(OUT, `fail-${who}.png`) }).catch(() => {});
  throw e;
} finally {
  for (const who of WHO) await pages[who].context().close();
  await browser.close();
}

/**
 * End-to-end tests for cash payments (receipt → landlord confirms / disputes → admin) and rent savings plans.
 * Real: RentFlowEscrow + RentSavingsVault + MockUSDC on Anvil, signed sessions, encrypted receipts.
 * Run: forge build && bun test server/cash-savings.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { deployProxied } from './test-proxy';

const PORT = 8553;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'); // arbiter
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TENANT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const TENANT2 = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const TREASURY = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a').address;

const abi = parseAbi([
  'function createListing(uint256,uint256,string) returns (uint256)',
  'function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function deposit(uint256)',
]);
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: foundry, transport: http(RPC) });
const receipts = mkdtempSync(join(tmpdir(), 'receipts-'));
let anvil: ChildProcess, server: Server, base = '', usdc: Address, vault: Address;
const sent: { phone: string; text: string }[] = [];
let savings: { sendReminders: (now?: number) => Promise<number> };

async function waitFor(fn: () => Promise<unknown>) {
  for (let i = 0; ; i++) { try { await fn(); return; } catch (e) { if (i > 75) throw e; await Bun.sleep(200); } }
}
const art = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
async function deploy(path: string, args: unknown[]) {
  const a = art(path);
  const hash = await wallet(OWNER).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  return (await pc.waitForTransactionReceipt({ hash })).contractAddress!;
}
async function write(a: PrivateKeyAccount, address: Address, functionName: string, args: unknown[]) {
  const hash = await wallet(a).writeContract({ address, abi, functionName: functionName as never, args: args as never });
  await pc.waitForTransactionReceipt({ hash });
}
const tokens = new Map<string, string>();
async function session(a: PrivateKeyAccount) {
  if (tokens.has(a.address)) return tokens.get(a.address)!;
  const ch = await (await fetch(`${base}/api/auth/challenge?address=${a.address}`)).json() as { nonce: string; message: string };
  const r = await (await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: a.address, nonce: ch.nonce, signature: await a.signMessage({ message: ch.message }) }) })).json() as { token: string };
  tokens.set(a.address, r.token);
  return r.token;
}
async function call(a: PrivateKeyAccount | null, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
  if (a) headers.Authorization = `Bearer ${await session(a)}`;
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown>, res };
}
async function sendReceipt(a: PrivateKeyAccount, fields: Record<string, string>, files = [{ name: 'receipt.jpg', type: 'image/jpeg', bytes: 3000 }]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append('files', new File([new Uint8Array(f.bytes).fill(5)], f.name, { type: f.type }));
  const res = await fetch(`${base}/api/cash-payments`, { method: 'POST', headers: { Authorization: `Bearer ${await session(a)}` }, body: form });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
/** Book → approve → visit happens → both confirm. Returns the inspection id. */
async function inspected(tenant: PrivateKeyAccount, name: string, phone: string) {
  const { db } = await import('./db');
  const b = await call(tenant, '/api/inspections', { listingId: '1', slotAt: Date.now() + 26 * 3600_000, name, phone });
  const id = b.body.inspection.id as number;
  await call(LANDLORD, `/api/inspections/${id}/approve`, {});
  db().query('UPDATE inspections SET slot_at = ? WHERE id = ?').run(Date.now() - 3600_000, id);
  await call(tenant, `/api/inspections/${id}/happened`, {});
  await call(LANDLORD, `/api/inspections/${id}/happened`, {});
  return id;
}
const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json', []);
  const escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  vault = await deploy('contracts/out/RentSavingsVault.sol/RentSavingsVault.json', [usdc]);
  await write(LANDLORD, escrow, 'createListing', [500_000_000n, 12_500_000n, '{"location":"Yaba","phone":"2348031234567"}']);
  const { mountAuth } = await import('./auth');
  const { mountInspections } = await import('./inspections');
  const { mountCash } = await import('./cash');
  const { mountSavings } = await import('./savings');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  const cfg = { escrow, usdc, treasury: TREASURY };
  const notify = async (phone: string, text: string) => { sent.push({ phone, text }); return true; };
  mountInspections(app, cfg, notify);
  mountCash(app, cfg, notify, receipts);
  savings = mountSavings(app, vault, notify);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);
afterAll(() => { server?.close(); anvil?.kill(); });

describe('cash payments', () => {
  let insp = 0, payment = 0;
  test('the landlord chooses cash for this tenant; the tenant is told', async () => {
    insp = await inspected(TENANT, 'Ada Obi', '08031112222');
    expect((await call(TENANT, `/api/inspections/${insp}/payment`, { method: 'cash' })).body.code).toBe('not_landlord');
    sent.length = 0;
    const r = await call(LANDLORD, `/api/inspections/${insp}/payment`, { method: 'cash' });
    expect(r.body.inspection).toMatchObject({ paymentMethod: 'cash', canPay: true });
    expect(sent[0]).toMatchObject({ phone: '2348031112222' });
    expect(sent[0].text).toContain('paid in cash');
  });
  test('the receipt must have an amount, a real date and a photo', async () => {
    expect((await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '0', paidOn: today() })).body.code).toBe('amount');
    const part = await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '400000', paidOn: today() });
    expect(part.body.code).toBe('not_full'); // first payment must be rent + caution in full
    expect(part.body.error).toContain('₦820,000');
    expect((await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '820000', paidOn: '2099-01-01' })).body.code).toBe('paid_on');
    expect((await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '820000', paidOn: today() }, [])).body.code).toBe('no_files');
  });
  test('only that tenant can send it', async () => {
    expect((await sendReceipt(TENANT2, { inspectionId: String(insp), amountNgn: '820000', paidOn: today() })).body.code).toBe('not_found');
  });
  test('tenant uploads the receipt; it is encrypted; the landlord is asked to confirm', async () => {
    sent.length = 0;
    const r = await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '820000', paidOn: today(), note: 'Paid at the house' });
    expect(r.body.payment).toMatchObject({ status: 'awaiting_landlord', amountNgn: 820000, role: 'tenant', notified: true });
    payment = r.body.payment.id;
    expect(sent[0].phone).toBe('2348031234567');
    expect(sent[0].text).toContain('₦820,000');
    const raw = readFileSync(join(receipts, readdirSync(receipts)[0]));
    expect(raw.includes(Buffer.alloc(64, 5))).toBe(false);
    const back = await fetch(`${base}/api/cash-payments/${payment}/receipt/0`, { headers: { Authorization: `Bearer ${await session(LANDLORD)}` } });
    expect(Buffer.from(await back.arrayBuffer()).equals(Buffer.alloc(3000, 5))).toBe(true); // decrypts back exactly
    expect((await call(TENANT2, `/api/cash-payments/${payment}/receipt/0`)).status).toBe(404);
  });
  test('a second receipt for the same home is refused; the method can no longer change', async () => {
    expect((await sendReceipt(TENANT, { inspectionId: String(insp), amountNgn: '820000', paidOn: today() })).body.code).toBe('exists');
    expect((await call(LANDLORD, `/api/inspections/${insp}/payment`, { method: 'escrow' })).body.code).toBe('wrong_state');
  });
  test('the landlord confirms → a record for both, and the home leaves browsing', async () => {
    expect((await call(TENANT, `/api/cash-payments/${payment}/answer`, { received: true })).body.code).toBe('not_landlord');
    sent.length = 0;
    const r = await call(LANDLORD, `/api/cash-payments/${payment}/answer`, { received: true });
    expect(r.body.payment).toMatchObject({ status: 'confirmed', coversUntil: expect.any(Number) });
    expect(sent[0].text).toContain('confirmed they received');
    expect((await call(TENANT, '/api/cash-payments')).body.payments[0].status).toBe('confirmed');
    expect((await call(null, '/api/cash-payments/rented')).body.listingIds).toEqual(['1']);
    expect((await call(LANDLORD, `/api/cash-payments/${payment}/answer`, { received: false, note: 'changed mind' })).body.code).toBe('wrong_state');
  });
  test('escrow tenants cannot upload cash receipts', async () => {
    const other = await inspected(TENANT2, 'Bayo', '07012345678');
    expect((await sendReceipt(TENANT2, { inspectionId: String(other), amountNgn: '820000', paidOn: today() })).body.code).toBe('not_cash');
  });
  test('dispute: the landlord must say why; the admin reviews and decides', async () => {
    const { db } = await import('./db');
    const id = (db().query('SELECT id FROM inspections WHERE tenant = ? ORDER BY id DESC').get(TENANT2.address.toLowerCase()) as { id: number }).id;
    await call(LANDLORD, `/api/inspections/${id}/payment`, { method: 'cash' });
    const p = (await sendReceipt(TENANT2, { inspectionId: String(id), amountNgn: '820000', paidOn: today() })).body.payment.id;
    expect((await call(LANDLORD, `/api/cash-payments/${p}/answer`, { received: false })).body.code).toBe('note');
    const d = await call(LANDLORD, `/api/cash-payments/${p}/answer`, { received: false, note: 'I only got ₦300,000' });
    expect(d.body.payment.status).toBe('disputed');
    expect((await call(LANDLORD, '/api/cash-payments/disputed')).body.code).toBe('not_admin');
    expect((await call(OWNER, '/api/cash-payments/disputed')).body.payments.map((x: { id: number }) => x.id)).toEqual([p]);
    expect((await call(OWNER, `/api/cash-payments/${p}/receipt/0`)).status).toBe(200); // the admin can see the receipt
    expect((await call(OWNER, `/api/cash-payments/${p}/resolve`, { paid: false })).body.code).toBe('note');
    sent.length = 0;
    const r = await call(OWNER, `/api/cash-payments/${p}/resolve`, { paid: false, note: 'The receipt shows ₦300,000, not ₦820,000.' });
    expect(r.body.payment).toMatchObject({ status: 'rejected', adminNote: expect.stringContaining('₦300,000') });
    expect(sent.map(s => s.phone).sort()).toEqual(['2347012345678', '2348031234567']); // both told
  });
});

describe('rent savings', () => {
  const due = () => Date.now() + 52 * 7 * 86_400_000;
  test('a plan needs a sensible goal, date and reminder day', async () => {
    expect((await call(TENANT, '/api/savings/plan', { goalNgn: 5, dueAt: due(), frequency: 'weekly', day: 5 })).body.code).toBe('goal');
    expect((await call(TENANT, '/api/savings/plan', { goalNgn: 820000, dueAt: Date.now() + 86_400_000, frequency: 'weekly', day: 5 })).body.code).toBe('due');
    expect((await call(TENANT, '/api/savings/plan', { goalNgn: 820000, dueAt: due(), frequency: 'monthly', day: 31 })).body.code).toBe('day');
  });
  test('saving weekly toward next year\'s rent', async () => {
    const r = await call(TENANT, '/api/savings/plan', { goalNgn: 820000, dueAt: due(), frequency: 'weekly', day: 5, phone: '0803 111 2222', label: 'Yaba rent 2027' });
    expect(r.body.plan).toMatchObject({ goalNgn: 820000, frequency: 'weekly', reminders: true });
    expect((await call(TENANT, '/api/savings/plan')).body.plan.label).toBe('Yaba rent 2027');
  });
  test('reminders: right day, right amount from what\'s actually in the vault, once a day', async () => {
    // Tenant saves 50 USDC (= ₦80,000) into the real vault.
    await write(OWNER, usdc, 'mint', [TENANT.address, 100_000_000n]);
    await write(TENANT, usdc, 'approve', [vault, 50_000_000n]);
    await write(TENANT, vault, 'deposit', [50_000_000n]);
    const { db } = await import('./db');
    // Friday 10am Lagos (reminder day 5), plan started now.
    const friday = (() => { const d = new Date(); d.setUTCHours(9, 0, 0, 0); while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1); return d.getTime(); })();
    db().query('UPDATE savings_plans SET start_at = ?, due_at = ?, last_reminded_at = 0').run(friday, friday + 52 * 7 * 86_400_000);
    sent.length = 0;
    expect(await savings.sendReminders(friday)).toBe(1);
    expect(sent[0].phone).toBe('2348031112222');
    // (820,000 − 80,000) / 52 weeks = 14,230.77 → rounded up to ₦14,300
    expect(sent[0].text).toContain('save ₦14,300');
    expect(sent[0].text).toContain('saved ₦80,000');
    expect(await savings.sendReminders(friday + 3600_000)).toBe(0); // not twice the same day
    expect(await savings.sendReminders(friday + 86_400_000)).toBe(0); // Saturday isn't the reminder day
  });
  test('stopping the plan', async () => {
    await call(TENANT, '/api/savings/plan/stop', {});
    expect((await call(TENANT, '/api/savings/plan')).body.plan).toBeNull();
  });
});

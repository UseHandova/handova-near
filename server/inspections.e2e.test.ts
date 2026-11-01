/**
 * End-to-end tests for inspection booking: request → approve / suggest / decline → both confirm → tenant may pay.
 * Real: compiled RentFlowEscrow on Anvil (the landlord is read from the chain), real signed sessions.
 * Run: forge build && bun test server/inspections.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { deployProxied } from './test-proxy';

const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TENANT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const TENANT2 = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const TREASURY = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a').address;

const abi = parseAbi(['function createListing(uint256,uint256,string) returns (uint256)', 'function deactivateListing(uint256)']);
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: foundry, transport: http(RPC) });
let anvil: ChildProcess;
let server: Server;
let base = '';
const sent: { phone: string; text: string }[] = [];

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
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const inHours = (h: number) => Date.now() + h * 3600_000;
const booking = (over: Record<string, unknown> = {}) => ({ listingId: '1', slotAt: inHours(26), name: 'Ada Obi', phone: '0803 111 2222', note: 'Evening is best', ...over });
/** Move a slot into the past, as if the visit time has come and gone. */
async function setSlot(id: number, ms: number) {
  const { db } = await import('./db');
  db().query('UPDATE inspections SET slot_at = ? WHERE id = ?').run(ms, id);
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  const usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json', []);
  const escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  await write(LANDLORD, escrow, 'createListing', [1_000_000n, 100_000n, '{"location":"Yaba","phone":"2348031234567"}']);
  await write(LANDLORD, escrow, 'createListing', [1_000_000n, 100_000n, '{"location":"Ikeja"}']);
  await write(LANDLORD, escrow, 'deactivateListing', [2n]);

  const { mountAuth } = await import('./auth');
  const { mountInspections } = await import('./inspections');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  mountInspections(app, { escrow, usdc, treasury: TREASURY }, async (phone, text) => { sent.push({ phone, text }); return true; });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);

afterAll(() => { server?.close(); anvil?.kill(); });

describe('booking', () => {
  test('needs a session', async () => {
    expect((await call(null, '/api/inspections')).status).toBe(401);
  });
  test('rejects a time in the past, with a reason', async () => {
    const r = await call(TENANT, '/api/inspections', booking({ slotAt: Date.now() - 1000 }));
    expect(r.body.code).toBe('bad_time');
    expect(r.body.error).toContain('30 minutes');
  });
  test('rejects a time more than 30 days away', async () => {
    expect((await call(TENANT, '/api/inspections', booking({ slotAt: inHours(24 * 31) }))).body.code).toBe('bad_time');
  });
  test('needs a name and a phone number the landlord can call', async () => {
    expect((await call(TENANT, '/api/inspections', booking({ name: '' }))).body.code).toBe('name');
    expect((await call(TENANT, '/api/inspections', booking({ phone: '12' }))).body.code).toBe('phone');
  });
  test('a landlord cannot book their own listing', async () => {
    expect((await call(LANDLORD, '/api/inspections', booking())).body.code).toBe('own_listing');
  });
  test('a retired listing cannot be booked', async () => {
    expect((await call(TENANT, '/api/inspections', booking({ listingId: '2' }))).body.code).toBe('unavailable_listing');
    expect((await call(TENANT, '/api/inspections', booking({ listingId: '99' }))).body.code).toBe('unavailable_listing');
  });
});

describe('happy path: request → suggest → accept → both confirm → pay', () => {
  let id = 0;
  test('tenant requests a time; the landlord (read from the chain) is told on WhatsApp', async () => {
    sent.length = 0;
    const r = await call(TENANT, '/api/inspections', booking());
    expect(r.status).toBe(200);
    id = r.body.inspection.id;
    expect(r.body.inspection).toMatchObject({ status: 'requested', role: 'tenant', place: 'Yaba', tenantPhone: '2348031112222', canPay: false, notified: true });
    expect(sent[0].phone).toBe('2348031234567');
    expect(sent[0].text).toContain('Ada Obi wants to inspect');
  });
  test('booking the same home twice returns the existing request', async () => {
    const r = await call(TENANT, '/api/inspections', booking());
    expect(r.status).toBe(409);
    expect(r.body.inspection.id).toBe(id);
  });
  test('the landlord sees it with the role "landlord"; a stranger cannot touch it', async () => {
    const list = await call(LANDLORD, '/api/inspections');
    expect(list.body.inspections[0]).toMatchObject({ id, role: 'landlord', tenantName: 'Ada Obi' });
    expect((await call(TENANT2, `/api/inspections/${id}/approve`, {})).status).toBe(404);
  });
  test('the tenant cannot approve their own request', async () => {
    expect((await call(TENANT, `/api/inspections/${id}/approve`, {})).body.code).toBe('not_landlord');
  });
  test('the landlord suggests another time; the tenant is told', async () => {
    sent.length = 0;
    const slot = inHours(30);
    const r = await call(LANDLORD, `/api/inspections/${id}/propose`, { slotAt: slot, note: 'Mornings only' });
    expect(r.body.inspection).toMatchObject({ status: 'rescheduled', slotAt: slot, landlordNote: 'Mornings only' });
    expect(sent[0].phone).toBe('2348031112222');
  });
  test('the landlord cannot approve their own suggestion — the tenant must accept it', async () => {
    expect((await call(LANDLORD, `/api/inspections/${id}/approve`, {})).body.code).toBe('wrong_state');
  });
  test('the tenant accepts → approved', async () => {
    expect((await call(TENANT, `/api/inspections/${id}/accept`, {})).body.inspection.status).toBe('approved');
  });
  test('nobody can mark it done before the visit', async () => {
    const r = await call(TENANT, `/api/inspections/${id}/happened`, {});
    expect(r.body.code).toBe('wrong_state');
    expect(r.body.error).toContain('after the visit');
  });
  test('after the visit, one confirmation is not enough to pay', async () => {
    await setSlot(id, Date.now() - 3600_000);
    const r = await call(TENANT, `/api/inspections/${id}/happened`, {});
    expect(r.body.inspection).toMatchObject({ status: 'approved', canPay: false });
    expect(r.body.inspection.tenantConfirmedAt).toBeGreaterThan(0);
  });
  test('when the landlord confirms too it is completed and the tenant may pay', async () => {
    sent.length = 0;
    const r = await call(LANDLORD, `/api/inspections/${id}/happened`, {});
    expect(r.body.inspection.status).toBe('completed');
    const mine = (await call(TENANT, '/api/inspections')).body.inspections.find((i: { id: number }) => i.id === id);
    expect(mine.canPay).toBe(true);
    expect(sent[0].text).toContain('review the details and pay');
  });
  test('a completed inspection cannot be confirmed twice', async () => {
    expect((await call(TENANT, `/api/inspections/${id}/happened`, {})).body.code).toBe('wrong_state');
  });
});

describe('other paths', () => {
  test('declined: the tenant sees the reason and can book again', async () => {
    const first = await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }));
    const r = await call(LANDLORD, `/api/inspections/${first.body.inspection.id}/decline`, { note: 'Already rented, sorry' });
    expect(r.body.inspection).toMatchObject({ status: 'declined', landlordNote: 'Already rented, sorry' });
    const again = await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }));
    expect(again.status).toBe(200);
    // Clean up so the next tests start fresh for TENANT2.
    await call(TENANT2, `/api/inspections/${again.body.inspection.id}/cancel`, {});
  });
  test('tenant changes the time → back to the landlord for approval, confirmations reset', async () => {
    const b = await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }));
    const id = b.body.inspection.id;
    await call(LANDLORD, `/api/inspections/${id}/approve`, {});
    const slot = inHours(50);
    const r = await call(TENANT2, `/api/inspections/${id}/reschedule`, { slotAt: slot });
    expect(r.body.inspection).toMatchObject({ status: 'requested', slotAt: slot });
    await call(TENANT2, `/api/inspections/${id}/cancel`, {});
    expect((await call(TENANT2, `/api/inspections/${id}/accept`, {})).body.code).toBe('wrong_state');
  });
  test('no-show: either side can report it, and the tenant can book again', async () => {
    const b = await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }));
    const id = b.body.inspection.id;
    await call(LANDLORD, `/api/inspections/${id}/approve`, {});
    expect((await call(LANDLORD, `/api/inspections/${id}/missed`, {})).body.code).toBe('wrong_state'); // too early
    await setSlot(id, Date.now() - 3600_000);
    const r = await call(LANDLORD, `/api/inspections/${id}/missed`, {});
    expect(r.body.inspection).toMatchObject({ status: 'missed', missedBy: 'landlord', canPay: false });
    expect((await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }))).status).toBe(200);
  });
  test('a silent landlord cannot block the tenant forever: 24h after the visit the tenant may pay', async () => {
    const list = (await call(TENANT2, '/api/inspections')).body.inspections;
    const id = list.find((i: { status: string }) => i.status === 'requested').id;
    await call(LANDLORD, `/api/inspections/${id}/approve`, {});
    await setSlot(id, Date.now() - 3600_000);
    expect((await call(TENANT2, `/api/inspections/${id}/happened`, {})).body.inspection.canPay).toBe(false);
    await setSlot(id, Date.now() - 25 * 3600_000);
    const after = (await call(TENANT2, '/api/inspections')).body.inspections.find((i: { id: number }) => i.id === id);
    expect(after).toMatchObject({ status: 'approved', canPay: true });
  });
  test('approving a request whose time has passed asks for a new time', async () => {
    const { db } = await import('./db');
    db().query("UPDATE inspections SET status = 'cancelled' WHERE tenant = ? AND status IN ('requested','rescheduled','approved')").run(TENANT2.address.toLowerCase());
    const b = await call(TENANT2, '/api/inspections', booking({ name: 'Bayo', phone: '07012345678' }));
    await setSlot(b.body.inspection.id, Date.now() - 60_000);
    const r = await call(LANDLORD, `/api/inspections/${b.body.inspection.id}/approve`, {});
    expect(r.body.code).toBe('wrong_state');
    expect(r.body.error).toContain('Suggest a new time');
  });
});

/**
 * End-to-end tests for tenant ↔ landlord chat.
 * Real: compiled RentFlowEscrow on Anvil (the landlord is read from the chain), real signed sessions.
 * Run: forge build && bun test server/chat.e2e.test.ts
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

const PORT = 8550;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TENANT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const STRANGER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
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
  const { mountChat } = await import('./chat');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  const cfg = { escrow, usdc, treasury: TREASURY };
  const notify = async (phone: string, text: string) => { sent.push({ phone, text }); return true; };
  mountInspections(app, cfg, notify);
  mountChat(app, cfg, notify);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);

afterAll(() => { server?.close(); anvil?.kill(); });

describe('starting a chat', () => {
  test('needs a session', async () => {
    expect((await call(null, '/api/chat/conversations')).status).toBe(401);
  });
  test('a landlord cannot open a chat on their own listing without a tenant', async () => {
    expect((await call(LANDLORD, '/api/chat/conversations', { listingId: '1' })).body.code).toBe('own_listing');
  });
  test('a retired or missing listing cannot get a new chat', async () => {
    expect((await call(TENANT, '/api/chat/conversations', { listingId: '2' })).body.code).toBe('unavailable_listing');
    expect((await call(TENANT, '/api/chat/conversations', { listingId: '99' })).body.code).toBe('unavailable_listing');
  });
  test('a landlord cannot cold-message someone who never contacted them', async () => {
    expect((await call(LANDLORD, '/api/chat/conversations', { listingId: '1', tenant: STRANGER.address })).body.code).toBe('no_contact');
  });
  test('opening twice returns the same conversation', async () => {
    const a = await call(TENANT, '/api/chat/conversations', { listingId: '1' });
    const b = await call(TENANT, '/api/chat/conversations', { listingId: '1' });
    expect(a.body.conversation).toMatchObject({ role: 'tenant', place: 'Yaba', withName: 'Landlord · Yaba' });
    expect(b.body.conversation.id).toBe(a.body.conversation.id);
  });
});

describe('messaging', () => {
  let id = 0;
  test('tenant sends; the landlord is nudged on WhatsApp once', async () => {
    id = (await call(TENANT, '/api/chat/conversations', { listingId: '1' })).body.conversation.id;
    sent.length = 0;
    const r = await call(TENANT, `/api/chat/conversations/${id}/messages`, { body: 'Hello, is the flat still available?' });
    expect(r.body).toMatchObject({ ok: true, notified: true, message: { fromMe: true } });
    expect(sent[0].phone).toBe('2348031234567');
    expect(sent[0].text).toContain('is the flat still available');
    await call(TENANT, `/api/chat/conversations/${id}/messages`, { body: 'Can I come on Saturday?' });
    expect(sent.length).toBe(1); // no WhatsApp spam for a burst of messages
  });
  test('the landlord sees it unread, and reading clears the badge', async () => {
    const list = await call(LANDLORD, '/api/chat/conversations');
    expect(list.body.unread).toBe(2);
    expect(list.body.conversations[0]).toMatchObject({ id, role: 'landlord', unread: 2, lastMessage: { body: 'Can I come on Saturday?', fromMe: false } });
    const msgs = await call(LANDLORD, `/api/chat/conversations/${id}/messages`);
    expect(msgs.body.messages.map((m: { body: string }) => m.body)).toEqual(['Hello, is the flat still available?', 'Can I come on Saturday?']);
    expect((await call(LANDLORD, '/api/chat/conversations')).body.unread).toBe(0);
  });
  test('the landlord replies; polling with ?after returns only new messages', async () => {
    const first = await call(TENANT, `/api/chat/conversations/${id}/messages`);
    const lastId = first.body.messages.at(-1).id;
    await call(LANDLORD, `/api/chat/conversations/${id}/messages`, { body: 'Yes! Saturday 10am works.' });
    const next = await call(TENANT, `/api/chat/conversations/${id}/messages?after=${lastId}`);
    expect(next.body.messages).toEqual([expect.objectContaining({ body: 'Yes! Saturday 10am works.', fromMe: false })]);
  });
  test('the tenant sees when the landlord has read their messages', async () => {
    const r = await call(TENANT, '/api/chat/conversations');
    expect(r.body.conversations[0].otherReadAt).toBeGreaterThan(0);
  });
  test('a stranger cannot read or post', async () => {
    expect((await call(STRANGER, `/api/chat/conversations/${id}/messages`)).status).toBe(404);
    expect((await call(STRANGER, `/api/chat/conversations/${id}/messages`, { body: 'hi' })).status).toBe(404);
  });
  test('empty and over-long messages are refused with a reason', async () => {
    expect((await call(TENANT, `/api/chat/conversations/${id}/messages`, { body: '   ' })).body.code).toBe('empty');
    expect((await call(TENANT, `/api/chat/conversations/${id}/messages`, { body: 'x'.repeat(2001) })).body.code).toBe('too_long');
  });
  test('flooding is rate-limited', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call(TENANT, `/api/chat/conversations/${id}/messages`, { body: `spam ${i}` })).status;
    expect(last).toBe(429);
  });
});

describe('landlord-started chats', () => {
  test('a landlord can message a tenant who booked a visit, using the name they gave', async () => {
    await call(STRANGER, '/api/inspections', { listingId: '1', slotAt: Date.now() + 26 * 3600_000, name: 'Bayo Ade', phone: '07012345678' });
    const r = await call(LANDLORD, '/api/chat/conversations', { listingId: '1', tenant: STRANGER.address });
    expect(r.body.conversation).toMatchObject({ role: 'landlord', withName: 'Bayo Ade' });
    sent.length = 0;
    await call(LANDLORD, `/api/chat/conversations/${r.body.conversation.id}/messages`, { body: 'Hi Bayo, see you tomorrow.' });
    expect(sent[0]?.phone).toBe('2347012345678'); // tenant's phone from their booking
  });
});

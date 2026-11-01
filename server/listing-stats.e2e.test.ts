/**
 * End-to-end tests for property saves, views, inspection counts and property reviews.
 * Real: upgradeable RentFlowEscrow + RentFlowNFT behind proxies on Anvil, real signed sessions, a real move-in.
 * Run: forge build && bun test server/listing-stats.e2e.test.ts
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

const PORT = 8554;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TENANT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const VISITOR = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const STRANGER = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');

const abi = parseAbi([
  'function createListing(uint256,uint256,string) returns (uint256)',
  'function setNftContract(address)',
  'function depositRent(uint256) returns (uint256)',
  'function confirmMoveIn(uint256)',
  'function movedInAt(uint256) view returns (uint256)',
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: foundry, transport: http(RPC) });
let anvil: ChildProcess;
let server: Server;
let base = '';
let escrow: Address;

async function waitFor(fn: () => Promise<unknown>) {
  for (let i = 0; ; i++) { try { await fn(); return; } catch (e) { if (i > 75) throw e; await Bun.sleep(200); } }
}
async function deploy(path: string) {
  const a = JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
  const hash = await wallet(OWNER).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args: [] });
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
const stats = async (id: string) => ((await call(null, '/api/listings/stats')).body.stats as Record<string, Record<string, number>>)[id] ?? {};
async function inspection(listingId: string, tenant: Address, status: string, slotAt = Date.now() + 86_400_000) {
  const { db } = await import('./db');
  db().query(`INSERT INTO inspections (listing_id, tenant, landlord, place, status, slot_at, tenant_name, tenant_phone, landlord_phone, note, created_at, updated_at)
    VALUES (?, ?, ?, 'Yaba', ?, ?, 'Ada', '', '', '', ?, ?)`).run(listingId, tenant.toLowerCase(), LANDLORD.address.toLowerCase(), status, slotAt, Date.now(), Date.now());
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  const usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json');
  escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  const nft = await deployProxied(wallet(OWNER), pc, 'RentFlowNFT', [escrow]);
  await write(OWNER, escrow, 'setNftContract', [nft]);
  await write(LANDLORD, escrow, 'createListing', [1_000_000n, 100_000n, '{"location":"Yaba"}']); // #1
  await write(LANDLORD, escrow, 'createListing', [2_000_000n, 100_000n, '{"location":"Ikeja"}']); // #2
  // The tenant rents #2 and moves in.
  await write(OWNER, usdc, 'mint', [TENANT.address, 10_000_000n]);
  await write(TENANT, usdc, 'approve', [escrow, 10_000_000n]);
  await write(TENANT, escrow, 'depositRent', [2n]);
  await write(TENANT, escrow, 'confirmMoveIn', [1n]);

  const { mountAuth } = await import('./auth');
  const { mountListingStats } = await import('./listing-stats');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  mountListingStats(app, { escrow, usdc, treasury: STRANGER.address });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);

afterAll(() => { server?.close(); anvil?.kill(); });

describe('upgradeable escrow', () => {
  test('records when the tenant moved in', async () => {
    const at = await pc.readContract({ address: escrow, abi, functionName: 'movedInAt', args: [1n] });
    expect(at).toBeGreaterThan(0n);
  });
});

describe('saves', () => {
  test('need a session', async () => {
    expect((await call(null, '/api/listings/1/save', { saved: true })).status).toBe(401);
  });
  test('count each person once, and can be undone', async () => {
    expect((await call(TENANT, '/api/listings/1/save', { saved: true })).body).toMatchObject({ saved: true, saves: 1 });
    expect((await call(TENANT, '/api/listings/1/save', { saved: true })).body.saves).toBe(1);
    expect((await call(VISITOR, '/api/listings/1/save', { saved: true })).body.saves).toBe(2);
    expect((await call(TENANT, '/api/listings/saved')).body.listingIds).toEqual(['1']);
    expect((await call(VISITOR, '/api/listings/1/save', { saved: false })).body).toMatchObject({ saved: false, saves: 1 });
    expect((await stats('1')).saves).toBe(1);
  });
  test('reject a bad listing id', async () => {
    expect((await call(TENANT, '/api/listings/abc/save', { saved: true })).status).toBe(400);
  });
});

describe('views', () => {
  test('one per device per home, no sign-in needed', async () => {
    const device = 'device-aaaaaaaaaaaaaaaa';
    expect((await call(null, '/api/listings/1/view', { viewer: device })).body.views).toBe(1);
    expect((await call(null, '/api/listings/1/view', { viewer: device })).body.views).toBe(1);
    expect((await call(null, '/api/listings/1/view', { viewer: 'device-bbbbbbbbbbbbbbbb' })).body.views).toBe(2);
    expect((await call(null, '/api/listings/1/view', { viewer: 'x' })).status).toBe(400);
  });
});

describe('inspection counts', () => {
  test('completed visits count as inspected, upcoming ones as booked', async () => {
    await inspection('1', VISITOR.address, 'completed', Date.now() - 86_400_000);
    await inspection('1', STRANGER.address, 'approved');
    await inspection('1', TENANT.address, 'declined');
    const s = await stats('1');
    expect(s.inspected).toBe(1);
    expect(s.booked).toBe(1);
  });
});

describe('property reviews', () => {
  const review = { rating: 4, body: 'Bright rooms and the water runs all day.' };
  test('someone who never saw the home cannot review it', async () => {
    const r = await call(STRANGER, '/api/listings/1/reviews', review);
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('inspected');
  });
  test('the landlord cannot review their own home', async () => {
    expect((await call(LANDLORD, '/api/listings/1/reviews', review)).body.code).toBe('own_listing');
  });
  test('a completed inspection lets a visitor review, once', async () => {
    expect((await call(VISITOR, '/api/listings/1/reviews')).body.mine).toEqual({ reviewed: false, canReview: true });
    expect((await call(VISITOR, '/api/listings/1/reviews', review)).body).toMatchObject({ ok: true, kind: 'visited' });
    expect((await call(VISITOR, '/api/listings/1/reviews', review)).status).toBe(409);
    expect((await call(VISITOR, '/api/listings/1/reviews')).body.mine).toEqual({ reviewed: true, canReview: false });
  });
  test('a tenant who moved in (onchain) reviews as someone who lived there', async () => {
    expect((await call(TENANT, '/api/listings/2/reviews', { ...review, rating: 5, escrowId: '1' })).body.kind).toBe('lived');
    // Their escrow is for #2, so it doesn't count for #1.
    expect((await call(TENANT, '/api/listings/1/reviews', { ...review, escrowId: '1' })).status).toBe(403);
  });
  test('reviews are public with an average, and show in the stats', async () => {
    const r = await call(null, '/api/listings/1/reviews');
    expect(r.body).toMatchObject({ count: 1, average: 4 });
    expect(r.body.reviews[0]).toMatchObject({ rating: 4, kind: 'visited' });
    expect(r.body.mine).toBeUndefined();
    expect(await stats('2')).toMatchObject({ reviews: 1, rating: 5 });
  });
  test('asks for a real rating and a sentence', async () => {
    expect((await call(VISITOR, '/api/listings/1/reviews', { rating: 9, body: 'ok' })).body.error).toContain('1 to 5');
  });
});

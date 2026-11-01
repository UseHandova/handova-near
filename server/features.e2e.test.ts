/**
 * End-to-end tests for sessions, reviews, maintenance, boosts, referrals and moderation.
 * Real: compiled RentFlowEscrow + RentFlowNFT + MockUSDC on Anvil, a real tenancy, real signatures and
 * real USDC transfers. Run: forge build && bun test server/features.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { deployProxied } from './test-proxy';

const PORT = 8548;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

// Anvil dev keys
const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TENANT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const STRANGER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const TREASURY = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a').address;

const abi = parseAbi([
  'function setNftContract(address)',
  'function createListing(uint256,uint256,string) returns (uint256)',
  'function depositRent(uint256) returns (uint256)',
  'function confirmMoveIn(uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function mint(address,uint256)',
]);

const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: foundry, transport: http(RPC) });
let anvil: ChildProcess;
let server: Server;
let base = '';
let escrow: Address;
let usdc: Address;

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
  return (await pc.waitForTransactionReceipt({ hash })).transactionHash;
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
async function call(a: PrivateKeyAccount | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
  if (a) headers.Authorization = `Bearer ${await session(a)}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json', []);
  escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  const nft = await deployProxied(wallet(OWNER), pc, 'RentFlowNFT', [escrow]);
  await write(OWNER, escrow, 'setNftContract', [nft]);
  // Listing 1: tenant moves in (escrow 1 Active). Listing 2: tenant paid but not moved in (escrow 2 Pending).
  await write(LANDLORD, escrow, 'createListing', [1_000_000n, 100_000n, '{"location":"Yaba"}']);
  await write(LANDLORD, escrow, 'createListing', [1_000_000n, 100_000n, '{"location":"Ikeja"}']);
  await write(OWNER, usdc, 'mint', [TENANT.address, 10_000_000n]);
  await write(OWNER, usdc, 'mint', [LANDLORD.address, 100_000_000n]);
  await write(TENANT, usdc, 'approve', [escrow, 10_000_000n]);
  await write(TENANT, escrow, 'depositRent', [1n]);
  await write(TENANT, escrow, 'confirmMoveIn', [1n]);
  await write(TENANT, escrow, 'depositRent', [2n]);

  const { mountAuth } = await import('./auth');
  const { mountFeatures } = await import('./features');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  mountFeatures(app, { escrow, usdc, treasury: TREASURY });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);

afterAll(() => { server?.close(); anvil?.kill(); });

describe('sessions', () => {
  test('a forged signature gets no session', async () => {
    const ch = await (await fetch(`${base}/api/auth/challenge?address=${TENANT.address}`)).json() as { nonce: string; message: string };
    const r = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: TENANT.address, nonce: ch.nonce, signature: await STRANGER.signMessage({ message: ch.message }) }) });
    expect(r.status).toBe(401);
  });
  test('authenticated routes refuse requests without a session', async () => {
    expect((await call(null, 'GET', '/api/maintenance')).status).toBe(401);
    const r = await fetch(`${base}/api/maintenance`, { headers: { Authorization: 'Bearer 0xabc.9999999999999.deadbeef' } });
    expect(r.status).toBe(401);
  });
});

describe('reviews', () => {
  test('a stranger cannot review a tenancy', async () => {
    const r = await call(STRANGER, 'POST', '/api/reviews', { escrowId: '1', rating: 1, body: 'Never lived here but angry anyway.' });
    expect(r.status).toBe(403);
  });
  test('a tenant who has not moved in cannot review yet', async () => {
    const r = await call(TENANT, 'POST', '/api/reviews', { escrowId: '2', rating: 5, body: 'Looks nice from the outside.' });
    expect(r.body.code).toBe('not_moved_in');
  });
  test('eligible tenancies = moved in and not yet reviewed', async () => {
    const r = await call(TENANT, 'GET', '/api/reviews/eligible?escrowIds=1,2');
    expect(r.body.escrowIds).toEqual(['1']);
  });
  test('the tenant who moved in can review once', async () => {
    expect((await call(TENANT, 'POST', '/api/reviews', { escrowId: '1', rating: 4, body: 'Water and power were reliable, repairs a bit slow.' })).status).toBe(200);
    const again = await call(TENANT, 'POST', '/api/reviews', { escrowId: '1', rating: 5, body: 'Trying to review twice to boost it.' });
    expect(again.body.code).toBe('already_reviewed');
  });
  test('reviews are public with the landlord average', async () => {
    const r = await call(null, 'GET', `/api/reviews?landlord=${LANDLORD.address}`);
    expect(r.body.count).toBe(1);
    expect(r.body.average).toBe(4);
    expect(r.body.reviews[0].tenant).toContain('…');
    expect((await call(TENANT, 'GET', '/api/reviews/eligible?escrowIds=1,2')).body.escrowIds).toEqual([]);
  });
});

describe('maintenance', () => {
  let id = 0;
  test('only the tenant of a live tenancy can report a repair', async () => {
    expect((await call(STRANGER, 'POST', '/api/maintenance', { escrowId: '1', title: 'Broken tap' })).status).toBe(403);
    expect((await call(TENANT, 'POST', '/api/maintenance', { escrowId: '2', title: 'Broken tap' })).body.code).toBe('not_live');
    expect((await call(TENANT, 'POST', '/api/maintenance', { escrowId: '1', title: 'Leaking kitchen tap', details: 'Since Monday', priority: 'high' })).status).toBe(200);
  });
  test('both landlord and tenant see it', async () => {
    const l = await call(LANDLORD, 'GET', '/api/maintenance');
    const t = await call(TENANT, 'GET', '/api/maintenance');
    expect(l.body.requests[0].role).toBe('landlord');
    expect(t.body.requests[0].role).toBe('tenant');
    id = l.body.requests[0].id;
    expect((await call(STRANGER, 'GET', '/api/maintenance')).body.requests).toEqual([]);
  });
  test('landlord moves it along; tenant can only confirm or reopen', async () => {
    expect((await call(TENANT, 'PATCH', `/api/maintenance/${id}`, { status: 'in_progress' })).status).toBe(403);
    expect((await call(STRANGER, 'PATCH', `/api/maintenance/${id}`, { status: 'resolved' })).status).toBe(403);
    expect((await call(LANDLORD, 'PATCH', `/api/maintenance/${id}`, { status: 'in_progress' })).status).toBe(200);
    expect((await call(TENANT, 'PATCH', `/api/maintenance/${id}`, { status: 'resolved' })).status).toBe(200);
    expect((await call(TENANT, 'GET', '/api/maintenance')).body.requests[0].status).toBe('resolved');
  });
});

describe('boosts', () => {
  let goodTx: Hex;
  test('a verified USDC payment to the treasury boosts the listing', async () => {
    goodTx = await write(LANDLORD, usdc, 'transfer', [TREASURY, parseUnits('3.5', 6)]);
    const r = await call(LANDLORD, 'POST', '/api/boosts', { listingId: '2', days: 14, txHash: goodTx });
    expect(r.status).toBe(200);
    const list = await call(null, 'GET', '/api/boosts');
    expect(list.body.boosts.map((b: { listingId: string }) => b.listingId)).toContain('2');
    expect(list.body.treasury).toBe(TREASURY);
  });
  test('the same payment cannot be used twice', async () => {
    expect((await call(LANDLORD, 'POST', '/api/boosts', { listingId: '2', days: 14, txHash: goodTx })).body.code).toBe('tx_used');
  });
  test('underpaying is rejected', async () => {
    const tx = await write(LANDLORD, usdc, 'transfer', [TREASURY, parseUnits('2', 6)]);
    expect((await call(LANDLORD, 'POST', '/api/boosts', { listingId: '2', days: 30, txHash: tx })).body.code).toBe('payment_mismatch');
  });
  test('paying someone other than the treasury is rejected', async () => {
    const tx = await write(LANDLORD, usdc, 'transfer', [STRANGER.address, parseUnits('6', 6)]);
    expect((await call(LANDLORD, 'POST', '/api/boosts', { listingId: '2', days: 30, txHash: tx })).body.code).toBe('payment_mismatch');
  });
  test("only the listing's landlord can boost it", async () => {
    const tx = await write(TENANT, usdc, 'transfer', [TREASURY, parseUnits('2', 6)]);
    expect((await call(TENANT, 'POST', '/api/boosts', { listingId: '2', days: 7, txHash: tx })).body.code).toBe('not_landlord');
  });
});

describe('referrals', () => {
  test('a friend joins with a code once; self-referral is refused', async () => {
    const code = (await call(LANDLORD, 'GET', '/api/referrals/me')).body.code as string;
    expect(code).toMatch(/^[0-9A-F]{6,}$/);
    expect((await call(LANDLORD, 'POST', '/api/referrals', { code })).body.code).toBe('self');
    expect((await call(STRANGER, 'POST', '/api/referrals', { code })).status).toBe(200);
    expect((await call(STRANGER, 'POST', '/api/referrals', { code })).body.code).toBe('already_referred');
    expect((await call(TENANT, 'POST', '/api/referrals', { code: 'NOPE00' })).body.code).toBe('unknown_code');
    expect((await call(LANDLORD, 'GET', '/api/referrals/me')).body.referrals).toHaveLength(1);
  });
});

describe('moderation', () => {
  test('only the arbiter can hide listings', async () => {
    expect((await call(LANDLORD, 'POST', '/api/moderation/hide', { listingId: '1', reason: 'x' })).body.code).toBe('not_admin');
    // The deployer is the default arbiter.
    expect((await call(OWNER, 'POST', '/api/moderation/hide', { listingId: '1', reason: 'Duplicate listing' })).status).toBe(200);
    const hidden = await call(null, 'GET', '/api/moderation/hidden');
    expect(hidden.body.listingIds).toContain('1');
    expect(hidden.body.items[0].reason).toBe('Duplicate listing');
    expect((await call(OWNER, 'POST', '/api/moderation/unhide', { listingId: '1' })).status).toBe(200);
    expect((await call(null, 'GET', '/api/moderation/hidden')).body.listingIds).not.toContain('1');
  });
});

/**
 * End-to-end tests for admin access: the arbiter is confirmed from a signed session, never from the browser.
 * Real: compiled RentFlowEscrow on Anvil (owner + arbiter read from the chain), real signed sessions, real files.
 * Run: forge build && bun test server/admin.e2e.test.ts
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

const PORT = 8552;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.ARC_RPC_URL = RPC;
process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'); // deployer = arbiter
const LANDLORD = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const STRANGER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const TREASURY = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a').address;
const ADDRESS = '14 Admiralty Way, Lekki Phase 1, Lagos';

const abi = parseAbi(['function createListing(uint256,uint256,string) returns (uint256)']);
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: foundry, transport: http(RPC) });
let anvil: ChildProcess, server: Server, base = '';

async function waitFor(fn: () => Promise<unknown>) {
  for (let i = 0; ; i++) { try { await fn(); return; } catch (e) { if (i > 75) throw e; await Bun.sleep(200); } }
}
const art = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
async function deploy(path: string, args: unknown[]) {
  const a = art(path);
  const hash = await wallet(OWNER).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  return (await pc.waitForTransactionReceipt({ hash })).contractAddress!;
}
async function list(a: PrivateKeyAccount, escrow: Address, meta: string) {
  const hash = await wallet(a).writeContract({ address: escrow, abi, functionName: 'createListing', args: [1_000_000n, 100_000n, meta] });
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
beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  const usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json', []);
  const escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Lekki', address: ADDRESS }));  // 1
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Yaba' }));                     // 2: no street address
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Lekki', address: '14, Admiralty Way — Lekki Phase 1, LAGOS' })); // 3: same place, edited
  const { mountAuth } = await import('./auth');
  const { mountAdmin } = await import('./admin');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  mountAdmin(app, { escrow, usdc, treasury: TREASURY });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);
afterAll(() => { server?.close(); anvil?.kill(); });

describe('admin access', () => {
  test('needs a signed-in session', async () => {
    expect((await call(null, '/api/admin/me')).status).toBe(401);
    expect((await call(null, '/api/admin/stats')).status).toBe(401);
  });
  test('only the onchain arbiter is admin', async () => {
    expect((await call(OWNER, '/api/admin/me')).body.admin).toBe(true);     // deployer = default arbiter
    expect((await call(LANDLORD, '/api/admin/me')).body.admin).toBe(false);
    expect((await call(STRANGER, '/api/admin/me')).body.admin).toBe(false);
  });
  test('activity stats are admin-only', async () => {
    expect((await call(LANDLORD, '/api/admin/stats')).body.code).toBe('not_admin');
    const r = await call(OWNER, '/api/admin/stats');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phoneAccounts: 0, inspections: { open: 0, completed: 0, total: 0 }, chats: { conversations: 0 }, ownership: { pending: 0 } });
  });
});

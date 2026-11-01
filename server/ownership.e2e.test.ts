/**
 * End-to-end tests for property ownership checks: private document upload, admin review, public badge.
 * Real: compiled RentFlowEscrow on Anvil (owner + arbiter read from the chain), real signed sessions, real files.
 * Run: forge build && bun test server/ownership.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { deployProxied } from './test-proxy';

const PORT = 8551;
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
const dir = mkdtempSync(join(tmpdir(), 'ownership-'));
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
async function submit(a: PrivateKeyAccount, fields: Record<string, string>, files: { name: string; type: string; bytes: number }[]) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ consent: 'yes', ...fields })) form.append(k, v);
  for (const f of files) form.append('files', new File([new Uint8Array(f.bytes).fill(7)], f.name, { type: f.type }));
  const res = await fetch(`${base}/api/ownership`, { method: 'POST', headers: { Authorization: `Bearer ${await session(a)}` }, body: form });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const pdf = { name: 'c-of-o.pdf', type: 'application/pdf', bytes: 2048 };

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => pc.getBlockNumber());
  const usdc = await deploy('contracts/out/RentFlowEscrow.t.sol/MockUSDC.json', []);
  const escrow = await deployProxied(wallet(OWNER), pc, 'RentFlowEscrow', [usdc]);
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Lekki', address: ADDRESS }));  // 1
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Yaba' }));                     // 2: no street address
  await list(LANDLORD, escrow, JSON.stringify({ location: 'Lekki', address: '14, Admiralty Way — Lekki Phase 1, LAGOS' })); // 3: same place, edited
  const { mountAuth } = await import('./auth');
  const { mountOwnership } = await import('./ownership');
  const app = express();
  app.use(express.json());
  mountAuth(app);
  mountOwnership(app, { escrow, usdc, treasury: TREASURY }, dir);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);
afterAll(() => { server?.close(); anvil?.kill(); });

describe('submitting proof', () => {
  test('the landlord must agree to how documents are handled first', async () => {
    expect((await submit(LANDLORD, { listingId: '1', docType: 'c_of_o', consent: 'no' }, [pdf])).body.code).toBe('consent');
  });
  test('only the listing owner can submit', async () => {
    expect((await submit(STRANGER, { listingId: '1', docType: 'c_of_o' }, [pdf])).body.code).toBe('not_owner');
  });
  test('needs a document type and at least one file', async () => {
    expect((await submit(LANDLORD, { listingId: '1', docType: 'nonsense' }, [pdf])).body.code).toBe('doc_type');
    expect((await submit(LANDLORD, { listingId: '1', docType: 'c_of_o' }, [])).body.code).toBe('no_files');
  });
  test('a listing without a street address is asked to add one first', async () => {
    expect((await submit(LANDLORD, { listingId: '2', docType: 'c_of_o' }, [pdf])).body.code).toBe('no_address');
  });
  test('only photos and PDFs, under 10 MB', async () => {
    const r = await submit(LANDLORD, { listingId: '1', docType: 'c_of_o' }, [{ name: 'x.exe', type: 'application/x-msdownload', bytes: 10 }]);
    expect(r.body.code).toBe('no_files'); // filtered out
    expect((await submit(LANDLORD, { listingId: '1', docType: 'c_of_o' }, [{ ...pdf, bytes: 11 * 1024 * 1024 }])).status).toBe(413);
  });
  test('the landlord submits; files are encrypted on disk, with consent recorded', async () => {
    const r = await submit(LANDLORD, { listingId: '1', docType: 'c_of_o', note: 'Original C of O, page 1 and 2' }, [pdf, { name: 'p2.jpg', type: 'image/jpeg', bytes: 1000 }]);
    expect(r.body.request).toMatchObject({ status: 'pending', docType: 'c_of_o', address: ADDRESS, consentAt: expect.any(Number) });
    expect(r.body.request.files).toHaveLength(2);
    const onDisk = readdirSync(dir);
    expect(onDisk).toHaveLength(2);
    expect(onDisk.every(f => f.endsWith('.bin'))).toBe(true);                    // no .pdf/.jpg on disk
    for (const f of onDisk) {
      const raw = readFileSync(join(dir, f));
      expect(raw.includes(Buffer.alloc(64, 7))).toBe(false);                      // the original bytes aren't there
    }
    const expected = createHash('sha256').update(Buffer.alloc(2048, 7)).digest('hex');
    expect(r.body.request.files[0].sha256).toBe(expected);                        // fingerprint of the original
  });
  test('submitting again while under review is refused', async () => {
    expect((await submit(LANDLORD, { listingId: '1', docType: 'deed' }, [pdf])).body.code).toBe('pending');
  });
});

describe('privacy and review', () => {
  let id = 0;
  test('documents are visible to the landlord and the admin only', async () => {
    id = (await call(LANDLORD, '/api/ownership/mine')).body.requests[0].id;
    const own = await fetch(`${base}/api/ownership/${id}/file/0`, { headers: { Authorization: `Bearer ${await session(LANDLORD)}` } });
    expect(own.headers.get('content-type')).toContain('application/pdf');
    expect(Buffer.from(await own.arrayBuffer()).equals(Buffer.alloc(2048, 7))).toBe(true); // decrypted back exactly
    expect((await call(OWNER, `/api/ownership/${id}/file/0`)).status).toBe(200);
    expect((await call(STRANGER, `/api/ownership/${id}/file/0`)).status).toBe(404);
    expect((await fetch(`${base}/api/ownership/${id}/file/0`)).status).toBe(401);
  });
  test('only the admin sees the queue and can review', async () => {
    expect((await call(LANDLORD, '/api/ownership/pending')).body.code).toBe('not_admin');
    expect((await call(LANDLORD, `/api/ownership/${id}/review`, { decision: 'approve' })).body.code).toBe('not_admin');
    expect((await call(OWNER, '/api/ownership/pending')).body.requests.map((r: { id: number }) => r.id)).toContain(id);
  });
  test('rejecting needs a reason; the documents are then deleted', async () => {
    expect((await call(OWNER, `/api/ownership/${id}/review`, { decision: 'reject' })).body.code).toBe('reason');
    const r = await call(OWNER, `/api/ownership/${id}/review`, { decision: 'reject', reason: 'The name on the C of O does not match your verified ID.' });
    expect(r.body.request).toMatchObject({ status: 'rejected', reason: expect.stringContaining('does not match') });
    expect(readdirSync(dir)).toHaveLength(0);
    expect((await call(null, '/api/ownership/verified')).body.verified).toEqual([]);
  });
  test('after a rejection the landlord can resubmit; approval shows publicly and the files are deleted', async () => {
    const again = await submit(LANDLORD, { listingId: '1', docType: 'deed' }, [pdf]);
    expect(readdirSync(dir)).toHaveLength(1);
    const r = await call(OWNER, `/api/ownership/${again.body.request.id}/review`, { decision: 'approve' });
    expect(r.body.request).toMatchObject({ status: 'approved', filesDeletedAt: expect.any(Number) });
    expect(readdirSync(dir)).toHaveLength(0);
    const mine = (await call(LANDLORD, '/api/ownership/mine')).body.requests.find((x: { id: number }) => x.id === again.body.request.id);
    expect(mine.files[0]).toMatchObject({ available: false, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }); // fingerprint kept
    expect((await call(OWNER, `/api/ownership/${again.body.request.id}/file/0`)).status).toBe(410);
    expect((await call(OWNER, `/api/ownership/${again.body.request.id}/review`, { decision: 'reject', reason: 'changed my mind' })).body.code).toBe('already_reviewed');
    const pub = (await call(null, '/api/ownership/verified')).body.verified;
    expect(pub).toEqual([{ landlord: LANDLORD.address.toLowerCase(), addressKey: '14 admiralty way lekki phase 1 lagos', approvedAt: expect.any(Number) }]);
  });
  test('the same address (written differently after an edit) counts as already checked', async () => {
    expect((await submit(LANDLORD, { listingId: '3', docType: 'c_of_o' }, [pdf])).body.code).toBe('already_approved');
  });
  test('the public list never exposes documents or notes', async () => {
    const raw = JSON.stringify((await call(null, '/api/ownership/verified')).body);
    expect(raw).not.toContain('files');
    expect(raw).not.toContain('pdf');
    expect(existsSync(dir)).toBe(true);
  });
});

/**
 * End-to-end test for landlord verification.
 * Real pieces: the verification server, the compiled RentFlowEscrow on a local Anvil chain,
 * wallet signatures and onchain writes. Stubbed: Dojah (a local HTTP server mimicking its API).
 *
 * Run: forge build && bun test server/verification.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { mountVerification, type VerificationConfig } from './verification';
import { deployProxied } from './test-proxy';

const ANVIL_PORT = 8547;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
// Anvil's well-known dev keys
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const VERIFIER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const TEST_NIN = '70123456789'; // Dojah's documented sandbox NIN
const GOOD_SELFIE = Buffer.from('FACE_OK jpeg bytes').toString('base64');
const BAD_SELFIE = Buffer.from('someone else').toString('base64');

const ESCROW_ABI = [
  { inputs: [{ name: 'verifier_', type: 'address' }], name: 'setVerifier', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'verifiedAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

let anvil: ChildProcess;
let dojahStub: ReturnType<typeof Bun.serve>;
let appServer: Server;
let unconfiguredServer: Server;
let base = '';
let unconfiguredBase = '';
let escrow: Address;
let dataFile = '';
const dojahRequests: { headers: Record<string, string | null>; body: { nin: string; selfie_image: string } }[] = [];

const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });

async function waitFor(fn: () => Promise<unknown>, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { await fn(); return; } catch (e) { if (Date.now() > end) throw e; await Bun.sleep(200); }
  }
}

function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` });
    });
  });
}

/** Run the full client flow: fetch challenge, sign it, submit. */
async function verify(account: PrivateKeyAccount, opts: { nin?: string; selfie?: string; signer?: PrivateKeyAccount; reuseNonce?: string; url?: string } = {}) {
  const url = opts.url ?? base;
  const ch = await (await fetch(`${url}/api/verify/challenge?address=${account.address}`)).json() as { nonce: string; message: string };
  const signature = await (opts.signer ?? account).signMessage({ message: ch.message });
  const res = await fetch(`${url}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: account.address,
      nonce: opts.reuseNonce ?? ch.nonce,
      signature,
      nin: opts.nin ?? TEST_NIN,
      selfie: `data:image/jpeg;base64,${opts.selfie ?? GOOD_SELFIE}`,
    }),
  });
  return { status: res.status, body: await res.json() as { ok: boolean; code?: string; error?: string; txHash?: string }, nonce: ch.nonce };
}

const verifiedAt = (a: Address) => publicClient.readContract({ address: escrow, abi: ESCROW_ABI, functionName: 'verifiedAt', args: [a] });

beforeAll(async () => {
  // 1. Local chain
  anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
  await waitFor(() => publicClient.getBlockNumber());

  // 2. Deploy the real compiled escrow and hand the verifier role to the backend key
  const owner = createWalletClient({ account: privateKeyToAccount(OWNER_KEY), chain: foundry, transport: http(RPC) });
  escrow = await deployProxied(owner, publicClient, 'RentFlowEscrow', ['0x0000000000000000000000000000000000000001']);
  const setHash = await owner.writeContract({ address: escrow, abi: ESCROW_ABI, functionName: 'setVerifier', args: [privateKeyToAccount(VERIFIER_KEY).address] });
  await publicClient.waitForTransactionReceipt({ hash: setHash });

  // 3. Dojah stub — same route, headers and response shape as the real API
  dojahStub = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== '/api/v1/kyc/nin/verify' || req.method !== 'POST') return new Response('not found', { status: 404 });
      const body = await req.json() as { nin: string; selfie_image: string };
      dojahRequests.push({ headers: { appId: req.headers.get('AppId'), auth: req.headers.get('Authorization') }, body });
      if (req.headers.get('Authorization') !== 'test-secret') return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (body.nin !== TEST_NIN) return Response.json({ error: 'NIN not found' }, { status: 404 });
      const match = Buffer.from(body.selfie_image, 'base64').toString().startsWith('FACE_OK');
      return Response.json({ entity: { first_name: 'JOHN', last_name: 'MUSA', selfie_verification: { confidence_value: match ? 99.9 : 12.5, match } } });
    },
  });

  // 4. Verification server under test
  dataFile = join(mkdtempSync(join(tmpdir(), 'rf-verify-')), 'verifications.json');
  const config: VerificationConfig = {
    rpcUrl: RPC, chain: foundry, escrowAddress: escrow, verifierPrivateKey: VERIFIER_KEY,
    dojahAppId: 'test-app', dojahSecretKey: 'test-secret', dojahBaseUrl: `http://127.0.0.1:${dojahStub.port}`,
    ninPepper: 'test-pepper', dataFile, threshold: 90,
  };
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  mountVerification(app, config);
  ({ server: appServer, url: base } = await listen(app));

  const bare = express();
  bare.use(express.json({ limit: '6mb' }));
  mountVerification(bare, { ...config, dojahAppId: undefined, dojahSecretKey: undefined, dataFile: `${dataFile}.bare` });
  ({ server: unconfiguredServer, url: unconfiguredBase } = await listen(bare));
}, 60_000);

afterAll(() => {
  appServer?.close();
  unconfiguredServer?.close();
  dojahStub?.stop(true);
  anvil?.kill();
});

describe('landlord verification e2e', () => {
  const landlord = privateKeyToAccount(generatePrivateKey());

  test('reports provider and onchain readiness', async () => {
    expect(await (await fetch(`${base}/api/verify/config`)).json()).toEqual({ provider: 'dojah', onchain: true, sandbox: false });
    expect(await (await fetch(`${unconfiguredBase}/api/verify/config`)).json()).toEqual({ provider: null, onchain: true, sandbox: false });
  });

  test('matching NIN + selfie verifies the landlord onchain', async () => {
    expect(await verifiedAt(landlord.address)).toBe(0n);
    const r = await verify(landlord);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await verifiedAt(landlord.address)).toBeGreaterThan(0n);
  });

  test('sends Dojah the right credentials and a bare base64 selfie', () => {
    const last = dojahRequests.at(-1)!;
    expect(last.headers).toEqual({ appId: 'test-app', auth: 'test-secret' });
    expect(last.body.nin).toBe(TEST_NIN);
    expect(last.body.selfie_image.startsWith('data:')).toBe(false);
  });

  test('never stores the raw NIN', () => {
    expect(existsSync(dataFile)).toBe(true);
    const stored = readFileSync(dataFile, 'utf8');
    expect(stored).not.toContain(TEST_NIN);
    expect(stored.toLowerCase()).toContain(landlord.address.toLowerCase());
  });

  test('a challenge cannot be replayed', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const first = await verify(other, { selfie: BAD_SELFIE });
    const replay = await verify(other, { reuseNonce: first.nonce });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('bad_challenge');
  });

  test('a signature from a different wallet is rejected', async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const r = await verify(victim, { signer: attacker });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('bad_signature');
    expect(await verifiedAt(victim.address)).toBe(0n);
  });

  test('someone else\'s NIN is refused before any face match is attempted', async () => {
    const before = dojahRequests.length;
    const a = privateKeyToAccount(generatePrivateKey());
    const r = await verify(a, { nin: TEST_NIN, selfie: BAD_SELFIE });
    expect(r.status).toBe(409);
    expect(dojahRequests.length).toBe(before);
    expect(await verifiedAt(a.address)).toBe(0n);
  });

  test('the same NIN cannot verify a second account', async () => {
    const second = privateKeyToAccount(generatePrivateKey());
    const r = await verify(second);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('nin_in_use');
    expect(await verifiedAt(second.address)).toBe(0n);
  });

  test('an unknown NIN is rejected', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const r = await verify(a, { nin: '11111111111' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('nin_not_found');
  });

  test('a malformed NIN is rejected before calling Dojah', async () => {
    const before = dojahRequests.length;
    const a = privateKeyToAccount(generatePrivateKey());
    const r = await verify(a, { nin: '1234' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('bad_nin');
    expect(dojahRequests.length).toBe(before);
  });

  test('a selfie that does not match the NIN photo is rejected', async () => {
    const r = await verify(landlord, { selfie: BAD_SELFIE });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('face_mismatch');
    expect(await verifiedAt(landlord.address)).toBeGreaterThan(0n); // earlier verification is untouched
  });

  test('too many attempts are throttled', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await verify(a, { nin: '11111111111' })).status);
    expect(codes.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(codes[5]).toBe(429);
  });

  test('without Dojah keys it refuses instead of faking a result', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const r = await verify(a, { url: unconfiguredBase });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('not_configured');
    expect(await verifiedAt(a.address)).toBe(0n);
  });
});

// ── Didit provider ──────────────────────────────────────────────────────────
describe('landlord verification e2e — Didit', () => {
  type Scenario = 'approved' | 'face_declined' | 'in_review' | 'in_progress' | 'expired';
  let didit: ReturnType<typeof Bun.serve>;
  let diditServer: Server;
  let url = '';
  let nextScenario: Scenario = 'approved';
  let nextDocNumber = 'A00000001';
  const sessions = new Map<string, { vendor: string; scenario: Scenario; doc: string; callback?: string }>();

  beforeAll(async () => {
    didit = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.headers.get('x-api-key') !== 'didit-key') return Response.json({ detail: 'bad key' }, { status: 403 });
        const path = new URL(req.url).pathname;
        if (req.method === 'POST' && path === '/v3/session/') {
          const body = await req.json() as { workflow_id: string; vendor_data: string; callback?: string };
          if (body.workflow_id !== 'wf-1') return Response.json({ detail: 'bad workflow' }, { status: 400 });
          const id = crypto.randomUUID();
          sessions.set(id, { vendor: body.vendor_data, scenario: nextScenario, doc: nextDocNumber, callback: body.callback });
          return Response.json({ session_id: id, url: `https://verify.didit.me/session/${id.slice(0, 12)}`, status: 'Not Started' }, { status: 201 });
        }
        const m = path.match(/^\/v3\/session\/([0-9a-f-]{36})\/decision\/$/);
        if (req.method === 'GET' && m && sessions.has(m[1])) {
          const s = sessions.get(m[1])!;
          const status = { approved: 'Approved', face_declined: 'Declined', in_review: 'In Review', in_progress: 'In Progress', expired: 'Expired' }[s.scenario];
          return Response.json({
            status, vendor_data: s.vendor,
            id_verifications: [{ status: 'Approved', document_type: 'Identity Card', document_number: s.doc, issuing_state: 'NGA', full_name: 'Ada Lovelace' }],
            liveness_checks: [{ status: 'Approved', score: 92 }],
            face_matches: [{ status: s.scenario === 'face_declined' ? 'Declined' : 'Approved', score: s.scenario === 'face_declined' ? 21 : 95 }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const app = express();
    app.use(express.json({ limit: '6mb' }));
    mountVerification(app, {
      rpcUrl: RPC, chain: foundry, escrowAddress: escrow, verifierPrivateKey: VERIFIER_KEY,
      dojahBaseUrl: 'http://127.0.0.1:1', ninPepper: 'test-pepper', dataFile: `${dataFile}.didit`, threshold: 90,
      diditApiKey: 'didit-key', diditWorkflowId: 'wf-1', diditBaseUrl: `http://127.0.0.1:${didit.port}`,
      appOrigins: ['http://localhost:5175'],
    });
    ({ server: diditServer, url } = await listen(app));
  });
  afterAll(() => { diditServer?.close(); didit?.stop(true); });

  async function start(account: PrivateKeyAccount, opts: { scenario?: Scenario; doc?: string; signer?: PrivateKeyAccount; returnTo?: string } = {}) {
    nextScenario = opts.scenario ?? 'approved';
    nextDocNumber = opts.doc ?? `A${Math.floor(Math.random() * 1e8)}`;
    const ch = await (await fetch(`${url}/api/verify/challenge?address=${account.address}`)).json() as { nonce: string; message: string };
    const signature = await (opts.signer ?? account).signMessage({ message: ch.message });
    const res = await fetch(`${url}/api/verify/didit/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address, nonce: ch.nonce, signature, returnTo: opts.returnTo ?? 'http://localhost:5175' }),
    });
    return { status: res.status, body: await res.json() as { ok: boolean; code?: string; url?: string; sessionId?: string; alreadyVerified?: boolean } };
  }
  const complete = async (sessionId: string) => {
    const res = await fetch(`${url}/api/verify/didit/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    return { status: res.status, body: await res.json() as { ok: boolean; code?: string; error?: string; txHash?: string } };
  };

  test('reports Didit as the active provider', async () => {
    expect(await (await fetch(`${url}/api/verify/config`)).json()).toEqual({ provider: 'didit', onchain: true, sandbox: false });
  });

  test('approved session verifies the landlord onchain', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const s = await start(a, { doc: 'NGA-111' });
    expect(s.status).toBe(200);
    expect(s.body.url).toContain('verify.didit.me');
    expect(sessions.get(s.body.sessionId!)?.callback).toBe('http://localhost:5175/landlord');
    const c = await complete(s.body.sessionId!);
    expect(c.status).toBe(200);
    expect(c.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await verifiedAt(a.address)).toBeGreaterThan(0n);
    // a verified account isn't sent through Didit again
    expect((await start(a)).body.alreadyVerified).toBe(true);
  });

  test('the same ID document cannot verify a second account', async () => {
    const b = privateKeyToAccount(generatePrivateKey());
    const s = await start(b, { doc: 'NGA-111' });
    const c = await complete(s.body.sessionId!);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe('nin_in_use');
    expect(await verifiedAt(b.address)).toBe(0n);
  });

  test('a failed face match is declined and nothing is written', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const c = await complete((await start(a, { scenario: 'face_declined' })).body.sessionId!);
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('declined');
    expect(c.body.error).toContain('matching your face');
    expect(await verifiedAt(a.address)).toBe(0n);
  });

  test('manual review, unfinished and expired sessions are reported, not approved', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    expect((await complete((await start(a, { scenario: 'in_review' })).body.sessionId!)).status).toBe(202);
    const b = privateKeyToAccount(generatePrivateKey());
    expect((await complete((await start(b, { scenario: 'in_progress' })).body.sessionId!)).body.code).toBe('not_finished');
    const c = privateKeyToAccount(generatePrivateKey());
    expect((await complete((await start(c, { scenario: 'expired' })).body.sessionId!)).body.code).toBe('expired');
    for (const x of [a, b, c]) expect(await verifiedAt(x.address)).toBe(0n);
  });

  test('a session id we never issued is rejected', async () => {
    const c = await complete(crypto.randomUUID());
    expect(c.status).toBe(404);
    expect(c.body.code).toBe('unknown_session');
  });

  test('a foreign return URL is replaced with our own app', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const s = await start(a, { returnTo: 'https://evil.example' });
    expect(sessions.get(s.body.sessionId!)?.callback).toBe('http://localhost:5175/landlord');
  });

  test('starting a session requires a signature from the account', async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const s = await start(victim, { signer: privateKeyToAccount(generatePrivateKey()) });
    expect(s.status).toBe(401);
    expect(s.body.code).toBe('bad_signature');
  });

  test('resume collects an approved session the user never came back for', async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    await start(a);  // user verifies on Didit but the redirect never reaches us
    const r = await fetch(`${url}/api/verify/didit/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: a.address }) });
    const body = await r.json() as { ok: boolean; txHash?: string };
    expect(body.ok).toBe(true);
    expect(await verifiedAt(a.address)).toBeGreaterThan(0n);
  });

  test('resume never credits a different account', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    await start(owner);
    const r = await fetch(`${url}/api/verify/didit/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: other.address }) });
    expect((await r.json() as { code?: string }).code).toBe('none');
    expect(await verifiedAt(other.address)).toBe(0n);
  });

  test('the raw ID number is never stored', () => {
    expect(readFileSync(`${dataFile}.didit`, 'utf8')).not.toContain('NGA-111');
  });
});

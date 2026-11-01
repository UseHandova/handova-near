/**
 * Firebase SMS route: the server trusts only fresh, correctly signed Firebase phone sign-ins for our project.
 * Tokens are signed with a test RSA key standing in for Google's.
 * Run: bun test server/firebase-phone.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import express from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey as JoseKey } from 'jose';

process.env.RENTFLOW_DB = ':memory:';
process.env.SESSION_SECRET = 'test-session-secret';
delete process.env.SMS_PROVIDER;

const PROJECT = 'handova-test';
let server: Server, base = '';
let googleKey: JoseKey, otherKey: JoseKey;

async function token(over: { aud?: string; iss?: string; phone?: string | null; provider?: string; authAgoS?: number; expInS?: number; key?: JoseKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    auth_time: now - (over.authAgoS ?? 5),
    firebase: { sign_in_provider: over.provider ?? 'phone', identities: {} },
  };
  if (over.phone !== null) claims.phone_number = over.phone ?? '+2349075550303';
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(over.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(over.aud ?? PROJECT)
    .setSubject('firebase-uid-1')
    .setIssuedAt(now - 5)
    .setExpirationTime(now + (over.expInS ?? 3600))
    .sign(over.key ?? googleKey);
}
async function post(path: string, body: unknown) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  // "Google's" signing key (its public half is the JWKS the server trusts) and an unrelated key.
  const google = await generateKeyPair('RS256', { extractable: true });
  googleKey = google.privateKey;
  ({ privateKey: otherKey } = await generateKeyPair('RS256'));
  const jwk = { ...(await exportJWK(google.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const { mountPhoneAuth } = await import('./phone-auth');
  const app = express();
  app.use(express.json());
  mountPhoneAuth(app, 'whatsapp:+14155238886', null, { projectId: PROJECT, keys: createLocalJWKSet({ keys: [jwk] }) });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => server?.close());

describe('Firebase SMS sign-in', () => {
  test('the app is told SMS goes through Firebase', async () => {
    const r = await fetch(`${base}/api/phone/options`).then(x => x.json()) as Record<string, unknown>;
    expect(r).toMatchObject({ whatsapp: true, sms: 'firebase' });
    expect((await post('/api/phone/start', { phone: '0907 555 0303', channel: 'sms' })).body.code).toBe('use_firebase');
  });
  test('a fresh, signed phone sign-in proves the number', async () => {
    const r = await post('/api/phone/firebase', { idToken: await token() });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'verified', phone: '2349075550303', exists: false, phoneToken: expect.any(String), serverShare: expect.stringMatching(/^0x/) });
  });
  test('tokens for another Firebase project are refused', async () => {
    expect((await post('/api/phone/firebase', { idToken: await token({ aud: 'someone-else' }) })).status).toBe(401);
    expect((await post('/api/phone/firebase', { idToken: await token({ iss: 'https://securetoken.google.com/someone-else' }) })).status).toBe(401);
  });
  test('a token not signed by Google is refused', async () => {
    expect((await post('/api/phone/firebase', { idToken: await token({ key: otherKey }) })).status).toBe(401);
  });
  test('expired tokens and old sign-ins are refused', async () => {
    expect((await post('/api/phone/firebase', { idToken: await token({ expInS: -10 }) })).status).toBe(401);
    const old = await post('/api/phone/firebase', { idToken: await token({ authAgoS: 3600 }) });
    expect(old.status).toBe(401);
    expect(old.body.error).toContain('too long ago');
  });
  test('only phone sign-ins count, and they must carry a number', async () => {
    expect((await post('/api/phone/firebase', { idToken: await token({ provider: 'google.com' }) })).body.error).toContain('wasn\'t a phone code');
    expect((await post('/api/phone/firebase', { idToken: await token({ phone: null }) })).body.error).toContain('No phone number');
  });
  test('garbage is refused', async () => {
    expect((await post('/api/phone/firebase', { idToken: 'not-a-jwt' })).status).toBe(401);
    expect((await post('/api/phone/firebase', {})).status).toBe(401);
  });
});

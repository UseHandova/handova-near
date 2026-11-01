/** The server's safety rails, tested over HTTP with real signed requests. */
import { Account, actions, encodeSignedDelegate, JsonRpcProvider, KeyPair, teraToGas, type KeyPairString } from 'near-api-js';
import { apiPost, expect, test } from './helpers';
import { API, deploy } from './env';

async function newAccount() {
  const key = KeyPair.fromRandom('ed25519');
  const r = await apiPost('/api/accounts', { name: `guard-${Date.now().toString(36)}`, publicKey: key.getPublicKey().toString() });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return new Account(r.body.accountId, new JsonRpcProvider({ url: deploy.rpc }), key.toString() as KeyPairString);
}

async function relay(account: Account, receiverId: string, method: string, args: object, deposit = 0n) {
  const { signedDelegate } = await account.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, teraToGas('50'), deposit)] });
  return apiPost('/api/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
}

test('relayer pays only for Handova calls', async () => {
  const acc = await newAccount();
  expect((await relay(acc, 'wrap.testnet', 'near_deposit', {})).body.error).toMatch(/only for Handova/);
  expect((await relay(acc, deploy.escrow, 'set_owner', { owner: acc.accountId })).body.error).toMatch(/can't be sent gaslessly/);
  expect((await relay(acc, deploy.escrow, 'withdraw', {}, 1n)).body.error).toMatch(/can't attach NEAR/);
  expect((await relay(acc, deploy.token, 'ft_transfer_call', { receiver_id: 'thief.testnet', amount: '1', msg: '' }, 1n)).body.error).toMatch(/only go to the Handova escrow/);
  // An allowed call goes through and reaches the contract (which refuses it: nothing to withdraw).
  const ok = await relay(acc, deploy.escrow, 'withdraw', {});
  expect(ok.status).toBe(422);
  expect(ok.body.error).toMatch(/Nothing to withdraw/);
});

test('admin routes need the admin secret; faucet refuses unknown accounts; bad names refused', async () => {
  expect((await fetch(`${API}/api/near/verify-landlord`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  expect((await fetch(`${API}/api/near/keeper/run`, { method: 'POST' })).status).toBe(401);
  expect((await apiPost('/api/faucet', { accountId: `nobody-${Date.now()}.testnet` })).status).toBe(404);
  const bad = await apiPost('/api/accounts', { name: 'Bad Name!', publicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString() });
  expect(bad.status).toBe(400);
});

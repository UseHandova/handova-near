import { expect, test } from 'bun:test';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import { nep413Hash } from '../../shared/nep413';

test('NEP-413 hash matches what near-api-js signs, and rejects a changed message', async () => {
  const kp = KeyPair.fromRandom('ed25519');
  const payload = { message: 'Handova identity check', recipient: 'escrow.handova.testnet', nonce: crypto.getRandomValues(new Uint8Array(32)) };
  const signed = await new KeyPairSigner(kp).signNep413Message('ada.handova.testnet', payload);
  expect(kp.getPublicKey().verify(nep413Hash(payload), signed.signature)).toBe(true);
  expect(kp.getPublicKey().verify(nep413Hash({ ...payload, message: 'something else' }), signed.signature)).toBe(false);
  expect(kp.getPublicKey().verify(nep413Hash({ ...payload, recipient: 'evil.testnet' }), signed.signature)).toBe(false);
});

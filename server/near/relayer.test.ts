import { describe, expect, test } from 'bun:test';
import { actions, encodeSignedDelegate, KeyPair, buildDelegateAction, Signature, type SignedDelegate } from 'near-api-js';
import { checkDelegate, decodeSignedDelegate, signatureValid } from './relayer';
import { KeyPairSigner } from 'near-api-js';

const policy = { escrow: 'escrow.handova.testnet', token: 'usdc.handova.testnet' };
const key = KeyPair.fromRandom('ed25519');

function signed(receiverId: string, acts: ReturnType<typeof actions.functionCall>[]): SignedDelegate {
  const delegateAction = buildDelegateAction({
    senderId: 'mum.handova.testnet',
    receiverId,
    actions: acts,
    nonce: 1n,
    maxBlockHeight: 100n,
    publicKey: key.getPublicKey(),
  });
  // Signature content doesn't matter for the policy; the chain verifies it.
  const signature = new Signature({ keyType: 0, data: new Uint8Array(64) });
  return { delegateAction, signature } as unknown as SignedDelegate;
}

const roundTrip = (sd: SignedDelegate) => decodeSignedDelegate(Buffer.from(encodeSignedDelegate(sd)).toString('base64'));
const call = (m: string, args: object = {}, deposit = 0n) => actions.functionCall(m, args, 100_000_000_000_000n, deposit);

describe('relayer policy', () => {
  test('allows escrow calls and payments into the escrow', () => {
    expect(checkDelegate(roundTrip(signed(policy.escrow, [call('confirm_move_in', { lease_id: 1 })])), policy).methods).toEqual(['confirm_move_in']);
    const pay = call('ft_transfer_call', { receiver_id: policy.escrow, amount: '1', msg: '{"listing_id":1}' }, 1n);
    expect(checkDelegate(roundTrip(signed(policy.token, [pay])), policy).senderId).toBe('mum.handova.testnet');
  });

  test('refuses other contracts', () => {
    expect(() => checkDelegate(roundTrip(signed('wrap.testnet', [call('near_deposit')])), policy)).toThrow(/only for Handova/);
  });

  test('refuses token transfers that are not payments into the escrow', () => {
    const steal = call('ft_transfer_call', { receiver_id: 'thief.testnet', amount: '1', msg: '' }, 1n);
    expect(() => checkDelegate(roundTrip(signed(policy.token, [steal])), policy)).toThrow(/only go to the Handova escrow/);
    expect(() => checkDelegate(roundTrip(signed(policy.token, [call('ft_transfer', { receiver_id: 'x' }, 1n)])), policy)).toThrow();
  });

  test('refuses unknown escrow methods and deposits', () => {
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [call('set_owner', { owner: 'x' })])), policy)).toThrow(/can't be sent gaslessly/);
    expect(checkDelegate(roundTrip(signed(policy.escrow, [call('resolve_dispute', { lease_id: 1, landlord_amount: '0' })])), policy).methods).toEqual(['resolve_dispute']);
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [call('withdraw', {}, 5n)])), policy)).toThrow(/can't attach NEAR/);
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [call('nft_transfer', { receiver_id: 'a', token_id: '1' }, 1n)])), policy)).toThrow(/can't be sent gaslessly/);
  });

  test('verifies the delegate signature offline', async () => {
    const delegateAction = buildDelegateAction({
      senderId: 'mum.handova.testnet', receiverId: policy.escrow, actions: [call('withdraw')], nonce: 1n, maxBlockHeight: 100n, publicKey: key.getPublicKey(),
    });
    const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(delegateAction);
    const real = roundTrip(signedDelegate);
    expect(signatureValid(real)).toEqual({ ok: true, publicKey: key.getPublicKey().toString() });
    expect(signatureValid(roundTrip(signed(policy.escrow, [call('withdraw')]))).ok).toBe(false); // zero signature
    const tampered: any = roundTrip(signedDelegate);
    tampered.delegateAction.senderId = 'someone-else.testnet';
    expect(signatureValid(tampered).ok).toBe(false);
  });

  test('refuses more gas than one transaction allows', () => {
    const big = actions.functionCall('withdraw', {}, 200_000_000_000_000n, 0n);
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [big, big])), policy)).toThrow(/Too much gas/);
  });

  test('refuses non-call actions', () => {
    const sd = signed(policy.escrow, [actions.transfer(1n) as any]);
    expect(() => checkDelegate(roundTrip(sd), policy)).toThrow(/Only contract calls/);
  });
});

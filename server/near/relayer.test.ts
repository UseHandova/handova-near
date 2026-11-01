import { describe, expect, test } from 'bun:test';
import { actions, encodeSignedDelegate, KeyPair, buildDelegateAction, Signature, type SignedDelegate } from 'near-api-js';
import { checkDelegate, decodeSignedDelegate } from './relayer';

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
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [call('withdraw', {}, 5n)])), policy)).toThrow(/can't attach NEAR/);
    expect(() => checkDelegate(roundTrip(signed(policy.escrow, [call('nft_transfer', { receiver_id: 'a', token_id: '1' }, 1n)])), policy)).toThrow(/can't be sent gaslessly/);
  });

  test('refuses non-call actions', () => {
    const sd = signed(policy.escrow, [actions.transfer(1n) as any]);
    expect(() => checkDelegate(roundTrip(sd), policy)).toThrow(/Only contract calls/);
  });
});

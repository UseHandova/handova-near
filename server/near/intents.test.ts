import { expect, test } from 'bun:test';
import { DESTINATION_ASSET, isPayoutDeposit, payoutRequest, quoteRequest, rememberPayoutDeposit } from './intents';

test('quotes deliver exact USDC on NEAR to the payer, refunds on the origin chain', () => {
  const q = quoteRequest({ originAsset: 'nep141:base-0x8335.omft.near', amountOut: '1350000000', recipient: 'nurse.handova.near', refundTo: '0xabc', dry: true }, 0);
  expect(q).toMatchObject({
    dry: true,
    swapType: 'EXACT_OUTPUT',
    destinationAsset: DESTINATION_ASSET,
    amount: '1350000000',
    recipient: 'nurse.handova.near',
    recipientType: 'DESTINATION_CHAIN',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(3_600_000).toISOString(),
  });
  expect(q).not.toHaveProperty('customRecipientMsg');
});

test('cash-out quote: exact USDC in from NEAR, delivered on the chosen chain, refunds to the NEAR account', () => {
  const r = payoutRequest({ amountIn: '1483680000', destinationAsset: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', recipient: 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G', refundTo: 'ade.handova.near', dry: true }, 0);
  expect(r).toMatchObject({ swapType: 'EXACT_INPUT', originAsset: DESTINATION_ASSET, amount: '1483680000', refundType: 'ORIGIN_CHAIN', refundTo: 'ade.handova.near', recipientType: 'DESTINATION_CHAIN', dry: true });
  rememberPayoutDeposit('ade.handova.near', 'abc123deposit', 0);
  expect(isPayoutDeposit('ade.handova.near', 'abc123deposit', 1000)).toBe(true);
  expect(isPayoutDeposit('someone-else.near', 'abc123deposit', 1000)).toBe(false);
  expect(isPayoutDeposit('ade.handova.near', 'abc123deposit', 2 * 60 * 60_000)).toBe(false); // expired
});

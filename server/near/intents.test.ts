import { expect, test } from 'bun:test';
import { DESTINATION_ASSET, quoteRequest } from './intents';

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

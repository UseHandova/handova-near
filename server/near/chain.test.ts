import { describe, expect, test } from 'bun:test';
import { firstAvailable, rpcUnavailable } from './chain';

const rateLimited = Object.assign(new Error('{"error":{"code":-429,"message":"Rate limits exceeded"}}'), { cause: 429 });

describe('sending through several RPCs', () => {
  test('a rate-limited RPC hands over to the next one', async () => {
    const tried: string[] = [];
    const out = await firstAvailable([
      async () => { tried.push('a'); throw rateLimited; },
      async () => { tried.push('b'); return 'sent'; },
    ]);
    expect(out).toBe('sent');
    expect(tried).toEqual(['a', 'b']);
  });

  test('an RPC that never answers is left behind', async () => {
    const out = await firstAvailable([() => new Promise<string>(() => {}), async () => 'sent'], 10);
    expect(out).toBe('sent');
  });

  test('a real answer stops the search, so nonce retries and balance errors survive', async () => {
    const nonce = new Error('Transaction nonce 5 must be larger than nonce of the used access key 7');
    let later = false;
    await expect(firstAvailable([async () => { throw nonce; }, async () => { later = true; return 'sent'; }])).rejects.toBe(nonce);
    expect(later).toBe(false);
  });

  test('when every RPC is busy the last error comes back', async () => {
    await expect(firstAvailable([async () => { throw rateLimited; }, async () => { throw new Error('fetch failed'); }])).rejects.toThrow('fetch failed');
  });

  test('"no such account" is a real answer, not a busy RPC', () => {
    expect(rpcUnavailable(new Error('Account tolu.handova.testnet does not exist at block height 5'))).toBe(false);
  });

  test('tells a busy RPC from a real answer', () => {
    for (const m of ['Exceeded 2 attempts for https://x.', 'Rate limits exceeded', 'Timeout error', 'https://x Bad Gateway', 'https://x unavailable', 'Internal server error', 'fetch failed', 'Unable to connect']) {
      expect(rpcUnavailable(new Error(m))).toBe(true);
    }
    for (const m of ['Transaction nonce 5 must be larger', 'Sender does not have enough balance', 'Smart contract panicked: no']) {
      expect(rpcUnavailable(new Error(m))).toBe(false);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { firstAvailable, rpcUnavailable } from './chain';
import { timedFetch } from '../../shared/timed-fetch';

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

  test('a request cut off by our own time limit hands over to the next RPC', async () => {
    const cut = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    expect(await firstAvailable([async () => { throw cut; }, async () => 'sent'])).toBe('sent');
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
    for (const m of ['Exceeded 2 attempts for https://x.', 'Rate limits exceeded', 'Timeout error', 'https://x Bad Gateway', 'https://x unavailable', 'Internal server error', 'fetch failed', 'Unable to connect', 'The operation timed out.']) {
      expect(rpcUnavailable(new Error(m))).toBe(true);
    }
    for (const m of ['Transaction nonce 5 must be larger', 'Sender does not have enough balance', 'Smart contract panicked: no']) {
      expect(rpcUnavailable(new Error(m))).toBe(false);
    }
  });
});

describe('RPC calls always end', () => {
  test('a request the network never answers is cut off', async () => {
    const hangs = ((_: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    const started = Date.now();
    await expect(timedFetch(hangs, 50)('https://rpc.example')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('the limit can apply to some addresses only, so uploads elsewhere are never cut off', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const record = (async (_: unknown, init?: RequestInit) => { seen.push(init?.signal ?? undefined); return new Response('{}'); }) as typeof fetch;
    const f = timedFetch(record, 50, (url) => url.startsWith('https://rpc.'));
    await f('https://rpc.example/');
    await f('https://handova.example/api/media', { method: 'POST' });
    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBeUndefined();
  });

  test('a caller that sets its own limit keeps it', async () => {
    let seen: AbortSignal | undefined;
    const own = AbortSignal.timeout(5_000);
    await timedFetch((async (_: unknown, init?: RequestInit) => { seen = init?.signal ?? undefined; return new Response('{}'); }) as typeof fetch, 50)('https://rpc.example', { signal: own });
    expect(seen).toBe(own);
  });
});

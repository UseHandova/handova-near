/**
 * Same-origin JSON-RPC proxy for the web app. Free public NEAR RPCs throttle busy clients and drop
 * CORS headers when they do, so the browser talks to us and we fail over across several providers,
 * caching contract view calls for a moment.
 */
import type { Express } from 'express';
import { deploy, env } from './config';
import { RateLimit } from './rate-limit';

const PROVIDERS: Record<string, string[]> = {
  testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs'],
  mainnet: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org', 'https://near.drpc.org'],
};
export const rpcUrls = [deploy.rpc, ...(env('NEAR_RPC_FALLBACKS')?.split(',') ?? PROVIDERS[deploy.network] ?? [])].filter((u, i, a) => a.indexOf(u) === i);

/** Reads, plus sending signed transactions (device accounts sign in the browser). */
const METHODS = new Set(['query', 'block', 'status', 'gas_price', 'chunk', 'tx', 'EXPERIMENTAL_tx_status', 'EXPERIMENTAL_protocol_config', 'send_tx', 'broadcast_tx_commit', 'broadcast_tx_async', 'validators']);
const CACHE_MS = 1500;
const cache = new Map<string, { at: number; body: string }>();
let preferred = 0;

/** Contract views and account views are safe to cache briefly; access-key nonces are not. */
function cacheable(req: any): boolean {
  return req.method === 'query' && ['call_function', 'view_account'].includes(req.params?.request_type);
}

export async function forward(raw: string): Promise<{ status: number; body: string }> {
  for (let i = 0; i < rpcUrls.length; i++) {
    const idx = (preferred + i) % rpcUrls.length;
    try {
      const r = await fetch(rpcUrls[idx], { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw, signal: AbortSignal.timeout(15_000) });
      const body = await r.text();
      // JSON-RPC errors (unknown account, contract panics) come back as 200 and are real answers;
      // a rate limit is not, even when it arrives as a 200.
      if (r.ok && body.startsWith('{') && !/"code":\s*-429/.test(body)) {
        preferred = idx;
        return { status: 200, body };
      }
    } catch { /* try the next provider */ }
  }
  return { status: 502, body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'All NEAR RPC providers are busy. Try again in a moment.' } }) };
}

const perIp = new RateLimit(1200, 60_000);

export function mountRpc(app: Express) {
  app.post('/api/rpc', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !METHODS.has(body.method)) {
      return res.status(400).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: 'Method not allowed through this proxy' } });
    }
    if (!perIp.take(req.ip ?? 'ip')) return res.status(429).json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Too many requests' } });
    const raw = JSON.stringify(body);
    const key = cacheable(body) ? JSON.stringify({ m: body.method, p: body.params }) : '';
    const hit = key && cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      // Same answer, the caller's own request id.
      return res.type('json').send(hit.body.replace(/"id":\s*("[^"]*"|\d+|null)/, `"id":${JSON.stringify(body.id)}`));
    }
    const out = await forward(raw);
    if (key && out.status === 200) {
      cache.set(key, { at: Date.now(), body: out.body });
      if (cache.size > 5000) cache.clear();
    }
    res.status(out.status).type('json').send(out.body);
  });
}

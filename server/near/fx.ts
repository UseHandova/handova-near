/** USD → NGN rate for showing USDC prices in Naira. Display only; amounts on-chain are USDC. */
import type { Express } from 'express';
import { env } from './config';

const FALLBACK = Number(env('USDC_TO_NGN') ?? 1600);
let cache: { at: number; rate: number; source: string } | null = null;

export async function usdToNgn(): Promise<{ rate: number; source: string; at: number }> {
  if (cache && Date.now() - cache.at < 60 * 60_000) return cache;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
    const d: any = await r.json();
    const rate = Number(d?.rates?.NGN);
    if (!rate || rate < 100) throw new Error('bad rate');
    cache = { at: Date.now(), rate: Math.round(rate), source: 'open.er-api.com' };
  } catch {
    cache = { at: Date.now(), rate: FALLBACK, source: 'fallback' };
  }
  return cache;
}

export function mountFx(app: Express) {
  app.get('/api/fx', async (_req, res) => res.json(await usdToNgn()));
}

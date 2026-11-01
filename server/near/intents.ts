/**
 * Pay from any chain with NEAR Intents (1Click API).
 *
 * 1. Quote: "deliver exactly X USDC to <payer>.handova.near; I'll pay in USDC on Base".
 * 2. The payer sends the quoted amount to the deposit address from any wallet on that chain.
 * 3. 1Click swaps/bridges and delivers USDC to the payer's NEAR account.
 * 4. The app pays the escrow from that account with a gasless `ft_transfer_call`.
 *
 * Two steps on purpose: 1Click's `customRecipientMsg` (deliver straight into ft_transfer_call)
 * is marked "highly experimental" and loses funds on any mistake.
 *
 * NEAR Intents is mainnet-only. On testnet, quotes are always `dry` (a real price, no deposit
 * address) so the screen can be tried without moving money.
 */
import type { Express } from 'express';
import { env, MAINNET_USDC, NETWORK } from './config';
import { RateLimit } from './rate-limit';

const BASE = env('ONECLICK_API_URL') ?? 'https://1click.chaindefuser.com';
export const DESTINATION_ASSET = `nep141:${MAINNET_USDC}`;

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
}

async function oneClick<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const jwt = env('ONECLICK_JWT');
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as any) } });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.message ?? `1Click ${r.status}`), { status: r.status });
  return body as T;
}

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null;

/** Stablecoins people can pay with (USDC/USDT on every chain 1Click supports). */
export async function payableTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60_000) return tokenCache.tokens;
  const all = await oneClick<OneClickToken[]>('/v0/tokens');
  const tokens = all
    .filter((t) => (t.symbol === 'USDC' || t.symbol === 'USDT') && t.assetId !== DESTINATION_ASSET)
    .sort((a, b) => a.blockchain.localeCompare(b.blockchain) || a.symbol.localeCompare(b.symbol));
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export interface QuoteInput {
  originAsset: string;
  /** USDC base units to deliver on NEAR (rent + caution). */
  amountOut: string;
  /** NEAR account that receives the USDC (the payer's Handova account). */
  recipient: string;
  /** Payer's address on the origin chain, for refunds if the swap fails. */
  refundTo: string;
  dry: boolean;
}

export function quoteRequest(q: QuoteInput, now = Date.now()) {
  return {
    dry: q.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: q.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: DESTINATION_ASSET,
    amount: q.amountOut,
    refundTo: q.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: q.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now + 60 * 60_000).toISOString(),
    referral: 'handova',
    quoteWaitingTimeMs: 3000,
  };
}

const quotesPerIp = new RateLimit(60, 60 * 60_000);

export function mountIntents(app: Express) {
  app.get('/api/intents/tokens', async (_req, res) => {
    try {
      res.json({ network: NETWORK, live: NETWORK === 'mainnet', tokens: await payableTokens() });
    } catch {
      res.status(502).json({ error: 'Could not load the list of coins. Try again in a minute.' });
    }
  });

  app.post('/api/intents/quote', async (req, res) => {
    const b = req.body ?? {};
    if (!/^\d+$/.test(String(b.amountOut ?? '')) || BigInt(b.amountOut) <= 0n) return res.status(400).json({ error: 'amountOut must be USDC base units' });
    for (const k of ['originAsset', 'recipient', 'refundTo']) {
      if (!b[k]) return res.status(400).json({ error: `Missing ${k}` });
    }
    if (!quotesPerIp.take(req.ip ?? 'ip')) return res.status(429).json({ error: 'Too many quotes. Wait a few minutes.' });
    // Real deposit addresses only on mainnet; on testnet the recipient can't exist on mainnet anyway.
    const live = NETWORK === 'mainnet' && b.dry === false;
    try {
      const quote = await oneClick<any>('/v0/quote', {
        method: 'POST',
        body: JSON.stringify(quoteRequest({ ...b, dry: !live, recipient: live ? b.recipient : 'wrap.near' })),
      });
      res.json({ live, ...quote });
    } catch (e) {
      const msg = (e as Error).message;
      const status = (e as any).status as number | undefined;
      if (status && status < 500) return res.status(400).json({ error: `No quote: ${msg}. Check the refund address matches the chain you pay from.` });
      res.status(502).json({ error: 'NEAR Intents is not answering right now. Try again in a minute.' });
    }
  });

  app.get('/api/intents/status', async (req, res) => {
    const depositAddress = String(req.query.depositAddress ?? '');
    if (!depositAddress) return res.status(400).json({ error: 'Missing depositAddress' });
    const memo = req.query.depositMemo ? `&depositMemo=${encodeURIComponent(String(req.query.depositMemo))}` : '';
    try {
      res.json(await oneClick(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}${memo}`));
    } catch (e) {
      res.status((e as any).status === 404 ? 404 : 502).json({ error: 'No payment seen at this address yet.' });
    }
  });

  /** Optional: tell 1Click the deposit tx hash so it starts sooner. */
  app.post('/api/intents/submit', async (req, res) => {
    const { txHash, depositAddress } = req.body ?? {};
    if (!txHash || !depositAddress) return res.status(400).json({ error: 'Missing txHash or depositAddress' });
    try {
      res.json(await oneClick('/v0/deposit/submit', { method: 'POST', body: JSON.stringify({ txHash, depositAddress }) }));
    } catch (e) {
      res.status(502).json({ error: `1Click did not accept the transaction hash: ${(e as Error).message}` });
    }
  });
}

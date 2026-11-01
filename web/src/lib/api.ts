/** Calls to the Handova API (same origin; Vite proxies /api in dev). */
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}). Try again.`);
  return j as T;
}

export interface NearConfig {
  network: 'testnet' | 'mainnet';
  rpc: string;
  explorer: string;
  escrow: string;
  token: string;
  tokenDecimals: number;
  tokenOpenMint: boolean;
  accountParent: string;
  gasless: boolean;
  accountCreation: boolean;
  ai: boolean;
  intentsLive: boolean;
}

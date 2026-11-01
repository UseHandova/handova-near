/** Read-only chain access for the web app. */
import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import type { NearConfig } from './api';
import type { EscrowConfig, Lease, Listing } from './types';

let provider: FailoverRpcProvider | null = null;

/** Browser-safe (CORS) fallbacks in case the main RPC rate-limits. */
const FALLBACK: Record<string, string[]> = {
  testnet: ['https://rpc.testnet.fastnear.com'],
  mainnet: ['https://free.rpc.fastnear.com'],
};
let cfg: NearConfig | null = null;

export function initNear(c: NearConfig) {
  cfg = c;
  const urls = [c.rpc, ...(FALLBACK[c.network] ?? [])].filter((u, i, a) => a.indexOf(u) === i);
  provider = new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 2, wait: 500 })));
}

export function getProvider(): FailoverRpcProvider {
  if (!provider) throw new Error('NEAR not initialised');
  return provider;
}

export function nearConfig(): NearConfig {
  if (!cfg) throw new Error('NEAR not initialised');
  return cfg;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await getProvider().callFunction({ contractId, method, args })) as T;
}

const escrow = <T>(method: string, args: Record<string, unknown> = {}) => view<T>(nearConfig().escrow, method, args);

export const chain = {
  config: () => escrow<EscrowConfig>('get_config'),
  listings: (onlyOpen = false) => escrow<Listing[]>('get_listings', { from_index: 0, limit: 100, only_open: onlyOpen }),
  listing: (id: number) => escrow<Listing | null>('get_listing', { listing_id: id }),
  lease: (id: number) => escrow<Lease | null>('get_lease', { lease_id: id }),
  /** Every lease, paged in hundreds. */
  allLeases: async () => {
    const out: Lease[] = [];
    for (let from = 0; ; from += 100) {
      const page = await escrow<Lease[]>('get_leases', { from_index: from, limit: 100 });
      out.push(...page);
      if (page.length < 100) return out;
    }
  },
  leasesFor: (accountId: string) => escrow<Lease[]>('get_leases_for', { account_id: accountId }),
  balance: async (accountId: string) => BigInt(await escrow<string>('balance_of', { account_id: accountId })),
  nftToken: (id: number) => escrow<{ token_id: string; owner_id: string; metadata: { title: string; description: string; media: string; extra: string } } | null>('nft_token', { token_id: String(id) }),
  usdcBalance: async (accountId: string) => BigInt((await view<string>(nearConfig().token, 'ft_balance_of', { account_id: accountId })) ?? '0'),
};

export const txUrl = (hash: string) => `${nearConfig().explorer}/txns/${hash}`;
export const accountUrl = (id: string) => `${nearConfig().explorer}/address/${id}`;

export function shortAccount(id: string): string {
  if (id.length > 40) return `${id.slice(0, 6)}…${id.slice(-6)}`;
  return id;
}

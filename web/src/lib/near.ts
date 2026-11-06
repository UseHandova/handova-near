/** Read-only chain access for the web app. */
import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import { API_BASE, type NearConfig } from './api';
import type { EscrowConfig, Lease, Listing, RentalRecord } from './types';

let provider: FailoverRpcProvider | null = null;

/** Browser-safe (CORS) fallbacks in case the main RPC rate-limits. */
const FALLBACK: Record<string, string[]> = {
  testnet: ['https://rpc.testnet.fastnear.com'],
  mainnet: ['https://free.rpc.fastnear.com'],
};
let cfg: NearConfig | null = null;

export function initNear(c: NearConfig) {
  cfg = c;
  // Our own /api/rpc first (fails over across providers server-side), then direct public RPCs.
  const proxy = new URL(`${API_BASE}/api/rpc`, location.origin).toString();
  const urls = [proxy, c.rpc, ...(FALLBACK[c.network] ?? [])].filter((u, i, a) => a.indexOf(u) === i);
  provider = new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 2, wait: 500 })));
}

let signing: FailoverRpcProvider | null = null;

/** Reads fail over; transactions go to one RPC so their real errors (and nonce retries) survive. */
export function getSigningProvider(): FailoverRpcProvider {
  if (!signing) {
    const reads = getProvider();
    const primary = new JsonRpcProvider({ url: new URL(`${API_BASE}/api/rpc`, location.origin).toString() }, { retries: 3, backoff: 2, wait: 500 });
    signing = new Proxy(reads, {
      get(target, prop, receiver) {
        if (prop === 'sendTransactionUntil' || prop === 'sendTransaction' || prop === 'sendTransactionAsync') {
          const fn = (primary as any)[prop];
          return typeof fn === 'function' ? fn.bind(primary) : fn;
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as FailoverRpcProvider;
  }
  return signing;
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

/** A NEAR amount in yocto, as "0.06 NEAR". */
export const nearAmount = (yocto: string | bigint) => `${(Number(BigInt(yocto) / 10n ** 18n) / 1e6).toFixed(2)} NEAR`;

export const chain = {
  config: () => escrow<EscrowConfig>('get_config'),
  listings: (onlyOpen = false) => escrow<Listing[]>('get_listings', { from_index: 0, limit: 100, only_open: onlyOpen }),
  listing: (id: number) => escrow<Listing | null>('get_listing', { listing_id: id }),
  lease: (id: number) => escrow<Lease | null>('get_lease', { lease_id: id }),
  /** Every lease not yet closed or cancelled, paged in hundreds. */
  openLeases: async () => {
    const out: Lease[] = [];
    for (let from = 0; ; from += 100) {
      const page = await escrow<Lease[]>('get_open_leases', { from_index: from, limit: 100 });
      out.push(...page);
      if (page.length < 100) return out;
    }
  },
  leasesFor: (accountId: string) => escrow<Lease[]>('get_leases_for', { account_id: accountId }),
  passport: (accountId: string) => escrow<RentalRecord>('rental_record', { account_id: accountId }),
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

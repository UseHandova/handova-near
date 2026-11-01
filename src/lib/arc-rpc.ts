/**
 * How we reach Arc (testnet or mainnet, per src/lib/network.ts): Arc's official endpoints with automatic failover, so one busy or blocking endpoint
 * can't take the app down. (The old rpc.testnet.arc.network host — viem's built-in default — started refusing
 * this machine with a Cloudflare 403, which surfaced as "bad signature" sign-in errors and CORS failures.)
 * Shared by the browser (src/lib/chain.ts, savings) and the server (server/auth.ts, verification).
 * List: https://docs.arc.io/arc/references/connect-to-arc
 */

import { fallback, http, type Transport } from 'viem';
import { ARC_RPCS } from './network';

/** Endpoints for the network in use (testnet or mainnet — see src/lib/network.ts). */
export const ARC_TESTNET_RPCS = ARC_RPCS; // kept name for existing imports

/** One URL (a local chain in tests, or your own node) — otherwise Arc's official endpoints with failover. */
export function arcTransport(url?: string): Transport {
  if (url) return http(url, { retryCount: 3 });
  return fallback(ARC_RPCS.map(u => http(u, { retryCount: 1, timeout: 10_000 })), { retryCount: 2 });
}

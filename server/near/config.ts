/**
 * Network settings: contract IDs come from deploy/<network>.json, secrets from env.
 * Nothing network-specific is hardcoded elsewhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Network = 'testnet' | 'mainnet';

export interface Deploy {
  network: Network;
  rpc: string;
  explorer: string;
  escrow: string;
  token: string;
  tokenDecimals: number;
  /** Test token anyone can mint (testnet only). */
  tokenOpenMint: boolean;
  /** New user accounts are created as `<name>.<accountParent>`. */
  accountParent: string;
  verifier: string;
  arbiter: string;
}

export const NETWORK: Network = process.env.NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

/** deploy/<network>.local.json (your own copy, from scripts/setup-testnet.sh) wins over the shared one. */
export function loadDeploy(network: Network = NETWORK): Deploy {
  const dir = join(import.meta.dir, '..', '..', 'deploy');
  const local = join(dir, `${network}.local.json`);
  const file = env('NEAR_DEPLOY_FILE') ?? (existsSync(local) ? local : join(dir, `${network}.json`));
  const d = JSON.parse(readFileSync(file, 'utf8')) as Deploy;
  return { ...d, rpc: process.env.NEAR_RPC_URL || d.rpc };
}

export const deploy = loadDeploy();

/** Mainnet USDC (Circle) — the asset NEAR Intents delivers. Checked against 1Click /v0/tokens. */
export const MAINNET_USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

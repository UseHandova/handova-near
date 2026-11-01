/** The e2e deployment (deploy/testnet.e2e.json) and its server keys (.env.e2e), read in Node. */
import { readFileSync } from 'node:fs';

export const deploy = JSON.parse(readFileSync('deploy/testnet.e2e.json', 'utf8')) as {
  rpc: string; explorer: string; escrow: string; token: string; accountParent: string;
};

export const secrets: Record<string, string> = Object.fromEntries(
  readFileSync('.env.e2e', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

export const API = 'http://localhost:3099';
export const STATE_FILE = 'test-results/e2e-state.json';

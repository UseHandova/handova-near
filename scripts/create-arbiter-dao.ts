/**
 * Create a Sputnik DAO (sputnikv2.testnet) as the escrow's arbiter and hand it the role.
 *
 *   bun run scripts/create-arbiter-dao.ts --council a.testnet,b.testnet,c.testnet --threshold 2 [--name handova-arbiter]
 *
 * Signs with CREATOR_* (the escrow owner in our deployments). Costs ~6 testnet NEAR for the DAO's
 * storage. Rulings then need `threshold` council votes; the DAO itself calls the escrow.
 * Writes the new arbiter into the deploy file in use.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { nearToYocto, teraToGas } from 'near-api-js';
import { creator, view } from '../server/near/chain';
import { deploy, env, NETWORK } from '../server/near/config';

const FACTORY = env('SPUTNIK_FACTORY') ?? (NETWORK === 'mainnet' ? 'sputnik-dao.near' : 'sputnikv2.testnet');
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const council = (arg('council') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const threshold = Number(arg('threshold', String(Math.floor(council.length / 2) + 1)));
const name = arg('name', `handova-arbiter-${Date.now().toString(36).slice(-4)}`)!;
if (!creator) throw new Error('CREATOR_ACCOUNT_ID / CREATOR_PRIVATE_KEY are not set');
if (council.length === 0) throw new Error('Pass --council a,b,c');
if (threshold < 1 || threshold > council.length) throw new Error('threshold must be between 1 and the council size');

const policy = {
  roles: [{ name: 'council', kind: { Group: council }, permissions: ['*:*'], vote_policy: {} }],
  default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: String(threshold) },
  proposal_bond: nearToYocto('0.1').toString(),
  proposal_period: (7n * 24n * 3600n * 1_000_000_000n).toString(),
  bounty_bond: nearToYocto('0.1').toString(),
  bounty_forgiveness_period: (24n * 3600n * 1_000_000_000n).toString(),
};
const args = { config: { name, purpose: 'Handova dispute arbiter: rules on disputed handovers and caution fees', metadata: '' }, policy };

console.log(`Creating ${name}.${FACTORY} — council ${council.join(', ')}, ${threshold} vote(s) to pass`);
await creator.callFunction({
  contractId: FACTORY,
  methodName: 'create',
  args: { name, args: Buffer.from(JSON.stringify(args)).toString('base64') },
  deposit: nearToYocto('6'),
  gas: teraToGas('300'),
});
const dao = `${name}.${FACTORY}`;
const p = await view<any>(dao, 'get_policy');
console.log(`✓ ${dao} created (council: ${p.roles[0].kind.Group.join(', ')})`);

await creator.callFunction({ contractId: deploy.escrow, methodName: 'set_arbiter', args: { arbiter: dao }, gas: teraToGas('30') });
const cfg = await view<{ arbiter: string }>(deploy.escrow, 'get_config');
console.log(`✓ ${deploy.escrow} arbiter is now ${cfg.arbiter}`);

const file = env('NEAR_DEPLOY_FILE') ?? (existsSync(join('deploy', `${NETWORK}.local.json`)) ? join('deploy', `${NETWORK}.local.json`) : join('deploy', `${NETWORK}.json`));
const d = JSON.parse(readFileSync(file, 'utf8'));
d.arbiter = dao;
writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
console.log(`✓ ${file} updated`);

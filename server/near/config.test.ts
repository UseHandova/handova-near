import { expect, test } from 'bun:test';
import { loadDeploy } from './config';

test('a network with no deployment says so and what to do', () => {
  const saved = process.env.NEAR_DEPLOY_FILE;
  process.env.NEAR_DEPLOY_FILE = '/nonexistent/mainnet.json';
  try {
    expect(() => loadDeploy('mainnet')).toThrow(/No mainnet deployment.*NEAR_NETWORK=testnet/);
  } finally {
    if (saved === undefined) delete process.env.NEAR_DEPLOY_FILE;
    else process.env.NEAR_DEPLOY_FILE = saved;
  }
});

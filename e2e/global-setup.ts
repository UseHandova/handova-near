/**
 * Creates the arbiter for this run: a Handova account whose recovery phrase the tests use to sign
 * in through the "I have a recovery phrase" screen. The escrow owner then makes it the arbiter.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from 'near-api-js';
import { generateSeedPhrase } from 'near-api-js/seed-phrase';
import { API, STATE_FILE, deploy, secrets } from './env';

export default async function globalSetup() {
  const { seedPhrase, keyPair } = generateSeedPhrase();
  const name = `arbiter-${Date.now().toString(36)}`;
  const r = await fetch(`${API}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, publicKey: keyPair.getPublicKey().toString() }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`arbiter account: ${body.error}`);

  const provider = new JsonRpcProvider({ url: deploy.rpc });
  const owner = new Account(secrets.CREATOR_ACCOUNT_ID, provider, secrets.CREATOR_PRIVATE_KEY as KeyPairString);
  await owner.callFunction({ contractId: deploy.escrow, methodName: 'set_arbiter', args: { arbiter: body.accountId }, gas: teraToGas('30') });

  mkdirSync('test-results', { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ arbiter: { accountId: body.accountId, seedPhrase } }));
}

/**
 * Named accounts for people without a NEAR wallet: `ada.handova.testnet` (`ada.handova.near` on
 * mainnet). The key pair is generated on the user's device; the server only ever sees the public
 * key and adds it as the account's full-access key, so the user owns the account outright.
 *
 * The server funds a little NEAR for storage and registers the account with USDC so payouts can
 * land there. Gas for everything else is paid by the relayer.
 */
import type { Express } from 'express';
import { actions, PublicKey, nearToYocto, teraToGas } from 'near-api-js';
import { deploy, NETWORK } from './config';
import { accountExists, creator, relayer, summarize } from './chain';
import { RateLimit } from './rate-limit';

/** Covers account storage and the 1-yoctoNEAR deposits some calls need. */
const NEW_ACCOUNT_NEAR = '0.02';
/** NEP-145 storage for one USDC balance. */
const TOKEN_STORAGE_NEAR = '0.00125';
const FAUCET_AMOUNT = 2_000n * 10n ** 6n;

const NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;

export function fullAccountId(name: string): string {
  return `${name}.${deploy.accountParent}`;
}

export function validName(name: string): string | null {
  if (!NAME_RE.test(name)) return 'Use 1–32 lowercase letters, numbers, - or _, starting and ending with a letter or number.';
  if (/[-_]{2}/.test(name)) return "Don't put two - or _ next to each other.";
  return null;
}

/** Register `accountId` with the token so it can receive USDC. */
export async function registerWithToken(accountId: string) {
  if (!creator) throw new Error('No creator account configured');
  if (deploy.tokenOpenMint) {
    await creator.callFunction({ contractId: deploy.token, methodName: 'mint', args: { account_id: accountId, amount: '0' }, gas: teraToGas('30') });
  } else {
    await creator.callFunction({
      contractId: deploy.token,
      methodName: 'storage_deposit',
      args: { account_id: accountId, registration_only: true },
      deposit: nearToYocto(TOKEN_STORAGE_NEAR),
      gas: teraToGas('30'),
    });
  }
}

const createPerIp = new RateLimit(5, 60 * 60_000);
const faucetPerAccount = new RateLimit(3, 24 * 60 * 60_000);
const faucetPerIp = new RateLimit(10, 60 * 60_000);

export function mountAccounts(app: Express) {
  app.get('/api/accounts/check', async (req, res) => {
    const name = String(req.query.name ?? '').toLowerCase();
    const problem = validName(name);
    if (problem) return res.json({ available: false, reason: problem });
    const accountId = fullAccountId(name);
    const taken = await accountExists(accountId);
    res.json({ accountId, available: !taken, reason: taken ? 'That name is taken. Try another.' : undefined });
  });

  app.post('/api/accounts', async (req, res) => {
    if (!creator) return res.status(503).json({ error: 'Account creation is switched off on this server. Connect a NEAR wallet instead.' });
    const name = String(req.body?.name ?? '').toLowerCase();
    const problem = validName(name);
    if (problem) return res.status(400).json({ error: problem });
    let publicKey: PublicKey;
    try {
      publicKey = PublicKey.from(String(req.body?.publicKey ?? ''));
    } catch {
      return res.status(400).json({ error: 'The device key is not valid. Reload the page and try again.' });
    }
    if (!createPerIp.take(req.ip ?? 'ip')) return res.status(429).json({ error: 'Too many new accounts from this network. Try again in an hour.' });
    const accountId = fullAccountId(name);
    if (await accountExists(accountId)) return res.status(409).json({ error: 'That name is taken. Try another.' });

    try {
      const outcome = await creator.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.createAccount(), actions.transfer(nearToYocto(NEW_ACCOUNT_NEAR)), actions.addFullAccessKey(publicKey)],
        throwOnFailure: false,
      });
      const s = summarize(outcome);
      if (!s.ok) return res.status(422).json({ error: 'NEAR could not create the account. Try another name.', detail: s.error });
      await registerWithToken(accountId);
      res.json({ accountId, hash: s.hash, network: NETWORK });
    } catch (e) {
      res.status(502).json({ error: 'The NEAR network did not respond. Try again in a minute.', detail: (e as Error).message?.slice(0, 300) });
    }
  });

  /** Testnet only: mint test USDC so anyone can try the full flow. */
  app.post('/api/faucet', async (req, res) => {
    if (!deploy.tokenOpenMint) return res.status(404).json({ error: 'The faucet only exists on testnet.' });
    const signer = relayer ?? creator;
    if (!signer) return res.status(503).json({ error: 'The faucet is switched off on this server.' });
    const accountId = String(req.body?.accountId ?? '');
    if (!(await accountExists(accountId))) return res.status(404).json({ error: `${accountId} doesn't exist on testnet.` });
    if (!faucetPerIp.take(req.ip ?? 'ip') || !faucetPerAccount.take(accountId)) {
      return res.status(429).json({ error: 'Faucet limit reached. Try again tomorrow.' });
    }
    try {
      await signer.callFunction({
        contractId: deploy.token,
        methodName: 'mint',
        args: { account_id: accountId, amount: FAUCET_AMOUNT.toString() },
        gas: teraToGas('30'),
      });
      res.json({ accountId, amount: FAUCET_AMOUNT.toString() });
    } catch (e) {
      res.status(502).json({ error: 'Minting failed. Try again in a minute.', detail: (e as Error).message?.slice(0, 300) });
    }
  });
}

/** All NEAR routes for the Handova API. */
import type { Express } from 'express';
import { teraToGas } from 'near-api-js';
import { deploy, env, MINTBASE_MARKET, NETWORK } from './config';
import { creator, relayer, verifier } from './chain';
import { mountAccounts } from './accounts';
import { mountAi } from './ai';
import { mountFx } from './fx';
import { mountRpc } from './rpc';
import { mountIntents } from './intents';
import { mountRelayer } from './relayer';
import { runKeeperOnce } from './keeper';
import { mountVerify } from './verify';
import { mountInspect } from './inspect';

export function mountNear(app: Express) {
  /** What the web app needs to talk to the chain. Public. */
  app.get('/api/near/config', (_req, res) => {
    res.json({
      network: NETWORK,
      rpc: deploy.rpc,
      explorer: deploy.explorer,
      escrow: deploy.escrow,
      token: deploy.token,
      tokenDecimals: deploy.tokenDecimals,
      tokenOpenMint: deploy.tokenOpenMint,
      accountParent: deploy.accountParent,
      gasless: !!relayer,
      accountCreation: !!creator,
      ai: !!env('NEARAI_API_KEY'),
      idCheck: !!(env('DIDIT_API_KEY') && env('DIDIT_WORKFLOW_ID') && verifier),
      intentsLive: NETWORK === 'mainnet',
      mintbaseMarket: MINTBASE_MARKET,
      // Listings this site doesn't show on its home page (test leftovers, spam). They stay on-chain.
      hiddenListings: (env('HIDDEN_LISTINGS') ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isInteger),
    });
  });

  /**
   * Record an ID-verified landlord on-chain. Called by the identity check (Didit/Dojah) or an admin.
   * Admin-only: needs `Authorization: Bearer $ADMIN_SECRET`.
   */
  app.post('/api/near/verify-landlord', async (req, res) => {
    const secret = env('ADMIN_SECRET');
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Admin only' });
    if (!verifier) return res.status(503).json({ error: 'No verifier key configured' });
    const { accountId, verified = true } = req.body ?? {};
    try {
      const outcome = await verifier.callFunctionRaw({
        contractId: deploy.escrow,
        methodName: 'set_verified',
        args: { account_id: accountId, verified: !!verified },
        gas: teraToGas('30'),
      });
      res.json({ ok: true, hash: (outcome as any).transaction?.hash });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message.slice(0, 300) });
    }
  });

  /** Run the timeout keeper now (it also runs every 10 minutes). Admin-only. */
  app.post('/api/near/keeper/run', async (req, res) => {
    const secret = env('ADMIN_SECRET');
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Admin only' });
    const log: string[] = [];
    try {
      const done = await runKeeperOnce((l) => log.push(l));
      res.json({ done, log });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message, log });
    }
  });

  mountAccounts(app);
  mountVerify(app);
  mountInspect(app);
  mountRelayer(app);
  mountIntents(app);
  mountAi(app);
  mountFx(app);
  mountRpc(app);
}

/**
 * Handova API (NEAR edition): named accounts, gasless relayer, NEAR Intents quotes,
 * NEAR AI drafts, testnet faucet, and the timeout keeper.
 *
 *   bun run server            # reads .env; see .env.example
 *
 * The Arc-era WhatsApp bot (server/whatsapp-bot.ts) runs separately.
 */
import express from 'express';
import cors from 'cors';
import { mountMedia } from './media';
import { mountNear } from './near';
import { deploy, NETWORK } from './near/config';
import { creator, nearBalance, relayer } from './near/chain';
import { startKeeper } from './near/keeper';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.APP_ORIGINS?.split(',') ?? '*' }));
app.use(express.json({ limit: '12mb' })); // voice notes and document photos arrive as base64

mountNear(app);
mountMedia(app); // listing photos (Arc-era module, reused)

/** The value, or null if it takes longer than `ms`: health must answer even when NEAR's RPCs don't. */
const within = <T,>(ms: number, p: Promise<T | null>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

app.get('/api/health', async (_req, res) => {
  const [relayerNear, creatorNear] = await Promise.all([within(3000, nearBalance(relayer)), within(3000, nearBalance(creator))]);
  res.json({
    ok: true,
    network: NETWORK,
    escrow: deploy.escrow,
    relayer: relayer ? { account: relayer.accountId, near: relayerNear, low: relayerNear !== null && relayerNear < 0.05 } : null,
    creator: creator ? { account: creator.accountId, near: creatorNear, low: creatorNear !== null && creatorNear < 0.1 } : null,
  });
});

if (import.meta.main) {
  const server = app.listen(PORT, () => {
    console.log(`Handova API on :${PORT} — ${NETWORK}, escrow ${deploy.escrow}, relayer ${relayer?.accountId ?? 'off'}`);
    if (process.env.KEEPER !== 'off') startKeeper();
  });
  // Hosts (Railway) send SIGTERM when a new deploy replaces this one: finish open requests and exit cleanly,
  // so the swap isn't reported as a crash.
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

export { app };

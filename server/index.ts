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
import { mountNear } from './near';
import { deploy, NETWORK } from './near/config';
import { creator, relayer } from './near/chain';
import { startKeeper } from './near/keeper';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.APP_ORIGINS?.split(',') ?? '*' }));
app.use(express.json({ limit: '12mb' })); // voice notes and document photos arrive as base64

mountNear(app);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, network: NETWORK, escrow: deploy.escrow, relayer: relayer?.accountId ?? null, creator: creator?.accountId ?? null });
});

if (import.meta.main) {
  app.listen(PORT, () => {
    console.log(`Handova API on :${PORT} — ${NETWORK}, escrow ${deploy.escrow}, relayer ${relayer?.accountId ?? 'off'}`);
    if (process.env.KEEPER !== 'off') startKeeper();
  });
}

export { app };

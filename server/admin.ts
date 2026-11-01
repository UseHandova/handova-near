/**
 * Admin — the escrow's onchain arbiter, confirmed from a signed-in session (never from the browser's word).
 *   GET /api/admin/me     → { admin } for the session's address
 *   GET /api/admin/stats  → off-chain activity counts (admin only)
 */

import type { Express, Request, Response } from 'express';
import { parseAbi } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import type { FeatureConfig } from './features';

const ABI = parseAbi(['function arbiter() view returns (address)']);

/** True if `address` is the escrow's arbiter right now (read from the chain). */
export async function isArbiter(config: FeatureConfig | null, address: string) {
  if (!config) return false;
  const arbiter = await chainClient.readContract({ address: config.escrow, abi: ABI, functionName: 'arbiter' }).catch(() => null);
  return !!arbiter && arbiter.toLowerCase() === address.toLowerCase();
}

/** COUNT(*) that returns 0 when the table doesn't exist yet (feature never used on this server). */
function count(sql: string, ...args: (string | number)[]): number {
  try { return (db().query(sql).get(...args) as { n: number }).n; } catch { return 0; }
}

export function mountAdmin(app: Express, config: FeatureConfig | null) {
  app.get('/api/admin/me', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    res.json({ ok: true, admin: await isArbiter(config, me) });
  });

  app.get('/api/admin/stats', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!(await isArbiter(config, me))) { res.status(403).json({ ok: false, code: 'not_admin', error: 'Only the Handova admin can see this.' }); return; }
    const week = Date.now() - 7 * 86_400_000;
    res.json({
      ok: true,
      phoneAccounts: count('SELECT COUNT(*) AS n FROM phone_accounts'),
      inspections: {
        open: count("SELECT COUNT(*) AS n FROM inspections WHERE status IN ('requested','rescheduled','approved')"),
        completed: count("SELECT COUNT(*) AS n FROM inspections WHERE status = 'completed'"),
        total: count('SELECT COUNT(*) AS n FROM inspections'),
      },
      chats: {
        conversations: count('SELECT COUNT(*) AS n FROM conversations'),
        messagesThisWeek: count('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', week),
      },
      ownership: {
        pending: count("SELECT COUNT(*) AS n FROM ownership_requests WHERE status = 'pending'"),
        approved: count("SELECT COUNT(*) AS n FROM ownership_requests WHERE status = 'approved'"),
      },
      reviews: count('SELECT COUNT(*) AS n FROM reviews'),
      openRepairs: count("SELECT COUNT(*) AS n FROM maintenance WHERE status != 'resolved'"),
    });
  });
}

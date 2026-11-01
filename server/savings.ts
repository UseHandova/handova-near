/**
 * Rent savings plans. The money itself sits in the RentSavingsVault contract (only the saver can move it);
 * this stores the plan — what they're saving for, by when, how often — and sends reminders on WhatsApp.
 * No yield is promised: the vault holds plain USDC.
 */

import type { Express, Request, Response } from 'express';
import { isAddress, parseAbi, type Address } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import { normalisePhone, type Notifier } from './inspections';
import { planMath, reminderDueToday, type Frequency } from '../src/lib/savings-math';

const VAULT_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);
const USDC_TO_NGN = 1600;
const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

interface Plan { account: string; goal_ngn: number; start_at: number; due_at: number; frequency: Frequency; day: number; phone: string; label: string; last_reminded_at: number }

export function vaultFromEnv(env = process.env): Address | null {
  const v = env.SAVINGS_VAULT_ADDRESS || env.VITE_SAVINGS_VAULT_ADDRESS || '';
  return isAddress(v) ? v : null;
}

export function mountSavings(app: Express, vault: Address | null = vaultFromEnv(), notify: Notifier = async () => false) {
  db().exec(`CREATE TABLE IF NOT EXISTS savings_plans (
    account TEXT PRIMARY KEY,
    goal_ngn INTEGER NOT NULL,
    start_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    day INTEGER NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    last_reminded_at INTEGER NOT NULL DEFAULT 0
  );`);
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const savedNgn = async (account: string) => {
    if (!vault) return 0;
    const raw = await chainClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'balanceOf', args: [account as Address] });
    return (Number(raw) / 1e6) * USDC_TO_NGN;
  };
  const view = (p: Plan) => ({ goalNgn: p.goal_ngn, startAt: p.start_at, dueAt: p.due_at, frequency: p.frequency, day: p.day, label: p.label, reminders: !!p.phone });

  app.get('/api/savings/plan', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const p = db().query('SELECT * FROM savings_plans WHERE account = ?').get(me.toLowerCase()) as Plan | null;
    res.json({ ok: true, plan: p ? view(p) : null });
  });

  app.post('/api/savings/plan', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const goal = Math.round(Number(b.goalNgn));
    const due = Number(b.dueAt);
    const frequency = b.frequency === 'monthly' ? 'monthly' : b.frequency === 'weekly' ? 'weekly' : null;
    const day = Math.round(Number(b.day));
    const now = Date.now();
    if (!(goal >= 10_000)) return bad(res, 400, 'Set how much you need — at least ₦10,000.', 'goal');
    if (!(due > now + 7 * 86_400_000) || due > now + 2 * 365 * 86_400_000) return bad(res, 400, 'Pick a due date between next week and two years from now.', 'due');
    if (!frequency) return bad(res, 400, 'Choose weekly or monthly.', 'frequency');
    if (frequency === 'weekly' ? !(day >= 0 && day <= 6) : !(day >= 1 && day <= 28)) return bad(res, 400, 'Choose a reminder day.', 'day');
    const phone = b.phone ? normalisePhone(b.phone) : '';
    if (b.phone && !phone) return bad(res, 400, 'That phone number doesn\'t look right — e.g. 0803 123 4567.', 'phone');
    const existing = db().query('SELECT start_at FROM savings_plans WHERE account = ?').get(me.toLowerCase()) as { start_at: number } | null;
    db().query(`INSERT INTO savings_plans (account, goal_ngn, start_at, due_at, frequency, day, phone, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account) DO UPDATE SET goal_ngn = excluded.goal_ngn, due_at = excluded.due_at, frequency = excluded.frequency, day = excluded.day, phone = excluded.phone, label = excluded.label`)
      .run(me.toLowerCase(), goal, existing?.start_at ?? now, due, frequency, day, phone, String(b.label ?? '').trim().slice(0, 80));
    res.json({ ok: true, plan: view(db().query('SELECT * FROM savings_plans WHERE account = ?').get(me.toLowerCase()) as Plan) });
  });

  app.post('/api/savings/plan/stop', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    db().query('DELETE FROM savings_plans WHERE account = ?').run(me.toLowerCase());
    res.json({ ok: true });
  });

  /** Send today's reminders (each plan at most once a day, from 9 am Lagos). Returns how many went out. */
  async function sendReminders(now = Date.now()) {
    if (new Date(now + 3600_000).getUTCHours() < 9) return 0;
    const plans = db().query('SELECT * FROM savings_plans WHERE phone != \'\' AND last_reminded_at < ?').all(now - 20 * 3600_000) as Plan[];
    let sent = 0;
    for (const p of plans) {
      if (!reminderDueToday(p.frequency, p.day, now)) continue;
      const saved = await savedNgn(p.account).catch(() => null);
      if (saved === null) continue; // chain unreachable — try again next hour
      const m = planMath(p.goal_ngn, saved, p.start_at, p.due_at, p.frequency, now);
      if (m.status === 'done') continue;
      const due = new Date(p.due_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
      const text = m.status === 'overdue'
        ? `Handova: your rent was due on ${due}. You've saved ${naira(saved)} of ${naira(p.goal_ngn)}.`
        : `💰 Handova: time to save ${naira(m.perPeriod)} toward your rent (${naira(p.goal_ngn)} due ${due}). You've saved ${naira(saved)} so far${m.status === 'behind' ? ' — a little behind, but you can catch up' : ''}. Open Handova to add it in one tap.`;
      if (await notify(p.phone, text).catch(() => false)) sent++;
      db().query('UPDATE savings_plans SET last_reminded_at = ? WHERE account = ?').run(now, p.account);
    }
    return sent;
  }
  return { sendReminders };
}

/**
 * Rent savings plan maths — pure, shared by the app and the server's reminder job so they always agree.
 * Amounts are naira.
 */

export type Frequency = 'weekly' | 'monthly';
export const PERIOD_MS: Record<Frequency, number> = { weekly: 7 * 86_400_000, monthly: 30.4375 * 86_400_000 };

export interface PlanMath {
  remaining: number;     // still to save
  periodsLeft: number;   // weeks or months until it's due (at least 1)
  perPeriod: number;     // what to save each week/month from now, rounded up to ₦100
  expectedByNow: number; // where a steady saver would be today
  status: 'done' | 'on_track' | 'behind' | 'overdue';
  progress: number;      // 0..1
}

/**
 * @param goal  naira to have by `dueAt`
 * @param saved naira saved so far
 * @param startAt when the plan started (for "on track")
 */
export function planMath(goal: number, saved: number, startAt: number, dueAt: number, frequency: Frequency, now = Date.now()): PlanMath {
  const remaining = Math.max(0, goal - saved);
  const periodsLeft = Math.max(1, Math.ceil((dueAt - now) / PERIOD_MS[frequency]));
  const perPeriod = remaining === 0 ? 0 : Math.ceil(remaining / periodsLeft / 100) * 100;
  const span = Math.max(1, dueAt - startAt);
  const expectedByNow = Math.min(goal, Math.max(0, goal * ((now - startAt) / span)));
  const status = remaining === 0 ? 'done' : now > dueAt ? 'overdue' : saved >= expectedByNow * 0.95 ? 'on_track' : 'behind';
  return { remaining, periodsLeft, perPeriod, expectedByNow, status, progress: goal > 0 ? Math.min(1, saved / goal) : 0 };
}

/** Is a reminder due today (Lagos time)? Weekly: `day` 0–6 (Sun–Sat). Monthly: `day` 1–28. */
export function reminderDueToday(frequency: Frequency, day: number, now = Date.now()): boolean {
  const lagos = new Date(now + 3600_000);
  return frequency === 'weekly' ? lagos.getUTCDay() === day : lagos.getUTCDate() === day;
}

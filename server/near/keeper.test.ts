import { expect, test } from 'bun:test';
import { dueAction, type LeaseLike } from './keeper';

const t = { handover_claim_secs: 3 * 86400, move_out_review_secs: 7 * 86400, dispute_secs: 7 * 86400 };
const DAY = 86_400_000;
const base: LeaseLike = { id: 1, status: 'Pending', handover_at_ms: null, move_in_dispute: null, move_out_at_ms: null, dispute: null };

test('keeper triggers only what the rules allow', () => {
  expect(dueAction(base, t, 10 * DAY)).toBeNull();
  expect(dueAction({ ...base, handover_at_ms: 0 }, t, 2 * DAY)).toBeNull();
  expect(dueAction({ ...base, handover_at_ms: 0 }, t, 3 * DAY)).toBe('claim_move_in');
  expect(dueAction({ ...base, handover_at_ms: 0, move_in_dispute: 'no keys' }, t, 9 * DAY)).toBeNull();
  expect(dueAction({ ...base, status: 'Ending', move_out_at_ms: 0 }, t, 7 * DAY)).toBe('claim_caution');
  expect(dueAction({ ...base, status: 'Disputed', dispute: { opened_at_ms: DAY } }, t, 7 * DAY)).toBeNull();
  expect(dueAction({ ...base, status: 'Disputed', dispute: { opened_at_ms: DAY } }, t, 8 * DAY)).toBe('settle_dispute_timeout');
  expect(dueAction({ ...base, status: 'Active' }, t, 999 * DAY)).toBeNull();
});

/**
 * NEAR has no cron, so the contract's "if nobody acts in N days" rules need someone to call them.
 * Anyone may; this keeper does it on a timer, paying gas from the relayer. The outcome is fixed
 * by the contract — the keeper can only trigger what the rules already allow.
 */
import { teraToGas } from 'near-api-js';
import { deploy } from './config';
import { relayer, summarize, view } from './chain';
import { BASELINE_FILE } from './inspect';
import { hasBaseline, rememberBaseline } from './baselines';

interface Timeouts {
  handover_claim_secs: number;
  move_out_review_secs: number;
  dispute_secs: number;
}

export interface LeaseLike {
  id: number;
  status: string;
  handover_at_ms: number | null;
  move_in_dispute: string | null;
  move_in_dispute_at_ms?: number | null;
  landlord?: string;
  listing_id?: number;
  /** Verified when the tenant paid; the contract needs this and a badge that still stands. */
  landlord_verified?: boolean;
  move_out_at_ms: number | null;
  dispute: { opened_at_ms: number } | null;
}

/** Which timeout call (if any) is due for this lease. */
/** `landlordVerified`: only ID-verified landlords may collect rent from a silent tenant. */
export function dueAction(l: LeaseLike, t: Timeouts, nowMs: number, landlordVerified = true): string | null {
  if (l.status === 'Pending' && l.handover_at_ms != null && !l.move_in_dispute && landlordVerified && nowMs >= l.handover_at_ms + t.handover_claim_secs * 1000) return 'claim_move_in';
  if (l.status === 'Pending' && l.move_in_dispute_at_ms != null && nowMs >= l.move_in_dispute_at_ms + t.dispute_secs * 1000) return 'settle_move_in_timeout';
  if (l.status === 'Ending' && l.move_out_at_ms != null && nowMs >= l.move_out_at_ms + t.move_out_review_secs * 1000) return 'claim_caution';
  if (l.status === 'Disputed' && l.dispute && nowMs >= l.dispute.opened_at_ms + t.dispute_secs * 1000) return 'settle_dispute_timeout';
  return null;
}

/** The contract's rule: verified when the tenant paid, and still verified now. */
export function silenceClaimOpen(l: LeaseLike, badgeNow: boolean): boolean {
  return !!l.landlord_verified && badgeNow;
}

/** Keep the listing as it stood at the start of the lease, for the move-out inspection. */
async function snapshotListing(l: LeaseLike) {
  if (l.listing_id == null || hasBaseline(BASELINE_FILE(), l.id)) return;
  const listing = await view<{ property_ref?: string } | null>(deploy.escrow, 'get_listing', { listing_id: l.listing_id }).catch(() => null);
  if (listing?.property_ref != null) rememberBaseline(BASELINE_FILE(), l.id, listing.property_ref, Date.now());
}

export async function runKeeperOnce(log = console.log): Promise<number> {
  if (!relayer) return 0;
  const { timeouts } = await view<{ timeouts: Timeouts }>(deploy.escrow, 'get_config');
  let done = 0;
  for (let from = 0; ; from += 100) {
    const page = await view<LeaseLike[]>(deploy.escrow, 'get_leases', { from_index: from, limit: 100 });
    for (const l of page) {
      if (l.status === 'Pending' || l.status === 'Active') await snapshotListing(l);
      const badge = await view<boolean>(deploy.escrow, 'is_verified', { account_id: l.landlord }).catch(() => false);
      const method = dueAction(l, timeouts, Date.now(), silenceClaimOpen(l, badge));
      if (!method) continue;
      const outcome = await relayer.callFunctionRaw({ contractId: deploy.escrow, methodName: method, args: { lease_id: l.id }, gas: teraToGas('50') }).catch((e: Error) => e);
      if (outcome instanceof Error) log(`keeper: ${method}(${l.id}) failed: ${outcome.message}`);
      else {
        const s = summarize(outcome);
        log(`keeper: ${method}(${l.id}) ${s.ok ? 'ok' : `failed: ${s.error}`} ${s.hash}`);
        if (s.ok) done++;
      }
    }
    if (page.length < 100) break;
  }
  return done;
}

export function startKeeper(everyMs = 10 * 60_000) {
  if (!relayer) return;
  const tick = () => runKeeperOnce().catch((e) => console.error('keeper:', e.message));
  setTimeout(tick, 5_000);
  setInterval(tick, everyMs);
}

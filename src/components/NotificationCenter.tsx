/**
 * NotificationCenter — bell + panel built from live escrow state for the signed-in address.
 * Each notification's id encodes the state it describes, so a change shows up as new.
 * Read / dismissed ids are remembered per browser.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, CheckCircle2, Key, ShieldCheck, Zap, AlertTriangle, Wallet, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '@/lib/LangContext';
import { OUTCOME_OPENS_MS, formatSlot, type Inspection } from '@/lib/inspections';
import { cashKey, type CashPayment } from '@/lib/cash';
import { EscrowStatus } from '@/lib/contracts';
import { formatNaira } from '@/lib/naira';
import {
  formatCountdown, sameAddress, useChainState, useNow, usePendingWithdrawal,
  DEPOSIT_REVIEW_MS, MOVE_IN_WINDOW_MS, type ChainEscrow,
} from '@/lib/chain';

type Kind = 'escrow' | 'keys' | 'review' | 'dispute' | 'money' | 'done';

interface Notification {
  id: string;
  type: Kind;
  title: string;
  body: string;
  createdAt: number;
}

const TYPE_ICONS: Record<Kind, React.ElementType> = {
  escrow: ShieldCheck, keys: Key, review: Clock, dispute: AlertTriangle, money: Wallet, done: CheckCircle2,
};

const TYPE_COLORS: Record<Kind, string> = {
  escrow: '#7c3aed', keys: 'var(--accent)', review: '#f59e0b', dispute: '#ef4444', money: 'var(--success)', done: 'var(--success)',
};

const SEEN_KEY = 'rentflow_notifications_seen';
const HIDDEN_KEY = 'rentflow_notifications_hidden';

function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); } catch { return new Set(); }
}
function saveSet(key: string, set: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...set].slice(-300))); } catch { /* storage unavailable */ }
}

const place = (e: ChainEscrow) => e.listing?.meta.location || `listing #${e.listingId}`;

function tenantNotice(e: ChainEscrow, now: number): Notification | null {
  const at = (n: number) => n || e.createdAt;
  const id = (s: string) => `t-${e.id}-${s}`;
  switch (e.status) {
    case EscrowStatus.Pending:
      return e.handoverAt
        ? { id: id('handover'), type: 'keys', title: 'Keys handed over', body: `Your landlord at ${place(e)} says you have the keys. Confirm move-in within ${formatCountdown(e.handoverAt + MOVE_IN_WINDOW_MS, now)}, or raise a dispute.`, createdAt: e.handoverAt }
        : { id: id('paid'), type: 'escrow', title: 'Rent safe in escrow', body: `Your payment for ${place(e)} is held by the contract. Confirm move-in once you get the keys.`, createdAt: e.createdAt };
    case EscrowStatus.Active:
      return { id: id('active'), type: 'done', title: 'Lease active', body: `You moved into ${place(e)}. Your lease certificate NFT is in your wallet.`, createdAt: e.createdAt };
    case EscrowStatus.Ending: {
      const due = e.endRequestedAt + DEPOSIT_REVIEW_MS;
      return now >= due
        ? { id: id('claim'), type: 'money', title: 'Deposit ready', body: `The review for ${place(e)} is over. Claim your deposit in My Leases.`, createdAt: due }
        : { id: id('review'), type: 'review', title: 'Deposit under review', body: `Your landlord is inspecting ${place(e)}. If they don't dispute, you can claim your deposit in ${formatCountdown(due, now)}.`, createdAt: at(e.endRequestedAt) };
    }
    case EscrowStatus.Disputed:
      return { id: id('dispute'), type: 'dispute', title: 'Dispute open', body: `The tenancy at ${place(e)} is in dispute. Upload your evidence so the Handova team can decide.`, createdAt: at(e.disputedAt) };
    default:
      return { id: id('closed'), type: 'done', title: 'Tenancy closed', body: `Your tenancy at ${place(e)} is settled. Any money owed to you is ready to withdraw.`, createdAt: e.createdAt };
  }
}

function landlordNotice(e: ChainEscrow, now: number): Notification | null {
  const id = (s: string) => `l-${e.id}-${s}`;
  switch (e.status) {
    case EscrowStatus.Pending:
      if (!e.handoverAt) return { id: id('paid'), type: 'escrow', title: 'A tenant has paid', body: `Rent for ${place(e)} is in escrow. Hand over the keys, then tap "Keys handed over".`, createdAt: e.createdAt };
      return now >= e.handoverAt + MOVE_IN_WINDOW_MS
        ? { id: id('claimable'), type: 'keys', title: 'Finalise move-in', body: `The tenant at ${place(e)} hasn't responded. You can finalise the move-in and receive the rent.`, createdAt: e.handoverAt + MOVE_IN_WINDOW_MS }
        : null;
    case EscrowStatus.Active:
      return { id: id('active'), type: 'money', title: 'Rent released', body: `Your tenant moved into ${place(e)}. The rent is ready to withdraw.`, createdAt: e.createdAt };
    case EscrowStatus.Ending:
      return now < e.endRequestedAt + DEPOSIT_REVIEW_MS
        ? { id: id('review'), type: 'review', title: 'Tenant moved out', body: `Inspect ${place(e)} within ${formatCountdown(e.endRequestedAt + DEPOSIT_REVIEW_MS, now)}: return the deposit or dispute it.`, createdAt: e.endRequestedAt }
        : null;
    case EscrowStatus.Disputed:
      return { id: id('dispute'), type: 'dispute', title: 'Dispute open', body: `The tenancy at ${place(e)} is in dispute. Upload your evidence so the Handova team can decide.`, createdAt: e.disputedAt || e.createdAt };
    default:
      return null;
  }
}

/** Inspection updates (from the cached /api/inspections list, which the dashboard and listings keep fresh). */
function inspectionNotice(i: Inspection, now: number): Notification | null {
  const id = (s: string) => `i-${i.id}-${s}-${i.slotAt}`;
  const when = formatSlot(i.slotAt, now);
  const outcomeTime = now >= i.slotAt - OUTCOME_OPENS_MS;
  if (i.role === 'landlord') {
    if (i.status === 'requested') return { id: id('req'), type: 'review', title: 'Inspection request', body: `${i.tenantName} wants to visit ${i.place} ${when}. Approve it or suggest another time on your dashboard.`, createdAt: i.updatedAt };
    if (i.status === 'approved' && outcomeTime && !i.landlordConfirmedAt) return { id: id('outcome'), type: 'keys', title: 'Did the visit happen?', body: `Confirm ${i.tenantName}'s inspection at ${i.place} so they can pay into escrow.`, createdAt: i.slotAt };
    if (i.status === 'approved' && !outcomeTime) return { id: id('accepted'), type: 'escrow', title: 'Visit confirmed', body: `${i.tenantName} is coming to ${i.place} ${when}.`, createdAt: i.updatedAt };
    if (i.status === 'cancelled') return { id: id('cancel'), type: 'dispute', title: 'Visit cancelled', body: `${i.tenantName} cancelled the visit to ${i.place} (${when}).`, createdAt: i.updatedAt };
    return null;
  }
  if (i.canPay) return { id: id('pay'), type: 'done', title: 'Ready to pay', body: `Your inspection at ${i.place} is confirmed. Review the details and pay into escrow when you're ready.`, createdAt: i.updatedAt };
  if (i.status === 'rescheduled') return { id: id('resch'), type: 'review', title: 'New time suggested', body: `The landlord at ${i.place} suggested ${when}. Accept it or pick another time.`, createdAt: i.updatedAt };
  if (i.status === 'declined') return { id: id('declined'), type: 'dispute', title: 'Visit declined', body: `The landlord at ${i.place} couldn't do ${when}${i.landlordNote ? `: "${i.landlordNote}"` : '.'} You can pick another time.`, createdAt: i.updatedAt };
  if (i.status === 'approved' && outcomeTime && !i.tenantConfirmedAt) return { id: id('outcome'), type: 'keys', title: 'How did the visit go?', body: `Tell us if your inspection at ${i.place} happened so you can move on to paying.`, createdAt: i.slotAt };
  if (i.status === 'approved' && !outcomeTime) return { id: id('approved'), type: 'escrow', title: 'Visit confirmed', body: `Your inspection at ${i.place} is ${when}.`, createdAt: i.updatedAt };
  if (i.status === 'missed' && i.missedBy === 'landlord') return { id: id('missed'), type: 'dispute', title: 'Visit marked as missed', body: `The landlord says the visit to ${i.place} didn't happen. You can book a new time.`, createdAt: i.updatedAt };
  return null;
}

/**
 * Watch a query's cached data without becoming one of its observers. (An observer without a queryFn
 * would make the owner's scheduled refetches fail.)
 */
function useCachedData<T>(key: readonly unknown[]): T | undefined {
  const qc = useQueryClient();
  const hash = JSON.stringify(key);
  const subscribe = useCallback((onChange: () => void) => qc.getQueryCache().subscribe(e => { if (e.query.queryHash === hash) onChange(); }), [qc, hash]);
  return useSyncExternalStore(subscribe, () => qc.getQueryData<T>(key));
}

/** Cash payment updates (from the cached /api/cash-payments list). */
function cashNotice(p: CashPayment): Notification | null {
  const id = (s: string) => `c-${p.id}-${s}`;
  const amt = `₦${p.amountNgn.toLocaleString('en-NG')}`;
  if (p.role === 'landlord' && p.status === 'awaiting_landlord') return { id: id('ask'), type: 'money', title: 'Confirm a cash payment', body: `${p.tenantName} says they paid you ${amt} in cash for ${p.place}. Check the receipt and confirm on your dashboard.`, createdAt: p.createdAt };
  if (p.role === 'tenant' && p.status === 'confirmed') return { id: id('ok'), type: 'done', title: 'Cash payment confirmed', body: `The landlord confirmed your ${amt} payment for ${p.place}. Your record is in My Leases.`, createdAt: p.resolvedAt ?? p.landlordAnsweredAt ?? p.createdAt };
  if (p.role === 'tenant' && p.status === 'disputed') return { id: id('dispute'), type: 'dispute', title: 'Landlord disputes your cash payment', body: `They said: "${p.landlordNote}". The Handova team is reviewing your receipt.`, createdAt: p.landlordAnsweredAt ?? p.createdAt };
  if (p.status === 'rejected') return { id: id('rejected'), type: 'dispute', title: 'Cash payment not confirmed', body: `Handova reviewed the ${amt} payment for ${p.place}: "${p.adminNote}"`, createdAt: p.resolvedAt ?? p.createdAt };
  return null;
}

function timeAgo(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationCenter({ address }: { address: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => loadSet(SEEN_KEY));
  const [hidden, setHidden] = useState(() => loadSet(HIDDEN_KEY));
  const chain = useChainState();
  const pending = usePendingWithdrawal(address).data ?? 0;
  const now = useNow();
  // Read-only view of the inspections cache; whichever screen signed in keeps it fresh.
  const visits = useCachedData<Inspection[]>(['inspections', address.toLowerCase()]);
  const cashPayments = useCachedData<CashPayment[]>(cashKey(address));

  const notifs = useMemo(() => {
    const list: Notification[] = [];
    for (const e of chain.data?.escrows ?? []) {
      const n = sameAddress(e.tenant, address) ? tenantNotice(e, now)
        : sameAddress(e.listing?.landlord, address) ? landlordNotice(e, now)
        : null;
      if (n) list.push(n);
    }
    for (const i of visits ?? []) { const n = inspectionNotice(i, now); if (n) list.push(n); }
    for (const p of cashPayments ?? []) { const n = cashNotice(p); if (n) list.push(n); }
    if (pending > 0) {
      list.push({ id: `money-${pending}`, type: 'money', title: 'Money to withdraw', body: `You have ${formatNaira(pending)} ready. Tap Withdraw at the top to move it to your wallet.`, createdAt: now });
    }
    return list.filter(n => !hidden.has(n.id)).sort((a, b) => b.createdAt - a.createdAt);
  }, [chain.data, address, pending, hidden, now, visits, cashPayments]);

  const unread = notifs.filter(n => !seen.has(n.id)).length;

  function markRead(id: string) {
    setSeen(prev => { const next = new Set(prev).add(id); saveSet(SEEN_KEY, next); return next; });
  }

  function markAllRead() {
    setSeen(prev => { const next = new Set([...prev, ...notifs.map(n => n.id)]); saveSet(SEEN_KEY, next); return next; });
  }

  function dismiss(id: string) {
    setHidden(prev => { const next = new Set(prev).add(id); saveSet(HIDDEN_KEY, next); return next; });
  }

  return (
    <>
      {/* Bell button */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen(o => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative w-10 h-10 rounded-2xl flex items-center justify-center"
        style={{ background: open ? 'var(--accent-soft)' : 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <Bell className="w-4.5 h-4.5" style={{ color: open ? 'var(--accent)' : 'var(--ink)' }} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
            style={{ background: '#ef4444' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] max-h-[480px] overflow-y-auto rounded-3xl z-50"
              style={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="font-bold text-sm" style={{ color: 'var(--ink)' }}>{t('notifications')}</span>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                      {t('mark_all_read')}
                    </button>
                  )}
                </div>
              </div>

              {notifs.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Zap className="w-8 h-8" style={{ color: 'var(--subtle)' }} />
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('no_notifications')}</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {notifs.map(n => {
                    const Icon = TYPE_ICONS[n.type];
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        onClick={() => markRead(n.id)}
                        className="px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors hover:bg-[var(--accent-soft)]"
                        style={{ background: seen.has(n.id) ? 'transparent' : 'var(--accent-soft)' }}
                      >
                        <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-0.5"
                          style={{ background: `${TYPE_COLORS[n.type]}20` }}>
                          <Icon className="w-4 h-4" style={{ color: TYPE_COLORS[n.type] }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{n.title}</p>
                            <span className="text-[10px] shrink-0" style={{ color: 'var(--subtle)' }}>{timeAgo(n.createdAt, now)}</span>
                          </div>
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>{n.body}</p>
                        </div>
                        <button onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                          style={{ background: 'var(--surface-strong)' }}>
                          <X className="w-3 h-3" style={{ color: 'var(--subtle)' }} />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * RentedOut — the landlord's let homes: who lives there, when they moved in, and how many months until the next
 * year's rent is due. Covers escrow tenancies (move-in recorded onchain) and landlord-confirmed cash payments.
 */

import { useMemo } from 'react';
import { CalendarClock, Home, KeyRound, Banknote, Hourglass } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { monthsUntil, nextRentDue, type ChainEscrow } from '@/lib/chain';
import { EscrowStatus } from '@/lib/contracts';
import { useCashPayments } from '@/lib/cash';
import { useInspections } from '@/lib/inspections';
import { formatNaira, USDC_TO_NGN } from '@/lib/naira';

export interface RentedListing { id: string; location: string; rentNgn: number; cover?: string; escrow?: ChainEscrow }

interface Tenancy {
  key: string;
  listingId: string;
  place: string;
  cover?: string;
  tenant: string;
  how: 'escrow' | 'cash';
  rentNgn: number;
  /** Unix ms; 0 while the tenant hasn't moved in yet. */
  since: number;
  due: number;
  note?: string;
}

const YEAR_MS = 365 * 86_400_000;
const date = (ms: number) => new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function dueText(due: number, now: number) {
  if (due <= now) return { big: 'Due now', small: `Rent was due ${date(due)}`, tone: 'var(--danger)' };
  const months = monthsUntil(due, now);
  if (months === 0) {
    const days = Math.ceil((due - now) / 86_400_000);
    return { big: `${days} day${days === 1 ? '' : 's'}`, small: `until rent is due · ${date(due)}`, tone: 'var(--warning)' };
  }
  return { big: `${months} month${months === 1 ? '' : 's'}`, small: `until rent is due · ${date(due)}`, tone: months <= 2 ? 'var(--warning)' : 'var(--ink)' };
}

export default function RentedOut({ account, listings, now }: { account: SmartAccount; listings: RentedListing[]; now: number }) {
  const cash = useCashPayments(account);
  const visits = useInspections(account).inspections;

  const tenancies = useMemo<Tenancy[]>(() => {
    const nameOf = (listingId: string, tenant: string) =>
      visits.find(v => v.role === 'landlord' && v.listingId === listingId && v.tenant.toLowerCase() === tenant.toLowerCase())?.tenantName;
    const out: Tenancy[] = [];
    for (const l of listings) {
      const e = l.escrow;
      if (!e) continue;
      const movedIn = e.status !== EscrowStatus.Pending;
      out.push({
        key: `e${e.id}`, listingId: l.id, place: l.location, cover: l.cover, how: 'escrow', rentNgn: l.rentNgn,
        tenant: nameOf(l.id, e.tenant) ?? short(e.tenant),
        since: movedIn ? (e.movedInAt || e.createdAt) : 0,
        due: movedIn ? nextRentDue(e) : 0,
        note: e.status === EscrowStatus.Ending ? 'Moving out — deposit under review'
          : e.status === EscrowStatus.Disputed ? 'In dispute'
          : !movedIn ? 'Paid into escrow — waiting for move-in' : undefined,
      });
    }
    for (const p of cash.payments) {
      if (p.role !== 'landlord' || p.status !== 'confirmed' || p.coversUntil <= now - 90 * 86_400_000) continue;
      const l = listings.find(x => x.id === p.listingId);
      out.push({
        key: `c${p.id}`, listingId: p.listingId, place: l?.location ?? p.place, cover: l?.cover, how: 'cash',
        rentNgn: l?.rentNgn ?? p.amountNgn, tenant: p.tenantName, since: p.coversUntil - YEAR_MS, due: p.coversUntil,
      });
    }
    // Soonest rent first; homes still waiting for move-in last.
    return out.sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
  }, [listings, cash.payments, visits, now]);

  const tile = { background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' };

  if (tenancies.length === 0) {
    return (
      <div className="rounded-2xl p-10 flex flex-col items-center text-center" style={{ border: '1px dashed var(--border-strong)' }}>
        <KeyRound className="w-8 h-8 mb-3" style={{ color: 'var(--subtle)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>No homes rented out yet</p>
        <p className="text-sm mt-1 max-w-sm" style={{ color: 'var(--muted)' }}>
          When a tenant pays (through escrow, or in cash that you confirm), the home shows here with the date the next rent is due.
        </p>
        {!cash.connected && (
          <button onClick={cash.connect} className="mt-4 text-sm font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>
            Load cash tenancies too
          </button>
        )}
      </div>
    );
  }

  const dueSoon = tenancies.filter(t => t.due && t.due - now < 60 * 86_400_000).length;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {tenancies.length} home{tenancies.length === 1 ? '' : 's'} rented out
        {dueSoon > 0 && <> · <b style={{ color: 'var(--warning)' }}>{dueSoon} due within 2 months</b></>}
        {!cash.connected && <> · <button onClick={cash.connect} className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>include cash tenancies</button></>}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {tenancies.map(t => {
          const d = t.due ? dueText(t.due, now) : null;
          const progress = t.since && t.due ? Math.min(1, Math.max(0, (now - t.since) / (t.due - t.since))) : 0;
          return (
            <article key={t.key} className="rounded-2xl p-4" style={tile}>
              <div className="flex items-center gap-3">
                {t.cover
                  ? <img src={t.cover} alt="" loading="lazy" className="w-14 h-14 rounded-xl object-cover shrink-0" />
                  : <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--surface-muted)' }}><Home className="w-6 h-6" style={{ color: 'var(--subtle)' }} /></div>}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--ink)' }}>{t.place}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {t.tenant} · {formatNaira(t.rentNgn / USDC_TO_NGN)}/yr
                  </p>
                  <p className="text-[11px] mt-0.5 inline-flex items-center gap-1" style={{ color: 'var(--subtle)' }}>
                    {t.how === 'cash' ? <><Banknote className="w-3 h-3" /> Paid in cash</> : <><KeyRound className="w-3 h-3" /> Paid through escrow</>}
                    {t.since > 0 && <> · since {date(t.since)}</>}
                  </p>
                </div>
              </div>
              {d ? (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xl font-bold tabular-nums flex items-center gap-1.5" style={{ color: d.tone }}>
                      <CalendarClock className="w-4 h-4" /> {d.big}
                    </p>
                    <p className="text-xs text-right" style={{ color: 'var(--muted)' }}>{d.small}</p>
                  </div>
                  <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--surface-muted)' }} aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              ) : null}
              {t.note && (
                <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                  <Hourglass className="w-3.5 h-3.5" /> {t.note}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

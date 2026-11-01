/**
 * InspectionRequests — the landlord's side of inspections, shown on the dashboard.
 * New requests: approve, suggest another time, or decline (with a reason the tenant sees).
 * After the visit: confirm it happened (unlocks the tenant's payment) or report a no-show.
 */

import { useState } from 'react';
import { CalendarCheck, CheckCircle2, Clock, Loader2, MessageCircle, MessagesSquare, Phone, XCircle } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { useChainState, useNow } from '@/lib/chain';
import { openChat } from '@/lib/chat';
import { useCashPayments } from '@/lib/cash';
import SlotPicker from '@/components/SlotPicker';
import { PaymentMethodPicker } from '@/components/CashPayment';
import { OUTCOME_OPENS_MS, WHATSAPP_CHAT, formatSlot, prettyPhone, useInspections, waLink, type Inspection } from '@/lib/inspections';

const DECLINE_REASONS = ['That time doesn\'t work', 'The property is already taken', 'I\'m travelling — please pick another week'];

export default function InspectionRequests({ account }: { account: SmartAccount }) {
  const ins = useInspections(account);
  const now = useNow();
  const mine = ins.inspections.filter(i => i.role === 'landlord');
  // Inspections whose tenant already sent a cash receipt: the payment method is locked.
  const cashPayments = useCashPayments(account).payments;
  const cashSent = new Set(cashPayments.filter(p => p.role === 'landlord' && p.status !== 'rejected').map(p => p.inspectionId));
  const groups: { title: string; items: Inspection[] }[] = [
    { title: 'Needs your reply', items: mine.filter(i => i.status === 'requested') },
    { title: 'Did the visit happen?', items: mine.filter(i => i.status === 'approved' && now >= i.slotAt - OUTCOME_OPENS_MS && !i.landlordConfirmedAt) },
    { title: 'Upcoming visits', items: mine.filter(i => i.status === 'approved' && (now < i.slotAt - OUTCOME_OPENS_MS || !!i.landlordConfirmedAt)).sort((a, b) => a.slotAt - b.slotAt) },
    { title: 'Waiting for the tenant', items: mine.filter(i => i.status === 'rescheduled') },
    { title: 'Recently inspected', items: mine.filter(i => i.status === 'completed' && now - i.updatedAt < 14 * 86_400_000) },
  ].filter(g => g.items.length);

  if (!ins.connected) {
    return (
      <section className="mb-6 p-4 rounded-2xl flex items-center gap-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <CalendarCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Inspection requests</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Sign in once to see who wants to visit your properties.</p>
        </div>
        <button onClick={ins.connect} className="h-9 px-4 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>Show</button>
      </section>
    );
  }
  if (ins.isLoading) return null;
  if (ins.isError) {
    return <p className="mb-6 text-sm px-4 py-3 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}>Couldn't load inspection requests: {ins.error.message}</p>;
  }
  if (!groups.length) return null;

  return (
    <section className="mb-6 space-y-4" aria-label="Inspections">
      {groups.map(g => (
        <div key={g.title}>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>{g.title} · {g.items.length}</h3>
          <ul className="space-y-2">{g.items.map(i => <Item key={i.id} i={i} ins={ins} cashSent={cashSent.has(i.id)} />)}</ul>
        </div>
      ))}
    </section>
  );
}

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null;
}

function Item({ i, ins, cashSent }: { i: Inspection; ins: ReturnType<typeof useInspections>; cashSent: boolean }) {
  const [mode, setMode] = useState<'idle' | 'propose' | 'decline'>('idle');
  const [slot, setSlot] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();
  const past = i.slotAt < now;

  async function act(action: string, body: Record<string, unknown>, ok: (r: Inspection) => string) {
    setBusy(action);
    try {
      const r = await ins.act(i.id, action, body);
      toast.success(ok(r));
      setMode('idle'); setNote(''); setSlot(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled.' : msg);
    } finally { setBusy(null); }
  }
  const told = (r: Inspection) => (r.notified ? ' We let them know too.' : ' They\'ll see it in Handova.');
  const btn = 'h-10 px-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50';
  const ghost = { background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' };
  const input = { background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' };

  return (
    <li className="p-4 rounded-2xl space-y-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{i.tenantName} <span className="font-normal" style={{ color: 'var(--muted)' }}>· {i.place}</span></p>
          <p className="text-sm flex items-center gap-1.5 mt-0.5" style={{ color: past && i.status === 'requested' ? 'var(--danger)' : 'var(--ink-2)' }}>
            <Clock className="w-3.5 h-3.5" /> {formatSlot(i.slotAt)}{past && i.status === 'requested' ? ' — time has passed' : ''}
          </p>
          {i.note && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>"{i.note}"</p>}
          {i.status === 'rescheduled' && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>You suggested this time. Waiting for {i.tenantName.split(' ')[0]} to accept.</p>}
          {i.status === 'approved' && i.landlordConfirmedAt && !i.tenantConfirmedAt && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>You confirmed the visit. Waiting for the tenant.</p>}
          {i.status === 'completed' && <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--accent)' }}><CheckCircle2 className="w-3 h-3" /> Both confirmed. {i.paymentMethod === 'cash' ? 'They\'ll pay you in cash and upload the receipt for you to confirm.' : 'If they rent it, you\'ll be notified when rent is in escrow.'}</p>}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={() => openChat({ listingId: i.listingId, tenant: i.tenant })} aria-label={`Chat with ${i.tenantName} in Handova`} title="Chat in Handova"
            className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><MessagesSquare className="w-4 h-4" /></button>
        {i.tenantPhone && (
          <>
            <a href={`tel:+${i.tenantPhone}`} aria-label={`Call ${i.tenantName}`} title={prettyPhone(i.tenantPhone)} className="w-9 h-9 rounded-full flex items-center justify-center" style={ghost}><Phone className="w-4 h-4" /></a>
            {WHATSAPP_CHAT && <a href={waLink(i.tenantPhone, `Hello ${i.tenantName.split(' ')[0]}, this is the landlord for ${i.place} on Handova.`)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${i.tenantName}`} className="w-9 h-9 rounded-full flex items-center justify-center" style={ghost}><MessageCircle className="w-4 h-4" /></a>}
          </>
        )}
        </div>
      </div>

      {/* New request */}
      {i.status === 'requested' && mode === 'idle' && (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => { void act('approve', {}, r => `Visit approved for ${formatSlot(r.slotAt)}.${told(r)}`); }} disabled={!!busy || past} title={past ? 'This time has passed — suggest a new one' : undefined}
            className={btn} style={{ background: 'var(--accent)', color: 'white' }}><Spin on={busy === 'approve'} /> Approve</button>
          <button onClick={() => setMode('propose')} className={btn} style={ghost}>Other time</button>
          <button onClick={() => setMode('decline')} className={btn} style={{ ...ghost, color: 'var(--danger)' }}>Decline</button>
        </div>
      )}
      {i.status === 'approved' && !past && mode === 'idle' && (
        <div className="flex gap-3 text-xs">
          <button onClick={() => setMode('propose')} style={{ color: 'var(--muted)' }}>Change time</button>
          <button onClick={() => setMode('decline')} style={{ color: 'var(--danger)' }}>Cancel visit</button>
        </div>
      )}

      {mode === 'propose' && (
        <div className="space-y-3 pt-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Suggest a time that works for you</p>
          <SlotPicker value={slot} onChange={setSlot} />
          <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="Message (optional), e.g. I'm only around in the mornings" className="w-full h-10 px-3 rounded-xl text-sm outline-none" style={input} />
          <div className="flex gap-2">
            <button onClick={() => setMode('idle')} className={btn} style={{ color: 'var(--muted)' }}>Back</button>
            <button onClick={() => { if (!slot) { toast.error('Pick a day and time first.'); return; } void act('propose', { slotAt: slot, note }, r => `Suggested ${formatSlot(r.slotAt)}.${told(r)}`); }} disabled={!!busy}
              className={`${btn} flex-1`} style={{ background: 'var(--accent)', color: 'white' }}><Spin on={busy === 'propose'} /> {slot ? `Suggest ${formatSlot(slot)}` : 'Pick a time'}</button>
          </div>
        </div>
      )}

      {mode === 'decline' && (
        <div className="space-y-2 pt-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Tell {i.tenantName.split(' ')[0]} why (they'll see this)</p>
          <div className="flex flex-wrap gap-2">
            {DECLINE_REASONS.map(r => (
              <button key={r} onClick={() => setNote(r)} className="px-3 py-1.5 rounded-full text-xs border"
                style={note === r ? { background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' } : { ...ghost }}>{r}</button>
            ))}
          </div>
          <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="Or write your own reason" className="w-full h-10 px-3 rounded-xl text-sm outline-none" style={input} />
          <div className="flex gap-2">
            <button onClick={() => setMode('idle')} className={btn} style={{ color: 'var(--muted)' }}>Back</button>
            <button onClick={() => { void act('decline', { note }, r => `Declined.${told(r)}`); }} disabled={!!busy} className={`${btn} flex-1`} style={{ ...ghost, color: 'var(--danger)' }}>
              <Spin on={busy === 'decline'} /> <XCircle className="w-4 h-4" /> Decline visit
            </button>
          </div>
        </div>
      )}

      {/* How this tenant pays: escrow (default) or cash */}
      {cashSent && <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>Paying in cash. Their receipt is below in "Confirm cash payments".</p>}
      {(i.status === 'approved' || i.status === 'completed') && mode === 'idle' && !cashSent && (
        <PaymentMethodPicker i={i} busy={!!busy} onChange={m => { void act('payment', { method: m }, r => (r.paymentMethod === 'cash'
          ? `${i.tenantName.split(' ')[0]} will pay you in cash and upload the receipt for you to confirm.`
          : `${i.tenantName.split(' ')[0]} will pay through escrow.`) + told(r)); }} />
      )}

      {/* After the visit */}
      {i.status === 'approved' && now >= i.slotAt - OUTCOME_OPENS_MS && !i.landlordConfirmedAt && mode === 'idle' && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { void act('happened', {}, r => r.status === 'completed' ? 'Confirmed. The tenant can now pay into escrow.' : 'Confirmed. Waiting for the tenant to confirm too.'); }} disabled={!!busy}
            className={btn} style={{ background: 'var(--accent)', color: 'white' }}><Spin on={busy === 'happened'} /> <CheckCircle2 className="w-4 h-4" /> Yes, it happened</button>
          <button onClick={() => { void act('missed', {}, () => 'Marked as missed. The tenant can book again.'); }} disabled={!!busy} className={btn} style={ghost}><Spin on={busy === 'missed'} /> They didn't come</button>
        </div>
      )}
    </li>
  );
}

/** Tenant's visits in progress, shown on My Leases so they can find them again. */
export function TenantVisits({ account, onOpen }: { account: SmartAccount; onOpen: (listingId: string) => void }) {
  const ins = useInspections(account);
  const cash = useCashPayments(account).payments;
  const chain = useChainState();
  const now = useNow();
  const cashFor = (i: Inspection) => cash.find(p => p.inspectionId === i.id && p.status !== 'rejected');
  // Already paid: an escrow from this tenant for that listing, or a cash payment the landlord confirmed.
  const paid = (i: Inspection) => cashFor(i)?.status === 'confirmed'
    || (chain.data?.escrows ?? []).some(e => String(e.listingId) === i.listingId && e.tenant.toLowerCase() === account.address.toLowerCase());
  const list = ins.inspections.filter(i => i.role === 'tenant' && (['requested', 'rescheduled', 'approved'].includes(i.status) || i.canPay) && !paid(i));
  if (!list.length) return null;
  const label = (i: Inspection) =>
    cashFor(i)?.status === 'awaiting_landlord' ? { text: 'Cash receipt sent — waiting for the landlord', color: 'var(--muted)' }
    : cashFor(i)?.status === 'disputed' ? { text: 'Cash payment under review', color: '#d4a017' }
    : i.canPay ? { text: i.paymentMethod === 'cash' ? 'Inspected — pay the landlord in cash' : 'Inspected — ready to pay', color: 'var(--accent)' }
    : i.status === 'requested' ? { text: 'Waiting for landlord', color: 'var(--muted)' }
    : i.status === 'rescheduled' ? { text: 'New time suggested — reply needed', color: '#d4a017' }
    : now >= i.slotAt - OUTCOME_OPENS_MS ? { text: i.tenantConfirmedAt ? 'Waiting for landlord to confirm' : 'Did the visit happen? Tell us', color: i.tenantConfirmedAt ? 'var(--muted)' : '#d4a017' }
    : { text: 'Visit confirmed', color: 'var(--accent)' };
  return (
    <section className="mb-6" aria-label="Your visits">
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Your visits · {list.length}</h2>
      <ul className="space-y-2">
        {list.map(i => (
          <li key={i.id}>
            <button onClick={() => onOpen(i.listingId)} className="w-full flex items-center gap-3 p-4 rounded-2xl text-left" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <CalendarCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>{i.place} · {formatSlot(i.slotAt)}</span>
                <span className="block text-xs" style={{ color: label(i).color }}>{label(i).text}</span>
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Open</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

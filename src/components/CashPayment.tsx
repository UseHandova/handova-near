/**
 * Cash payments — UI.
 *   PaymentMethodPicker   landlord: escrow or cash, per tenant (on an inspection)
 *   TenantCashPay         tenant: pay in person, upload the receipt, follow the landlord's answer
 *   LandlordCashPayments  landlord: "Did you receive ₦X?" and, once confirmed, take the listing down
 *   TenantCashRecords     tenant: confirmed cash payments as records on My Leases
 *   AdminCashDisputes     admin: decide disputed payments from the receipt and both notes
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CheckCircle2, Clock, FileText, Loader2, ShieldCheck, Upload, X, XCircle } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cashKey, fmtNgn, lagosToday, openReceipt, sendCashReceipt, useCashPayments, type CashPayment } from '@/lib/cash';
import type { Inspection } from '@/lib/inspections';
import { sendEscrowTx, useChainState, useRefreshChain } from '@/lib/chain';

const errText = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return /NotAllowedError|cancel/i.test(m) ? 'Sign-in was cancelled.' : m; };
const fmtDate = (d: string | number) => new Date(typeof d === 'string' ? `${d}T12:00:00+01:00` : d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const card = { background: 'var(--surface-muted)', border: '1px solid var(--border)' };
const btn = 'h-11 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60';

function Receipts({ account, p }: { account: SmartAccount; p: CashPayment }) {
  return (
    <div className="flex flex-wrap gap-2">
      {p.files.map(f => (
        <button key={f.index} onClick={() => { void openReceipt(account, p.id, f.index).catch(e => toast.error(errText(e))); }}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl" style={{ background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          <FileText className="w-3.5 h-3.5" /> {f.name}
        </button>
      ))}
    </div>
  );
}

/** Landlord picks how this tenant pays. */
export function PaymentMethodPicker({ i, onChange, busy }: { i: Inspection; onChange: (m: 'escrow' | 'cash') => void; busy: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>How should {i.tenantName.split(' ')[0]} pay?</p>
      <div className="grid grid-cols-2 gap-2">
        {([['escrow', 'Through escrow', 'Protected until move-in'], ['cash', 'In cash', 'They upload the receipt']] as const).map(([m, label, sub]) => (
          <button key={m} onClick={() => onChange(m)} disabled={busy || i.paymentMethod === m}
            className="text-left px-3 py-2 rounded-xl border disabled:cursor-default"
            style={i.paymentMethod === m ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : { borderColor: 'var(--border)', background: 'var(--popover)' }}>
            <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</span>
            <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tenant: pay cash and prove it. */
export function TenantCashPay({ account, inspection, expectedNgn }: { account: SmartAccount; inspection: Inspection; expectedNgn: number }) {
  const qc = useQueryClient();
  const cash = useCashPayments(account);
  const mine = cash.payments.filter(p => p.inspectionId === inspection.id);
  const current = mine.find(p => p.status !== 'rejected');
  const rejected = !current ? mine.find(p => p.status === 'rejected') : undefined;
  const [paidOn, setPaidOn] = useState(lagosToday());
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Math.round(expectedNgn);
    if (!files.length) { toast.error('Add a photo of the receipt the landlord gave you.'); return; }
    setBusy(true);
    try {
      const p = await sendCashReceipt(account, { inspectionId: inspection.id, amountNgn: n, paidOn, note }, files);
      cash.connect();
      await qc.invalidateQueries({ queryKey: cashKey(account.address) });
      toast.success(p.notified ? 'Receipt sent. We\'ve asked the landlord on WhatsApp to confirm.' : 'Receipt sent. The landlord will confirm it in Handova.');
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }

  if (current?.status === 'awaiting_landlord') return (
    <div className="space-y-3">
      <div className="flex gap-3 p-4 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
        <Clock className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm"><p className="font-semibold" style={{ color: 'var(--accent)' }}>Waiting for the landlord to confirm</p>
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>You told us you paid {fmtNgn(current.amountNgn)} on {fmtDate(current.paidOn)}. Once they confirm, you'll both have a record of it.</p></div>
      </div>
      <Receipts account={account} p={current} />
    </div>
  );
  if (current?.status === 'confirmed') return (
    <div className="space-y-3">
      <div className="flex gap-3 p-4 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
        <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm"><p className="font-semibold" style={{ color: 'var(--accent)' }}>Payment confirmed</p>
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>The landlord confirmed {fmtNgn(current.amountNgn)} paid on {fmtDate(current.paidOn)}. Your rent is covered until {fmtDate(current.coversUntil)}. Find this record any time in My Leases.</p></div>
      </div>
      <Receipts account={account} p={current} />
    </div>
  );
  if (current?.status === 'disputed') return (
    <div className="space-y-3">
      <div className="flex gap-3 p-4 rounded-2xl" style={card}>
        <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: '#d4a017' }} />
        <div className="text-sm"><p className="font-semibold" style={{ color: 'var(--ink)' }}>The landlord disagrees</p>
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>They said: “{current.landlordNote}”. The Handova team is looking at your receipt and will let you both know the decision.</p></div>
      </div>
      <Receipts account={account} p={current} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 p-4 rounded-2xl" style={{ background: 'rgba(212,160,23,0.12)' }}>
        <Banknote className="w-5 h-5 shrink-0" style={{ color: '#d4a017' }} />
        <div className="text-sm" style={{ color: 'var(--ink)' }}>
          <p className="font-semibold">The landlord asked to be paid in cash</p>
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>Cash isn't protected by escrow. Pay only the landlord you inspected with, get a written receipt, and upload it here so they can confirm it. That confirmation is your proof of payment.</p>
        </div>
      </div>
      {rejected && <p className="text-sm px-3 py-2.5 rounded-xl" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>Last receipt wasn't accepted: “{rejected.adminNote}”</p>}
      <div className="grid grid-cols-2 gap-2">
        <div className="text-xs" style={{ color: 'var(--muted)' }}>Amount paid
          <p className="mt-1 h-11 px-3 rounded-xl text-sm flex items-center font-semibold tabular-nums" style={{ ...card, color: 'var(--ink)' }}>{fmtNgn(expectedNgn)}</p>
        </div>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Date paid
          <input type="date" value={paidOn} max={lagosToday()} onChange={e => setPaidOn(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
        </label>
      </div>
      <p className="text-[11px] -mt-2" style={{ color: 'var(--subtle)' }}>The first payment is always in full: a year's rent plus the refundable caution fee.</p>
      <label className="flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl border-2 border-dashed cursor-pointer" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
        <Upload className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Photo of the receipt</span>
        <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>JPG, PNG or PDF · up to 3 · 10 MB each · private</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" aria-label="Receipt"
          onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files ?? []).filter(x => x.size <= 10 * 1024 * 1024)].slice(0, 3)); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1.5">{files.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl" style={{ ...card, color: 'var(--ink)' }}>
            <FileText className="w-4 h-4" style={{ color: 'var(--muted)' }} /><span className="flex-1 truncate">{f.name}</span>
            <button onClick={() => setFiles(x => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X className="w-4 h-4" style={{ color: 'var(--muted)' }} /></button>
          </li>))}
        </ul>
      )}
      <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="Note (optional), e.g. paid at the house to Mr Ade" className="w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
      <button onClick={() => { void submit(); }} disabled={busy} className={`${btn} w-full h-12`} style={{ background: 'var(--accent)', color: 'white' }}>
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><ShieldCheck className="w-4 h-4" /> Send receipt to the landlord</>}
      </button>
    </div>
  );
}

/** Landlord: confirm cash payments. */
export function LandlordCashPayments({ account }: { account: SmartAccount }) {
  const qc = useQueryClient();
  const cash = useCashPayments(account);
  const chain = useChainState();
  const refreshChain = useRefreshChain();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [disputing, setDisputing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = cash.payments.filter(p => p.role === 'landlord');
  const waiting = mine.filter(p => p.status === 'awaiting_landlord');
  const stillListed = mine.filter(p => p.status === 'confirmed' && chain.data?.listings.some(l => String(l.id) === p.listingId && l.active));
  if (!waiting.length && !stillListed.length) return null;

  async function answer(p: CashPayment, received: boolean) {
    if (!received && (notes[p.id] ?? '').trim().length < 5) { toast.error('Say what\'s wrong, e.g. "I only received ₦300,000".'); return; }
    setBusy(`a${p.id}`);
    try {
      await api(account, `/api/cash-payments/${p.id}/answer`, { body: { received, note: notes[p.id] ?? '' } });
      await qc.invalidateQueries({ queryKey: cashKey(account.address) });
      await qc.invalidateQueries({ queryKey: ['cash-rented'] });
      toast.success(received ? 'Confirmed. You and the tenant both have a record of this payment.' : 'Sent to the Handova team to review.');
      setDisputing(null);
    } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }
  async function takeDown(p: CashPayment) {
    setBusy(`d${p.id}`);
    try {
      await sendEscrowTx(account, { functionName: 'deactivateListing', args: [BigInt(p.listingId)] });
      await refreshChain();
      toast.success('Listing taken down. Tenants won\'t see it any more.');
    } catch (e) { toast.error(/NotAllowedError/.test(String(e)) ? 'Cancelled.' : 'Could not take the listing down. Please try again.'); } finally { setBusy(null); }
  }

  return (
    <section className="mb-6 space-y-2" aria-label="Cash payments">
      {waiting.length > 0 && <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Confirm cash payments · {waiting.length}</h3>}
      {waiting.map(p => (
        <div key={p.id} className="p-4 rounded-2xl space-y-3" style={card}>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{p.tenantName} says they paid you <span className="tabular-nums">{fmtNgn(p.amountNgn)}</span> in cash</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{p.place} · paid {fmtDate(p.paidOn)}{p.note ? ` · “${p.note}”` : ''}</p>
          </div>
          <Receipts account={account} p={p} />
          {disputing === p.id ? (
            <div className="space-y-2">
              <input value={notes[p.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value.slice(0, 300) }))} placeholder="What's wrong? e.g. I only received ₦300,000" autoFocus
                className="w-full h-10 px-3 rounded-xl text-sm outline-none" style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <div className="flex gap-2">
                <button onClick={() => setDisputing(null)} className={btn} style={{ color: 'var(--muted)' }}>Back</button>
                <button onClick={() => { void answer(p, false); }} disabled={!!busy} className={`${btn} flex-1`} style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}>
                  {busy === `a${p.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Send to Handova to review
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { void answer(p, true); }} disabled={!!busy} className={btn} style={{ background: 'var(--accent)', color: 'white' }}>
                {busy === `a${p.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Yes, I received it
              </button>
              <button onClick={() => setDisputing(p.id)} className={btn} style={{ background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' }}>I didn't receive it</button>
            </div>
          )}
        </div>
      ))}
      {stillListed.map(p => (
        <div key={`d${p.id}`} className="p-4 rounded-2xl flex items-center gap-3" style={card}>
          <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <p className="flex-1 text-sm" style={{ color: 'var(--ink-2)' }}><b style={{ color: 'var(--ink)' }}>{p.place}</b> is rented to {p.tenantName}. Tenants no longer see it in Handova; take the listing down to close it on the blockchain too.</p>
          <button onClick={() => { void takeDown(p); }} disabled={!!busy} className={btn} style={{ background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
            {busy === `d${p.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Take down
          </button>
        </div>
      ))}
    </section>
  );
}

/** Tenant: cash payments as records on My Leases. */
export function TenantCashRecords({ account }: { account: SmartAccount }) {
  const cash = useCashPayments(account);
  const mine = cash.payments.filter(p => p.role === 'tenant' && p.status !== 'rejected');
  if (!mine.length) return null;
  return (
    <section className="mb-6 space-y-2" aria-label="Cash payments">
      <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Paid in cash</h2>
      {mine.map(p => (
        <div key={p.id} className="p-4 rounded-2xl space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{p.place} · <span className="tabular-nums">{fmtNgn(p.amountNgn)}</span></p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Paid {fmtDate(p.paidOn)}{p.status === 'confirmed' ? ` · covers until ${fmtDate(p.coversUntil)}` : ''}</p>
            </div>
            <span className="text-[11px] font-semibold px-2 py-1 rounded-full shrink-0" style={p.status === 'confirmed' ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { background: 'var(--surface-muted)', color: p.status === 'disputed' ? '#d4a017' : 'var(--muted)' }}>
              {p.status === 'confirmed' ? 'Confirmed by landlord' : p.status === 'disputed' ? 'Under review' : 'Waiting for landlord'}
            </span>
          </div>
          <Receipts account={account} p={p} />
        </div>
      ))}
    </section>
  );
}

/** Admin: disputed cash payments. */
export function AdminCashDisputes({ account }: { account: SmartAccount }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cash-disputed'], queryFn: () => api<{ payments: CashPayment[] }>(account, '/api/cash-payments/disputed').then(r => r.payments), retry: false });
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  async function resolve(p: CashPayment, paid: boolean) {
    if ((notes[p.id] ?? '').trim().length < 5) { toast.error('Explain the decision — both people will see it.'); return; }
    setBusy(p.id);
    try {
      await api(account, `/api/cash-payments/${p.id}/resolve`, { body: { paid, note: notes[p.id] } });
      await qc.invalidateQueries({ queryKey: ['cash-disputed'] });
      toast.success('Decision sent to the tenant and the landlord.');
    } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }
  if (q.isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--subtle)' }} /></div>;
  if (q.isError) return <p className="text-sm" style={{ color: 'var(--danger)' }}>{errText(q.error)}</p>;
  if (!q.data?.length) return <p className="text-sm py-4" style={{ color: 'var(--muted)' }}>No cash payments in dispute.</p>;
  return (
    <ul className="space-y-3">{q.data.map(p => (
      <li key={p.id} className="p-4 rounded-2xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-sm">
          <p className="font-semibold" style={{ color: 'var(--ink)' }}>{p.place}: {p.tenantName} says {fmtNgn(p.amountNgn)} paid on {fmtDate(p.paidOn)}</p>
          {p.note && <p className="mt-1" style={{ color: 'var(--ink-2)' }}>Tenant: “{p.note}”</p>}
          <p className="mt-1" style={{ color: 'var(--ink-2)' }}>Landlord: “{p.landlordNote}”</p>
        </div>
        <Receipts account={account} p={p} />
        <input value={notes[p.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))} placeholder="Your decision and why (both will see it)"
          className="w-full h-10 px-3 rounded-xl text-sm outline-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { void resolve(p, true); }} disabled={busy === p.id} className={btn} style={{ background: 'var(--accent)', color: 'white' }}><CheckCircle2 className="w-4 h-4" /> Record as paid</button>
          <button onClick={() => { void resolve(p, false); }} disabled={busy === p.id} className={btn} style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}><XCircle className="w-4 h-4" /> Not proven</button>
        </div>
      </li>))}
    </ul>
  );
}

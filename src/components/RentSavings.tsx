/**
 * RentSavings — save weekly or monthly toward the next rent.
 * The plan is worked out from the tenancy (amount + when it's due); money goes into RentSavingsVault in one tap
 * and can be withdrawn any time (with a nudge showing what that does to the plan). No interest is promised.
 */

import { useState } from 'react';
import { CalendarClock, Loader2, PiggyBank, Sparkles } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { useSavings } from '@/lib/savings';
import { planMath, type Frequency } from '@/lib/savings-math';
import { savedContact } from '@/lib/inspections';
import { useNow } from '@/lib/chain';
import { gasProblem } from '@/lib/network';

const fmt = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const card = { background: 'var(--surface-muted)', border: '1px solid var(--border)' };
const btn = 'h-11 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60';
const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel/i.test(m)) return 'Cancelled — nothing was moved.';
  const gas = gasProblem(e); if (gas && !/transfer amount/i.test(m)) return gas;
  if (/insufficient|exceeds balance|transfer amount/i.test(m)) return 'Not enough USDC in your wallet for that amount.';
  return m.length > 140 ? 'That didn\'t go through. Nothing was moved — please try again.' : m;
};

export interface SavingsSuggestion { goalNgn: number; dueAt: number; label: string }

export default function RentSavings({ account, suggestion }: { account: SmartAccount; suggestion?: SavingsSuggestion }) {
  const s = useSavings(account);
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [wAmount, setWAmount] = useState('');

  // Setup form state (prefilled from the tenancy when there is one)
  const defaultDue = suggestion?.dueAt ?? now + 365 * 86_400_000;
  const [goal, setGoal] = useState(String(suggestion?.goalNgn ?? ''));
  const [due, setDue] = useState(new Date(defaultDue).toISOString().slice(0, 10));
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [day, setDay] = useState(5);
  const [phone, setPhone] = useState(savedContact().phone);

  if (!s.available) return null;

  if (!s.connected) return (
    <section className="mb-6 p-4 rounded-2xl flex items-center gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <PiggyBank className="w-6 h-6 shrink-0" style={{ color: 'var(--accent)' }} />
      <div className="flex-1"><p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Save for your next rent</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{suggestion ? `${fmt(suggestion.goalNgn)} due ${fmtDate(suggestion.dueAt)}. Small weekly amounts beat one big bill.` : 'Put a little aside each week so next year\'s rent isn\'t a shock.'}</p></div>
      <button onClick={s.connect} className={btn} style={{ background: 'var(--accent)', color: 'white' }}>Start</button>
    </section>
  );
  if (s.planLoading) return null;

  const goalNum = Number(goal.replace(/\D/g, ''));
  const dueMs = Date.parse(`${due}T09:00:00+01:00`);
  const preview = goalNum > 0 && dueMs > now ? planMath(goalNum, s.savedNgn, now, dueMs, frequency, now) : null;

  async function save() {
    if (!(goalNum >= 10_000)) { toast.error('Set how much you need — at least ₦10,000.'); return; }
    if (!(dueMs > now + 7 * 86_400_000)) { toast.error('Pick a due date at least a week away.'); return; }
    setBusy('plan');
    try {
      await s.savePlan({ goalNgn: goalNum, dueAt: dueMs, frequency, day: frequency === 'weekly' ? day : Math.min(28, Math.max(1, day)), label: suggestion?.label ?? 'My next rent', phone: phone.trim() || undefined });
      toast.success(phone.trim() ? 'Plan saved. We\'ll remind you on WhatsApp.' : 'Plan saved.');
      setEditing(false);
    } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }

  // ── Set up / edit ──
  if (!s.plan || editing) return (
    <section className="mb-6 p-4 rounded-2xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} aria-label="Rent savings plan">
      <div className="flex items-center gap-2"><PiggyBank className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>{editing ? 'Change your plan' : 'Save for your next rent'}</p></div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Amount needed (₦)
          <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="820000" className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none tabular-nums" style={{ ...card, color: 'var(--ink)' }} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Due on
          <input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['weekly', 'monthly'] as const).map(f => (
          <button key={f} onClick={() => { setFrequency(f); setDay(f === 'weekly' ? 5 : 1); }} className="h-10 rounded-xl text-sm font-semibold border capitalize"
            style={frequency === f ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--ink)' } : { borderColor: 'var(--border)', color: 'var(--muted)' }}>{f}</button>
        ))}
      </div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>Remind me on
        {frequency === 'weekly' ? (
          <div className="flex gap-1.5 mt-1">{DAYS.map((d, i) => (
            <button key={d} onClick={() => setDay(i)} className="flex-1 h-9 rounded-lg text-xs font-semibold border"
              style={day === i ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--ink)' } : { borderColor: 'var(--border)', color: 'var(--muted)' }}>{d}</button>
          ))}</div>
        ) : (
          <select value={day} onChange={e => setDay(Number(e.target.value))} className="mt-1 w-full h-10 px-3 rounded-xl text-sm" style={{ ...card, color: 'var(--ink)' }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>The {d}{d === 1 || d === 21 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'} of each month</option>)}
          </select>
        )}
      </div>
      <label className="block text-xs" style={{ color: 'var(--muted)' }}>WhatsApp number for reminders (optional)
        <input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18))} inputMode="tel" placeholder="0803 123 4567" className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
      </label>
      {preview && preview.status !== 'done' && (
        <p className="text-sm px-3 py-2.5 rounded-xl" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
          Save <b>{fmt(preview.perPeriod)}</b> every {frequency === 'weekly' ? 'week' : 'month'} for {preview.periodsLeft} {frequency === 'weekly' ? 'weeks' : 'months'} and you'll have {fmt(goalNum)} by {fmtDate(dueMs)}.
        </p>
      )}
      <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--subtle)' }}><Sparkles className="w-3.5 h-3.5 shrink-0" /> Earning interest on savings: coming soon. Your savings stay yours, and you can withdraw any time.</p>
      <div className="flex gap-2">
        {editing && <button onClick={() => setEditing(false)} className={btn} style={{ color: 'var(--muted)' }}>Cancel</button>}
        <button onClick={() => { void save(); }} disabled={busy === 'plan'} className={`${btn} flex-1`} style={{ background: 'var(--accent)', color: 'white' }}>
          {busy === 'plan' && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? 'Save changes' : 'Start saving'}
        </button>
      </div>
    </section>
  );

  // ── Active plan ──
  const p = s.plan;
  const m = planMath(p.goalNgn, s.savedNgn, p.startAt, p.dueAt, p.frequency, now);
  const unit = p.frequency === 'weekly' ? 'week' : 'month';
  const toSave = Number(amount.replace(/\D/g, '')) || m.perPeriod;
  const wNum = Number(wAmount.replace(/\D/g, ''));
  const afterWithdraw = wNum > 0 ? planMath(p.goalNgn, Math.max(0, s.savedNgn - wNum), p.startAt, p.dueAt, p.frequency, now) : null;
  const statusChip = { done: ['Fully saved 🎉', 'var(--accent)'], on_track: ['On track', 'var(--accent)'], behind: ['A little behind', '#d4a017'], overdue: ['Rent is due', 'var(--danger)'] }[m.status];

  async function deposit() {
    if (toSave < 100) { toast.error('Enter an amount to save.'); return; }
    if (toSave > s.walletNgn + 1) { toast.error(`You have ${fmt(s.walletNgn)} in your wallet. Add USDC first, or save a smaller amount.`); return; }
    setBusy('save');
    try { await s.deposit(toSave); toast.success(`${fmt(toSave)} saved toward your rent.`); setAmount(''); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }
  async function withdraw() {
    if (!(wNum > 0) || wNum > s.savedNgn + 1) { toast.error(`You can take out up to ${fmt(s.savedNgn)}.`); return; }
    setBusy('withdraw');
    try { await s.withdraw(Math.min(wNum, s.savedNgn)); toast.success(`${fmt(wNum)} is back in your wallet.`); setWithdrawing(false); setWAmount(''); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }

  return (
    <section className="mb-6 p-4 rounded-2xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} aria-label="Rent savings">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2"><PiggyBank className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <div><p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{p.label || 'Rent savings'}</p>
            <p className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}><CalendarClock className="w-3 h-3" /> {fmt(p.goalNgn)} due {fmtDate(p.dueAt)}</p></div></div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ color: statusChip[1], background: 'var(--surface-muted)' }}>{statusChip[0]}</span>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1"><span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{fmt(s.savedNgn)}</span><span className="tabular-nums" style={{ color: 'var(--muted)' }}>{Math.round(m.progress * 100)}%</span></div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}><div className="h-full rounded-full transition-all" style={{ width: `${m.progress * 100}%`, background: 'var(--accent)' }} /></div>
        {m.status !== 'done' && <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>Save <b style={{ color: 'var(--ink)' }}>{fmt(m.perPeriod)}</b> a {unit} to be ready on time · {m.periodsLeft} {unit}s left{p.reminders ? ` · reminder every ${p.frequency === 'weekly' ? DAYS[p.day] : `month on the ${p.day}`}` : ''}</p>}
      </div>
      {m.status !== 'done' && (
        <div className="flex gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={String(m.perPeriod)} aria-label="Amount to save"
            className="w-32 h-11 px-3 rounded-xl text-sm outline-none tabular-nums" style={{ ...card, color: 'var(--ink)' }} />
          <button onClick={() => { void deposit(); }} disabled={!!busy} className={`${btn} flex-1`} style={{ background: 'var(--accent)', color: 'white' }}>
            {busy === 'save' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Save {fmt(toSave)} now</>}
          </button>
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Wallet: {fmt(s.walletNgn)} · Earning interest: coming soon</p>
      {withdrawing ? (
        <div className="space-y-2 p-3 rounded-xl" style={card}>
          <input value={wAmount} onChange={e => setWAmount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={`Up to ${Math.round(s.savedNgn)}`} aria-label="Amount to withdraw" autoFocus
            className="w-full h-10 px-3 rounded-xl text-sm outline-none tabular-nums" style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          {afterWithdraw && afterWithdraw.status !== 'done' && (
            <p className="text-xs" style={{ color: '#a35a00' }}>This puts your rent at risk: you'd need to save {fmt(afterWithdraw.perPeriod)} a {unit} instead of {fmt(m.perPeriod)} to be ready by {fmtDate(p.dueAt)}.</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setWithdrawing(false); setWAmount(''); }} className={btn} style={{ color: 'var(--muted)' }}>Keep it saved</button>
            <button onClick={() => { void withdraw(); }} disabled={!!busy} className={`${btn} flex-1`} style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}>
              {busy === 'withdraw' && <Loader2 className="w-4 h-4 animate-spin" />} Withdraw to wallet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-4 text-xs">
          {s.savedNgn > 0 && <button onClick={() => setWithdrawing(true)} style={{ color: 'var(--muted)' }}>Withdraw</button>}
          <button onClick={() => { setGoal(String(p.goalNgn)); setDue(new Date(p.dueAt).toISOString().slice(0, 10)); setFrequency(p.frequency); setDay(p.day); setEditing(true); }} style={{ color: 'var(--muted)' }}>Change plan</button>
          <button onClick={() => { if (window.confirm('Stop this plan? Your savings stay in the vault until you withdraw them.')) void s.stopPlan(); }} style={{ color: 'var(--muted)' }}>Stop plan</button>
        </div>
      )}
    </section>
  );
}

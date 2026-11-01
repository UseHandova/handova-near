/**
 * PhoneLogin — sign in with a phone number (no passkey needed).
 * 1. Number → 2. send the pre-typed code on WhatsApp (proves the number) → 3. create or enter a 6-digit PIN.
 * See server/phone-auth.ts and src/lib/phone-wallet.ts for how the wallet key stays safe.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole, MessageCircle, Phone } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import type { Hex } from 'viem';
import { confirmFirebaseSms, firebaseConfigured, firebaseError, sendFirebaseSms } from '@/lib/firebase-sms';
import type { ConfirmationResult } from 'firebase/auth';
import { createPhoneWallet, pinProofFor, saveDeviceKey, unlockPhoneWallet, weakPin } from '@/lib/phone-wallet';

interface Props { onAuth: (account: SmartAccount, address: string) => void; onBack: () => void }

interface Start { challengeId: string; channel: 'whatsapp' | 'sms'; text: string; waLink: string; botNumber: string; sandboxJoin: string; phone: string; expiresAt: number; resendAfter?: number; devMode?: boolean }
interface Verified { phoneToken: string; phone: string; exists: boolean; salt?: Hex; address?: string; serverShare?: Hex }

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong. Please try again.');
  return out;
}
/** 0803 123 4567 → 2348031234567 (same rule as the server). */
function toE164(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (/^0[789]\d{9}$/.test(d)) return `234${d.slice(1)}`;
  if (/^[789]\d{9}$/.test(d)) return `234${d}`;
  return /^\d{10,15}$/.test(d) ? d : '';
}
/** 60000 → "1:00", 5000 → "0:05" */
const countdown = (ms: number) => { const sec = Math.min(60, Math.max(0, Math.ceil(ms / 1000))); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const pretty = (p: string) => (/^234\d{10}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : `+${p}`);

const input = 'w-full px-4 py-3.5 rounded-xl border text-base outline-none';
const inputStyle = { background: 'var(--surface-muted)', borderColor: 'var(--border)', color: 'var(--ink)' };
const primary = 'w-full py-4 rounded-2xl font-semibold text-white text-base flex items-center justify-center gap-2 disabled:opacity-60';

function PinInput({ value, onChange, label, autoFocus, onEnter }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean; onEnter?: () => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} autoFocus={autoFocus} aria-label={label}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }}
        className={`${input} text-center text-2xl tracking-[0.6em] mono`} style={inputStyle} placeholder="••••••" />
    </label>
  );
}

export default function PhoneLogin({ onAuth, onBack }: Props) {
  const [step, setStep] = useState<'number' | 'confirm' | 'sms' | 'create' | 'unlock'>('number');
  const [code, setCode] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [phone, setPhone] = useState('');
  const [start, setStart] = useState<Start | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [status, setStatus] = useState<'pending' | 'wrong_number' | 'expired'>('pending');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyWith, setBusyWith] = useState<'whatsapp' | 'sms' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which ways of proving a number this server offers (WhatsApp, and SMS via Firebase / Termii / test mode).
  const [smsMode, setSmsMode] = useState<'firebase' | 'termii' | 'dev' | null>(null);
  const fbConfirm = useRef<ConfirmationResult | null>(null);
  useEffect(() => {
    fetch('/api/phone/options').then(r => r.json() as Promise<{ sms: 'firebase' | 'termii' | 'dev' | null }>)
      .then(o => setSmsMode(o.sms === 'firebase' && !firebaseConfigured ? null : o.sms))
      .catch(() => setSmsMode(null));
  }, []);

  // Wait for the WhatsApp message to arrive.
  useEffect(() => {
    if (step !== 'confirm' || !start) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/phone/status/${start.challengeId}`).then(x => x.json() as Promise<{ status: string; error?: string } & Partial<Verified>>).catch(() => null);
      if (stop || !r) return;
      if (r.status === 'verified') { setVerified(r as Verified); setError(null); setStep(r.exists ? 'unlock' : 'create'); }
      else if (r.status === 'wrong_number' || r.status === 'expired') setStatus(r.status);
    };
    const timer = setInterval(() => { void tick(); }, 2000);
    return () => { stop = true; clearInterval(timer); };
  }, [step, start]);

  async function begin(channel: 'whatsapp' | 'sms' = 'whatsapp') {
    setBusy(true); setBusyWith(channel); setError(null);
    try {
      if (channel === 'sms' && smsMode === 'firebase') {
        // Google sends the code; we only see the proof afterwards.
        const e164 = toE164(phone);
        if (!e164) throw new Error('Enter your phone number, e.g. 0803 123 4567.');
        try { fbConfirm.current = await sendFirebaseSms(e164, 'phone-recaptcha'); } catch (e) { throw new Error(firebaseError(e)); }
        const now = Date.now();
        setStart({ challengeId: 'firebase', channel: 'sms', text: '', waLink: '', botNumber: '', sandboxJoin: '', phone: e164, expiresAt: now + 10 * 60_000, resendAfter: now + 60_000, devMode: false });
        setStatus('pending'); setCode(''); setClock(now); setStep('sms');
        return;
      }
      const s = await post<Start>('/api/phone/start', { phone, channel });
      setStart(s); setStatus('pending'); setCode(''); setClock(Date.now());
      setStep(s.channel === 'sms' ? 'sms' : 'confirm');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setBusyWith(null); }
  }

  // Tick once a second while an SMS code is waiting, for the "resend in 0:42" countdown.
  useEffect(() => {
    if (step !== 'sms') return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  async function verifySms(value = code) {
    if (!start || value.length !== 6) return;
    setBusy(true); setError(null);
    try {
      let v: Verified;
      if (start.challengeId === 'firebase' && fbConfirm.current) {
        let idToken: string;
        try { idToken = await confirmFirebaseSms(fbConfirm.current, value); } catch (e) { throw new Error(firebaseError(e)); }
        v = await post<Verified>('/api/phone/firebase', { idToken });
      } else {
        v = await post<Verified>('/api/phone/verify', { challengeId: start.challengeId, code: value });
      }
      setVerified(v); setStep(v.exists ? 'unlock' : 'create');
    } catch (e) { setError((e as Error).message); setCode(''); } finally { setBusy(false); }
  }

  async function create() {
    const weak = weakPin(pin);
    if (weak) { setError(weak); return; }
    if (pin !== pin2) { setError('The two PINs don\'t match. Type the same 6 digits twice.'); return; }
    if (!verified?.serverShare) { setError('Your phone check expired. Start again.'); return; }
    setBusy(true); setError(null);
    try {
      const w = await createPhoneWallet(pin, verified.serverShare);
      await post('/api/phone/account', { phoneToken: verified.phoneToken, ...w.backup });
      await saveDeviceKey(w.privateKey, verified.phone).catch(() => undefined); // still signed in for this visit if storage is blocked
      onAuth(w.account, w.account.address);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function unlock() {
    if (!/^\d{6}$/.test(pin)) { setError('Enter your 6-digit PIN.'); return; }
    if (!verified?.salt) { setError('Your phone check expired. Start again.'); return; }
    setBusy(true); setError(null);
    try {
      const b = await post<{ address: string; serverShare: Hex; blob: Hex; iv: Hex; salt: Hex }>('/api/phone/unlock', { phoneToken: verified.phoneToken, pinProof: await pinProofFor(pin, verified.salt) });
      const w = await unlockPhoneWallet(pin, b);
      await saveDeviceKey(w.privateKey, verified.phone).catch(() => undefined);
      onAuth(w.account, w.account.address);
    } catch (e) { setError((e as Error).message); setPin(''); } finally { setBusy(false); }
  }

  const back = () => {
    setError(null); setPin(''); setPin2('');
    if (step === 'number') onBack(); else setStep('number');
  };

  return (
    <div>
      <div id="phone-recaptcha" />
      <button onClick={back} className="flex items-center gap-1 text-sm mb-4 -ml-0.5 hover:opacity-60" style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="w-4 h-4" /> {step === 'number' ? 'Back' : 'Use a different number'}
      </button>

      {step === 'number' && (<>
        <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Continue with your phone number</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>We'll check it's yours with a quick WhatsApp message, or a code by SMS. <a href="/privacy" target="_blank" rel="noreferrer" className="underline">How we use your number</a></p>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Phone number</label>
        <input value={phone} onChange={e => { setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18)); setError(null); }}
          inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" autoFocus aria-label="Phone number"
          onKeyDown={e => { if (e.key === 'Enter') void begin('whatsapp'); }} className={`${input} mb-4`} style={inputStyle} />
        <button onClick={() => { void begin('whatsapp'); }} disabled={busy || phone.replace(/\D/g, '').length < 10} className={primary} style={{ background: 'var(--accent)' }}>
          {busyWith === 'whatsapp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-5 h-5" />} Continue with WhatsApp
        </button>
        {smsMode && <button onClick={() => { void begin('sms'); }} disabled={busy || phone.replace(/\D/g, '').length < 10}
          className="w-full mt-2 py-3 rounded-2xl text-sm font-semibold border flex items-center justify-center gap-2 disabled:opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
          {busyWith === 'sms' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" style={{ color: 'var(--muted)' }} />} {busyWith === 'sms' ? 'Sending your code…' : 'Not on WhatsApp? Text me a code'}
        </button>}
      </>)}

      {step === 'confirm' && start && (<>
        <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Confirm on WhatsApp</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>Tap the button, then press <strong>Send</strong> in WhatsApp. The message is already typed for you.</p>
        <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Send this from <strong>{pretty(start.phone)}</strong> to {start.botNumber}</p>
          <p className="mono text-lg font-bold mt-1" style={{ color: 'var(--ink)' }}>{start.text}</p>
        </div>
        {/* Twilio's WhatsApp sandbox only delivers to numbers that joined it, so first-timers must send the join
            message once. Make it step 1 instead of small print, or new users never get their code. */}
        {start.sandboxJoin && (
          <a href={`https://wa.me/${start.botNumber.replace(/\D/g, '')}?text=${encodeURIComponent(start.sandboxJoin)}`} target="_blank" rel="noreferrer"
            className={`${primary} mb-2`} style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
            <MessageCircle className="w-5 h-5" style={{ color: '#1fa855' }} /> Step 1: Activate WhatsApp (first time only)
          </a>
        )}
        <a href={start.waLink} target="_blank" rel="noreferrer" className={primary} style={{ background: '#1fa855' }}>
          <MessageCircle className="w-5 h-5" /> {start.sandboxJoin ? 'Step 2: Send your code' : 'Open WhatsApp'}
        </a>
        {status === 'pending' && (
          <p className="text-sm text-center mt-4 flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Waiting for your message…
          </p>
        )}
        {status === 'wrong_number' && <p className="text-sm text-center mt-4" style={{ color: 'var(--danger)' }}>That message came from a different number. Send it from {pretty(start.phone)}, or go back and change the number.</p>}
        {status === 'expired' && (
          <div className="text-center mt-4">
            <p className="text-sm" style={{ color: 'var(--danger)' }}>This code expired.</p>
            <button onClick={() => { void begin(); }} className="text-sm font-semibold mt-1 underline" style={{ color: 'var(--accent)' }}>Get a new code</button>
          </div>
        )}
        {start.sandboxJoin && (
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--subtle)' }}>
            First time on Handova? Do step 1 once (it sends <span className="mono">{start.sandboxJoin}</span> to {start.botNumber}), wait for WhatsApp's reply, then do step 2.
          </p>
        )}
        {smsMode && <button onClick={() => { void begin('sms'); }} disabled={busy} className="w-full mt-3 text-sm underline underline-offset-2" style={{ color: 'var(--muted)' }}>
          Not on WhatsApp? Text me a code instead
        </button>}
      </>)}

      {step === 'sms' && start && (<>
        <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Enter the code we texted you</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>We sent a 6-digit code to <strong>{pretty(start.phone)}</strong>. It can take a minute to arrive.</p>
        <input value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus aria-label="SMS code" placeholder="••••••"
          onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setError(null); if (v.length === 6) void verifySms(v); }}
          className={`${input} text-center text-2xl tracking-[0.6em] mono mb-4`} style={inputStyle} />
        <button onClick={() => { void verifySms(); }} disabled={busy || code.length < 6} className={primary} style={{ background: 'var(--accent)' }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Confirm
        </button>
        {start.devMode && (
          <p className="text-xs mt-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(212,160,23,0.12)', color: 'var(--ink)' }}>
            Test mode: no SMS provider is set up, so the code is in the server log instead of a text.
          </p>
        )}
        <div className="flex justify-between text-sm mt-4">
          {start.resendAfter && clock < start.resendAfter
            ? <span style={{ color: 'var(--subtle)' }}>Resend code in {countdown(start.resendAfter - clock)}</span>
            : <button onClick={() => { void begin('sms'); }} disabled={busy} className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>Send a new code</button>}
          <button onClick={() => { void begin('whatsapp'); }} disabled={busy} className="underline underline-offset-2" style={{ color: 'var(--muted)' }}>Use WhatsApp instead</button>
        </div>
      </>)}

      {step === 'create' && verified && (<>
        <p className="text-sm flex items-center gap-1.5 mb-3" style={{ color: 'var(--accent)' }}><CheckCircle2 className="w-4 h-4" /> {pretty(verified.phone)} confirmed</p>
        <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Create a 6-digit PIN</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>You'll use it to sign in on a new phone. It protects your wallet — only you know it.</p>
        <div className="space-y-3 mb-3">
          <PinInput label="New PIN" value={pin} onChange={v => { setPin(v); setError(null); }} autoFocus />
          <PinInput label="Type it again" value={pin2} onChange={v => { setPin2(v); setError(null); }} onEnter={() => { void create(); }} />
        </div>
        <p className="text-xs mb-4 px-3 py-2 rounded-xl" style={{ background: 'rgba(212,160,23,0.12)', color: 'var(--ink)' }}>
          Write your PIN down somewhere safe. Handova can't see it or reset it.
        </p>
        <button onClick={() => { void create(); }} disabled={busy || pin.length < 6 || pin2.length < 6} className={primary} style={{ background: 'var(--accent)' }}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating your wallet…</> : <><LockKeyhole className="w-5 h-5" /> Create my account</>}
        </button>
      </>)}

      {step === 'unlock' && verified && (<>
        <p className="text-sm flex items-center gap-1.5 mb-3" style={{ color: 'var(--accent)' }}><CheckCircle2 className="w-4 h-4" /> {pretty(verified.phone)} confirmed</p>
        <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Welcome back</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>Enter the 6-digit PIN you created for this number.</p>
        <div className="mb-4"><PinInput label="Your PIN" value={pin} onChange={v => { setPin(v); setError(null); }} autoFocus onEnter={() => { void unlock(); }} /></div>
        <button onClick={() => { void unlock(); }} disabled={busy || pin.length < 6} className={primary} style={{ background: 'var(--accent)' }}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking…</> : <><LockKeyhole className="w-5 h-5" /> Sign in</>}
        </button>
      </>)}

      {error && <p className="text-sm mt-3" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { Check, Fingerprint, KeyRound, Smartphone, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { nearConfig } from '../lib/near';
import { passkeysSupported } from '../lib/passkey';
import { useSession, type Role } from '../lib/session';
import { go } from '../lib/router';
import { RoleCards } from './RolePicker';
import { useToast } from '../lib/toast';
import { Busy, Sheet } from './ui';

type Mode = 'choose' | 'passkey' | 'create' | 'restore';

export function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createAccount, createWithPasskey, signInWithPasskey, connectWallet, restore } = useSession();
  const toast = useToast();
  const cfg = nearConfig();
  const passkeys = passkeysSupported();
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [check, setCheck] = useState<{ available: boolean; reason?: string; accountId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [restoreId, setRestoreId] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const { t } = useT();

  useEffect(() => { if (!open) { setMode('choose'); setName(''); setCheck(null); setRole(null); } }, [open]);

  useEffect(() => {
    if (!name) return setCheck(null);
    const t = setTimeout(() => api(`/api/accounts/check?name=${encodeURIComponent(name)}`).then(setCheck).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [name]);

  // Web wallets (Meteor Web, MyNearWallet) open a pop-up window. Arc and some mobile browsers open it
  // behind the page or block it, and the wallet's own dialog then waits forever: say what to look for.
  const connectWalletWatched = async () => {
    const hint = setTimeout(() => toast('error', "The wallet window hasn't answered. Look for a separate browser window behind this one, or a blocked pop-up icon in the address bar; allow pop-ups for this site and try again. Or use Create with fingerprint: no wallet needed."), 25_000);
    try { await connectWallet(); } finally { clearTimeout(hint); }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('ok', ok);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message || 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'create' || mode === 'passkey' ? 'Create your Handova account' : mode === 'restore' ? 'Restore your account' : t('Get started')}>
      {mode === 'choose' && (
        <div className="space-y-3">
          {cfg.accountCreation && passkeys && (
            <button onClick={() => setMode('passkey')} className="card flex w-full items-start gap-3 border-accent p-4 text-left">
              <Fingerprint className="mt-0.5 h-6 w-6 text-accent" />
              <span>
                <span className="block font-semibold">{t('Create with fingerprint')}</span>
                <span className="text-sm text-sub">Face ID, Touch ID or your phone's lock makes your NEAR account. No name to type, no words to write down, no gas to pay.</span>
              </span>
            </button>
          )}
          {cfg.accountCreation && !passkeys && (
            <button onClick={() => setMode('create')} className="card flex w-full items-start gap-3 p-4 text-left hover:border-accent">
              <Smartphone className="mt-0.5 h-6 w-6 text-accent" />
              <span>
                <span className="block font-semibold">{t('New to crypto? Create an account')}</span>
                <span className="text-sm text-sub">Pick a name like <b>ada.{cfg.accountParent}</b>. Your key is made on this phone — no app to install, no gas to pay.</span>
              </span>
            </button>
          )}
          <button onClick={() => run(connectWalletWatched, 'Wallet connected')} disabled={busy} className="card flex w-full items-start gap-3 p-4 text-left hover:border-accent">
            <Wallet className="mt-0.5 h-6 w-6 text-accent" />
            <span>
              <span className="block font-semibold">{t('I have a NEAR wallet')}</span>
              <span className="text-sm text-sub">HOT, Meteor, MyNearWallet, Intear and more via NEAR Connect. The wallet opens in its own window, so allow pop-ups for this site.</span>
            </span>
          </button>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-1 text-sm font-semibold text-accent">
            {passkeys && <button onClick={() => run(signInWithPasskey, 'Signed in')} disabled={busy}>{t('Sign in with fingerprint')}</button>}
            {cfg.accountCreation && passkeys && <button onClick={() => setMode('create')}>{t('Create with a name instead')}</button>}
            <button onClick={() => setMode('restore')}>{t('I have a recovery phrase')}</button>
          </div>
        </div>
      )}

      {mode === 'passkey' && (
        <div className="space-y-4">
          <div>
            <p className="label">{t('How will you use Handova?')}</p>
            <RoleCards value={role} onChange={setRole} />
            <p className="mt-1.5 text-xs text-faint">{t('You can switch any time on your Account page.')}</p>
          </div>
          <p className="rounded-xl bg-muted p-3 text-sm text-sub">Your phone will ask for your fingerprint, face or passcode. That makes the key of a real NEAR account only you control; Handova picks a free name for it. The same passkey signs you in on your next phone — there is no recovery phrase.</p>
          <button className="btn-primary w-full" disabled={!role || busy} onClick={() => role && run(async () => { await createWithPasskey(role); if (role === 'landlord') go('/landlord'); }, 'Welcome! Your account is ready')}>
            <Busy busy={busy}><Fingerprint className="h-4 w-4" /> {t('Continue with fingerprint')}</Busy>
          </button>
        </div>
      )}

      {mode === 'create' && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (check?.available && role) run(async () => { await createAccount(name, role); if (role === 'landlord') go('/landlord'); }, `Welcome! Your account is ${check.accountId}`); }}>
          <div>
            <label className="label" htmlFor="name">Your name on Handova</label>
            <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-accent">
              <input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="ada" className="min-w-0 flex-1 bg-transparent px-3.5 py-3 outline-none" maxLength={32} autoCapitalize="none" autoComplete="off" />
              <span className="pr-3.5 text-sm text-faint">.{cfg.accountParent}</span>
            </div>
            {check && <p className={`mt-1.5 text-sm ${check.available ? 'text-ok' : 'text-danger'}`}>{check.available ? <><Check className="inline h-4 w-4" /> {check.accountId} is free</> : check.reason}</p>}
          </div>
          <div>
            <p className="label">{t('How will you use Handova?')}</p>
            <RoleCards value={role} onChange={setRole} />
            <p className="mt-1.5 text-xs text-faint">{t('You can switch any time on your Account page.')}</p>
          </div>
          <p className="rounded-xl bg-muted p-3 text-sm text-sub">This is a real NEAR account that only you control. Next you'll see a 12-word recovery phrase — write it down; it's the only way back in if you lose this phone.</p>
          <button className="btn-primary w-full" disabled={!check?.available || !role || busy}><Busy busy={busy}>{t('Create account')}</Busy></button>
        </form>
      )}

      {mode === 'restore' && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => restore(phrase, restoreId.trim()), 'Account restored'); }}>
          <div>
            <label className="label" htmlFor="rid">Account</label>
            <input id="rid" className="input" value={restoreId} onChange={(e) => setRestoreId(e.target.value.toLowerCase())} placeholder={`ada.${cfg.accountParent}`} autoCapitalize="none" />
          </div>
          <div>
            <label className="label" htmlFor="phrase">12-word recovery phrase</label>
            <textarea id="phrase" className="input min-h-24" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoCapitalize="none" />
          </div>
          <button className="btn-primary w-full" disabled={busy || !phrase || !restoreId}><Busy busy={busy}><KeyRound className="h-4 w-4" /> Restore</Busy></button>
        </form>
      )}
    </Sheet>
  );
}

import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { Check, KeyRound, Smartphone, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { nearConfig } from '../lib/near';
import { useSession, type Role } from '../lib/session';
import { go } from '../lib/router';
import { RoleCards } from './RolePicker';
import { useToast } from '../lib/toast';
import { Busy, Sheet } from './ui';

type Mode = 'choose' | 'create' | 'restore';

export function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createAccount, connectWallet, restore } = useSession();
  const toast = useToast();
  const cfg = nearConfig();
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
    <Sheet open={open} onClose={onClose} title={mode === 'create' ? 'Create your Handova account' : mode === 'restore' ? 'Restore your account' : t('Get started')}>
      {mode === 'choose' && (
        <div className="space-y-3">
          {cfg.accountCreation && (
            <button onClick={() => setMode('create')} className="card flex w-full items-start gap-3 p-4 text-left hover:border-accent">
              <Smartphone className="mt-0.5 h-6 w-6 text-accent" />
              <span>
                <span className="block font-semibold">{t('New to crypto? Create an account')}</span>
                <span className="text-sm text-sub">Pick a name like <b>ada.{cfg.accountParent}</b>. Your key is made on this phone — no app to install, no gas to pay.</span>
              </span>
            </button>
          )}
          <button onClick={() => run(connectWallet, 'Wallet connected')} disabled={busy} className="card flex w-full items-start gap-3 p-4 text-left hover:border-accent">
            <Wallet className="mt-0.5 h-6 w-6 text-accent" />
            <span>
              <span className="block font-semibold">{t('I have a NEAR wallet')}</span>
              <span className="text-sm text-sub">HOT, Meteor, MyNearWallet, Intear and more via NEAR Connect.</span>
            </span>
          </button>
          <button onClick={() => setMode('restore')} className="w-full py-2 text-sm font-semibold text-accent">{t('I have a recovery phrase')}</button>
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

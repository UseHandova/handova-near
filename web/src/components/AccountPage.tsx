import { useCallback, useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { ArrowDownToLine, ExternalLink, Eye, LogOut, Scale, ScrollText, ShieldAlert, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { naira, usd, usdc, useNgnRate } from '../lib/money';
import { accountUrl, chain, nearConfig, txUrl } from '../lib/near';
import { useSession } from '../lib/session';
import { council, daoPolicy } from '../lib/dao';
import { useToast } from '../lib/toast';
import { Busy, Empty, Row } from './ui';
import { RoleSwitch } from './RolePicker';
import { CashOut } from './CashOut';

export function AccountPage({ onNeedSignIn }: { onNeedSignIn: () => void }) {
  const { session, signOut, seedPhrase, markBackedUp } = useSession();
  const toast = useToast();
  const rate = useNgnRate();
  const cfg = nearConfig();
  const [wallet, setWallet] = useState<bigint | null>(null);
  const [escrow, setEscrow] = useState<bigint | null>(null);
  const [busy, setBusy] = useState('');
  const [showPhrase, setShowPhrase] = useState(false);
  const [isArbiter, setIsArbiter] = useState(false);
  const { t } = useT();

  const load = useCallback(() => {
    if (!session) return;
    chain.usdcBalance(session.accountId).then(setWallet).catch(() => setWallet(0n));
    chain.balance(session.accountId).then(setEscrow).catch(() => setEscrow(0n));
  }, [session]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!session) return;
    chain.config().then(async (c) => {
      const policy = await daoPolicy(c.arbiter);
      setIsArbiter(c.arbiter === session.accountId || (!!policy && council(policy).includes(session.accountId)));
    }).catch(() => {});
  }, [session]);

  if (!session) return <div className="pt-6"><Empty icon={<UserRound className="h-6 w-6" />} title="No account yet"><button className="btn-primary mt-3" onClick={onNeedSignIn}>Get started</button></Empty></div>;

  async function withdraw() {
    setBusy('withdraw');
    try {
      const r = await session!.call(cfg.escrow, 'withdraw', {});
      if (!r.ok) throw new Error(r.error ?? 'Withdrawal failed. Try again.');
      if (r.events.some((e) => e.event === 'withdraw_failed')) throw new Error('USDC could not be sent to your account (is it registered with USDC?). Your balance is safe in the escrow.');
      toast('ok', 'Withdrawn to your NEAR account.', txUrl(r.hash));
      load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function faucet() {
    setBusy('faucet');
    try {
      await api('/api/faucet', { accountId: session!.accountId });
      toast('ok', 'Added 2,000 test USDC');
      load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const phrase = seedPhrase();
  return (
    <div className="space-y-4 pt-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-4 lg:space-y-0">
      <div className="animate-fade-up space-y-4 lg:col-start-1 lg:row-start-1">
      <div className="card space-y-1 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">{session.kind === 'device' ? 'Handova account · gasless' : 'NEAR wallet'}</p>
        <a href={accountUrl(session.accountId)} target="_blank" rel="noreferrer" className="flex items-center gap-1 break-all font-display text-lg font-bold">{session.accountId} <ExternalLink className="h-4 w-4 shrink-0 text-faint" /></a>
      </div>

      <div className="card space-y-2 p-4">
        <p className="text-sm font-semibold text-ink2">{t('I use Handova as')}</p>
        <RoleSwitch />
        <p className="text-xs text-faint">{t('This only changes which pages your menu shows. You can rent and let homes with the same account.')}</p>
      </div>

      {session.needsBackup && phrase && (
        <div className="card space-y-3 border-warn/40 p-4">
          <p className="flex items-center gap-2 font-semibold text-warn"><ShieldAlert className="h-5 w-5" /> Write down your recovery phrase</p>
          <p className="text-sm text-sub">It's the only way back into {session.accountId} if you lose this phone. Anyone with it controls your money — never share it, not even with Handova.</p>
          {showPhrase ? (
            <>
              <ol className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-3 font-mono text-sm">{phrase.split(' ').map((w, i) => <li key={i}><span className="text-faint">{i + 1}.</span> {w}</li>)}</ol>
              <button className="btn-primary w-full" onClick={() => { markBackedUp(); setShowPhrase(false); toast('ok', 'Saved. Keep it somewhere safe.'); }}>I've written it down</button>
            </>
          ) : (
            <button className="btn-ghost w-full" onClick={() => setShowPhrase(true)}><Eye className="h-4 w-4" /> Show phrase</button>
          )}
        </div>
      )}

      {isArbiter && <a href="#/arbiter" className="btn-ghost w-full"><Scale className="h-4 w-4" /> Arbiter desk</a>}
      <a href={`#/passport/${session.accountId}`} className="btn-ghost w-full"><ScrollText className="h-4 w-4" /> {t('My rental passport')}</a>
      </div>

      <div className="animate-fade-up space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" style={{ animationDelay: '80ms' }}>
      <div className="card p-4">
        <Row k="USDC in your account" v={wallet === null ? '…' : <>{usd(usdc(wallet))} <span className="text-faint">≈ {naira(usdc(wallet), rate)}</span></>} />
        <Row k="Ready to withdraw from escrow" v={escrow === null ? '…' : <>{usd(usdc(escrow))} <span className="text-faint">≈ {naira(usdc(escrow), rate)}</span></>} strong />
        <p className="mt-1 text-xs text-sub">Rent you received, refunds and returned caution fees wait here until you withdraw.</p>
        <button className="btn-primary mt-3 w-full" disabled={!escrow || !!busy} onClick={withdraw}><Busy busy={busy === 'withdraw'}><ArrowDownToLine className="h-4 w-4" /> {t('Withdraw to my account')}</Busy></button>
        {cfg.tokenOpenMint && <button className="btn-ghost mt-2 w-full" disabled={!!busy} onClick={faucet}><Busy busy={busy === 'faucet'}>Get 2,000 test USDC</Busy></button>}
      </div>

      <CashOut balance={wallet} />
      </div>

      <div className="space-y-4 lg:col-start-1 lg:row-start-2">

      {session.kind === 'device' && !session.needsBackup && phrase && (
        <button className="btn-ghost w-full" onClick={() => setShowPhrase((v) => !v)}><Eye className="h-4 w-4" /> {showPhrase ? 'Hide' : 'Show'} recovery phrase</button>
      )}
      {session.kind === 'device' && !session.needsBackup && showPhrase && phrase && <p className="rounded-xl bg-muted p-3 font-mono text-sm">{phrase}</p>}

      <button className="btn-danger w-full" onClick={() => signOut().then(() => toast('ok', 'Signed out'))}><LogOut className="h-4 w-4" /> {t('Sign out')}</button>
      {session.kind === 'device' && <p className="text-center text-xs text-sub">Signing out removes the key from this device. Make sure your recovery phrase is written down.</p>}
      </div>

      <div className="pt-4 text-center text-xs text-faint lg:col-span-2">
        Escrow <a className="underline" href={accountUrl(cfg.escrow)} target="_blank" rel="noreferrer">{cfg.escrow}</a> on NEAR {cfg.network}
      </div>
    </div>
  );
}

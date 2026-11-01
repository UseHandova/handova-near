import { useEffect, useState } from 'react';
import { useT } from './lib/i18n';
import { Building2, Home, KeyRound, UserRound } from 'lucide-react';
import { api, type NearConfig } from './lib/api';
import { initNear } from './lib/near';
import { go, useRoute } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './lib/toast';
import { LANGS, LangProvider, type Lang } from './lib/i18n';
import { Spinner } from './components/ui';
import { SignInSheet } from './components/SignIn';
import { Browse } from './components/Browse';
import { ListingDetail } from './components/ListingDetail';
import { MyRentals } from './components/MyRentals';
import { LeaseView } from './components/LeaseView';
import { Landlord } from './components/Landlord';
import { ListHome } from './components/ListHome';
import { AccountPage } from './components/AccountPage';
import { ArbiterDesk } from './components/ArbiterDesk';
import { Passport } from './components/Passport';

export default function App() {
  const [cfg, setCfg] = useState<NearConfig | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<NearConfig>('/api/near/config')
      .then((c) => { initNear(c); setCfg(c); })
      .catch(() => setErr("Can't reach the Handova server. Check your connection and reload."));
  }, []);
  if (err) return <div className="mx-auto max-w-md p-8 text-center text-sub">{err}</div>;
  if (!cfg) return <div className="flex h-dvh items-center justify-center text-sub"><Spinner className="h-6 w-6" /></div>;
  return (
    <LangProvider>
      <ToastProvider>
        <SessionProvider>
          <Shell cfg={cfg} />
        </SessionProvider>
      </ToastProvider>
    </LangProvider>
  );
}

function Shell({ cfg }: { cfg: NearConfig }) {
  const route = useRoute();
  const { session } = useSession();
  const [signIn, setSignIn] = useState(false);
  const { t, lang, setLang } = useT();
  const tr = t;
  const need = () => setSignIn(true);
  const [page, id] = route;

  let body;
  if (page === 'home' && id) body = <ListingDetail id={Number(id)} onNeedSignIn={need} />;
  else if (page === 'rentals') body = <MyRentals onNeedSignIn={need} />;
  else if (page === 'lease' && id) body = <LeaseView id={Number(id)} />;
  else if (page === 'landlord') body = <Landlord onNeedSignIn={need} />;
  else if (page === 'list') body = <ListHome onNeedSignIn={need} />;
  else if (page === 'account') body = <AccountPage onNeedSignIn={need} />;
  else if (page === 'arbiter') body = <ArbiterDesk />;
  else if (page === 'passport' && id) body = <Passport accountId={decodeURIComponent(id)} />;
  else body = <Browse />;

  const tabs = [
    { path: '', icon: Home, label: 'Homes', active: !page || page === 'home' },
    { path: 'rentals', icon: KeyRound, label: 'My rentals', active: page === 'rentals' || page === 'lease' },
    { path: 'landlord', icon: Building2, label: 'Landlord', active: page === 'landlord' || page === 'list' },
    { path: 'account', icon: UserRound, label: 'Account', active: page === 'account' },
  ];

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24">
      <header className="sticky top-0 z-40 flex items-center justify-between bg-bg/80 px-4 py-3 backdrop-blur">
        <a href="#/" className="flex items-center gap-2">
          <img src="/handova-mark.svg" alt="" className="h-8 w-8" />
          <span className="font-display text-lg font-bold">Handova</span>
          {cfg.network === 'testnet' && <span className="chip !py-0.5 !text-[10px] uppercase tracking-wide">testnet</span>}
        </a>
        <div className="flex min-w-0 items-center gap-2">
          <select aria-label={t('Language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-line bg-surface px-1.5 py-1.5 text-xs font-semibold text-ink2">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          {session ? (
            <button onClick={() => go('/account')} className="chip max-w-[40vw] truncate !bg-accent-soft !text-accent">{session.accountId}</button>
          ) : (
            <button onClick={need} className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white">{t('Get started')}</button>
          )}
        </div>
      </header>
      <main className="px-4">{body}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid max-w-md grid-cols-4">
          {tabs.map((tab) => (
            <a key={tab.label} href={`#/${tab.path}`} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${tab.active ? 'text-accent' : 'text-faint'}`}>
              <tab.icon className="h-5 w-5" />
              {tr(tab.label)}
            </a>
          ))}
        </div>
      </nav>
      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
    </div>
  );
}

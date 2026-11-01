import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { Globe2, Home, Lock, RotateCcw } from 'lucide-react';
import { chain } from '../lib/near';
import type { Lease, Listing } from '../lib/types';
import { usd, usdc } from '../lib/money';
import { ListingCard } from './ListingCard';
import { Empty, Spinner } from './ui';

export function Browse() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [takeovers, setTakeovers] = useState<Lease[]>([]);
  const { t } = useT();
  const [err, setErr] = useState('');
  useEffect(() => {
    chain.listings().then((ls) => setListings(ls.reverse())).catch(() => setErr("Couldn't load homes from NEAR. Pull to refresh or try again shortly."));
    chain.allLeases().then((ls) => setTakeovers(ls.filter((l) => l.status === 'Active' && l.takeover?.landlord_consent))).catch(() => {});
  }, []);

  return (
    <div className="space-y-5 pt-2">
      <section>
        <h1 className="font-display text-[28px] font-bold leading-tight">{t('Rent straight from the landlord.')} <span className="text-accent">{t('No agent fee.')}</span></h1>
        <p className="mt-2 text-[15px] text-sub">{t('Your rent waits in escrow on NEAR until you move in. Your caution fee comes back when you leave. Family abroad can pay from any chain.')}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px] font-semibold text-ink2">
          <div className="card p-3"><Lock className="mx-auto mb-1 h-5 w-5 text-accent" />{t('Rent held until move-in')}</div>
          <div className="card p-3"><RotateCcw className="mx-auto mb-1 h-5 w-5 text-accent" />{t('Caution comes back')}</div>
          <div className="card p-3"><Globe2 className="mx-auto mb-1 h-5 w-5 text-accent" />{t('Pay from any chain')}</div>
        </div>
      </section>

      {takeovers.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">{t('Take over a lease')}</h2>
          <p className="text-sm text-sub">A tenant is leaving early and the landlord has agreed. Pay their price and the home, and its caution fee, pass to you.</p>
          {takeovers.map((l) => (
            <a key={l.id} href={`#/lease/${l.id}`} className="card flex items-center justify-between gap-3 p-4">
              <span className="font-semibold">Lease #{l.id} · listing #{l.listing_id}</span>
              <span className="chip !bg-accent-soft !text-accent">{usd(usdc(l.takeover!.price))}</span>
            </a>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">{t('Homes')}</h2>
        {err && <p className="text-sm text-danger">{err}</p>}
        {!listings && !err && <div className="flex justify-center py-10 text-sub"><Spinner className="h-6 w-6" /></div>}
        {listings?.length === 0 && (
          <Empty icon={<Home className="h-6 w-6" />} title="No homes listed yet">
            Landlords: <a className="font-semibold text-accent" href="#/list">list your first home</a> — it takes a voice note.
          </Empty>
        )}
        {listings?.map((l) => <ListingCard key={l.id} l={l} />)}
      </section>
    </div>
  );
}

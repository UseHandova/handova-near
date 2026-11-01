import { useEffect, useState } from 'react';
import { Globe2, Home, Lock, RotateCcw } from 'lucide-react';
import { chain } from '../lib/near';
import type { Listing } from '../lib/types';
import { ListingCard } from './ListingCard';
import { Empty, Spinner } from './ui';

export function Browse() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    chain.listings().then((ls) => setListings(ls.reverse())).catch(() => setErr("Couldn't load homes from NEAR. Pull to refresh or try again shortly."));
  }, []);

  return (
    <div className="space-y-5 pt-2">
      <section>
        <h1 className="font-display text-[28px] font-bold leading-tight">Rent straight from the landlord. <span className="text-accent">No agent fee.</span></h1>
        <p className="mt-2 text-[15px] text-sub">Your rent waits in escrow on NEAR until you move in. Your caution fee comes back when you leave. Family abroad can pay from any chain.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px] font-semibold text-ink2">
          <div className="card p-3"><Lock className="mx-auto mb-1 h-5 w-5 text-accent" />Rent held until move-in</div>
          <div className="card p-3"><RotateCcw className="mx-auto mb-1 h-5 w-5 text-accent" />Caution comes back</div>
          <div className="card p-3"><Globe2 className="mx-auto mb-1 h-5 w-5 text-accent" />Pay from any chain</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Homes</h2>
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

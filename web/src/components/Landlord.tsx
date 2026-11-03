import { useEffect, useState } from 'react';
import { Building2, Mic, Plus } from 'lucide-react';
import { decodeDetails } from '../lib/listing';
import { naira, usdc, useNgnRate } from '../lib/money';
import { chain } from '../lib/near';
import { useSession } from '../lib/session';
import type { Lease, Listing } from '../lib/types';
import { LeaseRow } from './MyRentals';
import { Empty, Spinner } from './ui';
import { VerifyIdentity } from './VerifyIdentity';

export function Landlord({ onNeedSignIn }: { onNeedSignIn: () => void }) {
  const { session } = useSession();
  const rate = useNgnRate();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);

  useEffect(() => {
    if (!session) return;
    chain.listings().then((ls) => setListings(ls.filter((l) => l.landlord === session.accountId).reverse())).catch(() => setListings([]));
    chain.leasesFor(session.accountId).then((ls) => setLeases(ls.filter((l) => l.landlord === session.accountId))).catch(() => {});
  }, [session]);

  if (!session) {
    return (
      <div className="space-y-4 pt-6">
        <Empty icon={<Building2 className="h-6 w-6" />} title="Rent out your home without an agent">
          Tenants pay into escrow first, so you know the money is real. You're paid the moment they move in.
          <button className="btn-primary mt-3 w-full" onClick={onNeedSignIn}>Get started</button>
        </Empty>
      </div>
    );
  }

  const needsAction = leases.filter((l) => l.status === 'Pending' || l.status === 'Ending' || l.status === 'Disputed');
  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Landlord</h1>
        <a href="#/list" className="btn-primary !py-2.5"><Plus className="h-4 w-4" /> List a home</a>
      </div>

      <VerifyIdentity />

      {needsAction.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-warn">Needs your attention</h2>
          {needsAction.map((l) => <LeaseRow key={l.id} l={l} me={session.accountId} />)}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Your homes</h2>
        {!listings && <div className="flex justify-center py-6 text-sub"><Spinner /></div>}
        {listings?.length === 0 && (
          <Empty icon={<Mic className="h-6 w-6" />} title="List your first home">
            Send a voice note in English, Pidgin, Yorùbá or Hausa — NEAR AI drafts the listing for you to check.
            <a href="#/list" className="btn-primary mt-3 w-full">List a home</a>
          </Empty>
        )}
        {listings?.map((l) => {
          const d = decodeDetails(l.property_ref, l.id);
          return (
            <a key={l.id} href={`#/home/${l.id}`} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{d.title}</p>
                <p className="text-sm text-sub">{naira(usdc(l.rent), rate)} / {l.term_months === 12 ? 'year' : `${l.term_months} mo`}</p>
              </div>
              <span className={`chip ${l.active_lease ? '!bg-accent-soft !text-accent' : ''}`}>{l.active_lease ? `Lease #${l.active_lease}` : l.available ? 'Open' : 'Paused'}</span>
            </a>
          );
        })}
      </section>

      {leases.length > needsAction.length && (
        <section className="space-y-2">
          <h2 className="font-semibold">All leases</h2>
          {leases.filter((l) => !needsAction.includes(l)).map((l) => <LeaseRow key={l.id} l={l} me={session.accountId} />)}
        </section>
      )}
    </div>
  );
}

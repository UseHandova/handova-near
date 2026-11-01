import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { chain } from '../lib/near';
import { useSession } from '../lib/session';
import type { Lease } from '../lib/types';
import { LeaseRow } from './MyRentals';
import { Empty, Spinner } from './ui';

/** Leases waiting for the arbiter: disputed handovers and disputed caution fees. */
export function ArbiterDesk() {
  const { session } = useSession();
  const [arbiter, setArbiter] = useState<string | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);

  useEffect(() => {
    chain.config().then((c) => setArbiter(c.arbiter)).catch(() => setArbiter(''));
    chain.allLeases()
      .then((ls) => setLeases(ls.filter((l) => (l.status === 'Pending' && l.move_in_dispute) || l.status === 'Disputed').reverse()))
      .catch(() => setLeases([]));
  }, []);

  if (arbiter !== null && session?.accountId !== arbiter) {
    return <div className="pt-6"><Empty icon={<Scale className="h-6 w-6" />} title="Arbiter only">The arbiter for this escrow is {arbiter}.</Empty></div>;
  }
  return (
    <div className="space-y-3 pt-2">
      <h1 className="font-display text-2xl font-bold">Arbiter desk</h1>
      <p className="text-sm text-sub">You can only rule on disputed handovers (move in or full refund) and split a disputed caution fee. You can't move any other money.</p>
      {!leases && <div className="flex justify-center py-10 text-sub"><Spinner className="h-6 w-6" /></div>}
      {leases?.length === 0 && <Empty icon={<Scale className="h-6 w-6" />} title="Nothing to decide" />}
      {session && leases?.map((l) => <LeaseRow key={l.id} l={l} me={session.accountId} />)}
    </div>
  );
}

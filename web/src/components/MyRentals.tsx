import { useEffect, useState } from 'react';
import { ChevronRight, KeyRound } from 'lucide-react';
import { usd, usdc } from '../lib/money';
import { chain, shortAccount } from '../lib/near';
import { useSession } from '../lib/session';
import type { Lease } from '../lib/types';
import { Empty, Spinner, StatusPill } from './ui';

export function LeaseRow({ l, me }: { l: Lease; me: string }) {
  const role = l.landlord === me ? 'You are the landlord' : l.tenant === me ? (l.payer === me ? 'You pay and live here' : `Paid by ${shortAccount(l.payer)}`) : l.payer === me ? `You paid for ${shortAccount(l.tenant)}` : l.nft_holder === me ? 'You hold this lease NFT' : 'Waiting for your decision';
  return (
    <a href={`#/lease/${l.id}`} className="card flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2"><span className="font-display font-bold">Lease #{l.id}</span><StatusPill status={l.status} /></div>
        <p className="truncate text-sm text-sub">{role} · {usd(usdc(BigInt(l.rent) + BigInt(l.caution)))}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-faint" />
    </a>
  );
}

export function MyRentals({ onNeedSignIn }: { onNeedSignIn: () => void }) {
  const { session } = useSession();
  const [leases, setLeases] = useState<Lease[] | null>(null);
  useEffect(() => {
    if (!session) return;
    chain.leasesFor(session.accountId).then((ls) => setLeases(ls.filter((l) => l.landlord !== session.accountId))).catch(() => setLeases([]));
  }, [session]);

  if (!session) {
    return (
      <div className="pt-6">
        <Empty icon={<KeyRound className="h-6 w-6" />} title="Your rentals live here">
          <button className="btn-primary mt-3" onClick={onNeedSignIn}>Get started</button>
        </Empty>
      </div>
    );
  }
  return (
    <div className="space-y-3 pt-2">
      <h1 className="font-display text-2xl font-bold">My rentals</h1>
      {!leases && <div className="flex justify-center py-10 text-sub"><Spinner className="h-6 w-6" /></div>}
      {leases?.length === 0 && <Empty icon={<KeyRound className="h-6 w-6" />} title="No rentals yet"><a href="#/" className="font-semibold text-accent">Find a home</a> — or pay for someone else's.</Empty>}
      <div className="grid gap-3 lg:grid-cols-2">{leases?.map((l) => <LeaseRow key={l.id} l={l} me={session.accountId} />)}</div>
    </div>
  );
}

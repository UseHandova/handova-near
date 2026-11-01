import { useCallback, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { council, daoPolicy, describeRuling, proposalsFor, proposeRuling, threshold, vote, type DaoPolicy, type Proposal } from '../lib/dao';
import { accountUrl, shortAccount, txUrl } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Lease } from '../lib/types';
import { Busy } from './ui';

/** Disputes decided by a Sputnik DAO council instead of one person. */
export function DaoRulings({ lease, arbiter, onChange }: { lease: Lease; arbiter: string; onChange: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const [policy, setPolicy] = useState<DaoPolicy | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState('');
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    const p = await daoPolicy(arbiter);
    setPolicy(p);
    if (p) setProposals(await proposalsFor(arbiter, lease.id).catch(() => []));
  }, [arbiter, lease.id]);
  useEffect(() => { load(); }, [load, lease.status]);

  const moveInDispute = lease.status === 'Pending' && !!lease.move_in_dispute;
  const cautionDispute = lease.status === 'Disputed';
  if (!policy || (!moveInDispute && !cautionDispute && proposals.length === 0)) return null;
  const members = council(policy);
  const isMember = !!session && members.includes(session.accountId);
  const caution = Number(lease.caution) / 1e6;
  const claim = lease.dispute ? Number(lease.dispute.landlord_claim) / 1e6 : caution;

  async function run(key: string, fn: () => Promise<{ ok: boolean; hash: string; error?: string }>, done: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.error ?? 'The DAO did not accept that. Try again.');
      toast('ok', done, txUrl(r.hash));
      await load();
      onChange();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold"><Landmark className="h-5 w-5 text-accent" /> Decided by the arbiter DAO</p>
      <p className="text-sm text-sub">
        <a className="text-accent" href={accountUrl(arbiter)} target="_blank" rel="noreferrer">{shortAccount(arbiter)}</a> is a Sputnik DAO. A ruling passes with {threshold(policy)} ({members.length} members); then the DAO itself calls the escrow.
      </p>

      {proposals.map((p) => {
        const [yes, no] = p.vote_counts.council ?? [0, 0, 0];
        const voted = session ? p.votes[session.accountId] : undefined;
        return (
          <div key={p.id} className="rounded-xl border border-line p-3 text-sm">
            <p className="font-semibold">Proposal #{p.id}: {describeRuling(p)}</p>
            <p className="text-sub">{p.status === 'InProgress' ? 'Voting' : p.status} · {yes} approve · {no} reject · proposed by {shortAccount(p.proposer)}</p>
            {isMember && p.status === 'InProgress' && !voted && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button className="btn-primary !py-2" disabled={!!busy} onClick={() => run(`a${p.id}`, () => vote(session!, arbiter, p, true), 'Vote recorded.')}><Busy busy={busy === `a${p.id}`}>Approve</Busy></button>
                <button className="btn-danger !py-2" disabled={!!busy} onClick={() => run(`r${p.id}`, () => vote(session!, arbiter, p, false), 'Vote recorded.')}><Busy busy={busy === `r${p.id}`}>Reject</Busy></button>
              </div>
            )}
            {voted && <p className="mt-1 text-xs text-faint">You voted: {voted}</p>}
          </div>
        );
      })}

      {isMember && moveInDispute && !proposals.some((p) => p.status === 'InProgress') && (
        <div className="grid gap-2">
          <button className="btn-ghost w-full" disabled={!!busy} onClick={() => run('pm1', () => proposeRuling(session!, arbiter, policy, 'resolve_move_in', { lease_id: lease.id, moved_in: true }, `Lease #${lease.id}: the tenant moved in`), 'Proposed to the council.')}><Busy busy={busy === 'pm1'}>Propose: the tenant moved in</Busy></button>
          <button className="btn-ghost w-full" disabled={!!busy} onClick={() => run('pm0', () => proposeRuling(session!, arbiter, policy, 'resolve_move_in', { lease_id: lease.id, moved_in: false }, `Lease #${lease.id}: refund the payer`), 'Proposed to the council.')}><Busy busy={busy === 'pm0'}>Propose: refund the payer</Busy></button>
        </div>
      )}
      {isMember && cautionDispute && !proposals.some((p) => p.status === 'InProgress') && (
        <div className="space-y-2">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={`USDC the landlord keeps, 0 to ${claim}`} aria-label="DAO ruling amount" />
          <button className="btn-ghost w-full" disabled={!!busy || amount === '' || Number(amount) > claim} onClick={() => run('pd', () => proposeRuling(session!, arbiter, policy, 'resolve_dispute', { lease_id: lease.id, landlord_amount: String(Math.round(Number(amount) * 1e6)) }, `Lease #${lease.id}: landlord keeps ${amount} USDC`), 'Proposed to the council.')}><Busy busy={busy === 'pd'}>Propose this split</Busy></button>
        </div>
      )}
      {isMember && <p className="text-xs text-faint">Proposing locks the DAO's proposal bond ({Number(BigInt(policy.proposal_bond) / 10n ** 21n) / 1000} NEAR) from your account until the vote ends.</p>}
    </div>
  );
}

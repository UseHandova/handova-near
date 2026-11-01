import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import { teraToGas } from 'near-api-js';
import { decodeDetails } from '../lib/listing';
import { naira, usd, usdc, useNgnRate } from '../lib/money';
import { accountUrl, chain, getProvider, nearConfig, shortAccount, txUrl } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Lease, Listing, Timeouts } from '../lib/types';
import { Busy, fmtDate, Row, Spinner, StatusPill, timeLeft } from './ui';

type Nft = Awaited<ReturnType<typeof chain.nftToken>>;

export function LeaseView({ id }: { id: number }) {
  const { session } = useSession();
  const toast = useToast();
  const rate = useNgnRate();
  const [lease, setLease] = useState<Lease | null | undefined>(undefined);
  const [listing, setListing] = useState<Listing | null>(null);
  const [nft, setNft] = useState<Nft>(null);
  const [t, setT] = useState<Timeouts | null>(null);
  const [arbiter, setArbiter] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // Re-render as deadlines pass, so buttons like "Claim the rent" appear without a reload.
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const l = await chain.lease(id).catch(() => null);
    setLease(l);
    if (!l) return;
    chain.listing(l.listing_id).then(setListing).catch(() => {});
    chain.nftToken(id).then(setNft).catch(() => setNft(null));
  }, [id]);

  useEffect(() => { load(); chain.config().then((c) => { setT(c.timeouts); setArbiter(c.arbiter); }).catch(() => {}); }, [load]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 3000);
    // Pick up the other side's actions (handover, approval…) while the page is open.
    const poll = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  if (lease === undefined) return <div className="flex justify-center py-16 text-sub"><Spinner className="h-6 w-6" /></div>;
  if (lease === null) return <p className="py-16 text-center text-sub">Lease #{id} doesn't exist.</p>;

  const me = session?.accountId;
  const holder = lease.nft_holder ?? lease.tenant;
  const isTenant = me === lease.tenant;
  const isHolder = me === holder;
  const isLandlord = me === lease.landlord;
  const isPayer = me === lease.payer;
  const isArbiter = !!me && me === arbiter;
  const details = listing ? decodeDetails(listing.property_ref, listing.id) : null;
  const caution = usdc(lease.caution);
  const s = (secs?: number) => (secs ?? 0) * 1000;

  async function act(method: string, args: object = {}, label: string, opts: { deposit?: bigint } = {}) {
    if (!session) return;
    setBusy(method);
    try {
      const r = await session.call(nearConfig().escrow, method, { lease_id: lease!.id, ...args }, { gas: teraToGas('100'), ...opts });
      if (!r.ok) throw new Error(r.error ?? 'That did not go through. Try again.');
      toast('ok', label, txUrl(r.hash));
      setAmount(''); setReason('');
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  /** NEP-171 transfer needs 1 yoctoNEAR, which the relayer never pays — so the holder signs it directly. */
  async function transferLease() {
    if (!session) return;
    const cfg = nearConfig();
    const receiver = to.includes('.') || to.length === 64 ? to : `${to}.${cfg.accountParent}`;
    setBusy('nft_transfer');
    try {
      await getProvider().viewAccount({ accountId: receiver }).catch(() => { throw new Error(`${receiver} doesn't exist. Check the name.`); });
      const r = await session.callDirect(cfg.escrow, 'nft_transfer', { receiver_id: receiver, token_id: String(lease!.id) }, { deposit: 1n, gas: teraToGas('10') });
      if (!r.ok) throw new Error(r.error ?? 'The transfer did not go through.');
      toast('ok', `Lease NFT sent to ${receiver}. The caution fee now belongs to them.`, txUrl(r.hash));
      setTo('');
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const btn = (method: string, label: string, done: string, args: object = {}, kind = 'btn-primary', disabled = false) => (
    <button key={method + label} className={`${kind} w-full`} disabled={!!busy || disabled} onClick={() => act(method, args, done)}>
      <Busy busy={busy === method}>{label}</Busy>
    </button>
  );

  // Actions this person can take right now, following the contract's rules.
  const actions: JSX.Element[] = [];
  const notes: string[] = [];
  if (lease.status === 'Pending' && t) {
    const cancelAt = lease.paid_at_ms + s(t.cancel_after_secs);
    const claimAt = (lease.handover_at_ms ?? 0) + s(t.handover_claim_secs);
    const verifiedLandlord = !!listing?.landlord_verified;
    if (isTenant) {
      actions.push(btn('confirm_move_in', 'I have the keys — confirm move-in', 'Moved in! The landlord is paid and your lease NFT holds your caution fee.'));
      if (lease.handover_at_ms && !lease.move_in_dispute) {
        notes.push(verifiedLandlord
          ? `The landlord says they handed over the keys. If you don't respond in ${timeLeft(claimAt - now)}, the landlord can claim the rent.`
          : 'The landlord says they handed over the keys. The rent stays in escrow until you confirm.');
        actions.push(
          <div key="dmi" className="space-y-2 rounded-xl border border-line p-3">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened? e.g. no keys, house locked" maxLength={500} />
            <button className="btn-danger w-full" disabled={!!busy || reason.length < 5} onClick={() => act('dispute_move_in', { reason }, 'Dispute sent. The landlord can no longer claim the rent; the arbiter will decide.')}><Busy busy={busy === 'dispute_move_in'}>I didn't get the keys</Busy></button>
          </div>,
        );
      }
    }
    if ((isTenant || isPayer) && !lease.handover_at_ms) {
      if (now >= cancelAt) actions.push(btn('cancel_lease', 'Cancel and get a full refund', `Cancelled. ${usd(usdc(BigInt(lease.rent) + BigInt(lease.caution)))} is back in ${lease.payer}'s Handova balance.`, {}, 'btn-danger'));
      else notes.push(`If the landlord doesn't hand over within ${timeLeft(cancelAt - now)}, ${isPayer && !isTenant ? 'you' : 'the payer'} can cancel for a full refund.`);
    }
    if (lease.move_in_dispute_at_ms) {
      const decideBy = lease.move_in_dispute_at_ms + s(t.dispute_secs);
      if (now >= decideBy) actions.push(btn('settle_move_in_timeout', "Refund the payer (arbiter didn't decide in time)", 'Refunded. The payer got everything back.', {}, 'btn-ghost'));
      else if (!isArbiter) notes.push(`The arbiter has ${timeLeft(decideBy - now)} to decide. If they don't, the payer is refunded in full.`);
    }
    if (isArbiter && lease.move_in_dispute) {
      notes.push(`Handover disputed by the tenant: "${lease.move_in_dispute}". You are the arbiter.`);
      actions.push(btn('resolve_move_in', 'Rule: the tenant moved in — pay the landlord', 'Ruled: moved in. Rent paid to the landlord, lease NFT minted.', { moved_in: true }, 'btn-ghost'));
      actions.push(btn('resolve_move_in', 'Rule: no handover — refund the payer', 'Ruled: refund. The payer got everything back.', { moved_in: false }, 'btn-danger'));
    }
    if (isLandlord) {
      if (!lease.handover_at_ms) actions.push(btn('mark_handover', "I've handed over the keys", 'Handover marked. The tenant has 3 days to confirm.'));
      else if (lease.move_in_dispute) notes.push(`The tenant disputed the handover: "${lease.move_in_dispute}". The arbiter decides; you can also decline and refund.`);
      else if (!verifiedLandlord) notes.push('Waiting for the tenant to confirm. Only ID-verified landlords can collect if the tenant stays silent.');
      else if (now >= claimAt) actions.push(btn('claim_move_in', 'Claim the rent (tenant silent)', 'Move-in claimed. Rent added to your balance.'));
      else notes.push(`Waiting for the tenant to confirm. If they stay silent, you can claim in ${timeLeft(claimAt - now)}.`);
      actions.push(btn('cancel_lease', 'Decline and refund the tenant', 'Declined. The payer was refunded in full.', {}, 'btn-danger'));
    }
  }
  if (lease.status === 'Active') {
    if (isHolder) {
      actions.push(btn('move_out', "I'm moving out", 'Move-out started. The landlord has 7 days to review.', {}, 'btn-ghost'));
      actions.push(
        <div key="nft" className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Pass this lease to someone else</p>
          <p className="text-xs text-sub">They become the lease holder: they can move out and the caution fee goes to them. Costs a tiny NEAR network fee.</p>
          <input className="input" value={to} onChange={(e) => setTo(e.target.value.toLowerCase().trim())} placeholder={`name  or  name.${nearConfig().accountParent}`} autoCapitalize="none" />
          <button className="btn-ghost w-full" disabled={!!busy || !to} onClick={transferLease}><Busy busy={busy === 'nft_transfer'}>Send lease NFT</Busy></button>
        </div>,
      );
    }
    if (isLandlord && lease.ends_at_ms && now >= lease.ends_at_ms) actions.push(btn('move_out', 'Lease term ended — start move-out', 'Move-out started.', {}, 'btn-ghost'));
  }
  if (lease.status === 'Ending' && t) {
    const until = (lease.move_out_at_ms ?? 0) + s(t.move_out_review_secs);
    if (isLandlord && now < until) {
      actions.push(btn('approve_move_out', 'Home is fine — return the caution', `Approved. ${usd(caution)} returned to ${shortAccount(holder)}.`));
      actions.push(
        <div key="dc" className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Keep part of the caution for damage</p>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={`Amount in USDC (max ${caution})`} />
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was damaged?" maxLength={500} />
          <button className="btn-danger w-full" disabled={!!busy || !amount || Number(amount) <= 0 || Number(amount) > caution || reason.length < 5} onClick={() => act('dispute_caution', { landlord_claim: String(Math.round(Number(amount) * 1e6)), reason }, 'Dispute opened. Agree a split with the tenant, or the arbiter decides.')}>
            <Busy busy={busy === 'dispute_caution'}>Open a dispute</Busy>
          </button>
        </div>,
      );
    }
    if (now >= until) actions.push(btn('claim_caution', 'Return the caution now (review time is over)', 'Caution returned to the lease NFT holder.'));
    else notes.push(`The landlord has ${timeLeft(until - now)} to review. If they say nothing, the caution comes back automatically.`);
  }
  if (lease.status === 'Disputed' && lease.dispute && t) {
    const until = lease.dispute.opened_at_ms + s(t.dispute_secs);
    notes.push(`Landlord asks to keep ${usd(usdc(lease.dispute.landlord_claim))}: "${lease.dispute.reason}".`);
    if (lease.dispute.tenant_offer) notes.push(`Tenant offered the landlord ${usd(usdc(lease.dispute.tenant_offer))}.`);
    if (lease.dispute.landlord_offer) notes.push(`Landlord's latest ask: ${usd(usdc(lease.dispute.landlord_offer))}. When both sides propose the same amount, it settles.`);
    if (isLandlord || isHolder) {
      actions.push(
        <div key="ps" className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Propose how much the landlord keeps</p>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={`USDC, 0 to ${caution}`} />
          <button className="btn-primary w-full" disabled={!!busy || amount === '' || Number(amount) > caution} onClick={() => act('propose_split', { landlord_amount: String(Math.round(Number(amount) * 1e6)) }, 'Proposal sent.')}>
            <Busy busy={busy === 'propose_split'}>Propose</Busy>
          </button>
        </div>,
      );
    }
    if (isArbiter) {
      actions.push(
        <div key="rd" className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Arbiter: decide how much the landlord keeps</p>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={`USDC, 0 to ${caution}`} aria-label="Arbiter amount" />
          <button className="btn-primary w-full" disabled={!!busy || amount === '' || Number(amount) > caution} onClick={() => act('resolve_dispute', { landlord_amount: String(Math.round(Number(amount) * 1e6)) }, 'Decision recorded. Caution split and paid out.')}>
            <Busy busy={busy === 'resolve_dispute'}>Decide</Busy>
          </button>
        </div>,
      );
    }
    if (now >= until) actions.push(btn('settle_dispute_timeout', 'Settle 50/50 (nobody agreed in time)', 'Settled 50/50.', {}, 'btn-ghost'));
    else notes.push(`If nobody agrees in ${timeLeft(until - now)}, the arbiter decides or it splits 50/50.`);
  }

  const steps: Array<[string, number | null, string?]> = [
    ['Paid into escrow', lease.paid_at_ms, lease.payer !== lease.tenant ? `by ${shortAccount(lease.payer)} for ${shortAccount(lease.tenant)}` : undefined],
    ['Keys handed over', lease.handover_at_ms ?? lease.moved_in_at_ms],
    ['Moved in · rent paid to landlord', lease.moved_in_at_ms],
    ['Moved out', lease.move_out_at_ms],
    [lease.status === 'Cancelled' ? 'Cancelled · payer refunded' : 'Caution returned', lease.closed_at_ms, lease.status === 'Closed' ? `${usd(usdc(lease.caution_to_holder))} to holder${BigInt(lease.caution_to_landlord) > 0n ? `, ${usd(usdc(lease.caution_to_landlord))} to landlord` : ''}` : undefined],
  ];

  return (
    <div className="space-y-4 pt-2">
      <a href="#/rentals" className="inline-flex items-center gap-1 text-sm font-semibold text-sub"><ArrowLeft className="h-4 w-4" /> My rentals</a>
      <div className="card space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">Lease #{lease.id}</p>
            <h1 className="font-display text-xl font-bold">{details?.title ?? `Listing #${lease.listing_id}`}</h1>
          </div>
          <StatusPill status={lease.status} />
        </div>
        <Row k="Rent" v={`${usd(usdc(lease.rent))} · ${naira(usdc(lease.rent), rate)}`} />
        <Row k="Caution (refundable)" v={`${usd(caution)} · ${naira(caution, rate)}`} />
        <Row k="Tenant" v={<a className="text-accent" href={accountUrl(lease.tenant)} target="_blank" rel="noreferrer">{shortAccount(lease.tenant)}</a>} />
        <Row k="Landlord" v={<a className="text-accent" href={accountUrl(lease.landlord)} target="_blank" rel="noreferrer">{shortAccount(lease.landlord)}</a>} />
        {lease.ends_at_ms && <Row k="Lease ends" v={fmtDate(lease.ends_at_ms)} />}
      </div>

      <ol className="card space-y-3 p-4">
        {steps.map(([label, at, sub], i) => (
          <li key={i} className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${at ? 'bg-accent text-white' : 'border border-line text-faint'}`}>{at ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            <div>
              <p className={`font-semibold ${at ? '' : 'text-faint'}`}>{label}</p>
              {(at || sub) && <p className="text-xs text-sub">{at ? fmtDate(at) : ''}{sub ? ` · ${sub}` : ''}</p>}
            </div>
          </li>
        ))}
      </ol>

      {nft && (
        <div className="card overflow-hidden">
          <img src={nft.metadata.media} alt={nft.metadata.title} className="w-full" />
          <div className="space-y-1 p-4">
            <p className="font-display font-bold">{nft.metadata.title}</p>
            <p className="text-sm text-sub">{nft.metadata.description}</p>
            <p className="text-xs text-faint">NEP-171 token #{nft.token_id} on {nearConfig().escrow} · held by {shortAccount(nft.owner_id)}. The picture and text update on-chain as the lease changes.</p>
          </div>
        </div>
      )}

      {notes.map((n) => <p key={n} className="rounded-xl bg-muted p-3 text-sm text-ink2">{n}</p>)}
      {actions.length > 0 && <div className="space-y-2">{actions}</div>}
      {!session && <p className="text-center text-sm text-sub">Sign in as the tenant or landlord to act on this lease.</p>}

      <a href={`${nearConfig().explorer}/address/${nearConfig().escrow}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-xs text-faint">
        Escrow contract {nearConfig().escrow} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

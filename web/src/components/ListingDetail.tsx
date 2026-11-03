import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { BadgeCheck, CheckCircle2, ExternalLink, Globe2, KeyRound, Lock, RotateCcw, Wallet } from 'lucide-react';
import { teraToGas } from 'near-api-js';
import { api } from '../lib/api';
import { decodeDetails } from '../lib/listing';
import { naira, usd, usdc, useNgnRate } from '../lib/money';
import { accountUrl, chain, getProvider, nearConfig, shortAccount, txUrl } from '../lib/near';
import { go } from '../lib/router';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Listing } from '../lib/types';
import { IntentsPay } from './IntentsPay';
import { ManageListing } from './ManageListing';
import { Photo } from './ListingCard';
import { Busy, Row, Sheet, Spinner } from './ui';

export function ListingDetail({ id, onNeedSignIn }: { id: number; onNeedSignIn: () => void }) {
  const rate = useNgnRate();
  const { session } = useSession();
  const [l, setL] = useState<Listing | null | undefined>(undefined);
  const [paying, setPaying] = useState(false);
  const { t } = useT();
  const reload = () => chain.listing(id).then(setL).catch(() => setL(null));
  useEffect(() => {
    reload();
    // Pick up the landlord's changes (paused, new price, taken) while the page is open.
    const poll = setInterval(() => { if (!document.hidden) reload(); }, 15000);
    return () => clearInterval(poll);
  }, [id]);

  if (l === undefined) return <div className="flex justify-center py-16 text-sub"><Spinner className="h-6 w-6" /></div>;
  if (l === null) return <p className="py-16 text-center text-sub">This home doesn't exist. <a href="#/" className="font-semibold text-accent">See all homes</a></p>;

  const d = decodeDetails(l.property_ref, l.id);
  const rent = usdc(l.rent);
  const caution = usdc(l.caution);
  const open = l.available && l.active_lease === null;
  const mine = session?.accountId === l.landlord;

  return (
    <div className="space-y-4 pt-2 lg:grid lg:grid-cols-[1.25fr_1fr] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="card animate-fade-up overflow-hidden">
        <div className="flex snap-x snap-mandatory overflow-x-auto">
          {d.video && (
            <video src={d.video} poster={d.photos[0]} controls muted playsInline preload="metadata" className="h-60 w-full shrink-0 snap-center bg-black object-contain lg:h-[26rem]" />
          )}
          {(d.photos.length || !d.video ? (d.photos.length ? d.photos : [undefined]) : []).map((p, i) => <Photo key={i} src={p} className="h-60 w-full shrink-0 snap-center lg:h-[26rem]" />)}
        </div>
        <div className="space-y-2 p-4">
          <h1 className="font-display text-2xl font-bold leading-tight">{d.title}</h1>
          <p className="text-sub">{[d.area, d.city].filter(Boolean).join(', ')}{d.beds ? ` · ${d.beds} bed` : ''}{d.baths ? ` · ${d.baths} bath` : ''}</p>
          {d.description && <p className="text-[15px] text-ink2">{d.description}</p>}
          {!!d.amenities?.length && <div className="flex flex-wrap gap-1.5 pt-1">{d.amenities.map((a) => <span key={a} className="chip">{a}</span>)}</div>}
        </div>
      </div>

      <div className="animate-fade-up space-y-4 lg:sticky lg:top-24" style={{ animationDelay: '80ms' }}>
      <div className="card p-4">
        <Row k={`Rent (${l.term_months === 12 ? '1 year' : `${l.term_months} months`})`} v={<>{naira(rent, rate)} <span className="text-faint">· {usd(rent)}</span></>} />
        <Row k={t('Caution fee (refundable)')} v={<>{naira(caution, rate)} <span className="text-faint">· {usd(caution)}</span></>} />
        <Row k={t('Agent fee')} v={<span className="font-semibold text-ok">₦0</span>} />
        <div className="my-2 border-t border-line" />
        <Row k={t('You pay')} v={naira(rent + caution, rate)} strong />
        <a href={accountUrl(l.landlord)} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm">
          {l.landlord_verified ? <BadgeCheck className="h-5 w-5 text-accent" /> : <KeyRound className="h-5 w-5 text-faint" />}
          <span className="flex-1">Landlord <b>{shortAccount(l.landlord)}</b>{l.landlord_verified ? ' · ID verified' : ' · not verified yet'}</span>
          <ExternalLink className="h-4 w-4 text-faint" />
        </a>
      </div>

      {!mine && (
        <div className="hidden lg:block">
          {open ? (
            <button className="btn-primary w-full" onClick={() => (session ? setPaying(true) : onNeedSignIn())}>Pay {naira(rent + caution, rate)} into escrow</button>
          ) : (
            <button className="btn-ghost w-full" disabled>{l.active_lease !== null ? t('Taken') : t('Paused by the landlord')}</button>
          )}
        </div>
      )}
      <div className="card space-y-3 p-4">
        <h2 className="font-display font-bold">{t('How your money is protected')}</h2>
        {[
          [Lock, 'Pay into escrow', 'Rent and caution wait in a NEAR smart contract — not with the landlord, not with Handova.'],
          [KeyRound, 'Move in, then confirm', 'The landlord is paid only when you confirm you have the keys. No handover in 7 days? Full refund.'],
          [RotateCcw, 'Caution comes back', 'You get a lease NFT that holds your caution fee. At move-out it returns to you unless the landlord shows damage.'],
        ].map(([Icon, t, s]: any) => (
          <div key={t} className="flex gap-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div><p className="font-semibold">{t}</p><p className="text-sm text-sub">{s}</p></div>
          </div>
        ))}
      </div>

      {mine && <ManageListing listing={l} onChanged={reload} />}
      </div>

      <div className="sticky bottom-20 z-30 lg:hidden">
        {mine ? null : open ? (
          <button className="btn-primary w-full shadow-card" onClick={() => (session ? setPaying(true) : onNeedSignIn())}>Pay {naira(rent + caution, rate)} into escrow</button>
        ) : (
          <button className="btn-ghost w-full" disabled>{l.active_lease !== null ? t('Taken') : t('Paused by the landlord')}</button>
        )}
      </div>

      {session && <PaySheet open={paying} onClose={() => setPaying(false)} listing={l} />}
    </div>
  );
}

function PaySheet({ open, onClose, listing }: { open: boolean; onClose: () => void; listing: Listing }) {
  const cfg = nearConfig();
  const rate = useNgnRate();
  const { session } = useSession();
  const toast = useToast();
  const total = BigInt(listing.rent) + BigInt(listing.caution);
  const [forOther, setForOther] = useState(false);
  const [tenantInput, setTenantInput] = useState('');
  const [method, setMethod] = useState<'near' | 'intents'>('near');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useT();

  const refresh = () => session && chain.usdcBalance(session.accountId).then(setBalance).catch(() => setBalance(0n));
  useEffect(() => { if (open) refresh(); }, [open, session?.accountId]);

  const tenantId = forOther ? (tenantInput.includes('.') || tenantInput.length === 64 ? tenantInput : tenantInput && `${tenantInput}.${cfg.accountParent}`) : session!.accountId;

  async function checkTenant(): Promise<string | undefined> {
    if (!forOther) return undefined;
    if (!tenantId) throw new Error("Enter the Handova name or NEAR account of the person who'll live there.");
    if (tenantId === session!.accountId) return undefined;
    await getProvider().viewAccount({ accountId: tenantId }).catch(() => { throw new Error(`${tenantId} doesn't exist. Ask them to create a Handova account first.`); });
    return tenantId;
  }

  async function payEscrow() {
    const tenant = await checkTenant();
    const r = await session!.call(cfg.token, 'ft_transfer_call', {
      receiver_id: cfg.escrow,
      amount: total.toString(),
      msg: JSON.stringify(tenant ? { listing_id: listing.id, tenant } : { listing_id: listing.id }),
    }, { deposit: 1n, gas: teraToGas('150') });
    if (!r.ok) throw new Error(r.error ?? 'The payment failed. Nothing was taken. Try again.');
    const ev = r.events.find((e) => e.event === 'lease_paid');
    if (!ev) throw new Error('The escrow sent your money back — the home may have just been taken.');
    toast('ok', `Paid. ${usd(usdc(total))} is now held in escrow.`, txUrl(r.hash));
    onClose();
    go(`/lease/${ev.data[0].lease_id}`);
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  const enough = balance !== null && balance >= total;

  return (
    <Sheet open={open} onClose={onClose} title={t('Pay into escrow')}>
      <div className="space-y-5">
        <div>
          <p className="label">{t('Who will live here?')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setForOther(false)} className={`btn-ghost !py-2.5 ${!forOther ? '!border-accent !text-accent' : ''}`}>{t('Me')}</button>
            <button onClick={() => setForOther(true)} className={`btn-ghost !py-2.5 ${forOther ? '!border-accent !text-accent' : ''}`}>{t('Someone else')}</button>
          </div>
          {forOther && (
            <div className="mt-2">
              <input className="input" value={tenantInput} onChange={(e) => setTenantInput(e.target.value.toLowerCase().trim())} placeholder={`mum  →  mum.${cfg.accountParent}`} autoCapitalize="none" />
              <p className="mt-1.5 text-xs text-sub">They confirm move-in and get the lease NFT. If it's cancelled, the refund comes back to you.</p>
            </div>
          )}
        </div>

        <div>
          <p className="label">{t('How do you want to pay?')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMethod('near')} className={`card flex flex-col items-start gap-1 p-3 text-left ${method === 'near' ? '!border-accent' : ''}`}>
              <Wallet className="h-5 w-5 text-accent" /><span className="text-sm font-semibold">{t('USDC on NEAR')}</span>
              <span className="text-xs text-sub">{balance === null ? '…' : `Balance ${usd(usdc(balance))}`}</span>
            </button>
            <button onClick={() => setMethod('intents')} className={`card flex flex-col items-start gap-1 p-3 text-left ${method === 'intents' ? '!border-accent' : ''}`}>
              <Globe2 className="h-5 w-5 text-accent" /><span className="text-sm font-semibold">{t('Any other chain')}</span>
              <span className="text-xs text-sub">Base, Solana, Ethereum, Arbitrum… via NEAR Intents</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-muted p-3">
          <Row k={t('Total')} v={<>{usd(usdc(total))} <span className="text-faint">≈ {naira(usdc(total), rate)}</span></>} strong />
          <p className="text-xs text-sub">{session!.kind === 'device' ? 'No gas fee — Handova pays the NEAR network fee for you.' : 'Your wallet pays a tiny NEAR network fee (under ₦10).'}</p>
        </div>

        {method === 'near' ? (
          <div className="space-y-2">
            {!enough && balance !== null && cfg.tokenOpenMint && (
              <button className="btn-ghost w-full" disabled={busy} onClick={() => run(async () => { await api('/api/faucet', { accountId: session!.accountId }); toast('ok', 'Added 2,000 test USDC'); await refresh(); })}>
                <Busy busy={busy}>Get 2,000 test USDC (testnet)</Busy>
              </button>
            )}
            {!enough && balance !== null && !cfg.tokenOpenMint && <p className="text-sm text-warn">Not enough USDC on NEAR. Pay from another chain instead, or top up {session!.accountId}.</p>}
            <button className="btn-primary w-full" disabled={busy || !enough} onClick={() => run(payEscrow)}>
              <Busy busy={busy}><CheckCircle2 className="h-4 w-4" /> Pay {usd(usdc(total))}</Busy>
            </button>
          </div>
        ) : (
          <IntentsPay amountOut={total} recipient={session!.accountId} onArrived={async () => { await refresh(); await run(payEscrow); }} />
        )}
      </div>
    </Sheet>
  );
}

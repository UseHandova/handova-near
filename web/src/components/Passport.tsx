import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { BadgeCheck, ScrollText } from 'lucide-react';
import { usd, usdc } from '../lib/money';
import { chain, shortAccount } from '../lib/near';
import type { RentalRecord } from '../lib/types';
import { Empty, fmtDate, Row, Spinner } from './ui';

/** Short summary for a landlord deciding whether to hand over keys. */
export function PassportSummary({ accountId }: { accountId: string }) {
  const [r, setR] = useState<RentalRecord | null>(null);
  useEffect(() => { chain.passport(accountId).then(setR).catch(() => {}); }, [accountId]);
  if (!r) return null;
  const text = r.leases_completed === 0
    ? `${shortAccount(accountId)} has no finished Handova leases yet.`
    : `${shortAccount(accountId)} finished ${r.leases_completed} lease${r.leases_completed > 1 ? 's' : ''}; caution returned in full ${r.caution_returned_in_full} time${r.caution_returned_in_full === 1 ? '' : 's'}.`;
  return (
    <a href={`#/passport/${accountId}`} className="flex items-center gap-2 rounded-xl bg-accent-soft p-3 text-sm text-ink2">
      <ScrollText className="h-5 w-5 shrink-0 text-accent" />
      <span className="flex-1">Rental passport: {text}</span>
    </a>
  );
}

/** A tenant's on-chain rental record, built from their lease NFTs. */
export function Passport({ accountId }: { accountId: string }) {
  const [r, setR] = useState<RentalRecord | null | undefined>(undefined);
  const { t } = useT();
  useEffect(() => { chain.passport(accountId).then(setR).catch(() => setR(null)); }, [accountId]);
  if (r === undefined) return <div className="flex justify-center py-16 text-sub"><Spinner className="h-6 w-6" /></div>;
  if (r === null) return <Empty icon={<ScrollText className="h-6 w-6" />} title="Couldn't load this passport" />;
  const clean = r.leases_completed > 0 && r.caution_partly_kept === 0;
  return (
    <div className="space-y-4 pt-2">
      <div className="card space-y-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">{t('Rental passport')}</p>
        <h1 className="break-all font-display text-xl font-bold">{accountId}</h1>
        {clean && <p className="flex items-center gap-1.5 text-sm font-semibold text-accent"><BadgeCheck className="h-4 w-4" /> Every caution fee returned in full</p>}
        <p className="text-sm text-sub">Read from the escrow contract on NEAR: every finished lease NFT this account held. Nobody can edit it.</p>
      </div>
      <div className="card p-4">
        <Row k={t('Leases finished')} v={r.leases_completed} strong />
        <Row k={t('Caution returned in full')} v={r.caution_returned_in_full} />
        <Row k="Caution partly kept by a landlord" v={r.caution_partly_kept} />
        <Row k="Caution returned" v={usd(usdc(r.caution_returned_total))} />
        <Row k="Caution kept for damage" v={usd(usdc(r.caution_kept_total))} />
        <div className="my-2 border-t border-line" />
        <Row k="Homes lived in (as tenant, including takeovers)" v={r.leases_moved_in} />
        <Row k="Months rented" v={r.months_rented} />
        <Row k="Rent of those leases" v={usd(usdc(r.rent_paid_total))} />
        <Row k="Leases active now" v={r.active_leases} />
        <Row k="Renting since" v={fmtDate(r.first_move_in_ms)} />
      </div>
    </div>
  );
}

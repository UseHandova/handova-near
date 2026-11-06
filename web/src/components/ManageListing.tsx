import { useEffect, useState } from 'react';
import { teraToGas } from 'near-api-js';
import { naira, usdc, useNgnRate } from '../lib/money';
import { chain, nearAmount, nearConfig, txUrl } from '../lib/near';
import { go } from '../lib/router';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Listing } from '../lib/types';
import { Busy } from './ui';

/** Landlord controls: pause/resume payments, change price while no lease is open, renew or remove the listing. */
export function ManageListing({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const rate = useNgnRate();
  const [busy, setBusy] = useState('');
  const [rentNgn, setRentNgn] = useState('');
  const [cautionNgn, setCautionNgn] = useState('');
  const [leaseStorage, setLeaseStorage] = useState<bigint | null>(null);
  useEffect(() => { chain.config().then((c) => setLeaseStorage(BigInt(c.lease_storage))).catch(() => {}); }, []);
  const locked = listing.active_lease !== null;
  const needsRenewal = leaseStorage !== null && BigInt(listing.storage_credit ?? '0') < leaseStorage;
  const units = (ngn: string) => String(Math.round((Number(ngn) / rate) * 100) * 10_000);

  async function update(args: object, label: string, key: string) {
    if (!session) return;
    setBusy(key);
    try {
      const r = await session.call(nearConfig().escrow, 'update_listing', { listing_id: listing.id, ...args }, { gas: teraToGas('30') });
      if (!r.ok) throw new Error(r.error ?? 'The change did not go through.');
      toast('ok', label, txUrl(r.hash));
      setRentNgn(''); setCautionNgn('');
      onChanged();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  /** Signed and paid by the landlord's own account: it attaches NEAR, which the relayer never does. */
  async function renew() {
    if (!session || leaseStorage === null) return;
    setBusy('renew');
    try {
      const r = await session.callDirect(nearConfig().escrow, 'fund_listing', { listing_id: listing.id }, { gas: teraToGas('10'), deposit: leaseStorage });
      if (!r.ok) throw new Error(r.error ?? 'The renewal did not go through.');
      toast('ok', 'Listing renewed. Tenants can pay again.', txUrl(r.hash));
      onChanged();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!session) return;
    setBusy('remove');
    try {
      const r = await session.call(nearConfig().escrow, 'remove_listing', { listing_id: listing.id }, { gas: teraToGas('30') });
      if (!r.ok) throw new Error(r.error ?? 'The listing was not removed.');
      toast('ok', `Listing removed. ${nearAmount(listing.storage_credit)} went back to your account.`, txUrl(r.hash));
      go('/landlord');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-display font-bold">Manage your listing</h2>
      <p className="text-sm text-sub">
        {locked ? `Lease #${listing.active_lease} is open on this home.` : listing.available ? 'Open — tenants can pay into escrow.' : 'Paused — nobody can pay right now.'}
      </p>
      {!locked && needsRenewal && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm">Each lease keeps its record on NEAR, paid from this listing's storage credit. Add {nearAmount(leaseStorage!)} so the next tenant can pay.</p>
          <button className="btn-primary w-full" disabled={!!busy} onClick={renew}>
            <Busy busy={busy === 'renew'}>Renew listing ({nearAmount(leaseStorage!)})</Busy>
          </button>
        </div>
      )}
      <button className="btn-ghost w-full" disabled={!!busy} onClick={() => update({ available: !listing.available }, listing.available ? 'Listing paused.' : 'Listing open again.', 'avail')}>
        <Busy busy={busy === 'avail'}>{listing.available ? 'Pause listing' : 'Resume listing'}</Busy>
      </button>
      {!locked && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Change price</p>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" inputMode="numeric" aria-label="New rent in Naira" value={rentNgn} onChange={(e) => setRentNgn(e.target.value.replace(/\D/g, ''))} placeholder={`Rent ${naira(usdc(listing.rent), rate)}`} />
            <input className="input" inputMode="numeric" aria-label="New caution in Naira" value={cautionNgn} onChange={(e) => setCautionNgn(e.target.value.replace(/\D/g, ''))} placeholder={`Caution ${naira(usdc(listing.caution), rate)}`} />
          </div>
          <button
            className="btn-primary w-full"
            disabled={!!busy || (!rentNgn && !cautionNgn)}
            onClick={() => update({ ...(rentNgn ? { rent: units(rentNgn) } : {}), ...(cautionNgn ? { caution: units(cautionNgn) } : {}) }, 'Price updated.', 'price')}
          >
            <Busy busy={busy === 'price'}>Save price</Busy>
          </button>
        </div>
      )}
      {!locked && (
        <button className="btn-ghost w-full" disabled={!!busy} onClick={remove}>
          <Busy busy={busy === 'remove'}>Remove listing and get {nearAmount(listing.storage_credit)} back</Busy>
        </button>
      )}
    </div>
  );
}

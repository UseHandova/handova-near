import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Store } from 'lucide-react';
import { teraToGas } from 'near-api-js';
import { api } from '../lib/api';
import { usd, usdc } from '../lib/money';
import { chain, nearConfig, txUrl, view } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Lease } from '../lib/types';
import { Busy } from './ui';

const MILLINEAR = 10n ** 21n;

interface MarketListing { price: string; nft_owner_id: string; currency: string }

/**
 * A lease the landlord agreed to hand over can also be sold on Mintbase's open market contract
 * (NEP-178 approval + NEP-199 payout). Handova is the screen; the market contract runs the sale, and the
 * escrow only lets it complete while the landlord's agreement stands.
 */
export function MintbaseListing({ lease, holder, onChange }: { lease: Lease; holder: string; onChange: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const cfg = nearConfig();
  const market = cfg.mintbaseMarket;
  const [listing, setListing] = useState<MarketListing | null | undefined>(undefined);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (!market) return;
    view<MarketListing | null>(market, 'get_listing', { nft_contract_id: cfg.escrow, token_id: String(lease.id) })
      // A listing left over from a previous holder isn't valid any more.
      .then((l) => setListing(l && l.nft_owner_id === holder ? l : null))
      .catch(() => setListing(null));
  }, [market, cfg.escrow, lease.id, holder]);
  useEffect(() => { load(); }, [load]);

  if (!market || !lease.takeover?.landlord_consent || listing === undefined) return null;
  const me = session?.accountId;
  const isHolder = me === holder;
  // The escrow only completes the sale to the person the landlord agreed to.
  const isApprovedBuyer = !!me && me === lease.takeover.buyer;
  const price = BigInt(lease.takeover.price);
  const explorer = `${cfg.explorer}/address/${market}`;

  async function list() {
    if (!session) return;
    setBusy('list');
    try {
      // 1. The market's listing storage (0.01 NEAR, from this account). 2. Approve the market to sell the NFT.
      const s = await session.call(market!, 'deposit_storage', {}, { deposit: 10n * MILLINEAR, gas: teraToGas('30') });
      if (!s.ok) throw new Error(s.error ?? "Mintbase's market didn't accept the storage deposit.");
      const msg = JSON.stringify({ price: price.toString(), ft_contract: cfg.token });
      const a = await session.call(cfg.escrow, 'nft_approve', { token_id: String(lease.id), account_id: market, msg }, { deposit: 5n * MILLINEAR, gas: teraToGas('100') });
      if (!a.ok) throw new Error(a.error ?? 'Listing on Mintbase did not go through.');
      toast('ok', `Listed on Mintbase's market for ${usd(usdc(price))}.`, txUrl(a.hash));
      load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function buy() {
    if (!session || !listing) return;
    setBusy('buy');
    try {
      const cost = BigInt(listing.price);
      if ((await chain.usdcBalance(session.accountId)) < cost && cfg.tokenOpenMint) await api('/api/faucet', { accountId: session.accountId });
      const r = await session.call(cfg.token, 'ft_transfer_call', {
        receiver_id: market, amount: cost.toString(), msg: JSON.stringify({ nft_contract_id: cfg.escrow, token_id: String(lease.id) }),
      }, { deposit: 1n, gas: teraToGas('300') });
      if (!r.ok || !r.events.some((e) => e.event === 'lease_taken_over')) throw new Error('The sale did not complete and your USDC was returned. The listing may have just changed.');
      toast('ok', 'Bought on Mintbase. The home and its caution right are now yours.', txUrl(r.hash));
      onChange();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Store className="h-4 w-4 text-accent" /> Mintbase market</p>
      {listing ? (
        <p className="text-sm text-sub">Listed on Mintbase's market for <b className="text-ink">{usd(usdc(listing.price))}</b>. The sale settles through the escrow, which completes it only for the tenant the landlord agreed to; they become the tenant and get the caution right.</p>
      ) : (
        <p className="text-sm text-sub">The landlord agreed to the new tenant, so the sale can also settle on Mintbase's open NFT market, where other NEAR apps can see it.</p>
      )}
      {isHolder && !listing && (
        <button className="btn-ghost w-full" disabled={!!busy} onClick={list}>
          <Busy busy={busy === 'list'}>Also list on Mintbase for {usd(usdc(price))}</Busy>
        </button>
      )}
      {session && listing && isApprovedBuyer && (
        <button className="btn-ghost w-full" disabled={!!busy} onClick={buy}>
          <Busy busy={busy === 'buy'}>Buy on Mintbase for {usd(usdc(listing.price))}</Busy>
        </button>
      )}
      <p className="text-xs text-faint">
        Listing uses 0.01 NEAR of your balance for the market's storage. Mintbase takes 1% of a sale; Handova's own takeover above has no fee.{' '}
        <a className="inline-flex items-center gap-0.5 font-semibold text-accent" href={explorer} target="_blank" rel="noreferrer">{market} <ExternalLink className="h-3 w-3" /></a>
      </p>
    </div>
  );
}

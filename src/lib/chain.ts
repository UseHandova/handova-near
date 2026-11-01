/**
 * Onchain reads + writes for RentFlowEscrow.
 * Reads go straight to the Arc RPC via Multicall3; writes go through the Circle bundler (gasless).
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPublicClient, encodeFunctionData, formatUnits, type Address } from 'viem';
import type { SmartAccount } from 'viem/account-abstraction';
import { CHAIN, SPONSOR_GAS, USE_PAYMASTER, gasProblem, txReason } from '@/lib/network';
import { arcTransport } from '@/lib/arc-rpc';
import { ESCROW_ABI, ESCROW_ADDRESS, EscrowStatus } from '@/lib/contracts';
import { bundlerClient } from '@/lib/wallet';

// Mirrors the constants in RentFlowEscrow.sol
export const MOVE_IN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const DEPOSIT_REVIEW_MS = 7 * 24 * 60 * 60 * 1000;
export const DISPUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

const readClient = createPublicClient({ chain: CHAIN, transport: arcTransport(import.meta.env.VITE_ARC_RPC_URL as string | undefined) });
const escrowContract = { address: ESCROW_ADDRESS, abi: ESCROW_ABI } as const;

/** Free-form metadata a landlord stores with a listing (JSON in metadataUri). */
export interface ListingMeta {
  address?: string;
  location?: string;
  rooms?: number;
  propertyType?: string;
  furnishing?: 'furnished' | 'unfurnished' | 'semi_furnished';
  description?: string;
  amenities?: string[];
  lat?: number;
  lng?: number;
  source?: string;
  /** Landlord's WhatsApp number for inspections (digits, e.g. 2348031234567), if they chose to share it. */
  phone?: string;
  /** Uploaded photos/videos (URLs served by /api/media). */
  media?: { type: 'image' | 'video'; url: string }[];
  /** Landlord's free-text tenant preferences / exemptions. */
  preferences?: string;
  /** Quick-pick preference tags e.g. ['no_pets', 'professionals_only']. */
  preferenceTags?: string[];
}

export interface ChainListing {
  id: bigint;
  landlord: Address;
  rentUsdc: number;
  depositUsdc: number;
  active: boolean;
  meta: ListingMeta;
  /** Current escrow on this listing, 0n when the property is free to rent. */
  escrowId: bigint;
  /** Unix ms when the landlord passed identity verification onchain (0 = not verified). */
  landlordVerifiedAt: number;
}

export interface ChainEscrow {
  id: bigint;
  listingId: bigint;
  tenant: Address;
  heldUsdc: number;
  status: EscrowStatus;
  createdAt: number;
  /** Unix ms, 0 when not set. */
  handoverAt: number;
  endRequestedAt: number;
  disputedAt: number;
  /** Unix ms the tenant moved in (escrow became Active). Older, non-upgradeable deployments don't record it: 0. */
  movedInAt: number;
  listing?: ChainListing;
}

export interface ChainState {
  listings: ChainListing[];
  escrows: ChainEscrow[];
  arbiter: Address | null;
}

const usdc = (raw: bigint) => Number(formatUnits(raw, 6));
const ms = (secs: bigint) => Number(secs) * 1000;

/** Media in the compact on-chain form: file names in our media store (or full URLs), type from the extension. */
const VIDEO_EXT = /\.(mp4|mov|webm)$/i;
export const mediaFromNames = (names: unknown[]): NonNullable<ListingMeta['media']> => names
  .filter((n): n is string => typeof n === 'string' && n.length > 0)
  .map(n => ({ type: VIDEO_EXT.test(n) ? 'video' : 'image', url: /^(https?:)?\//.test(n) ? n : `/api/media/${n}` }));
/** Our own uploads go on-chain as just the file name (about half the bytes, so half the gas, of {type,url}). */
export const mediaToNames = (media: { url: string }[]) => media.map(m => (m.url.startsWith('/api/media/') ? m.url.slice('/api/media/'.length) : m.url));

function parseMeta(uri: string): ListingMeta {
  try {
    const parsed: unknown = JSON.parse(uri);
    if (!parsed || typeof parsed !== 'object') return {};
    const meta = parsed as ListingMeta & { m?: unknown };
    // Listings store media either as `m: ["abc.jpg", …]` (compact, current) or `media: [{type,url}]` (older).
    if (Array.isArray(meta.m)) { const { m, ...rest } = meta; return { ...rest, media: mediaFromNames(m) }; }
    return meta;
  } catch {
    return { description: uri };
  }
}

async function fetchChainState(): Promise<ChainState> {
  const [listingCount, escrowCount, arbiter] = await readClient.multicall({
    contracts: [
      { ...escrowContract, functionName: 'listingCounter' },
      { ...escrowContract, functionName: 'escrowCounter' },
      // Older deployments have no arbiter(); allowFailure keeps the read working.
      { ...escrowContract, functionName: 'arbiter' },
    ],
  });
  // Multicall reports failed calls as results instead of throwing. If the counters themselves failed
  // (RPC down / rate-limited), throw so the UI shows an error instead of "you have nothing".
  if (listingCount.status === 'failure') throw listingCount.error;
  if (escrowCount.status === 'failure') throw escrowCount.error;
  const nListings = Number(listingCount.result);
  const nEscrows = Number(escrowCount.result);

  const listingIds = Array.from({ length: nListings }, (_, i) => BigInt(i + 1));
  const escrowIds = Array.from({ length: nEscrows }, (_, i) => BigInt(i + 1));

  const [listingRows, escrowRows] = await Promise.all([
    readClient.multicall({
      contracts: listingIds.flatMap(id => [
        { ...escrowContract, functionName: 'listings', args: [id] } as const,
        { ...escrowContract, functionName: 'listingToEscrowId', args: [id] } as const,
      ]),
    }),
    readClient.multicall({
      contracts: escrowIds.flatMap(id => [
        { ...escrowContract, functionName: 'escrows', args: [id] } as const,
        { ...escrowContract, functionName: 'handoverAt', args: [id] } as const,
        { ...escrowContract, functionName: 'endRequestedAt', args: [id] } as const,
        { ...escrowContract, functionName: 'disputedAt', args: [id] } as const,
        { ...escrowContract, functionName: 'movedInAt', args: [id] } as const,
      ]),
    }),
  ]);

  const listings: ChainListing[] = listingIds.map((id, i) => {
    const row = listingRows[i * 2].result as readonly [Address, bigint, bigint, boolean, string] | undefined;
    const escrowId = (listingRows[i * 2 + 1].result as bigint | undefined) ?? 0n;
    const [landlord, rent, deposit, active, metadataUri] = row ?? ['0x0000000000000000000000000000000000000000', 0n, 0n, false, ''];
    return { id, landlord, rentUsdc: usdc(rent), depositUsdc: usdc(deposit), active, meta: parseMeta(metadataUri), escrowId, landlordVerifiedAt: 0 };
  });

  // Verified badges for every landlord with a listing.
  const landlords = [...new Set(listings.map(l => l.landlord.toLowerCase()))] as Address[];
  if (landlords.length > 0) {
    const verified = await readClient.multicall({
      contracts: landlords.map(a => ({ ...escrowContract, functionName: 'verifiedAt', args: [a] } as const)),
    });
    const verifiedAt = new Map(landlords.map((a, i) => [a, ms((verified[i].result) ?? 0n)]));
    for (const l of listings) l.landlordVerifiedAt = verifiedAt.get(l.landlord.toLowerCase() as Address) ?? 0;
  }

  const byId = new Map(listings.map(l => [l.id, l]));
  const escrows: ChainEscrow[] = escrowIds.map((id, i) => {
    const row = escrowRows[i * 5].result as readonly [bigint, Address, bigint, number, bigint] | undefined;
    const [listingId, tenant, held, status, createdAt] = row ?? [0n, '0x0000000000000000000000000000000000000000', 0n, 0, 0n];
    const opt = (j: number) => ms((escrowRows[i * 5 + j].result as bigint | undefined) ?? 0n);
    return {
      id, listingId, tenant, heldUsdc: usdc(held), status: status, createdAt: ms(createdAt),
      handoverAt: opt(1), endRequestedAt: opt(2), disputedAt: opt(3), movedInAt: opt(4), listing: byId.get(listingId),
    };
  });

  return { listings, escrows, arbiter: (arbiter.result) ?? null };
}

const CHAIN_KEY = ['rentflow-chain', ESCROW_ADDRESS] as const;

/** All listings + escrows, refreshed every 15s. */
export function useChainState() {
  return useQuery({
    queryKey: CHAIN_KEY,
    queryFn: fetchChainState,
    enabled: !!ESCROW_ADDRESS,
    refetchInterval: 15_000,
  });
}

/** Listing ids the platform has taken down (scams, spam, test data) — hidden from tenants. */
export function useHiddenListings() {
  return useQuery({
    queryKey: ['rentflow-hidden'],
    queryFn: async () => {
      const res = await fetch('/api/moderation/hidden');
      if (!res.ok) return new Set<string>();
      return new Set(((await res.json()) as { listingIds: string[] }).listingIds);
    },
    staleTime: 60_000,
  });
}

/** USDC the address can withdraw from the escrow. */
export function usePendingWithdrawal(address: string) {
  return useQuery({
    queryKey: ['rentflow-pending', ESCROW_ADDRESS, address],
    queryFn: async () => usdc(await readClient.readContract({
      ...escrowContract, functionName: 'pendingWithdrawals', args: [address as Address],
    })),
    enabled: !!ESCROW_ADDRESS && !!address,
    refetchInterval: 15_000,
  });
}

/** Call after a write so every screen picks up the new state immediately. */
export function useRefreshChain() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: CHAIN_KEY }),
    qc.invalidateQueries({ queryKey: ['rentflow-pending'] }),
    qc.invalidateQueries({ queryKey: ['rentflow-verified'] }),
  ]);
}

type EscrowWrite =
  | { functionName: 'markHandover' | 'claimMoveIn' | 'approveDepositReturn' | 'claimDeposit' | 'dispute' | 'confirmMoveIn' | 'endTenancy' | 'deactivateListing'; args: [bigint] }
  | { functionName: 'resolveDispute'; args: [bigint, number] }
  | { functionName: 'withdraw'; args?: [] };

/** A transaction error whose message is already plain language, safe to show as is. */
export class TxError extends Error {
  constructor(message: string, readonly original?: unknown) { super(message); this.name = 'TxError'; }
}

/** Smallest wallet balance that covers a network fee when gas isn't sponsored (USDC is Arc's gas, 18 decimals natively). */
const MIN_GAS_BALANCE = 10n ** 16n; // 0.01 USDC
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Without gas sponsorship, a wallet with no USDC can't send anything: say so before the user waits for a failure. */
export async function assertCanPayGas(address: Address) {
  if (SPONSOR_GAS) return;
  const balance = await readClient.getBalance({ address }).catch(() => null);
  if (balance !== null && balance < MIN_GAS_BALANCE) {
    throw new TxError(`Your wallet needs a little USDC for the network fee (under 1 cent per action on Arc). Send at least 0.05 USDC to your Handova wallet ${short(address)} (top right), then try again.`);
  }
}

/** Plain-language text for a failed transaction; `fallback` names what failed. Passkey cancels return null (show nothing). */
export function txErrorText(e: unknown, fallback: string): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError/.test(msg)) return null;
  if (e instanceof TxError) return e.message;
  return gasProblem(e) ?? `${fallback} ${txReason(e)}`;
}

/** Send calls as one user operation (gas sponsored where available) and wait for it to land. */
export async function sendUserOp(account: SmartAccount, calls: { to: Address; data: `0x${string}`; value?: bigint }[]) {
  await assertCanPayGas(account.address);
  try {
    const hash = await bundlerClient.sendUserOperation({ account, calls: calls.map(c => ({ value: 0n, ...c })), paymaster: USE_PAYMASTER });
    return await bundlerClient.waitForUserOperationReceipt({ hash });
  } catch (e) {
    console.error('[Handova] transaction failed', e);
    const gas = gasProblem(e);
    throw gas ? new TxError(gas, e) : e;
  }
}

/** Send one escrow call and wait for it to land. */
export async function sendEscrowTx(account: SmartAccount, call: EscrowWrite) {
  if (!ESCROW_ADDRESS) throw new TxError('Contract not deployed — set VITE_ESCROW_ADDRESS.');
  return sendUserOp(account, [{ to: ESCROW_ADDRESS, data: encodeFunctionData({ abi: ESCROW_ABI, ...call }) }]);
}

const YEAR_MS = 365 * 86_400_000;
/** When the next year's rent is due on a live tenancy: one year after move-in (or after payment, if move-in wasn't recorded). */
export const nextRentDue = (e: Pick<ChainEscrow, 'movedInAt' | 'createdAt'>) => (e.movedInAt || e.createdAt) + YEAR_MS;
/** Whole months from `now` until `due` (0 when due this month or overdue). */
export const monthsUntil = (due: number, now: number) => Math.max(0, Math.floor((due - now) / (30.44 * 86_400_000)));

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Whether either party may open a dispute on this escrow right now. */
export function canDispute(e: ChainEscrow) {
  return e.status === EscrowStatus.Active
    || e.status === EscrowStatus.Ending
    || (e.status === EscrowStatus.Pending && e.handoverAt > 0);
}

export function formatCountdown(untilMs: number, now: number) {
  const left = untilMs - now;
  if (left <= 0) return 'now';
  const h = Math.ceil(left / 3_600_000);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''}`;
  const days = Math.ceil(h / 24);
  return `${days} day${days > 1 ? 's' : ''}`;
}

/** Admin = the escrow's onchain dispute arbiter. (A quick UI hint only — the server confirms it from a signed session.) */
export function useIsAdmin(address: string) {
  const arbiter = useChainState().data?.arbiter;
  return sameAddress(address, arbiter);
}

/** Current time that re-renders every minute, for countdowns and deadline checks. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Unix ms when the address was verified as a landlord (0 = not verified). */
export function useVerifiedAt(address: string) {
  return useQuery({
    queryKey: ['rentflow-verified', ESCROW_ADDRESS, address],
    queryFn: async () => ms(await readClient.readContract({
      ...escrowContract, functionName: 'verifiedAt', args: [address as Address],
    })),
    enabled: !!ESCROW_ADDRESS && !!address,
    refetchInterval: 30_000,
  });
}

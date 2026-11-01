/**
 * Property social proof (client). Server: server/listing-stats.ts.
 * Saves, unique views, completed inspections, visits booked and property reviews.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api, ApiError, getSession, hasSession, publicApi } from '@/lib/api';

export interface ListingStats { saves: number; views: number; inspected: number; booked: number; rating: number; reviews: number }
export const EMPTY_STATS: ListingStats = { saves: 0, views: 0, inspected: 0, booked: 0, rating: 0, reviews: 0 };

const STATS_KEY = ['listing-stats'];

/** Counts for every listing, refreshed every minute. */
export function useListingStats() {
  const q = useQuery({
    queryKey: STATS_KEY,
    queryFn: () => publicApi<{ stats: Record<string, ListingStats> }>('/api/listings/stats').then(r => r.stats),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (id: bigint | string) => q.data?.[String(id)] ?? EMPTY_STATS;
}

const savedKey = (address: string) => ['listing-saved', address.toLowerCase()];

/** Homes this person saved for later (kept on the server, so they survive a reload or a new phone). */
export function useSavedListings(account: SmartAccount) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: savedKey(account.address),
    // Load quietly only with an existing session; the first save signs in (one passkey prompt).
    enabled: hasSession(account.address),
    queryFn: () => api<{ listingIds: string[] }>(account, '/api/listings/saved').then(r => new Set(r.listingIds)),
    staleTime: 60_000,
    retry: false,
  });
  const saved = q.data ?? new Set<string>();

  async function toggle(id: bigint | string) {
    const key = String(id);
    const next = !saved.has(key);
    const apply = (on: boolean) => qc.setQueryData<Set<string>>(savedKey(account.address), prev => {
      const s = new Set(prev ?? []);
      if (on) s.add(key); else s.delete(key);
      return s;
    });
    apply(next);
    try {
      if (!hasSession(account.address)) {
        await getSession(account);
        // Now signed in: pull everything saved earlier (e.g. on another phone) and re-apply this tap.
        const all = await api<{ listingIds: string[] }>(account, '/api/listings/saved');
        qc.setQueryData(savedKey(account.address), new Set(all.listingIds));
        apply(next);
      }
      const r = await api<{ saves: number }>(account, `/api/listings/${key}/save`, { body: { saved: next } });
      qc.setQueryData<Record<string, ListingStats>>(STATS_KEY, prev => prev && ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_STATS), saves: r.saves } }));
      if (next) toast.success('Saved. Find it any time under Saved.');
    } catch (e) {
      apply(!next);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled, so the home wasn\'t saved.' : `Couldn't save this home: ${msg}`);
    }
  }
  return { saved, toggle };
}

/** A random id for this device, so a view counts once per person per home without knowing who they are. */
function viewerId(): string | null {
  try {
    let id = localStorage.getItem('handova-viewer');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('handova-viewer', id); }
    return id;
  } catch { return null; }
}

/** Count one view of a home (once per device; repeat calls are ignored by the server). */
export function recordView(id: bigint | string) {
  const viewer = viewerId();
  if (!viewer) return;
  void fetch(`/api/listings/${String(id)}/view`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewer }),
  }).catch(() => undefined);
}

export interface PropertyReviews {
  count: number;
  average: number;
  reviews: { rating: number; body: string; kind: 'visited' | 'lived'; author: string; createdAt: number }[];
  mine?: { reviewed: boolean; canReview: boolean };
}

/** Reviews of one home; when signed in, also whether this person can write one. */
export function usePropertyReviews(listingId: string, account?: SmartAccount, escrowId?: string) {
  return useQuery({
    queryKey: ['property-reviews', listingId, account?.address.toLowerCase(), escrowId],
    queryFn: async () => {
      const path = `/api/listings/${listingId}/reviews${escrowId ? `?escrowId=${escrowId}` : ''}`;
      if (account && hasSession(account.address)) return api<PropertyReviews>(account, path);
      return publicApi<PropertyReviews>(path);
    },
    staleTime: 30_000,
  });
}

export async function postPropertyReview(account: SmartAccount, listingId: string, review: { rating: number; body: string; escrowId?: string }) {
  try {
    return await api<{ kind: 'visited' | 'lived' }>(account, `/api/listings/${listingId}/reviews`, { body: review });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error('Couldn\'t reach Handova. Check your connection and try again.');
  }
}

/**
 * TenantReviews — real landlord reviews from the server.
 *   view: average rating + reviews for a landlord (anyone)
 *   rate: the tenant of a tenancy rates their landlord (server checks they actually moved in, once per tenancy)
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Star, Loader2, BadgeCheck } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api, publicApi } from '@/lib/api';

interface ReviewsResponse {
  count: number;
  average: number;
  reviews: { rating: number; body: string; tenant: string; createdAt: number }[];
}

type Props =
  | { mode: 'view'; landlord?: string; title: string; onClose: () => void }
  | { mode: 'rate'; account: SmartAccount; escrowId: string; title: string; onClose: () => void };

export function Stars({ value, size = 'w-4 h-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={size} style={{ color: '#f2b45a', fill: i <= Math.round(value) ? '#f2b45a' : 'transparent' }} />
      ))}
    </span>
  );
}

export function useLandlordReviews(landlord?: string) {
  return useQuery({
    queryKey: ['reviews', landlord?.toLowerCase()],
    enabled: !!landlord,
    queryFn: () => publicApi<ReviewsResponse>(`/api/reviews?landlord=${landlord}`),
    staleTime: 60_000,
  });
}

export default function TenantReviews(props: Props) {
  const qc = useQueryClient();
  const reviews = useLandlordReviews(props.mode === 'view' ? props.landlord : undefined);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (props.mode !== 'rate') return;
    setSaving(true);
    try {
      await api(props.account, '/api/reviews', { body: { escrowId: props.escrowId, rating, body } });
      await qc.invalidateQueries({ queryKey: ['reviews'] });
      await qc.invalidateQueries({ queryKey: ['review-eligible'] });
      toast.success('Thanks — your review is live.');
      props.onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled.' : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={props.onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        role="dialog" aria-modal="true" aria-label="Reviews"
        className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0">
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>{props.mode === 'rate' ? 'Rate your landlord' : 'Landlord reviews'}</p>
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{props.title}</p>
          </div>
          <button onClick={props.onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {props.mode === 'rate' ? (
            <>
              <div className="flex justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <button key={i} onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>
                    <Star className="w-9 h-9" style={{ color: '#f2b45a', fill: i <= rating ? '#f2b45a' : 'transparent' }} />
                  </button>
                ))}
              </div>
              <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 1000))} rows={4}
                placeholder="How was it renting from this landlord? Repairs, water, power, honesty about the house…"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Only tenants who moved in through Handova can review, once per tenancy. Reviews show with a "Verified tenant" mark.</p>
              <button onClick={() => { void submit(); }} disabled={saving || rating === 0 || body.trim().length < 10}
                className="w-full h-12 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Post review
              </button>
            </>
          ) : !props.landlord ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>This is a sample listing, so there are no reviews.</p>
          ) : reviews.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
          ) : !reviews.data?.count ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>No reviews yet. Tenants can review after moving in through Handova.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{reviews.data.average.toFixed(1)}</span>
                <div>
                  <Stars value={reviews.data.average} />
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{reviews.data.count} review{reviews.data.count > 1 ? 's' : ''} from verified tenants</p>
                </div>
              </div>
              <ul className="space-y-3">
                {reviews.data.reviews.map((r, i) => (
                  <li key={i} className="p-3 rounded-xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <Stars value={r.rating} size="w-3.5 h-3.5" />
                      <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{new Date(r.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-2)' }}>{r.body}</p>
                    <p className="text-[11px] mt-2 flex items-center gap-1" style={{ color: 'var(--success)' }}>
                      <BadgeCheck className="w-3 h-3" /> Verified tenant <span className="mono" style={{ color: 'var(--subtle)' }}>{r.tenant}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

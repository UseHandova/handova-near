/**
 * PropertyReviews — reviews of one home (not just its landlord), from people who actually saw it:
 * a completed inspection ("Visited") or a move-in / confirmed cash payment ("Lived here"). The server checks this.
 * Also shows the landlord's rating, with a link to their full reviews.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { X, Star, Loader2, Footprints, KeyRound, UserRound } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { postPropertyReview, usePropertyReviews } from '@/lib/listing-stats';
import { Stars, useLandlordReviews } from '@/components/TenantReviews';

interface Props {
  listingId: string;
  landlord?: string;
  title: string;
  account: SmartAccount;
  /** The tenant's escrow on this home, if they rented it — lets them review as someone who lived there. */
  escrowId?: string;
  onLandlordReviews: () => void;
  onClose: () => void;
}

export default function PropertyReviews({ listingId, landlord, title, account, escrowId, onLandlordReviews, onClose }: Props) {
  const qc = useQueryClient();
  const reviews = usePropertyReviews(listingId, account, escrowId);
  const landlordReviews = useLandlordReviews(landlord);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const data = reviews.data;
  const canReview = data?.mine?.canReview ?? false;

  async function submit() {
    setSaving(true);
    try {
      await postPropertyReview(account, listingId, { rating, body, escrowId });
      await qc.invalidateQueries({ queryKey: ['property-reviews', listingId] });
      await qc.invalidateQueries({ queryKey: ['listing-stats'] });
      toast.success('Thanks. Your review of this home is live.');
      setWriting(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled, so the review wasn\'t posted.' : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        role="dialog" aria-modal="true" aria-label="Reviews of this home"
        className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0">
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>Reviews of this home</p>
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {landlord && (
            <button onClick={onLandlordReviews} className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <UserRound className="w-5 h-5 shrink-0" style={{ color: 'var(--muted)' }} />
              <span className="text-sm flex-1" style={{ color: 'var(--ink-2)' }}>
                {landlordReviews.data?.count
                  ? <>Landlord: <b style={{ color: 'var(--ink)' }}>{landlordReviews.data.average.toFixed(1)}</b> from {landlordReviews.data.count} tenant review{landlordReviews.data.count > 1 ? 's' : ''}</>
                  : 'Landlord has no tenant reviews yet'}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>See</span>
            </button>
          )}

          {writing ? (
            <>
              <div className="flex justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <button key={i} onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>
                    <Star className="w-9 h-9" style={{ color: '#f2b45a', fill: i <= rating ? '#f2b45a' : 'transparent' }} />
                  </button>
                ))}
              </div>
              <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 1000))} rows={4}
                placeholder="What is the home really like? Water, light, road, noise, does it match the photos…"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <div className="flex gap-2">
                <button onClick={() => setWriting(false)} className="h-12 px-5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}>Cancel</button>
                <button onClick={() => { void submit(); }} disabled={saving}
                  className="flex-1 h-12 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: 'var(--accent)' }}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {rating === 0 ? 'Tap the stars first' : body.trim().length < 10 ? 'Write a sentence first' : 'Post review'}
                </button>
              </div>
            </>
          ) : reviews.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
          ) : reviews.isError ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--danger)' }}>Couldn't load reviews. Check your connection and try again.</p>
          ) : (
            <>
              {data && data.count > 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{data.average.toFixed(1)}</span>
                  <div>
                    <Stars value={data.average} />
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{data.count} review{data.count > 1 ? 's' : ''} from people who visited or lived here</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No reviews of this home yet.</p>
              )}
              {canReview && (
                <button onClick={() => setWriting(true)} className="w-full h-11 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  Review this home
                </button>
              )}
              {!canReview && !data?.mine?.reviewed && (
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>Only people who inspected this home (both sides confirmed the visit) or lived here can review it, so every review is real.</p>
              )}
              <ul className="space-y-3">
                {data?.reviews.map((r, i) => (
                  <li key={i} className="p-3 rounded-xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <Stars value={r.rating} size="w-3.5 h-3.5" />
                      <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{new Date(r.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-2)' }}>{r.body}</p>
                    <p className="text-[11px] mt-2 flex items-center gap-1" style={{ color: 'var(--success)' }}>
                      {r.kind === 'lived' ? <><KeyRound className="w-3 h-3" /> Lived here</> : <><Footprints className="w-3 h-3" /> Inspected</>}
                      <span className="mono" style={{ color: 'var(--subtle)' }}>{r.author}</span>
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

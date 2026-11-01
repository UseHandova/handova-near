/**
 * ReferralSystem — real referral codes and counts from the server.
 * Share link: https://<app>/?ref=CODE. A new account that opens it is linked to the referrer once
 * (see useCaptureReferral). Rewards aren't paid yet, so none are promised.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Gift, Copy, Check, Share2, Loader2, Users } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const PENDING_REF = 'rentflow_pending_ref';

interface Props {
  account: SmartAccount;
  onClose: () => void;
}

/** Remember ?ref=CODE from the first visit, then record it once the user is signed in. */
export function useCaptureReferral(account: SmartAccount | null) {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('ref');
      if (code && /^[A-Za-z0-9]{6,20}$/.test(code)) localStorage.setItem(PENDING_REF, code.toUpperCase());
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    if (!account || typeof account.signMessage !== 'function') return;
    let code: string | null = null;
    try { code = localStorage.getItem(PENDING_REF); } catch { /* storage unavailable */ }
    if (!code) return;
    api(account, '/api/referrals', { body: { code } })
      .then(() => toast.success('Welcome! Your friend\'s referral was recorded.'))
      .catch(() => undefined)  // already referred / own code / unknown code — nothing to do
      .finally(() => { try { localStorage.removeItem(PENDING_REF); } catch { /* ignore */ } });
  }, [account]);
}

export default function ReferralSystem({ account, onClose }: Props) {
  const me = useQuery({
    queryKey: ['referrals', account.address],
    queryFn: () => api<{ code: string; referrals: { account: string; joinedAt: number }[]; referredBy: string | null }>(account, '/api/referrals/me'),
    retry: false,
  });
  const [copied, setCopied] = useState(false);
  const link = me.data ? `${window.location.origin}/?ref=${me.data.code}` : '';

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { toast.error('Could not copy.'); }
  }
  function share() {
    const text = `Find a home in Lagos without paying agent fees — rent goes into escrow until you move in. Join Handova: ${link}`;
    if (navigator.share) void navigator.share({ title: 'Handova', text }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        role="dialog" aria-modal="true" aria-label="Invite friends"
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>Invite friends</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Know someone tired of agent fees? Share your link. Friends who join with it are linked to you.
          </p>
          {me.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
          ) : me.isError ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--danger)' }}>{(me.error).message}</p>
          ) : me.data && (
            <>
              <div className="p-4 rounded-2xl text-center" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Your code</p>
                <p className="text-2xl font-bold mono tracking-widest mt-1" style={{ color: 'var(--ink)' }}>{me.data.code}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { void copy(); }} className="flex-1 h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
                </button>
                <button onClick={share} className="flex-1 h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2" style={{ background: 'var(--accent)' }}>
                  <Share2 className="w-4 h-4" /> Share
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
                <Users className="w-4 h-4" style={{ color: 'var(--muted)' }} />
                {me.data.referrals.length === 0 ? 'No one has joined with your link yet.' : `${me.data.referrals.length} friend${me.data.referrals.length > 1 ? 's' : ''} joined with your link.`}
              </div>
              {me.data.referredBy && <p className="text-xs" style={{ color: 'var(--subtle)' }}>You were invited by <span className="mono">{me.data.referredBy}</span>.</p>}
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Referral rewards will be announced at launch.</p>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

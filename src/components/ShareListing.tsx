/**
 * ShareListing — share a listing via link, WhatsApp, Twitter, or copy.
 * Injects OG meta tags dynamically for link preview.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Copy, X, MessageCircle, Twitter, Link } from 'lucide-react';
import { useLang } from '@/lib/LangContext';
import { formatNaira } from '@/lib/naira';
import type { Listing } from '@/components/BrowseListings';
import { toast } from 'sonner';

interface Props {
  listing: Listing;
  onClose: () => void;
}

export default function ShareListing({ listing, onClose }: Props) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  // Construct a shareable URL (uses current origin + a listing slug)
  const slug = listing.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const shareUrl = `${window.location.origin}/?listing=${slug}-${listing.id}`;

  const shareText = `${listing.title} — ${listing.address}\n${formatNaira(listing.rentUsdc)}/yr · No agent fee · Verified escrow\nView on Handova: ${shareUrl}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      toast.success(t('link_copied'));
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => toast.error('Could not copy'));
  }

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  }

  function shareTwitter() {
    const tweet = `${listing.title} at ${listing.location} — ${formatNaira(listing.rentUsdc)}/yr. No agent fee. Book an inspection on Handova ${shareUrl}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank');
  }

  function shareNative() {
    if (navigator.share) {
      void navigator.share({ title: listing.title, text: shareText, url: shareUrl });
    } else {
      copyLink();
    }
  }

  const ACTIONS = [
    { icon: MessageCircle, label: 'WhatsApp', color: '#25D366', bg: '#dcfce7', onClick: shareWhatsApp },
    { icon: Twitter, label: 'Twitter/X', color: '#1d9bf0', bg: '#dbeafe', onClick: shareTwitter },
    { icon: Link, label: t('copy_link'), color: 'var(--accent)', bg: 'var(--accent-soft)', onClick: copyLink },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'var(--glass-card)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--glass-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--ink)' }}>{t('share_listing')}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Listing preview */}
          <div className="rounded-2xl p-4" style={{ background: listing.color }}>
            <p className="text-white font-bold text-sm truncate">{listing.title}</p>
            <p className="text-white/80 text-xs truncate">{listing.address}</p>
            <p className="text-white font-semibold text-base mt-1 tabular-nums">{formatNaira(listing.rentUsdc)}/yr</p>
          </div>

          {/* URL field */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <span className="flex-1 text-xs truncate mono" style={{ color: 'var(--muted)' }}>{shareUrl}</span>
            <AnimatePresence mode="wait">
              {copied
                ? <motion.span key="ok" initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Copied!</motion.span>
                : <motion.button key="copy" whileTap={{ scale: 0.92 }} onClick={copyLink}><Copy className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} /></motion.button>
              }
            </AnimatePresence>
          </div>

          {/* Share actions */}
          <div className="grid grid-cols-3 gap-3">
            {ACTIONS.map(a => (
              <motion.button key={a.label} whileTap={{ scale: 0.93 }} onClick={a.onClick}
                className="flex flex-col items-center gap-2 py-3.5 rounded-2xl text-xs font-semibold"
                style={{ background: a.bg, color: a.color, border: '1px solid transparent' }}>
                <a.icon className="w-5 h-5" />
                {a.label}
              </motion.button>
            ))}
          </div>

          {/* Native share (mobile) */}
          {typeof navigator.share === 'function' && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={shareNative}
              className="w-full py-3.5 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', boxShadow: 'none' }}>
              <Share2 className="w-4 h-4" />
              {t('share_via')} Phone
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

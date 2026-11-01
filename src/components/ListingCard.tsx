/**
 * ListingCard — photo-first card for the tenant grid.
 * Hovering (or focusing) a listing with a video plays a muted preview over the cover photo.
 * The whole card opens the detail view; only the save button is a separate target.
 */

import { useRef, useState } from 'react';
import { BadgeCheck, Camera, Heart, Home, Play, ShieldAlert } from 'lucide-react';
import { formatNaira } from '@/lib/naira';
import { useLang } from '@/lib/LangContext';
import { OwnershipPill } from '@/components/OwnershipProof';
import type { Listing } from '@/components/BrowseListings';
import { useUi } from '@/lib/i18n-ui';
import { COMMERCIAL_TYPES } from '@/lib/i18n';
import ListingSocialProof from '@/components/ListingSocialProof';
import type { ListingStats } from '@/lib/listing-stats';

interface Props {
  listing: Listing;
  priceMode: 'monthly' | 'yearly';
  saved: boolean;
  onToggleSave: () => void;
  /** Interest counts (absent for samples). */
  stats?: ListingStats;
  onOpen: () => void;
}

export function VerificationPill({ listing, size = 'sm' }: { listing: Listing; size?: 'sm' | 'md' }) {
  const u = useUi();
  const cls = size === 'sm' ? 'text-[11px] px-2 py-1 gap-1' : 'text-xs px-2.5 py-1.5 gap-1.5';
  if (listing.sample) {
    return <span className={`inline-flex items-center rounded-full font-semibold bg-black/65 text-white ${cls}`}>{u('sample_pill')}</span>;
  }
  return listing.verifiedAt > 0 ? (
    <span className={`inline-flex items-center rounded-full font-semibold text-white ${cls}`} style={{ background: '#17803f' }}>
      <BadgeCheck className="w-3.5 h-3.5" /> {u('verified_landlord_pill')}
    </span>
  ) : (
    <span className={`inline-flex items-center rounded-full font-semibold bg-black/65 text-white ${cls}`}>
      <ShieldAlert className="w-3.5 h-3.5" /> {u('not_verified_pill')}
    </span>
  );
}

export default function ListingCard({ listing, priceMode, saved, onToggleSave, stats, onOpen }: Props) {
  const { t } = useLang();
  const u = useUi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const cover = listing.media.find(m => m.type === 'image')?.url;
  const video = listing.media.find(m => m.type === 'video')?.url;
  const photoCount = listing.media.filter(m => m.type === 'image').length;

  function startPreview() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().then(() => setPlaying(true)).catch(() => undefined);
  }
  function stopPreview() {
    videoRef.current?.pause();
    setPlaying(false);
  }

  const price = priceMode === 'monthly' ? listing.rentUsdc / 12 : listing.rentUsdc;

  return (
    <article
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onMouseEnter={startPreview} onMouseLeave={stopPreview}
      onFocus={startPreview} onBlur={stopPreview}
      className="group cursor-pointer rounded-2xl overflow-hidden outline-none transition-shadow focus-visible:ring-2"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', ['--tw-ring-color' as string]: 'var(--focus)' }}
    >
      {/* Media */}
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
        {cover ? (
          <img src={cover} alt={listing.title} loading="lazy" decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Home className="w-10 h-10" style={{ color: 'var(--subtle)' }} />
          </div>
        )}
        {video && (
          <video ref={videoRef} src={video} poster={cover} muted loop playsInline preload="none"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            style={{ opacity: playing ? 1 : 0 }} />
        )}

        <div className="absolute inset-x-0 top-0 p-3 flex items-start justify-between gap-2">
          <div className="flex flex-col items-start gap-1.5">
            <VerificationPill listing={listing} />
            {!!listing.ownershipCheckedAt && <OwnershipPill />}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onToggleSave(); }}
            aria-label={saved ? 'Remove from saved' : 'Save'}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-black/45 hover:bg-black/60 transition-colors">
            <Heart className="w-4 h-4" style={{ color: saved ? '#ff5a6e' : 'white', fill: saved ? '#ff5a6e' : 'none' }} />
          </button>
        </div>

        {(photoCount > 1 || video) && (
          <div className="absolute bottom-3 left-3 flex gap-1.5">
            {photoCount > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-black/60 text-white">
                <Camera className="w-3 h-3" /> {photoCount}
              </span>
            )}
            {video && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-black/60 text-white">
                <Play className="w-3 h-3" /> Video
              </span>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-4">
        {(() => {
          const isCommercial = (COMMERCIAL_TYPES as readonly string[]).includes(listing.propertyType);
          return (
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
              {listing.location} · {t(listing.propertyType)}
              {!isCommercial && <> · {t(listing.furnishing)}</>}
            </p>
          );
        })()}
        <h3 className="font-semibold text-[15px] mt-1 truncate" style={{ color: 'var(--ink)' }}>{listing.title}</h3>
        <p className="mt-2 tabular-nums" style={{ color: 'var(--ink)' }}>
          <span className="text-lg font-bold">{formatNaira(price)}</span>
          <span className="text-sm" style={{ color: 'var(--muted)' }}> {priceMode === 'monthly' ? t('per_month') : t('per_year')}</span>
        </p>
        <p className="text-xs mt-1 truncate" style={{ color: 'var(--muted)' }}>
          {formatNaira(listing.depositUsdc)} {u('caution_escrow')}
          {listing.amenities.length > 0 && <> · {listing.amenities.slice(0, 3).join(', ')}</>}
        </p>
        {stats && <ListingSocialProof stats={stats} variant="compact" />}
      </div>
    </article>
  );
}

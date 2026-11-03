import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, BedDouble, Home, Images, MapPin, Play } from 'lucide-react';
import { decodeDetails } from '../lib/listing';
import { naira, usdc, useNgnRate } from '../lib/money';
import { useT } from '../lib/i18n';
import type { Listing } from '../lib/types';

export function Photo({ src, className = '' }: { src?: string; className?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-center justify-center bg-gradient-to-br from-accent/25 to-accent/5 text-accent ${className}`}>
      <Home className="h-10 w-10 opacity-60" />
    </div>
  );
}

/**
 * A listing's video over its cover photo, silent and looping. With a mouse it plays while the card is
 * hovered; on touch screens (no hover) it plays while the card is mostly on screen.
 */
function HoverVideo({ src, poster, hovered }: { src: string; poster?: string; hovered: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canHover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (canHover || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setInView(e.intersectionRatio > 0.6), { threshold: [0, 0.6, 1] });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [canHover]);

  const active = !still && (canHover ? hovered : inView);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else { v.pause(); v.currentTime = 0; }
  }, [active]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${active && playing ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

export function ListingCard({ l }: { l: Listing }) {
  const [hovered, setHovered] = useState(false);
  const rate = useNgnRate();
  const { t } = useT();
  const d = decodeDetails(l.property_ref, l.id);
  const taken = l.active_lease !== null || !l.available;
  return (
    <a
      href={`#/home/${l.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group card flex h-full flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-20px_rgba(10,102,56,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Photo src={d.photos[0]} className="h-full w-full transition duration-700 ease-out group-hover:scale-[1.06]" />
        {d.video && <HoverVideo src={d.video} poster={d.photos[0]} hovered={hovered} />}
        {d.photos[0] && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {l.landlord_verified && (
            <span className="chip !bg-white/90 !text-accent shadow-sm"><BadgeCheck className="h-3.5 w-3.5" />{t('Verified landlord')}</span>
          )}
          {taken && <span className="chip !bg-black/65 !text-white">{t('Taken')}</span>}
        </div>
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          {d.video && <span className="chip !bg-black/55 !text-white"><Play className="h-3.5 w-3.5 fill-current" />{t('Video')}</span>}
          {d.photos.length > 1 && <span className="chip !bg-black/55 !text-white"><Images className="h-3.5 w-3.5" />{d.photos.length}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-[17px] font-bold leading-snug transition-colors group-hover:text-accent">{d.title}</h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sub">
          <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{[d.area, d.city].filter(Boolean).join(', ')}</span>
          {d.beds ? <span className="inline-flex items-center gap-1"><BedDouble className="h-4 w-4" />{d.beds} {t('bed')}</span> : null}
        </p>
        {!!d.amenities?.length && (
          <div className="flex flex-wrap gap-1.5">
            {d.amenities.slice(0, 3).map((a) => <span key={a} className="chip !py-0.5 !text-[11px]">{a}</span>)}
          </div>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-line pt-3">
          <p>
            <span className="text-lg font-bold">{naira(usdc(l.rent), rate)}</span>
            <span className="text-sm text-sub"> / {l.term_months === 12 ? t('year') : `${l.term_months} ${t('months')}`}</span>
          </p>
          <span className="chip shrink-0 !bg-accent-soft !text-accent">{t('No agent fee')}</span>
        </div>
      </div>
    </a>
  );
}

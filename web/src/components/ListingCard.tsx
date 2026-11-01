import { BadgeCheck, BedDouble, Home } from 'lucide-react';
import { decodeDetails } from '../lib/listing';
import { naira, usdc, useNgnRate } from '../lib/money';
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

export function ListingCard({ l }: { l: Listing }) {
  const rate = useNgnRate();
  const d = decodeDetails(l.property_ref, l.id);
  const taken = l.active_lease !== null || !l.available;
  return (
    <a href={`#/home/${l.id}`} className="card block overflow-hidden transition hover:-translate-y-0.5">
      <div className="relative">
        <Photo src={d.photos[0]} className="h-44 w-full" />
        {taken && <span className="absolute left-3 top-3 chip !bg-black/60 !text-white">Taken</span>}
      </div>
      <div className="space-y-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-[17px] font-bold leading-snug">{d.title}</h3>
          {l.landlord_verified && <BadgeCheck className="h-5 w-5 shrink-0 text-accent" aria-label="Verified landlord" />}
        </div>
        <p className="flex items-center gap-2 text-sm text-sub">
          {[d.area, d.city].filter(Boolean).join(', ')}
          {d.beds ? <span className="inline-flex items-center gap-1"><BedDouble className="h-4 w-4" />{d.beds}</span> : null}
        </p>
        <p className="pt-1">
          <span className="text-lg font-bold">{naira(usdc(l.rent), rate)}</span>
          <span className="text-sm text-sub"> / {l.term_months === 12 ? 'year' : `${l.term_months} months`} · no agent fee</span>
        </p>
      </div>
    </a>
  );
}

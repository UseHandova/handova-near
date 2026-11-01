/**
 * How much interest a home is getting: completed inspections, visits booked, saves, views and its rating.
 *   compact: one quiet line on the listing card
 *   full:    the strip in the listing detail, with a nudge when other people are already visiting
 */

import { Eye, Flame, Heart, Star, CalendarCheck2, Footprints } from 'lucide-react';
import type { ListingStats } from '@/lib/listing-stats';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ListingSocialProof({ stats, variant }: { stats: ListingStats; variant: 'compact' | 'full' }) {
  const { saves, views, inspected, booked, rating, reviews } = stats;

  if (variant === 'compact') {
    const items = [
      inspected > 0 && { key: 'i', icon: Footprints, text: `${inspected} inspected`, hot: true },
      booked > 0 && { key: 'b', icon: CalendarCheck2, text: `${booked} booked`, hot: true },
      reviews > 0 && { key: 'r', icon: Star, text: `${rating.toFixed(1)} (${reviews})`, hot: false },
      saves > 0 && { key: 's', icon: Heart, text: String(saves), hot: false },
      views > 0 && { key: 'v', icon: Eye, text: String(views), hot: false },
    ].filter(Boolean) as { key: string; icon: typeof Eye; text: string; hot: boolean }[];
    if (items.length === 0) return null;
    return (
      <p className="flex items-center gap-3 mt-2 text-xs overflow-hidden whitespace-nowrap" aria-label="Interest in this home">
        {items.map(({ key, icon: Icon, text, hot }) => (
          <span key={key} className="inline-flex items-center gap-1 shrink-0" style={{ color: hot ? 'var(--accent)' : 'var(--muted)' }}>
            <Icon className="w-3.5 h-3.5" /> {text}
          </span>
        ))}
      </p>
    );
  }

  const busy = booked + inspected;
  const rows = [
    { icon: Footprints, value: inspected, label: inspected === 1 ? 'person has inspected it' : 'people have inspected it' },
    { icon: CalendarCheck2, value: booked, label: booked === 1 ? 'visit booked' : 'visits booked' },
    { icon: Heart, value: saves, label: 'saved it' },
    { icon: Eye, value: views, label: views === 1 ? 'view' : 'views' },
  ];
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      {busy > 0 && (
        <p className="text-sm font-semibold flex items-center gap-1.5 mb-3" style={{ color: 'var(--accent)' }}>
          <Flame className="w-4 h-4" />
          {booked > 0
            ? `${plural(booked, 'person', 'people')} ${booked === 1 ? 'is' : 'are'} going to see this home. Book your visit before it's taken.`
            : `${plural(inspected, 'person', 'people')} already inspected this home. Book yours soon.`}
        </p>
      )}
      <div className="grid grid-cols-4 gap-2 text-center">
        {rows.map(({ icon: Icon, value, label }) => (
          <div key={label}>
            <p className="text-lg font-bold tabular-nums flex items-center justify-center gap-1" style={{ color: 'var(--ink)' }}>
              <Icon className="w-4 h-4" style={{ color: 'var(--muted)' }} /> {value}
            </p>
            <p className="text-[11px] leading-tight" style={{ color: 'var(--muted)' }}>{label}</p>
          </div>
        ))}
      </div>
      {reviews > 0 && (
        <p className="text-xs mt-3 flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
          <Star className="w-3.5 h-3.5" style={{ color: '#f2b45a', fill: '#f2b45a' }} />
          <b>{rating.toFixed(1)}</b> from {plural(reviews, 'review')} by people who visited or lived here
        </p>
      )}
    </div>
  );
}

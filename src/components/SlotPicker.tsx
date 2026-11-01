/**
 * SlotPicker — pick a day, then an hour, in Lagos time. Past and too-soon slots are disabled.
 */

import { useState } from 'react';
import { useNow } from '@/lib/chain';
import { HOURS, MIN_LEAD_MS, hourLabel, lagosMs, nextDays } from '@/lib/inspections';

interface Props {
  value: number | null;
  onChange: (ms: number) => void;
}

export default function SlotPicker({ value, onChange }: Props) {
  const now = useNow();
  // Skip days with no bookable hour left (e.g. today after 5:30 pm).
  const days = nextDays(14, now).filter(d => HOURS.some(h => lagosMs(d.y, d.m, d.d, h) >= now + MIN_LEAD_MS));
  const initial = value ? days.find(d => HOURS.some(h => lagosMs(d.y, d.m, d.d, h) === value)) : undefined;
  const [dayKey, setDayKey] = useState(initial?.key ?? days[0]?.key);
  const day = days.find(d => d.key === dayKey) ?? days[0];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="listbox" aria-label="Day">
        {days.map(d => {
          const on = d.key === day?.key;
          return (
            <button key={d.key} type="button" role="option" aria-selected={on} onClick={() => setDayKey(d.key)}
              className="shrink-0 w-[4.5rem] py-2 rounded-xl border text-center transition-colors"
              style={on ? { background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' } : { background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}>
              <span className="block text-xs font-semibold">{d.label}</span>
              <span className="block text-[11px] opacity-70">{d.sub}</span>
            </button>
          );
        })}
      </div>
      {day && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" role="listbox" aria-label="Time">
          {HOURS.map(h => {
            const ms = lagosMs(day.y, day.m, day.d, h);
            const disabled = ms < now + MIN_LEAD_MS;
            const on = value === ms;
            return (
              <button key={h} type="button" role="option" aria-selected={on} disabled={disabled} onClick={() => onChange(ms)}
                className="h-10 rounded-xl border text-sm font-medium transition-colors disabled:opacity-30 disabled:line-through"
                style={on ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : { background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}>
                {hourLabel(h)}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Times are Lagos time (WAT).</p>
    </div>
  );
}

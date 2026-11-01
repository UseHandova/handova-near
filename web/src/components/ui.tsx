import { useEffect, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import type { LeaseStatus } from '../lib/types';

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-card sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => <Loader2 className={`${className} animate-spin`} />;

export function Busy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <>{busy ? <Spinner /> : null}{children}</>;
}

const STATUS: Record<LeaseStatus, { label: string; cls: string }> = {
  Pending: { label: 'In escrow · waiting for move-in', cls: 'bg-amber-500/15 text-warn' },
  Active: { label: 'Moved in', cls: 'bg-accent-soft text-accent' },
  Ending: { label: 'Move-out review', cls: 'bg-amber-500/15 text-warn' },
  Disputed: { label: 'Caution disputed', cls: 'bg-red-500/10 text-danger' },
  Closed: { label: 'Finished', cls: 'bg-muted text-sub' },
  Cancelled: { label: 'Cancelled · refunded', cls: 'bg-muted text-sub' },
};

export function StatusPill({ status }: { status: LeaseStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${s.cls}`}>{s.label}</span>;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 rounded-2xl bg-accent-soft p-3 text-accent">{icon}</div>
      <p className="font-display text-base font-bold">{title}</p>
      {children && <div className="text-sm text-sub">{children}</div>}
    </div>
  );
}

export function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-sub">{k}</span>
      <span className={`text-right ${strong ? 'font-bold text-ink' : 'text-ink2'}`}>{v}</span>
    </div>
  );
}

export function timeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const h = Math.ceil(ms / 3_600_000);
  return h >= 48 ? `${Math.ceil(h / 24)} days` : h > 1 ? `${h} hours` : 'under an hour';
}

export const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

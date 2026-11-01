/**
 * MaintenanceTracker — real repair requests stored on the server.
 * Tenants report problems for a home they live in (checked onchain); landlords move them to
 * in progress / fixed; tenants can confirm a fix or reopen it.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Wrench, Loader2, Plus, CheckCircle2, RotateCcw, Clock } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Request {
  id: number; escrowId: string; title: string; details: string; priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved'; createdAt: number; updatedAt: number; role: 'tenant' | 'landlord';
}

interface Props {
  account: SmartAccount;
  role: 'tenant' | 'landlord';
  /** Tenant's live tenancies (escrow id → label), to choose which home a repair is for. */
  homes?: { escrowId: string; label: string }[];
  /** Escrow id → home label, for showing requests. */
  labels?: Record<string, string>;
  onClose: () => void;
}

const STATUS: Record<Request['status'], { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--warning)' },
  in_progress: { label: 'In progress', color: '#5b9bd5' },
  resolved: { label: 'Fixed', color: 'var(--success)' },
};

export default function MaintenanceTracker({ account, role, homes = [], labels = {}, onClose }: Props) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['maintenance', account.address],
    queryFn: () => api<{ requests: Request[] }>(account, '/api/maintenance'),
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const [escrowId, setEscrowId] = useState(homes[0]?.escrowId ?? '');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [priority, setPriority] = useState<Request['priority']>('medium');
  const [busy, setBusy] = useState<string | null>(null);

  const mine = (list.data?.requests ?? []).filter(r => r.role === role);
  const refresh = () => qc.invalidateQueries({ queryKey: ['maintenance', account.address] });
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled.' : msg);
  };

  async function create() {
    setBusy('create');
    try {
      await api(account, '/api/maintenance', { body: { escrowId, title, details, priority } });
      setTitle(''); setDetails(''); setAdding(false);
      await refresh();
      toast.success('Repair request sent to your landlord.');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  async function setStatus(id: number, status: Request['status']) {
    setBusy(`${id}`);
    try {
      await api(account, `/api/maintenance/${id}`, { method: 'PATCH', body: { status } });
      await refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  const input = { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        role="dialog" aria-modal="true" aria-label="Repairs"
        className="w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>{role === 'tenant' ? 'Repairs' : 'Repair requests'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {role === 'tenant' && (homes.length === 0 ? (
            <p className="text-sm px-4 py-3 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
              You can report repairs once you've moved into a home through Handova.
            </p>
          ) : adding ? (
            <div className="space-y-3 p-4 rounded-2xl" style={{ border: '1px solid var(--border)' }}>
              {homes.length > 1 && (
                <select value={escrowId} onChange={e => setEscrowId(e.target.value)} className="w-full h-11 px-3 rounded-xl text-sm" style={input}>
                  {homes.map(h => <option key={h.escrowId} value={h.escrowId}>{h.label}</option>)}
                </select>
              )}
              <input value={title} onChange={e => setTitle(e.target.value.slice(0, 120))} placeholder="What's wrong? e.g. Leaking kitchen tap"
                className="w-full h-11 px-4 rounded-xl text-sm outline-none" style={input} />
              <textarea value={details} onChange={e => setDetails(e.target.value.slice(0, 2000))} rows={3} placeholder="Any details that will help (when it started, which room)…"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none" style={input} />
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map(p => (
                  <button key={p} onClick={() => setPriority(p)} className="flex-1 h-9 rounded-lg text-xs font-medium capitalize"
                    style={priority === p ? { background: 'var(--ink)', color: 'var(--bg)' } : { ...input }}>
                    {p === 'high' ? 'Urgent' : p}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAdding(false)} className="h-11 px-4 rounded-xl text-sm" style={{ color: 'var(--muted)' }}>Cancel</button>
                <button onClick={() => { void create(); }} disabled={busy === 'create' || title.trim().length < 3 || !escrowId}
                  className="flex-1 h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                  {busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />} Send to landlord
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: 'white' }}>
              <Plus className="w-4 h-4" /> Report a problem
            </button>
          ))}

          {list.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
          ) : list.isError ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--danger)' }}>{(list.error).message}</p>
          ) : mine.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>
              {role === 'tenant' ? 'No repair requests yet.' : 'No repair requests from your tenants.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {mine.map(r => (
                <li key={r.id} className="p-4 rounded-2xl space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{r.title}</p>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>{labels[r.escrowId] ?? `Tenancy #${r.escrowId}`} · {new Date(r.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}{r.priority === 'high' ? ' · Urgent' : ''}</p>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full shrink-0" style={{ color: STATUS[r.status].color, background: 'var(--popover)', border: '1px solid var(--border)' }}>
                      {STATUS[r.status].label}
                    </span>
                  </div>
                  {r.details && <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{r.details}</p>}
                  <div className="flex gap-2 pt-1">
                    {role === 'landlord' && r.status === 'open' && (
                      <button onClick={() => { void setStatus(r.id, 'in_progress'); }} disabled={busy === `${r.id}`}
                        className="h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5" style={{ background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                        <Clock className="w-3.5 h-3.5" /> Working on it
                      </button>
                    )}
                    {r.status !== 'resolved' && (
                      <button onClick={() => { void setStatus(r.id, 'resolved'); }} disabled={busy === `${r.id}`}
                        className="h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5" style={{ background: 'var(--popover)', color: 'var(--success)', border: '1px solid var(--border)' }}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> {role === 'tenant' ? 'It\'s fixed' : 'Mark fixed'}
                      </button>
                    )}
                    {r.status === 'resolved' && role === 'tenant' && (
                      <button onClick={() => { void setStatus(r.id, 'open'); }} disabled={busy === `${r.id}`}
                        className="h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5" style={{ background: 'var(--popover)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        <RotateCcw className="w-3.5 h-3.5" /> Not fixed — reopen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

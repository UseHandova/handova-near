/**
 * Property ownership checks — UI.
 *   OwnershipRow     landlord's property card: status + "Prove ownership"
 *   OwnershipSheet   upload documents (private — only the Handova team sees them)
 *   OwnershipReview  admin queue: view documents, approve or reject with a reason
 *   OwnershipPill    tenant-facing badge
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileCheck2, FileText, Loader2, Lock, ShieldQuestion, Upload, X, XCircle } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DOC_TYPES, openOwnershipFile, submitOwnership, useMyOwnership, type OwnershipRequest } from '@/lib/ownership';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /NotAllowedError|cancel/i.test(m) ? 'Sign-in was cancelled.' : m;
};

export function OwnershipPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full text-[11px] font-semibold px-2 py-1 bg-white/90 text-[#0a6638]">
      <FileCheck2 className="w-3.5 h-3.5" /> Ownership checked
    </span>
  );
}

/** Landlord's property card row. */
export function OwnershipRow({ account, listingId, address, mine }: { account: SmartAccount; listingId: string; address?: string; mine: ReturnType<typeof useMyOwnership> }) {
  const [open, setOpen] = useState(false);
  const r = mine.forAddress(address);
  const chip = (icon: React.ReactNode, text: string, color: string) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}>{icon} {text}</span>
  );
  return (
    <div className="px-4 pb-3 flex items-center justify-between gap-2">
      {!mine.connected ? chip(<ShieldQuestion className="w-3.5 h-3.5" />, 'Ownership not checked', 'var(--muted)')
        : r?.status === 'approved' ? chip(<CheckCircle2 className="w-3.5 h-3.5" />, `Ownership checked · ${fmtDate(r.reviewedAt ?? r.createdAt)}`, 'var(--accent)')
        : r?.status === 'pending' ? chip(<Clock className="w-3.5 h-3.5" />, 'Documents under review', '#a35a00')
        : r?.status === 'rejected' ? chip(<XCircle className="w-3.5 h-3.5" />, 'Documents not accepted', 'var(--danger)')
        : chip(<ShieldQuestion className="w-3.5 h-3.5" />, 'Ownership not checked', 'var(--muted)')}
      {r?.status !== 'approved' && r?.status !== 'pending' && (
        <button onClick={() => { mine.connect(); setOpen(true); }} className="text-xs font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>
          {r?.status === 'rejected' ? 'Try again' : 'Prove ownership'}
        </button>
      )}
      {open && <OwnershipSheet account={account} listingId={listingId} address={address} rejected={r?.status === 'rejected' ? r : undefined} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OwnershipSheet({ account, listingId, address, rejected, onClose }: { account: SmartAccount; listingId: string; address?: string; rejected?: OwnershipRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [docType, setDocType] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  function addFiles(list: FileList | null) {
    const ok = Array.from(list ?? []).filter(f => /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type));
    const big = ok.find(f => f.size > 10 * 1024 * 1024);
    if (big) toast.error(`${big.name} is over 10 MB. Take a smaller photo or compress the PDF.`);
    if (ok.length < (list?.length ?? 0)) toast.error('Only photos (JPG, PNG) and PDFs are accepted.');
    setFiles(prev => [...prev, ...ok.filter(f => f.size <= 10 * 1024 * 1024)].slice(0, 3));
  }

  async function send() {
    if (!docType) { toast.error('Choose what kind of document this is.'); return; }
    if (!files.length) { toast.error('Add a photo or PDF of the document.'); return; }
    if (!consent) { toast.error('Tick the box to agree to how we handle your documents.'); return; }
    setBusy(true);
    try {
      await submitOwnership(account, { listingId, docType, note }, files);
      await qc.invalidateQueries({ queryKey: ['ownership-mine', account.address.toLowerCase()] });
      toast.success('Documents sent. We usually review them within 2 working days.');
      onClose();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ y: 40 }} animate={{ y: 0 }} role="dialog" aria-modal="true" aria-label="Prove ownership"
        className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Prove you own this property</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{address || 'This listing'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}><X className="w-4 h-4" style={{ color: 'var(--ink)' }} /></button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          {rejected && (
            <p className="text-sm px-3 py-2.5 rounded-xl" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
              Last time: “{rejected.reason}”
            </p>
          )}
          <p className="text-sm flex items-start gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
            <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
            Only the Handova team sees these documents. They're encrypted while we review them and deleted once we've decided. Tenants just see an “Ownership checked” badge.
          </p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>What are you sending?</p>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map(d => (
                <button key={d.id} onClick={() => setDocType(d.id)} className="text-left px-3 py-2.5 rounded-xl border"
                  style={docType === d.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : { borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{d.label}</span>
                  {d.hint && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{d.hint}</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Photos or PDF ({files.length}/3)</p>
            <label className="flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl border-2 border-dashed cursor-pointer" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
              <Upload className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Add a clear photo of each page</span>
              <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>JPG, PNG or PDF · up to 3 files · 10 MB each</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} disabled={files.length >= 3} />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                    <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
                    <span className="flex-1 truncate">{f.name}</span>
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X className="w-4 h-4" style={{ color: 'var(--muted)' }} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="Anything we should know? e.g. the C of O is in my father's name — I've added the letter of administration"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Tip: the name on the document should match the ID you verified with. If it doesn't, explain why in the note.</p>
          <label className="flex gap-3 items-start p-3 rounded-xl cursor-pointer" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--accent)]" aria-label="I agree to how Handova handles my documents" />
            <span className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              I agree that Handova may store these documents, encrypted, only to check that I own or may let this property.
              Only the Handova team can see them. They're deleted once reviewed; we keep only a fingerprint of each file and the decision.{' '}
              <a href="/privacy" target="_blank" rel="noreferrer" className="underline" onClick={e => e.stopPropagation()}>Privacy notice</a>
            </span>
          </label>
          <button onClick={() => { void send(); }} disabled={busy} className="w-full h-12 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: 'var(--accent)' }}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><FileCheck2 className="w-4 h-4" /> Send for review</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Admin review queue. */
export function OwnershipReview({ account }: { account: SmartAccount }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['ownership-pending'],
    queryFn: () => api<{ requests: OwnershipRequest[] }>(account, '/api/ownership/pending').then(r => r.requests),
    retry: false,
  });
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function review(id: number, decision: 'approve' | 'reject') {
    if (decision === 'reject' && (reasons[id] ?? '').trim().length < 5) { toast.error('Write a short reason so the landlord can fix it.'); return; }
    setBusy(id);
    try {
      await api(account, `/api/ownership/${id}/review`, { body: { decision, reason: reasons[id] ?? '' } });
      toast.success(decision === 'approve' ? 'Approved. The listing now shows "Ownership checked".' : 'Rejected. The landlord will see your reason.');
      await qc.invalidateQueries({ queryKey: ['ownership-pending'] });
      await qc.invalidateQueries({ queryKey: ['ownership-verified'] });
    } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  }

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--subtle)' }} /></div>;
  if (q.isError) return <p className="text-sm py-6 text-center" style={{ color: 'var(--danger)' }}>{errText(q.error)}</p>;
  if (!q.data?.length) return <p className="text-sm py-10 text-center" style={{ color: 'var(--muted)' }}>No ownership documents waiting for review.</p>;
  return (
    <ul className="space-y-3">
      {q.data.map(r => (
        <li key={r.id} className="p-4 rounded-2xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{r.address}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{r.docLabel} · listing #{r.listingId} · landlord <span className="mono">{r.landlord.slice(0, 6)}…{r.landlord.slice(-4)}</span> · {fmtDate(r.createdAt)}</p>
            {r.note && <p className="text-sm mt-2" style={{ color: 'var(--ink-2)' }}>“{r.note}”</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {r.files?.map(f => (
              <button key={f.index} onClick={() => { void openOwnershipFile(account, r.id, f.index).catch(e => toast.error(errText(e))); }}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                <FileText className="w-3.5 h-3.5" /> {f.name}
              </button>
            ))}
          </div>
          <input value={reasons[r.id] ?? ''} onChange={e => setReasons(p => ({ ...p, [r.id]: e.target.value }))} placeholder="Reason if rejecting (the landlord sees this)"
            className="w-full h-10 px-3 rounded-xl text-sm outline-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          <div className="flex gap-2">
            <button onClick={() => { void review(r.id, 'approve'); }} disabled={busy === r.id} className="flex-1 h-10 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5" style={{ background: 'var(--accent)' }}>
              {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve
            </button>
            <button onClick={() => { void review(r.id, 'reject'); }} disabled={busy === r.id} className="flex-1 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5" style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}>
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

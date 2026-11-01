/**
 * DisputeEvidence — tenants or landlords upload evidence during a dispute.
 * Photos, videos, documents. Simulates IPFS upload (base64 stored locally for demo).
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileText, Image, Film, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useLang } from '@/lib/LangContext';
import { toast } from 'sonner';

interface EvidenceFile {
  id: string;
  name: string;
  type: 'image' | 'video' | 'doc';
  url?: string;
  size: string;
}

interface Props {
  escrowId: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export default function DisputeEvidence({ escrowId, onClose }: Props) {
  const { t } = useLang();
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList).slice(0, 10 - files.length);
    const items: EvidenceFile[] = [];
    for (const f of arr) {
      let type: EvidenceFile['type'] = 'doc';
      let url: string | undefined;
      if (f.type.startsWith('image/')) {
        type = 'image';
        url = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
      } else if (f.type.startsWith('video/')) {
        type = 'video';
      }
      items.push({ id: Math.random().toString(36).slice(2), name: f.name, type, url, size: formatSize(f.size) });
    }
    setFiles(prev => [...prev, ...items]);
  }, [files.length]);

  async function handleSubmit() {
    if (files.length === 0 && !note.trim()) {
      toast.error('Add at least one file or a written note.');
      return;
    }
    setSubmitting(true);
    // Simulate IPFS/API upload
    await new Promise(r => setTimeout(r, 2000));
    setSubmitted(true);
    setSubmitting(false);
    toast.success(t('evidence_submitted'));
  }

  const FILE_ICONS: Record<EvidenceFile['type'], React.ElementType> = {
    image: Image,
    video: Film,
    doc: FileText,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'var(--glass-card)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--glass-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          maxHeight: '90dvh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4.5 h-4.5" style={{ color: '#f59e0b' }} />
            <span className="font-bold" style={{ color: 'var(--ink)' }}>{t('dispute_evidence')} — Escrow #{escrowId}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-8 gap-4 text-center">
                <CheckCircle2 className="w-14 h-14" style={{ color: 'var(--success)' }} />
                <div>
                  <h3 className="font-bold text-lg mb-1" style={{ color: 'var(--ink)' }}>{t('evidence_submitted')}</h3>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>The Handova team will review your evidence and resolve the dispute within 48 hours.</p>
                </div>
                <button onClick={onClose} className="px-8 py-3 rounded-2xl font-semibold text-white"
                  style={{ background: 'var(--accent)' }}>Done</button>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
                    Upload photos, videos, or documents as evidence. This is reviewed by the Handova team before funds are released.
                  </p>
                </div>

                {/* Drop zone */}
                <div
                  className="rounded-3xl border-2 border-dashed transition-all relative"
                  style={{
                    borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                    background: dragOver ? 'var(--accent-soft)' : 'var(--surface-muted)',
                  }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
                >
                  <input ref={inputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={e => { if (e.target.files) void addFiles(e.target.files); }} />
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center py-8 gap-2">
                      <Upload className="w-8 h-8" style={{ color: 'var(--accent)' }} />
                      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{t('upload_evidence')}</p>
                      <p className="text-xs" style={{ color: 'var(--subtle)' }}>{t('evidence_sub')}</p>
                    </div>
                  ) : (
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {files.map(f => {
                        const Icon = FILE_ICONS[f.type];
                        return (
                          <div key={f.id} className="flex items-center gap-2 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--surface-strong)' }}>
                            {f.type === 'image' && f.url
                              ? <img src={f.url} alt={f.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                              : <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent-soft)' }}><Icon className="w-4 h-4" style={{ color: 'var(--accent)' }} /></div>}
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--ink)' }}>{f.name}</p>
                              <p className="text-[10px]" style={{ color: 'var(--subtle)' }}>{f.size}</p>
                            </div>
                            <button onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}>
                              <X className="w-3.5 h-3.5" style={{ color: 'var(--subtle)' }} />
                            </button>
                          </div>
                        );
                      })}
                      {files.length < 10 && (
                        <button onClick={() => inputRef.current?.click()}
                          className="flex items-center justify-center py-8 rounded-2xl border-2 border-dashed"
                          style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
                          <Upload className="w-5 h-5" style={{ color: 'var(--subtle)' }} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Written note */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Written Statement</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Describe what happened and why you are filing a dispute…"
                    rows={3} className="w-full px-4 py-3 rounded-2xl border text-sm outline-none resize-none"
                    style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }} />
                </div>

                <motion.button whileTap={{ scale: 0.97 }} onClick={() => { void handleSubmit(); }} disabled={submitting}
                  className="w-full py-4 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
                  style={{ background: submitting ? 'var(--subtle)' : '#a35a00', boxShadow: submitting ? 'none' : '0 4px 16px rgba(245,158,11,0.3)' }}>
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading evidence…</> : <><Upload className="w-4 h-4" /> {t('submit_evidence')}</>}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

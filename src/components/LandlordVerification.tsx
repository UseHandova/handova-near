/**
 * LandlordVerification — real identity check, recorded onchain as RentFlowEscrow.verifiedAt(landlord).
 * Provider (from /api/verify/config):
 *   - didit: hosted ID document + liveness + face match; we redirect there and collect the decision on return
 *   - dojah: NIN + selfie sent through our server for an NIMC lookup and face match
 * The badge is public and survives devices. Handova never stores the ID number or photos.
 */

import { useState } from 'react';
import { CHAIN_ID } from '@/lib/network';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { BadgeCheck, X, Loader2, AlertCircle, Shield, Camera, ExternalLink } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { useLang } from '@/lib/LangContext';
import { useRefreshChain, useVerifiedAt } from '@/lib/chain';
import { buildTxExplorerUrl } from '@/onchain-facts';

interface Props {
  account: SmartAccount;
  onClose: () => void;
  /** Didit session we just returned from (from ?verificationSessionId=…), to collect its result. */
  diditSessionId?: string;
}

type CompleteResult = { ok: boolean; code?: string; error?: string; txHash?: string };

/** Downscale a photo to a JPEG the KYC provider accepts (and that uploads fast on mobile data). */
function toJpeg(file: File, maxSide = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = URL.createObjectURL(file);
  });
}

export default function LandlordVerification({ account, onClose, diditSessionId }: Props) {
  const { t } = useLang();
  const verifiedAt = useVerifiedAt(account.address);
  const refreshChain = useRefreshChain();
  const [nin, setNin] = useState('');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const kycConfig = useQuery({
    queryKey: ['verify-config'],
    queryFn: async () => (await fetch('/api/verify/config')).json() as Promise<{ provider: string | null; sandbox?: boolean }>,
    staleTime: 60_000,
  });

  const isVerified = (verifiedAt.data ?? 0) > 0;
  const isDidit = kycConfig.data?.provider === 'didit';
  const canSubmit = isDidit ? consent && !submitting : /^\d{11}$/.test(nin) && !!selfie && consent && !submitting;

  // Back from Didit's hosted page: collect the decision once.
  const [returnSession, setReturnSession] = useState(diditSessionId ?? '');
  const result = useQuery({
    queryKey: ['didit-complete', returnSession],
    enabled: !!returnSession,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<CompleteResult> => {
      const res = await fetch('/api/verify/didit/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: returnSession }),
      });
      const body = await res.json().catch(() => ({ ok: false, error: 'Could not read the result. Please try again.' })) as CompleteResult;
      if (body.ok) await refreshChain();
      return body;
    },
  });
  const returnError = returnSession && result.data && !result.data.ok ? result.data : null;

  /** Didit: prove wallet ownership, then hand over to Didit's hosted ID + selfie flow. */
  async function startDidit() {
    setSubmitting(true); setError('');
    try {
      const ch = await fetch(`/api/verify/challenge?address=${account.address}`);
      if (!ch.ok) throw new Error('Could not start verification. Please try again.');
      const { nonce, message } = await ch.json() as { nonce: string; message: string };
      const signature = await account.signMessage({ message });
      const res = await fetch('/api/verify/didit/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account.address, nonce, signature, returnTo: window.location.origin }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; alreadyVerified?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not start verification. Please try again.');
      if (body.alreadyVerified) { await refreshChain(); return; }
      window.location.assign(body.url!);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/NotAllowedError|cancel/i.test(msg) ? 'Face ID / fingerprint was cancelled. Tap Start to try again.' : msg);
      setSubmitting(false);
    }
  }

  async function handleSelfie(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setSelfie(await toJpeg(file)); setError(''); } catch { setError('Could not read that photo. Please take another.'); }
  }

  async function handleSubmit() {
    if (!canSubmit || !selfie) return;
    setSubmitting(true); setError('');
    try {
      const ch = await fetch(`/api/verify/challenge?address=${account.address}`);
      if (!ch.ok) throw new Error('Could not start verification. Please try again.');
      const { nonce, message } = await ch.json() as { nonce: string; message: string };

      // Proves this wallet is yours (Face ID / fingerprint prompt).
      const signature = await account.signMessage({ message });

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account.address, nonce, signature, nin, selfie }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; txHash?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Verification failed. Please try again.');

      setTxHash(body.txHash ?? '');
      setNin(''); setSelfie(null);
      await refreshChain();
      toast.success('Identity verified! Tenants now see your verified badge.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/NotAllowedError|cancel/i.test(msg) ? 'Face ID / fingerprint was cancelled. Tap Verify to try again.' : msg);
    } finally {
      setSubmitting(false);
    }
  }

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
        style={{ background: 'var(--popover)', border: '1px solid var(--border)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)', maxHeight: '90dvh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <span className="font-bold" style={{ color: 'var(--ink)' }}>{t('verify_identity')}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <AnimatePresence mode="wait">
            {returnSession && result.isFetching ? (
              <div key="collecting" className="flex flex-col items-center gap-3 py-10 text-center">
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
                <p className="font-semibold" style={{ color: 'var(--ink)' }}>Checking your result…</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>This takes a few seconds while we save your badge onchain.</p>
              </div>
            ) : verifiedAt.isLoading ? (
              <div key="loading" className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
            ) : isVerified ? (
              <motion.div key="verified" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center py-6 gap-4">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--success)', boxShadow: '0 8px 32px rgba(26,128,71,0.3)' }}>
                  <BadgeCheck className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h3 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{t('verification_approved')}</h3>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    Verified on {new Date(verifiedAt.data!).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}.
                    Tenants see the badge on all your listings.
                  </p>
                  {txHash && (
                    <a href={buildTxExplorerUrl(CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
                      View onchain record <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button onClick={onClose} className="px-8 py-3 rounded-2xl font-semibold text-white"
                  style={{ background: 'var(--accent)' }}>
                  Done
                </button>
              </motion.div>
            ) : isDidit ? (
              <motion.div key="didit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                {returnError && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm" role="alert"
                    style={returnError.code === 'in_review'
                      ? { background: 'rgba(242,180,90,0.10)', border: '1px solid rgba(242,180,90,0.35)', color: 'var(--ink-2)' }
                      : { background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)', color: 'var(--danger)' }}>
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{returnError.error}</span>
                  </div>
                )}
                {returnError?.code === 'in_review' ? (
                  <button onClick={() => { void result.refetch(); }}
                    className="w-full py-3.5 rounded-2xl font-semibold text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                    Check again
                  </button>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
                      <Shield className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                      <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Takes about 2 minutes</p>
                        <ol className="list-decimal list-inside mt-1 space-y-0.5">
                          <li>Photo of your NIN slip, national ID, driver's licence or passport</li>
                          <li>A short selfie video to prove it's really you</li>
                        </ol>
                        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Done securely by our partner Didit. Handova keeps only a "verified" mark — not your ID or photos.</p>
                      </div>
                    </div>
                    <label className="flex items-start gap-2.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
                      <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                      <span>I agree that Handova's partner Didit may check my ID document and selfie to verify my identity.</span>
                    </label>
                    {error && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs" role="alert"
                        style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)', color: 'var(--danger)' }}>
                        <AlertCircle className="w-4 h-4 shrink-0" /><span className="leading-relaxed">{error}</span>
                      </div>
                    )}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setReturnSession(''); void startDidit(); }} disabled={!canSubmit}
                      className="w-full py-4 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
                      style={{ background: canSubmit ? 'var(--accent)' : 'var(--subtle)' }}>
                      {submitting
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening secure verification…</>
                        : <><BadgeCheck className="w-4 h-4" /> {returnError ? 'Start again' : 'Start verification'}</>}
                    </motion.button>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
                  <Shield className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--accent)' }}>
                    We check your NIN with NIMC and match your selfie to your NIN photo. We don't keep your NIN or photo —
                    only a "verified" mark on your account.
                  </p>
                </div>

                {kycConfig.data?.sandbox && (
                  <div className="px-4 py-3 rounded-2xl text-xs leading-relaxed"
                    style={{ background: 'rgba(242,180,90,0.10)', border: '1px solid rgba(242,180,90,0.35)', color: 'var(--ink-2)' }}>
                    <b style={{ color: 'var(--warning)' }}>Test mode.</b> Real NINs can't be checked yet. Use the test NIN{' '}
                    <button type="button" onClick={() => setNin('70123456789')} className="mono font-semibold underline" style={{ color: 'var(--ink)' }}>70123456789</button>{' '}
                    and any selfie. Please don't enter your real NIN until launch.
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>NIN (11 digits)</label>
                  <input value={nin} onChange={e => { setNin(e.target.value.replace(/\D/g, '').slice(0, 11)); setError(''); }}
                    placeholder={t('nin_placeholder')} inputMode="numeric" autoComplete="off"
                    className="w-full px-4 py-3 rounded-2xl border text-sm outline-none mono tracking-wider"
                    style={{ background: 'var(--surface-strong)', borderColor: /^\d{11}$/.test(nin) ? 'var(--accent)' : 'var(--border)', color: 'var(--ink)' }} />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Selfie</label>
                  <label className="flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer"
                    style={{ background: selfie ? 'var(--accent-soft)' : 'var(--surface-strong)', borderColor: selfie ? 'var(--accent)' : 'var(--border)' }}>
                    <input type="file" accept="image/*" capture="user" className="sr-only" onChange={e => { void handleSelfie(e); }} />
                    {selfie
                      ? <><img src={selfie} alt="" className="w-10 h-10 rounded-xl object-cover" /><span className="text-sm" style={{ color: 'var(--accent)' }}>Selfie ready · tap to retake</span></>
                      : <><Camera className="w-4 h-4" style={{ color: 'var(--muted)' }} /><span className="text-sm" style={{ color: 'var(--muted)' }}>Take a selfie — face the camera in good light</span></>}
                  </label>
                </div>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>I agree that Handova may check my NIN and selfie with NIMC through Dojah to verify my identity.</span>
                </label>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs" role="alert"
                    style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)', color: 'var(--danger)' }}>
                    <AlertCircle className="w-4 h-4 shrink-0" /><span className="leading-relaxed">{error}</span>
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} onClick={() => { void handleSubmit(); }} disabled={!canSubmit}
                  className="w-full py-4 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
                  style={{ background: canSubmit ? 'var(--accent)' : 'var(--subtle)' }}>
                  {submitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking with NIMC…</>
                    : <><BadgeCheck className="w-4 h-4" /> Verify my identity</>}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

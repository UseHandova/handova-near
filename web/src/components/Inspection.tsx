import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Camera, ExternalLink, ScanSearch, X } from 'lucide-react';
import { API_BASE, api } from '../lib/api';
import { usd, usdc } from '../lib/money';
import { shortAccount } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Lease } from '../lib/types';
import { Busy } from './ui';

interface Inspection {
  at: number;
  requestedBy: string;
  after: string[];
  result: { issues: { area: string; issue: string; severity: string }[]; normalWearOnly: boolean; suggestedDeductionPercent: number; summary: string; confidence: string };
  receipt: { verified: boolean; model: string; attestationUrl: string };
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SEVERITY: Record<string, string> = { major: 'bg-danger/15 text-danger', moderate: 'bg-warn/15 text-warn', minor: 'bg-muted text-ink2' };

/**
 * NEAR AI move-out inspection: listing photos vs move-out photos, with a verified TEE receipt. Advice for the
 * landlord, the tenant and the council; it never moves money.
 */
export function InspectionPanel({ lease, holder, onSuggest }: { lease: Lease; holder: string; onSuggest?: (usdcAmount: string) => void }) {
  const { session } = useSession();
  const toast = useToast();
  const [list, setList] = useState<Inspection[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api<{ inspections: Inspection[] }>(`/api/ai/inspections?leaseId=${lease.id}`).then((r) => setList(r.inspections)).catch(() => {});
  }, [lease.id]);
  useEffect(() => { load(); }, [load]);

  const me = session?.accountId;
  const canRun = !!me && (me === lease.landlord || me === holder);
  const latest = list.at(-1);
  const caution = usdc(lease.caution);

  async function addPhoto(file: File) {
    setBusy('photo');
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${API_BASE}/api/media`, { method: 'POST', body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPhotos((p) => [...p, new URL(j.url, location.origin).toString()].slice(0, 3));
    } catch (e) {
      toast('error', (e as Error).message || 'Upload failed. Try a smaller photo.');
    } finally {
      setBusy('');
    }
  }

  async function run() {
    if (!session) return;
    setBusy('run');
    try {
      const c = await api<{ nonce: string; message: string; recipient: string }>(`/api/ai/inspect/challenge?accountId=${encodeURIComponent(session.accountId)}&leaseId=${lease.id}`);
      const signed = await session.signMessage(c.message, fromBase64(c.nonce), c.recipient);
      await api('/api/ai/inspect', { accountId: session.accountId, nonce: c.nonce, signature: signed.signature, publicKey: signed.publicKey, after: photos });
      toast('ok', 'NEAR AI compared the photos. Its advice is below.');
      setPhotos([]);
      load();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!latest && !canRun) return null;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><ScanSearch className="h-5 w-5" /></span>
        <div>
          <p className="font-semibold">AI move-out inspection</p>
          <p className="text-sm text-sub">NEAR AI compares the listing's photos with photos taken at move-out, inside a secure enclave. It only advises: you agree a split, or the council decides.</p>
        </div>
      </div>

      {latest && (
        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p className="text-sm text-ink">{latest.result.summary}</p>
          {latest.result.issues.length > 0 ? (
            <ul className="space-y-1">
              {latest.result.issues.map((i, n) => (
                <li key={n} className="flex items-start gap-2 text-sm">
                  <span className={`chip !py-0.5 !text-[11px] ${SEVERITY[i.severity] ?? SEVERITY.minor}`}>{i.severity}</span>
                  <span><b>{i.area}</b>: {i.issue}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ok">No clear damage found{latest.result.normalWearOnly ? ' (normal wear only)' : ''}.</p>
          )}
          <p className="text-sm">
            Suggested: landlord keeps <b>{latest.result.suggestedDeductionPercent}%</b> of the caution ≈ <b>{usd((caution * latest.result.suggestedDeductionPercent) / 100)}</b> · confidence {latest.result.confidence}
          </p>
          {onSuggest && me === lease.landlord && latest.result.suggestedDeductionPercent > 0 && (
            <button className="btn-ghost w-full !py-2 text-sm" onClick={() => onSuggest(((caution * latest.result.suggestedDeductionPercent) / 100).toFixed(2))}>Use this amount</button>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
            {latest.receipt.verified && <span className="inline-flex items-center gap-1 font-semibold text-accent"><BadgeCheck className="h-3.5 w-3.5" />Verified NEAR AI receipt</span>}
            <span>{latest.receipt.model} · asked by {shortAccount(latest.requestedBy)} · {new Date(latest.at).toLocaleString()}</span>
            <a className="inline-flex items-center gap-0.5" href={latest.receipt.attestationUrl} target="_blank" rel="noreferrer">attestation <ExternalLink className="h-3 w-3" /></a>
          </p>
          {list.length > 1 && <p className="text-xs text-faint">{list.length} inspections on this lease; the council sees all of them.</p>}
        </div>
      )}

      {canRun && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{latest ? 'Ask again with new photos' : 'Add up to 3 move-out photos'}</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p} className="relative">
                <img src={p} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <button onClick={() => setPhotos((x) => x.filter((y) => y !== p))} aria-label="Remove photo" className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-faint hover:text-accent">
                {busy === 'photo' ? <Busy busy>{''}</Busy> : <Camera className="h-6 w-6" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
              </label>
            )}
          </div>
          <button className="btn-primary w-full" disabled={!!busy || photos.length === 0} onClick={run}>
            <Busy busy={busy === 'run'}><ScanSearch className="h-4 w-4" />Compare with NEAR AI</Busy>
          </button>
        </div>
      )}
    </div>
  );
}

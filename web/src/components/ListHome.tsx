import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { ImagePlus, Mic, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import { teraToGas } from 'near-api-js';
import { API_BASE, api } from '../lib/api';
import { encodeDetails } from '../lib/listing';
import { useNgnRate } from '../lib/money';
import { nearConfig, txUrl } from '../lib/near';
import { go } from '../lib/router';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Busy, Empty } from './ui';

const AMENITIES = ['Prepaid meter', 'Borehole', 'Security', 'Parking', 'Tiled', 'Fenced', 'POP ceiling', 'Kitchen cabinets', 'Wardrobe', 'Generator', 'CCTV', 'Water heater'];

interface Receipt { verified: boolean; model: string; signingAddress: string; chatId: string; checks: Record<string, boolean>; attestationUrl: string }

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export function ListHome({ onNeedSignIn }: { onNeedSignIn: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const rate = useNgnRate();
  const cfg = nearConfig();
  const { t } = useT();

  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const [f, setF] = useState({ title: '', area: '', city: 'Lagos', beds: '', baths: '', type: 'flat', rentNgn: '', cautionNgn: '', term: '12', description: '' });
  const [amenities, setAmenities] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => { if (s >= 119) rec.current?.stop(); return s + 1; }), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        await draft({ audioBase64: toBase64(await blob.arrayBuffer()), mime: blob.type });
      };
      rec.current = mr;
      setSeconds(0);
      mr.start();
      setRecording(true);
    } catch {
      toast('error', 'Allow microphone access to record, or type the details instead.');
    }
  }

  async function draft(body: object) {
    setDrafting(true);
    try {
      const r = await api<{ transcript?: string; draft: any; receipt: Receipt }>('/api/ai/listing-draft', body);
      const d = r.draft;
      setTranscript(r.transcript ?? '');
      setReceipt(r.receipt);
      setF((x) => ({
        ...x,
        title: d.title ?? x.title,
        area: d.area ?? x.area,
        city: d.city ?? x.city,
        beds: d.bedrooms != null ? String(d.bedrooms) : x.beds,
        baths: d.bathrooms != null ? String(d.bathrooms) : x.baths,
        type: d.propertyType ?? x.type,
        rentNgn: d.rentNgn != null ? String(d.rentPeriod === 'month' ? d.rentNgn * 12 : d.rentNgn) : x.rentNgn,
        cautionNgn: d.cautionNgn != null ? String(d.cautionNgn) : x.cautionNgn,
        description: d.description ?? x.description,
      }));
      if (Array.isArray(d.amenities)) setAmenities(d.amenities.filter((a: string) => AMENITIES.includes(a)));
      toast('ok', d.missing?.length ? `Draft ready. Please add: ${d.missing.join(', ')}.` : 'Draft ready. Check every detail before publishing.');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function addPhoto(file: File) {
    if (photos.length >= 4) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${API_BASE}/api/media`, { method: 'POST', body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPhotos((p) => [...p, new URL(j.url, location.origin).toString()]);
    } catch (e) {
      toast('error', (e as Error).message || 'Upload failed. Try a smaller photo.');
    } finally {
      setUploading(false);
    }
  }

  const rentUsdc = Number(f.rentNgn) / rate;
  const cautionUsdc = Number(f.cautionNgn || 0) / rate;
  const units = (usd: number) => String(Math.round(usd * 100) * 10_000); // whole cents, 6 decimals
  const ready = session && f.title && f.area && Number(f.rentNgn) > 0;

  async function publish() {
    if (!session) return onNeedSignIn();
    setPublishing(true);
    try {
      const property_ref = encodeDetails({
        title: f.title, area: f.area, city: f.city, beds: Number(f.beds) || undefined, baths: Number(f.baths) || undefined,
        type: f.type, photos, description: f.description, amenities,
      });
      const r = await session.call(cfg.escrow, 'create_listing', {
        rent: units(rentUsdc), caution: units(cautionUsdc), term_months: Number(f.term), property_ref,
      }, { gas: teraToGas('50') });
      if (!r.ok) throw new Error(r.error ?? 'Publishing failed. Try again.');
      const id = r.events.find((e) => e.event === 'listing_created')?.data[0].listing_id;
      toast('ok', 'Your home is live on NEAR.', txUrl(r.hash));
      go(id ? `/home/${id}` : '/landlord');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (!session) {
    return <div className="pt-6"><Empty icon={<Mic className="h-6 w-6" />} title="Sign in to list a home"><button className="btn-primary mt-3" onClick={onNeedSignIn}>Get started</button></Empty></div>;
  }

  return (
    <div className="space-y-5 pt-2">
      <h1 className="font-display text-2xl font-bold">{t('List a home')}</h1>

      {cfg.ai && (
        <section className="card space-y-3 p-4">
          <p className="font-semibold">Describe it in a voice note</p>
          <p className="text-sm text-sub">Say the area, rooms, rent and caution in English, Pidgin, Yorùbá or Hausa (or type it). NEAR AI drafts the listing privately; you check it before it goes live.</p>
          <div className="flex items-center gap-3">
            {recording ? (
              <button className="btn-danger" onClick={() => rec.current?.stop()}><Square className="h-4 w-4" /> Stop · {seconds}s</button>
            ) : (
              <button className="btn-primary" disabled={drafting} onClick={startRecording}><Busy busy={drafting}><Mic className="h-4 w-4" /> {drafting ? 'Drafting…' : 'Record'}</Busy></button>
            )}
            <span className="text-sm text-faint">or type below</span>
          </div>
          <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2 bedroom flat for Yaba near Unilag, prepaid meter, borehole. Rent 1.8m per year, caution 200k." />
          <button className="btn-ghost w-full" disabled={drafting || text.trim().length < 10} onClick={() => draft({ text })}><Busy busy={drafting}><Sparkles className="h-4 w-4" /> {t('Draft with NEAR AI')}</Busy></button>
          {transcript && <p className="rounded-xl bg-muted p-3 text-sm"><b>We heard:</b> {transcript}</p>}
          {receipt && (
            <details className="rounded-xl bg-accent-soft p-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-semibold text-accent"><ShieldCheck className="h-4 w-4" /> {receipt.verified ? 'Drafted privately in a verified NEAR AI enclave' : 'Drafted by NEAR AI (verification incomplete)'}</summary>
              <div className="mt-2 space-y-1 text-xs text-ink2">
                <p>Model <b>{receipt.model}</b> ran inside a TEE. The enclave signed the hashes of our exact request and its answer; we checked the signature and that the key is in the model's attestation report.</p>
                <p>Hashes match: {String(receipt.checks.hashesMatch)} · Signature valid: {String(receipt.checks.signatureValid)} · Key attested: {String(receipt.checks.keyAttested)}</p>
                <p className="mono">Signer {receipt.signingAddress}</p>
                <a className="font-semibold text-accent" href={receipt.attestationUrl} target="_blank" rel="noreferrer">Attestation report</a>
              </div>
            </details>
          )}
        </section>
      )}

      <section className="card space-y-4 p-4">
        <div><label className="label" htmlFor="t">Title</label><input id="t" className="input" value={f.title} onChange={set('title')} placeholder="2-bedroom flat near Unilag" maxLength={80} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="a">Area</label><input id="a" className="input" value={f.area} onChange={set('area')} placeholder="Yaba" /></div>
          <div><label className="label" htmlFor="c">City</label><input id="c" className="input" value={f.city} onChange={set('city')} /></div>
          <div><label className="label" htmlFor="b">Bedrooms</label><input id="b" className="input" inputMode="numeric" value={f.beds} onChange={set('beds')} /></div>
          <div><label className="label" htmlFor="ba">Bathrooms</label><input id="ba" className="input" inputMode="numeric" value={f.baths} onChange={set('baths')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="r">Rent (₦ for the term)</label><input id="r" className="input" inputMode="numeric" value={f.rentNgn} onChange={(e) => setF((x) => ({ ...x, rentNgn: e.target.value.replace(/\D/g, '') }))} placeholder="1800000" /></div>
          <div><label className="label" htmlFor="cf">Caution fee (₦)</label><input id="cf" className="input" inputMode="numeric" value={f.cautionNgn} onChange={(e) => setF((x) => ({ ...x, cautionNgn: e.target.value.replace(/\D/g, '') }))} placeholder="200000" /></div>
        </div>
        <div><label className="label" htmlFor="term">Term</label>
          <select id="term" className="input" value={f.term} onChange={set('term')}>
            <option value="6">6 months</option><option value="12">1 year</option><option value="24">2 years</option>
          </select>
        </div>
        {Number(f.rentNgn) > 0 && <p className="text-xs text-sub">Stored on-chain as {rentUsdc.toFixed(2)} USDC rent + {cautionUsdc.toFixed(2)} USDC caution (₦{rate.toLocaleString()} per USD today). Tenants pay in USDC; the price never changes after they pay.</p>}
        <div><label className="label" htmlFor="desc">Description</label><textarea id="desc" className="input min-h-20" value={f.description} onChange={set('description')} maxLength={400} /></div>
        <div>
          <p className="label">Amenities</p>
          <div className="flex flex-wrap gap-1.5">
            {AMENITIES.map((a) => (
              <button key={a} type="button" onClick={() => setAmenities((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))} className={`chip ${amenities.includes(a) ? '!bg-accent !text-white' : ''}`}>{a}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">Photos (up to 4)</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p} className="relative">
                <img src={p} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <button onClick={() => setPhotos((x) => x.filter((y) => y !== p))} aria-label="Remove photo" className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {photos.length < 4 && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-faint hover:text-accent">
                {uploading ? <Busy busy>{''}</Busy> : <ImagePlus className="h-6 w-6" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
              </label>
            )}
          </div>
        </div>
      </section>

      <button className="btn-primary w-full" disabled={!ready || publishing} onClick={publish}>
        <Busy busy={publishing}>{t('Publish on NEAR')}{session.kind === 'device' ? ' — free' : ''}</Busy>
      </button>
    </div>
  );
}

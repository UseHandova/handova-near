/**
 * LandlordDashboard — full landlord hub.
 * Glass cards, animated media grid, tab navigation, rich stats.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { CHAIN_ID } from '@/lib/network';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, BadgeCheck, Building2, Check, CheckCircle2, ChevronRight, Home, ImagePlus, Info, Loader2, MapPin, MessageCircle, Pencil, Play, PlusCircle, ShieldAlert, Star, Trash2, TrendingUp, Upload, Wrench, X,
} from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { formatNaira, nairaToUsdc, USDC_TO_NGN } from '@/lib/naira';
import { parseAmount } from '@/onchain-money';
import { ESCROW_ABI, ESCROW_ADDRESS } from '@/lib/contracts';
import {
  sameAddress, sendEscrowTx, useChainState, useNow, usePendingWithdrawal, useRefreshChain, useVerifiedAt,
  MOVE_IN_WINDOW_MS, DEPOSIT_REVIEW_MS, type ChainEscrow, assertCanPayGas, sendUserOp, txErrorText, mediaToNames } from '@/lib/chain';
import { EscrowStatus } from '@/lib/contracts';
import LandlordEscrowPanel from '@/components/LandlordEscrowPanel';
import { encodeFunctionData } from 'viem';
import { toast } from 'sonner';
import WhatsAppInbox from '@/components/WhatsAppInbox';
import RentedOut from '@/components/RentedOut';
import ListingSocialProof from '@/components/ListingSocialProof';
import { useListingStats } from '@/lib/listing-stats';
import LangSelector from '@/components/LangSelector';
import { geocodeAddress, PinDropMap } from '@/components/PropertyMap';
import ErrorBoundary from '@/components/ErrorBoundary';
import InspectionRequests from '@/components/InspectionRequests';
import { OwnershipRow } from '@/components/OwnershipProof';
import { LandlordCashPayments } from '@/components/CashPayment';
import { useMyOwnership } from '@/lib/ownership';
import { clearReturnParams, diditSessionFromUrl } from '@/lib/url';
import { usePath } from '@/lib/router';
import { RESIDENTIAL_TYPES, COMMERCIAL_TYPES, type PropertyType, type TranslationKey } from '@/lib/i18n';
import { useLang } from '@/lib/LangContext';
import LandlordVerification from '@/components/LandlordVerification';
import ListingBoost from '@/components/ListingBoost';
import MaintenanceTracker from '@/components/MaintenanceTracker';
import TenantReviews from '@/components/TenantReviews';
import { useUi } from '@/lib/i18n-ui';


interface Props { account: SmartAccount; }

/** A photo/video in the form: either a new local file to upload, or an already-uploaded URL (editing, WhatsApp draft). */
type MediaItem = { id: string; type: 'image' | 'video'; url: string; name: string; file?: File };
type View = 'home' | 'new-listing';
type DashTab = 'listings' | 'rented' | 'whatsapp' | 'stats';

interface MockListing {
  id: string;
  location: string;
  rooms: string;
  rentNgn: number;
  status: 'active' | 'rented';
  thumb: string | null;
  color: string;
  escrow?: ChainEscrow;
  cover?: string;
  photoCount: number;
  hasVideo: boolean;
  address?: string;
}

/** Naira amounts: the form keeps plain digits; the field shows them with thousands separators (750000 → 750,000). */
const digitsOnly = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
const withCommas = (digits: string) => (digits ? Number(digits).toLocaleString('en-NG') : '');

/** Nigerian number → international digits for wa.me (0803… → 234803…). Empty if it doesn't look valid. */
function normalisePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const intl = d.startsWith('234') ? d : d.startsWith('0') ? `234${d.slice(1)}` : d;
  return /^234\d{10}$/.test(intl) ? intl : '';
}

/** Escrow states where the landlord has something to do right now. */
function needsLandlord(e: ChainEscrow, now: number) {
  if (e.status === EscrowStatus.Pending) return e.handoverAt === 0 || now >= e.handoverAt + MOVE_IN_WINDOW_MS;
  if (e.status === EscrowStatus.Ending) return now < e.endRequestedAt + DEPOSIT_REVIEW_MS;
  return e.status === EscrowStatus.Disputed;
}

function listingStatus(e?: ChainEscrow): { label: string; tone: 'good' | 'warn' | 'neutral' } {
  if (!e) return { label: 'Listed · waiting for a tenant', tone: 'neutral' };
  switch (e.status) {
    case EscrowStatus.Pending: return e.handoverAt ? { label: 'Keys handed over', tone: 'warn' } : { label: 'Tenant has paid', tone: 'warn' };
    case EscrowStatus.Active: return { label: 'Rented', tone: 'good' };
    case EscrowStatus.Ending: return { label: 'Tenant moving out', tone: 'warn' };
    case EscrowStatus.Disputed: return { label: 'In dispute', tone: 'warn' };
    default: return { label: 'Listed', tone: 'neutral' };
  }
}

function Thumb({ cover, className }: { cover?: string; className: string }) {
  return cover
    ? <img src={cover} alt="" loading="lazy" className={`${className} object-cover`} />
    : <div className={`${className} flex items-center justify-center`} style={{ background: 'var(--surface-muted)' }}><Home className="w-6 h-6" style={{ color: 'var(--subtle)' }} /></div>;
}

const LISTING_COLORS = [
  'var(--accent)',
  'linear-gradient(135deg, #1e6b9e 0%, #3b9edd 100%)',
  'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
  'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)',
  'linear-gradient(135deg, #0e7490 0%, #22d3ee 100%)',
];

const AMENITIES = ['Generator', 'Borehole', 'Security', 'Parking', 'Tiled', 'Fenced', 'CCTV', 'Pop Ceiling'];

const springs = {
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as const,
  gentle: { type: 'spring', stiffness: 280, damping: 26 } as const,
};

const STEPS = ['Photos', 'Location', 'Details', 'Price'] as const;
const FIELD_STEP: Record<string, number> = { address: 1, location: 1, description: 2, rent: 3, deposit: 3 };

export default function LandlordDashboard({ account }: Props) {
  // Screen comes from the URL so reloads and the back button work.
  const [path, navigate] = usePath();
  const editMatch = path.match(/^\/landlord\/edit\/(\d+)$/);
  const editingId = editMatch ? BigInt(editMatch[1]) : null;
  const view: View = path === '/landlord/new' || editingId !== null ? 'new-listing' : 'home';
  const draftCode = view === 'new-listing' && !editingId ? (new URLSearchParams(window.location.search).get('draft') ?? '') : '';
  const dashTab: DashTab = path === '/landlord/whatsapp' ? 'whatsapp' : path === '/landlord/insights' ? 'stats' : path === '/landlord/rented' ? 'rented' : 'listings';
  const setView = (v: View) => navigate(v === 'new-listing' ? '/landlord/new' : '/landlord');
  const setDashTab = (t: DashTab) => navigate(t === 'whatsapp' ? '/landlord/whatsapp' : t === 'stats' ? '/landlord/insights' : t === 'rented' ? '/landlord/rented' : '/landlord');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const { t } = useLang();
  const u = useUi();
  const [form, setForm] = useState({
    address: '',
    location: '',
    rooms: '2',
    propertyType: 'two_bed' as PropertyType,
    furnishing: 'unfurnished' as 'furnished' | 'unfurnished' | 'semi_furnished',
    description: '',
    rentNgn: '',
    depositNgn: '',
    amenities: [] as string[],
    phone: '',
    preferences: '',
    preferenceTags: [] as string[],
  });
  const [geoStatus, setGeoStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [showPinDrop, setShowPinDrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const chain = useChainState();
  const refreshChain = useRefreshChain();

  // Pre-fill the form when editing a listing or reviewing a WhatsApp draft (once per target).
  const prefillKey = editingId !== null ? `edit:${editingId}` : draftCode ? `draft:${draftCode}` : '';
  const [prefilled, setPrefilled] = useState('');
  // Only a live listing you own can be edited (an edit retires the old id, so old links go stale).
  const editTarget = editingId !== null
    ? chain.data?.listings.find(l => l.id === editingId && l.active && l.landlord.toLowerCase() === account.address.toLowerCase())
    : undefined;
  const draftQuery = useQuery({
    queryKey: ['wa-draft', draftCode],
    enabled: !!draftCode,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`/api/bot/draft/${draftCode}`);
      if (!res.ok) throw new Error('This WhatsApp code was not found or was already used.');
      return res.json() as Promise<{ location: string; rooms: number; rentNgn: number; depositNgn: number; description: string; amenities: string[]; media?: { type: 'image' | 'video'; url: string }[] }>;
    },
  });
  useEffect(() => {
    if (!prefillKey || prefilled === prefillKey) return;
    const fromUrls = (items: { type: 'image' | 'video'; url: string }[] = []): MediaItem[] =>
      items.map((m, i) => ({ id: `existing-${i}`, type: m.type, url: m.url, name: m.url.split('/').pop() ?? 'media' }));
    if (editTarget) {
      const m = editTarget.meta;
      const roomsStr = String(m.rooms ?? 2);
      // Syncing form state from external (onchain) data once per edit target.
      // oxlint-disable-next-line react/set-state-in-effect
      setForm({
        address: m.address ?? '', location: m.location ?? '', rooms: ['1', '2', '3', '4'].includes(roomsStr) ? roomsStr : '5+',
        propertyType: (m.propertyType as PropertyType) ?? 'two_bed', furnishing: m.furnishing ?? 'unfurnished',
        description: m.description ?? '', rentNgn: String(Math.round(editTarget.rentUsdc * USDC_TO_NGN)),
        depositNgn: String(Math.round(editTarget.depositUsdc * USDC_TO_NGN)), amenities: m.amenities ?? [],
        phone: m.phone ? `0${m.phone.slice(3)}` : '',
        preferences: (m.preferences) ?? '',
        preferenceTags: (m.preferenceTags) ?? [],
      });
      setMedia(fromUrls(m.media));
      setPin(m.lat && m.lng ? { lat: m.lat, lng: m.lng } : null);
      setGeoStatus(m.lat && m.lng ? 'valid' : 'idle');
      setPrefilled(prefillKey);
    } else if (draftQuery.data) {
      const d = draftQuery.data;
      setForm(f => ({
        ...f, location: d.location ?? '', rooms: d.rooms >= 5 ? '5+' : String(d.rooms || 2), description: d.description ?? '',
        rentNgn: d.rentNgn ? String(d.rentNgn) : '', depositNgn: d.depositNgn ? String(d.depositNgn) : '', amenities: d.amenities ?? [],
      }));
      setMedia(fromUrls(d.media));
      setPrefilled(prefillKey);
    }
  }, [prefillKey, prefilled, editTarget, draftQuery.data]);
  // Returning from Didit's hosted page (?verificationSessionId=…): reopen verification to collect the result.
  const [diditReturn] = useState(diditSessionFromUrl);
  useEffect(() => { clearReturnParams(); }, []);
  const verifiedQuery = useVerifiedAt(account.address);
  const isVerified = (verifiedQuery.data ?? 0) > 0;
  // Pick up a verification finished elsewhere (another device via Didit's QR code, a closed tab, a lost redirect).
  useQuery({
    queryKey: ['didit-resume', account.address],
    enabled: verifiedQuery.isSuccess && !isVerified && !diditReturn,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/verify/didit/resume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: account.address }),
      });
      const body = await res.json().catch(() => ({ ok: false })) as { ok: boolean };
      if (body.ok) {
        await refreshChain();
        toast.success('Identity verified! Tenants now see your verified badge.');
      }
      return body;
    },
  });
  const withdrawable = usePendingWithdrawal(account.address).data ?? 0;
  const now = useNow();
  const [withdrawing, setWithdrawing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // This landlord's listings, read from the escrow contract.
  const listings = useMemo<MockListing[]>(() => {
    const escrows = new Map((chain.data?.escrows ?? []).map(e => [e.id, e]));
    return (chain.data?.listings ?? [])
      .filter(l => sameAddress(l.landlord, account.address) && (l.active || l.escrowId !== 0n))
      .reverse()
      .map(l => ({
        id: String(l.id),
        location: l.meta.location || l.meta.address || `Listing #${l.id}`,
        rooms: String(l.meta.rooms ?? '—'),
        rentNgn: l.rentUsdc * USDC_TO_NGN,
        status: l.escrowId !== 0n ? 'rented' : 'active',
        thumb: null,
        color: LISTING_COLORS[Number(l.id % BigInt(LISTING_COLORS.length))],
        escrow: escrows.get(l.escrowId),
        cover: l.meta.media?.find(m => m.type === 'image')?.url,
        photoCount: l.meta.media?.filter(m => m.type === 'image').length ?? 0,
        hasVideo: !!l.meta.media?.some(m => m.type === 'video'),
        address: l.meta.address,
      }));
  }, [chain.data, account.address]);
  const ownership = useMyOwnership(account);
  const statsFor = useListingStats();
  const [showVerification, setShowVerification] = useState(!!diditReturn);
  const [showBoost, setShowBoost] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rentUsdc = nairaToUsdc(parseFloat(form.rentNgn) || 0);
  const depositUsdc = nairaToUsdc(parseFloat(form.depositNgn) || 0);
  const locationConfirmed = geoStatus === 'valid' || pin !== null;
  // Every required field with a plain-language message, in the order they appear on the form.
  const problems: { field: string; message: string }[] = [
    form.address.trim().length <= 5 && { field: 'address', message: 'Add the full street address.' },
    form.address.trim().length > 5 && !locationConfirmed && { field: 'address', message: 'Confirm the address on the map — tap "Drop a Pin", or check the spelling so we can find it.' },
    !form.location.trim() && { field: 'location', message: 'Add the neighbourhood or area, e.g. Yaba.' },
    !form.description.trim() && { field: 'description', message: 'Add a short description of the property.' },
    !(parseFloat(form.rentNgn) > 0) && { field: 'rent', message: 'Enter the annual rent.' },
    !(parseFloat(form.depositNgn) > 0) && { field: 'deposit', message: 'Enter the caution fee.' },
  ].filter((p): p is { field: string; message: string } => !!p);
  const isValid = problems.length === 0;
  const [showErrors, setShowErrors] = useState(false);
  const fieldError = (field: string) => showErrors ? problems.find(p => p.field === field)?.message : undefined;
  const errorText = (field: string) => fieldError(field) && (
    <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--danger)' }} role="alert">
      <AlertCircle className="w-3 h-3 shrink-0" /> {fieldError(field)}
    </p>
  );

  // The form is split into short steps; each required field belongs to one.
  const [step, setStep] = useState(0);
  const [stepPath, setStepPath] = useState(path);
  if (stepPath !== path) { setStepPath(path); setStep(0); setShowErrors(false); }  // new screen → start at step 1
  const goToStep = (s: number) => { setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  function nextStep() {
    const here = problems.filter(p => FIELD_STEP[p.field] === step);
    if (here.length) {
      setShowErrors(true);
      toast.error(here[0].message);
      document.getElementById(`field-${here[0].field}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    goToStep(step + 1);
  }

  async function checkGeo() {
    if (form.address.trim().length < 5) return;
    setGeoStatus('checking');
    const result = await geocodeAddress(form.address);
    setGeoStatus(result ? 'valid' : 'invalid');
  }

  // Same limits as the server (server/media.ts): checked here first, so a huge video is refused at once
  // with a clear reason instead of being read into memory and failing at upload.
  const MAX_IMAGE_MB = 10, MAX_VIDEO_MB = 60, MAX_ITEMS = 10;
  const mb = (bytes: number) => (bytes / 1024 / 1024 >= 100 ? Math.round(bytes / 1024 / 1024) : Math.round(bytes / 1024 / 1024 * 10) / 10);

  const addFiles = useCallback((files: FileList | File[]) => {
    const all = Array.from(files);
    const room = MAX_ITEMS - media.length;
    const items: MediaItem[] = [];
    const problems: string[] = [];
    for (const f of all) {
      const isVideo = f.type.startsWith('video/'), isImage = f.type.startsWith('image/');
      if (!isVideo && !isImage) { problems.push(`"${f.name}" isn't a photo or video.`); continue; }
      const limit = isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB;
      if (f.size > limit * 1024 * 1024) {
        problems.push(isVideo
          ? `"${f.name}" is ${mb(f.size)} MB. Videos must be under ${MAX_VIDEO_MB} MB: trim it or record a shorter clip (about 1 minute).`
          : `"${f.name}" is ${mb(f.size)} MB. Photos must be under ${MAX_IMAGE_MB} MB.`);
        continue;
      }
      if (items.length >= room) { problems.push(`A listing can have up to ${MAX_ITEMS} photos and videos, so some files weren't added.`); break; }
      items.push({
        id: Math.random().toString(36).slice(2),
        type: isVideo ? 'video' : 'image',
        url: URL.createObjectURL(f), // preview without loading the whole file into memory
        name: f.name,
        file: f,
      });
    }
    if (items.length) setMedia(prev => [...prev, ...items]);
    if (problems.length) toast.error(problems.join(' '), { duration: 9_000 });
  }, [media.length]);

  function removeMedia(id: string) {
    setMedia(prev => {
      const gone = prev.find(m => m.id === id);
      if (gone?.url.startsWith('blob:')) URL.revokeObjectURL(gone.url);
      return prev.filter(m => m.id !== id);
    });
  }

  function toggleAmenity(a: string) {
    setForm(f => ({
      ...f,
      amenities: f.amenities.includes(a)
        ? f.amenities.filter(x => x !== a)
        : [...f.amenities, a],
    }));
  }

  async function handleSubmit() {
    if (!isValid) {
      setShowErrors(true);
      toast.error(problems.length === 1 ? problems[0].message : `Please fix ${problems.length} things: ${problems.map(p => p.message.replace(/\.$/, '')).join('; ')}.`);
      setStep(FIELD_STEP[problems[0].field] ?? step);
      setTimeout(() => document.getElementById(`field-${problems[0].field}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    if (!ESCROW_ADDRESS) {
      toast.error('Contract not deployed yet.');
      return;
    }
    setLoading(true);
    try {
      // Check the wallet can pay the network fee before uploading photos (mainnet, no gas sponsorship).
      await assertCanPayGas(account.address);
      const rentRaw = parseAmount(CHAIN_ID, rentUsdc.toFixed(6)).raw;
      const depositRaw = parseAmount(CHAIN_ID, depositUsdc.toFixed(6)).raw;

      // Upload new photos/videos first (already-uploaded ones keep their URL); the listing stores only URLs.
      const uploaded: { type: 'image' | 'video'; url: string }[] = [];
      for (const m of media) {
        if (!m.file) { uploaded.push({ type: m.type, url: m.url }); continue; }
        const body = new FormData();
        body.append('file', m.file);
        const res = await fetch('/api/media', { method: 'POST', body });
        const out = await res.json().catch(() => ({})) as { url?: string; type?: 'image' | 'video'; error?: string };
        if (!res.ok || !out.url) throw new Error(out.error ?? `Could not upload ${m.name}.`);
        uploaded.push({ type: out.type ?? m.type, url: out.url });
      }

      const metadata = JSON.stringify({
        address: form.address,
        location: form.location,
        rooms: parseInt(form.rooms),
        propertyType: form.propertyType,
        furnishing: form.furnishing,
        description: form.description,
        amenities: form.amenities,
        // Compact on-chain form (file names only) and ~1 m precision on the pin: fewer bytes, less gas.
        m: mediaToNames(uploaded),
        ...(pin && { lat: Math.round(pin.lat * 1e5) / 1e5, lng: Math.round(pin.lng * 1e5) / 1e5 }),
        ...(normalisePhone(form.phone) && { phone: normalisePhone(form.phone) }),
        ...(form.preferences.trim() && { preferences: form.preferences.trim().slice(0, 200) }),
        ...(form.preferenceTags.length > 0 && { preferenceTags: form.preferenceTags }),
      });

      const calldata = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: 'createListing',
        args: [rentRaw, depositRaw, metadata],
      });

      // Editing: the contract has no update, so publish the corrected listing and retire the old one
      // in the same transaction (only possible while no tenant has paid).
      const calls = [{ to: ESCROW_ADDRESS, data: calldata, value: 0n }];
      if (editingId !== null) {
        calls.push({ to: ESCROW_ADDRESS, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'deactivateListing', args: [editingId] }), value: 0n });
      }
      await sendUserOp(account, calls);
      if (draftCode) await fetch(`/api/bot/draft/${draftCode}/published`, { method: 'POST' }).catch(() => undefined);

      await refreshChain();

      setDone(true);
      toast.success(editingId !== null ? 'Changes saved.' : 'Property listed onchain!');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const text = msg.startsWith('Could not upload') ? msg
        : txErrorText(e, editingId !== null ? 'Could not save changes. If a tenant has already paid, the listing can no longer be edited.' : 'Could not list the property.');
      if (text) toast.error(text, { duration: 10_000 });
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ address: '', location: '', rooms: '2', propertyType: 'two_bed', furnishing: 'unfurnished', description: '', rentNgn: '', depositNgn: '', amenities: [], phone: '', preferences: '', preferenceTags: [] });
    setGeoStatus('idle');
    setPin(null);
    setMedia([]);
    setDone(false);
    setPrefilled('');
    setView('home');
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center min-h-[60vh]">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
          style={{ background: 'var(--success)', boxShadow: '0 12px 40px rgba(26,128,71,0.3)' }}
        >
          <Check className="w-10 h-10 text-white" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="display text-2xl font-bold mb-2" style={{ color: 'var(--ink)' }}>{editingId !== null ? 'Changes saved' : 'Listed onchain!'}</h2>
          <p className="text-sm mb-7 max-w-xs" style={{ color: 'var(--muted)' }}>
            Your property is live. Rent goes directly into escrow — no agent, no cut.
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={resetForm}
            className="px-8 py-3.5 rounded-2xl font-semibold text-white"
            style={{ background: 'var(--accent)', boxShadow: 'none' }}
          >
            Back to Dashboard
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // ── New listing form ──────────────────────────────────────────────────────
  if (view === 'new-listing') {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-28">
        {/* Back */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setView('home')}
          className="flex items-center gap-1 text-sm mb-5 -ml-1"
          style={{ color: 'var(--muted)' }}
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
        </motion.button>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            {editingId !== null ? 'Edit property' : draftCode ? 'Review your WhatsApp listing' : 'New property'}
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            {draftCode
              ? 'We filled this in from your WhatsApp message. Add photos and check each step, then publish.'
              : editingId !== null
                ? 'Saving republishes the listing — only possible while no tenant has paid.'
                : 'Four quick steps. Tenants pay into escrow, not to an agent.'}
          </p>

          {/* Steps — tap any to jump; Continue checks the current one */}
          <nav aria-label="Listing steps" className="grid grid-cols-4 gap-1.5 mb-6">
            {STEPS.map((label, i) => {
              const hasError = showErrors && problems.some(p => FIELD_STEP[p.field] === i);
              return (
                <button key={label} type="button" onClick={() => goToStep(i)} aria-current={step === i ? 'step' : undefined} className="text-left">
                  <span className="block h-1 rounded-full mb-1.5 transition-colors"
                    style={{ background: hasError ? 'var(--danger)' : i <= step ? 'var(--accent)' : 'var(--border)' }} />
                  <span className="text-xs font-semibold" style={{ color: hasError ? 'var(--danger)' : step === i ? 'var(--ink)' : 'var(--subtle)' }}>
                    {i + 1}. {label}
                  </span>
                </button>
              );
            })}
          </nav>
          {editingId !== null && chain.data && !editTarget && (
            <p className="text-sm mb-6 px-4 py-3 rounded-xl" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
              Listing #{editingId.toString()} isn't live any more (or isn't yours). It was probably replaced when you saved an edit, or deleted.{' '}
              <button type="button" onClick={() => setView('home')} className="underline font-semibold">Go to your properties</button> and tap Edit on the current one.
            </p>
          )}
          {draftCode && draftQuery.isError && (
            <p className="text-sm mb-6 px-4 py-3 rounded-xl" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
              {(draftQuery.error).message} You can still fill in the form yourself.
            </p>
          )}

          <div className="space-y-5">

            {/* ── Step 1: Media upload ── */}
            {step === 0 && (
            <div>
              <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Photos &amp; Videos ({media.length}/10)
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>Listings with clear photos get far more inspection requests. A short video tour helps too.</p>
              <div
                className="relative rounded-3xl border-2 border-dashed transition-all"
                style={{
                  borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                  background: dragOver ? 'var(--accent-soft)' : 'var(--surface-muted)',
                  boxShadow: dragOver ? '0 0 0 4px var(--accent-glow)' : 'none',
                }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                />
                {media.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: 'var(--accent-soft)' }}>
                      <ImagePlus className="w-7 h-7" style={{ color: 'var(--accent)' }} />
                    </div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      Tap to add photos or videos
                    </p>
                    <p className="text-xs" style={{ color: 'var(--subtle)' }}>JPG · PNG · MP4 · up to 10 files</p>
                  </div>
                ) : (
                  <div className="p-3">
                    <div className="grid grid-cols-3 gap-2">
                      {media.map((m, idx) => (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.04, ...springs.snappy }}
                          className="relative aspect-square rounded-2xl overflow-hidden"
                        >
                          {m.type === 'image' ? (
                            <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"
                              style={{ background: 'var(--surface-muted)' }}>
                              <Play className="w-8 h-8" style={{ color: 'var(--accent)' }} />
                            </div>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); removeMedia(m.id); }}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.65)' }}
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        </motion.div>
                      ))}
                      {media.length < 10 && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="aspect-square rounded-2xl border-2 border-dashed flex items-center justify-center transition-colors"
                          style={{ borderColor: 'var(--border)', background: 'var(--surface-strong)' }}
                        >
                          <Upload className="w-5 h-5" style={{ color: 'var(--subtle)' }} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ── Step 2: Location & contact ── */}
            {step === 1 && (<>
            <div id="field-address" className="scroll-mt-24">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  Full Street Address <span style={{ color: 'var(--accent)' }}>*</span>
                </label>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => setShowPinDrop(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl"
                  style={pin
                    ? { background: 'var(--accent)', color: 'white' }
                    : { background: 'var(--accent-soft)', color: 'var(--accent)' }
                  }
                >
                  <MapPin className="w-3 h-3" />
                  {pin ? 'Pin set ✓' : 'Drop a Pin'}
                </motion.button>
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>
                Type your address and tap "Verify", or tap "Drop a Pin" on the map to mark the exact spot.
              </p>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--subtle)' }} />
                <input
                  value={form.address}
                  onChange={e => { setForm(f => ({ ...f, address: e.target.value })); setGeoStatus('idle'); }}
                  onBlur={() => { void checkGeo(); }}
                  placeholder="e.g. 14 Admiralty Way, Lekki Phase 1, Lagos"
                  className="w-full pl-10 pr-12 py-3.5 rounded-2xl border text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--surface-strong)',
                    borderColor: geoStatus === 'valid' ? 'var(--accent)' : geoStatus === 'invalid' ? '#ef4444' : 'var(--border)',
                    color: 'var(--ink)',
                  }}
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {geoStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--subtle)' }} />}
                  {geoStatus === 'valid' && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                  {geoStatus === 'invalid' && <AlertCircle className="w-4 h-4" style={{ color: '#ef4444' }} />}
                </div>
              </div>
              {geoStatus === 'valid' && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                  <CheckCircle2 className="w-3 h-3" /> Address found on map
                </motion.p>
              )}
              {geoStatus === 'invalid' && !pin && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs mt-1.5" style={{ color: '#ef4444' }}>
                  Address not found on OpenStreetMap — tap <strong>Drop a Pin</strong> above to mark the exact spot instead.
                </motion.p>
              )}
              {pin && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                  <CheckCircle2 className="w-3 h-3" /> Pin placed at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </motion.p>
              )}
              {errorText('address')}
            </div>

            {/* ── PinDrop modal ── */}
            {showPinDrop && (
              <ErrorBoundary inline onReset={() => setShowPinDrop(false)}>
                <PinDropMap
                  initialAddress={form.address}
                  onConfirm={result => { setPin(result); setGeoStatus('valid'); setShowPinDrop(false); }}
                  onClose={() => setShowPinDrop(false)}
                />
              </ErrorBoundary>
            )}

            {/* ── Location (neighbourhood display name) ── */}
            <div id="field-location" className="scroll-mt-24">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Neighbourhood / Area</label>
                <LangSelector compact showMic onVoiceResult={text => setForm(f => ({ ...f, location: text }))} />
              </div>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--subtle)' }} />
                <input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Lekki Phase 1"
                  className="w-full pl-10 pr-4 py-3.5 rounded-2xl border text-sm outline-none transition-colors"
                  style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
              </div>
              {errorText('location')}
            </div>

            {/* ── Contact for inspections ── */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>WhatsApp number for inspections</label>
              <input
                value={form.phone} inputMode="tel" autoComplete="tel"
                onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18) }))}
                placeholder="e.g. 0803 123 4567"
                className="w-full px-4 py-3.5 rounded-2xl border text-sm outline-none"
                style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--subtle)' }}>Shown on your listing so tenants can book an inspection. Leave empty to keep it private.</p>
            </div>
            </>)}

            {/* ── Step 3: Details ── */}
            {step === 2 && (<>
            {!(COMMERCIAL_TYPES as readonly string[]).includes(form.propertyType) && (
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Bedrooms</label>
              <div className="flex gap-2">
                {['1', '2', '3', '4', '5+'].map(n => (
                  <motion.button
                    key={n}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setForm(f => ({ ...f, rooms: n }))}
                    className="flex-1 py-3 rounded-2xl text-sm font-semibold border transition-all"
                    style={
                      form.rooms === n
                        ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', boxShadow: 'none' }
                        : { background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }
                    }
                  >
                    {n}
                  </motion.button>
                ))}
              </div>
            </div>
            )}

            {/* ── Property Type ── */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {t('property_type_label')}
              </label>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--muted)' }}>🏠 {t('residential')}</p>
                  <div className="flex flex-wrap gap-2">
                    {(RESIDENTIAL_TYPES as readonly PropertyType[]).map(pt => (
                      <motion.button key={pt} whileTap={{ scale: 0.93 }}
                        onClick={() => setForm(f => ({ ...f, propertyType: pt }))}
                        className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all"
                        style={form.propertyType === pt
                          ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                          : { background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                        {t(pt as TranslationKey)}
                      </motion.button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#0e7490' }}>🏪 {t('commercial')}</p>
                  <div className="flex flex-wrap gap-2">
                    {(COMMERCIAL_TYPES as readonly PropertyType[]).map(pt => (
                      <motion.button key={pt} whileTap={{ scale: 0.93 }}
                        onClick={() => setForm(f => ({ ...f, propertyType: pt }))}
                        className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all"
                        style={form.propertyType === pt
                          ? { background: '#0e7490', color: 'white', borderColor: '#0e7490' }
                          : { background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                        {t(pt as TranslationKey)}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Furnishing (residential only) ── */}
            {!(COMMERCIAL_TYPES as readonly string[]).includes(form.propertyType) && (
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {t('furnishing_label')}
              </label>
              <div className="flex gap-2">
                {(['unfurnished', 'semi_furnished', 'furnished'] as const).map(fn => (
                  <motion.button key={fn} whileTap={{ scale: 0.93 }}
                    onClick={() => setForm(frm => ({ ...frm, furnishing: fn }))}
                    className="flex-1 py-2.5 rounded-2xl text-xs font-semibold border transition-all"
                    style={form.furnishing === fn
                      ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', boxShadow: 'none' }
                      : { background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                    {t(fn as TranslationKey)}
                  </motion.button>
                ))}
              </div>
            </div>
            )}

            {/* ── Description ── */}
            <div id="field-description" className="scroll-mt-24">
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe the property — security, power, finishing…"
                rows={3}
                className="w-full px-4 py-3 rounded-2xl border text-sm outline-none resize-none transition-colors"
                style={{ background: 'var(--surface-strong)', borderColor: fieldError('description') ? 'var(--danger)' : 'var(--border)', color: 'var(--ink)' }}
              />
              {errorText('description')}
            </div>

            {/* ── Amenities ── */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Amenities</label>
              <div className="flex flex-wrap gap-2">
                {AMENITIES.map(a => {
                  const active = form.amenities.includes(a);
                  return (
                    <motion.button
                      key={a}
                      whileTap={{ scale: 0.93 }}
                      onClick={() => toggleAmenity(a)}
                      className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all"
                      style={
                        active
                          ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', boxShadow: 'none' }
                          : { background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }
                      }
                    >
                      {a}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* ── Tenant Preferences / Exemptions (optional) ── */}
            <div className="rounded-3xl p-5 space-y-4" style={{ background: 'var(--glass-card)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{t('preferences_label')}</h3>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('preferences_hint')}</p>

              {/* Quick-pick tags */}
              <div className="flex flex-wrap gap-2">
                {(['no_couples', 'no_children', 'no_pets', 'no_students', 'no_smoking',
                   'professionals_only', 'females_only', 'males_only'] as const).map(tag => {
                  const active = form.preferenceTags.includes(tag);
                  return (
                    <motion.button key={tag} whileTap={{ scale: 0.93 }}
                      onClick={() => setForm(f => ({
                        ...f,
                        preferenceTags: active ? f.preferenceTags.filter(x => x !== tag) : [...f.preferenceTags, tag],
                      }))}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                      style={active
                        ? { background: 'rgba(242,180,90,0.25)', color: 'var(--warning)', borderColor: 'rgba(242,180,90,0.5)' }
                        : { background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                      {t(tag)}
                    </motion.button>
                  );
                })}
              </div>

              {/* Free-text exemption note */}
              <textarea
                value={form.preferences}
                onChange={e => setForm(f => ({ ...f, preferences: e.target.value.slice(0, 200) }))}
                placeholder={t('preferences_placeholder')}
                maxLength={200}
                rows={2}
                className="w-full px-4 py-3 rounded-2xl border text-sm outline-none resize-none"
                style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
              <p className="text-[11px] text-right mt-1" style={{ color: form.preferences.length > 180 ? 'var(--warning)' : 'var(--subtle)' }}>
                {form.preferences.length}/200
              </p>
            </div>
            </>)}

            {/* ── Step 4: Price & review ── */}
            {step === 3 && (<>
            <div
              className="rounded-3xl p-5 space-y-4"
              style={{ background: 'var(--glass-card)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Pricing</h3>
              </div>

              <div id="field-rent" className="scroll-mt-24">
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Annual Rent (₦)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={withCommas(form.rentNgn)}
                  onChange={e => setForm(f => ({ ...f, rentNgn: digitsOnly(e.target.value) }))}
                  placeholder="e.g. 480,000"
                  className="w-full px-4 py-3.5 rounded-2xl border text-lg font-bold outline-none tabular-nums"
                  style={{ background: 'var(--surface-muted)', borderColor: fieldError('rent') ? 'var(--danger)' : 'var(--border)', color: 'var(--ink)' }}
                />
                {errorText('rent')}
                {parseFloat(form.rentNgn) > 0 && (
                  <p className="text-xs mt-1.5 tabular-nums" style={{ color: 'var(--muted)' }}>
                    ≈ {rentUsdc.toFixed(2)} USDC stored onchain
                  </p>
                )}
              </div>

              <div id="field-deposit" className="scroll-mt-24">
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Caution fee (₦, refundable)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={withCommas(form.depositNgn)}
                  onChange={e => setForm(f => ({ ...f, depositNgn: digitsOnly(e.target.value) }))}
                  placeholder="e.g. 480,000"
                  className="w-full px-4 py-3.5 rounded-2xl border text-lg font-bold outline-none tabular-nums"
                  style={{ background: 'var(--surface-muted)', borderColor: fieldError('deposit') ? 'var(--danger)' : 'var(--border)', color: 'var(--ink)' }}
                />
                {errorText('deposit')}
              </div>

              {parseFloat(form.rentNgn) > 0 && parseFloat(form.depositNgn) > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between text-sm pt-3 border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span style={{ color: 'var(--muted)' }}>Total tenant pays</span>
                  <span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {formatNaira((parseFloat(form.rentNgn) + parseFloat(form.depositNgn)) / 1600)}
                  </span>
                </motion.div>
              )}
            </div>

            {/* ── Review: everything from earlier steps, each row jumps back to its step ── */}
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {[
                { s: 0, label: 'Photos', value: media.length ? `${media.length} added` : 'None yet' },
                { s: 1, label: 'Address', value: form.address.trim() ? `${form.address.trim()}${locationConfirmed ? '' : ' (not on map yet)'}` : 'Missing' },
                { s: 2, label: 'Home', value: `${form.rooms} bed · ${t(form.propertyType as TranslationKey)} · ${t(form.furnishing as TranslationKey)}` },
              ].map(r => (
                <button key={r.label} type="button" onClick={() => goToStep(r.s)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <span className="w-16 shrink-0 text-xs" style={{ color: 'var(--muted)' }}>{r.label}</span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{r.value}</span>
                  <Pencil className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--subtle)' }} />
                </button>
              ))}
            </div>

            <div className="flex gap-3 p-4 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
              <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--accent)' }}>
                Rent is held by a smart contract, not an agent, and released to you after the tenant confirms move-in. <strong>Zero agent fee.</strong>
              </p>
            </div>
            </>)}
          </div>
        </motion.div>

        {/* ── Sticky step controls ── */}
        <div className="fixed bottom-0 inset-x-0 z-30 border-t pb-safe" style={{ background: 'var(--popover)', borderColor: 'var(--border)' }}>
          <div className="max-w-2xl mx-auto px-4 py-3 flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => goToStep(step - 1)} disabled={loading}
                className="h-12 px-5 rounded-2xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={nextStep}
                className="flex-1 h-12 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-1.5" style={{ background: 'var(--accent)' }}>
                Continue to {STEPS[step + 1].toLowerCase()} <ChevronRight className="w-4 h-4" />
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => { void handleSubmit(); }} disabled={loading}
                className="flex-1 h-12 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-70" style={{ background: 'var(--accent)' }}>
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Listing onchain…</>
                  : <><Home className="w-4 h-4" /> {editingId !== null ? 'Save changes' : 'Publish listing'}</>}
              </motion.button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Home dashboard ─────────────────────────────────────────────────────────
  const rentedCount = listings.filter(l => l.status === 'rented').length;
  const attention = listings.filter(l => l.escrow && needsLandlord(l.escrow, now));
  const annualRent = listings.filter(l => l.status === 'rented').reduce((s, l) => s + l.rentNgn, 0);

  async function deleteListing(id: bigint) {
    if (!window.confirm('Remove this listing? Tenants will no longer see it. You can list the property again any time.')) return;
    setDeleting(String(id));
    try {
      await sendUserOp(account, [{ to: ESCROW_ADDRESS, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'deactivateListing', args: [id] }) }]);
      await refreshChain();
      toast.success('Listing removed.');
    } catch (e: unknown) {
      const text = txErrorText(e, 'Could not remove the listing. If a tenant has already paid, it can\'t be removed.');
      if (text) toast.error(text, { duration: 10_000 });
    } finally {
      setDeleting(null);
    }
  }

  async function withdraw() {
    setWithdrawing(true);
    try {
      await sendEscrowTx(account, { functionName: 'withdraw' });
      await refreshChain();
      toast.success('Rent withdrawn to your wallet.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('NotAllowedError') ? 'Passkey cancelled.' : 'Withdrawal failed. Please try again.');
    } finally {
      setWithdrawing(false);
    }
  }

  const tile = { background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' };

  return (
    <div className="max-w-6xl mx-auto px-4 pt-6 pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>{u('your_properties')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{u('landlord_sub')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDashTab('whatsapp')}
            className="flex items-center gap-1.5 px-4 h-11 rounded-xl text-sm font-medium"
            style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
            <MessageCircle className="w-4 h-4" /> {u('list_on_whatsapp')}
          </button>
          <button onClick={() => setView('new-listing')}
            className="flex items-center gap-1.5 px-4 h-11 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--accent)' }}>
            <PlusCircle className="w-4 h-4" /> {u('list_a_property')}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: u('listed'), value: String(listings.length) },
          { label: u('rented'), value: String(rentedCount) },
          { label: u('rent_per_year'), value: formatNaira(annualRent / USDC_TO_NGN) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-2xl p-4" style={tile}>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
            <p className="text-xl font-bold tabular-nums mt-1" style={{ color: 'var(--ink)' }}>{value}</p>
          </div>
        ))}
        <div className="rounded-2xl p-4 flex flex-col" style={tile}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{u('ready_withdraw')}</p>
          <div className="flex items-center justify-between gap-2 mt-1">
            <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{formatNaira(withdrawable)}</p>
            {withdrawable > 0 && (
              <button onClick={() => { void withdraw(); }} disabled={withdrawing}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
                {withdrawing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : u('withdraw')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inspection requests from tenants */}
      <InspectionRequests account={account} />
      <LandlordCashPayments account={account} />

      {/* Needs your attention */}
      {attention.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            {u('needs_attention')}
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent)', color: 'white' }}>{attention.length}</span>
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {attention.map(l => (
              <div key={l.id} className="rounded-2xl overflow-hidden" style={tile}>
                <div className="flex items-center gap-3 px-4 pt-4">
                  <Thumb cover={l.cover} className="w-12 h-12 rounded-lg" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{l.location}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{l.rooms} bed · {formatNaira(l.rentNgn / USDC_TO_NGN)}/yr</p>
                  </div>
                </div>
                <LandlordEscrowPanel escrow={l.escrow!} account={account} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Account */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button onClick={() => setShowVerification(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium"
          style={isVerified
            ? { background: 'var(--accent-soft)', color: 'var(--success)', border: '1px solid var(--border)' }
            : { background: 'rgba(242,180,90,0.10)', color: 'var(--warning)', border: '1px solid rgba(242,180,90,0.35)' }}>
          {isVerified ? <BadgeCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          {isVerified ? u('identity_verified') : u('verify_cta')}
        </button>
        {[
          { label: t('maintenance'), icon: Wrench, onClick: () => setShowMaintenance(true) },
          { label: t('reviews'), icon: Star, onClick: () => setShowReviews(true) },
          { label: t('boost_listing'), icon: TrendingUp, onClick: () => { if (listings.length > 0) setShowBoost(listings[0].id); } },
        ].map(({ label, icon: Icon, onClick }) => (
          <button key={label} onClick={onClick}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm"
            style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
            <Icon className="w-4 h-4" style={{ color: 'var(--muted)' }} /> {label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-5" style={{ borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'listings' as DashTab, label: u('tab_properties') },
          { id: 'rented' as DashTab, label: `${u('tab_rented')}${rentedCount > 0 ? ` (${rentedCount})` : ''}` },
          { id: 'whatsapp' as DashTab, label: u('tab_whatsapp') },
          { id: 'stats' as DashTab, label: u('tab_insights') },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setDashTab(tab.id)}
            className="pb-3 -mb-px text-sm font-medium transition-colors"
            style={dashTab === tab.id
              ? { color: 'var(--ink)', borderBottom: '2px solid var(--ink)' }
              : { color: 'var(--muted)', borderBottom: '2px solid transparent' }}>
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {dashTab === 'listings' && (
          <motion.div key="listings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {chain.isLoading || (chain.isError && !chain.data) ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
            ) : listings.length === 0 ? (
              <div className="rounded-2xl p-10 flex flex-col items-center text-center" style={{ border: '1px dashed var(--border-strong)' }}>
                <Building2 className="w-8 h-8 mb-3" style={{ color: 'var(--subtle)' }} />
                <p className="font-semibold" style={{ color: 'var(--ink)' }}>{u('no_properties')}</p>
                <p className="text-sm mt-1 mb-5 max-w-sm" style={{ color: 'var(--muted)' }}>
                  List your first property in a few minutes — or send the details to our WhatsApp bot.
                </p>
                <button onClick={() => setView('new-listing')} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  List a property
                </button>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map(l => {
                  const status = listingStatus(l.escrow);
                  return (
                    <article key={l.id} className="rounded-2xl overflow-hidden flex flex-col" style={tile}>
                      <div className="relative aspect-[4/3]" style={{ background: 'var(--surface-muted)' }}>
                        <Thumb cover={l.cover} className="absolute inset-0 w-full h-full" />
                        <span className="absolute top-3 left-3 text-[11px] font-semibold px-2 py-1 rounded-full text-white"
                          style={{ background: status.tone === 'good' ? '#17803f' : status.tone === 'warn' ? '#a35a00' : 'rgba(0,0,0,0.65)' }}>
                          {status.label}
                        </span>
                        {(l.photoCount > 1 || l.hasVideo) && (
                          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-black/60 text-white">
                            <ImagePlus className="w-3 h-3" /> {l.photoCount}{l.hasVideo ? ' · video' : ''}
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--ink)' }}>{l.location}</p>
                        <p className="text-sm mt-0.5 tabular-nums" style={{ color: 'var(--muted)' }}>
                          {l.rooms} bed · <span style={{ color: 'var(--ink)' }} className="font-semibold">{formatNaira(l.rentNgn / USDC_TO_NGN)}</span>/yr
                        </p>
                        {!l.escrow && <ListingSocialProof stats={statsFor(l.id)} variant="compact" />}
                      </div>
                      <OwnershipRow account={account} listingId={l.id} address={l.address} mine={ownership} />
                      {!l.escrow && (
                        <div className="mt-auto px-4 pb-4 flex gap-2">
                          <button onClick={() => navigate(`/landlord/edit/${l.id}`)}
                            className="flex-1 h-10 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                            <Pencil className="w-4 h-4" /> {u('edit')}
                          </button>
                          <button onClick={() => { void deleteListing(BigInt(l.id)); }} disabled={deleting === l.id}
                            className="h-10 px-4 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
                            style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}>
                            {deleting === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {u('delete')}
                          </button>
                        </div>
                      )}
                      {l.escrow && (
                        <div className="mt-auto">
                          <LandlordEscrowPanel escrow={l.escrow} account={account} compact={needsLandlord(l.escrow, now)} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {dashTab === 'rented' && (
          <motion.div key="rented" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {chain.isLoading || (chain.isError && !chain.data)
              ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
              : <RentedOut account={account} listings={listings} now={now} />}
          </motion.div>
        )}

        {dashTab === 'whatsapp' && (
          <motion.div key="whatsapp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-2xl">
            <WhatsAppInbox account={account} />
          </motion.div>
        )}

        {dashTab === 'stats' && (
          <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-5 max-w-2xl" style={tile}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--ink)' }}>Insights</h3>
            {listings.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--muted)' }}>Stats appear once you list a property.</p>
            ) : (
              [
                { label: 'Properties listed', value: String(listings.length) },
                { label: 'Waiting for a tenant', value: String(listings.length - rentedCount) },
                { label: 'With a tenant', value: String(rentedCount) },
                { label: 'Rent from current tenants / yr', value: formatNaira(annualRent / USDC_TO_NGN) },
                { label: 'Ready to withdraw', value: formatNaira(withdrawable) },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between py-2.5 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--muted)' }}>{row.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{row.value}</span>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feature modals */}
      <AnimatePresence>
        {showVerification && <LandlordVerification key="verif" account={account} diditSessionId={diditReturn || undefined} onClose={() => setShowVerification(false)} />}
        {showBoost && (
          <ListingBoost key="boost"
            listingId={showBoost}
            listingTitle={listings.find(l => l.id === showBoost)?.location ?? 'Your property'}
            account={account}
            onClose={() => setShowBoost(null)} />
        )}
        {showMaintenance && <MaintenanceTracker key="maint" role="landlord" account={account}
          labels={Object.fromEntries(listings.filter(l => l.escrow).map(l => [String(l.escrow!.id), l.location]))}
          onClose={() => setShowMaintenance(false)} />}
        {showReviews && <TenantReviews key="reviews" mode="view" landlord={account.address} title="What your tenants say" onClose={() => setShowReviews(false)} />}
      </AnimatePresence>
    </div>
  );
}

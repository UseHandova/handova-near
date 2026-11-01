/**
 * BrowseListings — tenant home: search, filters and a responsive grid of photo-first listings.
 * Live listings come from the escrow contract; sample listings only show until the first real one exists.
 * Every listing states whether its landlord is identity-verified (onchain).
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, SlidersHorizontal, X, Bell, Gift, Loader2, Heart } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { LAGOS_AREAS, PROPERTY_TYPES, RESIDENTIAL_TYPES, COMMERCIAL_TYPES, type PropertyType } from '@/lib/i18n';
import { useLang } from '@/lib/LangContext';
import { nairaToUsdc } from '@/lib/naira';
import { useChainState, useHiddenListings, type ChainListing } from '@/lib/chain';
import { useBoosts } from '@/components/ListingBoost';
import PropertyMap from '@/components/PropertyMap';
import ErrorBoundary from '@/components/ErrorBoundary';
import { toast } from 'sonner';
import InspectionFlow from '@/components/InspectionFlow';
import { formatSlot, inspectionFor, useInspections } from '@/lib/inspections';
import { openChat } from '@/lib/chat';
import { useOwnershipVerified } from '@/lib/ownership';
import { useRentedForCash } from '@/lib/cash';
import ShareListing from '@/components/ShareListing';
import SavedSearches from '@/components/SavedSearches';
import TenantReviews from '@/components/TenantReviews';
import PropertyReviews from '@/components/PropertyReviews';
import { recordView, useListingStats, useSavedListings } from '@/lib/listing-stats';
import ReferralSystem from '@/components/ReferralSystem';
import ListingCard from '@/components/ListingCard';
import ListingDetail from '@/components/ListingDetail';
import { useUi } from '@/lib/i18n-ui';

type Furnishing = 'furnished' | 'unfurnished' | 'semi_furnished';

export interface Listing {
  id: bigint;
  title: string;
  address: string;
  lat: number;
  lng: number;
  location: string;
  area: string;
  rooms: number;
  propertyType: PropertyType;
  furnishing: Furnishing;
  rentUsdc: number;
  depositUsdc: number;
  active: boolean;
  desc: string;
  amenities: string[];
  /** Neutral accent used by share cards and the payment flow header. */
  color: string;
  media: { type: 'image' | 'video'; url: string }[];
  /** Unix ms when the landlord was identity-verified onchain (0 = not verified). */
  verifiedAt: number;
  landlord?: string;
  landlordPhone?: string;
  /** Placeholder shown before anything is listed onchain — cannot be rented. */
  sample?: boolean;
  /** Unix ms when Handova approved the landlord's ownership documents for this address (0 = not checked). */
  ownershipCheckedAt?: number;
  /** Landlord's optional tenant preferences / exemptions e.g. "No couples, no pets". */
  preferences?: string;
  /** Quick-pick preference tags chosen by landlord. */
  preferenceTags?: string[];
}

const NEUTRAL = 'linear-gradient(135deg, #2a332e 0%, #46524b 100%)';
const LAGOS_CENTER = { lat: 6.5244, lng: 3.3792 };
const QUICK_AREAS = ['Lekki Phase 1', 'Yaba', 'Victoria Island (VI)', 'Ikeja', 'Surulere', 'Ajah', 'Ikoyi', 'Ikorodu', 'Gbagada', 'Magodo'];

function fromChain(l: ChainListing): Listing {
  const m = l.meta;
  const propertyType = (PROPERTY_TYPES as readonly string[]).includes(m.propertyType ?? '')
    ? (m.propertyType as PropertyType)
    : 'two_bed';
  const location = m.location || 'Lagos';
  const rooms = m.rooms ?? 1;
  const isCommercial = (COMMERCIAL_TYPES as readonly string[]).includes(propertyType);
  const title = isCommercial
    ? `${propertyType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} in ${location}`
    : `${rooms}-bedroom in ${location}`;
  return {
    id: l.id,
    title,
    address: m.address || location,
    lat: m.lat ?? LAGOS_CENTER.lat,
    lng: m.lng ?? LAGOS_CENTER.lng,
    location,
    area: LAGOS_AREAS.find(a => location.toLowerCase().includes(a.toLowerCase())) ?? location,
    rooms,
    propertyType,
    furnishing: m.furnishing ?? 'unfurnished',
    rentUsdc: l.rentUsdc,
    depositUsdc: l.depositUsdc,
    active: l.active,
    desc: m.description ?? '',
    amenities: m.amenities ?? [],
    color: NEUTRAL,
    media: (m.media ?? []).filter(x => typeof x?.url === 'string' && (x.type === 'image' || x.type === 'video')),
    verifiedAt: l.landlordVerifiedAt,
    landlord: l.landlord,
    landlordPhone: m.phone,
    preferences: m.preferences,
    preferenceTags: m.preferenceTags,
  };
}

const px = (id: number) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
const photos = (...ids: number[]) => ids.map(id => ({ type: 'image' as const, url: px(id) }));

/** Illustrative listings (Pexels photos, realistic 2026 Lagos rents). Never rentable, never "verified". */
const SAMPLE_LISTINGS: Listing[] = ([
  { id: 1n, title: 'Bright 2-bedroom flat', address: 'Admiralty Way, Lekki Phase 1', location: 'Lekki Phase 1', area: 'Lekki Phase 1',
    rooms: 2, propertyType: 'two_bed', furnishing: 'semi_furnished', rentUsdc: nairaToUsdc(4_500_000), depositUsdc: nairaToUsdc(450_000),
    desc: 'Serviced 2-bedroom flat in a gated estate. 24-hour security, generator, parking for two cars.', amenities: ['Generator', 'Security', 'Parking'],
    media: photos(2462015, 6527029, 271624) },
  { id: 2n, title: 'Self-contain near UNILAG', address: 'Herbert Macaulay Way, Yaba', location: 'Yaba', area: 'Yaba',
    rooms: 1, propertyType: 'self_contain', furnishing: 'unfurnished', rentUsdc: nairaToUsdc(900_000), depositUsdc: nairaToUsdc(90_000),
    desc: 'Quiet street, tiled floors, constant borehole water. Five minutes to UNILAG and the Yaba tech hub.', amenities: ['Borehole', 'Prepaid meter'],
    media: photos(2079249, 6180674) },
  { id: 3n, title: '4-bedroom duplex with BQ', address: 'Ozumba Mbadiwe Avenue, Victoria Island', location: 'Victoria Island', area: 'Victoria Island (VI)',
    rooms: 4, propertyType: 'duplex', furnishing: 'furnished', rentUsdc: nairaToUsdc(15_000_000), depositUsdc: nairaToUsdc(1_500_000),
    desc: 'Fully furnished duplex with boys\' quarters, ensuite rooms and a fitted kitchen.', amenities: ['Generator', 'Security', 'Parking', 'BQ'],
    media: photos(323780, 1571460, 3935350) },
  { id: 4n, title: 'Clean room and parlour', address: 'Adeniran Ogunsanya Street, Surulere', location: 'Surulere', area: 'Surulere',
    rooms: 1, propertyType: 'single_room', furnishing: 'unfurnished', rentUsdc: nairaToUsdc(350_000), depositUsdc: nairaToUsdc(35_000),
    desc: 'Well-kept compound with shared facilities. Close to the National Stadium and bus stops.', amenities: ['Borehole'],
    media: photos(6934189) },
  { id: 5n, title: '3-bedroom bungalow, GRA', address: 'Obafemi Awolowo Way, Ikeja GRA', location: 'Ikeja GRA', area: 'Ikeja GRA',
    rooms: 3, propertyType: 'bungalow', furnishing: 'semi_furnished', rentUsdc: nairaToUsdc(8_000_000), depositUsdc: nairaToUsdc(800_000),
    desc: 'Detached bungalow in a secure estate with a large compound and staff quarters.', amenities: ['Generator', 'Security', 'Parking', 'Borehole'],
    media: photos(1918291, 1643383) },
  { id: 6n, title: 'Mini flat by the market', address: 'Garage Road, Ikorodu', location: 'Ikorodu', area: 'Ikorodu',
    rooms: 1, propertyType: 'mini_flat', furnishing: 'unfurnished', rentUsdc: nairaToUsdc(450_000), depositUsdc: nairaToUsdc(45_000),
    desc: 'New mini flat close to the market and bus park. Good for working professionals.', amenities: ['Borehole'],
    media: photos(5997967) },
  { id: 7n, title: 'New 2-bedroom, Abraham Adesanya', address: 'Abraham Adesanya Estate, Ajah', location: 'Ajah', area: 'Ajah',
    rooms: 2, propertyType: 'two_bed', furnishing: 'unfurnished', rentUsdc: nairaToUsdc(2_500_000), depositUsdc: nairaToUsdc(250_000),
    desc: 'Newly built, POP ceiling, tiled throughout, prepaid meter.', amenities: ['Generator', 'Borehole', 'Security'],
    media: photos(4857757, 6312353) },
  { id: 8n, title: 'Penthouse with lagoon view', address: 'Bourdillon Road, Ikoyi', location: 'Ikoyi', area: 'Ikoyi',
    rooms: 4, propertyType: 'penthouse', furnishing: 'furnished', rentUsdc: nairaToUsdc(35_000_000), depositUsdc: nairaToUsdc(3_500_000),
    desc: 'Four ensuite bedrooms, rooftop terrace, gym and pool in the building.', amenities: ['Generator', 'Security', 'Parking', 'Gym', 'Pool'],
    media: photos(1457842, 1571460, 3935350) },
] as const).map(l => ({
  ...l, amenities: [...l.amenities], media: [...l.media],
  lat: LAGOS_CENTER.lat, lng: LAGOS_CENTER.lng, active: true, color: NEUTRAL, verifiedAt: 0, sample: true,
}));

interface Props { account: SmartAccount; }

export default function BrowseListings({ account }: Props) {
  const { t } = useLang();
  const u = useUi();
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all_areas');
  const [propertyType, setPropertyType] = useState<PropertyType | 'all'>('all');
  const [furnishing, setFurnishing] = useState<Furnishing | 'all'>('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [listingCategory, setListingCategory] = useState<'all' | 'residential' | 'commercial'>('all');
  const [priceMode, setPriceMode] = useState<'monthly' | 'yearly'>('yearly');
  const [showFilters, setShowFilters] = useState(false);
  const { saved: savedIds, toggle: toggleSaved } = useSavedListings(account);
  const statsFor = useListingStats();
  const [savedOnly, setSavedOnly] = useState(false);
  const [landlordReviews, setLandlordReviews] = useState<Listing | null>(null);
  const [detail, setDetail] = useState<Listing | null>(null);
  const [mapListing, setMapListing] = useState<Listing | null>(null);
  const [flowListing, setFlowListing] = useState<Listing | null>(null);
  const [shareListing, setShareListing] = useState<Listing | null>(null);
  const [reviewListing, setReviewListing] = useState<Listing | null>(null);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const chain = useChainState();
  const hidden = useHiddenListings().data;
  const boostsData = useBoosts().data;
  const boosted = useMemo(() => new Set((boostsData?.boosts ?? []).map(b => b.listingId)), [boostsData]);
  const ownershipAt = useOwnershipVerified();
  const rentedForCash = useRentedForCash();
  const visits = useInspections(account).inspections;
  const visitLabel = (l: Listing) => {
    const v = inspectionFor(visits, l.id);
    if (!v) return undefined;
    if (v.canPay) return 'Review & pay';
    if (v.status === 'requested') return `Visit requested · ${formatSlot(v.slotAt)}`;
    if (v.status === 'rescheduled') return 'Landlord suggested a new time';
    if (v.status === 'approved') return `Your visit · ${formatSlot(v.slotAt)}`;
    return undefined;
  };

  // Live listings that aren't rented yet; samples only until the first real listing exists.
  const listings = useMemo(() => {
    const live = (chain.data?.listings ?? [])
      .filter(l => l.active && l.escrowId === 0n && !hidden?.has(String(l.id)) && !rentedForCash.has(String(l.id)))
      .map(l => ({ ...fromChain(l), ownershipCheckedAt: ownershipAt(l.landlord, l.meta.address) })).reverse()
      // Boosted (paid, verified) listings first; otherwise newest first.
      .sort((a, b) => Number(boosted.has(String(b.id))) - Number(boosted.has(String(a.id))));
    return live.length > 0 || !chain.isSuccess ? live : SAMPLE_LISTINGS;
  }, [chain.data, chain.isSuccess, hidden, boosted, ownershipAt, rentedForCash]);

  // ?visit=<listingId> (from WhatsApp updates and My Leases) opens that home's inspection straight away.
  const visitParam = new URLSearchParams(window.location.search).get('visit');
  useEffect(() => {
    if (!visitParam || !chain.isSuccess) return;
    const l = listings.find(x => String(x.id) === visitParam);
    const url = new URL(window.location.href);
    url.searchParams.delete('visit');
    window.history.replaceState(null, '', url.pathname + url.search);
    // Opening a modal from a link is syncing with the URL (an external system).
    // oxlint-disable-next-line react/set-state-in-effect
    if (l) setFlowListing(l);
    else toast.error('That home is no longer listed — it may have been rented or removed.');
  }, [visitParam, chain.isSuccess, listings]);
  const showingSamples = listings[0]?.sample ?? false;

  const commercialSet = new Set(COMMERCIAL_TYPES as readonly string[]);
  const filtered = listings.filter(l => {
    const q = query.trim().toLowerCase();
    const matchArea = area === 'all_areas' || l.area === area || l.location.toLowerCase().includes(area.toLowerCase());
    const matchType = propertyType === 'all' || l.propertyType === propertyType;
    const matchFurnish = furnishing === 'all' || l.furnishing === furnishing;
    const matchVerified = !verifiedOnly || l.verifiedAt > 0;
    const matchQ = !q || [l.address, l.location, l.title, l.desc].some(s => s.toLowerCase().includes(q));
    const matchSaved = !savedOnly || savedIds.has(String(l.id));
    const isCommercial = commercialSet.has(l.propertyType);
    const matchCategory = listingCategory === 'all' || (listingCategory === 'commercial' ? isCommercial : !isCommercial);
    return matchArea && matchType && matchFurnish && matchVerified && matchQ && matchSaved && matchCategory;
  });

  const activeFilters = [propertyType !== 'all', furnishing !== 'all', verifiedOnly, listingCategory !== 'all'].filter(Boolean).length;

  const isSaved = (l: Listing) => savedIds.has(String(l.id));
  function toggleSave(l: Listing) {
    if (l.sample) { toast.info('This is a sample home. Save real listings once landlords post them.'); return; }
    void toggleSaved(l.id);
  }
  function openDetail(l: Listing) {
    setDetail(l);
    if (!l.sample) recordView(l.id);
  }

  function clearFilters() {
    setArea('all_areas'); setPropertyType('all'); setFurnishing('all'); setVerifiedOnly(false); setQuery(''); setSavedOnly(false); setListingCategory('all');
  }

  const chip = (active: boolean) => active
    ? { background: 'var(--ink)', color: 'var(--bg)', border: '1px solid var(--ink)' }
    : { background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' };

  const priceToggle = (className: string) => (
    <div className={`rounded-xl overflow-hidden shrink-0 ${className}`} style={{ border: '1px solid var(--border)' }}>
      {(['yearly', 'monthly'] as const).map(m => (
        <button key={m} onClick={() => setPriceMode(m)} className="flex-1 px-3.5 h-11 text-sm font-medium whitespace-nowrap"
          style={priceMode === m ? { background: 'var(--ink)', color: 'var(--bg)' } : { background: 'var(--surface)', color: 'var(--muted)' }}>
          {m === 'yearly' ? u('per_year_btn') : u('per_month_btn')}
        </button>
      ))}
    </div>
  );

  return (
    <div className="pb-28">
      {/* ── Search + filters (solid, sticky) ── */}
      <div className="sticky top-[57px] z-30 frosted-bar" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 space-y-3">
          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 px-3.5 h-11 rounded-xl"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--subtle)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search_placeholder')}
                className="flex-1 min-w-0 text-sm bg-transparent outline-none" style={{ color: 'var(--ink)' }} />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X className="w-4 h-4" style={{ color: 'var(--subtle)' }} /></button>}
            </label>
            <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
              className="flex items-center gap-2 px-3.5 h-11 rounded-xl text-sm font-medium shrink-0"
              style={chip(showFilters)}>
              <SlidersHorizontal className="w-4 h-4" /> <span className="hidden sm:inline">{u('filters')}</span>
              {activeFilters > 0 && (
                <span className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--accent)', color: 'white' }}>{activeFilters}</span>
              )}
            </button>
            {priceToggle('hidden sm:flex')}
          </div>

          {/* Quick areas */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {['all_areas', ...QUICK_AREAS].map(a => (
              <button key={a} onClick={() => setArea(a)} className="shrink-0 px-3.5 py-1.5 rounded-full text-sm" style={chip(area === a)}>
                {a === 'all_areas' ? t('all_areas') : a}
              </button>
            ))}
          </div>

          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr] pt-1 pb-2">
                  <div>
                    {/* Residential / Commercial tabs */}
                    <div className="flex gap-1.5 mb-3 p-1 rounded-xl w-fit" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      {(['all', 'residential', 'commercial'] as const).map(cat => (
                        <button key={cat} onClick={() => { setListingCategory(cat); setPropertyType('all'); }}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                          style={listingCategory === cat
                            ? { background: cat === 'commercial' ? '#0e7490' : 'var(--accent)', color: 'white' }
                            : { color: 'var(--muted)' }}>
                          {cat === 'all' ? t('all_types') : cat === 'commercial' ? `🏪 ${t('commercial')}` : `🏠 ${t('residential')}`}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)' }}>{t('property_type_label')}</p>
                    <div className="flex flex-wrap gap-2">
                      {(['all', ...(listingCategory === 'commercial' ? COMMERCIAL_TYPES : listingCategory === 'residential' ? RESIDENTIAL_TYPES : PROPERTY_TYPES)] as const).map(pt => (
                        <button key={pt} onClick={() => setPropertyType(pt)} className="px-3 py-1.5 rounded-full text-sm" style={chip(propertyType === pt)}>
                          {pt === 'all' ? t('all_types') : t(pt as Parameters<typeof t>[0])}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)' }}>{t('furnishing_label')}</p>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'furnished', 'semi_furnished', 'unfurnished'] as const).map(f => (
                          <button key={f} onClick={() => setFurnishing(f)} className="px-3 py-1.5 rounded-full text-sm" style={chip(furnishing === f)}>
                            {f === 'all' ? t('all_types') : t(f)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: 'var(--ink-2)' }}>
                      <input type="checkbox" checked={verifiedOnly} onChange={e => setVerifiedOnly(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
                      {u('verified_only')}
                    </label>
                    {priceToggle('flex sm:hidden')}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4">
        {/* ── Heading ── */}
        <div className="flex flex-wrap items-end justify-between gap-3 pt-6 pb-5">
          <div>
            <h1 className="text-2xl sm:text-[28px] font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              {u('browse_title')}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {chain.isLoading ? u('loading_listings') : `${filtered.length} ${showingSamples ? `${u('sample')} ` : ''}${filtered.length === 1 ? u('home') : u('homes')}`}
              {' · '}{u('browse_sub')}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSavedOnly(v => !v)} aria-pressed={savedOnly} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm"
              style={savedOnly
                ? { background: 'var(--ink)', color: 'var(--bg)', border: '1px solid var(--ink)' }
                : { background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              <Heart className="w-4 h-4" style={savedOnly ? undefined : { color: '#e0475b' }} /> Saved{savedIds.size > 0 ? ` (${savedIds.size})` : ''}
            </button>
            <button onClick={() => setShowSavedSearches(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              <Bell className="w-4 h-4" /> {t('saved_searches')}
            </button>
            <button onClick={() => setShowReferral(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              <Gift className="w-4 h-4" /> {t('refer_friend')}
            </button>
          </div>
        </div>

        {showingSamples && (
          <p className="text-sm mb-5 px-4 py-3 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
            {u('samples_notice')}
          </p>
        )}

        {/* ── Grid ── */}
        {chain.isLoading || (chain.isError && !chain.data) ? (
          <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>{savedOnly && savedIds.size === 0 ? 'No saved homes yet' : u('no_match')}</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{savedOnly && savedIds.size === 0 ? 'Tap the heart on any home to save it for later.' : u('no_match_sub')}</p>
            <button onClick={clearFilters} className="text-sm font-semibold px-4 py-2 rounded-xl" style={{ background: 'var(--accent)', color: 'white' }}>
              {u('clear_filters')}
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(listing => (
              <ListingCard key={String(listing.id)} listing={listing} priceMode={priceMode}
                saved={isSaved(listing)} onToggleSave={() => toggleSave(listing)}
                stats={listing.sample ? undefined : statsFor(listing.id)}
                onOpen={() => openDetail(listing)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {detail && (
          <ListingDetail key="detail" listing={detail}
            saved={isSaved(detail)} onToggleSave={() => toggleSave(detail)}
            stats={detail.sample ? undefined : statsFor(detail.id)}
            onClose={() => setDetail(null)}
            onRent={() => { setFlowListing(detail); setDetail(null); }}
            rentLabel={visitLabel(detail)}
            onMessage={detail.sample ? undefined : () => openChat({ listingId: String(detail.id) })}
            onMap={() => setMapListing(detail)}
            onShare={() => setShareListing(detail)}
            onReviews={() => setReviewListing(detail)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mapListing && (
          <ErrorBoundary key="map-modal" inline onReset={() => setMapListing(null)}>
            <PropertyMap address={mapListing.address} lat={mapListing.lat} lng={mapListing.lng}
              title={mapListing.title} onClose={() => setMapListing(null)} />
          </ErrorBoundary>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {flowListing && <InspectionFlow key="flow-modal" listing={flowListing} account={account} onClose={() => setFlowListing(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {shareListing && <ShareListing key="share-modal" listing={shareListing} onClose={() => setShareListing(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {reviewListing && (reviewListing.sample
          ? <TenantReviews key="review-modal" mode="view" title={reviewListing.title} onClose={() => setReviewListing(null)} />
          : <PropertyReviews key="review-modal" listingId={String(reviewListing.id)} landlord={reviewListing.landlord} title={reviewListing.title} account={account}
              onLandlordReviews={() => { setLandlordReviews(reviewListing); setReviewListing(null); }}
              onClose={() => setReviewListing(null)} />)}
      </AnimatePresence>
      <AnimatePresence>
        {landlordReviews && <TenantReviews key="landlord-reviews" mode="view" landlord={landlordReviews.landlord} title={landlordReviews.title} onClose={() => setLandlordReviews(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showSavedSearches && <SavedSearches key="saved-searches" onClose={() => setShowSavedSearches(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showReferral && <ReferralSystem key="referral" account={account} onClose={() => setShowReferral(false)} />}
      </AnimatePresence>
    </div>
  );
}

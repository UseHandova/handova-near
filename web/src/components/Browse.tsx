import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { ArrowRight, ChevronLeft, ChevronRight, Globe2, Home, Lock, RotateCcw } from 'lucide-react';
import { chain, nearConfig } from '../lib/near';
import type { Lease, Listing } from '../lib/types';
import { usd, usdc } from '../lib/money';
import { ListingCard } from './ListingCard';
import { decodeDetails } from '../lib/listing';
import { Empty } from './ui';

const PAGE_SIZE = 6;

/** Page buttons to show: first, last, and the current page with its neighbours; gaps become "…". */
function pageList(count: number, current: number): (number | '…')[] {
  const keep = new Set([0, count - 1, current - 1, current, current + 1].filter((n) => n >= 0 && n < count));
  const out: (number | '…')[] = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, all) => {
    if (i > 0 && n - all[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export function Browse() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [takeovers, setTakeovers] = useState<Lease[]>([]);
  const [area, setArea] = useState('');
  const [page, setPage] = useState(0);
  const gridTop = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const [err, setErr] = useState('');
  useEffect(() => {
    chain.listings().then((ls) => {
      // Paused and moderated homes are hidden. Newest first, homes with photos ahead of those without.
      const hidden = new Set(nearConfig().hiddenListings ?? []);
      const hasPhoto = (l: Listing) => (decodeDetails(l.property_ref, l.id).photos.length ? 0 : 1);
      setListings(ls.filter((l) => (l.available || l.active_lease !== null) && !hidden.has(l.id)).reverse().sort((a, b) => hasPhoto(a) - hasPhoto(b)));
    }).catch(() => setErr("Couldn't load homes from NEAR. Pull to refresh or try again shortly."));
    const hiddenHomes = new Set(nearConfig().hiddenListings ?? []);
    chain.allLeases().then((ls) => setTakeovers(ls.filter((l) => l.status === 'Active' && l.takeover?.landlord_consent && !hiddenHomes.has(l.listing_id)))).catch(() => {});
  }, []);

  const areaOf = useMemo(() => new Map(listings?.map((l) => [l.id, decodeDetails(l.property_ref, l.id).area || 'Lagos'])), [listings]);
  // Area tabs: the five areas with the most homes.
  const areas = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of areaOf.values()) count.set(a, (count.get(a) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
  }, [areaOf]);
  const shown = (listings ?? []).filter((l) => !area || areaOf.get(l.id) === area);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toGrid = () => gridTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const goPage = (n: number) => { setPage(n); toGrid(); };
  const pickArea = (a: string) => { setArea(a); setPage(0); };

  const features = [
    { icon: Lock, title: t('Rent held until move-in'), text: 'Paid into a NEAR smart contract. The landlord is paid only when you confirm you moved in.' },
    { icon: RotateCcw, title: t('Caution comes back'), text: 'Your lease NFT holds the caution fee. It comes back when you leave, unless damage is proven.' },
    { icon: Globe2, title: t('Pay from any chain'), text: 'Family abroad can pay with USDC from Base, Solana or Ethereum through NEAR Intents. No gas.' },
  ];

  return (
    <div className="space-y-8 pt-2 lg:space-y-12 lg:pt-8">
      <section className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="animate-fade-up">
          <span className="chip !bg-accent-soft !text-accent">Lagos · escrow on NEAR</span>
          <h1 className="mt-3 font-display text-[28px] font-bold leading-tight sm:text-4xl lg:text-[52px] lg:leading-[1.04]">
            {t('Rent straight from the landlord.')} <span className="text-accent">{t('No agent fee.')}</span>
          </h1>
          <p className="mt-3 max-w-xl text-[15px] text-sub lg:mt-5 lg:text-lg">{t('Your rent waits in escrow on NEAR until you move in. Your caution fee comes back when you leave. Family abroad can pay from any chain.')}</p>
          <div className="mt-5 hidden gap-3 sm:flex lg:mt-7">
            <button onClick={toGrid} className="btn-primary px-5">{t('Find a home')}<ArrowRight className="h-4 w-4" /></button>
            <a href="#/list" className="btn-ghost px-5">{t('List your home')}</a>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center lg:grid-cols-1 lg:gap-3 lg:text-left">
          {features.map((f, i) => (
            <div key={f.title} className="card animate-fade-up p-3 transition duration-300 hover:-translate-y-0.5 lg:flex lg:items-start lg:gap-4 lg:p-5" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <span className="mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent lg:mx-0 lg:mb-0 lg:h-11 lg:w-11 lg:shrink-0">
                <f.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[12px] font-semibold text-ink2 lg:text-base lg:font-bold lg:text-ink">{f.title}</p>
                <p className="mt-1 hidden text-sm text-sub lg:block">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {takeovers.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold lg:text-2xl">{t('Take over a lease')}</h2>
          <p className="text-sm text-sub">A tenant is leaving early and the landlord has agreed. Pay their price and the home, and its caution fee, pass to you.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {takeovers.map((l) => (
              <a key={l.id} href={`#/lease/${l.id}`} className="card flex items-center justify-between gap-3 p-4 transition hover:-translate-y-0.5">
                <span className="font-semibold">Lease #{l.id} · listing #{l.listing_id}</span>
                <span className="chip !bg-accent-soft !text-accent">{usd(usdc(l.takeover!.price))}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div ref={gridTop} className="flex scroll-mt-20 flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold lg:text-2xl">{t('Homes')}</h2>
            {listings && <p className="text-sm text-sub">{shown.length} {shown.length === 1 ? t('home') : t('homes')} · {t('no agent fee')}</p>}
          </div>
          {areas.length > 1 && (
            <div role="tablist" aria-label={t('Area')} className="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 shadow-card">
              {['', ...areas].map((a) => (
                <button
                  key={a || 'all'}
                  role="tab"
                  aria-selected={area === a}
                  onClick={() => pickArea(a)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-200 ${area === a ? 'bg-accent text-white shadow-sm' : 'text-sub hover:text-ink'}`}
                >
                  {a || t('All')}
                </button>
              ))}
            </div>
          )}
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}
        {!listings && !err && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('Loading homes')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton aspect-[16/10]" />
                <div className="space-y-2 p-4"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-3 w-1/3 rounded" /><div className="skeleton h-5 w-1/2 rounded" /></div>
              </div>
            ))}
          </div>
        )}
        {listings?.length === 0 && (
          <Empty icon={<Home className="h-6 w-6" />} title="No homes listed yet">
            Landlords: <a className="font-semibold text-accent" href="#/list">list your first home</a> — it takes a voice note.
          </Empty>
        )}
        {/* Keyed by tab and page so each change replays the entrance animation. */}
        <div key={`${area}-${page}`} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {current.map((l, i) => (
            <div key={l.id} className="animate-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
              <ListingCard l={l} />
            </div>
          ))}
        </div>

        {pages > 1 && (
          <nav aria-label={t('Pages')} className="flex flex-col items-center gap-2 pt-2">
            <div className="flex items-center gap-1.5">
              <button aria-label={t('Previous page')} disabled={page === 0} onClick={() => goPage(page - 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink2 transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink2">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageList(pages, page).map((n, i) =>
                n === '…' ? (
                  <span key={`gap${i}`} className="px-1 text-faint">…</span>
                ) : (
                  <button
                    key={n}
                    aria-label={`${t('Page')} ${n + 1}`}
                    aria-current={n === page ? 'page' : undefined}
                    onClick={() => goPage(n)}
                    className={`h-10 min-w-[2.5rem] rounded-full px-3 text-sm font-semibold transition ${n === page ? 'scale-105 bg-accent text-white shadow-sm' : 'border border-line bg-surface text-ink2 hover:border-accent hover:text-accent'}`}
                  >
                    {n + 1}
                  </button>
                ),
              )}
              <button aria-label={t('Next page')} disabled={page === pages - 1} onClick={() => goPage(page + 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink2 transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink2">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-faint">
              {t('Showing')} {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, shown.length)} {t('of')} {shown.length}
            </p>
          </nav>
        )}
      </section>
    </div>
  );
}

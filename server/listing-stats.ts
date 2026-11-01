/**
 * Per-property social proof, kept in the server database:
 *   saves    — signed-in tenants save a home for later; everyone sees how many people saved it
 *   views    — unique people who opened the home (an anonymous per-device id, stored hashed)
 *   inspected — tenants who completed an inspection there (both sides confirmed the visit); plus visits booked
 *   reviews  — property reviews, only from people who actually saw it: a completed inspection, a move-in onchain,
 *              or a landlord-confirmed cash payment. Each person reviews a home once; landlords can't review their own.
 */

import { createHash } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { parseAbi, type Address } from 'viem';
import { db } from './db';
import { chainClient, requireSession, verifyToken } from './auth';
import { ensureInspectionsTable } from './inspections';
import type { FeatureConfig } from './features';

const ESCROW_ABI = parseAbi([
  'function escrows(uint256) view returns (uint256 listingId, address tenant, uint256 totalHeld, uint8 status, uint256 createdAt)',
  'function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)',
]);
/** EscrowStatus: Pending, Active, Released, Refunded, Disputed, Ending — anything past Pending means they moved in. */
const MOVED_IN = new Set([1, 2, 3, 4, 5]);
const UPCOMING = ['requested', 'rescheduled', 'approved'];

const lower = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hash = (s: string) => createHash('sha256').update(`handova-view:${s}`).digest('hex').slice(0, 32);

export interface ListingStats { saves: number; views: number; inspected: number; booked: number; rating: number; reviews: number }

export function ensureListingStatsTables() {
  ensureInspectionsTable();
  db().exec(`CREATE TABLE IF NOT EXISTS listing_saves (
    listing_id TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (listing_id, address)
  );
  CREATE TABLE IF NOT EXISTS listing_views (
    listing_id TEXT NOT NULL,
    viewer TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (listing_id, viewer)
  );
  CREATE TABLE IF NOT EXISTS listing_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    landlord TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (listing_id, author)
  );
  CREATE INDEX IF NOT EXISTS listing_saves_address ON listing_saves (address);`);
}

/** Counts for every listing that has any activity, keyed by listing id. */
export function allListingStats(): Record<string, ListingStats> {
  const out: Record<string, ListingStats> = {};
  const row = (id: string) => (out[id] ??= { saves: 0, views: 0, inspected: 0, booked: 0, rating: 0, reviews: 0 });
  for (const r of db().query('SELECT listing_id, COUNT(*) n FROM listing_saves GROUP BY listing_id').all() as { listing_id: string; n: number }[]) row(r.listing_id).saves = r.n;
  for (const r of db().query('SELECT listing_id, COUNT(*) n FROM listing_views GROUP BY listing_id').all() as { listing_id: string; n: number }[]) row(r.listing_id).views = r.n;
  for (const r of db().query("SELECT listing_id, COUNT(DISTINCT tenant) n FROM inspections WHERE status = 'completed' GROUP BY listing_id").all() as { listing_id: string; n: number }[]) row(r.listing_id).inspected = r.n;
  for (const r of db().query(`SELECT listing_id, COUNT(DISTINCT tenant) n FROM inspections WHERE status IN (${UPCOMING.map(() => '?').join(',')}) AND slot_at > ? GROUP BY listing_id`)
    .all(...UPCOMING, Date.now() - 2 * 3600_000) as { listing_id: string; n: number }[]) row(r.listing_id).booked = r.n;
  for (const r of db().query('SELECT listing_id, COUNT(*) n, AVG(rating) avg FROM listing_reviews GROUP BY listing_id').all() as { listing_id: string; n: number; avg: number }[]) {
    row(r.listing_id).reviews = r.n;
    row(r.listing_id).rating = Math.round(r.avg * 10) / 10;
  }
  return out;
}

export function mountListingStats(app: Express, config: FeatureConfig | null) {
  ensureListingStatsTables();
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const listingId = (req: Request): string | null => { const id = String(req.params.id ?? ''); return /^\d{1,12}$/.test(id) && id !== '0' ? id : null; };

  const landlordOf = async (id: string): Promise<Address | null> => {
    if (!config) return null;
    const [landlord] = await chainClient.readContract({ address: config.escrow, abi: ESCROW_ABI, functionName: 'listings', args: [BigInt(id)] });
    return landlord === '0x0000000000000000000000000000000000000000' ? null : landlord;
  };

  /** How `me` knows this home, if at all: 'lived' (moved in / paid cash) beats 'visited' (completed inspection). */
  const relation = async (id: string, me: string, escrowId?: unknown): Promise<'lived' | 'visited' | null> => {
    if (config && escrowId !== undefined && /^\d{1,12}$/.test(String(escrowId))) {
      const [eListing, tenant, , status] = await chainClient.readContract({ address: config.escrow, abi: ESCROW_ABI, functionName: 'escrows', args: [BigInt(String(escrowId))] }).catch(() => [0n, '', 0n, 0] as const);
      if (String(eListing) === id && lower(tenant) === lower(me) && MOVED_IN.has(Number(status))) return 'lived';
    }
    try {
      if (db().query("SELECT 1 FROM cash_payments WHERE listing_id = ? AND tenant = ? AND status = 'confirmed' LIMIT 1").get(id, lower(me))) return 'lived';
    } catch { /* cash payments not set up on this server */ }
    if (db().query("SELECT 1 FROM inspections WHERE listing_id = ? AND tenant = ? AND status = 'completed' LIMIT 1").get(id, lower(me))) return 'visited';
    return null;
  };

  app.get('/api/listings/stats', (_req: Request, res: Response) => {
    res.json({ ok: true, stats: allListingStats() });
  });

  // ── Saves ─────────────────────────────────────────────────────────────────
  app.get('/api/listings/saved', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT listing_id FROM listing_saves WHERE address = ? ORDER BY created_at DESC').all(lower(me)) as { listing_id: string }[];
    res.json({ ok: true, listingIds: rows.map(r => r.listing_id) });
  });

  app.post('/api/listings/:id/save', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const id = listingId(req); if (!id) return bad(res, 400, 'That home wasn\'t found.');
    const saved = (req.body ?? {}).saved !== false;
    if (saved) db().query('INSERT OR IGNORE INTO listing_saves (listing_id, address, created_at) VALUES (?, ?, ?)').run(id, lower(me), Date.now());
    else db().query('DELETE FROM listing_saves WHERE listing_id = ? AND address = ?').run(id, lower(me));
    const { n } = db().query('SELECT COUNT(*) n FROM listing_saves WHERE listing_id = ?').get(id) as { n: number };
    res.json({ ok: true, saved, saves: n });
  });

  // ── Views (anonymous, one per device per home) ───────────────────────────
  app.post('/api/listings/:id/view', (req: Request, res: Response) => {
    const id = listingId(req); if (!id) return bad(res, 400, 'That home wasn\'t found.');
    const viewer = String((req.body ?? {}).viewer ?? '');
    if (!/^[A-Za-z0-9-]{16,64}$/.test(viewer)) return bad(res, 400, 'Missing viewer id.');
    db().query('INSERT OR IGNORE INTO listing_views (listing_id, viewer, created_at) VALUES (?, ?, ?)').run(id, hash(viewer), Date.now());
    const { n } = db().query('SELECT COUNT(*) n FROM listing_views WHERE listing_id = ?').get(id) as { n: number };
    res.json({ ok: true, views: n });
  });

  // ── Property reviews ──────────────────────────────────────────────────────
  app.get('/api/listings/:id/reviews', async (req: Request, res: Response) => {
    const id = listingId(req); if (!id) return bad(res, 400, 'That home wasn\'t found.');
    const rows = db().query('SELECT author, kind, rating, body, created_at FROM listing_reviews WHERE listing_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(id) as { author: string; kind: string; rating: number; body: string; created_at: number }[];
    const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
    // Signed in? Also say whether this person can review the home.
    const me = verifyToken(req.header('authorization')?.replace(/^Bearer\s+/i, ''));
    let mine: { reviewed: boolean; canReview: boolean } | undefined;
    if (me) {
      const reviewed = rows.some(r => r.author === lower(me));
      mine = { reviewed, canReview: !reviewed && !!(await relation(id, me, req.query.escrowId).catch(() => null)) };
    }
    res.json({ ok: true, count: rows.length, average: Math.round(avg * 10) / 10, mine,
      reviews: rows.map(r => ({ rating: r.rating, body: r.body, kind: r.kind, author: short(r.author), createdAt: r.created_at })) });
  });

  app.post('/api/listings/:id/reviews', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const id = listingId(req); if (!id) return bad(res, 400, 'That home wasn\'t found.');
    const { rating, body: rawBody, escrowId } = (req.body ?? {}) as Record<string, unknown>;
    const stars = Number(rating);
    const body = typeof rawBody === 'string' ? rawBody.trim().slice(0, 1000) : '';
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return bad(res, 400, 'Choose 1 to 5 stars.');
    if (body.length < 10) return bad(res, 400, 'Please write at least a sentence about the home.');
    let landlord: Address | null;
    try { landlord = await landlordOf(id); } catch { return bad(res, 503, 'We couldn\'t reach the blockchain to check this home. Please try again in a minute.', 'chain_unavailable'); }
    if (!config) return bad(res, 503, 'Reviews are not configured on the server.', 'unavailable');
    if (!landlord) return bad(res, 404, 'That home wasn\'t found.', 'not_found');
    if (lower(landlord) === lower(me)) return bad(res, 403, 'You can\'t review your own property.', 'own_listing');
    const kind = await relation(id, me, escrowId).catch(() => null);
    if (!kind) return bad(res, 403, 'You can review a home after you\'ve inspected it (both of you confirmed the visit) or lived there.', 'not_eligible');
    try {
      db().query('INSERT INTO listing_reviews (listing_id, landlord, author, kind, rating, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, lower(landlord), lower(me), kind, stars, body, Date.now());
    } catch {
      return bad(res, 409, 'You have already reviewed this home.', 'already_reviewed');
    }
    res.json({ ok: true, kind });
  });
}

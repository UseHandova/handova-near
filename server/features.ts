/**
 * App features backed by the server database, with every write checked against onchain facts:
 *   reviews      — only a tenant who actually moved in (escrow Active or later) can review that landlord, once per tenancy
 *   maintenance  — tenants of a live tenancy file repairs; the landlord updates status
 *   boosts       — a landlord pays USDC to the treasury onchain; we verify the Transfer in the tx before boosting
 *   referrals    — a new account records who referred it; referrers see counts (no payouts yet)
 *   moderation   — the escrow's arbiter can hide/unhide listings (scams, spam, test data)
 */

import type { Express, Request, Response } from 'express';
import { decodeEventLog, isAddress, isHex, parseAbi, parseUnits, type Address, type Hex } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';

const ESCROW_ABI = parseAbi([
  'function escrows(uint256) view returns (uint256 listingId, address tenant, uint256 totalHeld, uint8 status, uint256 createdAt)',
  'function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)',
  'function arbiter() view returns (address)',
]);
const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);

/** EscrowStatus enum: Pending, Active, Released, Refunded, Disputed, Ending */
const MOVED_IN = new Set([1, 2, 3, 4, 5]);
const LIVE_TENANCY = new Set([1, 5]);

export const BOOST_PLANS: Record<number, string> = { 7: '2', 14: '3.5', 30: '6' };

const lower = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface FeatureConfig {
  escrow: Address;
  usdc: Address;
  treasury: Address;
}

export function featureConfigFromEnv(env = process.env): FeatureConfig | null {
  const escrow = env.ESCROW_ADDRESS || env.VITE_ESCROW_ADDRESS;
  const treasury = env.TREASURY_ADDRESS || env.VITE_TREASURY_ADDRESS;
  if (!escrow || !isAddress(escrow) || !treasury || !isAddress(treasury)) return null;
  return { escrow, usdc: (env.USDC_ADDRESS as Address) || '0x3600000000000000000000000000000000000000', treasury };
}

export function mountFeatures(app: Express, config: FeatureConfig | null = featureConfigFromEnv()) {
  const unavailable = (res: Response) => res.status(503).json({ ok: false, error: 'This feature is not configured on the server.' });
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });

  const escrowOf = async (id: bigint) => {
    const [listingId, tenant, , status] = await chainClient.readContract({ address: config!.escrow, abi: ESCROW_ABI, functionName: 'escrows', args: [id] });
    if (tenant === '0x0000000000000000000000000000000000000000') return null;
    const [landlord] = await chainClient.readContract({ address: config!.escrow, abi: ESCROW_ABI, functionName: 'listings', args: [listingId] });
    return { listingId, tenant, status: Number(status), landlord };
  };
  const parseId = (v: unknown): bigint | null => {
    try { const n = BigInt(String(v)); return n > 0n ? n : null; } catch { return null; }
  };

  // ── Reviews ───────────────────────────────────────────────────────────────
  app.get('/api/reviews', (req: Request, res: Response) => {
    const landlord = String(req.query.landlord ?? '');
    if (!isAddress(landlord)) return bad(res, 400, 'Invalid landlord.');
    const rows = db().query('SELECT rating, body, tenant, created_at FROM reviews WHERE landlord = ? ORDER BY created_at DESC LIMIT 100')
      .all(lower(landlord)) as { rating: number; body: string; tenant: string; created_at: number }[];
    const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
    res.json({ ok: true, count: rows.length, average: Math.round(avg * 10) / 10,
      reviews: rows.map(r => ({ rating: r.rating, body: r.body, tenant: short(r.tenant), createdAt: r.created_at })) });
  });

  /** Tenancies the signed-in tenant can still review. */
  app.get('/api/reviews/eligible', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return unavailable(res);
    const ids = String(req.query.escrowIds ?? '').split(',').map(parseId).filter((x): x is bigint => !!x).slice(0, 20);
    const reviewed = new Set((db().query('SELECT escrow_id FROM reviews WHERE tenant = ?').all(lower(me)) as { escrow_id: string }[]).map(r => r.escrow_id));
    const out: string[] = [];
    for (const id of ids) {
      if (reviewed.has(String(id))) continue;
      const e = await escrowOf(id).catch(() => null);
      if (e && lower(e.tenant) === lower(me) && MOVED_IN.has(e.status)) out.push(String(id));
    }
    res.json({ ok: true, escrowIds: out });
  });

  app.post('/api/reviews', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return unavailable(res);
    const { escrowId, rating } = (req.body ?? {}) as Record<string, unknown>;
    const id = parseId(escrowId);
    const body = str((req.body ?? {}).body, 1000);
    const stars = Number(rating);
    if (!id) return bad(res, 400, 'Invalid tenancy.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return bad(res, 400, 'Choose 1 to 5 stars.');
    if (body.length < 10) return bad(res, 400, 'Please write at least a sentence about your experience.');
    const e = await escrowOf(id).catch(() => null);
    if (!e || lower(e.tenant) !== lower(me)) return bad(res, 403, 'Only the tenant of this tenancy can review it.', 'not_tenant');
    if (!MOVED_IN.has(e.status)) return bad(res, 403, 'You can review your landlord after you move in.', 'not_moved_in');
    try {
      db().query('INSERT INTO reviews (escrow_id, landlord, tenant, rating, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(id), lower(e.landlord), lower(me), stars, body, Date.now());
    } catch {
      return bad(res, 409, 'You have already reviewed this tenancy.', 'already_reviewed');
    }
    res.json({ ok: true });
  });

  // ── Maintenance ───────────────────────────────────────────────────────────
  app.get('/api/maintenance', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT * FROM maintenance WHERE tenant = ? OR landlord = ? ORDER BY CASE status WHEN \'resolved\' THEN 1 ELSE 0 END, updated_at DESC LIMIT 200')
      .all(lower(me), lower(me)) as Record<string, unknown>[];
    res.json({ ok: true, requests: rows.map(r => ({
      id: r.id, escrowId: r.escrow_id, listingId: r.listing_id, title: r.title, details: r.details, priority: r.priority,
      status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      role: lower(String(r.tenant)) === lower(me) ? 'tenant' : 'landlord',
    })) });
  });

  app.post('/api/maintenance', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return unavailable(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = parseId(b.escrowId);
    const title = str(b.title, 120);
    const details = str(b.details, 2000);
    const priority = ['low', 'medium', 'high'].includes(String(b.priority)) ? String(b.priority) : 'medium';
    if (!id) return bad(res, 400, 'Choose which home this is for.');
    if (title.length < 3) return bad(res, 400, 'Add a short title, e.g. "Leaking kitchen tap".');
    const e = await escrowOf(id).catch(() => null);
    if (!e || lower(e.tenant) !== lower(me)) return bad(res, 403, 'Only the tenant can report repairs for this home.', 'not_tenant');
    if (!LIVE_TENANCY.has(e.status)) return bad(res, 403, 'Repairs can be reported while you live in the home.', 'not_live');
    const now = Date.now();
    db().query('INSERT INTO maintenance (escrow_id, listing_id, tenant, landlord, title, details, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'open\', ?, ?)')
      .run(String(id), String(e.listingId), lower(me), lower(e.landlord), title, details, priority, now, now);
    res.json({ ok: true });
  });

  app.patch('/api/maintenance/:id', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const status = String((req.body ?? {}).status);
    if (!['open', 'in_progress', 'resolved'].includes(status)) return bad(res, 400, 'Invalid status.');
    const row = db().query('SELECT tenant, landlord FROM maintenance WHERE id = ?').get(Number(req.params.id)) as { tenant: string; landlord: string } | null;
    if (!row) return bad(res, 404, 'Request not found.', 'not_found');
    const isLandlord = lower(row.landlord) === lower(me);
    const isTenant = lower(row.tenant) === lower(me);
    // Landlords move requests through any status; tenants can confirm a fix (resolved) or reopen.
    if (!isLandlord && !(isTenant && (status === 'resolved' || status === 'open'))) return bad(res, 403, 'You can\'t change this request.', 'forbidden');
    db().query('UPDATE maintenance SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Boosts ────────────────────────────────────────────────────────────────
  app.get('/api/boosts', (_req: Request, res: Response) => {
    const rows = db().query('SELECT listing_id, MAX(ends_at) AS ends_at FROM boosts WHERE ends_at > ? GROUP BY listing_id').all(Date.now()) as { listing_id: string; ends_at: number }[];
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, treasury: config?.treasury ?? null, plans: BOOST_PLANS, boosts: rows.map(r => ({ listingId: r.listing_id, endsAt: r.ends_at })) });
  });

  app.post('/api/boosts', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return unavailable(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const listingId = parseId(b.listingId);
    const days = Number(b.days);
    const txHash = b.txHash;
    if (!listingId || !BOOST_PLANS[days] || typeof txHash !== 'string' || !isHex(txHash) || txHash.length !== 66) return bad(res, 400, 'Invalid boost request.');
    const [landlord, , , active] = await chainClient.readContract({ address: config.escrow, abi: ESCROW_ABI, functionName: 'listings', args: [listingId] });
    if (lower(landlord) !== lower(me)) return bad(res, 403, 'Only the landlord can boost this listing.', 'not_landlord');
    if (!active) return bad(res, 409, 'This listing is no longer live.', 'inactive');
    if (db().query('SELECT 1 FROM boosts WHERE tx_hash = ?').get(lower(txHash))) return bad(res, 409, 'This payment was already used.', 'tx_used');

    // The payment must be a USDC Transfer from the landlord's account to the treasury, for at least the plan price.
    const receipt = await chainClient.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
    if (!receipt || receipt.status !== 'success') return bad(res, 402, 'We could not find a successful payment for this boost.', 'no_payment');
    const need = parseUnits(BOOST_PLANS[days], 6);
    const paid = receipt.logs.some(log => {
      if (lower(log.address) !== lower(config.usdc)) return false;
      try {
        const ev = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
        return lower(ev.args.from) === lower(me) && lower(ev.args.to) === lower(config.treasury) && ev.args.value >= need;
      } catch { return false; }
    });
    if (!paid) return bad(res, 402, 'The payment in that transaction doesn\'t match this boost.', 'payment_mismatch');

    // Extend an existing boost instead of overlapping it.
    const current = db().query('SELECT MAX(ends_at) AS ends_at FROM boosts WHERE listing_id = ?').get(String(listingId)) as { ends_at: number | null };
    const startsAt = Math.max(Date.now(), current?.ends_at ?? 0);
    const endsAt = startsAt + days * 86_400_000;
    db().query('INSERT INTO boosts (tx_hash, listing_id, landlord, days, amount, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(lower(txHash), String(listingId), lower(me), days, BOOST_PLANS[days], startsAt, endsAt);
    res.json({ ok: true, endsAt });
  });

  // ── Referrals ─────────────────────────────────────────────────────────────
  const codeFor = (address: string) => {
    const existing = db().query('SELECT code FROM referral_codes WHERE address = ?').get(lower(address)) as { code: string } | null;
    if (existing) return existing.code;
    for (let len = 6; ; len++) {
      const code = address.slice(2, 2 + len).toUpperCase();
      try { db().query('INSERT INTO referral_codes (code, address) VALUES (?, ?)').run(code, lower(address)); return code; } catch { /* collision → longer */ }
    }
  };

  app.get('/api/referrals/me', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const code = codeFor(me);
    const rows = db().query('SELECT referee, created_at FROM referrals WHERE referrer = ? ORDER BY created_at DESC').all(lower(me)) as { referee: string; created_at: number }[];
    const referredBy = db().query('SELECT referrer FROM referrals WHERE referee = ?').get(lower(me)) as { referrer: string } | null;
    res.json({ ok: true, code, referrals: rows.map(r => ({ account: short(r.referee), joinedAt: r.created_at })), referredBy: referredBy ? short(referredBy.referrer) : null });
  });

  app.post('/api/referrals', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const code = str((req.body ?? {}).code, 20).toUpperCase();
    const ref = db().query('SELECT address FROM referral_codes WHERE code = ?').get(code) as { address: string } | null;
    if (!ref) return bad(res, 404, 'That referral code doesn\'t exist.', 'unknown_code');
    if (lower(ref.address) === lower(me)) return bad(res, 400, 'You can\'t refer yourself.', 'self');
    try {
      db().query('INSERT INTO referrals (referee, referrer, created_at) VALUES (?, ?, ?)').run(lower(me), lower(ref.address), Date.now());
    } catch {
      return bad(res, 409, 'This account was already referred.', 'already_referred');
    }
    res.json({ ok: true });
  });

  // ── Moderation ────────────────────────────────────────────────────────────
  const requireArbiter = async (req: Request, res: Response): Promise<Address | null> => {
    const me = requireSession(req, res); if (!me) return null;
    if (!config) { unavailable(res); return null; }
    const arbiter = await chainClient.readContract({ address: config.escrow, abi: ESCROW_ABI, functionName: 'arbiter' }).catch(() => null);
    if (!arbiter || lower(arbiter) !== lower(me)) { bad(res, 403, 'Only the Handova admin can do this.', 'not_admin'); return null; }
    return me;
  };

  app.get('/api/moderation/hidden', (_req: Request, res: Response) => {
    const rows = db().query('SELECT listing_id, reason, hidden_at FROM hidden_listings ORDER BY hidden_at DESC').all() as { listing_id: string; reason: string; hidden_at: number }[];
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, listingIds: rows.map(r => r.listing_id), items: rows.map(r => ({ listingId: r.listing_id, reason: r.reason, hiddenAt: r.hidden_at })) });
  });

  app.post('/api/moderation/hide', async (req: Request, res: Response) => {
    const admin = await requireArbiter(req, res); if (!admin) return;
    const id = parseId((req.body ?? {}).listingId);
    const reason = str((req.body ?? {}).reason, 300) || 'Hidden by admin';
    if (!id) return bad(res, 400, 'Invalid listing.');
    db().query('INSERT OR REPLACE INTO hidden_listings (listing_id, reason, hidden_by, hidden_at) VALUES (?, ?, ?, ?)').run(String(id), reason, lower(admin), Date.now());
    res.json({ ok: true });
  });

  app.post('/api/moderation/unhide', async (req: Request, res: Response) => {
    const admin = await requireArbiter(req, res); if (!admin) return;
    const id = parseId((req.body ?? {}).listingId);
    if (!id) return bad(res, 400, 'Invalid listing.');
    db().query('DELETE FROM hidden_listings WHERE listing_id = ?').run(String(id));
    res.json({ ok: true });
  });
}

/**
 * Cash payments — when the landlord chooses cash instead of escrow.
 *
 *   tenant pays in person ─► uploads the receipt ─► landlord: "Yes, I received ₦X"  → confirmed (a record for both)
 *                                                └► landlord: "I didn't receive it"  → disputed → admin reviews the receipt
 *
 * Only possible for an inspection the landlord set to cash (server/inspections.ts, action "payment") and after the
 * visit is confirmed. Receipts are encrypted on disk and kept: they're the tenant's proof of payment.
 * A confirmed cash payment covers one year from the payment date; those homes are hidden from browsing meanwhile.
 */

import type { Express, Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import { parseAbi } from 'viem';
import { isArbiter } from './admin';
import { openFile, sealFile } from './file-crypto';
import { canPay, type Notifier } from './inspections';
import type { FeatureConfig } from './features';

const FILE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_FILES = 3, MAX_BYTES = 10 * 1024 * 1024;
const YEAR_MS = 365 * 86_400_000;
const USDC_TO_NGN = 1600;
const LISTING_ABI = parseAbi(['function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)']);

type Status = 'awaiting_landlord' | 'confirmed' | 'disputed' | 'rejected';
type StoredFile = { name: string; file: string; mime: string; sha256: string };
interface Row {
  id: number; inspection_id: number; listing_id: string; tenant: string; landlord: string; place: string; tenant_name: string;
  tenant_phone: string; landlord_phone: string; amount_ngn: number; paid_on: string; note: string; files: string; status: Status;
  landlord_note: string; admin_note: string; created_at: number; landlord_answered_at: number | null; resolved_at: number | null;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;
/** "2026-10-08" in Lagos, today. */
const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
/** End of cover: one year after the payment date. */
const coversUntil = (paidOn: string) => Date.parse(`${paidOn}T00:00:00+01:00`) + YEAR_MS;

export function mountCash(app: Express, config: FeatureConfig | null, notify: Notifier = async () => false, dir = process.env.CASH_RECEIPTS_DIR || 'server/data/receipts') {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  db().exec(`CREATE TABLE IF NOT EXISTS cash_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id INTEGER NOT NULL,
    listing_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    landlord TEXT NOT NULL,
    place TEXT NOT NULL,
    tenant_name TEXT NOT NULL,
    tenant_phone TEXT NOT NULL,
    landlord_phone TEXT NOT NULL,
    amount_ngn INTEGER NOT NULL,
    paid_on TEXT NOT NULL,
    note TEXT NOT NULL,
    files TEXT NOT NULL,
    status TEXT NOT NULL,
    landlord_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    landlord_answered_at INTEGER,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS cash_tenant ON cash_payments (tenant);
  CREATE INDEX IF NOT EXISTS cash_landlord ON cash_payments (landlord);`);

  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const lower = (a: string) => a.toLowerCase();
  const get = (id: number) => db().query('SELECT * FROM cash_payments WHERE id = ?').get(id) as Row | null;
  const tell = (phone: string, text: string) => (phone ? notify(phone, text).catch(() => false) : Promise.resolve(false));
  const link = (path: string) => { const u = (process.env.APP_URL || '').replace(/\/$/, ''); return u ? `\n\n${u}${path}` : ''; };

  const view = (r: Row, me: string, notified?: boolean) => ({
    id: r.id, inspectionId: r.inspection_id, listingId: r.listing_id, place: r.place,
    role: lower(r.tenant) === lower(me) ? 'tenant' : lower(r.landlord) === lower(me) ? 'landlord' : 'admin',
    tenantName: r.tenant_name, amountNgn: r.amount_ngn, paidOn: r.paid_on, note: r.note, status: r.status,
    landlordNote: r.landlord_note, adminNote: r.admin_note, createdAt: r.created_at, landlordAnsweredAt: r.landlord_answered_at,
    resolvedAt: r.resolved_at, coversUntil: coversUntil(r.paid_on),
    files: (JSON.parse(r.files) as StoredFile[]).map((f, i) => ({ index: i, name: f.name, mime: f.mime, sha256: f.sha256 })),
    ...(notified !== undefined && { notified }),
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: MAX_FILES },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in FILE_TYPES),
  });

  /** Public: listings currently rented for cash (so browsing can hide them). IDs only. */
  app.get('/api/cash-payments/rented', (_req: Request, res: Response) => {
    const rows = db().query("SELECT listing_id, paid_on FROM cash_payments WHERE status = 'confirmed'").all() as { listing_id: string; paid_on: string }[];
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-cache'); // must update the moment a landlord confirms
    res.json({ ok: true, listingIds: [...new Set(rows.filter(r => coversUntil(r.paid_on) > now).map(r => r.listing_id))] });
  });

  /** Mine, as tenant or landlord. */
  app.get('/api/cash-payments', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT * FROM cash_payments WHERE tenant = ? OR landlord = ? ORDER BY created_at DESC LIMIT 100').all(lower(me), lower(me)) as Row[];
    res.json({ ok: true, payments: rows.map(r => view(r, me)) });
  });

  /** Tenant: "I paid in cash — here's the receipt." */
  app.post('/api/cash-payments', (req: Request, res: Response, next) => {
    const me = requireSession(req, res); if (!me) return;
    (req as Request & { me?: string }).me = me;
    next();
  }, upload.array('files', MAX_FILES), async (req: Request, res: Response) => {
    const me = (req as Request & { me?: string }).me!;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const insp = db().query('SELECT * FROM inspections WHERE id = ?').get(Number(req.body?.inspectionId)) as
      { id: number; listing_id: string; tenant: string; landlord: string; place: string; tenant_name: string; tenant_phone: string; landlord_phone: string; status: 'completed' | 'approved'; slot_at: number; tenant_confirmed_at: number | null; landlord_confirmed_at: number | null; payment_method: string } | null;
    if (!insp || lower(insp.tenant) !== lower(me)) return bad(res, 404, 'Inspection not found.', 'not_found');
    if (insp.payment_method !== 'cash') return bad(res, 409, 'The landlord asked for payment through escrow, not cash.', 'not_cash');
    if (!canPay(insp)) return bad(res, 409, 'You can pay once the inspection is confirmed.', 'not_yet');
    const amount = Math.round(Number(req.body?.amountNgn));
    const paidOn = String(req.body?.paidOn ?? '');
    if (!(amount >= 1000)) return bad(res, 400, 'Enter how much you paid, in naira.', 'amount');
    // The first payment is always in full: a year's rent plus the caution fee, as listed on the blockchain.
    if (!config) return bad(res, 503, 'Cash payments are not configured on the server.', 'unavailable');
    let fullNgn: number;
    try {
      const [, rent, deposit] = await chainClient.readContract({ address: config.escrow, abi: LISTING_ABI, functionName: 'listings', args: [BigInt(insp.listing_id)] });
      fullNgn = Math.round((Number(rent + deposit) / 1e6) * USDC_TO_NGN);
    } catch { return bad(res, 502, 'Could not check the price on the blockchain. Please try again in a moment.', 'chain'); }
    if (amount < fullNgn) return bad(res, 400, `The first payment has to be in full: ${naira(fullNgn)} (a year's rent plus the caution fee).`, 'not_full');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > lagosToday() || Date.parse(paidOn) < Date.now() - 90 * 86_400_000) {
      return bad(res, 400, 'Enter the date you paid (today or in the last 90 days).', 'paid_on');
    }
    if (!files.length) return bad(res, 400, 'Add a photo of the receipt.', 'no_files');
    const open = db().query("SELECT status FROM cash_payments WHERE inspection_id = ? AND status IN ('awaiting_landlord','confirmed','disputed') LIMIT 1").get(insp.id) as { status: Status } | null;
    if (open) return bad(res, 409, open.status === 'confirmed' ? 'This payment is already confirmed.' : 'You already sent a receipt for this home — it\'s with the landlord.', 'exists');

    const stored: StoredFile[] = files.map(f => {
      const file = `${randomBytes(12).toString('hex')}.bin`;
      writeFileSync(join(root, file), sealFile(f.buffer), { mode: 0o600 });
      return { name: f.originalname.slice(0, 80), file, mime: f.mimetype, sha256: createHash('sha256').update(f.buffer).digest('hex') };
    });
    const id = Number(db().query(`INSERT INTO cash_payments (inspection_id, listing_id, tenant, landlord, place, tenant_name, tenant_phone, landlord_phone, amount_ngn, paid_on, note, files, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_landlord', ?)`)
      .run(insp.id, insp.listing_id, insp.tenant, insp.landlord, insp.place, insp.tenant_name, insp.tenant_phone, insp.landlord_phone,
        amount, paidOn, String(req.body?.note ?? '').trim().slice(0, 300), JSON.stringify(stored), Date.now()).lastInsertRowid);
    const notified = await tell(insp.landlord_phone, `💵 Handova: ${insp.tenant_name} says they paid you ${naira(amount)} in cash for ${insp.place} on ${paidOn} and uploaded the receipt. Please confirm in the app whether you received it.${link('/landlord')}`);
    res.json({ ok: true, payment: view(get(id)!, me, notified) });
  });

  /** A receipt — for the tenant, the landlord and the admin only. */
  app.get('/api/cash-payments/:id/receipt/:index', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const r = get(Number(req.params.id));
    if (!r || (lower(r.tenant) !== lower(me) && lower(r.landlord) !== lower(me) && !(await isArbiter(config, me)))) return bad(res, 404, 'Receipt not found.', 'not_found');
    const f = (JSON.parse(r.files) as StoredFile[])[Number(req.params.index)];
    if (!f) return bad(res, 404, 'Receipt not found.', 'not_found');
    let body: Buffer;
    try { body = openFile(readFileSync(join(root, f.file))); } catch { return bad(res, 404, 'Receipt not found.', 'not_found'); }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', f.mime);
    res.send(body);
  });

  /** Landlord: did the cash arrive? */
  app.post('/api/cash-payments/:id/answer', express.json(), async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const r = get(Number(req.params.id));
    if (!r || (lower(r.tenant) !== lower(me) && lower(r.landlord) !== lower(me))) return bad(res, 404, 'Payment not found.', 'not_found');
    if (lower(r.landlord) !== lower(me)) return bad(res, 403, 'Only the landlord can confirm this payment.', 'not_landlord');
    if (r.status !== 'awaiting_landlord') return bad(res, 409, 'You already answered this one.', 'wrong_state');
    const received = req.body?.received === true;
    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    if (!received && note.length < 5) return bad(res, 400, 'Say what\'s wrong (e.g. the amount is short), so the Handova team can look into it.', 'note');
    db().query('UPDATE cash_payments SET status = ?, landlord_note = ?, landlord_answered_at = ? WHERE id = ?')
      .run(received ? 'confirmed' : 'disputed', note, Date.now(), r.id);
    const notified = await tell(r.tenant_phone, received
      ? `✅ Handova: the landlord confirmed they received your ${naira(r.amount_ngn)} cash payment for ${r.place}. Your payment record is in the app.${link('/tenant/leases')}`
      : `Handova: the landlord says they didn't receive your ${naira(r.amount_ngn)} cash payment for ${r.place}: "${note}". The Handova team will review your receipt and get back to you.`);
    res.json({ ok: true, payment: view(get(r.id)!, me, notified) });
  });

  /** Admin: disputed cash payments. */
  app.get('/api/cash-payments/disputed', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!(await isArbiter(config, me))) return bad(res, 403, 'Only the Handova admin can do this.', 'not_admin');
    const rows = db().query("SELECT * FROM cash_payments WHERE status = 'disputed' ORDER BY landlord_answered_at ASC").all() as Row[];
    res.json({ ok: true, payments: rows.map(r => view(r, me)) });
  });

  /** Admin: decide a disputed payment after looking at the receipt and both notes. */
  app.post('/api/cash-payments/:id/resolve', express.json(), async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!(await isArbiter(config, me))) return bad(res, 403, 'Only the Handova admin can do this.', 'not_admin');
    const r = get(Number(req.params.id));
    if (!r) return bad(res, 404, 'Payment not found.', 'not_found');
    if (r.status !== 'disputed') return bad(res, 409, 'This payment isn\'t in dispute.', 'wrong_state');
    const paid = req.body?.paid === true;
    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    if (note.length < 5) return bad(res, 400, 'Explain the decision — both people will see it.', 'note');
    db().query('UPDATE cash_payments SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?').run(paid ? 'confirmed' : 'rejected', note, Date.now(), r.id);
    const msg = paid
      ? `Handova: after reviewing the receipt, we've recorded the ${naira(r.amount_ngn)} cash payment for ${r.place} as paid. "${note}"`
      : `Handova: after reviewing, we couldn't confirm the ${naira(r.amount_ngn)} cash payment for ${r.place}. "${note}"`;
    await Promise.all([tell(r.tenant_phone, msg), tell(r.landlord_phone, msg)]);
    res.json({ ok: true, payment: view(get(r.id)!, me) });
  });

  app.use('/api/cash-payments', ((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 10 MB.' : 'Up to 3 files.', 'upload');
    next(err);
  }) as express.ErrorRequestHandler);
}

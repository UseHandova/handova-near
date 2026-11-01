/**
 * Property ownership checks — "is this person allowed to rent out this place?"
 *
 * A landlord uploads proof for a listing (C of O, deed of assignment, Governor's consent, survey plan,
 * allocation letter, or a recent utility bill in their name at that address). The Handova admin (the escrow's
 * arbiter) reviews it and approves or rejects with a reason.
 *
 * Documents are private and short-lived:
 *   - the landlord must consent before uploading (recorded with a timestamp);
 *   - each file is encrypted on disk (AES-256-GCM, key from OWNERSHIP_KEY) and served only to that landlord
 *     and the admin;
 *   - once reviewed, the files are deleted — approved or rejected. We keep only each file's SHA-256 fingerprint and
 *     the decision, so a later dispute can be checked against copies the landlord still holds.
 * Approval is tied to (landlord, normalised street address), so it survives edits that republish the listing,
 * and drops off if the address changes. Tenants only ever see "Ownership checked" and the date.
 */

import type { Express, Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAbi } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import { openFile, sealFile } from './file-crypto';
import type { FeatureConfig } from './features';

const ABI = parseAbi([
  'function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)',
  'function arbiter() view returns (address)',
]);

export const DOC_TYPES: Record<string, string> = {
  c_of_o: 'Certificate of Occupancy (C of O)',
  deed: 'Deed of Assignment',
  governors_consent: "Governor's Consent",
  survey: 'Survey plan',
  allocation: 'Allocation letter / receipt',
  utility_bill: 'Utility bill in your name at this address',
  other: 'Other proof',
};
const FILE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_FILES = 3, MAX_BYTES = 10 * 1024 * 1024;

/** Same rule as src/lib/ownership.ts — keep them identical. */
export const addressKey = (a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface Req {
  id: number; landlord: string; address_key: string; address: string; listing_id: string; doc_type: string; note: string;
  files: string; status: 'pending' | 'approved' | 'rejected'; reason: string; created_at: number; reviewed_at: number | null;
  consent_at: number | null; files_deleted_at: number | null;
}
/** `enc`: encrypted on disk. `sha256`: fingerprint of the original, kept after the file is deleted. */
type StoredFile = { name: string; file: string; mime: string; sha256?: string; size?: number; enc?: boolean };


export function mountOwnership(app: Express, config: FeatureConfig | null, dir = process.env.OWNERSHIP_DIR || 'server/data/ownership') {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  db().exec(`CREATE TABLE IF NOT EXISTS ownership_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    landlord TEXT NOT NULL,
    address_key TEXT NOT NULL,
    address TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    note TEXT NOT NULL,
    files TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS ownership_landlord ON ownership_requests (landlord, address_key);`);
  // Columns added after the first version.
  const cols = new Set((db().query('PRAGMA table_info(ownership_requests)').all() as { name: string }[]).map(c => c.name));
  if (!cols.has('consent_at')) db().exec('ALTER TABLE ownership_requests ADD COLUMN consent_at INTEGER');
  if (!cols.has('files_deleted_at')) db().exec('ALTER TABLE ownership_requests ADD COLUMN files_deleted_at INTEGER');

  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const lower = (a: string) => a.toLowerCase();
  const isAdmin = async (me: string) => {
    if (!config) return false;
    const arbiter = await chainClient.readContract({ address: config.escrow, abi: ABI, functionName: 'arbiter' }).catch(() => null);
    return !!arbiter && lower(arbiter) === lower(me);
  };
  const view = (r: Req, withFiles = false) => ({
    id: r.id, landlord: r.landlord, address: r.address, addressKey: r.address_key, listingId: r.listing_id,
    docType: r.doc_type, docLabel: DOC_TYPES[r.doc_type] ?? r.doc_type, note: r.note, status: r.status, reason: r.reason,
    createdAt: r.created_at, reviewedAt: r.reviewed_at, consentAt: r.consent_at, filesDeletedAt: r.files_deleted_at,
    ...(withFiles && { files: (JSON.parse(r.files) as StoredFile[]).map((f, i) => ({ index: i, name: f.name, mime: f.mime, sha256: f.sha256 ?? null, available: !r.files_deleted_at })) }),
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: MAX_FILES },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in FILE_TYPES),
  });

  /** Public: which (landlord, address) pairs are approved — tenants see a badge, nothing else. */
  app.get('/api/ownership/verified', (_req: Request, res: Response) => {
    const rows = db().query("SELECT landlord, address_key, MAX(reviewed_at) AS at FROM ownership_requests WHERE status = 'approved' GROUP BY landlord, address_key")
      .all() as { landlord: string; address_key: string; at: number }[];
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, verified: rows.map(r => ({ landlord: r.landlord, addressKey: r.address_key, approvedAt: r.at })) });
  });

  /** Landlord: my submissions. */
  app.get('/api/ownership/mine', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT * FROM ownership_requests WHERE landlord = ? ORDER BY created_at DESC LIMIT 100').all(lower(me)) as Req[];
    res.json({ ok: true, requests: rows.map(r => view(r, true)) });
  });

  /** Landlord: submit proof for one of my live listings. */
  app.post('/api/ownership', (req: Request, res: Response, next) => {
    const me = requireSession(req, res); if (!me) return;
    (req as Request & { me?: string }).me = me;
    next();
  }, upload.array('files', MAX_FILES), async (req: Request, res: Response) => {
    const me = (req as Request & { me?: string }).me!;
    if (!config) return bad(res, 503, 'Ownership checks are not configured on the server.', 'unavailable');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const docType = String(req.body?.docType ?? '');
    const note = String(req.body?.note ?? '').trim().slice(0, 500);
    let listingId: bigint;
    try { listingId = BigInt(String(req.body?.listingId)); } catch { return bad(res, 400, 'Invalid listing.'); }
    if (req.body?.consent !== 'yes') return bad(res, 400, 'Please agree to how we handle your documents before sending them.', 'consent');
    if (!(docType in DOC_TYPES)) return bad(res, 400, 'Choose what kind of document this is.', 'doc_type');
    if (!files.length) return bad(res, 400, 'Add at least one photo or PDF of the document.', 'no_files');

    let landlord: string, active: boolean, meta: Record<string, unknown> = {};
    try {
      const [l, , , a, uri] = await chainClient.readContract({ address: config.escrow, abi: ABI, functionName: 'listings', args: [listingId] });
      landlord = l; active = a;
      try { meta = JSON.parse(uri) as Record<string, unknown>; } catch { /* plain text */ }
    } catch { return bad(res, 502, 'Could not check this listing on the blockchain. Please try again in a moment.', 'chain'); }
    if (lower(landlord) !== lower(me)) return bad(res, 403, 'You can only submit documents for your own listings.', 'not_owner');
    if (!active) return bad(res, 404, 'This listing is no longer live.', 'unavailable_listing');
    const address = typeof meta.address === 'string' ? meta.address.trim() : '';
    if (address.length < 6) return bad(res, 400, 'Add the full street address to this listing first, so we can match it to your documents.', 'no_address');
    const key = addressKey(address);
    const existing = db().query("SELECT status FROM ownership_requests WHERE landlord = ? AND address_key = ? AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1")
      .get(lower(me), key) as { status: string } | null;
    if (existing?.status === 'approved') return bad(res, 409, 'Ownership for this address is already checked.', 'already_approved');
    if (existing?.status === 'pending') return bad(res, 409, 'Your documents for this address are already being reviewed.', 'pending');

    const stored: StoredFile[] = files.map(f => {
      const file = `${randomBytes(12).toString('hex')}.bin`;
      writeFileSync(join(root, file), sealFile(f.buffer), { mode: 0o600 });
      return { name: f.originalname.slice(0, 80), file, mime: f.mimetype, sha256: createHash('sha256').update(f.buffer).digest('hex'), size: f.size, enc: true };
    });
    const now = Date.now();
    const id = Number(db().query("INSERT INTO ownership_requests (landlord, address_key, address, listing_id, doc_type, note, files, status, created_at, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(lower(me), key, address, String(listingId), docType, note, JSON.stringify(stored), now, now).lastInsertRowid);
    res.json({ ok: true, request: view(db().query('SELECT * FROM ownership_requests WHERE id = ?').get(id) as Req, true) });
  });

  /** A document file — only for the landlord who sent it and the admin. Never cached. */
  app.get('/api/ownership/:id/file/:index', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const r = db().query('SELECT * FROM ownership_requests WHERE id = ?').get(Number(req.params.id)) as Req | null;
    if (!r || (lower(r.landlord) !== lower(me) && !(await isAdmin(me)))) return bad(res, 404, 'Document not found.', 'not_found');
    const f = (JSON.parse(r.files) as StoredFile[])[Number(req.params.index)];
    if (!f) return bad(res, 404, 'Document not found.', 'not_found');
    if (r.files_deleted_at) return bad(res, 410, 'This document was deleted after review. Only its fingerprint is kept.', 'deleted');
    let body: Buffer;
    try { body = f.enc ? openFile(readFileSync(join(root, f.file))) : readFileSync(join(root, f.file)); }
    catch { return bad(res, 404, 'Document not found.', 'not_found'); }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
    res.send(body);
  });

  /** Admin: the review queue. */
  app.get('/api/ownership/pending', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!(await isAdmin(me))) return bad(res, 403, 'Only the Handova admin can do this.', 'not_admin');
    const rows = db().query("SELECT * FROM ownership_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100").all() as Req[];
    res.json({ ok: true, requests: rows.map(r => view(r, true)) });
  });

  /** Admin: approve, or reject with a reason the landlord sees. */
  app.post('/api/ownership/:id/review', express.json(), async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!(await isAdmin(me))) return bad(res, 403, 'Only the Handova admin can do this.', 'not_admin');
    const r = db().query('SELECT * FROM ownership_requests WHERE id = ?').get(Number(req.params.id)) as Req | null;
    if (!r) return bad(res, 404, 'Request not found.', 'not_found');
    if (r.status !== 'pending') return bad(res, 409, 'This request was already reviewed.', 'already_reviewed');
    const decision = req.body?.decision;
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (decision !== 'approve' && decision !== 'reject') return bad(res, 400, 'Choose approve or reject.');
    if (decision === 'reject' && reason.length < 5) return bad(res, 400, 'Tell the landlord why, so they can fix it.', 'reason');
    // Once reviewed, the papers themselves aren't needed — delete them and keep only fingerprints + the decision.
    for (const f of JSON.parse(r.files) as StoredFile[]) { try { unlinkSync(join(root, f.file)); } catch { /* already gone */ } }
    const now = Date.now();
    db().query('UPDATE ownership_requests SET status = ?, reason = ?, reviewed_at = ?, files_deleted_at = ? WHERE id = ?')
      .run(decision === 'approve' ? 'approved' : 'rejected', reason, now, now, r.id);
    res.json({ ok: true, request: view(db().query('SELECT * FROM ownership_requests WHERE id = ?').get(r.id) as Req) });
  });

  app.use('/api/ownership', ((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 10 MB.' : err.code === 'LIMIT_FILE_COUNT' ? 'Up to 3 files.' : 'Upload failed.', 'upload');
    }
    next(err);
  }) as express.ErrorRequestHandler);
}

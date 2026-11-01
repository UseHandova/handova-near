/**
 * Listing photos and videos.
 *   POST /api/media        multipart field "file" → { url, type }
 *   GET  /api/media/:name  serves the stored file
 *
 * Storage: an S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2…) when MEDIA_S3_BUCKET is set —
 * files are then served from MEDIA_PUBLIC_BASE_URL — otherwise local disk (MEDIA_DIR, default
 * server/uploads) served by GET /api/media/:name. Listings store only the returned URL.
 */

import express, { type Express, type Request, type Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { S3Client } from 'bun';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TYPES: Record<string, { ext: string; kind: 'image' | 'video'; maxBytes: number }> = {
  'image/jpeg': { ext: 'jpg', kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/png': { ext: 'png', kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/webp': { ext: 'webp', kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', kind: 'video', maxBytes: 60 * 1024 * 1024 },
  'video/quicktime': { ext: 'mov', kind: 'video', maxBytes: 60 * 1024 * 1024 },
  'video/webm': { ext: 'webm', kind: 'video', maxBytes: 60 * 1024 * 1024 },
};
const MAX_UPLOADS_PER_HOUR = 60;

const mediaRoot = () => resolve(process.env.MEDIA_DIR || 'server/uploads');

let s3: S3Client | null | undefined;
function bucket(): S3Client | null {
  if (s3 !== undefined) return s3;
  const e = process.env;
  s3 = e.MEDIA_S3_BUCKET && e.MEDIA_S3_ACCESS_KEY_ID && e.MEDIA_S3_SECRET_ACCESS_KEY && e.MEDIA_PUBLIC_BASE_URL
    ? new S3Client({
      bucket: e.MEDIA_S3_BUCKET,
      accessKeyId: e.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: e.MEDIA_S3_SECRET_ACCESS_KEY,
      endpoint: e.MEDIA_S3_ENDPOINT || undefined,   // e.g. https://<account>.r2.cloudflarestorage.com
      region: e.MEDIA_S3_REGION || undefined,
    })
    : null;
  return s3;
}

/** Save a file to the bucket (if configured) or local disk; returns its public URL. */
async function store(buf: Buffer, ext: string, mime: string): Promise<string> {
  const name = `${randomBytes(12).toString('hex')}.${ext}`;
  const b = bucket();
  if (b) {
    await b.write(`listings/${name}`, buf, { type: mime });
    return `${process.env.MEDIA_PUBLIC_BASE_URL!.replace(/\/$/, '')}/listings/${name}`;
  }
  const root = mediaRoot();
  mkdirSync(root, { recursive: true });
  writeFileSync(`${root}/${name}`, buf);
  return `/api/media/${name}`;
}

/**
 * Download a remote file (e.g. a photo a landlord sent on WhatsApp — Twilio media needs basic auth)
 * into the media store. Returns the public URL, or null if the type/size isn't allowed or the fetch fails.
 */
export async function saveRemoteMedia(url: string, auth?: { user: string; pass: string }): Promise<{ url: string; type: 'image' | 'video' } | null> {
  try {
    const res = await fetch(url, {
      headers: auth ? { Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const type = TYPES[mime];
    if (!res.ok || !type) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > type.maxBytes) return null;
    return { url: await store(buf, type.ext, mime), type: type.kind };
  } catch {
    return null;
  }
}

/**
 * Restore media carried over from another server: files in MEDIA_SEED_DIR (default server/seed-media) are copied
 * into the media store if they aren't there yet. Only names we generate (24 hex chars + known extension) are copied.
 */
function seedMedia(root: string) {
  const seed = resolve(process.env.MEDIA_SEED_DIR || 'server/seed-media');
  if (!existsSync(seed)) return;
  let copied = 0;
  for (const name of readdirSync(seed)) {
    if (!/^[a-f0-9]{24}\.(jpg|png|webp|mp4|mov|webm)$/.test(name) || existsSync(`${root}/${name}`)) continue;
    copyFileSync(`${seed}/${name}`, `${root}/${name}`);
    copied++;
  }
  if (copied) console.log(`[Media] Restored ${copied} file(s) from ${seed}`);
}

export function mountMedia(app: Express, dir?: string) {
  const root = dir ? resolve(dir) : mediaRoot();
  mkdirSync(root, { recursive: true });
  if (!dir) seedMedia(root);
  const perIp = new Map<string, { count: number; resetAt: number }>();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in TYPES),
  });

  app.post('/api/media', (req: Request, res: Response, next) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = perIp.get(ip);
    if (entry && entry.resetAt > now && entry.count >= MAX_UPLOADS_PER_HOUR) {
      res.status(429).json({ error: 'Too many uploads. Try again later.' });
      return;
    }
    perIp.set(ip, !entry || entry.resetAt < now ? { count: 1, resetAt: now + 3_600_000 } : { ...entry, count: entry.count + 1 });
    next();
  }, upload.single('file'), (req: Request, res: Response) => {
    const file = req.file;
    const type = file && TYPES[file.mimetype];
    if (!file || !type) {
      res.status(400).json({ error: 'Upload a JPG, PNG or WebP photo, or an MP4, MOV or WebM video.' });
      return;
    }
    if (file.size > type.maxBytes) {
      res.status(413).json({ error: type.kind === 'image' ? 'Photos must be under 10 MB.' : 'Videos must be under 60 MB.' });
      return;
    }
    store(file.buffer, type.ext, file.mimetype)
      .then(url => res.json({ url, type: type.kind }))
      .catch(err => {
        console.error('[Media] Store failed:', err instanceof Error ? err.message : err);
        res.status(502).json({ error: 'Could not save that file. Please try again.' });
      });
  });

  // Only serve names we generated: 24 hex chars + known extension.
  app.get(/^\/api\/media\/([a-f0-9]{24}\.(?:jpg|png|webp|mp4|mov|webm))$/, (req: Request, res: Response) => {
    const name = (req.params as Record<string, string>)[0];
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(name, { root }, err => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // Oversize uploads surface as multer errors.
  app.use('/api/media', ((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : 'Upload failed.' });
      return;
    }
    next(err);
  }) as express.ErrorRequestHandler);
}

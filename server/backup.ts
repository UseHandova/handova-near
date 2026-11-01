/**
 * Backups of everything that isn't onchain: the SQLite database and the identity-check fingerprints.
 *
 *   - A consistent snapshot (SQLite `VACUUM INTO`, safe while the server runs) every day, plus one at startup if
 *     the last is older than a day.
 *   - Encrypted with AES-256-GCM (BACKUP_KEY, else OWNERSHIP_KEY) — backups hold names, phone numbers and chats.
 *   - Kept for 14 days in server/data/backups. If BACKUP_S3_BUCKET is set, each one is also copied off the server
 *     (any S3-compatible bucket, e.g. Cloudflare R2). Local copies protect against mistakes; only the off-site
 *     copy protects against losing the disk.
 *   - Ownership documents are NOT backed up: they're deleted after review, and a backup must not bring them back.
 *
 * CLI:  bun server/backup.ts now                      take a backup immediately
 *       bun server/backup.ts restore <file> <out.db>  decrypt a backup into a database file (stop the server first)
 */

import { Database } from 'bun:sqlite';
import { S3Client } from 'bun';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export const KEEP_DAYS = 14;
const DAY = 86_400_000;
const MAGIC = Buffer.from('HNDVBK1'); // file format marker + version

export interface BackupConfig {
  dbFile: string;
  extraFiles: string[];   // e.g. the identity-check fingerprints
  dir: string;
  key: Buffer;
  bucket: S3Client | null;
}

export function backupConfigFromEnv(env = process.env): BackupConfig | null {
  const keyHex = env.BACKUP_KEY || env.OWNERSHIP_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return null; // no key → no backups (never write them unencrypted)
  const bucket = env.BACKUP_S3_BUCKET
    ? new S3Client({
      bucket: env.BACKUP_S3_BUCKET,
      endpoint: env.BACKUP_S3_ENDPOINT || env.S3_ENDPOINT,
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY,
    })
    : null;
  const dbFile = env.RENTFLOW_DB || env.DRAFTS_DB || 'server/data/rentflow.db';
  return {
    dbFile,
    extraFiles: [env.VERIFICATION_DATA_FILE || 'server/data/verifications.json'],
    dir: env.BACKUP_DIR || join(dirname(dbFile), 'backups'),
    key: Buffer.from(keyHex, 'hex'),
    bucket,
  };
}

/** Bundle: JSON { files: { name: base64 } } → gzip → AES-GCM. Layout: MAGIC ‖ IV(12) ‖ TAG(16) ‖ ciphertext. */
function seal(key: Buffer, files: Record<string, Buffer>): Buffer {
  const plain = gzipSync(Buffer.from(JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('base64')])) })));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function openBackup(key: Buffer, blob: Buffer): Record<string, Buffer> {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Handova backup file.');
  const o = MAGIC.length;
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(o, o + 12));
  d.setAuthTag(blob.subarray(o + 12, o + 28));
  let plain: Buffer;
  try { plain = Buffer.concat([d.update(blob.subarray(o + 28)), d.final()]); } catch { throw new Error('Wrong backup key, or the file is damaged.'); }
  const { files } = JSON.parse(gunzipSync(plain).toString()) as { files: Record<string, string> };
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20261007T231500Z

/** Take one backup now. Returns the local file path. */
export async function backupNow(cfg: BackupConfig, now = new Date()): Promise<string> {
  mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
  const snapshot = join(cfg.dir, `.snapshot-${process.pid}.db`);
  rmSync(snapshot, { force: true });
  const db = new Database(cfg.dbFile, { readonly: true });
  try { db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`); } finally { db.close(); }
  const files: Record<string, Buffer> = { 'rentflow.db': readFileSync(snapshot) };
  unlinkSync(snapshot);
  for (const f of cfg.extraFiles) if (existsSync(f)) files[basename(f)] = readFileSync(f);
  const out = join(cfg.dir, `handova-${stamp(now)}.backup`);
  writeFileSync(out, seal(cfg.key, files), { mode: 0o600 });
  if (cfg.bucket) await cfg.bucket.write(`handova-backups/${basename(out)}`, Bun.file(out));
  prune(cfg, now.getTime());
  return out;
}

/** Delete local backups older than KEEP_DAYS (off-site copies follow the bucket's own lifecycle rules). */
export function prune(cfg: BackupConfig, now = Date.now()) {
  for (const f of listBackups(cfg)) if (now - f.time > KEEP_DAYS * DAY) unlinkSync(f.path);
}

export function listBackups(cfg: BackupConfig) {
  if (!existsSync(cfg.dir)) return [];
  return readdirSync(cfg.dir).filter(f => /^handova-\d{8}T\d{6}Z\.backup$/.test(f))
    .map(f => { const m = f.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)!; return { path: join(cfg.dir, f), time: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) }; })
    .sort((a, b) => b.time - a.time);
}

/** Run inside the API server: back up at startup if the last one is over a day old, then check every hour. */
export function scheduleBackups(cfg: BackupConfig | null, log = console) {
  if (!cfg) { log.warn('[Backup] Off — set BACKUP_KEY (or OWNERSHIP_KEY) to turn on encrypted daily backups.'); return; }
  const run = () => {
    const last = listBackups(cfg)[0];
    if (last && Date.now() - last.time < DAY) return;
    backupNow(cfg).then(p => log.log(`[Backup] Saved ${basename(p)}${cfg.bucket ? ' (and copied off-site)' : ' (local only — set BACKUP_S3_BUCKET for an off-site copy)'}`))
      .catch(e => log.error('[Backup] Failed:', e instanceof Error ? e.message : e));
  };
  run();
  setInterval(run, 3600_000).unref();
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const [cmd, file, out] = process.argv.slice(2);
  const cfg = backupConfigFromEnv();
  if (!cfg) { console.error('Set BACKUP_KEY or OWNERSHIP_KEY (64 hex characters) first.'); process.exit(1); }
  if (cmd === 'now') {
    console.log(`Saved ${await backupNow(cfg)}`);
  } else if (cmd === 'restore' && file && out) {
    const files = openBackup(cfg.key, readFileSync(resolve(file)));
    if (existsSync(out)) { console.error(`${out} already exists — choose a new path so nothing is overwritten.`); process.exit(1); }
    writeFileSync(out, files['rentflow.db']);
    for (const [name, buf] of Object.entries(files)) if (name !== 'rentflow.db') writeFileSync(join(dirname(out), `restored-${name}`), buf);
    console.log(`Restored database to ${out} (${statSync(out).size} bytes). Stop the server, then move it into place.`);
  } else {
    console.log('Usage: bun server/backup.ts now | restore <file.backup> <out.db>');
  }
}

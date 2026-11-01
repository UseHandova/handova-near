/**
 * Shared SQLite database (bun:sqlite) for everything that isn't onchain:
 * WhatsApp drafts, reviews, maintenance requests, boosts, referrals and moderation.
 * File: DRAFTS_DB / RENTFLOW_DB (default server/data/rentflow.db).
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

let shared: Database | null = null;

export function openDb(file = process.env.RENTFLOW_DB || process.env.DRAFTS_DB || 'server/data/rentflow.db'): Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escrow_id TEXT NOT NULL UNIQUE,
      landlord TEXT NOT NULL,
      tenant TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reviews_landlord ON reviews (landlord);
    CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escrow_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      tenant TEXT NOT NULL,
      landlord TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS maintenance_tenant ON maintenance (tenant);
    CREATE INDEX IF NOT EXISTS maintenance_landlord ON maintenance (landlord);
    CREATE TABLE IF NOT EXISTS boosts (
      tx_hash TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      landlord TEXT NOT NULL,
      days INTEGER NOT NULL,
      amount TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS referrals (
      referee TEXT PRIMARY KEY,
      referrer TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hidden_listings (
      listing_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      hidden_by TEXT NOT NULL,
      hidden_at INTEGER NOT NULL
    );`);
  migrateModerationJson(db);
  return db;
}

/** One-time import of the old server/data/moderation.json takedown list. */
function migrateModerationJson(db: Database) {
  const file = process.env.MODERATION_FILE || 'server/data/moderation.json';
  if (!existsSync(file)) return;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as { hiddenListings?: { id: string; reason?: string }[] };
    const q = db.query('INSERT OR IGNORE INTO hidden_listings (listing_id, reason, hidden_by, hidden_at) VALUES (?, ?, ?, ?)');
    for (const h of d.hiddenListings ?? []) q.run(String(h.id), h.reason ?? 'Imported', 'migration', Date.now());
  } catch { /* ignore malformed file */ }
}

/** Process-wide database handle. */
export function db(): Database {
  shared ??= openDb();
  return shared;
}

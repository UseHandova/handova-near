/**
 * WhatsApp listing drafts, persisted in SQLite (the shared app database, see db.ts) so pending claim
 * codes survive server restarts.
 */

import { Database } from 'bun:sqlite';
import { db as sharedDb } from './db';

export interface Draft {
  id: string;
  code: string;          // 6-digit claim code sent to the landlord on WhatsApp
  from: string;          // WhatsApp sender, e.g. whatsapp:+234…
  location: string;
  rooms: number;
  rentNgn: number;
  depositNgn: number;
  description: string;
  amenities: string[];
  mediaUrls: string[];   // Twilio media URLs (need auth — never shown to users)
  media: { type: 'image' | 'video'; url: string }[];  // copies in our media store
  rawMessage: string;
  parsedAt: number;
  status: 'pending' | 'published' | 'rejected';
}

/** Unclaimed drafts stop working after this long. */
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Drafts store on the shared app database (or a separate file, e.g. ':memory:' for tests). */
export function openDrafts(file?: string) {
  const db = file ? new Database(file, { create: true }) : sharedDb();
  db.exec(`CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      parsed_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drafts_code ON drafts (code, status);`);

  const row = (r: { data: string; status: string } | null): Draft | null =>
    r ? { ...(JSON.parse(r.data) as Draft), status: r.status as Draft['status'] } : null;
  const fresh = () => Date.now() - DRAFT_TTL_MS;

  const insertQ = db.query('INSERT INTO drafts (id, code, status, parsed_at, data) VALUES ($id, $code, $status, $parsedAt, $data)');
  const byCodeQ = db.query("SELECT data, status FROM drafts WHERE code = $code AND status = 'pending' AND parsed_at > $since LIMIT 1");
  const byIdQ = db.query('SELECT data, status FROM drafts WHERE id = $id');
  const pendingQ = db.query("SELECT data, status FROM drafts WHERE status = 'pending' AND parsed_at > $since ORDER BY parsed_at DESC LIMIT 200");
  const statusQ = db.query('UPDATE drafts SET status = $status WHERE id = $id');

  return {
    insert(d: Draft) {
      insertQ.run({ $id: d.id, $code: d.code, $status: d.status, $parsedAt: d.parsedAt, $data: JSON.stringify(d) });
    },
    pendingByCode: (code: string) => row(byCodeQ.get({ $code: code, $since: fresh() }) as { data: string; status: string } | null),
    byId: (id: string) => row(byIdQ.get({ $id: id }) as { data: string; status: string } | null),
    listPending: () => (pendingQ.all({ $since: fresh() }) as { data: string; status: string }[]).map(r => row(r)!),
    setStatus(id: string, status: Draft['status']) { statusQ.run({ $id: id, $status: status }); },
    codeInUse: (code: string) => !!byCodeQ.get({ $code: code, $since: fresh() }),
    close: () => db.close(),
  };
}

/**
 * Chat — one conversation per (listing, tenant), between that tenant and the listing's landlord.
 *
 *   tenant opens a chat from a listing ─► conversation (landlord read from the chain)
 *   landlord opens a chat with a tenant ─► only if that tenant has booked an inspection of their home
 *
 * Clients poll for new messages (cheap, works everywhere, no extra service). The first unread message
 * in a burst is also sent on WhatsApp when Twilio can deliver it, so nobody misses a reply.
 */

import type { Express, Request, Response } from 'express';
import { isAddress, parseAbi, type Address } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import type { FeatureConfig } from './features';
import { normalisePhone, type Notifier } from './inspections';

const LISTING_ABI = parseAbi([
  'function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)',
]);

export const MAX_MESSAGE = 2000;
export const RATE_LIMIT = 20;            // messages per sender per minute
const NOTIFY_QUIET_MS = 30 * 60_000;    // at most one WhatsApp nudge per conversation per 30 minutes

interface Conv {
  id: number; listing_id: string; tenant: string; landlord: string; place: string; landlord_phone: string;
  created_at: number; last_message_at: number; tenant_read_at: number; landlord_read_at: number; notified_at: number;
}
interface Msg { id: number; conversation_id: number; sender: string; body: string; created_at: number }

const lower = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ensureChatTables() {
  db().exec(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    landlord TEXT NOT NULL,
    place TEXT NOT NULL,
    landlord_phone TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL DEFAULT 0,
    tenant_read_at INTEGER NOT NULL DEFAULT 0,
    landlord_read_at INTEGER NOT NULL DEFAULT 0,
    notified_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE (listing_id, tenant)
  );
  CREATE INDEX IF NOT EXISTS conversations_tenant ON conversations (tenant);
  CREATE INDEX IF NOT EXISTS conversations_landlord ON conversations (landlord);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, id);`);
}

export function mountChat(app: Express, config: FeatureConfig | null, notify: Notifier = async () => false) {
  ensureChatTables();
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const getConv = (id: number) => db().query('SELECT * FROM conversations WHERE id = ?').get(id) as Conv | null;
  const sent = new Map<string, number[]>(); // sender → recent send times, for the rate limit

  /** Name the tenant gave when booking a visit (the only name we know), else a short address. */
  const tenantName = (c: Conv) => {
    const r = db().query("SELECT tenant_name, tenant_phone FROM inspections WHERE listing_id = ? AND tenant = ? ORDER BY updated_at DESC LIMIT 1")
      .get(c.listing_id, c.tenant) as { tenant_name: string; tenant_phone: string } | null;
    return { name: r?.tenant_name || `Tenant ${short(c.tenant)}`, phone: r?.tenant_phone || '' };
  };
  const hasInspectionsTable = () => !!db().query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inspections'").get();

  const view = (c: Conv, me: string) => {
    const role = lower(c.tenant) === lower(me) ? 'tenant' : 'landlord';
    const readAt = role === 'tenant' ? c.tenant_read_at : c.landlord_read_at;
    const otherReadAt = role === 'tenant' ? c.landlord_read_at : c.tenant_read_at;
    const last = db().query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(c.id) as Msg | null;
    const unread = (db().query('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender != ? AND created_at > ?')
      .get(c.id, lower(me), readAt) as { n: number }).n;
    const t = hasInspectionsTable() ? tenantName(c) : { name: `Tenant ${short(c.tenant)}`, phone: '' };
    return {
      id: c.id, listingId: c.listing_id, role, place: c.place,
      withName: role === 'tenant' ? `Landlord · ${c.place}` : t.name,
      lastMessage: last ? { body: last.body.slice(0, 140), fromMe: lower(last.sender) === lower(me), createdAt: last.created_at } : null,
      unread, otherReadAt, createdAt: c.created_at, lastMessageAt: c.last_message_at,
    };
  };

  /** All my conversations, most recent first, with unread counts. */
  app.get('/api/chat/conversations', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT * FROM conversations WHERE tenant = ? OR landlord = ? ORDER BY MAX(last_message_at, created_at) DESC LIMIT 100')
      .all(lower(me), lower(me)) as Conv[];
    const list = rows.map(c => view(c, me));
    res.json({ ok: true, unread: list.reduce((s, c) => s + c.unread, 0), conversations: list });
  });

  /**
   * Open (or reuse) the conversation for a listing.
   * Tenant: { listingId }. Landlord: { listingId, tenant } — only with someone who booked a visit.
   */
  app.post('/api/chat/conversations', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return bad(res, 503, 'Chat is not configured on the server.', 'unavailable');
    const b = (req.body ?? {}) as Record<string, unknown>;
    let listingId: bigint;
    try { listingId = BigInt(String(b.listingId)); } catch { return bad(res, 400, 'Invalid listing.'); }

    let landlord: Address, active: boolean, meta: Record<string, unknown> = {};
    try {
      const [l, , , a, uri] = await chainClient.readContract({ address: config.escrow, abi: LISTING_ABI, functionName: 'listings', args: [listingId] });
      landlord = l; active = a;
      try { meta = JSON.parse(uri) as Record<string, unknown>; } catch { /* plain-text metadata */ }
    } catch {
      return bad(res, 502, 'Could not check this listing on the blockchain. Please try again in a moment.', 'chain');
    }
    if (landlord === '0x0000000000000000000000000000000000000000') return bad(res, 404, 'This listing does not exist.', 'unavailable_listing');

    const iAmLandlord = lower(landlord) === lower(me);
    let tenant: string;
    if (iAmLandlord) {
      if (typeof b.tenant !== 'string' || !isAddress(b.tenant)) return bad(res, 403, 'This is your own listing. Tenants start chats from your listing.', 'own_listing');
      tenant = lower(b.tenant);
      const booked = hasInspectionsTable() && db().query('SELECT 1 FROM inspections WHERE listing_id = ? AND tenant = ? AND landlord = ? LIMIT 1')
        .get(String(listingId), tenant, lower(me));
      const existing = db().query('SELECT 1 FROM conversations WHERE listing_id = ? AND tenant = ?').get(String(listingId), tenant);
      if (!booked && !existing) return bad(res, 403, 'You can message tenants who have contacted you or booked a visit.', 'no_contact');
    } else {
      tenant = lower(me);
      const existing = db().query('SELECT 1 FROM conversations WHERE listing_id = ? AND tenant = ?').get(String(listingId), tenant);
      if (!active && !existing) return bad(res, 404, 'This listing is no longer available.', 'unavailable_listing');
    }

    const place = (typeof meta.location === 'string' && meta.location.trim().slice(0, 80)) || `Listing #${listingId}`;
    db().query(`INSERT INTO conversations (listing_id, tenant, landlord, place, landlord_phone, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (listing_id, tenant) DO NOTHING`).run(String(listingId), tenant, lower(landlord), place, normalisePhone(meta.phone), Date.now());
    const c = db().query('SELECT * FROM conversations WHERE listing_id = ? AND tenant = ?').get(String(listingId), tenant) as Conv;
    res.json({ ok: true, conversation: view(c, me) });
  });

  const mine = (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return null;
    const c = getConv(Number(req.params.id));
    if (!c || (lower(c.tenant) !== lower(me) && lower(c.landlord) !== lower(me))) { bad(res, 404, 'Conversation not found.', 'not_found'); return null; }
    return { me, c };
  };

  /** Messages after `after` (a message id), oldest first. Reading marks the conversation as read. */
  app.get('/api/chat/conversations/:id/messages', (req: Request, res: Response) => {
    const ctx = mine(req, res); if (!ctx) return;
    const { me, c } = ctx;
    const after = Number(req.query.after) || 0;
    const rows = db().query('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 500').all(c.id, after) as Msg[];
    db().query(`UPDATE conversations SET ${lower(c.tenant) === lower(me) ? 'tenant_read_at' : 'landlord_read_at'} = ? WHERE id = ?`).run(Date.now(), c.id);
    res.json({
      ok: true,
      conversation: view(getConv(c.id)!, me),
      messages: rows.map(m => ({ id: m.id, body: m.body, fromMe: lower(m.sender) === lower(me), createdAt: m.created_at })),
    });
  });

  app.post('/api/chat/conversations/:id/messages', async (req: Request, res: Response) => {
    const ctx = mine(req, res); if (!ctx) return;
    const { me, c } = ctx;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return bad(res, 400, 'Type a message first.', 'empty');
    if (body.length > MAX_MESSAGE) return bad(res, 400, `Messages can be up to ${MAX_MESSAGE} characters.`, 'too_long');
    const now = Date.now();
    const recent = (sent.get(lower(me)) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= RATE_LIMIT) return bad(res, 429, 'You\'re sending messages too quickly. Wait a moment and try again.', 'rate_limited');
    sent.set(lower(me), [...recent, now]);

    const iAmTenant = lower(c.tenant) === lower(me);
    const id = Number(db().query('INSERT INTO messages (conversation_id, sender, body, created_at) VALUES (?, ?, ?, ?)').run(c.id, lower(me), body, now).lastInsertRowid);
    db().query(`UPDATE conversations SET last_message_at = ?, ${iAmTenant ? 'tenant_read_at' : 'landlord_read_at'} = ? WHERE id = ?`).run(now, now, c.id);

    // Nudge the other person on WhatsApp if they haven't read the chat and we haven't nudged recently.
    let notified = false;
    const otherRead = iAmTenant ? c.landlord_read_at : c.tenant_read_at;
    if (now - c.notified_at > NOTIFY_QUIET_MS && otherRead < now - 60_000) {
      const phone = iAmTenant ? c.landlord_phone : (hasInspectionsTable() ? tenantName(c).phone : '');
      if (phone) {
        const who = iAmTenant ? (hasInspectionsTable() ? tenantName(c).name : 'A tenant') : `The landlord in ${c.place}`;
        const link = (process.env.APP_URL || '').replace(/\/$/, '');
        notified = await notify(phone, `💬 Handova: ${who} sent you a message about ${c.place}:\n"${body.slice(0, 200)}"${link ? `\n\nReply in Handova: ${link}/${iAmTenant ? 'landlord' : 'tenant'}?chat=${c.id}` : '\n\nReply in the Handova app.'}`).catch(() => false);
        if (notified) db().query('UPDATE conversations SET notified_at = ? WHERE id = ?').run(now, c.id);
      }
    }
    res.json({ ok: true, notified, message: { id, body, fromMe: true, createdAt: now } });
  });
}

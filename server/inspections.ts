/**
 * Inspections — the step between "we agreed on WhatsApp" and "I pay into escrow".
 *
 *   tenant requests a time ──► landlord approves / suggests another time / declines
 *        ▲                          │ (suggested → tenant accepts or picks again)
 *        └── declined / missed ◄────┤
 *                                   ▼
 *                 approved ──► after the visit both say "it happened" ──► completed ──► tenant can pay
 *
 * Who is the landlord comes from the chain (the listing's owner), never from the request.
 * If the tenant confirms the visit and the landlord says nothing for 24 hours, the tenant may still pay:
 * the money waits in escrow until move-in, so an unresponsive landlord can't block a tenant forever.
 */

import type { Express, Request, Response } from 'express';
import { parseAbi, type Address } from 'viem';
import { db } from './db';
import { chainClient, requireSession } from './auth';
import type { FeatureConfig } from './features';

const LISTING_ABI = parseAbi([
  'function listings(uint256) view returns (address landlord, uint256 rentAmountUsdc, uint256 depositAmountUsdc, bool active, string metadataUri)',
]);

export const MIN_LEAD_MS = 30 * 60_000;              // book at least 30 minutes ahead
export const MAX_AHEAD_MS = 30 * 24 * 3600_000;      // and at most 30 days ahead
export const OUTCOME_OPENS_MS = 15 * 60_000;         // "did it happen?" opens 15 minutes before the slot
export const LANDLORD_GRACE_MS = 24 * 3600_000;      // landlord silence after the visit → tenant may proceed

export type Status = 'requested' | 'rescheduled' | 'approved' | 'declined' | 'cancelled' | 'missed' | 'completed';
const OPEN: Status[] = ['requested', 'rescheduled', 'approved'];

/** Sends a WhatsApp message; resolves true only if it actually went out. */
export type Notifier = (phone: string, text: string) => Promise<boolean>;

interface Row {
  id: number; listing_id: string; tenant: string; landlord: string; place: string; status: Status;
  slot_at: number; tenant_name: string; tenant_phone: string; landlord_phone: string; note: string; landlord_note: string;
  tenant_confirmed_at: number | null; landlord_confirmed_at: number | null; missed_by: string; created_at: number; updated_at: number;
  payment_method: 'escrow' | 'cash';
  /** 'remote' when the tenant chose a video inspection; 'in_person' (default) for a physical visit. */
  inspection_mode: 'in_person' | 'remote';
  /** USDC amount the tenant locks in escrow for the caretaker (remote only). Stored as a float string e.g. "5.00". */
  remote_fee_usdc: string;
  /** Address of the caretaker who will run the video inspection. */
  caretaker_address: string;
  /** Video call URL provided by the landlord (e.g. a Google Meet link). */
  video_link: string;
  /** When the tenant confirmed the video call happened. */
  tenant_call_confirmed_at: number | null;
  /** When the caretaker/landlord confirmed the video call happened. */
  landlord_call_confirmed_at: number | null;
  /** When the caretaker fee was released (remote only). */
  fee_released_at: number | null;
}

const lower = (a: string) => a.toLowerCase();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Nigerian numbers to 234XXXXXXXXXX; anything else that looks international is kept as digits. */
export function normalisePhone(raw: unknown): string {
  const d = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  if (/^0[789]\d{9}$/.test(d)) return `234${d.slice(1)}`;
  if (/^[789]\d{9}$/.test(d)) return `234${d}`;
  if (/^\d{10,15}$/.test(d)) return d;
  return '';
}

/** "Tue 7 Oct, 10:00 am" in Lagos time, for messages. */
export const lagosTime = (ms: number) => new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(ms);

export function ensureInspectionsTable() {
  db().exec(`CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    landlord TEXT NOT NULL,
    place TEXT NOT NULL,
    status TEXT NOT NULL,
    slot_at INTEGER NOT NULL,
    tenant_name TEXT NOT NULL,
    tenant_phone TEXT NOT NULL,
    landlord_phone TEXT NOT NULL,
    note TEXT NOT NULL,
    landlord_note TEXT NOT NULL DEFAULT '',
    tenant_confirmed_at INTEGER,
    landlord_confirmed_at INTEGER,
    missed_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inspections_tenant ON inspections (tenant);
  CREATE INDEX IF NOT EXISTS inspections_landlord ON inspections (landlord);`);
  // Added later: how the landlord wants the first payment (escrow unless they choose cash).
  const cols = new Set((db().query('PRAGMA table_info(inspections)').all() as { name: string }[]).map(c => c.name));
  if (!cols.has('payment_method')) db().exec("ALTER TABLE inspections ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'escrow'");
  // Remote inspection columns (added in v2).
  if (!cols.has('inspection_mode')) db().exec("ALTER TABLE inspections ADD COLUMN inspection_mode TEXT NOT NULL DEFAULT 'in_person'");
  if (!cols.has('remote_fee_usdc')) db().exec("ALTER TABLE inspections ADD COLUMN remote_fee_usdc TEXT NOT NULL DEFAULT '0'");
  if (!cols.has('caretaker_address')) db().exec("ALTER TABLE inspections ADD COLUMN caretaker_address TEXT NOT NULL DEFAULT ''");
  if (!cols.has('video_link')) db().exec("ALTER TABLE inspections ADD COLUMN video_link TEXT NOT NULL DEFAULT ''");
  if (!cols.has('tenant_call_confirmed_at')) db().exec("ALTER TABLE inspections ADD COLUMN tenant_call_confirmed_at INTEGER");
  if (!cols.has('landlord_call_confirmed_at')) db().exec("ALTER TABLE inspections ADD COLUMN landlord_call_confirmed_at INTEGER");
  if (!cols.has('fee_released_at')) db().exec("ALTER TABLE inspections ADD COLUMN fee_released_at INTEGER");
}

/** Tenant may pay: both confirmed, or tenant confirmed and the landlord stayed silent past the grace period. */
export function canPay(r: Pick<Row, 'status' | 'slot_at' | 'tenant_confirmed_at' | 'landlord_confirmed_at'>, now = Date.now()) {
  if (r.status === 'completed') return true;
  return r.status === 'approved' && !!r.tenant_confirmed_at && !r.landlord_confirmed_at && now >= r.slot_at + LANDLORD_GRACE_MS;
}

export function mountInspections(app: Express, config: FeatureConfig | null, notify: Notifier = async () => false) {
  ensureInspectionsTable();
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const get = (id: number) => db().query('SELECT * FROM inspections WHERE id = ?').get(id) as Row | null;

  const view = (r: Row, me: string, notified?: boolean) => {
    const role = lower(r.tenant) === lower(me) ? 'tenant' : 'landlord';
    return {
      id: r.id, listingId: r.listing_id, role, tenant: r.tenant, place: r.place, status: r.status, slotAt: r.slot_at,
      tenantName: r.tenant_name, tenantPhone: r.tenant_phone, landlordPhone: r.landlord_phone,
      note: r.note, landlordNote: r.landlord_note,
      tenantConfirmedAt: r.tenant_confirmed_at, landlordConfirmedAt: r.landlord_confirmed_at,
      missedBy: r.missed_by || null, canPay: canPay(r), paymentMethod: r.payment_method ?? 'escrow',
      // Remote inspection fields
      inspectionMode: (r.inspection_mode ?? 'in_person') as 'in_person' | 'remote',
      remoteFeeUsdc: r.remote_fee_usdc ?? '0',
      caretakerAddress: r.caretaker_address ?? '',
      videoLink: r.video_link ?? '',
      tenantCallConfirmedAt: r.tenant_call_confirmed_at ?? null,
      landlordCallConfirmedAt: r.landlord_call_confirmed_at ?? null,
      feeReleasedAt: r.fee_released_at ?? null,
      createdAt: r.created_at, updatedAt: r.updated_at,
      ...(notified !== undefined && { notified }),
    };
  };

  const slotProblem = (slot: number, now = Date.now()) => {
    if (!Number.isFinite(slot)) return 'Pick a day and time for the inspection.';
    if (slot < now + MIN_LEAD_MS) return 'Pick a time at least 30 minutes from now.';
    if (slot > now + MAX_AHEAD_MS) return 'Pick a time within the next 30 days.';
    return null;
  };

  const save = (id: number, fields: Partial<Row>) => {
    const keys = Object.keys(fields);
    db().query(`UPDATE inspections SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...(keys.map(k => (fields as Record<string, string | number | null>)[k])), Date.now(), id);
    return get(id)!;
  };

  const tell = (phone: string, text: string) => (phone ? notify(phone, text).catch(() => false) : Promise.resolve(false));
  const appLink = (process.env.APP_URL || '').replace(/\/$/, '');
  const open = (path: string) => (appLink ? `\n\nOpen Handova: ${appLink}${path}` : '\n\nOpen Handova to respond.');

  /** Everything the signed-in person is part of, newest activity first. */
  app.get('/api/inspections', (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const rows = db().query('SELECT * FROM inspections WHERE tenant = ? OR landlord = ? ORDER BY updated_at DESC LIMIT 200')
      .all(lower(me), lower(me)) as Row[];
    res.json({ ok: true, inspections: rows.map(r => view(r, me)) });
  });

  /** Tenant asks for a time. */
  app.post('/api/inspections', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    if (!config) return bad(res, 503, 'Inspections are not configured on the server.', 'unavailable');
    const b = (req.body ?? {}) as Record<string, unknown>;
    let listingId: bigint;
    try { listingId = BigInt(String(b.listingId)); } catch { return bad(res, 400, 'Invalid listing.'); }
    const slot = Number(b.slotAt);
    const name = str(b.name, 60);
    const phone = normalisePhone(b.phone);
    const problem = slotProblem(slot);
    if (problem) return bad(res, 400, problem, 'bad_time');
    if (name.length < 2) return bad(res, 400, 'Add your name so the landlord knows who is coming.', 'name');
    if (!phone) return bad(res, 400, 'Add a phone number the landlord can reach you on, e.g. 0803 123 4567.', 'phone');

    let landlord: Address, active: boolean, meta: Record<string, unknown> = {};
    try {
      const [l, , , a, uri] = await chainClient.readContract({ address: config.escrow, abi: LISTING_ABI, functionName: 'listings', args: [listingId] });
      landlord = l; active = a;
      try { meta = JSON.parse(uri) as Record<string, unknown>; } catch { /* plain-text metadata */ }
    } catch {
      return bad(res, 502, 'Could not check this listing on the blockchain. Please try again in a moment.', 'chain');
    }
    if (landlord === '0x0000000000000000000000000000000000000000' || !active) return bad(res, 404, 'This listing is no longer available.', 'unavailable_listing');
    if (lower(landlord) === lower(me)) return bad(res, 403, 'This is your own listing.', 'own_listing');

    const existing = db().query(`SELECT * FROM inspections WHERE listing_id = ? AND tenant = ? AND status IN ('requested','rescheduled','approved') LIMIT 1`)
      .get(String(listingId), lower(me)) as Row | null;
    if (existing) return res.status(409).json({ ok: false, code: 'already_booked', error: 'You already have an inspection for this home.', inspection: view(existing, me) });

    const place = str(meta.location, 80) || str(meta.address, 80) || `Listing #${listingId}`;
    const landlordPhone = normalisePhone(meta.phone);
    const now = Date.now();

    // Remote inspection fields
    const mode = b.inspectionMode === 'remote' ? 'remote' : 'in_person';
    const rawFee = mode === 'remote' ? parseFloat(String(b.remoteFeeUsdc ?? '0')) : 0;
    const remoteFeeUsdc = (isFinite(rawFee) && rawFee >= 0 && rawFee <= 50 ? rawFee : 0).toFixed(2);

    const id = Number(db().query(`INSERT INTO inspections (listing_id, tenant, landlord, place, status, slot_at, tenant_name, tenant_phone, landlord_phone, note, inspection_mode, remote_fee_usdc, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(listingId), lower(me), lower(landlord), place, slot, name, phone, landlordPhone, str(b.note, 300), mode, remoteFeeUsdc, now, now).lastInsertRowid);

    const modeLabel = mode === 'remote' ? ' (remote video inspection)' : '';
    const notified = await tell(landlordPhone,
      `🏠 Handova: ${name} wants to inspect your property in ${place} on ${lagosTime(slot)}${modeLabel}.${b.note ? `\nNote: "${str(b.note, 300)}"` : ''}\nApprove, suggest another time or decline in the app.${open('/landlord')}`);
    res.json({ ok: true, inspection: view(get(id)!, me, notified) });
  });

  /**
   * Every change after the request. Landlord: approve | propose | decline | happened | missed.
   * Tenant: accept | reschedule | cancel | happened | missed.
   */
  app.post('/api/inspections/:id/:action', async (req: Request, res: Response) => {
    const me = requireSession(req, res); if (!me) return;
    const r = get(Number(req.params.id));
    if (!r || (lower(r.tenant) !== lower(me) && lower(r.landlord) !== lower(me))) return bad(res, 404, 'Inspection not found.', 'not_found');
    const isTenant = lower(r.tenant) === lower(me);
    const action = String(req.params.action);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const note = str(b.note, 300);
    const now = Date.now();
    const wrongState = (msg: string) => bad(res, 409, msg, 'wrong_state');
    const landlordOnly = ['approve', 'propose', 'decline', 'payment', 'set_video'], tenantOnly = ['accept', 'reschedule', 'cancel'];
    if (landlordOnly.includes(action) && isTenant) return bad(res, 403, 'Only the landlord can do this.', 'not_landlord');
    if (tenantOnly.includes(action) && !isTenant) return bad(res, 403, 'Only the tenant can do this.', 'not_tenant');

    let next: Row, notified = false;
    switch (action) {
      case 'approve':
        if (r.status !== 'requested') return wrongState(r.status === 'rescheduled' ? 'You suggested another time — waiting for the tenant to accept it.' : 'This request is no longer waiting for you.');
        if (r.slot_at < now) return wrongState('This time has already passed. Suggest a new time instead.');
        next = save(r.id, { status: 'approved', landlord_note: note });
        notified = await tell(r.tenant_phone, `✅ Handova: your inspection in ${r.place} is confirmed for ${lagosTime(r.slot_at)}.${note ? `\nLandlord: "${note}"` : ''}${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      case 'propose': {
        if (!['requested', 'rescheduled', 'approved'].includes(r.status)) return wrongState('This inspection is closed. The tenant can book a new one.');
        const slot = Number(b.slotAt);
        const problem = slotProblem(slot, now);
        if (problem) return bad(res, 400, problem, 'bad_time');
        next = save(r.id, { status: 'rescheduled', slot_at: slot, landlord_note: note, tenant_confirmed_at: null, landlord_confirmed_at: null });
        notified = await tell(r.tenant_phone, `🕑 Handova: the landlord in ${r.place} suggested ${lagosTime(slot)} for your inspection.${note ? `\n"${note}"` : ''}\nAccept it or pick another time in the app.${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      }
      case 'decline':
        if (!['requested', 'rescheduled', 'approved'].includes(r.status)) return wrongState('This inspection is already closed.');
        next = save(r.id, { status: 'declined', landlord_note: note });
        notified = await tell(r.tenant_phone, `Handova: the landlord in ${r.place} can't do the inspection${note ? `: "${note}"` : '.'} You can pick another time in the app.${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      case 'accept':
        if (r.status !== 'rescheduled') return wrongState('There is no suggested time to accept.');
        if (r.slot_at < now) return wrongState('That suggested time has passed. Pick a new time.');
        next = save(r.id, { status: 'approved' });
        notified = await tell(r.landlord_phone, `✅ Handova: ${r.tenant_name} accepted ${lagosTime(r.slot_at)} for the inspection in ${r.place}.${open('/landlord')}`);
        break;
      case 'reschedule': {
        if (!OPEN.includes(r.status)) return wrongState('This inspection is closed. Book a new one.');
        const slot = Number(b.slotAt);
        const problem = slotProblem(slot, now);
        if (problem) return bad(res, 400, problem, 'bad_time');
        next = save(r.id, { status: 'requested', slot_at: slot, note: note || r.note, tenant_confirmed_at: null, landlord_confirmed_at: null });
        notified = await tell(r.landlord_phone, `🕑 Handova: ${r.tenant_name} asked to move the inspection in ${r.place} to ${lagosTime(slot)}. Approve or suggest another time in the app.${open('/landlord')}`);
        break;
      }
      case 'cancel':
        if (!OPEN.includes(r.status)) return wrongState('This inspection is already closed.');
        next = save(r.id, { status: 'cancelled' });
        notified = await tell(r.landlord_phone, `Handova: ${r.tenant_name} cancelled the inspection in ${r.place} (${lagosTime(r.slot_at)}).`);
        break;
      case 'happened': {
        if (r.status !== 'approved') return wrongState(r.status === 'completed' ? 'You both already confirmed this inspection.' : 'Only a confirmed inspection can be marked as done.');
        if (now < r.slot_at - OUTCOME_OPENS_MS) return wrongState(`You can confirm after the visit (${lagosTime(r.slot_at)}).`);
        const fields: Partial<Row> = isTenant ? { tenant_confirmed_at: now } : { landlord_confirmed_at: now };
        const both = (isTenant ? r.landlord_confirmed_at : r.tenant_confirmed_at) !== null;
        if (both) fields.status = 'completed';
        next = save(r.id, fields);
        if (both) notified = await tell(isTenant ? r.landlord_phone : r.tenant_phone, isTenant
          ? `Handova: ${r.tenant_name} confirmed the inspection in ${r.place}. If they decide to rent, their payment goes into escrow and you'll be notified.`
          : `✅ Handova: the landlord confirmed your inspection in ${r.place}. When you're ready, review the details and pay into escrow in the app.${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      }
      case 'missed':
        if (r.status !== 'approved') return wrongState('Only a confirmed inspection can be marked as missed.');
        if (now < r.slot_at - OUTCOME_OPENS_MS) return wrongState('You can only report this after the planned time.');
        next = save(r.id, { status: 'missed', missed_by: isTenant ? 'tenant' : 'landlord' });
        notified = await tell(isTenant ? r.landlord_phone : r.tenant_phone,
          `Handova: the inspection in ${r.place} (${lagosTime(r.slot_at)}) was marked as not having happened. ${isTenant ? 'The tenant may book a new time.' : 'You can book a new time in the app.'}`);
        break;
      case 'payment': {
        // The landlord chooses how this tenant pays: through escrow (protected) or in cash.
        const method = b.method;
        if (method !== 'escrow' && method !== 'cash') return bad(res, 400, 'Choose escrow or cash.');
        if (!['approved', 'completed'].includes(r.status)) return wrongState('You can choose how they pay once the visit is confirmed.');
        const cashStarted = (() => {
          try { return !!db().query("SELECT 1 FROM cash_payments WHERE inspection_id = ? AND status IN ('awaiting_landlord','confirmed','disputed') LIMIT 1").get(r.id); }
          catch { return false; }
        })();
        if (cashStarted) return wrongState('The tenant has already sent a cash receipt, so the payment method can\'t change now.');
        next = save(r.id, { payment_method: method });
        notified = await tell(r.tenant_phone, method === 'cash'
          ? `Handova: the landlord in ${r.place} would like to be paid in cash. After you pay, upload the receipt in the app so they can confirm it.${open(`/tenant?visit=${r.listing_id}`)}`
          : `Handova: the landlord in ${r.place} wants the payment through Handova escrow. Your money stays protected until you move in.${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      }
      case 'set_video': {
        // Landlord sets (or updates) the video call link and optional caretaker address for a remote inspection.
        if (r.inspection_mode !== 'remote') return bad(res, 400, 'This inspection is not a remote inspection.', 'not_remote');
        if (!['requested', 'rescheduled', 'approved'].includes(r.status)) return wrongState('The inspection must be open to set a video link.');
        const link = str(b.videoLink, 500);
        if (!link.startsWith('http')) return bad(res, 400, 'Provide a valid video call URL (must start with http).', 'bad_link');
        const caretaker = str(b.caretakerAddress, 100);
        next = save(r.id, { video_link: link, caretaker_address: caretaker });
        notified = await tell(r.tenant_phone,
          `📹 Handova: the landlord for ${r.place} has set up your remote inspection.\nVideo link: ${link}\n${caretaker ? `Caretaker: ${caretaker}` : ''}${open(`/tenant?visit=${r.listing_id}`)}`);
        break;
      }
      case 'call_confirmed': {
        // Either side confirms the video call happened.
        if (r.inspection_mode !== 'remote') return bad(res, 400, 'This inspection is not a remote inspection.', 'not_remote');
        if (r.status !== 'approved') return wrongState('The inspection must be approved before confirming the call.');
        const fields: Partial<Row> = isTenant
          ? { tenant_call_confirmed_at: now }
          : { landlord_call_confirmed_at: now };
        const bothCallConfirmed = isTenant ? !!r.landlord_call_confirmed_at : !!r.tenant_call_confirmed_at;
        if (bothCallConfirmed) {
          // Both confirmed — mark as completed (fee release happens outside this server in a contract call).
          fields.status = 'completed';
          fields.fee_released_at = now;
        }
        next = save(r.id, fields);
        if (bothCallConfirmed) {
          notified = await tell(isTenant ? r.landlord_phone : r.tenant_phone, isTenant
            ? `✅ Handova: ${r.tenant_name} confirmed the video inspection for ${r.place}. The caretaker fee will be released. They can now proceed to pay.`
            : `✅ Handova: the landlord confirmed your video inspection for ${r.place}. You can now review and pay into escrow.${open(`/tenant?visit=${r.listing_id}`)}`);
        }
        break;
      }
      default:
        return bad(res, 404, 'Unknown action.', 'unknown_action');
    }
    res.json({ ok: true, inspection: view(next, me, notified) });
  });
}

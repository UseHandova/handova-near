/**
 * Viewings: the tenant sees the home and both sides agree before any money moves (as in the Arc product).
 *
 *   tenant asks for a time ──► landlord approves / suggests another time / declines
 *        ▲                          │ (suggested → tenant accepts or picks again)
 *        └── declined / missed ◄────┤
 *                                   ▼
 *       approved ──► after the visit both say "we viewed it and agree to the listed terms" ──► agreed ──► tenant can pay
 *
 * Who the landlord is comes from the chain (the listing's owner), never from the request. If the tenant
 * agrees and the landlord says nothing for 24 hours after the visit, the tenant may still pay: the money
 * waits in escrow until move-in, so a silent landlord can't block a tenant forever.
 *
 * This is a rule of Handova's app and server. The escrow contract doesn't check it, so a tenant using
 * the contract directly can still pay; enforcing it on-chain is a later contract change.
 */
import type { Express } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deploy, env } from './config';
import { view } from './chain';
import { requireAccount } from './auth';
import { RateLimit } from './rate-limit';

const MIN = 60_000;
export const RULES = {
  /** Book at least this far ahead (tests set 0). */
  minLeadMs: Number(env('VIEWING_MIN_LEAD_MIN') ?? 30) * MIN,
  maxAheadMs: 30 * 24 * 60 * MIN,
  /** "We viewed it and agree" opens this long before the slot. */
  opensBeforeMs: Number(env('VIEWING_OPENS_BEFORE_MIN') ?? 15) * MIN,
  /** Tenant agreed, landlord silent this long after the slot → the tenant may pay. */
  landlordGraceMs: 24 * 60 * MIN,
  /** An agreement lets the tenant pay for this long. */
  validMs: 30 * 24 * 60 * MIN,
};

export type Status = 'requested' | 'rescheduled' | 'approved' | 'declined' | 'cancelled' | 'missed' | 'agreed';
const OPEN: Status[] = ['requested', 'rescheduled', 'approved'];

export interface Viewing {
  id: number;
  listingId: number;
  tenant: string;
  landlord: string;
  status: Status;
  slotAt: number;
  tenantName: string;
  tenantPhone: string;
  landlordPhone: string;
  note: string;
  landlordNote: string;
  tenantAgreedAt: number | null;
  landlordAgreedAt: number | null;
  missedBy: '' | 'tenant' | 'landlord';
  createdAt: number;
  updatedAt: number;
}

/** The tenant may pay: both agreed, or the tenant agreed and the landlord stayed silent past the grace period. */
export function canPay(v: Pick<Viewing, 'status' | 'slotAt' | 'tenantAgreedAt' | 'landlordAgreedAt' | 'updatedAt'>, now = Date.now()): boolean {
  if (v.status === 'agreed') return now < v.updatedAt + RULES.validMs;
  return v.status === 'approved' && !!v.tenantAgreedAt && !v.landlordAgreedAt && now >= v.slotAt + RULES.landlordGraceMs;
}

export function slotProblem(slot: number, now = Date.now()): string | null {
  if (!Number.isFinite(slot)) return 'Pick a day and time for the viewing.';
  if (slot < now + RULES.minLeadMs - MIN) return RULES.minLeadMs ? `Pick a time at least ${RULES.minLeadMs / MIN} minutes from now.` : 'Pick a time from now on.';
  if (slot > now + RULES.maxAheadMs) return 'Pick a time within the next 30 days.';
  return null;
}

/** Nigerian numbers to 234XXXXXXXXXX; other international numbers are kept as digits. */
export function normalisePhone(raw: unknown): string {
  const d = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  if (/^0[789]\d{9}$/.test(d)) return `234${d.slice(1)}`;
  if (/^[789]\d{9}$/.test(d)) return `234${d}`;
  if (/^\d{10,15}$/.test(d)) return d;
  return '';
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function mountViewings(app: Express) {
  const dataFile = env('VIEWING_DATA_FILE') ?? 'server/data/viewings.json';
  const load = (): Viewing[] => {
    try { return JSON.parse(readFileSync(dataFile, 'utf8')); } catch { return []; }
  };
  const store = (all: Viewing[]) => {
    if (!existsSync(dirname(dataFile))) mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(all), { mode: 0o600 });
  };
  const perAccount = new RateLimit(30, 60 * MIN);

  /** What either side sees. Phone numbers only go to the two people in the viewing. */
  const forViewer = (v: Viewing) => ({ ...v, canPay: canPay(v) });
  /** What anyone may know: whether this tenant may pay for this home. */
  const publicView = (v: Viewing) => ({ id: v.id, listingId: v.listingId, tenant: v.tenant, status: v.status, slotAt: v.slotAt, tenantAgreed: !!v.tenantAgreedAt, landlordAgreed: !!v.landlordAgreedAt, canPay: canPay(v) });
  const latest = (all: Viewing[], listingId: number, tenant: string) =>
    all.filter((v) => v.listingId === listingId && v.tenant === tenant).sort((a, b) => b.updatedAt - a.updatedAt)[0];

  /** Public: may this tenant pay for this home yet? (Used by the pay button, also when family pays.) */
  app.get('/api/viewings/status', (req, res) => {
    const listingId = Number(req.query.listingId);
    const tenant = String(req.query.tenant ?? '');
    const v = Number.isInteger(listingId) && tenant ? latest(load(), listingId, tenant) : undefined;
    res.json({ rules: RULES, viewing: v ? publicView(v) : null, canPay: !!v && canPay(v) });
  });

  /** Every viewing the signed-in person is part of, newest activity first. */
  app.get('/api/viewings', (req, res) => {
    const me = requireAccount(req, res);
    if (!me) return;
    const listingId = req.query.listingId === undefined ? null : Number(req.query.listingId);
    const mine = load()
      .filter((v) => (v.tenant === me || v.landlord === me) && (listingId === null || v.listingId === listingId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200);
    res.json({ rules: RULES, viewings: mine.map(forViewer) });
  });

  /** Tenant asks for a time. */
  app.post('/api/viewings', async (req, res) => {
    const me = requireAccount(req, res);
    if (!me) return;
    if (!perAccount.take(me)) return res.status(429).json({ error: 'Too many changes. Try again in an hour.' });
    const b = req.body ?? {};
    const listingId = Number(b.listingId);
    const slotAt = Number(b.slotAt);
    const tenantName = str(b.name, 60);
    const tenantPhone = normalisePhone(b.phone);
    const problem = slotProblem(slotAt);
    if (!Number.isInteger(listingId)) return res.status(400).json({ error: 'Unknown home.' });
    if (problem) return res.status(400).json({ error: problem });
    if (tenantName.length < 2) return res.status(400).json({ error: 'Add your name so the landlord knows who is coming.' });
    if (!tenantPhone) return res.status(400).json({ error: 'Add a phone number the landlord can reach you on, e.g. 0803 123 4567.' });

    const listing: any = await view(deploy.escrow, 'get_listing', { listing_id: listingId }).catch(() => undefined);
    if (listing === undefined) return res.status(502).json({ error: 'Could not check this home on NEAR. Try again in a moment.' });
    if (!listing || !listing.available || listing.active_lease !== null) return res.status(404).json({ error: 'This home is not open for viewings right now.' });
    if (listing.landlord === me) return res.status(403).json({ error: 'This is your own home.' });

    const all = load();
    const existing = latest(all, listingId, me);
    if (existing && OPEN.includes(existing.status)) return res.status(409).json({ error: 'You already have a viewing for this home.', viewing: forViewer(existing) });
    if (existing && canPay(existing)) return res.status(409).json({ error: 'You have already viewed this home and agreed. You can pay now.', viewing: forViewer(existing) });

    const now = Date.now();
    const v: Viewing = {
      id: all.reduce((m, x) => Math.max(m, x.id), 0) + 1,
      listingId, tenant: me, landlord: listing.landlord, status: 'requested', slotAt, tenantName, tenantPhone,
      landlordPhone: '', note: str(b.note, 300), landlordNote: '', tenantAgreedAt: null, landlordAgreedAt: null, missedBy: '',
      createdAt: now, updatedAt: now,
    };
    all.push(v);
    store(all);
    res.json({ viewing: forViewer(v) });
  });

  /**
   * Every change after the request. Landlord: approve | propose | decline. Tenant: accept | reschedule |
   * cancel. Either: agree (we viewed it and agree to the listed terms) | missed (it didn't happen).
   */
  app.post('/api/viewings/:id/:action', (req, res) => {
    const me = requireAccount(req, res);
    if (!me) return;
    if (!perAccount.take(me)) return res.status(429).json({ error: 'Too many changes. Try again in an hour.' });
    const all = load();
    const v = all.find((x) => x.id === Number(req.params.id));
    if (!v || (v.tenant !== me && v.landlord !== me)) return res.status(404).json({ error: 'Viewing not found.' });
    const isTenant = v.tenant === me;
    const action = String(req.params.action);
    const b = req.body ?? {};
    const note = str(b.note, 300);
    const now = Date.now();
    const wrong = (error: string) => res.status(409).json({ error, viewing: forViewer(v) });
    if (['approve', 'propose', 'decline'].includes(action) && isTenant) return res.status(403).json({ error: 'Only the landlord can do this.' });
    if (['accept', 'reschedule', 'cancel'].includes(action) && !isTenant) return res.status(403).json({ error: 'Only the tenant can do this.' });

    switch (action) {
      case 'approve': {
        if (v.status !== 'requested') return wrong(v.status === 'rescheduled' ? 'You suggested another time. Waiting for the tenant to accept it.' : 'This request is no longer waiting for you.');
        if (v.slotAt < now - RULES.opensBeforeMs) return wrong('This time has already passed. Suggest a new time instead.');
        const phone = b.phone === undefined || b.phone === '' ? '' : normalisePhone(b.phone);
        if (b.phone && !phone) return res.status(400).json({ error: 'That phone number looks wrong, e.g. 0803 123 4567.' });
        Object.assign(v, { status: 'approved', landlordNote: note, landlordPhone: phone });
        break;
      }
      case 'propose':
      case 'reschedule': {
        if (!OPEN.includes(v.status)) return wrong(isTenant ? 'This viewing is closed. Book a new one.' : 'This viewing is closed. The tenant can book a new one.');
        const slotAt = Number(b.slotAt);
        const problem = slotProblem(slotAt, now);
        if (problem) return res.status(400).json({ error: problem });
        Object.assign(v, isTenant
          ? { status: 'requested', slotAt, note: note || v.note, tenantAgreedAt: null, landlordAgreedAt: null }
          : { status: 'rescheduled', slotAt, landlordNote: note, tenantAgreedAt: null, landlordAgreedAt: null });
        break;
      }
      case 'decline':
        if (!OPEN.includes(v.status)) return wrong('This viewing is already closed.');
        Object.assign(v, { status: 'declined', landlordNote: note });
        break;
      case 'accept':
        if (v.status !== 'rescheduled') return wrong('There is no suggested time to accept.');
        if (v.slotAt < now - RULES.opensBeforeMs) return wrong('That suggested time has passed. Pick a new time.');
        v.status = 'approved';
        break;
      case 'cancel':
        if (!OPEN.includes(v.status)) return wrong('This viewing is already closed.');
        v.status = 'cancelled';
        break;
      case 'agree': {
        if (v.status !== 'approved') return wrong(v.status === 'agreed' ? 'You both already agreed.' : 'Only a confirmed viewing can be agreed.');
        if (now < v.slotAt - RULES.opensBeforeMs) return wrong('You can agree after the viewing.');
        if (isTenant) v.tenantAgreedAt = now;
        else v.landlordAgreedAt = now;
        if (v.tenantAgreedAt && v.landlordAgreedAt) v.status = 'agreed';
        break;
      }
      case 'missed':
        if (v.status !== 'approved') return wrong('Only a confirmed viewing can be marked as not happening.');
        if (now < v.slotAt - RULES.opensBeforeMs) return wrong('You can only report this after the planned time. To call it off, cancel or decline instead.');
        Object.assign(v, { status: 'missed', missedBy: isTenant ? 'tenant' : 'landlord' });
        break;
      default:
        return res.status(404).json({ error: 'Unknown action.' });
    }
    v.updatedAt = now;
    store(all);
    res.json({ viewing: forViewer(v) });
  });
}

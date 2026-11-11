/** Viewings before paying, and the one signature that proves who you are to Handova's server. */
import { useEffect, useState } from 'react';
import { API_BASE, api } from './api';
import type { Session } from './session';

export type ViewingStatus = 'requested' | 'rescheduled' | 'approved' | 'declined' | 'cancelled' | 'missed' | 'agreed';

export interface Viewing {
  id: number;
  listingId: number;
  tenant: string;
  landlord: string;
  status: ViewingStatus;
  slotAt: number;
  tenantName: string;
  tenantPhone: string;
  landlordPhone: string;
  note: string;
  landlordNote: string;
  tenantAgreedAt: number | null;
  landlordAgreedAt: number | null;
  missedBy: '' | 'tenant' | 'landlord';
  canPay: boolean;
  updatedAt: number;
}

export interface ViewingRules { minLeadMs: number; opensBeforeMs: number; landlordGraceMs: number }
export interface ViewingStatusReply {
  rules: ViewingRules;
  canPay: boolean;
  viewing: (Pick<Viewing, 'id' | 'listingId' | 'tenant' | 'status' | 'slotAt' | 'canPay'> & { tenantAgreed: boolean; landlordAgreed: boolean }) | null;
}

const tokenKey = (accountId: string) => `handova:auth:${accountId}`;
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function token(session: Session, fresh = false): Promise<string> {
  if (!fresh) {
    try { const t = localStorage.getItem(tokenKey(session.accountId)); if (t) return t; } catch { /* private mode */ }
  }
  const c = await api<{ nonce: string; message: string; recipient: string }>(`/api/auth/challenge?accountId=${encodeURIComponent(session.accountId)}`);
  const signed = await session.signMessage(c.message, fromBase64(c.nonce), c.recipient);
  const { token: t } = await api<{ token: string }>('/api/auth/session', { accountId: session.accountId, nonce: c.nonce, signature: signed.signature, publicKey: signed.publicKey });
  try { localStorage.setItem(tokenKey(session.accountId), t); } catch { /* asked again next time */ }
  return t;
}

/** A call as the signed-in person; signs once (silently for device and passkey accounts) and again if the token expired. */
export async function authed<T = any>(session: Session, path: string, body?: unknown): Promise<T> {
  for (const fresh of [false, true]) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Handova ${await token(session, fresh)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.code === 'auth' && !fresh) continue;
    if (!r.ok) throw Object.assign(new Error(j.error ?? `Something went wrong (${r.status}). Try again.`), { viewing: j.viewing });
    return j as T;
  }
  throw new Error('Please confirm it is you, then try again.');
}

export const viewingStatus = (listingId: number, tenant: string) =>
  api<ViewingStatusReply>(`/api/viewings/status?listingId=${listingId}&tenant=${encodeURIComponent(tenant)}`);

/** "Tue 7 Oct, 10:00 am" in Lagos time. */
export const lagosTime = (ms: number) => new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(ms);

/** A value for <input type="datetime-local"> in this device's time zone. */
export const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/** The first half hour that respects the lead time. */
export const firstSlot = (minLeadMs: number, now = Date.now()) => Math.ceil((now + minLeadMs) / 1_800_000) * 1_800_000;

/** How many people have a viewing booked per home; fetched at most every 15 s, shared by every card. */
let counts: Record<string, number> = {};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
function refreshCounts() {
  if (inflight || Date.now() - fetchedAt < 15_000) return;
  inflight = api<{ counts: Record<string, number> }>('/api/viewings/counts')
    .then((r) => { counts = r.counts; fetchedAt = Date.now(); listeners.forEach((f) => f()); })
    .catch(() => {})
    .finally(() => { inflight = null; });
}
export function useViewingCount(listingId: number): number {
  const [n, setN] = useState(counts[listingId] ?? 0);
  useEffect(() => {
    const f = () => setN(counts[listingId] ?? 0);
    listeners.add(f);
    f();
    refreshCounts();
    return () => { listeners.delete(f); };
  }, [listingId]);
  return n;
}
/** Call after booking so the count on this device updates at once. */
export function invalidateViewingCounts() { fetchedAt = 0; refreshCounts(); }

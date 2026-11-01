/**
 * Inspections client: types, Lagos-time slot helpers and the shared query.
 * Server rules live in server/inspections.ts; times are always shown in Lagos time (WAT, UTC+1, no DST).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SmartAccount } from 'viem/account-abstraction';
import { api, hasSession } from '@/lib/api';

export type InspectionStatus = 'requested' | 'rescheduled' | 'approved' | 'declined' | 'cancelled' | 'missed' | 'completed';

export interface Inspection {
  id: number;
  listingId: string;
  role: 'tenant' | 'landlord';
  tenant: string;
  place: string;
  status: InspectionStatus;
  slotAt: number;
  tenantName: string;
  tenantPhone: string;
  landlordPhone: string;
  note: string;
  landlordNote: string;
  tenantConfirmedAt: number | null;
  landlordConfirmedAt: number | null;
  missedBy: 'tenant' | 'landlord' | null;
  canPay: boolean;
  /** How the landlord wants the first payment. */
  paymentMethod: 'escrow' | 'cash';
  /** Whether this is a physical or remote video inspection. */
  inspectionMode: 'in_person' | 'remote';
  /** USDC fee for the caretaker (remote only). */
  remoteFeeUsdc: string;
  /** Caretaker name/address shown to the tenant. */
  caretakerAddress: string;
  /** Video call URL set by the landlord. */
  videoLink: string;
  /** When tenant confirmed the video call happened. */
  tenantCallConfirmedAt: number | null;
  /** When landlord/caretaker confirmed the video call happened. */
  landlordCallConfirmedAt: number | null;
  /** When the caretaker fee was released. */
  feeReleasedAt: number | null;
  createdAt: number;
  updatedAt: number;
  notified?: boolean;
}

export const OPEN_STATUSES: InspectionStatus[] = ['requested', 'rescheduled', 'approved'];
export const OUTCOME_OPENS_MS = 15 * 60_000;
export const MIN_LEAD_MS = 30 * 60_000;

const WAT = 3600_000;
/** Lagos wall-clock time → unix ms. */
export const lagosMs = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m, d, h, min) - WAT;
const lagosDate = (ms: number) => new Date(ms + WAT); // read with getUTC*

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', ...opts });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });

/** "Today, 10:00 am" / "Tomorrow, 2:00 pm" / "Thu 9 Oct, 11:00 am" */
export function formatSlot(ms: number, now = Date.now()) {
  const day = Math.floor((ms + WAT) / 86_400_000) - Math.floor((now + WAT) / 86_400_000);
  const d = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : day === -1 ? 'Yesterday' : dayFmt.format(ms);
  return `${d}, ${timeFmt.format(ms)}`;
}

export interface Day { key: string; label: string; sub: string; y: number; m: number; d: number }

/** The next `count` days in Lagos, starting today. */
export function nextDays(count = 14, now = Date.now()): Day[] {
  const out: Day[] = [];
  for (let i = 0; i < count; i++) {
    const t = lagosDate(now + i * 86_400_000);
    const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
    const noon = lagosMs(y, m, d, 12);
    out.push({
      key: `${y}-${m + 1}-${d}`, y, m, d,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmt({ weekday: 'short' }).format(noon),
      sub: fmt({ day: 'numeric', month: 'short' }).format(noon),
    });
  }
  return out;
}

/** Visiting hours offered: 8 am to 6 pm, on the hour. */
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
export const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

/** Google Calendar "add event" link for a one-hour visit. */
export function calendarLink(title: string, ms: number, details: string) {
  const z = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${z(ms)}/${z(ms + 3600_000)}`, details, ctz: 'Africa/Lagos' });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/**
 * Tenant ↔ landlord WhatsApp chat buttons. Off for now: every conversation happens in Handova's in-app chat, so both
 * sides (and, in a dispute, the record) see the same thing. Set to true to bring the WhatsApp buttons back if we need
 * them while investigating an issue.
 */
export const WHATSAPP_CHAT = false;

export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** 2348031234567 → 0803 123 4567 */
export const prettyPhone = (p: string) => (/^234\d{10}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p ? `+${p}` : '');

/** Tenant's details from their last booking, so they don't type them again. */
const CONTACT_KEY = 'handova_visit_contact';
export function savedContact(): { name: string; phone: string } {
  try { return { name: '', phone: '', ...(JSON.parse(localStorage.getItem(CONTACT_KEY) ?? '{}') as object) }; } catch { return { name: '', phone: '' }; }
}
export function saveContact(c: { name: string; phone: string }) {
  try { localStorage.setItem(CONTACT_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

/**
 * Inspections for the signed-in account. Loads by itself only when a session already exists (no surprise
 * passkey prompt on page load); `connect()` signs in on a tap.
 */
export function useInspections(account: SmartAccount) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(() => hasSession(account.address));
  const key = ['inspections', account.address.toLowerCase()];
  const query = useQuery({
    queryKey: key,
    enabled: connected,
    queryFn: () => api<{ inspections: Inspection[] }>(account, '/api/inspections').then(r => r.inspections),
    refetchInterval: 30_000,
    retry: false,
  });
  const set = (i: Inspection) => qc.setQueryData<Inspection[]>(key, old => [i, ...(old ?? []).filter(x => x.id !== i.id)]);
  return {
    ...query,
    inspections: query.data ?? [],
    connected,
    connect: () => setConnected(true),
    /** Run an action (approve, accept, happened…) and update the cache with the result. */
    act: async (id: number, action: string, body: Record<string, unknown> = {}) => {
      const r = await api<{ inspection: Inspection }>(account, `/api/inspections/${id}/${action}`, { body });
      set(r.inspection);
      setConnected(true);
      return r.inspection;
    },
    book: async (body: Record<string, unknown>) => {
      const r = await api<{ inspection: Inspection }>(account, '/api/inspections', { body });
      set(r.inspection);
      setConnected(true);
      return r.inspection;
    },
    refresh: () => qc.invalidateQueries({ queryKey: key }),
  };
}

/** The tenant's current inspection for a listing: the open one, else the most recent. */
export function inspectionFor(list: Inspection[], listingId: bigint | string) {
  const mine = list.filter(i => i.role === 'tenant' && i.listingId === String(listingId));
  return mine.find(i => OPEN_STATUSES.includes(i.status) || i.canPay) ?? mine[0];
}

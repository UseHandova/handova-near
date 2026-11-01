/**
 * Cash payments (client). Server: server/cash.ts.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SmartAccount } from 'viem/account-abstraction';
import { api, getSession, hasSession, publicApi } from '@/lib/api';

export interface CashPayment {
  id: number; inspectionId: number; listingId: string; place: string; role: 'tenant' | 'landlord' | 'admin';
  tenantName: string; amountNgn: number; paidOn: string; note: string;
  status: 'awaiting_landlord' | 'confirmed' | 'disputed' | 'rejected';
  landlordNote: string; adminNote: string; createdAt: number; landlordAnsweredAt: number | null; resolvedAt: number | null;
  coversUntil: number; files: { index: number; name: string; mime: string; sha256: string }[]; notified?: boolean;
}

export const cashKey = (address: string) => ['cash', address.toLowerCase()];

/** My cash payments. Loads by itself only with an existing session (no surprise passkey prompt). */
export function useCashPayments(account: SmartAccount) {
  const [connected, setConnected] = useState(() => hasSession(account.address));
  const q = useQuery({
    queryKey: cashKey(account.address),
    enabled: connected,
    queryFn: () => api<{ payments: CashPayment[] }>(account, '/api/cash-payments').then(r => r.payments),
    refetchInterval: 30_000,
    retry: false,
  });
  return { ...q, payments: q.data ?? [], connected, connect: () => setConnected(true) };
}

/** Listings currently rented for cash — hidden from browsing. Public. */
export function useRentedForCash() {
  const q = useQuery({
    queryKey: ['cash-rented'],
    queryFn: () => publicApi<{ listingIds: string[] }>('/api/cash-payments/rented').then(r => new Set(r.listingIds)),
    staleTime: 60_000,
  });
  return q.data ?? new Set<string>();
}

export async function sendCashReceipt(account: SmartAccount, fields: { inspectionId: number; amountNgn: number; paidOn: string; note: string }, files: File[]) {
  const form = new FormData();
  form.append('inspectionId', String(fields.inspectionId));
  form.append('amountNgn', String(fields.amountNgn));
  form.append('paidOn', fields.paidOn);
  form.append('note', fields.note);
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/cash-payments', { method: 'POST', headers: { Authorization: `Bearer ${await getSession(account)}` }, body: form });
  const out = await res.json().catch(() => ({})) as { payment?: CashPayment; error?: string };
  if (!res.ok || !out.payment) throw new Error(out.error ?? 'Could not send your receipt. Please try again.');
  return out.payment;
}

/** Open a receipt in a new tab (fetched with the session — there's no public link). */
export async function openReceipt(account: SmartAccount, id: number, index: number) {
  const tab = window.open('', '_blank');
  const res = await fetch(`/api/cash-payments/${id}/receipt/${index}`, { headers: { Authorization: `Bearer ${await getSession(account)}` } });
  if (!res.ok) { tab?.close(); throw new Error('Could not open the receipt.'); }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url; else window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
export const fmtNgn = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

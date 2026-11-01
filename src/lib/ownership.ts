/**
 * Property ownership checks (client). Server: server/ownership.ts.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { SmartAccount } from 'viem/account-abstraction';
import { api, getSession, hasSession, publicApi } from '@/lib/api';

/** Same rule as server/ownership.ts — keep them identical. */
export const addressKey = (a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const DOC_TYPES: { id: string; label: string; hint: string }[] = [
  { id: 'c_of_o', label: 'C of O', hint: 'Certificate of Occupancy' },
  { id: 'deed', label: 'Deed of Assignment', hint: 'Signed and stamped' },
  { id: 'governors_consent', label: "Governor's Consent", hint: '' },
  { id: 'survey', label: 'Survey plan', hint: '' },
  { id: 'allocation', label: 'Allocation letter', hint: 'Or purchase receipt from the developer' },
  { id: 'utility_bill', label: 'Utility bill', hint: 'Recent, in your name, at this address' },
  { id: 'other', label: 'Other', hint: 'Explain in the note' },
];

export interface OwnershipRequest {
  id: number; landlord: string; address: string; addressKey: string; listingId: string;
  docType: string; docLabel: string; note: string; status: 'pending' | 'approved' | 'rejected'; reason: string;
  createdAt: number; reviewedAt: number | null; consentAt: number | null; filesDeletedAt: number | null;
  files?: { index: number; name: string; mime: string; sha256: string | null; available: boolean }[];
}

/** Public: approved (landlord, address) pairs → approval time. */
export function useOwnershipVerified() {
  const q = useQuery({
    queryKey: ['ownership-verified'],
    queryFn: () => publicApi<{ verified: { landlord: string; addressKey: string; approvedAt: number }[] }>('/api/ownership/verified'),
    staleTime: 60_000,
  });
  // Stable between renders (only changes when the list does), so it's safe in useMemo/useEffect deps.
  return useMemo(() => {
    const map = new Map((q.data?.verified ?? []).map(v => [`${v.landlord}|${v.addressKey}`, v.approvedAt]));
    return (landlord?: string, address?: string) => (landlord && address ? map.get(`${landlord.toLowerCase()}|${addressKey(address)}`) ?? 0 : 0);
  }, [q.data]);
}

/** Landlord: my submissions (loads by itself only with an existing session). */
export function useMyOwnership(account: SmartAccount) {
  const [connected, setConnected] = useState(() => hasSession(account.address));
  const q = useQuery({
    queryKey: ['ownership-mine', account.address.toLowerCase()],
    enabled: connected,
    queryFn: () => api<{ requests: OwnershipRequest[] }>(account, '/api/ownership/mine').then(r => r.requests),
    retry: false,
  });
  /** Latest request for this address. */
  const forAddress = (address?: string) => (address ? (q.data ?? []).find(r => r.addressKey === addressKey(address)) : undefined);
  return { ...q, connected, connect: () => setConnected(true), forAddress };
}

export async function submitOwnership(account: SmartAccount, fields: { listingId: string; docType: string; note: string }, files: File[]) {
  const form = new FormData();
  form.append('listingId', fields.listingId);
  form.append('docType', fields.docType);
  form.append('note', fields.note);
  form.append('consent', 'yes'); // only called after the landlord ticks the consent box
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/ownership', { method: 'POST', headers: { Authorization: `Bearer ${await getSession(account)}` }, body: form });
  const out = await res.json().catch(() => ({})) as { request?: OwnershipRequest; error?: string };
  if (!res.ok || !out.request) throw new Error(out.error ?? 'Could not upload your documents. Please try again.');
  return out.request;
}

/** Open a private document in a new tab (fetched with the session, never via a public URL). */
export async function openOwnershipFile(account: SmartAccount, id: number, index: number) {
  const tab = window.open('', '_blank');
  const res = await fetch(`/api/ownership/${id}/file/${index}`, { headers: { Authorization: `Bearer ${await getSession(account)}` } });
  if (!res.ok) { tab?.close(); throw new Error('Could not open that document.'); }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url; else window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

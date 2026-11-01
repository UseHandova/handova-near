/**
 * Chat client: types, the shared conversations query, and openChat() — any screen can open a conversation
 * (the ChatCenter in the header listens and shows it).
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SmartAccount } from 'viem/account-abstraction';
import { api, hasSession } from '@/lib/api';

export interface Conversation {
  id: number;
  listingId: string;
  role: 'tenant' | 'landlord';
  place: string;
  withName: string;
  lastMessage: { body: string; fromMe: boolean; createdAt: number } | null;
  unread: number;
  otherReadAt: number;
  createdAt: number;
  lastMessageAt: number;
}

export interface Message { id: number; body: string; fromMe: boolean; createdAt: number }

export type ChatTarget = { conversationId: number } | { listingId: string; tenant?: string };
const EVENT = 'handova:open-chat';

/** Open the chat panel on a conversation (existing id, or the one for a listing — created if needed). */
export function openChat(target: ChatTarget) {
  window.dispatchEvent(new CustomEvent<ChatTarget>(EVENT, { detail: target }));
}
export function onOpenChat(fn: (t: ChatTarget) => void) {
  const h = (e: Event) => fn((e as CustomEvent<ChatTarget>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Conversations + total unread. Loads by itself only when a session exists (no surprise passkey prompt). */
export function useConversations(account: SmartAccount, fast = false) {
  const [connected, setConnected] = useState(() => hasSession(account.address));
  const query = useQuery({
    queryKey: ['chat', account.address.toLowerCase()],
    enabled: connected,
    queryFn: () => api<{ unread: number; conversations: Conversation[] }>(account, '/api/chat/conversations'),
    refetchInterval: fast ? 5_000 : 20_000,
    retry: false,
  });
  return { ...query, connected, connect: () => setConnected(true), conversations: query.data?.conversations ?? [], unread: query.data?.unread ?? 0 };
}

/**
 * Messages that look like the classic rental scam: bank details or "pay first" before an inspection.
 * Shown as a gentle warning under the message — never blocked, since people do discuss money.
 */
export function scamHint(body: string): string | null {
  const t = body.toLowerCase();
  const account = /\b\d{10}\b/.test(t.replace(/[\s-]/g, ' ')) && /(acc|account|acct|bank|opay|palmpay|moniepoint|kuda|gtb|access|zenith|uba|first ?bank|wema|sterling|fidelity)/.test(t);
  const payFirst = /(inspection fee|viewing fee|form fee|pay (before|first|to (view|inspect|see))|send (the )?money|transfer (the )?(money|deposit|rent)|deposit to (hold|secure|reserve))/.test(t);
  if (account) return 'This message has bank details. On Handova, rent is paid into escrow, never to a personal account.';
  if (payFirst) return 'Never pay to view a property. Inspections are free, and rent goes into escrow only after you\'ve inspected.';
  return null;
}

/** "10:42 am" today, "Yesterday", or "7 Oct". */
export function shortTime(ms: number, now = Date.now()) {
  const day = (t: number) => Math.floor((t + 3600_000) / 86_400_000);
  const d = day(now) - day(ms);
  if (d === 0) return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }).format(ms);
  if (d === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }).format(ms);
}

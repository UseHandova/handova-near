/**
 * ChatCenter — the chat button in the header (with unread badge) and the chat panel.
 * Inbox → conversation. Other screens open a conversation with openChat() from '@/lib/chat'.
 * New messages arrive by polling (every 4s while a conversation is open).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarCheck, Check, CheckCheck, Loader2, MessageCircle, Send, ShieldCheck, X } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { onOpenChat, scamHint, shortTime, useConversations, type Conversation, type Message } from '@/lib/chat';

const errorText = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel/i.test(msg)) return 'Sign-in was cancelled. Tap again and approve with your passkey.';
  if (/signMessage is not a function/.test(msg)) return 'Sign in with your passkey to use chat.';
  return msg;
};

const lagosDay = (ms: number) => Math.floor((ms + 3600_000) / 86_400_000);

const TENANT_STARTERS = ['Hello, is this place still available?', 'Can I come for an inspection this week?', 'Is the rent negotiable?'];
const LANDLORD_STARTERS = ['Hello! Yes, it\'s still available.', 'When would you like to come and see it?'];

export default function ChatCenter({ account }: { account: SmartAccount }) {
  // ?chat=<id> (from a WhatsApp nudge) opens that conversation.
  const [linked] = useState(() => Number(new URLSearchParams(window.location.search).get('chat')) || null);
  const [open, setOpen] = useState(!!linked);
  const [activeId, setActiveId] = useState<number | null>(linked);
  const [opening, setOpening] = useState(false);
  const convs = useConversations(account, open);
  const { connect, refetch } = convs;

  useEffect(() => {
    if (!linked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('chat');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [linked]);

  useEffect(() => onOpenChat(t => {
    setOpen(true);
    connect();
    if ('conversationId' in t) { setActiveId(t.conversationId); return; }
    setActiveId(null);
    setOpening(true);
    api<{ conversation: Conversation }>(account, '/api/chat/conversations', { body: t })
      .then(r => { setActiveId(r.conversation.id); void refetch(); })
      .catch(e => { toast.error(errorText(e)); })
      .finally(() => setOpening(false));
  }), [account, connect, refetch]);

  const active = convs.conversations.find(c => c.id === activeId);

  return (
    <>
      <button onClick={() => { setOpen(true); setActiveId(null); }} aria-label={convs.unread ? `Messages, ${convs.unread} unread` : 'Messages'}
        className="relative w-10 h-10 rounded-2xl flex items-center justify-center"
        style={{ background: open ? 'var(--accent-soft)' : 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <MessageCircle className="w-[18px] h-[18px]" style={{ color: 'var(--ink)' }} />
        {convs.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: 'var(--danger)' }}>
            {convs.unread > 9 ? '9+' : convs.unread}
          </span>
        )}
      </button>

      {/* Portal: the header's backdrop blur would otherwise trap this fixed panel inside it. */}
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setOpen(false)}>
            <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              role="dialog" aria-modal="true" aria-label="Messages"
              className="w-full sm:max-w-md h-dvh flex flex-col" style={{ background: 'var(--popover)', borderLeft: '1px solid var(--border)' }}
              onClick={e => e.stopPropagation()}>
              {opening ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} />
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>Opening chat…</p>
                </div>
              ) : activeId ? (
                <Thread key={activeId} account={account} id={activeId} initial={active} onBack={() => { setActiveId(null); void refetch(); }} onClose={() => setOpen(false)} />
              ) : (
                <Inbox convs={convs} onPick={setActiveId} onClose={() => setOpen(false)} />
              )}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </>
  );
}

function Inbox({ convs, onPick, onClose }: { convs: ReturnType<typeof useConversations>; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <p className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Messages</p>
        <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
          <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!convs.connected ? (
          <Empty title="Your messages are private" body="Sign in once with your passkey to see your chats with landlords and tenants.">
            <button onClick={convs.connect} className="mt-4 h-11 px-6 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>Show my messages</button>
          </Empty>
        ) : convs.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
        ) : convs.isError ? (
          <Empty title="Couldn't load messages" body={errorText(convs.error)}>
            <button onClick={() => { void convs.refetch(); }} className="mt-4 h-10 px-5 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>Try again</button>
          </Empty>
        ) : convs.conversations.length === 0 ? (
          <Empty title="No messages yet" body="Tenants: tap “Chat” on any home to message its landlord. Landlords: tenants' messages show up here." />
        ) : (
          <ul>
            {convs.conversations.map(c => (
              <li key={c.id}>
                <button onClick={() => onPick(c.id)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {c.role === 'tenant' ? c.place.slice(0, 2).toUpperCase() : c.withName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm truncate" style={{ color: 'var(--ink)', fontWeight: c.unread ? 700 : 600 }}>{c.withName}</span>
                      {c.lastMessage && <span className="text-[11px] shrink-0" style={{ color: c.unread ? 'var(--accent)' : 'var(--subtle)' }}>{shortTime(c.lastMessage.createdAt)}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate" style={{ color: c.unread ? 'var(--ink)' : 'var(--muted)' }}>
                        {c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.body}` : c.role === 'landlord' ? `About ${c.place}` : 'Say hello 👋'}
                      </span>
                      {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: 'var(--accent)' }}>{c.unread}</span>}
                    </span>
                    {c.role === 'landlord' && <span className="block text-[11px]" style={{ color: 'var(--subtle)' }}>{c.place}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-16">
      <MessageCircle className="w-9 h-9 mb-3" style={{ color: 'var(--subtle)' }} />
      <p className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{body}</p>
      {children}
    </div>
  );
}

function Thread({ account, id, initial, onBack, onClose }: { account: SmartAccount; id: number; initial?: Conversation; onBack: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [meta, setMeta] = useState<Conversation | undefined>(initial);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Poll for new messages while the conversation is open.
  useEffect(() => {
    let stop = false, after = 0;
    const tick = async () => {
      try {
        const r = await api<{ conversation: Conversation; messages: Message[] }>(account, `/api/chat/conversations/${id}/messages?after=${after}`);
        if (stop) return;
        if (r.messages.length) {
          after = r.messages[r.messages.length - 1].id;
          setMsgs(m => [...m, ...r.messages.filter(x => !m.some(y => y.id === x.id))]);
        }
        setMeta(r.conversation);
        setError(null);
      } catch (e) {
        if (!stop) setError(errorText(e));
      } finally {
        if (!stop) setLoaded(true);
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 4000);
    return () => { stop = true; clearInterval(timer); };
  }, [account, id]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);

  async function send(body = text) {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const r = await api<{ message: Message }>(account, `/api/chat/conversations/${id}/messages`, { body: { body: trimmed } });
      setMsgs(m => (m.some(x => x.id === r.message.id) ? m : [...m, r.message]));
      setText('');
      void qc.invalidateQueries({ queryKey: ['chat', account.address.toLowerCase()] });
      input.current?.focus();
    } catch (e) {
      toast.error(errorText(e));
    } finally { setSending(false); }
  }

  const lastMine = [...msgs].reverse().find(m => m.fromMe);
  const seen = !!lastMine && !!meta && meta.otherReadAt >= lastMine.createdAt;
  const starters = meta?.role === 'landlord' ? LANDLORD_STARTERS : TENANT_STARTERS;

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <button onClick={onBack} aria-label="Back to messages" className="w-9 h-9 rounded-full flex items-center justify-center"><ArrowLeft className="w-5 h-5" style={{ color: 'var(--ink)' }} /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{meta?.withName ?? 'Chat'}</p>
          <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{meta ? (meta.role === 'tenant' ? 'Usually replies within a day' : `About ${meta.place}`) : ' '}</p>
        </div>
        {meta?.role === 'tenant' && (
          <button onClick={() => { onClose(); navigate(`/tenant?visit=${meta.listingId}`); }} className="h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <CalendarCheck className="w-3.5 h-3.5" /> Book a visit
          </button>
        )}
        <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center"><X className="w-4 h-4" style={{ color: 'var(--ink)' }} /></button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        <p className="mx-auto max-w-xs text-center text-[11px] leading-relaxed px-3 py-2 rounded-xl flex items-start gap-1.5" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" style={{ color: 'var(--accent)' }} />
          <span>Never pay before you inspect. On Handova, rent goes into escrow, not to anyone's account.</span>
        </p>
        {!loaded ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
        ) : msgs.length === 0 && !error ? (
          <div className="pt-6 space-y-2">
            <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>{meta?.role === 'landlord' ? 'Say hello to the tenant.' : 'Start the conversation — tap one or write your own.'}</p>
            <div className="flex flex-col items-center gap-2 pt-2">
              {starters.map(s => (
                <button key={s} onClick={() => { void send(s); }} disabled={sending} className="px-4 py-2 rounded-full text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--surface-muted)' }}>{s}</button>
              ))}
            </div>
          </div>
        ) : msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || lagosDay(prev.createdAt) !== lagosDay(m.createdAt);
          const hint = !m.fromMe ? scamHint(m.body) : null;
          return (
            <div key={m.id}>
              {newDay && <p className="text-center text-[11px] py-2" style={{ color: 'var(--subtle)' }}>{shortTime(m.createdAt).includes(':') ? 'Today' : shortTime(m.createdAt)}</p>}
              <div className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words"
                  style={m.fromMe ? { background: 'var(--accent)', color: 'white', borderBottomRightRadius: 6 } : { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)', borderBottomLeftRadius: 6 }}>
                  {m.body}
                  <span className="block text-[10px] text-right mt-0.5" style={{ opacity: 0.7 }}>
                    {new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }).format(m.createdAt)}
                  </span>
                </div>
              </div>
              {hint && (
                <p className="mt-1 max-w-[85%] text-[11px] flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(212,160,23,0.12)', color: 'var(--ink)' }} role="note">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" style={{ color: '#d4a017' }} /> {hint}
                </p>
              )}
              {m.id === lastMine?.id && (
                <p className="text-[10px] text-right mt-0.5 flex items-center justify-end gap-1" style={{ color: 'var(--subtle)' }}>
                  {seen ? <><CheckCheck className="w-3 h-3" style={{ color: 'var(--accent)' }} /> Seen</> : <><Check className="w-3 h-3" /> Sent</>}
                </p>
              )}
            </div>
          );
        })}
        {error && <p className="text-xs text-center py-2" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex items-end gap-2 px-3 py-3 border-t pb-safe" style={{ borderColor: 'var(--border)' }}>
        <textarea ref={input} value={text} rows={1} maxLength={2000} placeholder="Write a message…" aria-label="Message"
          onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          className="flex-1 resize-none px-4 py-2.5 rounded-2xl text-sm outline-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', maxHeight: 120 }} />
        <button type="submit" disabled={!text.trim() || sending} aria-label="Send" className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: 'var(--accent)' }}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
        </button>
      </form>
    </>
  );
}

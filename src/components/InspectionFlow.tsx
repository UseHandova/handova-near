/**
 * InspectionFlow — the tenant's path from "I like this home" to "my rent is in escrow".
 *
 *   1. Chat     agree with the landlord in Handova's chat (optional — skip if already agreed)
 *   2. Book     pick a time; the landlord approves, suggests another time, or declines
 *   3. Inspect  visit; afterwards both sides confirm it happened
 *   4. Pay      review what you're paying for, then pay into escrow
 *
 * State lives on the server (server/inspections.ts), so it survives reloads and both sides see the same thing.
 * Payment unlocks only when the server says so (both confirmed, or the landlord stayed silent 24h after the visit).
 */

import { useEffect, useState } from 'react';
import { CHAIN_ID } from '@/lib/network';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarCheck, CalendarPlus, CheckCircle2, Clock, Eye, Loader2, MapPin, MessageCircle, MessagesSquare, ShieldCheck, X, XCircle, AlertTriangle, Video, User, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatNaira, formatUsdc, USDC_TO_NGN } from '@/lib/naira';
import { TenantCashPay } from '@/components/CashPayment';
import { parseAmount } from '@/onchain-money';
import { ERC20_APPROVE_ABI, ESCROW_ABI, ESCROW_ADDRESS } from '@/lib/contracts';
import { useNow, useRefreshChain, TxError, sendUserOp, txErrorText } from '@/lib/chain';
import { getUsdc } from '@/onchain-facts';
import { encodeFunctionData, type Hex } from 'viem';
import type { SmartAccount } from 'viem/account-abstraction';
import type { Listing } from '@/components/BrowseListings';
import SlotPicker from '@/components/SlotPicker';
import { openChat } from '@/lib/chat';
import { ApiError } from '@/lib/api';
import {
  OUTCOME_OPENS_MS, WHATSAPP_CHAT, calendarLink, formatSlot, inspectionFor, prettyPhone, saveContact, savedContact, useInspections, waLink,
  type Inspection,
} from '@/lib/inspections';

interface Props {
  listing: Listing;
  account: SmartAccount;
  onClose: () => void;
}

const USDC_ADDR = (getUsdc(CHAIN_ID)?.address ?? '0x3600000000000000000000000000000000000000') as Hex;
const STEPS = [
  { label: 'Chat', icon: MessageCircle },
  { label: 'Book', icon: CalendarCheck },
  { label: 'Inspect', icon: Eye },
  { label: 'Pay', icon: ShieldCheck },
];
const CHATTED_KEY = (id: bigint) => `handova_chatted_${id}`;

function errorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel/i.test(msg)) return 'Sign-in was cancelled. Tap again and approve with your passkey.';
  if (/signMessage is not a function/.test(msg)) return 'Sign in with your passkey to book visits.';
  return msg;
}

const btn = 'w-full h-12 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60';
const primary = { background: 'var(--accent)', color: 'white' };
const secondary = { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' };
const card = { background: 'var(--surface-muted)', border: '1px solid var(--border)' };

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="w-4 h-4 animate-spin" /> : null;
}

function Banner({ tone, icon: Icon, title, children }: { tone: 'good' | 'warn' | 'bad'; icon: React.ElementType; title: string; children?: React.ReactNode }) {
  const c = tone === 'good' ? 'var(--accent)' : tone === 'warn' ? '#d4a017' : 'var(--danger)';
  return (
    <div className="flex gap-3 p-4 rounded-2xl" style={{ background: tone === 'good' ? 'var(--accent-soft)' : 'var(--surface-muted)', border: `1px solid ${tone === 'good' ? 'transparent' : 'var(--border)'}` }}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: c }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: tone === 'good' ? 'var(--accent)' : 'var(--ink)' }}>{title}</p>
        {children && <div className="text-xs mt-1 leading-relaxed space-y-1" style={{ color: 'var(--ink-2)' }}>{children}</div>}
      </div>
    </div>
  );
}

function WhenWhere({ i, where }: { i: Inspection; where: string }) {
  return (
    <div className="rounded-2xl p-4 space-y-2" style={card}>
      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}><Clock className="w-4 h-4" style={{ color: 'var(--muted)' }} /> {formatSlot(i.slotAt)}</p>
      <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--ink-2)' }}><MapPin className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} /> {where}</p>
    </div>
  );
}

function ChatLandlord({ phone, text, label = 'Message landlord on WhatsApp' }: { phone: string; text: string; label?: string }) {
  if (!phone || !WHATSAPP_CHAT) return null;
  return (
    <a href={waLink(phone, text)} target="_blank" rel="noreferrer" className={btn} style={secondary}>
      <MessageCircle className="w-4 h-4" /> {label}
    </a>
  );
}

export default function InspectionFlow({ listing, account, onClose }: Props) {
  const ins = useInspections(account);
  const refreshChain = useRefreshChain();
  const current = inspectionFor(ins.inspections, listing.id);
  const landlordPhone = (listing.landlordPhone ?? '').replace(/\D/g, '');
  const own = !!listing.landlord && listing.landlord.toLowerCase() === account.address.toLowerCase();

  // Opening this is a deliberate tap, so it's a fair moment to sign in and load any existing visit.
  useEffect(() => { if (!listing.sample && !own && !ins.connected) ins.connect(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [chatted, setChatted] = useState(() => { try { return !!localStorage.getItem(CHATTED_KEY(listing.id)); } catch { return false; } });
  const [rebooking, setRebooking] = useState(false);
  const [slot, setSlot] = useState<number | null>(null);
  const [contact, setContact] = useState(savedContact);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [paid, setPaid] = useState(false);
  const [inspectionMode, setInspectionMode] = useState<'in_person' | 'remote'>('in_person');
  const [remoteFeeUsdc, setRemoteFeeUsdc] = useState('5.00');
  const [videoLink, setVideoLink] = useState('');
  const [caretakerAddress, setCaretakerAddress] = useState('');
  const now = useNow();

  const open = current && ['requested', 'rescheduled', 'approved'].includes(current.status);
  type Screen = 'chat' | 'book' | 'waiting' | 'suggested' | 'upcoming' | 'outcome' | 'pay' | 'paid'
    | 'remote_set_video' | 'remote_upcoming' | 'remote_outcome';
  const isRemote = current?.inspectionMode === 'remote';
  const screen: Screen = paid ? 'paid'
    : current?.canPay ? 'pay'
    : rebooking ? 'book'
    : current?.status === 'requested' ? 'waiting'
    : current?.status === 'rescheduled' ? 'suggested'
    : current?.status === 'approved' && isRemote
      ? (current.videoLink ? (now >= current.slotAt - OUTCOME_OPENS_MS ? 'remote_outcome' : 'remote_upcoming') : 'remote_set_video')
    : current?.status === 'approved' ? (now >= current.slotAt - OUTCOME_OPENS_MS ? 'outcome' : 'upcoming')
    : !chatted && !current ? 'chat'
    : 'book';
  const stepIdx = {
    chat: 0, book: 1, waiting: 1, suggested: 1,
    upcoming: 2, outcome: 2, remote_set_video: 2, remote_upcoming: 2, remote_outcome: 2,
    pay: 3, paid: 4,
  }[screen] ?? 1;

  async function run(key: string, fn: () => Promise<Inspection | void>, ok?: (i: Inspection) => string) {
    setBusy(key);
    try {
      const i = await fn();
      if (i && ok) toast.success(ok(i));
      return i;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_booked') { await ins.refresh(); setRebooking(false); toast.info('You already have a visit for this home — here it is.'); return; }
      toast.error(errorMessage(e));
    } finally { setBusy(null); }
  }

  function markChatted() {
    try { localStorage.setItem(CHATTED_KEY(listing.id), '1'); } catch { /* storage unavailable */ }
    setChatted(true);
  }

  /** In-app chat opens over this sheet; when they come back, the booking step is waiting. */
  function chatInApp() {
    openChat({ listingId: String(listing.id) });
    markChatted();
  }

  function openWhatsApp() {
    const text = `Hello, I saw your property at ${listing.address || listing.location} on Handova. Is it still available? I'd like to arrange an inspection.`;
    window.open(waLink(landlordPhone, text), '_blank');
    markChatted();
  }

  async function submitBooking() {
    if (!slot) { toast.error('Pick a day and a time for your visit.'); return; }
    if (contact.name.trim().length < 2) { toast.error('Add your name so the landlord knows who is coming.'); return; }
    if (contact.phone.replace(/\D/g, '').length < 10) { toast.error('Add a phone number the landlord can reach you on, e.g. 0803 123 4567.'); return; }
    saveContact(contact);
    const reschedule = rebooking && open;
    await run('book', () => reschedule
      ? ins.act(current.id, 'reschedule', { slotAt: slot, note })
      : ins.book({ listingId: String(listing.id), slotAt: slot, name: contact.name, phone: contact.phone, note, inspectionMode, remoteFeeUsdc: inspectionMode === 'remote' ? remoteFeeUsdc : undefined }),
    i => i.notified ? 'Request sent. The landlord got a WhatsApp message and a notification in Handova.' : 'Request sent. The landlord will see it in Handova.');
    setRebooking(false);
  }

  async function pay() {
    if (!ESCROW_ADDRESS) { toast.error('Contract not deployed — set VITE_ESCROW_ADDRESS first.'); return; }
    setBusy('pay');
    try {
      const total = parseAmount(CHAIN_ID, (listing.rentUsdc + listing.depositUsdc).toString());
      await sendUserOp(account, [
        { to: USDC_ADDR, data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [ESCROW_ADDRESS, total.raw] }) },
        { to: ESCROW_ADDRESS, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'depositRent', args: [listing.id] }) },
      ]);
      void refreshChain();
      setPaid(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('NotAllowedError') ? 'Payment cancelled — nothing was charged.'
        : e instanceof TxError ? e.message
        : /insufficient|exceeds balance|AA21|prefund/i.test(msg) ? `Not enough USDC. You need ${formatUsdc(listing.rentUsdc + listing.depositUsdc)} in your wallet.`
        : txErrorText(e, 'Payment failed — nothing was charged.') ?? 'Payment failed — nothing was charged.', { duration: 10_000 });
    } finally { setBusy(null); }
  }

  const total = listing.rentUsdc + listing.depositUsdc;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        role="dialog" aria-modal="true" aria-label="Inspect and rent"
        className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 border-b" style={{ background: 'var(--popover)', borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold truncate" style={{ color: 'var(--ink)' }}>{listing.title ?? listing.location}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{formatNaira(listing.rentUsdc)}/yr · {formatNaira(listing.depositUsdc)} caution</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
            </button>
          </div>
          {/* Progress */}
          <ol className="grid grid-cols-4 gap-1.5 mt-4" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s.label} aria-current={i === stepIdx ? 'step' : undefined}>
                <span className="block h-1 rounded-full mb-1.5" style={{ background: i <= stepIdx ? 'var(--accent)' : 'var(--border)' }} />
                <span className="text-[11px] font-semibold" style={{ color: i === stepIdx ? 'var(--ink)' : i < stepIdx ? 'var(--accent)' : 'var(--subtle)' }}>{i + 1}. {s.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-5 py-5 space-y-4">
          {listing.sample ? (
            <Banner tone="warn" icon={AlertTriangle} title="This is a sample listing">There's no real landlord behind it. Real homes appear here once landlords list them.</Banner>
          ) : own ? (
            <Banner tone="warn" icon={AlertTriangle} title="This is your own listing">Tenants book visits here; you'll approve them from your landlord dashboard.</Banner>
          ) : ins.connected && ins.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={screen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="space-y-4">

                {/* 1 — Chat first */}
                {screen === 'chat' && (<>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Talk to the landlord first</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Ask your questions and agree that you'll come and see it. Then come back here to book the visit, so you're both on the same page.</p>
                  </div>
                  <button onClick={() => chatInApp()} className={btn} style={primary}><MessagesSquare className="w-4 h-4" /> Message the landlord</button>
                  {WHATSAPP_CHAT && landlordPhone && <button onClick={openWhatsApp} className={btn} style={secondary}><MessageCircle className="w-4 h-4" /> Chat on WhatsApp instead</button>}
                  <button onClick={() => setChatted(true)} className={btn} style={secondary}>We've already agreed — book a visit</button>
                  <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Never pay anyone before you've inspected the home. Handova never asks for an inspection fee.</p>
                </>)}

                {/* 2 — Book (also used to pick a new time) */}
                {screen === 'book' && (<>
                  {!rebooking && current?.status === 'declined' && (
                    <Banner tone="bad" icon={XCircle} title="The landlord couldn't do that time">{current.landlordNote ? <p>"{current.landlordNote}"</p> : null}<p>Pick another time below{landlordPhone ? ', or message them to agree one first' : ''}.</p></Banner>
                  )}
                  {!rebooking && current?.status === 'missed' && (
                    <Banner tone="warn" icon={AlertTriangle} title={current.missedBy === 'landlord' ? 'The landlord marked the last visit as missed' : 'You marked the last visit as missed'}><p>No problem — book a new time.</p></Banner>
                  )}
                  {!rebooking && current?.status === 'cancelled' && <Banner tone="warn" icon={AlertTriangle} title="You cancelled your last visit"><p>Book again whenever you're ready.</p></Banner>}
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>{rebooking ? 'Pick a new time' : 'When can you visit?'}</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>The landlord will approve it or suggest another time.</p>
                  </div>

                  {/* Inspection mode picker */}
                  {!rebooking && (
                    <div className="grid grid-cols-2 gap-2">
                      {(['in_person', 'remote'] as const).map(mode => (
                        <button key={mode} onClick={() => setInspectionMode(mode)}
                          className="flex flex-col items-center gap-2 p-3 rounded-2xl text-sm font-semibold transition-all"
                          style={{ background: inspectionMode === mode ? 'var(--accent-soft)' : 'var(--surface-muted)', border: `1.5px solid ${inspectionMode === mode ? 'var(--accent)' : 'var(--border)'}`, color: inspectionMode === mode ? 'var(--accent)' : 'var(--ink)' }}>
                          {mode === 'in_person' ? <User className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                          {mode === 'in_person' ? 'In-Person Visit' : 'Remote Video'}
                          <span className="text-[11px] font-normal text-center leading-tight" style={{ color: 'var(--muted)' }}>
                            {mode === 'in_person' ? 'Come to the property yourself' : 'Video call with on-site caretaker'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Remote fee input */}
                  {!rebooking && inspectionMode === 'remote' && (
                    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                      <div className="flex items-start gap-2">
                        <Video className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                        <p className="text-xs" style={{ color: 'var(--ink-2)' }}>A small fee goes to the on-site caretaker for their time. <span style={{ color: 'var(--accent)' }}>Handova takes nothing.</span></p>
                      </div>
                      <label className="text-xs block" style={{ color: 'var(--muted)' }}>
                        Caretaker fee (USDC)
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>$</span>
                          <input type="number" min="1" max="50" step="0.5" value={remoteFeeUsdc}
                            onChange={e => setRemoteFeeUsdc(e.target.value)}
                            className="w-24 h-10 px-3 rounded-xl text-sm outline-none tabular-nums"
                            style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>≈ {formatNaira(parseFloat(remoteFeeUsdc) || 0)}</span>
                        </div>
                      </label>
                    </div>
                  )}

                  <SlotPicker value={slot} onChange={setSlot} />
                  {!rebooking && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs" style={{ color: 'var(--muted)' }}>Your name
                        <input value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value.slice(0, 60) }))} autoComplete="name" placeholder="e.g. Ada Obi"
                          className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
                      </label>
                      <label className="text-xs" style={{ color: 'var(--muted)' }}>Phone (WhatsApp)
                        <input value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18) }))} inputMode="tel" autoComplete="tel" placeholder="0803 123 4567"
                          className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
                      </label>
                    </div>
                  )}
                  {!rebooking && <p className="text-[11px] -mt-2" style={{ color: 'var(--subtle)' }}>Your name and number go only to this landlord. <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy</a></p>}
                  <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="Note for the landlord (optional), e.g. coming with my sister"
                    className="w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
                  <button onClick={() => { void submitBooking(); }} disabled={busy === 'book'} className={btn} style={primary}>
                    <Spin on={busy === 'book'} /> {slot ? `Request ${formatSlot(slot)}` : 'Pick a time above'}
                  </button>
                  {rebooking && <button onClick={() => setRebooking(false)} className="w-full text-sm py-2" style={{ color: 'var(--muted)' }}>Keep the current time</button>}
                  {!rebooking && !current && <button onClick={() => setChatted(false)} className="w-full text-xs py-1" style={{ color: 'var(--muted)' }}>← Chat with the landlord first</button>}
                </>)}

                {/* 2 — Waiting for the landlord */}
                {screen === 'waiting' && current && (<>
                  <Banner tone="good" icon={Clock} title="Waiting for the landlord to approve">
                    <p>{current.notified === false ? 'They can see your request in Handova.' : 'We\'ve let them know.'} Most landlords reply within a day — we'll update this page when they do.</p>
                  </Banner>
                  <WhenWhere i={current} where={listing.address || listing.location} />
                  <button onClick={() => chatInApp()} className={btn} style={secondary}><MessagesSquare className="w-4 h-4" /> Message the landlord</button>
                  <ChatLandlord phone={landlordPhone} text={`Hello, I've requested an inspection on Handova for ${formatSlot(current.slotAt)} at ${listing.address || listing.location}. Please approve it when you can.`} label="Remind them on WhatsApp" />
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setSlot(null); setRebooking(true); }} className={btn} style={secondary}>Change time</button>
                    <button onClick={() => { void run('cancel', () => ins.act(current.id, 'cancel'), () => 'Visit cancelled.'); }} disabled={busy === 'cancel'} className={btn} style={{ ...secondary, color: 'var(--danger)' }}><Spin on={busy === 'cancel'} /> Cancel</button>
                  </div>
                </>)}

                {/* 2 — Landlord suggested another time */}
                {screen === 'suggested' && current && (<>
                  <Banner tone="warn" icon={CalendarCheck} title="The landlord suggested another time">{current.landlordNote ? <p>"{current.landlordNote}"</p> : null}</Banner>
                  <WhenWhere i={current} where={listing.address || listing.location} />
                  <button onClick={() => { void run('accept', () => ins.act(current.id, 'accept'), () => 'Visit confirmed!'); }} disabled={busy === 'accept'} className={btn} style={primary}>
                    <Spin on={busy === 'accept'} /> <CheckCircle2 className="w-4 h-4" /> That works for me
                  </button>
                  <button onClick={() => { setSlot(null); setRebooking(true); }} className={btn} style={secondary}>Suggest a different time</button>
                </>)}

                {/* 3 — Visit confirmed, before the time */}
                {screen === 'upcoming' && current && (<>
                  <Banner tone="good" icon={CheckCircle2} title="Your visit is confirmed">{current.landlordNote ? <p>Landlord: "{current.landlordNote}"</p> : <p>The landlord expects you.</p>}</Banner>
                  <WhenWhere i={current} where={listing.address || listing.location} />
                  <div className="grid grid-cols-2 gap-2">
                    <a href={calendarLink(`House inspection — ${listing.location}`, current.slotAt, `${listing.address || listing.location}\nBooked on Handova.`)} target="_blank" rel="noreferrer" className={btn} style={secondary}>
                      <CalendarPlus className="w-4 h-4" /> Add to calendar
                    </a>
                    <button onClick={() => chatInApp()} className={btn} style={secondary}><MessagesSquare className="w-4 h-4" /> Message</button>
                  </div>
                  <div className="rounded-2xl p-4" style={card}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink)' }}>What to check when you visit</p>
                    <ul className="text-xs space-y-1" style={{ color: 'var(--ink-2)' }}>
                      {['Water runs in kitchen and bathroom', 'Power, sockets and meter (prepaid?)', 'Leaks, cracks or damp on walls and ceiling', 'Doors, windows and burglary proofs lock', 'Road access and drainage when it rains'].map(t => <li key={t}>• {t}</li>)}
                    </ul>
                  </div>
                  <div className="flex justify-center gap-4 text-sm">
                    <button onClick={() => { setSlot(null); setRebooking(true); }} style={{ color: 'var(--muted)' }}>Change time</button>
                    <button onClick={() => { if (window.confirm('Cancel this visit? The landlord will be told.')) void run('cancel', () => ins.act(current.id, 'cancel'), () => 'Visit cancelled.'); }} style={{ color: 'var(--danger)' }}>Cancel visit</button>
                  </div>
                </>)}

                {/* 3 — After the time: did it happen? */}
                {screen === 'outcome' && current && (current.tenantConfirmedAt ? (<>
                  <Banner tone="good" icon={Clock} title="Thanks — waiting for the landlord to confirm too">
                    <p>Once they confirm the visit, you can pay. If they don't respond within 24 hours of the visit, you'll be able to continue anyway — your money stays protected in escrow until you move in.</p>
                  </Banner>
                  <button onClick={() => chatInApp()} className={btn} style={secondary}><MessagesSquare className="w-4 h-4" /> Ask the landlord to confirm</button>
                  <ChatLandlord phone={landlordPhone} label="Ask on WhatsApp" text={`Hello, thanks for showing me the property. Please confirm the inspection on Handova so I can proceed.`} />
                </>) : (<>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Did the inspection happen?</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{formatSlot(current.slotAt)} · {listing.location}</p>
                  </div>
                  <button onClick={() => { void run('happened', () => ins.act(current.id, 'happened'), i => i.canPay ? 'Both of you confirmed. You can now review and pay.' : 'Thanks! Waiting for the landlord to confirm.'); }} disabled={!!busy} className={btn} style={primary}>
                    <Spin on={busy === 'happened'} /> <CheckCircle2 className="w-4 h-4" /> Yes, I inspected it
                  </button>
                  <button onClick={() => { void run('missed', () => ins.act(current.id, 'missed'), () => 'Noted. You can book a new time.'); }} disabled={!!busy} className={btn} style={secondary}>
                    <Spin on={busy === 'missed'} /> No, it didn't happen
                  </button>
                  <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Didn't like the place? Just close this — you don't have to rent it.</p>
                </>))}

                {/* 3 — Remote: landlord sets video link */}
                {screen === 'remote_set_video' && current && current.role === 'landlord' && (<>
                  <Banner tone="warn" icon={Video} title="Set up the video call">
                    <p>This tenant requested a remote inspection. Add a video call link so they can join at {formatSlot(current.slotAt)}.</p>
                  </Banner>
                  <div className="space-y-3">
                    <label className="text-xs block" style={{ color: 'var(--muted)' }}>Video call link
                      <input value={videoLink} onChange={e => setVideoLink(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij"
                        className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
                    </label>
                    <label className="text-xs block" style={{ color: 'var(--muted)' }}>Caretaker name (optional)
                      <input value={caretakerAddress} onChange={e => setCaretakerAddress(e.target.value)} placeholder="e.g. Chidi Obi"
                        className="mt-1 w-full h-11 px-3 rounded-xl text-sm outline-none" style={{ ...card, color: 'var(--ink)' }} />
                    </label>
                  </div>
                  <button onClick={() => { void run('set_video', () => ins.act(current.id, 'set_video', { videoLink, caretakerAddress }), () => 'Video link sent to tenant.'); }} disabled={!videoLink.startsWith('http') || busy === 'set_video'} className={btn} style={primary}>
                    <Spin on={busy === 'set_video'} /><Video className="w-4 h-4" /> Send video link to tenant
                  </button>
                </>)}

                {screen === 'remote_set_video' && current && current.role === 'tenant' && (
                  <Banner tone="warn" icon={Video} title="Waiting for the landlord to set the video link">
                    <p>Your remote inspection is approved for {formatSlot(current.slotAt)}. The landlord will send a video call link before then.</p>
                    <p className="mt-1">Remote fee held in escrow: {formatNaira(parseFloat(current.remoteFeeUsdc || '0'))} — paid to the caretaker after the call.</p>
                  </Banner>
                )}

                {/* 3 — Remote: call is ready to join */}
                {screen === 'remote_upcoming' && current && (<>
                  <Banner tone="good" icon={Video} title="Your remote inspection is ready">
                    <p>Scheduled for {formatSlot(current.slotAt)}.</p>
                    {current.caretakerAddress && <p>Caretaker: <strong>{current.caretakerAddress}</strong></p>}
                    <p className="mt-1">Fee (held in escrow): {formatNaira(parseFloat(current.remoteFeeUsdc || '0'))} — released after both sides confirm the call happened.</p>
                  </Banner>
                  {current.videoLink && (
                    <a href={current.videoLink} target="_blank" rel="noreferrer" className={btn} style={primary}>
                      <Video className="w-4 h-4" /> Join Video Call <ExternalLink className="w-3 h-3 ml-auto" />
                    </a>
                  )}
                  <div className="rounded-2xl p-4" style={card}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink)' }}>What to ask the caretaker to show you</p>
                    <ul className="text-xs space-y-1" style={{ color: 'var(--ink-2)' }}>
                      {['Water running in kitchen and bathroom', 'Power and sockets', 'Every room, ceiling and walls (cracks/damp)', 'Doors, windows, burglary proofs', 'Road outside and drainage', 'The compound and neighbours'].map(t => <li key={t}>• {t}</li>)}
                    </ul>
                  </div>
                </>)}

                {/* 3 — Remote: confirm the call happened */}
                {screen === 'remote_outcome' && current && (current.tenantCallConfirmedAt && current.role === 'tenant' ? (
                  <Banner tone="good" icon={Clock} title="Thanks — waiting for the landlord to confirm the call too">
                    <p>Once they confirm, you can pay into escrow. The caretaker fee is released at that point.</p>
                  </Banner>
                ) : (<>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Did the video call happen?</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{formatSlot(current.slotAt)} · Remote inspection</p>
                  </div>
                  {current.videoLink && (
                    <a href={current.videoLink} target="_blank" rel="noreferrer" className={btn} style={secondary}>
                      <Video className="w-4 h-4" /> Join call again if needed <ExternalLink className="w-3 h-3 ml-auto" />
                    </a>
                  )}
                  <button onClick={() => { void run('call_confirmed', () => ins.act(current.id, 'call_confirmed'), i => i.canPay ? 'Both sides confirmed. You can now pay into escrow.' : 'Thanks! Waiting for the other side to confirm.'); }} disabled={!!busy} className={btn} style={primary}>
                    <Spin on={busy === 'call_confirmed'} /><CheckCircle2 className="w-4 h-4" /> Yes, the call happened
                  </button>
                  <button onClick={() => { void run('missed', () => ins.act(current.id, 'missed'), () => 'Noted. You can book a new time.'); }} disabled={!!busy} className={btn} style={secondary}>
                    <Spin on={busy === 'missed'} /> No, it didn't happen
                  </button>
                </>))}

                {/* 4 — Pay in cash (the landlord chose cash for this tenant) */}
                {screen === 'pay' && current?.paymentMethod === 'cash' && (<>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Pay the landlord in cash</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Then upload the receipt. The landlord confirms it in the app, and you both keep the record.</p>
                  </div>
                  <TenantCashPay account={account} inspection={current} expectedNgn={(listing.rentUsdc + listing.depositUsdc) * USDC_TO_NGN} />
                </>)}

                {/* 4 — Review & pay into escrow */}
                {screen === 'pay' && current?.paymentMethod !== 'cash' && (<>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Review and pay</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Your money goes into escrow, not to the landlord. They're paid only after you confirm you've moved in.</p>
                  </div>
                  <div className="rounded-2xl overflow-hidden" style={card}>
                    {[
                      ['Rent (1 year)', formatNaira(listing.rentUsdc)],
                      ['Caution fee (refundable)', formatNaira(listing.depositUsdc)],
                      ['Agent fee', '₦0'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between px-4 py-2.5 text-sm border-b" style={{ borderColor: 'var(--border)' }}><span style={{ color: 'var(--muted)' }}>{k}</span><span className="tabular-nums" style={{ color: 'var(--ink)' }}>{v}</span></div>
                    ))}
                    <div className="flex justify-between px-4 py-3 text-sm font-bold"><span style={{ color: 'var(--ink)' }}>You pay into escrow</span><span className="tabular-nums" style={{ color: 'var(--ink)' }}>{formatNaira(total)} <span className="font-normal text-xs" style={{ color: 'var(--muted)' }}>({formatUsdc(total)})</span></span></div>
                  </div>
                  <div className="space-y-2">
                    {[
                      'I inspected this home and I\'m happy with it',
                      `I agree to ${formatNaira(listing.rentUsdc)} a year plus a ${formatNaira(listing.depositUsdc)} refundable caution fee`,
                      'I\'ll tap "I\'ve moved in" only after I get the keys — that\'s when the landlord is paid',
                    ].map((t, i) => (
                      <label key={t} className="flex gap-3 items-start p-3 rounded-xl cursor-pointer" style={card}>
                        <input type="checkbox" checked={checks[i]} onChange={() => setChecks(c => c.map((v, j) => (j === i ? !v : v)))} className="mt-0.5 w-4 h-4 accent-[var(--accent)]" />
                        <span className="text-sm" style={{ color: 'var(--ink)' }}>{t}</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={() => { void pay(); }} disabled={busy === 'pay' || checks.some(c => !c)} className={btn} style={primary}>
                    {busy === 'pay' ? <><Loader2 className="w-4 h-4 animate-spin" /> Paying into escrow…</> : <><ShieldCheck className="w-4 h-4" /> Pay {formatNaira(total)} into escrow</>}
                  </button>
                  {checks.some(c => !c) && <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Tick all three to continue.</p>}
                </>)}

                {/* Done */}
                {screen === 'paid' && (
                  <div className="flex flex-col items-center text-center py-4 space-y-4">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                      className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--success)' }}>
                      <CheckCircle2 className="w-10 h-10 text-white" />
                    </motion.div>
                    <div>
                      <h3 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Your rent is safe in escrow</h3>
                      <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--muted)' }}>Next: collect your keys, then open My Leases and tap "I've moved in". That's when the landlord gets paid.</p>
                    </div>
                    <button onClick={onClose} className="px-8 h-12 rounded-2xl font-semibold" style={primary}>Done</button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
          {ins.isError && !listing.sample && !own && (
            <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>{errorMessage(ins.error)}</p>
          )}
          {current && ['requested', 'rescheduled', 'approved'].includes(current.status) && current.tenantPhone && (
            <p className="text-[11px] text-center" style={{ color: 'var(--subtle)' }}>The landlord can reach you on {prettyPhone(current.tenantPhone)}.</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

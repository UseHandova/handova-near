/**
 * PrivacyNotice — public page at /privacy (no sign-in needed).
 * Keep it in step with what the code actually stores; each row names where the data lives and for how long.
 */

import { ArrowLeft, Lock } from 'lucide-react';

const CONTACT = (import.meta.env.VITE_PRIVACY_CONTACT as string | undefined)?.trim();
const UPDATED = '7 October 2026';

const ROWS: [string, string, string, string][] = [
  ['Wallet address', 'Your account and payments', 'Arc blockchain (public)', 'Permanent'],
  ['Passkey', 'Signing in with Face ID / fingerprint', 'Your device and Circle. We never see your fingerprint or face', 'Until you remove it from your device'],
  ['Phone number, locked wallet backup, PIN check', 'Phone sign-in, including on a new phone. We check the number with a WhatsApp message or an SMS code. We never receive your PIN, only a one-way check of it', 'Our server', 'While your account exists. Login codes are cleared within a day'],
  ['Sign-in session', 'Keeping you signed in', 'Your browser', '7 days'],
  ['Identity check (landlords)', 'Showing tenants you are who you say you are. Your ID and selfie are checked by Didit (or Dojah). We keep only the result and a one-way fingerprint of your ID number, so one ID can\'t verify many accounts', '"Verified" flag on the blockchain (public); fingerprint on our server', 'Flag: permanent. Fingerprint: while your account exists'],
  ['Listing details: address, description, price, photos, videos, WhatsApp number if you add it', 'Showing your home to tenants', 'Details on the blockchain (public); photos and videos on our server or storage', 'Blockchain: permanent. Photos: until you ask us to remove them'],
  ['WhatsApp listing messages: text, voice notes, photos', 'Turning your message into a draft listing. Voice notes are transcribed and the text is read by an AI service (Groq)', 'Our server', 'Draft codes expire after 14 days'],
  ['Inspection bookings: name, phone, time, note', 'So the landlord knows who is coming and how to reach them', 'Our server', 'Kept as a record of the booking'],
  ['Chat messages', 'Talking to the landlord or tenant. Only the two of you can read a chat; Handova staff can\'t open chats. If you haven\'t read a message, we may send you a WhatsApp nudge with its first 200 characters', 'Our server', 'Kept while the conversation exists'],
  ['Property ownership documents', 'Checking a landlord may let the property. Shown only to the landlord and the Handova admin', 'Our server, encrypted', 'Deleted as soon as they\'re reviewed. We keep a fingerprint of each file and the decision'],
  ['Reviews and repair requests', 'Helping tenants choose and landlords fix problems', 'Our server. Reviews are public', 'Kept with the tenancy'],
  ['Cash payment receipts: amount, date, photo of the receipt, notes', 'Proof that a cash rent payment happened, confirmed by the landlord. If they disagree, the Handova admin looks at the receipt', 'Our server, encrypted', 'Kept as your proof of payment'],
  ['Rent savings plan: goal, due date, how often, reminder number', 'Working out how much to save and reminding you. The money itself sits in a savings contract that only you can move', 'Plan on our server; savings on the blockchain (public)', 'Plan: until you stop it. Savings: until you withdraw them'],
  ['Payments: rent and caution fee in USDC', 'Holding money safely until move-in and move-out', 'Arc blockchain (public)', 'Permanent'],
  ['Language, theme, saved searches, your booking contact details', 'Remembering your preferences', 'Your browser only', 'Until you clear your browser data'],
];

const SHARED: [string, string][] = [
  ['Circle', 'wallets and passkey sign-in'],
  ['Didit / Dojah', 'landlord identity checks (your ID and selfie go to them, not to us)'],
  ['Twilio (WhatsApp)', 'sending and receiving WhatsApp messages'],
  ['Google Firebase / Termii', 'sending sign-in codes by SMS to numbers not on WhatsApp'],
  ['Groq', 'reading WhatsApp listing messages and transcribing voice notes'],
  ['OpenStreetMap', 'finding addresses on the map'],
  ['Arc blockchain', 'payments, listings and verification flags: public by design'],
];

export default function PrivacyNotice() {
  const h2 = 'text-lg font-bold mt-8 mb-2';
  const p = 'text-sm leading-relaxed';
  return (
    <div className="min-h-dvh px-4 py-8">
      <article className="max-w-3xl mx-auto" style={{ color: 'var(--ink-2)' }}>
        <a href="/" className="inline-flex items-center gap-1 text-sm mb-6" style={{ color: 'var(--muted)' }}><ArrowLeft className="w-4 h-4" /> Back to Handova</a>
        <h1 className="display text-3xl font-bold" style={{ color: 'var(--ink)' }}>Privacy notice</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>Last updated {UPDATED}</p>

        <div className="mt-6 p-4 rounded-2xl text-sm space-y-1.5" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
          <p className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4" style={{ color: 'var(--accent)' }} /> The short version</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We collect what's needed to rent homes safely: who you are, the homes you list or visit, and your messages about them.</li>
            <li>Payments, listings and "verified" flags are on a public blockchain and <b>can't be deleted</b>. Everything else is on our server, and you can ask us to delete it.</li>
            <li>We never see your passkey, your PIN or your ID photos. Ownership documents are encrypted and deleted after review.</li>
            <li>We don't sell your data and we don't show ads.</li>
          </ul>
        </div>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Who we are</h2>
        <p className={p}>Handova helps people in Lagos rent homes directly from landlords, without agent fees. Rent is held in an escrow smart contract on the Arc blockchain until the tenant moves in. Handova decides how your data is used, so we are responsible for it under the Nigeria Data Protection Act 2023.</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>What we collect, why, where it lives and for how long</h2>
        {/* Phones: one card per item. Wider screens: a table. */}
        <ul className="sm:hidden space-y-2">
          {ROWS.map(r => (
            <li key={r[0]} className="p-3 rounded-xl text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="font-semibold" style={{ color: 'var(--ink)' }}>{r[0]}</p>
              <dl className="mt-1.5 space-y-1">
                {(['Why', 'Where', 'How long'] as const).map((label, i) => (
                  <div key={label} className="grid grid-cols-[4.5rem_1fr] gap-2">
                    <dt className="text-xs pt-0.5" style={{ color: 'var(--muted)' }}>{label}</dt>
                    <dd>{r[i + 1]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <table className="hidden sm:table w-full text-sm border-collapse">
          <thead>
            <tr style={{ color: 'var(--muted)' }}>
              {['What', 'Why', 'Where', 'How long'].map(t => <th key={t} className="text-left font-semibold py-2 pr-3 border-b" style={{ borderColor: 'var(--border)' }}>{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => (
              <tr key={r[0]} className="align-top">
                {r.map((c, i) => <td key={i} className="py-2.5 pr-3 border-b" style={{ borderColor: 'var(--border)', color: i === 0 ? 'var(--ink)' : undefined, fontWeight: i === 0 ? 600 : 400 }}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Why we're allowed to use it</h2>
        <ul className={`${p} list-disc pl-5 space-y-1`}>
          <li><b>To provide the service you asked for:</b> your account, listings, bookings, chats and payments.</li>
          <li><b>Your consent:</b> ownership documents, and WhatsApp messages you choose to send us. You can withdraw consent at any time.</li>
          <li><b>Preventing fraud:</b> identity checks and the ID fingerprint that stops one person running many accounts.</li>
          <li><b>The law:</b> if we're legally required to keep or share something.</li>
        </ul>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Who else handles it</h2>
        <p className={p}>We use these services to run Handova. Each only gets what it needs for its job:</p>
        <ul className={`${p} list-disc pl-5 space-y-1 mt-2`}>
          {SHARED.map(([who, what]) => <li key={who}><b>{who}</b>: {what}</li>)}
        </ul>
        <p className={`${p} mt-2`}>Some of these services are outside Nigeria, so your data may be processed abroad. We only use providers that protect it.</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>The blockchain is public and permanent</h2>
        <p className={p}>Payments, listing details and the "verified" flag are recorded on the Arc blockchain. Anyone can see them, and nobody, including us, can change or delete them. We can hide a listing inside Handova, but it stays on the blockchain. Please don't put personal details you want to stay private in a listing description.</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>How we keep it safe</h2>
        <p className={p}>Access to private data needs your signed-in session, and only the people in a booking or chat can see it. Ownership documents are encrypted while stored. We take an encrypted backup of our database every day and keep each one for 14 days, so something you ask us to delete may stay in a backup for up to 14 days before it's gone for good. Ownership documents are never included in backups.</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Your rights</h2>
        <p className={p}>Under the Nigeria Data Protection Act you can ask us to: see the data we hold about you, correct it, delete it (except what's on the blockchain), stop using it for a purpose you object to, or give you a copy to take elsewhere. You can withdraw consent at any time. We'll reply within 30 days. If you're unhappy with our answer, you can complain to the Nigeria Data Protection Commission (NDPC).</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Contact us</h2>
        {CONTACT
          ? <p className={p}>For any privacy question or request, contact <a href={/@/.test(CONTACT) ? `mailto:${CONTACT}` : CONTACT} className="underline" style={{ color: 'var(--accent)' }}>{CONTACT}</a>.</p>
          : <p className={p} style={{ color: import.meta.env.DEV ? 'var(--danger)' : undefined }}>{import.meta.env.DEV ? 'Set VITE_PRIVACY_CONTACT in .env to show how people can reach you here.' : 'Contact the Handova team through the app.'}</p>}

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Children</h2>
        <p className={p}>Handova is for adults (18 and over) renting or letting homes.</p>

        <h2 className={h2} style={{ color: 'var(--ink)' }}>Changes</h2>
        <p className={`${p} mb-12`}>If we change how we use your data, we'll update this page and the date at the top. For big changes, we'll tell you in the app.</p>
      </article>
    </div>
  );
}

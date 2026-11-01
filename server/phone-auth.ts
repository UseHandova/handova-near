/**
 * Phone-number login — for people without (or who lose) a passkey.
 *
 * 1. Prove the number, two ways:
 *    - WhatsApp (default, free): a "reverse OTP". The app opens WhatsApp with "HANDOVA LOGIN 482913" pre-typed and
 *      the person sends it to our bot. A message *from* their number proves they own it; user-started chats need
 *      no message templates.
 *    - SMS (for numbers not on WhatsApp), one of:
 *        firebase — the browser runs Firebase Phone Auth (Google sends the code; no Nigerian sender ID / CAC
 *                   needed) and we verify the resulting ID token (server/firebase-phone.ts);
 *        termii   — we text our own 6-digit code (server/sms.ts); only a keyed hash is stored, 5 wrong tries end it;
 *        dev      — like termii, but the code is printed in the server log (development only).
 *      SMS_PROVIDER picks one; by default Firebase if configured, else Termii, else dev.
 * 2. The wallet key is made on the person's device and locked with their 6-digit PIN. We keep a locked backup
 *    so a new phone can sign in. Unlocking needs all three: the phone number (step 1), the PIN (every 5 wrong
 *    tries → a lock: 15 minutes the first time, then 24 hours), and a per-account server share. The server alone
 *    can't open it. Locks never become permanent, so a forgetful person never loses their money for good.
 *
 *    pinSecret = PBKDF2(PIN, salt)                 (device only)
 *    pinProof  = HMAC(pinSecret, "pin-proof")      → server stores HMAC(server secret, pinProof)
 *    wrapKey   = HKDF(pinSecret ‖ serverShare)     → AES-GCM(wallet key) = the backup we store
 */

import type { Express, Request, Response } from 'express';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isAddress, isHex } from 'viem';
import { db } from './db';
import { serverHmac } from './auth';
import { normalisePhone } from './inspections';
import { smsFromEnv, type SmsSender } from './sms';
import { FirebaseTokenError, verifyFirebasePhoneToken } from './firebase-phone';
import type { JWTVerifyGetKey } from 'jose';

export const CODE_TTL_MS = 10 * 60_000;
const TOKEN_TTL_MS = 15 * 60_000;
const TRIES_PER_LOCK = 5, FIRST_LOCK_MS = 15 * 60_000, LONG_LOCK_MS = 24 * 3600_000;
const START_LIMIT = 5; // login codes per phone per hour
const SMS_TRIES = 5;   // wrong codes before an SMS code stops working
export const SMS_RESEND_MS = 60_000;

interface Challenge { id: string; phone: string; code: string; status: 'pending' | 'verified' | 'wrong_number'; from_phone: string; created_at: number; expires_at: number; channel: 'whatsapp' | 'sms'; code_hash: string; attempts: number }
interface PhoneAccount {
  phone: string; address: string; salt: string; verifier: string; server_share: string; blob: string; iv: string;
  failed: number; locked_until: number; created_at: number;
}

export function ensurePhoneTables() {
  db().exec(`CREATE TABLE IF NOT EXISTS phone_challenges (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    from_phone TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS phone_challenges_phone ON phone_challenges (phone, created_at);
  CREATE TABLE IF NOT EXISTS phone_accounts (
    phone TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    salt TEXT NOT NULL,
    verifier TEXT NOT NULL,
    server_share TEXT NOT NULL,
    blob TEXT NOT NULL,
    iv TEXT NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS phone_pending_shares (
    phone TEXT PRIMARY KEY,
    server_share TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );`);
  // Added for SMS codes.
  const cols = new Set((db().query('PRAGMA table_info(phone_challenges)').all() as { name: string }[]).map(c => c.name));
  if (!cols.has('channel')) db().exec("ALTER TABLE phone_challenges ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'");
  if (!cols.has('code_hash')) db().exec("ALTER TABLE phone_challenges ADD COLUMN code_hash TEXT NOT NULL DEFAULT ''");
  if (!cols.has('attempts')) db().exec('ALTER TABLE phone_challenges ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
}

/** Signed, short-lived proof that this browser verified `phone`. */
function issuePhoneToken(phone: string, now = Date.now()) {
  const payload = `${phone}.${now + TOKEN_TTL_MS}`;
  return `${payload}.${serverHmac(`phone:${payload}`)}`;
}
function verifyPhoneToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const [phone, exp, mac] = token.split('.');
  if (!phone || !exp || !mac || Number(exp) < Date.now()) return null;
  const expected = serverHmac(`phone:${phone}.${exp}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return phone;
}
const pinVerifier = (pinProof: string) => serverHmac(`pin:${pinProof}`);
const mask = (p: string) => `+${p.slice(0, 3)} ••• ••• ${p.slice(-4)}`;

/**
 * Called by the WhatsApp webhook for every inbound message. Returns a reply if the message was a login code,
 * otherwise null (so the listing bot handles it).
 */
export function handleInboundLogin(fromRaw: string, body: string): string | null {
  const m = String(body ?? '').trim().match(/^handova\s+login\s+(\d{6})$/i);
  if (!m) return null;
  ensurePhoneTables();
  const from = normalisePhone(fromRaw.replace(/^whatsapp:/, ''));
  const c = db().query("SELECT * FROM phone_challenges WHERE code = ? AND channel = 'whatsapp'").get(m[1]) as Challenge | null;
  if (!c || c.expires_at < Date.now()) return 'That login code has expired. Go back to Handova and tap "Continue with phone number" again.';
  if (c.status === 'verified') return '✅ You\'re already verified. Go back to Handova to finish signing in.';
  if (from !== c.phone) {
    db().query("UPDATE phone_challenges SET status = 'wrong_number', from_phone = ? WHERE id = ?").run(from, c.id);
    return `This code was requested for ${mask(c.phone)}, but you sent it from a different number. Send it from the number you typed in Handova.`;
  }
  db().query("UPDATE phone_challenges SET status = 'verified', from_phone = ? WHERE id = ?").run(from, c.id);
  return '✅ Number confirmed! Go back to Handova to finish signing in.';
}

export interface FirebaseConfig { projectId: string; keys?: JWTVerifyGetKey }
export function firebaseFromEnv(env = process.env): FirebaseConfig | null {
  const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || '';
  return projectId ? { projectId } : null;
}

export function mountPhoneAuth(app: Express, botNumber = process.env.TWILIO_WHATSAPP_NUMBER || '', sms: SmsSender | null = smsFromEnv(), firebase: FirebaseConfig | null = firebaseFromEnv()) {
  ensurePhoneTables();
  const bad = (res: Response, status: number, error: string, code = 'bad_request') => res.status(status).json({ ok: false, code, error });
  const botDigits = botNumber.replace(/\D/g, '');
  const sandboxJoin = process.env.TWILIO_SANDBOX_JOIN || ''; // e.g. "join gun-heart" while on the Twilio sandbox
  const wanted = process.env.SMS_PROVIDER;
  const smsMode: 'firebase' | 'termii' | 'dev' | null =
    wanted === 'firebase' ? (firebase ? 'firebase' : null)
    : wanted === 'termii' ? (sms && !sms.devMode ? 'termii' : null)
    : firebase ? 'firebase' : sms ? (sms.devMode ? 'dev' : 'termii') : null;

  /** Which ways of proving a number this server offers (the app shows only those). */
  app.get('/api/phone/options', (_req: Request, res: Response) => {
    res.json({ ok: true, whatsapp: !!botDigits, sms: smsMode, sandboxJoin });
  });

  /** Firebase route: the browser did the SMS step with Google; verify its ID token and take the number from it. */
  app.post('/api/phone/firebase', async (req: Request, res: Response) => {
    if (smsMode !== 'firebase' || !firebase) return bad(res, 409, 'SMS sign-in on this server doesn\'t use Firebase.', 'not_firebase');
    try {
      const phone = await verifyFirebasePhoneToken(String(req.body?.idToken ?? ''), firebase.projectId, firebase.keys);
      res.json(verifiedPayload(phone));
    } catch (e) {
      bad(res, 401, e instanceof FirebaseTokenError ? e.message : 'That sign-in couldn\'t be verified. Please try again.', 'bad_token');
    }
  });

  /** Start: returns the code to send and a wa.me link with it pre-typed. */
  app.post('/api/phone/start', async (req: Request, res: Response) => {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) return bad(res, 400, 'Enter your phone number, e.g. 0803 123 4567.', 'phone');
    const channel = req.body?.channel === 'sms' ? 'sms' : 'whatsapp';
    if (channel === 'whatsapp' && !botDigits) return bad(res, 503, 'WhatsApp sign-in isn\'t set up on this server yet. Get a code by SMS instead.', 'unavailable');
    if (channel === 'sms' && smsMode === 'firebase') return bad(res, 409, 'SMS codes on this server come from Firebase — the app sends them directly.', 'use_firebase');
    if (channel === 'sms' && (!sms || !smsMode)) return bad(res, 503, 'SMS codes aren\'t set up on this server yet. Use WhatsApp instead.', 'sms_unavailable');
    const now = Date.now();
    const recent = (db().query('SELECT COUNT(*) AS n FROM phone_challenges WHERE phone = ? AND created_at > ?').get(phone, now - 3600_000) as { n: number }).n;
    if (recent >= START_LIMIT) return bad(res, 429, 'Too many attempts for this number. Please wait an hour and try again.', 'rate_limited');
    db().query('DELETE FROM phone_challenges WHERE expires_at < ?').run(now - 86_400_000);

    if (channel === 'sms') {
      const last = db().query("SELECT created_at FROM phone_challenges WHERE phone = ? AND channel = 'sms' ORDER BY created_at DESC LIMIT 1").get(phone) as { created_at: number } | null;
      if (last && now - last.created_at < SMS_RESEND_MS) return bad(res, 429, `Please wait ${Math.ceil((SMS_RESEND_MS - (now - last.created_at)) / 1000)} seconds before asking for another code.`, 'too_soon');
      const smsId = randomBytes(16).toString('hex');
      const smsCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
      db().query("INSERT INTO phone_challenges (id, phone, code, status, created_at, expires_at, channel, code_hash) VALUES (?, ?, ?, 'pending', ?, ?, 'sms', ?)")
        .run(smsId, phone, `sms-${smsId}`, now, now + CODE_TTL_MS, serverHmac(`sms:${smsId}:${smsCode}`));
      // Plain GSM characters only (no dashes or emoji), so it stays one 160-character SMS.
      const out = await sms!(phone, `Your Handova code is ${smsCode}. It expires in 10 minutes. Never share it. Handova will never ask you for it.`);
      if (!out.ok) {
        db().query('DELETE FROM phone_challenges WHERE id = ?').run(smsId);
        return bad(res, 502, 'We couldn\'t send the SMS just now. Try again in a minute, or use WhatsApp instead.', 'sms_failed');
      }
      return res.json({ ok: true, challengeId: smsId, channel: 'sms', phone, expiresAt: now + CODE_TTL_MS, resendAfter: now + SMS_RESEND_MS, devMode: !!sms!.devMode });
    }
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const c = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!db().query('SELECT 1 FROM phone_challenges WHERE code = ?').get(c)) code = c;
    }
    const id = randomBytes(16).toString('hex');
    db().query("INSERT INTO phone_challenges (id, phone, code, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(id, phone, code, now, now + CODE_TTL_MS);
    const text = `HANDOVA LOGIN ${code}`;
    res.json({ ok: true, channel: 'whatsapp', challengeId: id, code, text, phone, waLink: `https://wa.me/${botDigits}?text=${encodeURIComponent(text)}`, botNumber: `+${botDigits}`, sandboxJoin, expiresAt: now + CODE_TTL_MS });
  });

  /** Poll until the WhatsApp message arrives. On success: a phone token, and whether an account exists. */
  app.get('/api/phone/status/:id', (req: Request, res: Response) => {
    const c = db().query('SELECT * FROM phone_challenges WHERE id = ?').get(String(req.params.id)) as Challenge | null;
    if (!c) return bad(res, 404, 'Sign-in request not found. Start again.', 'not_found');
    if (c.status === 'wrong_number') return res.json({ ok: true, status: 'wrong_number', error: 'That message came from a different number. Send it from the number you entered.' });
    if (c.expires_at < Date.now()) return res.json({ ok: true, status: 'expired' });
    if (c.status !== 'verified') return res.json({ ok: true, status: 'pending' });
    res.json(verifiedPayload(c.phone));
  });

  /** SMS: check the code they typed. On success, the same answer as a verified status. */
  app.post('/api/phone/verify', (req: Request, res: Response) => {
    const c = db().query('SELECT * FROM phone_challenges WHERE id = ?').get(String(req.body?.challengeId ?? '')) as Challenge | null;
    if (!c || c.channel !== 'sms') return bad(res, 404, 'Sign-in request not found. Start again.', 'not_found');
    if (c.status === 'verified') return bad(res, 409, 'This code was already used. Start again to get a new one.', 'used');
    if (c.expires_at < Date.now()) return bad(res, 410, 'This code has expired. Ask for a new one.', 'expired');
    if (c.attempts >= SMS_TRIES) return bad(res, 429, 'Too many wrong codes. Ask for a new one.', 'too_many');
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    const expected = serverHmac(`sms:${c.id}:${code}`);
    const ok = code.length === 6 && expected.length === c.code_hash.length && timingSafeEqual(Buffer.from(expected), Buffer.from(c.code_hash));
    if (!ok) {
      db().query('UPDATE phone_challenges SET attempts = attempts + 1 WHERE id = ?').run(c.id);
      const left = SMS_TRIES - c.attempts - 1;
      return bad(res, 400, left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', left > 0 ? 'wrong_code' : 'too_many');
    }
    db().query("UPDATE phone_challenges SET status = 'verified', from_phone = phone WHERE id = ?").run(c.id);
    res.json(verifiedPayload(c.phone));
  });

  /** The number is proven: a phone token, plus what the device needs for a new or existing account. */
  function verifiedPayload(phone: string) {
    const acct = db().query('SELECT address, salt FROM phone_accounts WHERE phone = ?').get(phone) as Pick<PhoneAccount, 'address' | 'salt'> | null;
    let serverShare: string | undefined;
    if (!acct) {
      // New account: hand out the server share now (the number is proven) so the device can lock its key with it.
      const pending = db().query('SELECT server_share FROM phone_pending_shares WHERE phone = ?').get(phone) as { server_share: string } | null;
      serverShare = pending?.server_share ?? `0x${randomBytes(32).toString('hex')}`;
      db().query('INSERT OR REPLACE INTO phone_pending_shares (phone, server_share, created_at) VALUES (?, ?, ?)').run(phone, serverShare, Date.now());
    }
    return { ok: true, status: 'verified', phoneToken: issuePhoneToken(phone), phone, exists: !!acct, ...(acct ? { salt: acct.salt, address: acct.address } : { serverShare }) };
  }

  /** New account: store the locked backup (the server never sees the key or the PIN). */
  app.post('/api/phone/account', (req: Request, res: Response) => {
    const phone = verifyPhoneToken(req.body?.phoneToken);
    if (!phone) return bad(res, 401, 'Your phone check expired. Start again.', 'expired');
    const { address, salt, pinProof, blob, iv } = (req.body ?? {}) as Record<string, string>;
    if (!isAddress(address) || ![salt, pinProof, blob, iv].every(v => typeof v === 'string' && isHex(v))) return bad(res, 400, 'Invalid account data.');
    if (db().query('SELECT 1 FROM phone_accounts WHERE phone = ?').get(phone)) return bad(res, 409, 'This number already has an account. Sign in with your PIN instead.', 'exists');
    const pending = db().query('SELECT server_share FROM phone_pending_shares WHERE phone = ?').get(phone) as { server_share: string } | null;
    if (!pending) return bad(res, 409, 'Your phone check expired. Start again.', 'expired');
    db().query('INSERT INTO phone_accounts (phone, address, salt, verifier, server_share, blob, iv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(phone, address.toLowerCase(), salt, pinVerifier(pinProof), pending.server_share, blob, iv, Date.now());
    db().query('DELETE FROM phone_pending_shares WHERE phone = ?').run(phone);
    res.json({ ok: true });
  });

  /** Existing account: check the PIN (rate-limited) and return what the device needs to unlock its key. */
  app.post('/api/phone/unlock', (req: Request, res: Response) => {
    const phone = verifyPhoneToken(req.body?.phoneToken);
    if (!phone) return bad(res, 401, 'Your phone check expired. Start again.', 'expired');
    const a = db().query('SELECT * FROM phone_accounts WHERE phone = ?').get(phone) as PhoneAccount | null;
    if (!a) return bad(res, 404, 'No account for this number yet.', 'no_account');
    const now = Date.now();
    const wait = (ms: number) => (ms >= 3600_000 ? `${Math.ceil(ms / 3600_000)} hours` : `${Math.ceil(ms / 60_000)} minutes`);
    if (a.locked_until > now) return bad(res, 423, `Too many wrong PINs. Try again in ${wait(a.locked_until - now)}.`, 'locked');
    const proof = typeof req.body?.pinProof === 'string' ? req.body.pinProof : '';
    const ok = proof && pinVerifier(proof) === a.verifier;
    if (!ok) {
      const failed = a.failed + 1;
      const lockMs = failed % TRIES_PER_LOCK === 0 ? (failed === TRIES_PER_LOCK ? FIRST_LOCK_MS : LONG_LOCK_MS) : 0;
      db().query('UPDATE phone_accounts SET failed = ?, locked_until = ? WHERE phone = ?').run(failed, lockMs ? now + lockMs : 0, phone);
      const left = TRIES_PER_LOCK - (failed % TRIES_PER_LOCK);
      return bad(res, 401, lockMs ? `Wrong PIN. Too many tries — wait ${wait(lockMs)} and try again.`
        : `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a ${failed < TRIES_PER_LOCK ? '15-minute' : '24-hour'} lock.`, 'wrong_pin');
    }
    db().query('UPDATE phone_accounts SET failed = 0, locked_until = 0 WHERE phone = ?').run(phone);
    res.json({ ok: true, address: a.address, serverShare: a.server_share, blob: a.blob, iv: a.iv, salt: a.salt });
  });
}

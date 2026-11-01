/**
 * Handova WhatsApp Bot Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives WhatsApp messages from Twilio (text, images, voice notes).
 * Uses an LLM (Groq free tier, or OpenAI) to parse a listing from a landlord's message/voice note.
 * Returns the parsed listing as JSON + a Twilio TwiML reply.
 *
 * ENV vars needed:
 *   TWILIO_ACCOUNT_SID       — from console.twilio.com
 *   TWILIO_AUTH_TOKEN        — from console.twilio.com
 *   TWILIO_WHATSAPP_NUMBER   — e.g. whatsapp:+14155238886 (Twilio Sandbox)
 *   GROQ_API_KEY             — free at console.groq.com (preferred), or
 *   OPENAI_API_KEY           — from platform.openai.com (used when GROQ_API_KEY is unset)
 *   AI_CHAT_MODEL / AI_TRANSCRIBE_MODEL — optional model overrides
 *   BOT_SECRET               — any random string, used to auth the admin /api/bot/* calls
 *   APP_URL                  — optional public app URL; replies include a tap-to-claim link
 *
 * Flow: landlord messages the bot → AI parses a draft → bot replies with a 6-digit claim code →
 * landlord enters the code in the app (or taps the link) and publishes from their OWN wallet,
 * so they are the onchain owner and receive the rent.
 *
 * Twilio Webhook URL to set in Twilio Sandbox:
 *   https://<your-preview-hostname>/api/whatsapp/incoming
 *   (During dev: use ngrok or a similar tunnel pointed at port 3001)
 */

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import twilio from 'twilio';
import { mountVerification } from './verification';
import { mountMedia, saveRemoteMedia } from './media';
import { mountAuth } from './auth';
import { featureConfigFromEnv, mountFeatures } from './features';
import { mountInspections } from './inspections';
import { mountChat } from './chat';
import { handleInboundLogin, mountPhoneAuth } from './phone-auth';
import { mountOwnership } from './ownership';
import { mountAdmin } from './admin';
import { mountCash } from './cash';
import { mountSavings, vaultFromEnv } from './savings';
import { mountListingStats } from './listing-stats';
import { backupConfigFromEnv, scheduleBackups } from './backup';
import { openDrafts, type Draft } from './drafts';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '6mb' })); // selfies for /api/verify are a few MB of base64

// ── AI client ────────────────────────────────────────────────────────────────
// Groq's API is OpenAI-compatible, so the same SDK talks to either provider.
const useGroq = !!process.env.GROQ_API_KEY;
const aiConfigured = useGroq || !!process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.AI_CHAT_MODEL ?? (useGroq ? 'openai/gpt-oss-120b' : 'gpt-4o-mini');
const TRANSCRIBE_MODEL = process.env.AI_TRANSCRIBE_MODEL ?? (useGroq ? 'whisper-large-v3-turbo' : 'whisper-1');

// Created lazily so the server still boots (and serves the admin API) without a key.
let aiClient: OpenAI | null = null;
function ai(): OpenAI {
  if (!aiConfigured) throw new Error('GROQ_API_KEY or OPENAI_API_KEY not set');
  aiClient ??= useGroq
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return aiClient;
}

// ── Twilio client ────────────────────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID ?? '',
  process.env.TWILIO_AUTH_TOKEN ?? '',
);

// ── In-memory pending listings queue ─────────────────────────────────────────
// In production, replace with a real database.
type PendingListing = Draft;
const drafts = openDrafts();

function newClaimCode(): string {
  for (;;) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!drafts.codeInUse(code)) return code;
  }
}

// Claim codes are the only credential for /api/bot/draft — throttle guessing per IP.
const failedLookups = new Map<string, { count: number; resetAt: number }>();
function tooManyFailures(ip: string): boolean {
  const entry = failedLookups.get(ip);
  return !!entry && entry.resetAt > Date.now() && entry.count >= 20;
}
function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failedLookups.get(ip);
  if (!entry || entry.resetAt < now) failedLookups.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
  else entry.count++;
}

/** Draft as shown to the landlord — never exposes the sender's full phone number. */
function publicDraft(l: PendingListing) {
  return {
    code: l.code,
    location: l.location,
    rooms: l.rooms,
    rentNgn: l.rentNgn,
    depositNgn: l.depositNgn,
    description: l.description,
    amenities: l.amenities,
    media: l.media,
    phoneHint: l.from.replace(/^whatsapp:/, '').replace(/\d(?=\d{3})/g, '•'),
    status: l.status,
  };
}

// ── System prompt for listing extraction ─────────────────────────────────────
const SYSTEM_PROMPT = `You are Handova AI assistant helping Lagos landlords list their properties.
Extract property listing details from the landlord's message (which may be in English, Yoruba, Pidgin, Igbo, or Hausa).

Return ONLY a valid JSON object with these fields:
{
  "location": "area name in Lagos (string, e.g. Lekki Phase 1, Yaba, Victoria Island)",
  "rooms": number of bedrooms (integer 1-10),
  "rentNgn": annual rent in Nigerian Naira (integer),
  "depositNgn": security deposit in Nigerian Naira (integer, if not stated use same as rentNgn),
  "description": "brief property description in English (1-2 sentences)",
  "amenities": ["list", "of", "amenities"] from: Generator, Borehole, Security, Parking, Tiled, Fenced, CCTV, Pop Ceiling,
  "confidence": "high" | "medium" | "low"
}

If rent or location cannot be determined, set confidence to "low".
Common Nigerian rent abbreviations: 500k = 500,000, 1.2m = 1,200,000, 800k = 800,000.
If message is in Nigerian Pidgin/Yoruba/Igbo/Hausa, translate and extract accordingly.`;

// ── Parse listing from text ───────────────────────────────────────────────────
async function parseListingFromText(text: string): Promise<Omit<PendingListing, 'id' | 'code' | 'from' | 'mediaUrls' | 'media' | 'rawMessage' | 'parsedAt' | 'status'>> {
  const completion = await ai().chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000, // headroom for reasoning models
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as {
    location?: string;
    rooms?: number;
    rentNgn?: number;
    depositNgn?: number;
    description?: string;
    amenities?: string[];
  };

  return {
    location: parsed.location ?? 'Lagos (location not specified)',
    rooms: parsed.rooms ?? 1,
    rentNgn: parsed.rentNgn ?? 0,
    depositNgn: parsed.depositNgn ?? (parsed.rentNgn ?? 0),
    description: parsed.description ?? text.slice(0, 200),
    amenities: parsed.amenities ?? [],
  };
}

// ── Transcribe voice note via Whisper ─────────────────────────────────────────
async function transcribeAudio(mediaUrl: string, twilioSid: string, twilioToken: string): Promise<string> {
  // Download from Twilio (requires Basic auth)
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
  const resp = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch audio: ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const blob = new Blob([arrayBuf], { type: 'audio/ogg' });
  const file = new File([blob], 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await ai().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    language: 'en', // Whisper auto-detects Nigerian languages well
  });

  return transcription.text;
}

// ── Build TwiML reply ─────────────────────────────────────────────────────────
function twimlReply(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;
}

// ── POST /api/whatsapp/incoming — Twilio webhook ──────────────────────────────
/**
 * Only accept webhooks Twilio actually signed (X-Twilio-Signature = HMAC of the public URL + params with
 * our auth token). Twilio signs the URL configured in the console, so behind a tunnel/proxy we rebuild it
 * from the forwarded host/proto — or set PUBLIC_WEBHOOK_URL explicitly.
 */
function isFromTwilio(req: express.Request): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || process.env.TWILIO_VALIDATE_SIGNATURE === 'false') return true;
  const signature = req.header('x-twilio-signature') ?? '';
  const proto = (req.header('x-forwarded-proto') ?? req.protocol).split(',')[0].trim();
  const host = req.header('x-forwarded-host') ?? req.header('host') ?? '';
  const url = process.env.PUBLIC_WEBHOOK_URL || `${proto}://${host}${req.originalUrl}`;
  return twilio.validateRequest(token, signature, url, (req.body ?? {}) as Record<string, string>);
}

app.post('/api/whatsapp/incoming', async (req, res) => {
  if (!isFromTwilio(req)) {
    console.error('[Handova Bot] Rejected webhook with an invalid Twilio signature');
    res.status(403).send('Invalid signature');
    return;
  }
  try {
    // Validate Twilio signature in production
    const body = req.body as Record<string, string>;
    const from: string = body.From ?? '';
    const msgBody: string = body.Body ?? '';
    const numMedia = parseInt(body.NumMedia ?? '0', 10);

    // "HANDOVA LOGIN 123456" — someone proving their number for phone sign-in, not a listing.
    const loginReply = handleInboundLogin(from, msgBody);
    if (loginReply) { res.set('Content-Type', 'text/xml').send(twimlReply(loginReply)); return; }

    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      mediaUrls.push(body[`MediaUrl${i}`] ?? '');
      mediaTypes.push(body[`MediaContentType${i}`] ?? '');
    }

    // Build text to parse
    let textToParse = msgBody;

    // If a voice note is attached, transcribe it first
    const voiceIndex = mediaTypes.findIndex(t => t.startsWith('audio/'));
    if (voiceIndex !== -1 && aiConfigured && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const transcript = await transcribeAudio(
          mediaUrls[voiceIndex],
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
        );
        textToParse = `${msgBody} [Voice note transcript: ${transcript}]`;
      } catch (err) {
        console.error('[Handova Bot] Voice transcription failed:', err instanceof Error ? err.message : err);
        // Fall back to text-only parsing
      }
    }

    // If no meaningful text, send a prompt
    if (!textToParse.trim() || textToParse.trim().length < 10) {
      res.set('Content-Type', 'text/xml').send(
        twimlReply(
          'Welcome to Handova! Send me details about your property to list it.\n\nExample:\n"2 bedroom flat in Lekki Phase 1, ₦800k per year, generator and security"',
        ),
      );
      return;
    }

    // Parse listing with AI
    let parsed;
    try {
      parsed = await parseListingFromText(textToParse);
    } catch (err) {
      console.error('[Handova Bot] Listing parse failed:', err instanceof Error ? err.message : err);
      res.set('Content-Type', 'text/xml').send(
        twimlReply('Sorry, I could not understand the property details. Please try again with location, number of rooms, and rent amount.'),
      );
      return;
    }

    // Store in pending queue
    // Copy photos/videos the landlord sent into our media store (Twilio's URLs require our credentials).
    const media: PendingListing['media'] = [];
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      for (let i = 0; i < mediaUrls.length && media.length < 10; i++) {
        if (!/^(image|video)\//.test(mediaTypes[i] ?? '')) continue;
        const saved = await saveRemoteMedia(mediaUrls[i], { user: process.env.TWILIO_ACCOUNT_SID, pass: process.env.TWILIO_AUTH_TOKEN });
        if (saved) media.push(saved);
      }
    }

    const listing: PendingListing = {
      id: Math.random().toString(36).slice(2),
      code: newClaimCode(),
      from,
      ...parsed,
      mediaUrls: mediaUrls.filter((_, i) => mediaTypes[i]?.startsWith('image/')),
      media,
      rawMessage: msgBody,
      parsedAt: Date.now(),
      status: 'pending',
    };
    drafts.insert(listing);

    // Send confirmation back to landlord
    const rentFormatted = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(parsed.rentNgn);
    const replyMsg = parsed.rentNgn > 0
      ? `✅ Got it! Here's what I captured:\n\n📍 ${parsed.location}\n🛏 ${parsed.rooms} bedroom(s)\n💰 ${rentFormatted}/year\n📝 ${parsed.description}\n${media.length ? `📷 ${media.length} photo/video${media.length > 1 ? 's' : ''} saved` : '📷 Tip: send photos of the house too — listings with photos get more tenants'}\n\n🔑 Your Handova code: *${listing.code}*\n${process.env.APP_URL ? `Tap to publish: ${process.env.APP_URL.replace(/\/$/, '')}/landlord/whatsapp?wa=${listing.code}` : 'Open Handova → Landlord → List by WhatsApp, enter this code, check the details and confirm the address on the map.'}`
      : `I received your message but couldn't find the rent amount. Please reply with: location, rooms, and rent. E.g. "2 bed Yaba 600k per year"`;

    res.set('Content-Type', 'text/xml').send(twimlReply(replyMsg));
  } catch (err) {
    console.error('[WhatsApp Bot] Error:', err);
    res.set('Content-Type', 'text/xml').send(
      twimlReply('Something went wrong. Please try again.'),
    );
  }
});

// ── GET /api/bot/draft/:code — landlord fetches their own draft by claim code ──
app.get('/api/bot/draft/:code', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (tooManyFailures(ip)) { res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' }); return; }
  const listing = drafts.pendingByCode(req.params.code);
  if (!listing) { recordFailure(ip); res.status(404).json({ error: 'Code not found or already used.' }); return; }
  res.json(publicDraft(listing));
});

// ── POST /api/bot/draft/:code/published — landlord published it onchain ───────
app.post('/api/bot/draft/:code/published', async (req, res) => {
  const listing = drafts.pendingByCode(req.params.code);
  if (!listing) { res.status(404).json({ error: 'Code not found or already used.' }); return; }
  drafts.setStatus(listing.id, 'published');
  // Best-effort WhatsApp confirmation. Twilio may refuse free-text business messages (it can require a
  // pre-approved template — "ContentSid Required"), so report whether it actually went out.
  let notified = false;
  if (process.env.TWILIO_WHATSAPP_NUMBER && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: listing.from,
        body: `🎉 Your property in ${listing.location} is now LIVE on Handova! Tenants can find it directly — no agent fee.`,
      });
      notified = true;
    } catch (err) {
      const e = err as { message?: string; code?: number };
      console.error(`[Handova Bot] Confirmation message failed${e.code ? ` (Twilio ${e.code})` : ''}: ${e.message ?? err}`);
    }
  }
  res.json({ ok: true, notified });
});

// ── Admin moderation (requires BOT_SECRET; not called from the browser) ───────
// ── GET /api/bot/pending — fetch pending listings (admin only) ─────────────
app.get('/api/bot/pending', (req, res) => {
  const secret = req.headers['x-bot-secret'];
  if (secret !== process.env.BOT_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json(drafts.listPending());
});

// ── POST /api/bot/reject ──────────────────────────────────────────────────────
app.post('/api/bot/reject', (req, res) => {
  const secret = req.headers['x-bot-secret'];
  if (secret !== process.env.BOT_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { id } = req.body as { id?: string };
  const listing = typeof id === 'string' ? drafts.byId(id) : null;
  if (!listing) { res.status(404).json({ error: 'Not found' }); return; }
  drafts.setStatus(listing.id, 'rejected');
  res.json({ ok: true });
});

mountVerification(app);
mountMedia(app);
mountAuth(app);
mountFeatures(app);
// Inspection updates and chat nudges also go to WhatsApp when Twilio can deliver them (the sandbox only reaches numbers that
// joined it, and business-started chats may need a template), so the app never claims a message it didn't send.
const whatsappNotify = async (phone: string, body: string) => {
  if (!process.env.TWILIO_WHATSAPP_NUMBER || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return false;
  try {
    await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: `whatsapp:+${phone}`, body });
    return true;
  } catch (err) {
    const e = err as { message?: string; code?: number };
    console.error(`[Handova Bot] WhatsApp notification failed${e.code ? ` (Twilio ${e.code})` : ''}: ${e.message ?? err}`);
    return false;
  }
};
mountInspections(app, featureConfigFromEnv(), whatsappNotify);
mountChat(app, featureConfigFromEnv(), whatsappNotify);
mountPhoneAuth(app);
mountOwnership(app, featureConfigFromEnv());
mountAdmin(app, featureConfigFromEnv());
mountCash(app, featureConfigFromEnv(), whatsappNotify);
mountListingStats(app, featureConfigFromEnv());
const savings = mountSavings(app, vaultFromEnv(), whatsappNotify);
// Savings reminders: check hourly; each plan gets at most one a day.
setInterval(() => { savings.sendReminders().catch(e => console.error('[Savings] Reminders failed:', e instanceof Error ? e.message : e)); }, 3600_000).unref();

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: {
      twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      openai: aiConfigured,
      aiProvider: aiConfigured ? (useGroq ? 'groq' : 'openai') : null,
      botSecret: !!process.env.BOT_SECRET,
    },
  });
});

// Encrypted daily backups of the database (see server/backup.ts).
scheduleBackups(backupConfigFromEnv());

app.listen(PORT, () => {
  console.log(`[Handova Bot] Server running on port ${PORT}`);
  console.log(`[Handova Bot] Webhook URL: http://localhost:${PORT}/api/whatsapp/incoming`);
  if (!aiConfigured) console.warn('[Handova Bot] WARNING: neither GROQ_API_KEY nor OPENAI_API_KEY is set');
  else console.log(`[Handova Bot] AI provider: ${useGroq ? 'Groq' : 'OpenAI'} (${CHAT_MODEL}, ${TRANSCRIBE_MODEL})`);
  if (!process.env.TWILIO_ACCOUNT_SID) console.warn('[Handova Bot] WARNING: TWILIO_ACCOUNT_SID not set');
});

export default app;

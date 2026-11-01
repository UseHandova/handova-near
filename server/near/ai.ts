/**
 * NEAR AI Cloud: private, verifiable AI. AI drafts, people decide.
 *
 * - Voice note or text → draft listing (the landlord checks it before anything goes on-chain).
 * - Ownership/ID document → pre-check that flags mismatches for the admin. Never approves.
 *
 * We only use models NEAR AI runs inside TEEs. Every answer comes with a receipt the server
 * checks itself: the TEE signed `model:sha256(request):sha256(response)`, the signer is the key in
 * the model's attestation report, and the hashes match the exact bytes we sent and received.
 */
import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { env } from './config';
import { RateLimit } from './rate-limit';

const BASE = env('NEARAI_BASE_URL') ?? 'https://cloud-api.near.ai/v1';
export const CHAT_MODEL = env('NEARAI_CHAT_MODEL') ?? 'z-ai/glm-5.3-flash';
export const VISION_MODEL = env('NEARAI_VISION_MODEL') ?? 'Qwen/Qwen3-VL-30B-A3B-Instruct';
export const TRANSCRIBE_MODEL = env('NEARAI_TRANSCRIBE_MODEL') ?? 'openai/whisper-large-v3';

export interface Receipt {
  provider: 'NEAR AI Cloud';
  chatId: string;
  model: string;
  requestHash: string;
  responseHash: string;
  signedText: string;
  signature: string;
  signingAddress: string;
  /** Hashes match, signature recovers to signingAddress, and that key is in the model's TEE attestation. */
  verified: boolean;
  checks: { hashesMatch: boolean; signatureValid: boolean; keyAttested: boolean };
  attestationUrl: string;
}

function key(): string {
  const k = env('NEARAI_API_KEY');
  if (!k) throw new Error('NEARAI_API_KEY is not set');
  return k;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function nearai(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${key()}`, ...(init.headers as any) } });
}

const attestedKeys = new Map<string, { at: number; keys: Set<string> }>();

async function attestedSigners(model: string): Promise<Set<string>> {
  const hit = attestedKeys.get(model);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.keys;
  const r = await nearai(`/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`);
  const d: any = await r.json();
  const keys = new Set<string>((d.model_attestations ?? []).map((m: any) => String(m.signing_address).toLowerCase()));
  attestedKeys.set(model, { at: Date.now(), keys });
  return keys;
}

/** Fetch and check the TEE signature for a finished chat completion. */
export async function receiptFor(chatId: string, model: string, requestText: string, responseText: string): Promise<Receipt> {
  let sig: any = null;
  for (let i = 0; i < 4 && !sig?.signature; i++) {
    if (i) await new Promise((r) => setTimeout(r, 750 * i));
    const r = await nearai(`/signature/${chatId}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`);
    if (r.ok) sig = await r.json();
  }
  const requestHash = sha256(requestText);
  const responseHash = sha256(responseText);
  const signedText: string = sig?.text ?? '';
  const signingAddress: string = (sig?.signing_address ?? '').toLowerCase();
  const hashesMatch = signedText === `${model}:${requestHash}:${responseHash}`;
  let signatureValid = false;
  try {
    const recovered = await recoverMessageAddress({ message: signedText, signature: sig.signature });
    signatureValid = recovered.toLowerCase() === signingAddress;
  } catch {
    signatureValid = false;
  }
  const keyAttested = signingAddress ? (await attestedSigners(model)).has(signingAddress) : false;
  return {
    provider: 'NEAR AI Cloud',
    chatId,
    model,
    requestHash,
    responseHash,
    signedText,
    signature: sig?.signature ?? '',
    signingAddress,
    verified: hashesMatch && signatureValid && keyAttested,
    checks: { hashesMatch, signatureValid, keyAttested },
    attestationUrl: `${BASE}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`,
  };
}

/** One JSON-mode chat completion with its verification receipt. */
export async function verifiedJson<T>(model: string, messages: unknown[], maxTokens = 800): Promise<{ data: T; receipt: Receipt }> {
  try {
    return await verifiedJsonOnce<T>(model, messages, maxTokens);
  } catch (e) {
    // Models occasionally time out or return broken JSON; one retry fixes most of it.
    console.warn(`NEAR AI retry (${model}):`, (e as Error).message.slice(0, 200));
    return verifiedJsonOnce<T>(model, messages, maxTokens);
  }
}

async function verifiedJsonOnce<T>(model: string, messages: unknown[], maxTokens: number): Promise<{ data: T; receipt: Receipt }> {
  const requestText = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0, response_format: { type: 'json_object' } });
  const r = await nearai('/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestText });
  const responseText = await r.text();
  if (!r.ok) throw new Error(`NEAR AI ${r.status}: ${responseText.slice(0, 200)}`);
  const body = JSON.parse(responseText);
  const content: string = body.choices?.[0]?.message?.content ?? '';
  const data = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
  return { data, receipt: await receiptFor(body.id, model, requestText, responseText) };
}

export async function transcribe(audio: Uint8Array, mime: string): Promise<string> {
  const form = new FormData();
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('wav') ? 'wav' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm';
  form.append('file', new Blob([audio], { type: mime }), `voice.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  const r = await nearai('/audio/transcriptions', { method: 'POST', body: form });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Transcription failed (${r.status}): ${JSON.stringify(body).slice(0, 200)}`);
  return String(body.text ?? '').trim();
}

export interface ListingDraft {
  title: string;
  area: string;
  city: string;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string;
  rentNgn: number | null;
  rentPeriod: 'year' | 'month' | null;
  cautionNgn: number | null;
  amenities: string[];
  description: string;
  language: string;
  missing: string[];
  confidence: 'high' | 'medium' | 'low';
}

const LISTING_PROMPT = `You turn a Nigerian landlord's message (often a transcribed voice note in English, Nigerian Pidgin, Yorùbá, Igbo or Hausa) into a draft rental listing for Handova.
Return ONLY a JSON object:
{"title": short English title, "area": neighbourhood (e.g. Yaba, Lekki Phase 1), "city": city (default "Lagos" only if a Lagos area is named),
 "bedrooms": integer or null, "bathrooms": integer or null, "propertyType": one of "self-contain","mini-flat","flat","duplex","room","shop","office","other",
 "rentNgn": rent in Naira as an integer or null, "rentPeriod": "year" or "month" or null,
 "cautionNgn": refundable caution/security deposit in Naira as an integer or null,
 "amenities": array from ["Prepaid meter","Borehole","Security","Parking","Tiled","Fenced","POP ceiling","Kitchen cabinets","Wardrobe","Generator","CCTV","Water heater"],
 "description": 1-2 plain English sentences, "language": language the landlord spoke,
 "missing": array of fields you could not find, "confidence": "high"|"medium"|"low"}
Rules: 500k = 500000, 1.2m = 1200000, "one million two" = 1200000. Never invent numbers: use null and list the field in "missing".
Ignore agent fees and commission — Handova has none. Do not include phone numbers or names.`;

export async function draftListing(text: string) {
  return verifiedJson<ListingDraft>(CHAT_MODEL, [
    { role: 'system', content: LISTING_PROMPT },
    { role: 'user', content: text.slice(0, 4000) },
  ]);
}

export interface DocumentCheck {
  documentType: string;
  nameOnDocument: string | null;
  addressOnDocument: string | null;
  nameMatches: boolean | null;
  addressMatches: boolean | null;
  flags: string[];
  summary: string;
}

const DOC_PROMPT = `You help a human reviewer at Handova, a Lagos rental platform, pre-check a landlord's proof of ownership or ID.
Read the document image. Return ONLY JSON:
{"documentType": e.g. "Certificate of Occupancy","Deed of Assignment","Governor's Consent","Utility bill","National ID","Other",
 "nameOnDocument": string or null, "addressOnDocument": string or null,
 "nameMatches": true/false/null versus the expected name, "addressMatches": true/false/null versus the expected address,
 "flags": short list of things the reviewer should look at (unreadable parts, mismatches, signs of editing, expired dates),
 "summary": one sentence}
You never approve or reject — the human decides.`;

export async function checkDocument(imageDataUrl: string, expectedName: string, expectedAddress: string) {
  return verifiedJson<DocumentCheck>(VISION_MODEL, [
    { role: 'system', content: DOC_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Expected name: ${expectedName || 'unknown'}\nExpected property address: ${expectedAddress || 'unknown'}` },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ]);
}

const perIp = new RateLimit(30, 60 * 60_000);
const MAX_AUDIO = 8 * 1024 * 1024;

export function mountAi(app: Express) {
  app.post('/api/ai/listing-draft', async (req, res) => {
    if (!env('NEARAI_API_KEY')) return res.status(503).json({ error: 'AI drafting is switched off on this server. Fill the form by hand.' });
    if (!perIp.take(req.ip ?? 'ip')) return res.status(429).json({ error: 'Too many drafts. Try again later.' });
    try {
      let transcript: string | undefined;
      let text = String(req.body?.text ?? '');
      if (req.body?.audioBase64) {
        const audio = Buffer.from(String(req.body.audioBase64), 'base64');
        if (audio.length > MAX_AUDIO) return res.status(413).json({ error: 'Voice note is too long. Keep it under 2 minutes.' });
        transcript = await transcribe(audio, String(req.body.mime ?? 'audio/webm'));
        text = transcript;
      }
      if (text.trim().length < 10) return res.status(400).json({ error: 'Say or type a little more about the home: area, rooms and rent.' });
      const { data, receipt } = await draftListing(text);
      res.json({ transcript, draft: data, receipt });
    } catch (e) {
      console.error('listing-draft:', (e as Error).message);
      res.status(502).json({ error: 'The AI could not read that. Try again or fill the form by hand.', detail: (e as Error).message.slice(0, 300) });
    }
  });

  app.post('/api/ai/document-check', async (req, res) => {
    if (!env('NEARAI_API_KEY')) return res.status(503).json({ error: 'Document pre-check is switched off on this server.' });
    if (!perIp.take(req.ip ?? 'ip')) return res.status(429).json({ error: 'Too many checks. Try again later.' });
    const { imageBase64, mime, expectedName, expectedAddress } = req.body ?? {};
    if (!imageBase64 || !/^image\/(png|jpe?g|webp)$/.test(String(mime))) return res.status(400).json({ error: 'Send a PNG, JPG or WebP photo of the document.' });
    try {
      const { data, receipt } = await checkDocument(`data:${mime};base64,${imageBase64}`, String(expectedName ?? ''), String(expectedAddress ?? ''));
      res.json({ check: data, receipt, note: 'AI pre-check only. A person at Handova makes the decision.' });
    } catch (e) {
      res.status(502).json({ error: 'The AI could not read the document. A reviewer will check it by hand.', detail: (e as Error).message.slice(0, 300) });
    }
  });
}

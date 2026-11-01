/**
 * Firebase Phone Auth as the SMS route — no Nigerian sender ID or CAC certificate needed (Google sends the codes).
 * The browser runs Firebase's SMS flow and sends us the resulting ID token; we verify it here against Google's
 * public keys (no service-account key needed) and take the phone number from it.
 *
 * Env: FIREBASE_PROJECT_ID (server) and the VITE_FIREBASE_* web config (browser).
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_AGE_S = 10 * 60; // the SMS sign-in must have just happened

let remote: JWTVerifyGetKey | null = null;

export class FirebaseTokenError extends Error {}

/** Verified E.164 digits (e.g. "2348031234567") from a fresh Firebase phone sign-in, or throws. */
export async function verifyFirebasePhoneToken(idToken: string, projectId: string, keys?: JWTVerifyGetKey, now = Date.now()): Promise<string> {
  if (!idToken || !projectId) throw new FirebaseTokenError('Missing token.');
  remote ??= createRemoteJWKSet(new URL(GOOGLE_KEYS));
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys ?? remote, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
      currentDate: new Date(now),
    }));
  } catch {
    throw new FirebaseTokenError('That sign-in couldn\'t be verified. Please try again.');
  }
  const authTime = Number(payload.auth_time);
  if (!authTime || now / 1000 - authTime > MAX_AGE_S) throw new FirebaseTokenError('That code was confirmed too long ago. Please start again.');
  const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (provider !== 'phone') throw new FirebaseTokenError('That sign-in wasn\'t a phone code.');
  const phone = typeof payload.phone_number === 'string' ? payload.phone_number.replace(/\D/g, '') : '';
  if (!/^\d{10,15}$/.test(phone)) throw new FirebaseTokenError('No phone number in that sign-in.');
  return phone;
}

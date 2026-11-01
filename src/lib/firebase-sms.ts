/**
 * Firebase Phone Auth for SMS codes (used when the server says SMS goes through Firebase).
 * Firebase is loaded only when someone actually asks for an SMS code. We use Firebase just to prove the number:
 * the resulting ID token goes to our server, and we sign straight back out of Firebase.
 */

import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
export const firebaseConfigured = !!(config.apiKey && config.projectId && config.authDomain);

let verifier: RecaptchaVerifier | null = null;

async function auth() {
  const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = getApps()[0] ?? initializeApp(config);
  const a = getAuth(app);
  a.languageCode = 'en';
  // Development only: automated tests can skip the reCAPTCHA check. Firebase allows this only for the fictional
  // "phone numbers for testing", and this branch is stripped from production builds.
  if (import.meta.env.DEV) {
    try { if (localStorage.getItem('handova-firebase-test') === '1') a.settings.appVerificationDisabledForTesting = true; } catch { /* storage unavailable */ }
  }
  return a;
}

/** Plain-language messages for Firebase's error codes. */
export function firebaseError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-phone-number': 'That phone number doesn\'t look right. Use the format 0803 123 4567.',
    'auth/too-many-requests': 'Too many attempts from this device. Please wait a while and try again, or use WhatsApp.',
    'auth/quota-exceeded': 'We\'ve hit today\'s SMS limit. Please use WhatsApp for now, or try again tomorrow.',
    'auth/invalid-verification-code': 'That code isn\'t right. Check the SMS and try again.',
    'auth/code-expired': 'That code has expired. Ask for a new one.',
    'auth/captcha-check-failed': 'The security check failed. Please refresh the page and try again.',
    'auth/operation-not-allowed': 'SMS sign-in isn\'t switched on yet. Please use WhatsApp for now.',
    'auth/billing-not-enabled': 'SMS sign-in isn\'t switched on yet. Please use WhatsApp for now.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
  };
  return map[code] ?? 'We couldn\'t send the SMS just now. Try again in a minute, or use WhatsApp instead.';
}

/** Text a code to `e164` (digits, e.g. 2348031234567). `containerId` is an empty element for the invisible check. */
export async function sendFirebaseSms(e164: string, containerId: string): Promise<ConfirmationResult> {
  const a = await auth();
  const { RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');
  verifier?.clear();
  verifier = new RecaptchaVerifier(a, containerId, { size: 'invisible' });
  return signInWithPhoneNumber(a, `+${e164}`, verifier);
}

/** Check the typed code; returns a Firebase ID token for our server, then signs out of Firebase. */
export async function confirmFirebaseSms(confirmation: ConfirmationResult, code: string): Promise<string> {
  const cred = await confirmation.confirm(code);
  const idToken = await cred.user.getIdToken();
  await (await auth()).signOut();
  return idToken;
}

/**
 * A NEAR key from a passkey (Face ID, Touch ID, the phone's lock).
 *
 * NEAR accounts take ed25519 keys, and a passkey can't sign ed25519. What it can do, with the
 * WebAuthn PRF extension, is hand back the same secret 32 bytes every time the person unlocks it.
 * Those bytes are the seed of the account's key: the key is made on the device, the server only
 * ever sees the public half, and a passkey synced through iCloud Keychain or Google Password
 * Manager brings the same key to the next phone. No name to type, no words to write down.
 *
 * Browsers without PRF (Firefox, older iPhones) get the name-and-phrase path instead.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64urlnopad } from '@scure/base';
import { KeyPair, type KeyPairString } from 'near-api-js';

const RP_NAME = 'Handova';
/** Fixed per app: a different salt would give a different key from the same passkey. */
const SALT = new TextEncoder().encode('handova:near-account-key:v1');
const PRF = { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs;

export interface PasskeyKey {
  /** The passkey's id, so sign-in can ask for this one directly. Not secret. */
  credentialId: string;
  keyPair: KeyPair;
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create && window.isSecureContext;
}

function seedOf(cred: PublicKeyCredential): Uint8Array | null {
  const r = (cred.getClientExtensionResults() as any)?.prf?.results?.first;
  return r ? new Uint8Array(r) : null;
}

export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) throw new Error('The passkey gave an unexpected key size.');
  const secret = new Uint8Array(64);
  secret.set(seed);
  secret.set(ed25519.getPublicKey(seed), 32);
  return KeyPair.fromString(`ed25519:${base58.encode(secret)}` as KeyPairString);
}

const NO_PRF = "This browser's passkeys can't make an account key. Create an account with a name instead.";

function explain(e: unknown): Error {
  const err = e as DOMException;
  if (err?.name === 'NotAllowedError') return new Error('The fingerprint or passcode check was cancelled. Try again.');
  if (err?.name === 'InvalidStateError') return new Error('This device already has a Handova passkey. Use "Sign in with fingerprint".');
  if (err?.name === 'NotSupportedError' || err?.name === 'SecurityError') return new Error(NO_PRF);
  return err instanceof Error ? err : new Error(String(e));
}

/** Make a new passkey and the NEAR key it seeds. */
export async function createPasskey(label: string): Promise<PasskeyKey> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: PRF,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  if ((cred.getClientExtensionResults() as any)?.prf?.enabled === false) throw new Error(NO_PRF);
  // Chrome returns the PRF bytes at creation; Safari only on the first use, so ask once more.
  const seed = seedOf(cred);
  if (seed) return { credentialId: cred.id, keyPair: keyPairFromSeed(seed) };
  return getPasskey(cred.id);
}

/** Unlock a passkey (a given one, or whichever the person picks) and rebuild the NEAR key. */
export async function getPasskey(credentialId?: string): Promise<PasskeyKey> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        rpId: location.hostname,
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: 'required',
        allowCredentials: credentialId ? [{ type: 'public-key', id: base64urlnopad.decode(credentialId).slice().buffer as ArrayBuffer }] : [],
        extensions: PRF,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  const seed = seedOf(cred);
  if (!seed) throw new Error(NO_PRF);
  return { credentialId: cred.id, keyPair: keyPairFromSeed(seed) };
}

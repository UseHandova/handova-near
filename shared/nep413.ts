/**
 * NEP-413 signed messages: how a NEAR account proves "I control this account" without a transaction.
 * The signer signs sha256(tag || borsh(payload)) with one of the account's keys; the verifier checks
 * the ed25519 signature and that the key is a full-access key of the account.
 * https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 */
import { sha256 } from '@noble/hashes/sha2.js';

/** 2^31 + 413, little-endian: keeps a signed message from ever being valid as a transaction. */
const TAG = new Uint8Array([0x9d, 0x01, 0x00, 0x80]);

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

export interface Nep413Payload {
  message: string;
  /** Exactly 32 bytes, chosen by the verifier (single use). */
  nonce: Uint8Array;
  recipient: string;
}

/** The 32-byte hash that gets signed. */
export function nep413Hash({ message, nonce, recipient }: Nep413Payload): Uint8Array {
  if (nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  const parts = [TAG, borshString(message), nonce, borshString(recipient), new Uint8Array([0])]; // callbackUrl: None
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return sha256(all);
}

export interface SignedNep413 {
  accountId: string;
  /** "ed25519:<base58>" */
  publicKey: string;
  /** base64 */
  signature: string;
}

/**
 * Phone-number wallets: a normal key owns the Circle smart account (instead of a passkey).
 * The key is made here, locked with the person's PIN + a server share, and the locked copy is backed up on
 * the server (see server/phone-auth.ts). Neither the PIN nor the key ever leaves this device.
 *
 * On this device the key is kept in IndexedDB, wrapped by a non-extractable WebCrypto key — page scripts can
 * use it while the app is open, but can't copy the raw key out.
 */

import { toCircleSmartAccount } from '@circle-fin/modular-wallets-core';
import type { SmartAccount } from 'viem/account-abstraction';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { publicClient } from '@/lib/wallet';

const PBKDF2_ITERATIONS = 310_000;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const random = (n: number) => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
/** hex → bytes backed by a plain ArrayBuffer (what WebCrypto's types expect). */
const bytes = (h: Hex) => new Uint8Array(hexToBytes(h));

/** PINs people guess first. */
export function weakPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'Your PIN must be exactly 6 digits.';
  if (/^(\d)\1{5}$/.test(pin)) return 'Avoid the same digit six times.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Avoid counting up or down (like 123456).';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'Avoid repeating patterns (like 121212).';
  return null;
}

async function pinSecret(pin: string, salt: Hex): Promise<Uint8Array<ArrayBuffer>> {
  const base = await subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: PBKDF2_ITERATIONS }, base, 256);
  return new Uint8Array(bits);
}

async function proofFrom(secret: Uint8Array<ArrayBuffer>): Promise<Hex> {
  const k = await subtle().importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(new Uint8Array(await subtle().sign('HMAC', k, enc.encode('handova-pin-proof'))));
}

async function wrapKeyFrom(secret: Uint8Array<ArrayBuffer>, serverShare: Hex): Promise<CryptoKey> {
  const ikm = new Uint8Array([...secret, ...bytes(serverShare)]);
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('handova-wallet-wrap') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The PIN check sent to the server (one-way; the PIN itself is never sent). */
export async function pinProofFor(pin: string, salt: Hex) {
  return proofFrom(await pinSecret(pin, salt));
}

export async function smartAccountFor(privateKey: Hex): Promise<SmartAccount> {
  return toCircleSmartAccount({ client: publicClient, owner: privateKeyToAccount(privateKey) });
}

/** Lock a key with PIN + server share. Pure crypto (no network). */
export async function lockKey(pin: string, serverShare: Hex, privateKey: Hex) {
  const salt = random(16);
  const secret = await pinSecret(pin, salt);
  const iv = random(12);
  const blob = bytesToHex(new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: bytes(iv) }, await wrapKeyFrom(secret, serverShare), bytes(privateKey))));
  return { salt, iv, blob, pinProof: await proofFrom(secret) };
}

/** Open a locked key. Throws a plain-language error if the PIN or share is wrong. Pure crypto (no network). */
export async function openKey(pin: string, b: { salt: Hex; serverShare: Hex; blob: Hex; iv: Hex }): Promise<Hex> {
  const secret = await pinSecret(pin, b.salt);
  try {
    return bytesToHex(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes(b.iv) }, await wrapKeyFrom(secret, b.serverShare), bytes(b.blob))));
  } catch {
    throw new Error('Could not unlock your wallet with that PIN. Please try again.');
  }
}

/** New wallet: make a key, find its smart-account address, and lock it for the server backup. */
export async function createPhoneWallet(pin: string, serverShare: Hex) {
  const privateKey = generatePrivateKey();
  const locked = await lockKey(pin, serverShare, privateKey);
  const account = await smartAccountFor(privateKey);
  return { privateKey, account, backup: { address: account.address, ...locked } };
}

/** Existing wallet: open the server backup with the PIN and check it's the same account. */
export async function unlockPhoneWallet(pin: string, b: { salt: Hex; serverShare: Hex; blob: Hex; iv: Hex; address: string }) {
  const privateKey = await openKey(pin, b);
  const account = await smartAccountFor(privateKey);
  if (account.address.toLowerCase() !== b.address.toLowerCase()) throw new Error('Your wallet backup doesn\'t match this account. Contact Handova support.');
  return { privateKey, account };
}

// ── Keeping the key on this device ──────────────────────────────────────────────────────────────

const DB = 'handova-device', STORE = 'kv';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}
async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}

export async function saveDeviceKey(privateKey: Hex, phone: string) {
  const wrap = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, wrap, bytes(privateKey));
  await kv('readwrite', s => s.put({ wrap, iv, data, phone }, 'phone-wallet'));
}

export async function loadDeviceKey(): Promise<{ privateKey: Hex; phone: string } | null> {
  try {
    const rec = await kv<{ wrap: CryptoKey; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; phone: string } | undefined>('readonly', s => s.get('phone-wallet'));
    if (!rec) return null;
    const raw = await subtle().decrypt({ name: 'AES-GCM', iv: rec.iv }, rec.wrap, rec.data);
    return { privateKey: bytesToHex(new Uint8Array(raw)), phone: rec.phone };
  } catch { return null; }
}

export async function clearDeviceKey() {
  try { await kv('readwrite', s => s.delete('phone-wallet')); } catch { /* nothing stored */ }
}

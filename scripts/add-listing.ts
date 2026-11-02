/**
 * Publishes a real home on Handova from a JSON file: uploads its photos to the API, then creates the
 * listing on-chain as the listings landlord (a named Handova account whose key lives in .env).
 *
 *   bun scripts/add-listing.ts listings/ikorodu.json [--api https://handova-near.vercel.app]
 *
 * First run: creates the landlord account `<LISTINGS_LANDLORD_NAME>.handova.testnet` through the API
 * and appends LISTINGS_LANDLORD_ACCOUNT_ID / LISTINGS_LANDLORD_PRIVATE_KEY to .env (git-ignored).
 *
 * The JSON file: { listingId? (set it to update a published listing), title, area, city?, beds, baths?, type, rentNgn, cautionNgn, termMonths?,
 *                  description, amenities?: string[], photos: string[] (paths, relative to the file) }
 */
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { encodeDetails } from '../web/src/lib/listing';

const file = process.argv[2];
const API = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'https://handova-near.vercel.app').replace(/\/$/, '');
if (!file) throw new Error('Usage: bun scripts/add-listing.ts <listing.json> [--api <url>]');
const spec = JSON.parse(readFileSync(file, 'utf8'));
const deploy = JSON.parse(readFileSync('deploy/testnet.json', 'utf8'));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.statusText}${j.detail ? ` (${j.detail})` : ''}`);
  return j as T;
}

// The landlord account for real listings: created once, key kept in .env.
let accountId = process.env.LISTINGS_LANDLORD_ACCOUNT_ID;
let secret = process.env.LISTINGS_LANDLORD_PRIVATE_KEY as KeyPairString | undefined;
if (!accountId || !secret) {
  const name = process.env.LISTINGS_LANDLORD_NAME ?? 'lagos-homes';
  const kp = KeyPair.fromRandom('ed25519');
  const r = await api<{ accountId: string }>('/api/accounts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, publicKey: kp.getPublicKey().toString() }),
  });
  accountId = r.accountId;
  secret = kp.toString() as KeyPairString;
  appendFileSync('.env', `\n# Landlord account for the real listings (scripts/add-listing.ts)\nLISTINGS_LANDLORD_ACCOUNT_ID=${accountId}\nLISTINGS_LANDLORD_PRIVATE_KEY=${secret}\n`);
  console.log(`created landlord account ${accountId} (key saved to .env)`);
}

// Photos → the API's media store.
const photos: string[] = [];
for (const p of spec.photos ?? []) {
  const path = resolve(dirname(file), p);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path)], { type: path.endsWith('.png') ? 'image/png' : 'image/jpeg' }), basename(path));
  const { url } = await api<{ url: string }>('/api/media', { method: 'POST', body: form });
  photos.push(new URL(url, API).toString());
  console.log(`uploaded ${basename(path)}`);
}

// Naira → USDC at today's rate, as the app's listing form does. Stored on-chain in USDC.
const { rate } = await api<{ rate: number }>('/api/fx');
const units = (ngn: number) => String(Math.round((ngn / rate) * 100) * 10_000);
const property_ref = encodeDetails({
  title: spec.title, area: spec.area, city: spec.city ?? 'Lagos', beds: spec.beds, baths: spec.baths,
  type: spec.type, photos, description: spec.description, amenities: spec.amenities,
});

const account = new Account(accountId, new JsonRpcProvider({ url: deploy.rpc }), secret);
const gas = 25_000_000_000_000n; // a listing call uses a few Tgas; the account holds 0.05 NEAR
if (spec.listingId !== undefined) {
  // Already published: replace its details and photos (prices too, while no lease is open).
  await account.callFunction({
    contractId: deploy.escrow,
    methodName: 'update_listing',
    args: { listing_id: spec.listingId, rent: units(spec.rentNgn), caution: units(spec.cautionNgn ?? 0), property_ref },
    gas,
  });
  console.log(`updated "${spec.title}" (listing #${spec.listingId}) — ${API}/#/home/${spec.listingId}`);
} else {
  const id: any = await account.callFunction({
    contractId: deploy.escrow,
    methodName: 'create_listing',
    args: { rent: units(spec.rentNgn), caution: units(spec.cautionNgn ?? 0), term_months: spec.termMonths ?? 12, property_ref },
    gas,
  });
  console.log(`listed "${spec.title}" as listing #${id} — ${API}/#/home/${id}  (add "listingId": ${id} to the file to update it later)`);
}

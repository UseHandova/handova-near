/**
 * The listing as it stood when a lease began, kept for the move-out inspection. A landlord can edit a
 * listing during a lease, so the "before" photos must not be whatever the listing shows at move-out.
 * The keeper records each lease's listing the first time it sees the lease; the first copy stays.
 * This file lives on Handova's server: it is not an on-chain record.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Stored { propertyRef: string; capturedAt: number }
export interface Baseline { propertyRef: string; source: 'snapshot' | 'current'; capturedAt: number | null; hash: string }

const read = (file: string): Record<string, Stored> => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
};

export function hasBaseline(file: string, leaseId: number): boolean {
  return !!read(file)[String(leaseId)];
}

export function rememberBaseline(file: string, leaseId: number, propertyRef: string, nowMs: number) {
  const all = read(file);
  if (all[String(leaseId)]) return;
  all[String(leaseId)] = { propertyRef, capturedAt: nowMs };
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
}

/** The recorded listing, or the current one for a lease the keeper hasn't seen. */
export function baselineFor(file: string, leaseId: number, currentRef: string): Baseline {
  const s = read(file)[String(leaseId)];
  const propertyRef = s?.propertyRef ?? currentRef;
  return {
    propertyRef,
    source: s ? 'snapshot' : 'current',
    capturedAt: s?.capturedAt ?? null,
    hash: createHash('sha256').update(propertyRef).digest('hex'),
  };
}

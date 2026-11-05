/**
 * Client side of gasless transactions (NEP-366), shared by the web app and scripts.
 * The account signs a delegate action with its own key; Handova's relayer pays the gas.
 */
import { actions, encodeSignedDelegate, teraToGas, type Account } from 'near-api-js';

import type { TxSummary } from './outcome';

export type RelayResult = TxSummary;

/** How long a person waits on a relayed step before being told what to do. */
const RELAY_LIMIT_MS = 60_000;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function gaslessCall(
  apiBase: string,
  account: Account,
  receiverId: string,
  methodName: string,
  args: object,
  opts: { deposit?: bigint; gas?: bigint } = {},
): Promise<RelayResult> {
  let signedDelegate;
  try {
    ({ signedDelegate } = await account.createSignedMetaTransaction({
      receiverId,
      actions: [actions.functionCall(methodName, args, opts.gas ?? teraToGas('100'), opts.deposit ?? 0n)],
    }));
  } catch {
    throw new Error('Could not reach the NEAR network to prepare this step. Check your connection and try again.');
  }
  const r = await fetch(`${apiBase}/api/relay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedDelegate: toBase64(encodeSignedDelegate(signedDelegate)) }),
    signal: AbortSignal.timeout(RELAY_LIMIT_MS),
  }).catch((e: Error) => {
    if (e.name !== 'TimeoutError') throw new Error('Could not reach Handova. Check your connection and try again.');
    throw new Error('The NEAR network is slow and this step may still go through. Refresh in a minute to check before trying again.');
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok && !body.hash) throw new Error(body.error ?? `Relayer error ${r.status}`);
  return body as RelayResult;
}

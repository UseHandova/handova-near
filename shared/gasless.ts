/**
 * Client side of gasless transactions (NEP-366), shared by the web app and scripts.
 * The account signs a delegate action with its own key; Handova's relayer pays the gas.
 */
import { actions, encodeSignedDelegate, teraToGas, type Account } from 'near-api-js';

export interface RelayResult {
  hash: string;
  ok: boolean;
  events: Array<{ standard: string; event: string; data: any[] }>;
  error?: string;
}

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
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall(methodName, args, opts.gas ?? teraToGas('100'), opts.deposit ?? 0n)],
  });
  const r = await fetch(`${apiBase}/api/relay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedDelegate: toBase64(encodeSignedDelegate(signedDelegate)) }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok && !body.hash) throw new Error(body.error ?? `Relayer error ${r.status}`);
  return body as RelayResult;
}

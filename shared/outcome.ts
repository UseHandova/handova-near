/** Read a NEAR transaction result: hash, success, NEP-297 events, and a readable error. */
export interface TxSummary {
  hash: string;
  ok: boolean;
  events: Array<{ standard: string; event: string; data: any[] }>;
  error?: string;
}

export function summarize(outcome: any): TxSummary {
  const receipts = [outcome?.transaction_outcome, ...(outcome?.receipts_outcome ?? [])];
  const logs: string[] = receipts.flatMap((r: any) => r?.outcome?.logs ?? []);
  const events = logs.filter((l) => l.startsWith('EVENT_JSON:')).map((l) => JSON.parse(l.slice(11)));
  const failure = receipts.map((r: any) => r?.outcome?.status?.Failure).find(Boolean) ?? outcome?.status?.Failure;
  return {
    hash: outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id,
    ok: !failure,
    events,
    error: failure ? readableFailure(failure) : undefined,
  };
}

export function readableFailure(f: unknown): string {
  const s = JSON.stringify(f);
  const panic = s.match(/Smart contract panicked: ([^"\\]+)/);
  return panic ? panic[1] : s;
}

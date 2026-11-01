/**
 * ChainStatusBanner — shown when onchain data can't be loaded (RPC down or rate-limited), so empty
 * screens aren't mistaken for "you have no listings / not verified". Retries automatically.
 */

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useChainState } from '@/lib/chain';

export default function ChainStatusBanner() {
  const chain = useChainState();
  if (!chain.isError || chain.data) return null;
  return (
    <div role="alert" className="max-w-6xl mx-auto mt-3 mx-4 sm:mx-auto px-4 py-3 rounded-xl flex items-center gap-3 text-sm"
      style={{ background: 'rgba(242,180,90,0.10)', border: '1px solid rgba(242,180,90,0.35)', color: 'var(--ink-2)' }}>
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--warning)' }} />
      <span className="flex-1">Couldn't reach the blockchain right now, so your listings and balances may not show. Retrying automatically…</span>
      <button onClick={() => { void chain.refetch(); }} disabled={chain.isFetching}
        className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
        <RotateCw className={`w-3.5 h-3.5 ${chain.isFetching ? 'animate-spin' : ''}`} /> Retry
      </button>
    </div>
  );
}

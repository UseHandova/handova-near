/**
 * Pay from any chain with NEAR Intents (1Click): get a quote, send the coin to a one-time deposit
 * address from any wallet, and the USDC arrives in the payer's NEAR account. Then the app pays the
 * escrow from there. On testnet the quote is a real price but no deposit address (Intents is
 * mainnet-only), and arrival is simulated with test USDC.
 */
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Globe2, Timer } from 'lucide-react';
import { api } from '../lib/api';
import { usd, usdc } from '../lib/money';
import { nearConfig } from '../lib/near';
import { useToast } from '../lib/toast';
import { Busy, Row, Spinner } from './ui';

interface Token { assetId: string; blockchain: string; symbol: string; decimals: number }

const CHAINS: Record<string, string> = {
  base: 'Base', eth: 'Ethereum', arb: 'Arbitrum', sol: 'Solana', pol: 'Polygon', bsc: 'BNB Chain', op: 'Optimism',
  avax: 'Avalanche', tron: 'Tron', ton: 'TON', sui: 'Sui', aptos: 'Aptos', gnosis: 'Gnosis', stellar: 'Stellar',
  monad: 'Monad', near: 'NEAR', xlayer: 'X Layer', scroll: 'Scroll', hypercore: 'Hyperliquid',
};
const chainName = (c: string) => CHAINS[c] ?? c.toUpperCase();
const PREFERRED = ['base', 'sol', 'eth', 'arb', 'pol', 'tron', 'bsc', 'op'];

interface Quote {
  live: boolean;
  quote: { amountInFormatted: string; amountOutFormatted: string; timeEstimate: number; depositAddress?: string; depositMemo?: string; deadline?: string };
}

export function IntentsPay({ amountOut, recipient, onArrived }: { amountOut: bigint; recipient: string; onArrived: () => Promise<void> }) {
  const toast = useToast();
  const cfg = nearConfig();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [asset, setAsset] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ tokens: Token[] }>('/api/intents/tokens').then(({ tokens }) => {
      const sorted = [...tokens].sort((a, b) => (PREFERRED.indexOf(a.blockchain) + 1 || 99) - (PREFERRED.indexOf(b.blockchain) + 1 || 99));
      setTokens(sorted);
      setAsset(sorted.find((t) => t.blockchain === 'base' && t.symbol === 'USDC')?.assetId ?? sorted[0]?.assetId ?? '');
    }).catch(() => toast('error', 'Could not load coins from NEAR Intents. Try again in a minute.'));
  }, [toast]);

  const token = useMemo(() => tokens?.find((t) => t.assetId === asset), [tokens, asset]);

  useEffect(() => { setQuote(null); setStatus(''); }, [asset, refundTo]);

  useEffect(() => {
    const addr = quote?.quote.depositAddress;
    if (addr) QRCode.toDataURL(addr, { margin: 1, width: 220 }).then(setQr);
  }, [quote]);

  // Follow a live swap until the USDC lands on NEAR.
  useEffect(() => {
    const addr = quote?.live ? quote.quote.depositAddress : undefined;
    if (!addr) return;
    let stop = false;
    const poll = async () => {
      while (!stop) {
        const s = await api<{ status: string }>(`/api/intents/status?depositAddress=${encodeURIComponent(addr)}`).catch(() => null);
        if (s?.status) setStatus(s.status);
        if (s?.status === 'SUCCESS') { await onArrived(); return; }
        if (s?.status === 'REFUNDED' || s?.status === 'FAILED') { toast('error', 'The swap did not go through; your coins were sent back to your refund address.'); return; }
        await new Promise((r) => setTimeout(r, 5000));
      }
    };
    poll();
    return () => { stop = true; };
  }, [quote, onArrived, toast]);

  async function getQuote() {
    setBusy(true);
    try {
      setQuote(await api<Quote>('/api/intents/quote', { originAsset: asset, amountOut: amountOut.toString(), recipient, refundTo: refundTo.trim(), dry: false }));
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    try {
      await api('/api/faucet', { accountId: recipient });
      toast('ok', 'Simulated: test USDC arrived in your NEAR account. Paying the escrow…');
      await onArrived();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!tokens) return <div className="flex justify-center py-6 text-sub"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="coin">Pay with</label>
        <select id="coin" className="input" value={asset} onChange={(e) => setAsset(e.target.value)}>
          {tokens.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {chainName(t.blockchain)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="refund">Your {token ? chainName(token.blockchain) : ''} address (for refunds)</label>
        <input id="refund" className="input font-mono text-sm" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder={token?.blockchain === 'sol' ? 'Solana address' : '0x…'} autoCapitalize="none" autoComplete="off" />
        <p className="mt-1.5 text-xs text-sub">If anything fails, your coins go back here automatically.</p>
      </div>

      {!quote && (
        <button className="btn-primary w-full" disabled={busy || !refundTo.trim()} onClick={getQuote}>
          <Busy busy={busy}><Globe2 className="h-4 w-4" /> Get a quote</Busy>
        </button>
      )}

      {quote && (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <Row k="You send" v={`${quote.quote.amountInFormatted} ${token?.symbol} on ${token && chainName(token.blockchain)}`} strong />
          <Row k="Arrives on NEAR" v={`${usd(usdc(amountOut))} in ${recipient}`} />
          <Row k="Time" v={<span className="inline-flex items-center gap-1"><Timer className="h-4 w-4" />~{quote.quote.timeEstimate}s</span>} />
          <p className="text-xs text-sub">The quote includes up to 1% slippage buffer; anything unused is refunded. NEAR Intents finds the route — you just send.</p>

          {quote.live && quote.quote.depositAddress ? (
            <>
              <div className="flex flex-col items-center gap-2 pt-2">
                {qr && <img src={qr} alt="Deposit address QR code" className="h-44 w-44 rounded-xl bg-white p-2" />}
                <button className="mono flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-left" onClick={() => { navigator.clipboard?.writeText(quote.quote.depositAddress!); toast('ok', 'Address copied'); }}>
                  {quote.quote.depositAddress} <Copy className="h-4 w-4 shrink-0" />
                </button>
                {quote.quote.depositMemo && <p className="text-sm">Memo (required): <b className="mono">{quote.quote.depositMemo}</b></p>}
              </div>
              <p className="text-sm">Send exactly <b>{quote.quote.amountInFormatted} {token?.symbol}</b> on <b>{token && chainName(token.blockchain)}</b> from any wallet. Keep this screen open — when it arrives we pay the escrow for you.</p>
              <p className="flex items-center gap-2 text-sm font-semibold text-accent"><Spinner /> {status ? status.replace(/_/g, ' ').toLowerCase() : 'waiting for your deposit'}</p>
            </>
          ) : (
            <div className="space-y-2 rounded-xl bg-amber-500/10 p-3 text-sm">
              <p><b>Testnet preview.</b> That's a live NEAR Intents price, but Intents only runs on mainnet, so no deposit address is issued here.</p>
              <button className="btn-primary w-full" disabled={busy} onClick={simulate}>
                <Busy busy={busy}>Simulate arrival and pay escrow</Busy>
              </button>
              {!cfg.tokenOpenMint && <p className="text-xs text-sub">Simulation needs the testnet token.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

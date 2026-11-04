import { useEffect, useState } from 'react';
import { ArrowRightLeft, ExternalLink, Timer } from 'lucide-react';
import { teraToGas } from 'near-api-js';
import { api } from '../lib/api';
import { usd, usdc } from '../lib/money';
import { nearConfig, txUrl } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Busy, Row } from './ui';

interface Token { assetId: string; blockchain: string; symbol: string }
interface Quote { live: boolean; quote: { amountInFormatted: string; amountOutFormatted: string; timeEstimate: number; depositAddress?: string } }

/** Where Lagos landlords usually keep stablecoins: exchange deposit networks first. */
const PREFERRED = ['tron', 'bsc', 'base', 'sol', 'eth', 'arb', 'ton', 'pol'];
const NAMES: Record<string, string> = { tron: 'TRON (TRC-20)', bsc: 'BNB Chain (BEP-20)', base: 'Base', sol: 'Solana', eth: 'Ethereum', arb: 'Arbitrum', ton: 'TON', pol: 'Polygon', op: 'Optimism', avax: 'Avalanche' };
const chainName = (b: string) => NAMES[b] ?? b.toUpperCase();

/**
 * Landlord cash-out with NEAR Intents: send USDC from the NEAR account to an exchange or wallet on another
 * chain (USDT on TRON for Bybit/Binance/Quidax, USDC on Base…). On testnet the price is live, nothing is sent.
 */
export function CashOut({ balance }: { balance: bigint | null }) {
  const { session } = useSession();
  const toast = useToast();
  const cfg = nearConfig();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api<{ tokens: Token[] }>('/api/intents/tokens').then(({ tokens }) => {
      const sorted = [...tokens].sort((a, b) => (PREFERRED.indexOf(a.blockchain) + 1 || 99) - (PREFERRED.indexOf(b.blockchain) + 1 || 99));
      setTokens(sorted);
      setAsset(sorted.find((t) => t.blockchain === 'tron' && t.symbol === 'USDT')?.assetId ?? sorted[0]?.assetId ?? '');
    }).catch(() => {});
  }, []);
  useEffect(() => { if (balance !== null && amount === '' && balance > 0n) setAmount(usdc(balance).toFixed(2)); }, [balance, amount]);
  useEffect(() => setQuote(null), [asset, amount, to]);

  if (!session) return null;
  const token = tokens.find((t) => t.assetId === asset);
  const units = BigInt(Math.round(Number(amount || 0) * 100)) * 10_000n;

  async function getQuote() {
    setBusy('quote');
    try {
      setQuote(await api<Quote>('/api/intents/payout-quote', { amountIn: units.toString(), destinationAsset: asset, recipient: to.trim(), refundTo: session!.accountId, dry: !cfg.intentsLive }));
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  /** Mainnet only: send the USDC to the deposit address 1Click issued for this cash-out. */
  async function send() {
    const addr = quote?.quote.depositAddress;
    if (!session || !addr) return;
    setBusy('send');
    try {
      await session.callDirect(cfg.token, 'storage_deposit', { account_id: addr, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n, gas: teraToGas('30') });
      const r = await session.call(cfg.token, 'ft_transfer', { receiver_id: addr, amount: units.toString(), memo: 'Handova cash-out' }, { deposit: 1n, gas: teraToGas('30') });
      if (!r.ok) throw new Error(r.error ?? 'The transfer did not go through. Nothing was sent.');
      toast('ok', `Sent. ${quote!.quote.amountOutFormatted} ${token?.symbol} should arrive in about ${Math.ceil(quote!.quote.timeEstimate / 60)} min.`, txUrl(r.hash));
      setQuote(null);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><ArrowRightLeft className="h-5 w-5" /></span>
        <div>
          <p className="font-semibold">Cash out to an exchange or another chain</p>
          <p className="text-sm text-sub">Send your USDC to Bybit, Binance, Quidax or any wallet: USDT on TRON or BNB Chain, USDC on Base or Solana, and more. Powered by NEAR Intents.</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="co-amount">Amount (USDC)</label>
          <input id="co-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
        </div>
        <div>
          <label className="label" htmlFor="co-asset">Receive</label>
          <select id="co-asset" className="input" value={asset} onChange={(e) => setAsset(e.target.value)}>
            {tokens.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {chainName(t.blockchain)}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="co-to">Your {token ? chainName(token.blockchain) : ''} address</label>
        <input id="co-to" className="input font-mono text-sm" value={to} onChange={(e) => setTo(e.target.value)} placeholder={token?.blockchain === 'tron' ? 'T…' : token?.blockchain === 'sol' ? 'Solana address' : '0x…'} autoCapitalize="none" autoComplete="off" />
        <p className="mt-1 text-xs text-faint">On an exchange, open Deposit → {token?.symbol ?? 'USDT'} → choose the same network, and copy the address.</p>
      </div>
      <button className="btn-ghost w-full" disabled={!!busy || units <= 0n || !to.trim() || !asset} onClick={getQuote}>
        <Busy busy={busy === 'quote'}>Get a live quote</Busy>
      </button>
      {quote && (
        <div className="space-y-1 rounded-xl bg-muted p-3">
          <Row k="You send" v={`${Number(quote.quote.amountInFormatted).toFixed(2)} USDC on NEAR`} />
          <Row k="You receive" v={`≈ ${Number(quote.quote.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token?.symbol} on ${token && chainName(token.blockchain)}`} strong />
          <Row k="Time" v={<span className="inline-flex items-center gap-1"><Timer className="h-4 w-4" />~{Math.max(1, Math.round(quote.quote.timeEstimate / 60))} min</span>} />
          {quote.live && quote.quote.depositAddress ? (
            <button className="btn-primary mt-2 w-full" disabled={!!busy} onClick={send}><Busy busy={busy === 'send'}>Send {usd(usdc(units))}</Busy></button>
          ) : (
            <p className="pt-1 text-xs text-sub">This is a live price from NEAR Intents. On testnet nothing is sent: Intents runs on mainnet only. On mainnet this button sends the USDC and the {token?.symbol} arrives at your address.</p>
          )}
        </div>
      )}
      <a className="inline-flex items-center gap-1 text-xs text-faint" href="https://docs.near-intents.org" target="_blank" rel="noreferrer">How NEAR Intents works <ExternalLink className="h-3 w-3" /></a>
    </div>
  );
}

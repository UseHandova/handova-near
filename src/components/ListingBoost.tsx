/**
 * ListingBoost — USDC-powered featured listing placement.
 * Landlords pay a small USDC fee to pin a listing to the top for 7/14/30 days.
 * Uses Circle Modular Wallets (gasless) for the USDC transfer to the platform treasury; the server verifies
 * the payment onchain before the boost turns on, and Browse shows boosted listings first.
 */

import { useState } from 'react';
import { CHAIN_ID } from '@/lib/network';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X, CheckCircle2, Loader2, TrendingUp, Star } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { useLang } from '@/lib/LangContext';
import { toast } from 'sonner';
import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import { api, ApiError, publicApi } from '@/lib/api';
import { getUsdc } from '@/onchain-facts';
import { parseAmount } from '@/onchain-money';
import { sendUserOp, txErrorText } from '@/lib/chain';

const BOOST_OPTIONS = [
  { id: '7d', days: 7, usdcCost: 2, label: '7 days', popular: false },
  { id: '14d', days: 14, usdcCost: 3.5, label: '14 days', popular: true },
  { id: '30d', days: 30, usdcCost: 6, label: '30 days', popular: false },
] as const;

type BoostId = typeof BOOST_OPTIONS[number]['id'];

interface Props {
  listingId: string;
  listingTitle: string;
  account: SmartAccount;
  onClose: () => void;
}

const usdcFact = getUsdc(CHAIN_ID);
const USDC_ADDR = (usdcFact?.address ?? '0x3600000000000000000000000000000000000000') as Hex;
// Platform treasury address — in production this would be a real multisig
export function useBoosts() {
  return useQuery({
    queryKey: ['boosts'],
    queryFn: () => publicApi<{ treasury: string | null; boosts: { listingId: string; endsAt: number }[] }>('/api/boosts'),
    staleTime: 30_000,
  });
}

export default function ListingBoost({ listingId, listingTitle, account, onClose }: Props) {
  const { t } = useLang();
  const qc = useQueryClient();
  const boosts = useBoosts();
  const [selected, setSelected] = useState<BoostId>('14d');
  const [boosting, setBoosting] = useState(false);
  const [done, setDone] = useState(false);
  const [activeBoostedUntil, setActiveBoostedUntil] = useState<string | null>(null);

  const current = boosts.data?.boosts.find(b => b.listingId === listingId);
  // The server only returns boosts that are still running.
  const isAlreadyBoosted = !!current;
  const treasury = boosts.data?.treasury as Hex | null | undefined;

  const option = BOOST_OPTIONS.find(o => o.id === selected)!;

  async function handleBoost() {
    if (!treasury) { toast.error('Boosts are not available right now.'); return; }
    setBoosting(true);
    try {
      const amount = parseAmount(CHAIN_ID, option.usdcCost.toString());
      // 1. Pay the treasury in USDC (gasless).
      const calldata = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury, amount.raw] });
      const receipt = await sendUserOp(account, [{ to: USDC_ADDR, data: calldata }]);
      // 2. The server checks that payment onchain before turning the boost on.
      const res = await api<{ endsAt: number }>(account, '/api/boosts', {
        body: { listingId, days: option.days, txHash: receipt.receipt.transactionHash },
      });
      await qc.invalidateQueries({ queryKey: ['boosts'] });
      setActiveBoostedUntil(new Date(res.endsAt).toLocaleDateString('en-NG'));
      setDone(true);
      toast.success(`Listing boosted until ${new Date(res.endsAt).toLocaleDateString('en-NG')}!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Passkey cancelled.' : e instanceof ApiError ? msg : txErrorText(e, 'Boost payment failed.') ?? 'Boost payment failed.');
    } finally {
      setBoosting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'var(--glass-card)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--glass-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          maxHeight: '90dvh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5" style={{ color: '#f59e0b' }} />
            <span className="font-bold" style={{ color: 'var(--ink)' }}>{t('boost_listing')}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center py-6 gap-4">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: '#a35a00', boxShadow: '0 8px 32px rgba(245,158,11,0.3)' }}>
                  <Star className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h3 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{t('boost_active')}</h3>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    &quot;{listingTitle}&quot; is now {t('featured')} until {activeBoostedUntil}.
                  </p>
                </div>
                <button onClick={onClose} className="px-8 py-3 rounded-2xl font-semibold text-white"
                  style={{ background: 'var(--accent)' }}>
                  Done
                </button>
              </motion.div>
            ) : isAlreadyBoosted ? (
              <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center text-center py-6 gap-3">
                <Zap className="w-10 h-10" style={{ color: '#f59e0b' }} />
                <p className="font-bold" style={{ color: 'var(--ink)' }}>{t('boost_active')}</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  This listing is already boosted until {new Date(current.endsAt).toLocaleDateString('en-NG')}.
                </p>
                <button onClick={onClose} className="px-6 py-2.5 rounded-2xl font-semibold text-sm text-white"
                  style={{ background: 'var(--accent)' }}>Close</button>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 rounded-2xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <TrendingUp className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{t('boost_listing_sub')}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      Featured listings get 5-8× more views and appear at the top of Browse for all tenants.
                    </p>
                  </div>
                </div>

                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Select Duration</p>
                <div className="space-y-2.5">
                  {BOOST_OPTIONS.map(opt => (
                    <motion.button key={opt.id} whileTap={{ scale: 0.97 }}
                      onClick={() => setSelected(opt.id)}
                      className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border transition-all"
                      style={selected === opt.id
                        ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', boxShadow: 'none' }
                        : { background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        <span className="font-semibold text-sm">{opt.label}</span>
                        {opt.popular && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={selected === opt.id
                              ? { background: 'rgba(255,255,255,0.25)', color: 'white' }
                              : { background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>
                            POPULAR
                          </span>
                        )}
                      </div>
                      <span className="font-bold tabular-nums">${opt.usdcCost} USDC</span>
                    </motion.button>
                  ))}
                </div>

                <motion.button whileTap={{ scale: 0.97 }} onClick={() => { void handleBoost(); }} disabled={boosting}
                  className="w-full py-4 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
                  style={{ background: boosting ? 'var(--subtle)' : '#a35a00', boxShadow: boosting ? 'none' : '0 4px 16px rgba(245,158,11,0.3)' }}>
                  {boosting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Paying {option.usdcCost} USDC…</>
                    : <><CheckCircle2 className="w-4 h-4" /> Boost for {option.days} days — ${option.usdcCost} USDC</>}
                </motion.button>
                <p className="text-[11px] text-center" style={{ color: 'var(--subtle)' }}>
                  Payment is gasless via Circle Smart Wallet. No ETH needed.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

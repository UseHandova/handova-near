/**
 * Landlord form — list a property onchain.
 * Inputs are in Naira; stored onchain as USDC.
 */

import { useState } from 'react';
import { CHAIN_ID } from '@/lib/network';
import { motion } from 'framer-motion';
import { MapPin, Home, Info, Loader2, Check } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { formatNaira, nairaToUsdc } from '@/lib/naira';
import { parseAmount } from '@/onchain-money';
import { ESCROW_ABI, ESCROW_ADDRESS } from '@/lib/contracts';
import { encodeFunctionData } from 'viem';
import { toast } from 'sonner';
import { sendUserOp, txErrorText } from '@/lib/chain';

interface Props {
  account: SmartAccount;
}

export default function ListProperty({ account }: Props) {
  const [form, setForm] = useState({
    location: '',
    rooms: '1',
    description: '',
    rentNgn: '',
    depositNgn: '',
  });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const rentUsdc = nairaToUsdc(parseFloat(form.rentNgn) || 0);
  const depositUsdc = nairaToUsdc(parseFloat(form.depositNgn) || 0);
  const isValid =
    form.location.trim() &&
    form.description.trim() &&
    parseFloat(form.rentNgn) > 0 &&
    parseFloat(form.depositNgn) > 0;

  function handleSubmit() {
    if (!isValid) return;
    if (!ESCROW_ADDRESS) {
      toast.error('Contract not deployed yet — set VITE_ESCROW_ADDRESS first.');
      return;
    }
    setLoading(true);
    try {
      const rentRaw = parseAmount(CHAIN_ID, rentUsdc.toFixed(6)).raw;
      const depositRaw = parseAmount(CHAIN_ID, depositUsdc.toFixed(6)).raw;
      const metadata = JSON.stringify({
        location: form.location,
        rooms: parseInt(form.rooms),
        description: form.description,
      });

      const calldata = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: 'createListing',
        args: [rentRaw, depositRaw, metadata],
      });

      toast.promise(
        sendUserOp(account, [{ to: ESCROW_ADDRESS, data: calldata }]).then(() => setDone(true)),
        {
          loading: 'Listing property onchain…',
          success: 'Property listed! Tenants can now find you directly.',
          error: 'Listing failed. Please try again.',
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('NotAllowedError')) toast.error(txErrorText(e, 'Could not list the property.') ?? 'Could not list the property.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ background: 'var(--success)' }}
        >
          <Check className="w-8 h-8 text-white" />
        </motion.div>
        <h2 className="display text-xl font-700 mb-2" style={{ color: 'var(--ink)' }}>Property Listed!</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
          Your property is now visible to tenants. Rent will be held in escrow until move-in is confirmed.
        </p>
        <button
          onClick={() => { setDone(false); setForm({ location: '', rooms: '1', description: '', rentNgn: '', depositNgn: '' }); }}
          className="px-6 py-3 rounded-xl font-600 text-white"
          style={{ background: 'var(--accent)' }}
        >
          List Another Property
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-28">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="display text-xl font-700 mb-1" style={{ color: 'var(--ink)' }}>List Your Property</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>Tenants pay directly — no agent involved.</p>
      </motion.div>

      <div className="space-y-4">
        {/* Location */}
        <div>
          <label className="block text-xs font-600 mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Location
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--subtle)' }} />
            <input
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Lekki Phase 1, Lagos"
              className="w-full pl-9 pr-4 py-3.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </div>
        </div>

        {/* Bedrooms */}
        <div>
          <label className="block text-xs font-600 mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Number of Bedrooms
          </label>
          <div className="flex gap-2">
            {['1', '2', '3', '4', '5+'].map(n => (
              <button
                key={n}
                onClick={() => setForm(f => ({ ...f, rooms: n }))}
                className="flex-1 py-2.5 rounded-xl text-sm font-600 border transition-all"
                style={{
                  background: form.rooms === n ? 'var(--accent)' : 'var(--surface-strong)',
                  color: form.rooms === n ? 'white' : 'var(--ink)',
                  borderColor: form.rooms === n ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-600 mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Description
          </label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe the property — security, parking, power supply…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl border text-sm outline-none resize-none"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
        </div>

        {/* Rent */}
        <div>
          <label className="block text-xs font-600 mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Annual Rent (Naira)
          </label>
          <input
            type="number"
            value={form.rentNgn}
            onChange={e => setForm(f => ({ ...f, rentNgn: e.target.value }))}
            placeholder="e.g. 240000"
            className="w-full px-4 py-3.5 rounded-xl border text-base font-600 outline-none tabular-nums"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          {parseFloat(form.rentNgn) > 0 && (
            <p className="text-xs mt-1.5 tabular-nums" style={{ color: 'var(--muted)' }}>
              = {rentUsdc.toFixed(2)} USDC stored onchain ({formatNaira(rentUsdc)} displayed to tenants)
            </p>
          )}
        </div>

        {/* Deposit */}
        <div>
          <label className="block text-xs font-600 mb-1.5 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Security Deposit (Naira)
          </label>
          <input
            type="number"
            value={form.depositNgn}
            onChange={e => setForm(f => ({ ...f, depositNgn: e.target.value }))}
            placeholder="e.g. 240000"
            className="w-full px-4 py-3.5 rounded-xl border text-base font-600 outline-none tabular-nums"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
        </div>

        {/* Info note */}
        <div
          className="flex gap-2.5 p-4 rounded-xl"
          style={{ background: 'var(--accent-soft)' }}
        >
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--accent)' }}>
            Rent is held by a smart contract — not by any agent. It is released to you only after the tenant confirms they have moved in. The deposit is returned at end of tenancy.
          </p>
        </div>

        {/* Submit */}
        <button
          onClick={() => { void handleSubmit(); }}
          disabled={!isValid || loading}
          className="w-full py-4 rounded-2xl font-600 text-white text-base flex items-center justify-center gap-2 transition-opacity active:opacity-80"
          style={{ background: isValid && !loading ? 'var(--accent)' : 'var(--subtle)' }}
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Listing…</>
          ) : (
            <><Home className="w-4 h-4" /> List Property Onchain</>
          )}
        </button>
      </div>
    </div>
  );
}

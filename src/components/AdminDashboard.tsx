/**
 * AdminDashboard — internal admin panel for Handova operators.
 * Platform stats, listing moderation and dispute resolution — all real (chain + server).
 * Accessible only to the escrow's onchain arbiter.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, publicApi } from '@/lib/api';
import type { SmartAccount } from 'viem/account-abstraction';
import { Loader2, FileCheck2 } from 'lucide-react';
import { OwnershipReview } from '@/components/OwnershipProof';
import { AdminCashDisputes } from '@/components/CashPayment';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Users, Building2, ShieldCheck, AlertTriangle,
  X, Eye, BarChart3, TrendingUp, Flag,
} from 'lucide-react';
import { useLang } from '@/lib/LangContext';
import { formatNaira } from '@/lib/naira';
import { toast } from 'sonner';
import { EscrowStatus } from '@/lib/contracts';
import { formatCountdown, sendEscrowTx, useChainState, useIsAdmin, useNow, useRefreshChain, DISPUTE_TIMEOUT_MS } from '@/lib/chain';

type AdminTab = 'overview' | 'moderation' | 'ownership' | 'disputes';

interface Props {
  address: string;
  account: SmartAccount;
  onClose: () => void;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AdminDashboard({ address, account, onClose }: Props) {
  const { t } = useLang();
  const [tab, setTab] = useState<AdminTab>('overview');
  const hidden = useQuery({
    queryKey: ['rentflow-hidden-admin'],
    queryFn: () => publicApi<{ items: { listingId: string; reason: string; hiddenAt: number }[] }>('/api/moderation/hidden'),
  });
  const [moderating, setModerating] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const isAdmin = useIsAdmin(address);
  const chain = useChainState();
  const refreshChain = useRefreshChain();
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);
  const now = useNow();

  const disputes = useMemo(() => (chain.data?.escrows ?? []).filter(e => e.status === EscrowStatus.Disputed), [chain.data]);

  // Only what's real: hidden (moderated) listings and refunded payments are left out of the headline numbers.
  const STATS = useMemo(() => {
    const listings = chain.data?.listings ?? [];
    const escrows = chain.data?.escrows ?? [];
    const hiddenIds = new Set((hidden.data?.items ?? []).map(h => h.listingId));
    const live = listings.filter(l => l.active && l.escrowId === 0n && !hiddenIds.has(String(l.id)));
    const real = escrows.filter(e => e.status !== EscrowStatus.Refunded);
    const refunded = escrows.length - real.length;
    const paid = escrows.filter(e => [EscrowStatus.Active, EscrowStatus.Released, EscrowStatus.Ending, EscrowStatus.Disputed].includes(e.status));
    const landlords = new Set([...live.map(l => l.landlord.toLowerCase()), ...real.map(e => e.listing?.landlord.toLowerCase()).filter((a): a is string => !!a)]);
    const tenants = new Set(real.map(e => e.tenant.toLowerCase()));
    const verified = new Set(listings.filter(l => l.landlordVerifiedAt > 0 && landlords.has(l.landlord.toLowerCase())).map(l => l.landlord.toLowerCase()));
    const rentPaid = paid.reduce((sum, e) => sum + (e.listing?.rentUsdc ?? 0), 0);
    const heldNow = real.reduce((sum, e) => sum + e.heldUsdc, 0);
    return [
      { label: 'Live listings', value: String(live.length), sub: hiddenIds.size ? `${hiddenIds.size} hidden by moderation` : 'Visible to tenants', icon: Building2, color: '#7c3aed' },
      { label: 'Landlords', value: String(landlords.size), sub: `${verified.size} identity-verified`, icon: Users, color: 'var(--accent)' },
      { label: 'Tenancies', value: String(real.length), sub: refunded ? `${refunded} refunded (not counted)` : `${tenants.size} tenant${tenants.size === 1 ? '' : 's'}`, icon: ShieldCheck, color: '#0e7490' },
      { label: 'Rent paid to landlords', value: formatNaira(rentPaid), sub: 'After tenants moved in', icon: TrendingUp, color: '#b45309' },
      { label: 'Held in escrow now', value: formatNaira(heldNow), sub: 'Rent and caution fees', icon: Eye, color: '#f59e0b' },
      { label: 'Open disputes', value: String(disputes.length), sub: disputes.length ? 'Needs a decision' : 'Nothing to resolve', icon: AlertTriangle, color: '#ef4444' },
    ];
  }, [chain.data, disputes, hidden.data]);

  // The page renders only after the server confirms, from a signed-in session, that this wallet is the arbiter.
  const serverAdmin = useQuery({
    queryKey: ['admin-me', address.toLowerCase()],
    enabled: isAdmin,
    queryFn: () => api<{ admin: boolean }>(account, '/api/admin/me').then(r => r.admin),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const confirmed = isAdmin && serverAdmin.data === true;
  const offchain = useQuery({
    queryKey: ['admin-stats'],
    enabled: confirmed,
    queryFn: () => api<{ phoneAccounts: number; inspections: { open: number; completed: number; total: number }; chats: { conversations: number; messagesThisWeek: number };
      ownership: { pending: number; approved: number }; reviews: number; openRepairs: number }>(account, '/api/admin/stats'),
    refetchInterval: 60_000,
  });

  async function resolve(escrowId: bigint, landlordShare: number) {
    const key = `${escrowId}-${landlordShare}`;
    setResolving(key);
    try {
      await sendEscrowTx(account, { functionName: 'resolveDispute', args: [escrowId, landlordShare] });
      toast.success(`Dispute #${escrowId} resolved — ${landlordShare}% to landlord, ${100 - landlordShare}% to tenant.`);
      await refreshChain();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('NotAllowedError') ? 'Passkey cancelled.' : 'Could not resolve dispute.');
    } finally {
      setResolving(null);
    }
  }

  async function moderate(listingId: string, action: 'hide' | 'unhide') {
    setModerating(listingId);
    try {
      await api(account, `/api/moderation/${action}`, { body: { listingId, reason: reasons[listingId] || undefined } });
      await Promise.all([hidden.refetch(), qc.invalidateQueries({ queryKey: ['rentflow-hidden'] })]);
      toast.success(action === 'hide' ? `Listing #${listingId} hidden from tenants.` : `Listing #${listingId} is visible again.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(/NotAllowedError|cancel/i.test(msg) ? 'Sign-in was cancelled.' : msg);
    } finally {
      setModerating(null);
    }
  }

  const TABS = [
    { id: 'overview' as AdminTab, label: 'Overview', icon: BarChart3 },
    { id: 'moderation' as AdminTab, label: 'Moderation', icon: Flag },
    { id: 'ownership' as AdminTab, label: 'Ownership', icon: FileCheck2 },
    { id: 'disputes' as AdminTab, label: 'Disputes', icon: AlertTriangle },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: 'var(--backdrop)' /* opaque: a full-screen overlay must hide the page under it */ }}
    >
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-28">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}>
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="display text-xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>{t('admin_dashboard')}</h1>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('admin_only')}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        {/* Access check: quick onchain hint first, then the server confirms from your signed session */}
        {isAdmin && serverAdmin.isLoading ? (
          <div className="flex flex-col items-center py-16 gap-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--subtle)' }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Confirming you're the admin… approve with your passkey if asked.</p>
          </div>
        ) : isAdmin && serverAdmin.isError ? (
          <div className="flex flex-col items-center py-16 gap-3 text-center">
            <p className="text-sm max-w-xs" style={{ color: 'var(--danger)' }}>{/NotAllowedError|cancel/i.test(String(serverAdmin.error)) ? 'Sign-in was cancelled.' : serverAdmin.error.message}</p>
            <button onClick={() => { void serverAdmin.refetch(); }} className="h-10 px-5 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>Try again</button>
          </div>
        ) : !confirmed ? (
          <div className="flex flex-col items-center py-16 gap-4 text-center">
            <Shield className="w-12 h-12" style={{ color: 'var(--danger)' }} />
            <h2 className="font-bold text-lg" style={{ color: 'var(--ink)' }}>Access Restricted</h2>
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              This dashboard is only accessible to the escrow's dispute arbiter.<br />
              {chain.data?.arbiter && <span className="mono text-xs">{short(chain.data.arbiter)}</span>}
            </p>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
              {TABS.map(t2 => (
                <button key={t2.id} onClick={() => setTab(t2.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shrink-0 transition-all"
                  style={tab === t2.id
                    ? { background: 'var(--accent)', color: 'white', boxShadow: 'none' }
                    : { background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  <t2.icon className="w-3.5 h-3.5" />{t2.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {/* Overview */}
              {tab === 'overview' && (
                <motion.div key="overview" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {STATS.map(s => (
                      <motion.div key={s.label} whileHover={{ y: -2 }}
                        className="rounded-2xl p-4"
                        style={{ background: 'var(--glass-card)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-card)' }}>
                        <s.icon className="w-5 h-5 mb-2" style={{ color: s.color }} />
                        <p className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>{s.value}</p>
                        <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--ink-2)' }}>{s.label}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--subtle)' }}>{s.sub}</p>
                      </motion.div>
                    ))}
                  </div>
                  <p className="text-[11px] mt-2" style={{ color: 'var(--subtle)' }}>Onchain, from the escrow contract on Arc. Hidden listings and refunded payments aren't counted.</p>

                  <h3 className="text-xs font-semibold uppercase tracking-wider mt-6 mb-2" style={{ color: 'var(--muted)' }}>Activity in Handova</h3>
                  {offchain.isLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
                  ) : offchain.isError ? (
                    <p className="text-sm" style={{ color: 'var(--danger)' }}>{offchain.error.message}</p>
                  ) : offchain.data && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        ['Inspections in progress', offchain.data.inspections.open, `${offchain.data.inspections.completed} completed`],
                        ['Chats', offchain.data.chats.conversations, `${offchain.data.chats.messagesThisWeek} messages this week`],
                        ['Ownership to review', offchain.data.ownership.pending, `${offchain.data.ownership.approved} approved`],
                        ['Phone sign-ins', offchain.data.phoneAccounts, 'Accounts using a phone number'],
                        ['Reviews', offchain.data.reviews, 'From tenants who moved in'],
                        ['Open repairs', offchain.data.openRepairs, 'Reported by tenants'],
                      ].map(([label, value, sub]) => (
                        <div key={String(label)} className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          <p className="display text-xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{value}</p>
                          <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--ink-2)' }}>{label}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--subtle)' }}>{sub}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Verifications */}
              {tab === 'moderation' && (
                <motion.div key="moderation" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Hide scam, spam or test listings from tenants. Owners can still see and remove their own listings; hiding is reversible.
                  </p>
                  {(() => {
                    const hiddenIds = new Set((hidden.data?.items ?? []).map(h => h.listingId));
                    const rows = (chain.data?.listings ?? []).filter(l => l.active || hiddenIds.has(String(l.id))).slice().reverse();
                    if (rows.length === 0) return <p className="text-sm text-center py-10" style={{ color: 'var(--muted)' }}>No listings yet.</p>;
                    return rows.map(l => {
                      const id = String(l.id);
                      const isHidden = hiddenIds.has(id);
                      const reason = hidden.data?.items.find(h => h.listingId === id)?.reason;
                      return (
                        <div key={id} className="rounded-2xl p-4" style={{ background: 'var(--surface-muted)', border: `1px solid ${isHidden ? 'rgba(239,113,134,0.4)' : 'var(--border)'}` }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>#{id} · {l.meta.location || 'Untitled'} · {formatNaira(l.rentUsdc)}/yr</p>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                                Landlord <span className="mono">{short(l.landlord)}</span>{l.landlordVerifiedAt > 0 ? ' · verified' : ' · not verified'}{l.escrowId !== 0n ? ' · has tenant' : ''}
                              </p>
                              {isHidden && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>Hidden — {reason}</p>}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            {!isHidden && (
                              <input value={reasons[id] ?? ''} onChange={e => setReasons(r => ({ ...r, [id]: e.target.value.slice(0, 300) }))}
                                placeholder="Reason (e.g. duplicate of #3, fake photos)" className="flex-1 min-w-0 h-9 px-3 rounded-lg text-xs outline-none"
                                style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                            )}
                            <button onClick={() => { void moderate(id, isHidden ? 'unhide' : 'hide'); }} disabled={moderating === id}
                              className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                              style={isHidden ? { background: 'var(--popover)', color: 'var(--ink)', border: '1px solid var(--border)' } : { background: 'rgba(239,113,134,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,113,134,0.3)' }}>
                              {moderating === id && <Loader2 className="w-3 h-3 animate-spin" />}{isHidden ? 'Show again' : 'Hide listing'}
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </motion.div>
              )}

              {/* Disputes */}
              {tab === 'ownership' && <OwnershipReview account={account} />}

              {tab === 'disputes' && (
                <motion.div key="disputes" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Cash payments in dispute</h3>
                  <AdminCashDisputes account={account} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider pt-3" style={{ color: 'var(--muted)' }}>Escrow disputes</h3>
                  {disputes.length === 0 && (
                    <p className="text-sm py-4" style={{ color: 'var(--muted)' }}>No open disputes onchain.</p>
                  )}
                  {disputes.map(d => {
                    const btn = (share: number, label: string, style: React.CSSProperties) => (
                      <button key={share} onClick={() => { void resolve(d.id, share); }} disabled={resolving !== null}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-60" style={style}>
                        {resolving === `${d.id}-${share}` && <Loader2 className="w-3 h-3 animate-spin" />}{label}
                      </button>
                    );
                    return (
                      <div key={String(d.id)} className="rounded-2xl p-4"
                        style={{ background: 'var(--glass-card)', backdropFilter: 'blur(24px)', border: '1px solid rgba(245,158,11,0.25)', boxShadow: 'var(--shadow-card)' }}>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{d.listing?.meta.location || `Listing #${d.listingId}`}</p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Escrow #{String(d.id)} · {formatNaira(d.heldUsdc)} held</p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                              Opened {new Date(d.disputedAt).toLocaleDateString('en-NG')} · auto-splits 50/50 in {formatCountdown(d.disputedAt + DISPUTE_TIMEOUT_MS, now)}
                            </p>
                          </div>
                          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#f59e0b' }} />
                        </div>
                        <div className="text-xs space-y-1 mb-3 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
                          <div className="flex justify-between"><span style={{ color: 'var(--subtle)' }}>Tenant</span><span className="mono" style={{ color: 'var(--ink)' }}>{short(d.tenant)}</span></div>
                          <div className="flex justify-between"><span style={{ color: 'var(--subtle)' }}>Landlord</span><span className="mono" style={{ color: 'var(--ink)' }}>{d.listing ? short(d.listing.landlord) : '—'}</span></div>
                        </div>
                        <div className="flex gap-2">
                          {btn(100, 'Landlord', { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid rgba(10,102,56,0.15)' })}
                          {btn(50, 'Split 50/50', { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' })}
                          {btn(0, 'Tenant', { background: 'rgba(124,58,237,0.08)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.15)' })}
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  );
}

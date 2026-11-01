/**
 * LandlordEscrowPanel — the landlord's side of a tenancy:
 * mark keys handed over, finalise a silent move-in, approve or dispute the deposit.
 */

import { useState } from 'react';
import { Key, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { SmartAccount } from 'viem/account-abstraction';
import { toast } from 'sonner';
import { EscrowStatus } from '@/lib/contracts';
import { formatNaira } from '@/lib/naira';
import {
  canDispute, formatCountdown, sendEscrowTx, useNow, useRefreshChain,
  DEPOSIT_REVIEW_MS, MOVE_IN_WINDOW_MS, DISPUTE_TIMEOUT_MS, type ChainEscrow,
} from '@/lib/chain';

interface Props {
  escrow: ChainEscrow;
  account: SmartAccount;
  /** Status line only, no buttons (used when the same escrow is already shown with actions elsewhere). */
  compact?: boolean;
}

type Action = 'markHandover' | 'claimMoveIn' | 'approveDepositReturn' | 'dispute';

const SUCCESS: Record<Action, string> = {
  markHandover: 'Handover recorded. The tenant has 3 days to confirm or raise an issue.',
  claimMoveIn: 'Move-in finalised. Rent is ready to withdraw.',
  approveDepositReturn: 'Deposit returned to the tenant.',
  dispute: 'Dispute opened. Upload evidence so the Handova team can review.',
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function LandlordEscrowPanel({ escrow, account, compact = false }: Props) {
  const [acting, setActing] = useState<Action | null>(null);
  const refreshChain = useRefreshChain();
  const now = useNow();

  async function run(action: Action) {
    setActing(action);
    try {
      await sendEscrowTx(account, { functionName: action, args: [escrow.id] });
      toast.success(SUCCESS[action]);
      await refreshChain();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('NotAllowedError') ? 'Passkey cancelled.' : 'Transaction failed. Please try again.');
    } finally {
      setActing(null);
    }
  }

  const button = (action: Action, label: string, icon: React.ElementType, primary = false) => {
    const Icon = icon;
    return (
      <button
        key={action}
        onClick={() => { void run(action); }}
        disabled={acting !== null}
        className={`${primary ? 'flex-1' : 'px-4'} h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-60`}
        style={primary
          ? { background: 'var(--accent)', color: 'white' }
          : { background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--border-strong)' }}
      >
        {acting === action ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
        {label}
      </button>
    );
  };

  const moveInDeadline = escrow.handoverAt + MOVE_IN_WINDOW_MS;
  const reviewDeadline = escrow.endRequestedAt + DEPOSIT_REVIEW_MS;

  let note: React.ReactNode = null;
  const actions: React.ReactNode[] = [];

  switch (escrow.status) {
    case EscrowStatus.Pending:
      if (escrow.handoverAt === 0) {
        note = 'Tenant has paid into escrow. Hand over the keys, then record it here.';
        actions.push(button('markHandover', 'Keys handed over', Key, true));
      } else if (now < moveInDeadline) {
        note = `Waiting for the tenant to confirm move-in. You can finalise it yourself in ${formatCountdown(moveInDeadline, now)}.`;
      } else {
        note = 'The tenant has not responded since handover. You can finalise the move-in now.';
        actions.push(button('claimMoveIn', 'Finalise move-in', CheckCircle2, true));
      }
      break;
    case EscrowStatus.Active:
      note = 'Tenancy active. The deposit stays in escrow until the tenant moves out.';
      break;
    case EscrowStatus.Ending:
      note = now < reviewDeadline
        ? `Tenant has moved out. Inspect the property — if you do nothing, the deposit returns to them in ${formatCountdown(reviewDeadline, now)}.`
        : 'Review period is over. The tenant can now reclaim their deposit.';
      if (now < reviewDeadline) actions.push(button('approveDepositReturn', 'Return deposit', ShieldCheck, true));
      break;
    case EscrowStatus.Disputed:
      note = `In dispute. The Handova team will decide; if nobody acts, it splits 50/50 in ${formatCountdown(escrow.disputedAt + DISPUTE_TIMEOUT_MS, now)}.`;
      break;
    default:
      note = 'Tenancy closed.';
  }

  if (canDispute(escrow)) actions.push(button('dispute', 'Dispute', AlertTriangle));

  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
        <Clock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} />
        <span className={compact ? 'line-clamp-2' : ''}>{note}</span>
      </div>
      {!compact && actions.length > 0 && <div className="flex gap-2">{actions}</div>}
      <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
        Tenant <span className="mono">{short(escrow.tenant)}</span>
        {escrow.heldUsdc > 0 && <> · {formatNaira(escrow.heldUsdc)} held in escrow</>}
      </p>
    </div>
  );
}

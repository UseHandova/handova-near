/**
 * The arbiter can be a Sputnik DAO: council members propose a ruling, vote, and when it passes the
 * DAO itself calls the escrow (resolve_move_in / resolve_dispute). Nobody decides alone.
 */
import { teraToGas } from 'near-api-js';
import type { TxSummary } from '../../../shared/outcome';
import { getProvider, nearConfig, view } from './near';
import type { Session } from './session';

export interface DaoPolicy {
  roles: Array<{ name: string; kind: { Group?: string[] } | string; permissions: string[] }>;
  default_vote_policy: { threshold: string | number[] };
  proposal_bond: string;
}

export interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: { FunctionCall?: { receiver_id: string; actions: Array<{ method_name: string; args: string }> } };
  status: string;
  vote_counts: Record<string, [number, number, number]>;
  votes: Record<string, string>;
}

const policies = new Map<string, DaoPolicy | null>();

/** The DAO's policy, or null if the arbiter is a plain account. */
export async function daoPolicy(arbiter: string): Promise<DaoPolicy | null> {
  if (!policies.has(arbiter)) {
    // A plain account has no contract: check the code hash first instead of calling a missing method.
    const acc: any = await getProvider().viewAccount({ accountId: arbiter }).catch(() => null);
    const hasCode = acc && acc.code_hash && acc.code_hash !== '11111111111111111111111111111111';
    policies.set(arbiter, hasCode ? await view<DaoPolicy>(arbiter, 'get_policy').catch(() => null) : null);
  }
  return policies.get(arbiter)!;
}

export function council(policy: DaoPolicy): string[] {
  return policy.roles.flatMap((r) => (typeof r.kind === 'object' && r.kind.Group ? r.kind.Group : []));
}

export function threshold(policy: DaoPolicy): string {
  const t = policy.default_vote_policy.threshold;
  return Array.isArray(t) ? `${t[0]}/${t[1]} of the council` : `${t} votes`;
}

const decode = (b64: string) => { try { return JSON.parse(atob(b64)); } catch { return {}; } };

/** Rulings proposed for one lease, newest first. */
export async function proposalsFor(dao: string, leaseId: number): Promise<Proposal[]> {
  const last = await view<number>(dao, 'get_last_proposal_id');
  const from = Math.max(0, last - 100);
  const list = await view<Proposal[]>(dao, 'get_proposals', { from_index: from, limit: 100 });
  return list
    .filter((p) => p.kind.FunctionCall?.receiver_id === nearConfig().escrow && p.kind.FunctionCall.actions.some((a) => decode(a.args).lease_id === leaseId))
    .reverse();
}

export function describeRuling(p: Proposal): string {
  const a = p.kind.FunctionCall!.actions[0];
  const args = decode(a.args);
  if (a.method_name === 'resolve_move_in') return args.moved_in ? 'Rule: the tenant moved in' : 'Rule: refund the payer';
  if (a.method_name === 'resolve_dispute') return `Landlord keeps ${(Number(args.landlord_amount) / 1e6).toFixed(2)} USDC of the caution`;
  return a.method_name;
}

/** Council member: propose a ruling. Pays the DAO's proposal bond (returned if it passes). */
export function proposeRuling(session: Session, dao: string, policy: DaoPolicy, method: string, args: object, description: string): Promise<TxSummary> {
  return session.callDirect(dao, 'add_proposal', {
    proposal: {
      description: `[Handova] ${description}`,
      kind: { FunctionCall: { receiver_id: nearConfig().escrow, actions: [{ method_name: method, args: btoa(JSON.stringify(args)), deposit: '0', gas: teraToGas('60').toString() }] } },
    },
  }, { deposit: BigInt(policy.proposal_bond), gas: teraToGas('50') });
}

export function vote(session: Session, dao: string, p: Proposal, approve: boolean): Promise<TxSummary> {
  return session.callDirect(dao, 'act_proposal', { id: p.id, action: approve ? 'VoteApprove' : 'VoteReject', proposal: p.kind }, { gas: teraToGas('200') });
}

/**
 * Gasless transactions (NEP-366 meta transactions).
 *
 * The user's device signs a *delegate action* ("call confirm_move_in on the escrow"); Handova's
 * relayer wraps it in a transaction and pays the gas. The user needs no NEAR for gas.
 *
 * The relayer only forwards calls to Handova's own contracts, with a fixed list of methods and
 * deposits, so a leaked or abused endpoint can't spend the relayer's NEAR on anything else.
 */
import type { Express } from 'express';
import { deserialize } from 'borsh';
import { actions, SCHEMA, type SignedDelegate } from 'near-api-js';
import { deploy } from './config';
import { relayer, summarize } from './chain';
import { RateLimit } from './rate-limit';

/** Escrow methods a user may call gaslessly, always with zero deposit. */
export const ESCROW_METHODS = new Set([
  'create_listing',
  'update_listing',
  'mark_handover',
  'confirm_move_in',
  'claim_move_in',
  'dispute_move_in',
  'cancel_lease',
  'move_out',
  'approve_move_out',
  'dispute_caution',
  'claim_caution',
  'propose_split',
  'settle_dispute_timeout',
  'withdraw',
]);
const MAX_GAS_PER_ACTION = 300_000_000_000_000n;
const MAX_ACTIONS = 2;

export interface Policy {
  escrow: string;
  token: string;
}

export interface CheckedDelegate {
  senderId: string;
  receiverId: string;
  methods: string[];
}

/** Decode a base64 borsh `SignedDelegate` as produced by `Account.signDelegateAction`. */
export function decodeSignedDelegate(b64: string): SignedDelegate {
  const bytes = Buffer.from(b64, 'base64');
  return deserialize(SCHEMA.SignedDelegate, bytes) as SignedDelegate;
}

/** Throws a user-readable error if the relayer must not pay for this delegate action. */
export function checkDelegate(sd: SignedDelegate, policy: Policy): CheckedDelegate {
  const d: any = sd.delegateAction;
  const receiver = d.receiverId as string;
  if (receiver !== policy.escrow && receiver !== policy.token) {
    throw new Error(`Gasless is only for Handova's contracts, not ${receiver}`);
  }
  if (!d.actions?.length || d.actions.length > MAX_ACTIONS) throw new Error('Expected 1–2 actions');
  const methods: string[] = [];
  for (const a of d.actions) {
    const fc = a.functionCall;
    if (!fc) throw new Error('Only contract calls can be sent gaslessly');
    const deposit = BigInt(fc.deposit.toString());
    const gas = BigInt(fc.gas.toString());
    if (gas > MAX_GAS_PER_ACTION) throw new Error('Too much gas requested');
    if (receiver === policy.escrow) {
      if (!ESCROW_METHODS.has(fc.methodName)) throw new Error(`${fc.methodName} can't be sent gaslessly`);
      if (deposit !== 0n) throw new Error(`Gasless calls can't attach NEAR (${fc.methodName})`);
    } else {
      // Token: only paying into the escrow.
      if (fc.methodName !== 'ft_transfer_call') throw new Error('Only payments into the Handova escrow are gasless');
      if (deposit !== 1n) throw new Error('ft_transfer_call needs exactly 1 yoctoNEAR');
      let args: any;
      try {
        args = JSON.parse(Buffer.from(fc.args).toString('utf8'));
      } catch {
        throw new Error('Unreadable ft_transfer_call arguments');
      }
      if (args.receiver_id !== policy.escrow) throw new Error('Payments can only go to the Handova escrow');
    }
    methods.push(fc.methodName);
  }
  return { senderId: d.senderId, receiverId: receiver, methods };
}

const perSender = new RateLimit(60, 60 * 60_000);
const perIp = new RateLimit(120, 60 * 60_000);
/** Daily budget for the whole relayer (each relayed call costs it roughly 0.001 NEAR or less). */
const daily = new RateLimit(Number(process.env.RELAYER_DAILY_TX ?? 2000), 24 * 60 * 60_000);

export function mountRelayer(app: Express) {
  app.post('/api/relay', async (req, res) => {
    if (!relayer) return res.status(503).json({ error: 'Gasless payments are switched off on this server. Use a NEAR wallet instead.' });
    let sd: SignedDelegate;
    let checked: CheckedDelegate;
    try {
      sd = decodeSignedDelegate(String(req.body?.signedDelegate ?? ''));
      checked = checkDelegate(sd, { escrow: deploy.escrow, token: deploy.token });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message || 'Could not read the signed request. Refresh and try again.' });
    }
    if (!perIp.take(req.ip ?? 'ip') || !perSender.take(checked.senderId)) {
      return res.status(429).json({ error: 'Too many requests. Wait a few minutes and try again.' });
    }
    if (!daily.take('all')) {
      return res.status(503).json({ error: "Handova's free-gas budget for today is used up. Try tomorrow, or use a NEAR wallet (you pay a tiny fee)." });
    }
    try {
      const outcome = await relayer.signAndSendTransaction({
        receiverId: checked.senderId,
        actions: [actions.signedDelegate(sd)],
        throwOnFailure: false,
        waitUntil: 'EXECUTED_OPTIMISTIC',
      });
      const s = summarize(outcome);
      res.status(s.ok ? 200 : 422).json({ ...s, methods: checked.methods });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const expired = /expired|nonce|DelegateActionExpired|InvalidNonce/i.test(msg);
      res.status(expired ? 409 : 502).json({
        error: expired
          ? 'This request expired or was already sent. Try the action again.'
          : 'The NEAR network did not accept the transaction. Try again in a minute.',
        detail: msg.slice(0, 300),
      });
    }
  });
}

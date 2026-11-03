import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { nearConfig, txUrl } from '../lib/near';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Busy } from './ui';

type State = 'loading' | 'verified' | 'unverified' | 'review';

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Landlord ID check with Didit: the landlord signs a NEP-413 message (proves they control the account),
 * does the ID + selfie steps on Didit's page, and on approval Handova's verifier writes the badge on NEAR.
 */
export function VerifyIdentity() {
  const { session } = useSession();
  const toast = useToast();
  const { t } = useT();
  const cfg = nearConfig();
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    const { verified } = await api<{ verified: boolean }>(`/api/verify/status?accountId=${encodeURIComponent(session.accountId)}`).catch(() => ({ verified: false }));
    if (verified) return setState('verified');
    // A check finished elsewhere (closed tab, Didit's QR code on another phone) is collected here.
    const r = await api<{ ok: boolean; code?: string; txHash?: string }>('/api/verify/didit/resume', { accountId: session.accountId }).catch(() => null);
    if (r?.ok) {
      setTx(r.txHash ?? '');
      setState('verified');
      toast('ok', 'You are now a verified landlord on NEAR.', r.txHash ? txUrl(r.txHash) : undefined);
    } else setState(r?.code === 'in_review' ? 'review' : 'unverified');
  }, [session, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  async function start() {
    if (!session) return;
    setBusy(true);
    try {
      const c = await api<{ nonce: string; message: string; recipient: string }>(`/api/verify/challenge?accountId=${encodeURIComponent(session.accountId)}`);
      const signed = await session.signMessage(c.message, fromBase64(c.nonce), c.recipient);
      const r = await api<{ ok: boolean; url?: string; alreadyVerified?: boolean; error?: string }>('/api/verify/didit/session', {
        accountId: session.accountId, nonce: c.nonce, signature: signed.signature, publicKey: signed.publicKey, returnTo: location.origin,
      });
      if (r.alreadyVerified) return setState('verified');
      if (r.url) location.href = r.url; // Didit's page; it sends the landlord back here when done
    } catch (e) {
      toast('error', (e as Error).message || "Couldn't start the identity check. Try again.");
      setBusy(false);
    }
  }

  if (!session || state === 'loading') {
    return <div className="card flex items-center gap-3 p-4 text-sm text-sub"><Loader2 className="h-4 w-4 animate-spin" />{t('Checking your verification…')}</div>;
  }
  if (state === 'verified') {
    return (
      <div className="card flex items-start gap-3 border-accent/40 bg-accent-soft/40 p-4">
        <BadgeCheck className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-semibold text-ink">{t('Verified landlord')}</p>
          <p className="text-sub">Your ID was checked by Didit and the badge is recorded on NEAR. Tenants see it on every listing.</p>
          {tx && <a className="mt-1 inline-flex items-center gap-1 font-semibold text-accent" href={txUrl(tx)} target="_blank" rel="noreferrer">See it on NEAR <ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
      </div>
    );
  }
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><ShieldCheck className="h-5 w-5" /></span>
        <div>
          <p className="font-semibold">{t('Get the verified landlord badge')}</p>
          <p className="text-sm text-sub">A 2-minute ID and selfie check with Didit. The result is recorded on NEAR.</p>
        </div>
      </div>
      <ul className="space-y-1 pl-1 text-sm text-ink2">
        <li>✓ A verified badge on all your listings: tenants trust you faster</li>
        <li>✓ Get paid if a tenant goes silent 3 days after you hand over the keys</li>
        <li>✓ List more than 3 homes</li>
      </ul>
      {state === 'review' ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-sub">A person at Didit is reviewing your documents. This usually takes a few minutes. Come back to this page to collect your badge.</p>
      ) : cfg.idCheck ? (
        <button className="btn-primary w-full" disabled={busy} onClick={start}>
          <Busy busy={busy}><Fingerprint className="h-4 w-4" />{t('Verify my identity')}</Busy>
        </button>
      ) : (
        <p className="rounded-xl bg-muted p-3 text-sm text-sub">Identity checks are switched off on this server.</p>
      )}
      <p className="text-xs text-faint">Didit keeps your documents; Handova never stores your ID or photos. One ID can verify one account.</p>
    </div>
  );
}

/** Back from Didit (`?verificationSessionId=…`): collect the result, then tidy the address bar. */
export function useDiditReturn() {
  const toast = useToast();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('verificationSessionId');
    if (!sessionId) return;
    history.replaceState(null, '', `${location.pathname}#/landlord`);
    api<{ ok: boolean; txHash?: string; error?: string }>('/api/verify/didit/complete', { sessionId })
      .then((r) => (r.ok
        ? toast('ok', 'You are now a verified landlord on NEAR.', r.txHash ? txUrl(r.txHash) : undefined)
        : toast('ok', r.error ?? 'Your identity check is being reviewed.'))) // 202: a person at Didit is reviewing
      .catch((e) => toast('error', (e as Error).message));
  }, [toast]);
}

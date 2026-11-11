/**
 * View the home, then agree, then pay. The tenant asks for a time, the landlord approves (or suggests
 * another, or declines), and after the visit both say "we viewed it and agree to the listed terms".
 * Only then does the pay button open (see server/near/viewings.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Eye, Handshake, Phone, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { authed, invalidateViewingCounts, lagosTime, toLocalInput, type Viewing, type ViewingRules, type ViewingStatusReply } from '../lib/viewings';
import { Busy } from './ui';

const tomorrowTen = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.getTime(); };
const fromInput = (s: string) => (s ? new Date(s).getTime() : NaN);
const tel = (p: string) => <a className="inline-flex items-center gap-1 font-semibold text-accent" href={`tel:+${p}`}><Phone className="h-3.5 w-3.5" />+{p}</a>;
const windowOpen = (v: Viewing, r: ViewingRules) => Date.now() >= v.slotAt - r.opensBeforeMs;

function useAction(onDone: (v: Viewing) => void) {
  const { session } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, path: string, body: object, ok: string) => {
    if (!session) return;
    setBusy(key);
    try {
      const r = await authed<{ viewing: Viewing }>(session, path, body);
      toast('ok', ok);
      onDone(r.viewing);
    } catch (e) {
      toast('error', (e as Error).message);
      const v = (e as { viewing?: Viewing }).viewing;
      if (v) onDone(v);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function TimePicker({ id, value, onChange }: { id: string; value: string; onChange: (s: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Day and time (your time)</label>
      <input id={id} type="datetime-local" className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <p className="mt-1 text-xs text-sub">Lagos time: {lagosTime(fromInput(value))}</p>}
    </div>
  );
}

/** The tenant's side, on the listing page. */
export function TenantViewing({ listingId, gate, onChanged }: { listingId: number; gate: ViewingStatusReply; onChanged: () => void }) {
  const { session } = useSession();
  const [v, setV] = useState<Viewing | null>(null);
  const [slot, setSlot] = useState(toLocalInput(tomorrowTen()));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [changing, setChanging] = useState(false);
  const done = (x: Viewing) => { setV(x); setChanging(false); onChanged(); invalidateViewingCounts(); };
  const { busy, run } = useAction(done);
  const known = gate.viewing ? `${gate.viewing.id}:${gate.viewing.status}:${gate.viewing.tenantAgreed}:${gate.viewing.landlordAgreed}:${gate.viewing.slotAt}` : '';

  useEffect(() => {
    if (!session || !gate.viewing) return setV(null);
    authed<{ viewings: Viewing[] }>(session, `/api/viewings?listingId=${listingId}`)
      .then((r) => setV(r.viewings.find((x) => x.tenant === session.accountId) ?? null))
      .catch(() => {});
  }, [session?.accountId, known]);

  const closed = !v || ['declined', 'cancelled', 'missed'].includes(v.status);
  const shell = (children: React.ReactNode) => (
    <div className="card space-y-3 p-4" id="viewing">
      <h2 className="flex items-center gap-2 font-display font-bold"><Eye className="h-5 w-5 text-accent" /> View the home before you pay</h2>
      {children}
    </div>
  );

  if (gate.viewing && !v) return shell(<p className="text-sm text-sub">Loading your viewing…</p>);

  if (v?.status === 'agreed' || (v && v.canPay)) {
    return shell(
      <p className="flex items-start gap-2 rounded-xl bg-accent-soft/40 p-3 text-sm"><Handshake className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        {v.status === 'agreed' ? 'You viewed the home and you both agreed. You can pay into escrow now.' : 'You agreed after the viewing and the landlord did not answer within 24 hours. You can pay into escrow now.'}</p>,
    );
  }

  if (closed || changing) {
    const why = v?.status === 'declined' ? `The landlord can't do ${lagosTime(v.slotAt)}${v.landlordNote ? `: "${v.landlordNote}"` : '.'} Pick another time.`
      : v?.status === 'missed' ? 'That viewing was marked as not happening. Pick a new time.'
      : v?.status === 'cancelled' ? 'You cancelled that viewing. Pick a new time.' : null;
    const send = () => changing && v
      ? run('send', `/api/viewings/${v.id}/reschedule`, { slotAt: fromInput(slot), note }, 'New time sent to the landlord')
      : run('send', '/api/viewings', { listingId, slotAt: fromInput(slot), name, phone, note }, 'Viewing request sent to the landlord');
    return shell(
      <div className="space-y-3">
        {!changing && <p className="text-sm text-sub">Payment opens after you have seen the home and you and the landlord both agree. Pick a time; the landlord approves it or suggests another.</p>}
        {why && !changing && <p className="rounded-xl bg-muted p-3 text-sm">{why}</p>}
        <TimePicker id="vt" value={slot} onChange={setSlot} />
        {!changing && <>
          <div><label className="label" htmlFor="vn">Your name</label><input id="vn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Okafor" /></div>
          <div><label className="label" htmlFor="vp">Phone for the landlord</label><input id="vp" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" /></div>
        </>}
        <div><label className="label" htmlFor="vnote">Note (optional)</label><input id="vnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="I'll come with my sister" maxLength={300} /></div>
        <div className="flex gap-2">
          {changing && <button className="btn-ghost flex-1" onClick={() => setChanging(false)}>Back</button>}
          <button className="btn-primary flex-1" disabled={!!busy || !slot || (!changing && (!name || !phone))} onClick={send}><Busy busy={busy === 'send'}><CalendarClock className="h-4 w-4" /> {changing ? 'Send new time' : 'Ask for a viewing'}</Busy></button>
        </div>
      </div>,
    );
  }

  if (v.status === 'requested') {
    return shell(<>
      <p className="text-sm">You asked to view it on <b>{lagosTime(v.slotAt)}</b>. Waiting for the landlord to approve.</p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => { setSlot(toLocalInput(v.slotAt)); setChanging(true); }}>Change time</button>
        <button className="btn-ghost flex-1" disabled={!!busy} onClick={() => run('cancel', `/api/viewings/${v.id}/cancel`, {}, 'Viewing cancelled')}><Busy busy={busy === 'cancel'}><X className="h-4 w-4" /> Cancel</Busy></button>
      </div>
    </>);
  }

  if (v.status === 'rescheduled') {
    return shell(<>
      <p className="text-sm">The landlord suggested <b>{lagosTime(v.slotAt)}</b>{v.landlordNote ? `: "${v.landlordNote}"` : '.'}</p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setChanging(true)}>Pick another time</button>
        <button className="btn-primary flex-1" disabled={!!busy} onClick={() => run('accept', `/api/viewings/${v.id}/accept`, {}, 'Viewing confirmed')}><Busy busy={busy === 'accept'}>Accept this time</Busy></button>
      </div>
    </>);
  }

  // Approved.
  const open = windowOpen(v, gate.rules);
  return shell(<>
    <p className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span>Viewing confirmed for <b>{lagosTime(v.slotAt)}</b>.{v.landlordNote ? ` Landlord: "${v.landlordNote}"` : ''}</span></p>
    {v.landlordPhone && <p className="text-sm">Landlord's phone: {tel(v.landlordPhone)}</p>}
    {!open && <>
      <p className="text-sm text-sub">After the viewing, come back here. If you want the home, you agree to rent it at the price on this page, and payment opens once the landlord agrees too.</p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => { setSlot(toLocalInput(v.slotAt)); setChanging(true); }}>Change time</button>
        <button className="btn-ghost flex-1" disabled={!!busy} onClick={() => run('cancel', `/api/viewings/${v.id}/cancel`, {}, 'Viewing cancelled')}><Busy busy={busy === 'cancel'}><X className="h-4 w-4" /> Cancel</Busy></button>
      </div>
    </>}
    {open && !v.tenantAgreedAt && (
      <div className="space-y-2">
        <button className="btn-primary w-full" disabled={!!busy} onClick={() => run('agree', `/api/viewings/${v.id}/agree`, {}, v.landlordAgreedAt ? 'Agreed. You can pay now' : 'You agreed. Waiting for the landlord')}>
          <Busy busy={busy === 'agree'}><Handshake className="h-4 w-4" /> I viewed it and agree to rent it</Busy>
        </button>
        <button className="btn-ghost w-full" disabled={!!busy} onClick={() => run('missed', `/api/viewings/${v.id}/missed`, {}, 'Marked as not happening')}>It didn't happen, or I don't want it</button>
      </div>
    )}
    {open && v.tenantAgreedAt && !v.landlordAgreedAt && (
      <p className="rounded-xl bg-muted p-3 text-sm">You agreed. Waiting for the landlord to agree too. If they don't answer within 24 hours of the viewing, you can still pay; the money waits in escrow until you move in.</p>
    )}
  </>);
}

/** The landlord's side: requests to approve, and viewings to agree after the visit. */
export function LandlordViewings({ listingId }: { listingId?: number }) {
  const { session } = useSession();
  const [list, setList] = useState<Viewing[] | null>(null);
  const [rules, setRules] = useState<ViewingRules | null>(null);
  const [phone, setPhone] = useState('');
  const [proposing, setProposing] = useState<number | null>(null);
  const [slot, setSlot] = useState(toLocalInput(tomorrowTen()));
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!session) return;
    authed<{ viewings: Viewing[]; rules: ViewingRules }>(session, `/api/viewings${listingId === undefined ? '' : `?listingId=${listingId}`}`)
      .then((r) => { setList(r.viewings.filter((v) => v.landlord === session.accountId)); setRules(r.rules); setFailed(false); })
      .catch(() => setFailed(true));
  }, [session?.accountId, listingId]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);
  const { busy, run } = useAction(() => { setProposing(null); load(); });

  if (failed && !list) return <div className="card p-4 text-sm"><button className="font-semibold text-accent" onClick={load}>Show viewing requests</button></div>;
  if (!list || !rules) return null;
  const shown = list.filter((v) => ['requested', 'rescheduled', 'approved'].includes(v.status) || (v.status === 'agreed' && Date.now() - v.updatedAt < 7 * 86_400_000));

  return (
    <div className="card space-y-3 p-4" id="viewings">
      <h2 className="flex items-center gap-2 font-display font-bold"><Eye className="h-5 w-5 text-accent" /> Viewing requests</h2>
      {shown.length === 0 && <p className="text-sm text-sub">No viewings yet. Tenants ask for a time here before they can pay.</p>}
      {shown.map((v) => {
        const who = <><b>{v.tenantName}</b> {tel(v.tenantPhone)}</>;
        const home = listingId === undefined && <a className="font-semibold text-accent" href={`#/home/${v.listingId}`}>Home #{v.listingId}</a>;
        return (
          <div key={v.id} className="space-y-2 rounded-xl bg-muted p-3 text-sm" data-viewing={v.id}>
            <p>{home}{home && ' · '}{who}</p>
            <p>{v.status === 'rescheduled' ? 'You suggested' : 'Wants to view it on'} <b>{lagosTime(v.slotAt)}</b>{v.status === 'rescheduled' ? '. Waiting for the tenant.' : ''}</p>
            {v.note && <p className="text-sub">"{v.note}"</p>}
            {v.status === 'requested' && proposing !== v.id && <>
              <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your phone for the tenant (optional)" />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary flex-1" disabled={!!busy} onClick={() => run(`a${v.id}`, `/api/viewings/${v.id}/approve`, { phone }, 'Viewing approved')}><Busy busy={busy === `a${v.id}`}>Approve</Busy></button>
                <button className="btn-ghost flex-1" onClick={() => { setSlot(toLocalInput(v.slotAt)); setProposing(v.id); }}>Suggest another time</button>
                <button className="btn-ghost flex-1" disabled={!!busy} onClick={() => run(`d${v.id}`, `/api/viewings/${v.id}/decline`, {}, 'Viewing declined')}><Busy busy={busy === `d${v.id}`}>Decline</Busy></button>
              </div>
            </>}
            {proposing === v.id && <>
              <TimePicker id={`lt${v.id}`} value={slot} onChange={setSlot} />
              <div className="flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => setProposing(null)}>Back</button>
                <button className="btn-primary flex-1" disabled={!!busy} onClick={() => run(`p${v.id}`, `/api/viewings/${v.id}/propose`, { slotAt: fromInput(slot) }, 'New time sent to the tenant')}><Busy busy={busy === `p${v.id}`}>Send this time</Busy></button>
              </div>
            </>}
            {v.status === 'approved' && !windowOpen(v, rules) && <p className="text-sub">Approved. After the viewing, agree here if you'll rent to them.</p>}
            {v.status === 'approved' && windowOpen(v, rules) && !v.landlordAgreedAt && (
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary flex-1" disabled={!!busy} onClick={() => run(`g${v.id}`, `/api/viewings/${v.id}/agree`, {}, v.tenantAgreedAt ? 'Agreed. The tenant can pay now' : 'You agreed. Waiting for the tenant')}>
                  <Busy busy={busy === `g${v.id}`}><Handshake className="h-4 w-4" /> Viewing done, I agree to rent to them</Busy>
                </button>
                <button className="btn-ghost flex-1" disabled={!!busy} onClick={() => run(`m${v.id}`, `/api/viewings/${v.id}/missed`, {}, 'Marked as not happening')}>It didn't happen</button>
              </div>
            )}
            {v.status === 'approved' && v.landlordAgreedAt && <p className="text-sub">You agreed. Waiting for the tenant to agree.</p>}
            {v.status === 'agreed' && <p className="flex items-center gap-1.5 font-semibold text-accent"><Handshake className="h-4 w-4" /> You both agreed. They can pay into escrow now.</p>}
          </div>
        );
      })}
    </div>
  );
}

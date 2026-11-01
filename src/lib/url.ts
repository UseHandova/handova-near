/**
 * Return-link helpers. Reading must be side-effect free (React runs state initialisers twice in
 * development); clearing the query string happens separately, once, in an effect.
 */

/** Didit session id from the return link, tolerant of malformed URLs like /?kyc=didit?verificationSessionId=… */
export function diditSessionFromUrl(): string {
  return window.location.href.match(/verificationSessionId=([0-9a-f-]{36})/i)?.[1] ?? '';
}

/** 6-digit WhatsApp claim code from ?wa=123456. */
export function waCodeFromUrl(): string {
  const code = new URLSearchParams(window.location.search).get('wa') ?? '';
  return /^\d{6}$/.test(code) ? code : '';
}

/** Drop one-time parameters (claim codes, verification ids) so a refresh doesn't replay them. */
export function clearReturnParams() {
  if (/[?&](wa|kyc|verificationSessionId|status)=/.test(window.location.href)) {
    const keep = new URLSearchParams(window.location.search);
    for (const k of ['wa', 'kyc', 'verificationSessionId', 'status']) keep.delete(k);
    const q = keep.toString().replace(/kyc=[^&]*/g, '');
    window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''));
  }
}

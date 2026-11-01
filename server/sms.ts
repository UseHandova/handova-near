/**
 * Sending SMS (login codes). Termii in production — Nigerian, cheap, and its "dnd" route reaches numbers on DND,
 * which matters for codes. In development without a Termii key, codes are printed in the server log so sign-in can
 * be tested for free. In production without a key, SMS is simply unavailable (WhatsApp still works).
 *
 * Env:
 *   TERMII_API_KEY     from the Termii dashboard
 *   TERMII_BASE_URL    your account's API base URL, from the Termii dashboard (e.g. https://v3.api.termii.com)
 *   TERMII_SENDER_ID   your approved sender ID (3–11 characters)
 *   TERMII_CHANNEL     "dnd" (default — required for reliable OTP delivery) or "generic"
 */

export interface SmsResult { ok: boolean; error?: string }
export type SmsSender = ((phone: string, text: string) => Promise<SmsResult>) & { devMode?: boolean };

export function smsFromEnv(env = process.env, log: Pick<Console, 'log' | 'error'> = console): SmsSender | null {
  const key = env.TERMII_API_KEY;
  if (key) {
    const base = (env.TERMII_BASE_URL || 'https://v3.api.termii.com').replace(/\/$/, '');
    const from = env.TERMII_SENDER_ID || 'Handova';
    const channel = env.TERMII_CHANNEL === 'generic' ? 'generic' : 'dnd';
    return async (phone, text) => {
      try {
        const res = await fetch(`${base}/api/sms/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, to: phone, from, sms: text, type: 'plain', channel }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = await res.json().catch(() => ({})) as { code?: string; message?: string };
        if (res.ok && (body.code === 'ok' || /success/i.test(body.message ?? ''))) return { ok: true };
        log.error(`[SMS] Termii refused the message (${res.status}): ${body.message ?? 'no message'}`);
        return { ok: false, error: body.message };
      } catch (e) {
        log.error('[SMS] Termii request failed:', e instanceof Error ? e.message : e);
        return { ok: false, error: 'unreachable' };
      }
    };
  }
  if (env.NODE_ENV !== 'production') {
    const dev: SmsSender = async (phone, text) => {
      log.log(`[SMS dev — not really sent] to +${phone}: ${text}`);
      return { ok: true };
    };
    dev.devMode = true;
    return dev;
  }
  return null;
}

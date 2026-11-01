/**
 * AuthGate — passkey login/register screen.
 * Cinematic hero, animated background orbs, full i18n.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import type { SmartAccount } from 'viem/account-abstraction';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Shield, Fingerprint, Loader2, AlertCircle, ArrowLeft, CheckCircle2, Phone } from 'lucide-react';
import { registerPasskey, loginPasskey, restoreSession } from '@/lib/wallet';
import PhoneLogin from '@/components/PhoneLogin';
import { NETWORK_LABEL, SPONSOR_GAS } from '@/lib/network';
import ThemeToggle from '@/components/ThemeToggle';
import LangSelector from '@/components/LangSelector';
import { useLang } from '@/lib/LangContext';

interface Props { onAuth: (account: SmartAccount, address: string) => void; }

const springs = {
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as const,
  gentle: { type: 'spring', stiffness: 280, damping: 26 } as const,
};

type AuthError = { msg: string; action?: 'login' | 'register' };

/** The app whose built-in browser this is (passkeys don't work in those), or null in a normal browser. */
function detectInAppBrowser(): string | null {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Twitter|TwitterAndroid/i.test(ua)) return 'X';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/Telegram/i.test(ua)) return 'Telegram';
  return null;
}

/** Name, message and the underlying cause (viem wraps Circle's RPC errors, e.g. "Unknown RPC error" → the real reason). */
const errText = (e: unknown) => {
  if (!(e instanceof Error)) return String(e);
  const x = e as Error & { details?: string; cause?: { message?: string; details?: string } };
  return [x.name, x.message, x.details, x.cause?.message, x.cause?.details].filter(Boolean).join(' ');
};

/** Turn Circle / WebAuthn / viem errors into something a first-time user can act on. */
function friendlyAuthError(e: unknown, mode: 'register' | 'login'): AuthError {
  const raw = errText(e);
  if (/NotAllowedError|not allowed|timed out|cancel/i.test(raw)) {
    return mode === 'login'
      ? { msg: 'No passkey was used. If you have not created a Handova account on this device yet, create one first.', action: 'register' }
      : { msg: 'Face ID / fingerprint was cancelled or timed out. Tap the button to try again.' };
  }
  if (/InvalidStateError|already registered/i.test(raw)) {
    return { msg: 'This device already has a Handova account. Sign in instead.', action: 'login' };
  }
  if (/not ?found|no credential|unknown credential|does not exist/i.test(raw)) {
    return { msg: 'We could not find a Handova account for that passkey. Passkeys made on another website or device do not carry over — create a new account here.', action: 'register' };
  }
  // Circle has no wallet setup for this network/domain yet (Modular Wallets passkey domain not configured).
  if (/entity config|-32012/i.test(raw)) {
    return { msg: 'Account sign-up is being switched on for Handova right now, so new accounts can\'t be created yet. Please try again in a few minutes.' };
  }
  if (/Invalid credentials|401|Unauthorized|clientKey/i.test(raw)) {
    return { msg: 'Handova cannot reach its wallet service right now. Please try again in a few minutes.' };
  }
  if (/SecurityError/i.test(raw)) {
    return { msg: 'Passkeys are not available on this web address. Open Handova from its official link and try again.' };
  }
  if (/Failed to fetch|NetworkError|network/i.test(raw)) {
    return { msg: 'No internet connection. Check your data or Wi-Fi and try again.' };
  }
  return { msg: mode === 'login' ? 'Could not sign in. Please try again.' : 'Could not create your account. Please try again.' };
}

/** Short random tag so two people with the same name never collide in Circle's username registry. */
const nameTag = () => Math.random().toString(36).slice(2, 8);

export default function AuthGate({ onAuth }: Props) {
  const { t } = useLang();
  const [mode, setMode] = useState<'choose' | 'register' | 'login' | 'phone'>('choose');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void restoreSession().then((account) => {
      if (account) onAuth(account, account.address);
      else setRestoring(false);
    });
  }, [onAuth]);

  const clientKeyMissing = !import.meta.env.VITE_CLIENT_KEY;
  // Strip accents (Ọlá → Ola) and anything else Circle usernames don't accept.
  const sanitized = username.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const usernameValid = sanitized.length >= 2;

  async function handleRegister() {
    if (clientKeyMissing) { setError({ msg: 'Circle Client Key not set. See setup banner above.' }); return; }
    if (!usernameValid) { setError({ msg: 'Please enter your name (at least 2 letters).' }); return; }
    setLoading(true); setError(null);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { account } = await registerPasskey(`${sanitized}${nameTag()}`);
          onAuth(account, account.address);
          return;
        } catch (e) {
          // Retry with a fresh tag only for a username clash; anything else is a real failure.
          if (!/duplicat/i.test(errText(e)) || attempt >= 2) throw e;
        }
      }
    } catch (e: unknown) {
      console.error('[Handova] registerPasskey error:', e);
      setError(friendlyAuthError(e, 'register'));
    } finally { setLoading(false); }
  }

  async function handleLogin() {
    if (clientKeyMissing) { setError({ msg: 'Circle Client Key not set. See setup banner above.' }); return; }
    setLoading(true); setError(null);
    try {
      const { account } = await loginPasskey();
      onAuth(account, account.address);
    } catch (e: unknown) {
      console.error('[Handova] loginPasskey error:', e);
      setError(friendlyAuthError(e, 'login'));
    } finally { setLoading(false); }
  }

  function runErrorAction(action: 'login' | 'register') {
    setError(null);
    if (action === 'login') { setMode('choose'); void handleLogin(); }
    else setMode('register');
  }

  if (restoring) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg-gradient)' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        </motion.div>
      </div>
    );
  }

  const TRUST_BADGES = [
    { icon: Shield,       label: 'USDC Escrow',   sub: t('escrow_note') },
    { icon: Fingerprint,  label: t('sign_in'),     sub: t('passkey_sub') },
    { icon: CheckCircle2, label: t('no_agent'),    sub: t('zero_fees') },
  ];

  const inAppBrowser = detectInAppBrowser();

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'var(--bg-gradient)' }}>
      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div className="orb-green"
          style={{ width: 380, height: 380, top: '2%', left: '-8%' }}
          animate={{ x: [0, 20, 0], y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="orb-gold"
          style={{ width: 320, height: 320, bottom: '4%', right: '-6%' }}
          animate={{ x: [0, -16, 0], y: [0, 14, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="orb-green"
          style={{ width: 200, height: 200, bottom: '30%', left: '60%', opacity: 0.5 }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      {/* Top-right controls */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <LangSelector compact showMic={false} />
        <ThemeToggle />
      </div>

      {/* Console setup banner */}
      <AnimatePresence>
        {clientKeyMissing && (
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }} className="relative z-10 mx-4 mt-4">
            <div className="rounded-2xl p-4 text-sm" style={{ background: '#fff3cd', border: '1px solid #e6c100', color: '#7a4f00' }}>
              <div className="font-semibold mb-1">Console setup required</div>
              <ol className="list-decimal list-inside space-y-1 text-xs" style={{ color: '#5a3a00' }}>
                <li>Go to <strong>console.circle.com</strong> → Keys → Client Keys → Create</li>
                <li>Set <strong>Allowed Domain</strong> to: <code className="mono text-[10px] bg-black/10 px-1 rounded">{window.location.hostname}</code></li>
                <li>Paste key into <strong>VITE_CLIENT_KEY</strong> in <code className="mono text-[10px]">.env</code></li>
                <li>Wallets → Modular Wallets → Configurator → Passkeys → <strong>Domain Name</strong> = same hostname</li>
                <li>Restart the dev server</li>
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-app browsers (LinkedIn, X, Instagram, Facebook…) can't use passkeys: send people to a real browser. */}
      {inAppBrowser && (
        <div className="relative z-10 mx-4 mt-16 rounded-2xl p-4 text-sm" style={{ background: 'rgba(242,180,90,0.12)', border: '1px solid rgba(242,180,90,0.45)', color: 'var(--ink)' }}>
          <p className="font-semibold mb-1">Open Handova in {/android/i.test(navigator.userAgent) ? 'Chrome' : 'Safari'} to sign up</p>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-2)' }}>
            You're in {inAppBrowser}'s built-in browser, where Face ID / fingerprint sign-in doesn't work. Tap the ⋯ menu and choose "Open in browser", or use a button below.
          </p>
          <div className="flex gap-2 flex-wrap">
            {/android/i.test(navigator.userAgent) && (
              <a href={`intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>Open in Chrome</a>
            )}
            <button onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => toast.success('Link copied. Paste it into your browser.'), () => toast.error('Couldn’t copy. Long-press the address to copy it.')); }}
              className="px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>Copy link</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-dvh px-5 py-16">
        {/* Logo */}
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ ...springs.gentle, delay: 0.05 }} className="relative mb-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{ background: 'var(--accent)', boxShadow: 'none' }}>
            <Home className="w-10 h-10 text-white" />
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }} className="display text-4xl font-bold text-center mb-2"
          style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
          Handova
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }} className="text-center text-sm max-w-xs mb-1"
          style={{ color: 'var(--muted)' }}>
          {t('tagline')}
        </motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24 }}
          className="text-center text-xs font-semibold mb-10" style={{ color: 'var(--accent)' }}>
          {t('zero_fees')}
        </motion.p>

        {/* Trust badges — only on the first screen; once signing in, keep the form near the top on small phones */}
        {mode === 'choose' && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }} className="flex gap-3 flex-wrap justify-center mb-10">
          {TRUST_BADGES.map(({ icon: Icon, label, sub }) => (
            <div key={label} className="glass-pill flex items-center gap-2 px-3 py-2 rounded-2xl">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--accent-soft)' }}>
                <Icon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              </div>
              <div className="max-w-[190px]">
                <p className="text-xs font-semibold leading-tight mb-0.5" style={{ color: 'var(--ink)' }}>{label}</p>
                <p className="text-[10px] leading-snug" style={{ color: 'var(--muted)' }}>{sub}</p>
              </div>
            </div>
          ))}
        </motion.div>}

        {/* Auth card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }} className="w-full max-w-sm">
          <div className="glass-card rounded-3xl p-6">

            <AnimatePresence mode="wait">
              {/* Choose */}
              {mode === 'choose' && (
                <motion.div key="choose" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }} transition={springs.snappy}>
                  <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{t('welcome')}</h2>
                  <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>{t('welcome_sub')}</p>

                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => setMode('register')}
                    className="w-full py-4 rounded-2xl font-semibold text-white text-base mb-3 flex items-center justify-center gap-2"
                    style={{ background: 'var(--accent)', boxShadow: 'none' }}>
                    <Fingerprint className="w-5 h-5" />
                    {t('create_account')}
                  </motion.button>

                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => { void handleLogin(); }}
                    disabled={loading}
                    className="w-full py-4 rounded-2xl font-semibold text-base border flex items-center justify-center gap-2"
                    style={{ background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}>
                    {loading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Fingerprint className="w-4 h-4" style={{ color: 'var(--muted)' }} />}
                    {t('sign_in')}
                  </motion.button>
                  <div className="flex items-center gap-3 my-4" aria-hidden>
                    <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>or</span>
                    <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  </div>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setMode('phone'); setError(null); }}
                    className="w-full py-3.5 rounded-2xl font-semibold text-sm border flex items-center justify-center gap-2"
                    style={{ background: 'transparent', color: 'var(--ink)', borderColor: 'var(--border)' }}>
                    <Phone className="w-4 h-4" style={{ color: 'var(--muted)' }} /> Continue with phone number
                  </motion.button>
                  <p className="text-[11px] text-center mt-2" style={{ color: 'var(--subtle)' }}>No Face ID or fingerprint? Use your number and a PIN.</p>
                  {error && <ErrorMessage error={error} onAction={runErrorAction} />}
                </motion.div>
              )}

              {/* Phone number */}
              {mode === 'phone' && (
                <motion.div key="phone" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }} transition={springs.snappy}>
                  <PhoneLogin onAuth={onAuth} onBack={() => setMode('choose')} />
                </motion.div>
              )}

              {/* Register */}
              {mode === 'register' && (
                <motion.div key="register" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }} transition={springs.snappy}>
                  <button onClick={() => { setMode('choose'); setError(null); }}
                    className="flex items-center gap-1 text-sm mb-4 -ml-0.5 transition-opacity hover:opacity-60"
                    style={{ color: 'var(--muted)' }}>
                    <ArrowLeft className="w-4 h-4" /> {t('back')}
                  </button>

                  <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{t('create_account')}</h2>
                  <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>{t('create_account_sub')}</p>

                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                    style={{ color: 'var(--muted)' }}>
                    {t('your_name')}
                  </label>
                  <input
                    type="text" value={username}
                    onChange={e => { setUsername(e.target.value); setError(null); }}
                    placeholder={t('name_placeholder')}
                    className="w-full px-4 py-3.5 rounded-xl border text-base mb-2 outline-none"
                    style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                    onKeyDown={e => { if (e.key === 'Enter') void handleRegister(); }}
                    autoFocus
                  />
                  {username.length > 0 && !usernameValid
                    ? <p className="text-xs mb-4" style={{ color: 'var(--danger)' }}>Please enter at least 2 letters.</p>
                    : <div className="mb-4" />}

                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => { void handleRegister(); }}
                    disabled={loading || !usernameValid}
                    className="w-full py-4 rounded-2xl font-semibold text-white text-base flex items-center justify-center gap-2"
                    style={{
                      background: usernameValid && !loading ? 'var(--accent)' : 'var(--subtle)',
                      boxShadow: usernameValid && !loading ? 'none' : 'none',
                    }}>
                    {loading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('setting_up')}</>
                      : <><Fingerprint className="w-5 h-5" /> {t('create_with_biometric')}</>}
                  </motion.button>
                  {error && <ErrorMessage error={error} onAction={runErrorAction} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-center text-xs mt-6" style={{ color: 'var(--subtle)' }}>
          {t('powered_by').replace('Arc Testnet', NETWORK_LABEL).split(' · ').filter((_, i, all) => SPONSOR_GAS || i < all.length - 1).join(' · ')} · <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">Privacy</a>
        </motion.p>
      </div>
    </div>
  );
}

function ErrorMessage({ error, onAction }: { error: AuthError; onAction: (a: 'login' | 'register') => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="mt-3 p-3 rounded-xl text-xs space-y-2"
      style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.18)', color: 'var(--danger)' }}
      role="alert">
      <div className="flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="leading-relaxed">{error.msg}</span>
      </div>
      {error.action && (
        <button onClick={() => onAction(error.action!)}
          className="w-full py-2 rounded-lg font-semibold text-xs"
          style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          {error.action === 'login' ? 'Sign in instead' : 'Create a new account'}
        </button>
      )}
    </motion.div>
  );
}

/**
 * LanguageWelcome — first screen on a first visit: pick your language with one big tap.
 * Each option greets in its own language so people who don't read English can find theirs.
 */

import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { LANGUAGES, type LangCode } from '@/lib/i18n';
import { useLang } from '@/lib/LangContext';

const GREETING: Record<LangCode, string> = {
  en: 'Welcome',
  yo: 'Ẹ kú àbọ̀',
  pcm: 'How far, welcome!',
  ig: 'Nnọọ',
  ha: 'Barka da zuwa',
};

export default function LanguageWelcome() {
  const { setLang } = useLang();

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-12" style={{ background: 'var(--bg-gradient)' }}>
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5"
        style={{ background: 'var(--accent)', boxShadow: 'none' }}>
        <Home className="w-8 h-8 text-white" />
      </div>
      <h1 className="display text-3xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Handova</h1>
      <p className="text-sm mb-8 text-center" style={{ color: 'var(--muted)' }}>
        Choose your language · Yan èdè rẹ · Zaɓi harshe
      </p>

      <div className="w-full max-w-sm space-y-3">
        {LANGUAGES.map((l, i) => (
          <motion.button
            key={l.code}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLang(l.code)}
            className="w-full flex items-center justify-between px-5 py-4 rounded-2xl text-left"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
          >
            <span>
              <span className="block text-lg font-bold" style={{ color: 'var(--ink)' }}>{l.nativeName}</span>
              <span className="block text-sm" style={{ color: 'var(--muted)' }}>{GREETING[l.code]}</span>
            </span>
            <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold uppercase"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {l.code === 'pcm' ? 'NG' : l.code}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

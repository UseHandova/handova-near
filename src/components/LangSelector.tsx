/**
 * LangSelector — floating language picker with animated dropdown.
 * Each language option shows native name + flag emoji.
 * Tapping the mic button starts Web Speech API voice input in the active language.
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, ChevronDown, Check } from 'lucide-react';
import { LANGUAGES } from '@/lib/i18n';
import type { LangCode } from '@/lib/i18n';
import { startVoiceInput } from '@/lib/i18n';
import { useLang } from '@/lib/LangContext';
import { toast } from 'sonner';

const FLAG: Record<LangCode, string> = {
  en:  '🇬🇧',
  yo:  '🇳🇬',
  pcm: '🇳🇬',
  ig:  '🇳🇬',
  ha:  '🇳🇬',
};

interface Props {
  /** If provided, voice input transcript is delivered here. */
  onVoiceResult?: (text: string) => void;
  /** Show mic button. Default true. */
  showMic?: boolean;
  /** Compact mode — show only the flag + chevron */
  compact?: boolean;
}

export default function LangSelector({ onVoiceResult, showMic = true, compact = false }: Props) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function handleMic() {
    if (listening) {
      stopRef.current?.();
      setListening(false);
      return;
    }
    setListening(true);
    const stop = startVoiceInput({
      lang,
      onResult: (text) => {
        setListening(false);
        onVoiceResult?.(text);
        toast.success(`Voice: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
      },
      onEnd: () => setListening(false),
      onError: (err) => {
        setListening(false);
        toast.error(err);
      },
    });
    stopRef.current = stop;
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Language picker */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-colors text-sm font-medium"
          style={{
            background: 'var(--surface-muted)',
            color: 'var(--ink)',
            border: '1px solid var(--border)',
          }}
        >
          <span>{FLAG[lang]}</span>
          {!compact && <span style={{ color: 'var(--ink)' }}>{current.nativeName}</span>}
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{
              color: 'var(--muted)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="absolute right-0 mt-1 w-44 rounded-2xl shadow-lg z-50 overflow-hidden"
              style={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
              }}
            >
              {LANGUAGES.map((l, i) => (
                <motion.button
                  key={l.code}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                  style={{
                    color: 'var(--ink)',
                    background: lang === l.code ? 'var(--accent-soft)' : 'transparent',
                    borderBottom: i < LANGUAGES.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span className="text-base">{FLAG[l.code]}</span>
                  <div className="flex-1">
                    <div className="font-medium leading-none mb-0.5">{l.nativeName}</div>
                    <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{l.name}</div>
                  </div>
                  {lang === l.code && (
                    <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  )}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mic button */}
      {showMic && onVoiceResult && (
        <motion.button
          onClick={handleMic}
          whileTap={{ scale: 0.92 }}
          animate={listening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
          transition={listening ? { duration: 0.9, repeat: Infinity } : {}}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
          title={listening ? 'Stop listening' : 'Speak to fill field'}
          style={{
            background: listening ? 'var(--danger)' : 'var(--surface-muted)',
            border: `1px solid ${listening ? 'var(--danger)' : 'var(--border)'}`,
            color: listening ? 'white' : 'var(--muted)',
          }}
        >
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </motion.button>
      )}
    </div>
  );
}

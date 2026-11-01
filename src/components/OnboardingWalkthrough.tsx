/**
 * OnboardingWalkthrough — first-time user tooltip tour.
 * 3-step overlay for both tenant and landlord roles.
 * Shown once per device; skippable.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Search, ShieldCheck, ArrowRight, X, BadgeCheck } from 'lucide-react';
import { useLang } from '@/lib/LangContext';

const STORAGE_KEY = 'rentflow_onboarded';

interface Props {
  role: 'tenant' | 'landlord';
  onDone: () => void;
}

interface Step {
  icon: React.ElementType;
  iconBg: string;
  title: string;
  body: string;
}

export function shouldShowOnboarding(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch { return false; }
}

function markOnboarded() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
}

export default function OnboardingWalkthrough({ role, onDone }: Props) {
  const { t } = useLang();
  const [step, setStep] = useState(0);

  const tenantSteps: Step[] = [
    { icon: Search, iconBg: 'var(--accent)', title: t('onboarding_step1'), body: 'Filter by area, property type, and furnishing. All 50+ Lagos areas covered.' },
    { icon: BadgeCheck, iconBg: 'var(--accent)', title: t('onboarding_step2'), body: 'Chat with the landlord in Handova, visit the property, and confirm you are satisfied before any money moves.' },
    { icon: ShieldCheck, iconBg: 'var(--accent)', title: t('onboarding_step3'), body: 'Rent is held in a smart contract. Released to the landlord only after you confirm move-in. Your deposit is also protected.' },
  ];

  const landlordSteps: Step[] = [
    { icon: Home, iconBg: 'var(--accent)', title: 'List in 2 minutes', body: 'Add photos, set your price in Naira, and choose your property type. Your listing goes live onchain immediately.' },
    { icon: ShieldCheck, iconBg: 'var(--accent)', title: 'Zero agent fees', body: 'Tenants pay directly to the smart contract. You receive 100% of rent — no middleman, no 10% agency cut.' },
    { icon: BadgeCheck, iconBg: 'var(--accent)', title: 'Boost for more views', body: 'Use Listing Boost to feature your property at the top. Pay a small USDC fee and get 5-8× more tenant inquiries.' },
  ];

  const steps = role === 'tenant' ? tenantSteps : landlordSteps;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  // Don't render if already onboarded
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(shouldShowOnboarding());
  }, []);

  function handleNext() {
    if (isLast) finish();
    else setStep(s => s + 1);
  }

  function finish() {
    markOnboarded();
    setShow(false);
    onDone();
  }

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center px-5"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(12px)' }}
      >
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          className="w-full max-w-sm rounded-3xl overflow-hidden"
          style={{
            background: 'var(--glass-card)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
            border: '1px solid var(--glass-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          }}
        >
          {/* Icon area */}
          <div className="flex flex-col items-center justify-center pt-10 pb-6 px-6 relative">
            <button onClick={finish}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'var(--surface-strong)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--muted)' }} />
            </button>
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
              className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
              style={{ background: current.iconBg, boxShadow: '0 12px 36px rgba(0,0,0,0.25)' }}>
              <current.icon className="w-10 h-10 text-white" />
            </motion.div>
            <h2 className="display text-xl font-bold text-center mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {step === 0 ? t('onboarding_welcome') : current.title}
            </h2>
            <p className="text-sm text-center leading-relaxed" style={{ color: 'var(--muted)' }}>
              {step === 0 ? current.title : current.body}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 pb-4">
            {steps.map((_, i) => (
              <div key={i} className="h-1.5 rounded-full transition-all"
                style={{ width: i === step ? 24 : 6, background: i === step ? 'var(--accent)' : 'var(--border)' }} />
            ))}
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm border"
                style={{ background: 'var(--surface-strong)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                Back
              </button>
            )}
            <motion.button whileTap={{ scale: 0.97 }} onClick={handleNext}
              className="flex-1 py-3 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-1.5"
              style={{ background: 'var(--accent)', boxShadow: 'none' }}>
              {isLast ? t('onboarding_done') : t('onboarding_next')}
              {!isLast && <ArrowRight className="w-4 h-4" />}
            </motion.button>
          </div>
          {!isLast && (
            <button onClick={finish} className="w-full text-center pb-5 text-xs" style={{ color: 'var(--subtle)' }}>
              {t('onboarding_skip')}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

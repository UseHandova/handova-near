import { motion } from 'framer-motion';
import { Search, FileText } from 'lucide-react';

export type Tab = 'browse' | 'leases';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
  role?: 'tenant' | 'landlord';
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'browse', label: 'Browse', icon: Search },
  { id: 'leases', label: 'My Leases', icon: FileText },
];

export default function TabBar({ active, onChange }: Props) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center gap-[min(30vw,12rem)] px-4 pb-safe frosted-bar"
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: '10px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.06)',
      }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="relative flex flex-col items-center gap-1 px-6 py-1 rounded-2xl transition-colors min-w-[80px]"
            style={{ color: isActive ? 'var(--accent)' : 'var(--subtle)' }}
          >
            {isActive && (
              <motion.div
                layoutId="tab-bg"
                className="absolute inset-0 rounded-2xl"
                style={{ background: 'var(--accent-soft)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              />
            )}
            <span className="relative">
              <Icon className="w-5 h-5" />
            </span>
            <span className="relative text-[10px] font-semibold tracking-wide">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

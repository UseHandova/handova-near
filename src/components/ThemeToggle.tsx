import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { toggleTheme, getTheme } from '@/lib/theme';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => getTheme() === 'dark');

  function handleToggle() {
    const next = toggleTheme();
    setDark(next === 'dark');
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative w-14 h-7 rounded-full flex items-center transition-colors duration-300 focus:outline-none"
      style={{
        background: dark
          ? 'rgba(172,198,233,0.25)'
          : 'rgba(18,45,69,0.10)',
        border: dark
          ? '1px solid rgba(172,198,233,0.35)'
          : '1px solid rgba(18,45,69,0.14)',
      }}
    >
      {/* Track icons */}
      <span className="absolute left-1.5 text-[11px]" style={{ color: dark ? 'transparent' : '#f59e0b' }}>
        <Sun className="w-3.5 h-3.5" />
      </span>
      <span className="absolute right-1.5 text-[11px]" style={{ color: dark ? '#acc6e9' : 'transparent' }}>
        <Moon className="w-3.5 h-3.5" />
      </span>
      {/* Thumb */}
      <motion.div
        layout
        animate={{ x: dark ? 28 : 4 }}
        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        className="w-5 h-5 rounded-full absolute"
        style={{
          background: dark ? '#acc6e9' : '#122d45',
          boxShadow: dark
            ? '0 1px 6px rgba(172,198,233,0.45)'
            : '0 1px 6px rgba(18,45,69,0.35)',
        }}
      />
    </button>
  );
}

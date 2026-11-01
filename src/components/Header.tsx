// Header with theme toggle, lang selector, role badge, notifications
import { motion } from 'framer-motion';
import { Home, LogOut, ArrowLeftRight, Wallet, Shield } from 'lucide-react';
import { clearCredential } from '@/lib/wallet';
import ThemeToggle from '@/components/ThemeToggle';
import LangSelector from '@/components/LangSelector';
import NotificationCenter from '@/components/NotificationCenter';

import { useIsAdmin } from '@/lib/chain';
import { navigate } from '@/lib/router';

interface Props {
  address: string;
  pendingUsdc: number;
  onSignOut: () => void;
  onWithdraw: () => void;
  role?: 'tenant' | 'landlord';
  onSwitchRole?: () => void;
  onOpenAdmin?: () => void;
  /** Chat button + panel (needs the signed-in account, which the header doesn't have). */
  chat?: React.ReactNode;
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  landlord: { bg: 'var(--accent-soft)', text: 'var(--accent)' },
  tenant:   { bg: 'rgba(91,184,138,0.15)', text: 'var(--success)' },
};

export default function Header({ address, pendingUsdc, onSignOut, onWithdraw, role, onSwitchRole, onOpenAdmin, chat }: Props) {
  const isAdmin = useIsAdmin(address);
  function handleSignOut() {
    clearCredential();
    onSignOut();
  }

  const roleColor = role ? ROLE_COLORS[role] : null;

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 border-b"
      style={{
        background: 'var(--bar)',
        backdropFilter: 'blur(14px) saturate(160%)',
        WebkitBackdropFilter: 'blur(14px) saturate(160%)',
        borderColor: 'var(--border)',
        boxShadow: '0 1px 0 var(--border)',
      }}
    >
      {/* Left: Logo + role pill */}
      <div className="flex items-center gap-2.5">
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={() => navigate(role ? `/${role}` : '/')}
          aria-label="Home"
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--accent)', boxShadow: 'none' }}
        >
          <Home className="w-4 h-4 text-white" />
        </motion.button>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(role ? `/${role}` : '/')} className="display font-semibold text-base" style={{ color: 'var(--ink)' }}>
            Handova
          </button>
          {role && roleColor && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: roleColor.bg, color: roleColor.text }}
            >
              {role}
            </motion.span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 relative">
        {chat}

        {/* Notifications */}
        <NotificationCenter address={address} />

        {/* Admin (if admin wallet) */}
        {isAdmin && onOpenAdmin && (
          <motion.button whileTap={{ scale: 0.90 }} onClick={onOpenAdmin}
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            title="Admin Dashboard">
            <Shield className="w-4 h-4" style={{ color: '#ef4444' }} />
          </motion.button>
        )}

        {/* Pending USDC */}
        {pendingUsdc > 0 && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onWithdraw}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          >
            <Wallet className="w-3.5 h-3.5" />
            Withdraw
          </motion.button>
        )}

        {/* Language selector */}
        <LangSelector compact showMic={false} />

        {/* Theme toggle — desktop only; phones follow the system theme */}
        <div className="hidden sm:block"><ThemeToggle /></div>

        {/* Switch role */}
        {role && onSwitchRole && (
          <motion.button
            whileTap={{ scale: 0.90 }}
            onClick={onSwitchRole}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            title={`Switch from ${role}`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
          </motion.button>
        )}

        {/* Wallet address pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--success)' }} />
          <span className="mono">{shortAddr(address)}</span>
        </div>

        {/* Sign out */}
        <motion.button
          whileTap={{ scale: 0.90 }}
          onClick={handleSignOut}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          title="Sign out"
        >
          <LogOut className="w-4 h-4" style={{ color: 'var(--muted)' }} />
        </motion.button>
      </div>
    </motion.header>
  );
}

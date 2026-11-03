import { Building2, KeyRound } from 'lucide-react';
import { useT } from '../lib/i18n';
import { go } from '../lib/router';
import { useSession, type Role } from '../lib/session';
import { Sheet } from './ui';

const OPTIONS: { role: Role; icon: typeof KeyRound; title: string; text: string }[] = [
  { role: 'tenant', icon: KeyRound, title: "I'm looking for a home", text: 'Pay rent into escrow, move in, get your caution fee back.' },
  { role: 'landlord', icon: Building2, title: 'I rent out homes', text: 'List homes, hand over keys, get paid when the tenant moves in.' },
];

/** Two big choices: tenant or landlord. */
export function RoleCards({ value, onChange }: { value: Role | null; onChange: (r: Role) => void }) {
  const { t } = useT();
  return (
    <div role="radiogroup" aria-label={t('How will you use Handova?')} className="grid gap-2 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const on = value === o.role;
        return (
          <button
            key={o.role}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.role)}
            className={`card flex items-start gap-3 p-4 text-left transition duration-200 ${on ? '!border-accent ring-2 ring-accent/25' : 'hover:border-accent/60'}`}
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${on ? 'bg-accent text-white' : 'bg-accent-soft text-accent'}`}>
              <o.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-semibold">{t(o.title)}</span>
              <span className="text-sm text-sub">{t(o.text)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Asked once when someone signs in without a role on this device (a wallet, a restore, a new phone). */
export function RolePrompt() {
  const { session, ready, role, setRole } = useSession();
  const { t } = useT();
  const choose = (r: Role) => {
    setRole(r);
    if (r === 'landlord') go('/landlord');
  };
  return (
    <Sheet open={ready && !!session && role === null} onClose={() => setRole('tenant')} title={t('How will you use Handova?')}>
      <div className="space-y-3">
        <RoleCards value={null} onChange={choose} />
        <p className="text-center text-xs text-faint">{t('You can switch any time on your Account page.')}</p>
      </div>
    </Sheet>
  );
}

/** Compact switch for the Account page. */
export function RoleSwitch() {
  const { role, setRole } = useSession();
  const { t } = useT();
  return (
    <div role="radiogroup" aria-label={t('I use Handova as')} className="grid grid-cols-2 gap-1 rounded-full border border-line bg-muted p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.role}
          role="radio"
          aria-checked={role === o.role}
          onClick={() => setRole(o.role)}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition-colors duration-200 ${role === o.role ? 'bg-surface text-accent shadow-sm' : 'text-sub hover:text-ink'}`}
        >
          <o.icon className="h-4 w-4" />
          {o.role === 'tenant' ? t('Tenant') : t('Landlord')}
        </button>
      ))}
    </div>
  );
}

/**
 * Minimal router over the History API — Handova only needs a handful of paths:
 *   /                  role picker (or redirect to the last role)
 *   /tenant            browse homes          /tenant/leases       my leases
 *   /landlord          your properties       /landlord/new        list a property
 *   /landlord/whatsapp list by WhatsApp      /landlord/insights   insights
 *   /landlord/rented   homes rented out (next rent due)
 * Reload, back/forward and shared links all land on the right screen.
 */

import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'rentflow:navigate';
const ROLE_KEY = 'rf-role';

export type Role = 'tenant' | 'landlord';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

const getPath = () => window.location.pathname.replace(/\/+$/, '') || '/';

export function navigate(to: string, { replace = false } = {}) {
  // Dev-only: keep ?preview=…&as=… across navigation so the passkey-free preview survives clicks.
  if (import.meta.env.DEV) {
    const cur = new URLSearchParams(window.location.search);
    if (cur.has('preview') && !to.includes('preview=')) {
      const keep = new URLSearchParams({ preview: cur.get('preview')!, ...(cur.get('as') ? { as: cur.get('as')! } : {}) });
      to += (to.includes('?') ? '&' : '?') + keep.toString();
    }
  }
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

/** Current path (no trailing slash) and a navigate function. */
export function usePath(): [string, typeof navigate] {
  const path = useSyncExternalStore(subscribe, getPath, getPath);
  return [path, navigate];
}

export function roleFromPath(path: string): Role | null {
  if (path === '/tenant' || path.startsWith('/tenant/')) return 'tenant';
  if (path === '/landlord' || path.startsWith('/landlord/')) return 'landlord';
  return null;
}

export function rememberRole(role: Role | null) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role); else localStorage.removeItem(ROLE_KEY);
  } catch { /* storage unavailable */ }
}

export function rememberedRole(): Role | null {
  try {
    const r = localStorage.getItem(ROLE_KEY);
    return r === 'tenant' || r === 'landlord' ? r : null;
  } catch { return null; }
}

/** Homes saved for later. Kept on this device (no sign-in needed), shared across open tabs. */
import { useEffect, useState } from 'react';

const KEY = 'handova:saved';
const EVENT = 'handova:saved';

function read(): number[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]).map(Number).filter(Number.isInteger); } catch { return []; }
}

export function useSaved() {
  const [ids, setIds] = useState<number[]>(read);
  useEffect(() => {
    const sync = () => setIds(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const toggle = (id: number) => {
    const next = read().includes(id) ? read().filter((x) => x !== id) : [id, ...read()];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: lasts this visit */ }
    setIds(next);
    window.dispatchEvent(new Event(EVENT));
    return next.includes(id);
  };
  return { saved: new Set(ids), toggle };
}

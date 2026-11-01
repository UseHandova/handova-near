import { useEffect, useState } from 'react';

/** Tiny hash router: #/home/3 → ['home', '3']. Works on any static host. */
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export const go = (path: string) => { location.hash = path; };

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';

interface Toast { id: number; kind: 'ok' | 'error'; text: string; href?: string }
const Ctx = createContext<(kind: Toast['kind'], text: string, href?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string, href?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text, href }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 6000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-md flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="card pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 text-sm">
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
            <span className="flex-1">{t.text}</span>
            {t.href && <a href={t.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">View <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

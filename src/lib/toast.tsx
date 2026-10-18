/**
 * NOIR Music — lightweight toasts.
 *
 * A minimal self-contained version of the.NOIR toast primitive with the same
 * API: imperative `toast.show(message, { tone })`. The surface is small
 * because toasts here only report import results and playback failures —
 * anything the user must act on uses an inline state instead.
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** How long the toast stays visible. Default 3.5 s. */
  durationMs?: number;
}

interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show(message: string, options?: ToastOptions): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return value;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = (counter.current += 1);
    const tone = options.tone ?? 'info';
    setToasts((prev) => [...prev, { id, message, tone }]);
    const duration = options.durationMs ?? 3500;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

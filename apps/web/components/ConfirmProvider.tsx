'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button for destructive actions
};

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** Await a styled yes/no dialog: `const ok = await confirm({ title, message })`. */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="confirm-overlay" onClick={() => close(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">{opts.title}</h3>
            {opts.message && <p className="confirm-msg">{opts.message}</p>}
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
              <button className={`btn ${opts.danger ? 'btn-red' : 'btn-green'}`} onClick={() => close(true)}>{opts.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

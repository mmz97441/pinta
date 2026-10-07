import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ConfirmDialog() {
  const { cfm, closeConfirm, setCfm, flash } = useApp();
  const [busy, setBusy] = useState(false);
  // { message, final }: a final error (e.g. payment seen, no permission) removes the action it refused.
  const [inlineError, setInlineError] = useState(null);
  useEffect(() => { setInlineError(null); }, [cfm]);
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!cfm) return;
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const handle = (event) => {
      const focusedDialog = document.activeElement?.closest?.('[role="dialog"]');
      if (focusedDialog && focusedDialog !== dialogRef.current) return;
      if (event.key === 'Escape' && !busy) {
        event.stopImmediatePropagation();
        event.preventDefault();
        closeConfirm();
      }
      if (event.key === 'Tab') {
        const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, [cfm, busy, closeConfirm]);
  if (!cfm) return null;
  const confirm = async () => {
    if (busy) return;
    const current = cfm;
    setBusy(true); setInlineError(null);
    try {
      await current.onOk();
      // onOk may open the next dialog (e.g. a quote withdrawal): keep it open.
      setCfm(value => (value === current ? null : value));
    } catch (error) {
      // inlineError: the error stays inside the dialog, which stays open.
      if (current.inlineError) setInlineError({ message: error.message || 'L’action n’a pas abouti. Réessayez.', final: error.final === true, body: typeof error.dialogMessage === 'string' ? error.dialogMessage : null });
      else flash({ msg: error.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[100] p-3 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) closeConfirm();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="bg-white dark:bg-gray-900 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl p-6 shadow-2xl"
      >
        <div className="flex justify-between items-start gap-3">
          <h2 id="confirm-title" className="text-lg font-bold mb-2">
            {cfm.title}
          </h2>
          <button
            aria-label="Fermer la confirmation"
            disabled={busy}
            onClick={closeConfirm}
            className="min-w-[44px] min-h-[44px] flex justify-center items-center -mt-2 -mr-2"
          >
            <X size={20} />
          </button>
        </div>
        {/* A final error replaces the body: the action it describes will not happen. */}
        {!inlineError?.final && <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 whitespace-pre-line break-words">
          {inlineError?.body || cfm.msg}
        </p>}
        {inlineError && <p role="alert" data-testid="confirm-inline-error" data-final={inlineError.final ? 'true' : undefined} className={`text-red-600 text-sm mb-4 whitespace-pre-line break-words ${inlineError.final ? '' : '-mt-3'}`}>{inlineError.message}</p>}
        {/* Stacked on narrow screens so a long action label keeps the full width. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            disabled={busy}
            onClick={closeConfirm}
            className="flex-1 min-h-[44px] px-4 py-2 leading-tight rounded-xl font-semibold bg-gray-100 dark:bg-gray-800"
          >
            {inlineError?.final ? 'Fermer' : cfm.cancelLabel || 'Annuler'}
          </button>
          {!inlineError?.final && <button
            disabled={busy}
            onClick={confirm}
            className={`flex-1 min-h-[44px] px-4 py-2 leading-tight rounded-xl font-semibold text-white flex justify-center items-center gap-2 ${cfm.danger ? 'bg-red-600' : 'bg-[#17324D] dark:bg-[#C4DAE5] dark:text-[#122A36]'} disabled:opacity-50`}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {cfm.okLabel || 'Confirmer'}
          </button>}
        </div>
      </div>
    </div>
  );
}

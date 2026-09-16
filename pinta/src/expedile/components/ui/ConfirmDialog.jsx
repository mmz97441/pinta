import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ConfirmDialog() {
  const { cfm, closeConfirm, flash } = useApp();
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      await cfm.onOk();
      closeConfirm();
    } catch (error) {
      flash({ msg: error.message, type: 'error' });
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
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 whitespace-pre-line break-words">
          {cfm.msg}
        </p>
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={closeConfirm}
            className="flex-1 min-h-[44px] rounded-xl font-semibold bg-gray-100 dark:bg-gray-800"
          >
            Annuler
          </button>
          <button
            disabled={busy}
            onClick={confirm}
            className={`flex-1 min-h-[44px] rounded-xl font-semibold text-white flex justify-center items-center gap-2 ${cfm.danger ? 'bg-red-600' : 'bg-[#17324D]'} disabled:opacity-50`}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {cfm.okLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

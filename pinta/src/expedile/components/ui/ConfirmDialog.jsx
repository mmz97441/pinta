import React from 'react';
import { useApp } from '../../context/AppContext';

export default function ConfirmDialog() {
  const { cfm, closeConfirm } = useApp();
  if (!cfm) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 shadow-2xl mx-4 mb-0 sm:mb-0 anim-fade-up">
        <p className="text-lg font-black text-gray-900 mb-2">{cfm.title}</p>
        <p className="text-sm text-gray-600 mb-6 whitespace-pre-line">{cfm.msg}</p>
        <div className="flex gap-3">
          <button
            onClick={closeConfirm}
            className="flex-1 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
          >
            Annuler
          </button>
          <button
            onClick={() => { cfm.onOk(); closeConfirm(); }}
            className={`flex-1 py-3 rounded-xl font-bold text-white active:scale-95 transition-all ${cfm.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {cfm.okLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

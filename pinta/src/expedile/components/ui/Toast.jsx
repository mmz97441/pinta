import React from 'react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';

export default function Toast() {
  const { toast, setToast } = useApp();
  if (!toast) return null;

  // Support both simple string and rich object { msg, type, action }
  const isRich = typeof toast === 'object';
  const msg = isRich ? toast.msg : toast;
  const type = isRich ? toast.type : 'info'; // 'info' | 'success' | 'warning' | 'error'
  const action = isRich ? toast.action : null; // { label, onClick }

  const bgMap = {
    info: 'rgba(27,58,75,0.95)',
    success: 'rgba(22,101,52,0.95)',
    warning: 'rgba(146,64,14,0.95)',
    error: 'rgba(153,27,27,0.95)',
  };

  return (
    <div
      className="fixed top-4 left-4 right-4 z-50 px-5 py-3.5 rounded-2xl text-white text-sm font-semibold text-center whitespace-pre-line anim-slide-down"
      style={{
        maxWidth: 440,
        margin: '0 auto',
        background: bgMap[type] || bgMap.info,
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.06) inset',
      }}
    >
      <div>{msg}</div>
      {action && (
        <button
          onClick={() => { action.onClick(); setToast(''); }}
          className="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors"
          style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

import React from 'react';
import { useApp } from '../../context/AppContext';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;

  return (
    <div
      className="fixed top-4 left-4 right-4 z-50 px-5 py-3.5 rounded-2xl text-white text-sm font-semibold text-center whitespace-pre-line anim-slide-down"
      style={{
        maxWidth: 440,
        margin: '0 auto',
        background: 'rgba(27,58,75,0.95)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.06) inset',
      }}
    >
      {toast}
    </div>
  );
}

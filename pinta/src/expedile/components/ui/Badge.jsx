import React from 'react';
import { STATUTS } from '../../constants';
import { useApp } from '../../context/AppContext';

export default function Badge({ statut }) {
  const { isStaff } = useApp();
  const s = STATUTS[statut];
  if (!s) return null;
  const text = (!isStaff && s.labelClient) ? s.labelClient : s.label;
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold tracking-tight ${s.couleur}`} style={{ letterSpacing: '-0.01em' }}>
      {text}
    </span>
  );
}

import React from 'react';
import { STATUTS } from '../../constants';

export default function Badge({ statut }) {
  const s = STATUTS[statut];
  if (!s) return null;
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold tracking-tight ${s.couleur}`} style={{ letterSpacing: '-0.01em' }}>
      {s.label}
    </span>
  );
}

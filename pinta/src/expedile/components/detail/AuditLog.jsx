import React from 'react';
import { useApp } from '../../context/AppContext';
import { STATUTS } from '../../constants';

export default function AuditLog() {
  const { sel, isStaff, logs } = useApp();
  if (!sel || !isStaff) return null;

  const colisLogs = logs.filter((l) => l.cid === sel.id);
  if (colisLogs.length === 0) return null;

  return (
    <div className="card p-4 anim-fade">
      <p className="font-bold mb-2 text-sm">Historique</p>
      {colisLogs.slice().reverse().map((l) => (
        <p key={l.id} className="text-xs text-gray-500 py-0.5">
          {l.w} : {STATUTS[l.o]?.label || l.o} → {STATUTS[l.n]?.label || l.n}
        </p>
      ))}
    </div>
  );
}

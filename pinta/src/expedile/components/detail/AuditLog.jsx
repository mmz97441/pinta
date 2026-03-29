import React from 'react';
import { useApp } from '../../context/AppContext';
import { STATUTS } from '../../constants';

const ACTION_LABELS = {
  reception: 'Réception',
  mesure: 'Mesure',
  casier: 'Casier',
  optimisation: 'Optimisation',
};

const ACTION_COLORS = {
  reception: 'text-green-600',
  mesure: 'text-blue-600',
  casier: 'text-amber-600',
  optimisation: 'text-purple-600',
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AuditLog() {
  const { sel, isStaff, logs } = useApp();
  if (!sel || !isStaff) return null;

  const colisLogs = logs.filter((l) => l.cid === sel.id);
  if (colisLogs.length === 0) return null;

  const sorted = colisLogs.slice().reverse();
  const statusLogs = sorted.filter((l) => !l.type || l.type === 'status');
  const cartonLogs = sorted.filter((l) => l.type === 'carton');

  return (
    <div className="card p-4 anim-fade">
      <p className="font-bold mb-3 text-sm">Historique</p>

      {/* Carton history */}
      {cartonLogs.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1.5">Cartons</p>
          <div className="space-y-1">
            {cartonLogs.map((l) => (
              <div key={l.id} className="flex items-start gap-2 py-1 text-xs">
                <span className={`font-bold whitespace-nowrap ${ACTION_COLORS[l.action] || 'text-gray-500'}`}>
                  {ACTION_LABELS[l.action] || l.action}
                </span>
                <span className="text-gray-600 flex-1">{l.detail}</span>
                <span className="text-gray-400 whitespace-nowrap text-[10px]">
                  {l.w}{l.at ? ` · ${formatDate(l.at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status history */}
      {statusLogs.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1.5">Statuts</p>
          {statusLogs.map((l) => (
            <p key={l.id} className="text-xs text-gray-500 py-0.5">
              {l.w} : {STATUTS[l.o]?.label || l.o} → {STATUTS[l.n]?.label || l.n}
              {l.at && <span className="text-gray-400 ml-1 text-[10px]">· {formatDate(l.at)}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

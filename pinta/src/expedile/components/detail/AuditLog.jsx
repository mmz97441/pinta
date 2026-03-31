import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { STATUTS, BRAND } from '../../constants';
import { fetchLogsForColis } from '../../lib/supabaseData';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (msgDay.getTime() === today.getTime()) return `Aujourd'hui ${time}`;
  if (msgDay.getTime() === yesterday.getTime()) return `Hier ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`;
}

export default function AuditLog() {
  const { sel, isStaff, logs } = useApp();
  const [dbLogs, setDbLogs] = useState([]);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (sel?.id) {
      fetchLogsForColis(sel.id).then(setDbLogs).catch(() => setDbLogs([]));
    }
  }, [sel?.id, sel?.statut]);

  if (!sel || !isStaff) return null;

  // Merge local logs + DB logs, deduplicate by id
  const localLogs = (logs || [])
    .filter((l) => l.cid === sel.id)
    .map((l) => ({
      id: l.id,
      ancienStatut: l.o,
      nouveauStatut: l.n,
      user: l.w,
      date: null,
    }));

  const allIds = new Set(dbLogs.map((l) => l.id));
  const merged = [...dbLogs, ...localLogs.filter((l) => !allIds.has(l.id))];

  if (merged.length === 0) return null;

  return (
    <div className="card p-4 anim-fade">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 font-bold text-sm w-full text-left"
        style={{ color: BRAND.navy }}
      >
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        Historique ({merged.length})
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2">
          {merged.map((l) => (
            <div key={l.id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-b-0">
              <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: BRAND.navy }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-gray-700">{l.user || '—'}</span>
                  <span className="text-[10px] text-gray-400">:</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUTS[l.ancienStatut]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                    {STATUTS[l.ancienStatut]?.label || l.ancienStatut || '—'}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUTS[l.nouveauStatut]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                    {STATUTS[l.nouveauStatut]?.label || l.nouveauStatut || '—'}
                  </span>
                </div>
                {l.commentaire && (
                  <p className="text-[10px] text-gray-500 mt-0.5 italic">{l.commentaire}</p>
                )}
                {l.date && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(l.date)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

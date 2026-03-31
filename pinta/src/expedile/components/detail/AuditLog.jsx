import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { STATUTS, BRAND } from '../../constants';
import { fetchLogsForColis, fetchAuditActions } from '../../lib/supabaseData';

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
  const { sel, isStaff } = useApp();
  const [entries, setEntries] = useState([]);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!sel?.id) return;
    Promise.all([
      fetchLogsForColis(sel.id),
      fetchAuditActions(sel.id),
    ]).then(([statusLogs, auditActions]) => {
      // Merge both into a single timeline
      const all = [
        ...statusLogs.map((l) => ({
          id: l.id,
          type: 'statut',
          user: l.user,
          action: 'Changement de statut',
          detail: null,
          ancienStatut: l.ancienStatut,
          nouveauStatut: l.nouveauStatut,
          date: l.date,
        })),
        ...auditActions.map((a) => ({
          id: a.id,
          type: 'action',
          user: a.user,
          action: a.action,
          detail: a.detail,
          ancienStatut: null,
          nouveauStatut: null,
          date: a.date,
        })),
      ];
      // Sort by date descending
      all.sort((a, b) => new Date(b.date) - new Date(a.date));
      setEntries(all);
    }).catch(() => setEntries([]));
  }, [sel?.id, sel?.statut]);

  if (!sel || !isStaff || entries.length === 0) return null;

  return (
    <div className="card p-4 anim-fade">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 font-bold text-sm w-full text-left"
        style={{ color: BRAND.navy }}
      >
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        Historique ({entries.length})
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-b-0">
              <div
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5"
                style={{ background: e.type === 'statut' ? BRAND.navy : BRAND.gold }}
              />
              <div className="flex-1 min-w-0">
                {e.type === 'statut' ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-gray-700">{e.user}</span>
                    <span className="text-[10px] text-gray-400">:</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUTS[e.ancienStatut]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                      {STATUTS[e.ancienStatut]?.label || e.ancienStatut || '—'}
                    </span>
                    <span className="text-gray-400">→</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUTS[e.nouveauStatut]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                      {STATUTS[e.nouveauStatut]?.label || e.nouveauStatut || '—'}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-700">{e.user}</span>
                      <span className="text-[10px] text-gray-400">—</span>
                      <span className="text-[10px] font-bold" style={{ color: BRAND.goldD }}>{e.action}</span>
                    </div>
                    {e.detail && (
                      <pre className="text-[10px] text-gray-500 mt-0.5 whitespace-pre-line font-sans">{e.detail}</pre>
                    )}
                  </div>
                )}
                {e.date && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(e.date)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

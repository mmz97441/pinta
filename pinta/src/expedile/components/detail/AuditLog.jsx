import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { STATUTS, BRAND } from '../../constants';
import { eur } from '../../utils';
import { fetchLogsForColis, fetchAuditActions } from '../../lib/supabaseData';

const ACTION_NAMES = {
  correction_reception: 'Mesures à réception corrigées',
  correction_preparation: 'Mesures après optimisation corrigées',
  correction_accord: 'Nouvelle demande d’accord préparée',
  correction_devis: 'Devis repris pour correction',
  preparation_measured: 'Mesures après préparation enregistrées', quote_saved: 'Devis enregistré', quote_sent: 'Devis envoyé', invoice_review_saved: 'Facture vérifiée', invoice_duplicate: 'Copie de facture retirée', invoice_duplicate_restored: 'Facture remise à vérifier', colis_reverted: 'Étape du dossier corrigée', colis_archived: 'Dossier archivé', colis_cancelled: 'Expédition annulée', payment_confirmed: 'Paiement confirmé', departure_confirmed: 'Départ confirmé', colis_assigned: 'Suivi du dossier attribué', staff_work_action: 'Organisation du travail mise à jour',
  quote_withdrawn: 'Devis retiré', late_invoice_received: 'Facture reçue après l’envoi du devis', invoice_modification_opened: 'Modification d’une facture validée ouverte', invoice_modification_closed: 'Modification d’une facture fermée sans enregistrement', client_invoice_identical_ignored: 'Document identique déjà présent', telegram_late_invoice_confirmed: 'Facture confirmée par le client sur Telegram',
};
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

function CorrectionHistory({ entry }) {
  if (!entry.action.startsWith('correction_') || !entry.before || !entry.after) return null;
  const values = row => {
    if (entry.action === 'correction_devis') return row.devis_total == null ? 'À recalculer et vérifier' : eur(row.devis_total);
    if (entry.action === 'correction_accord') return `${({ autorise: 'Accord donné', refuse: 'Préparation refusée', en_attente: 'Accord à demander' })[row.feu_vert] || 'Accord à vérifier'}${row.feu_vert_date ? ` · ${formatDate(row.feu_vert_date)}` : ''}`;
    const receipt = entry.action === 'correction_reception';
    const boxes = receipt ? row.dims_par_colis : row.final_packages;
    if (boxes?.length) return boxes.map((box, index) => `${receipt ? 'Carton' : 'Colis préparé'} ${index + 1} : ${box.dimL} × ${box.dimW} × ${box.dimH} cm · ${box.poids} kg`).join(' ; ');
    const [length, width, height, weight] = receipt ? [row.dim_l, row.dim_w, row.dim_h, row.poids] : [row.fin_l, row.fin_w, row.fin_h, row.fin_p];
    return weight ? `Ancien récapitulatif : ${length ?? '—'} × ${width ?? '—'} × ${height ?? '—'} cm · ${weight} kg` : 'Mesures non renseignées';
  };
  return <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200"><p><strong>Avant : </strong>{values(entry.before)}</p><p><strong>Après : </strong>{values(entry.after)}</p></div>;
}

export default function AuditLog({ expanded = false, includeAudit }) {
  const { sel, isStaff, can } = useApp();
  const [entries, setEntries] = useState([]);
  const [collapsed, setCollapsed] = useState(!expanded);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const auditAllowed = includeAudit !== false && can('perm_admin_audit');

  useEffect(() => {
    if (!sel?.id || !isStaff) return;
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      fetchLogsForColis(sel.id),
      auditAllowed ? fetchAuditActions(sel.id) : Promise.resolve([]),
    ]).then(([statusLogs, auditActions]) => {
      if (!active) return;
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
          before: a.before,
          after: a.after,
          ancienStatut: null,
          nouveauStatut: null,
          date: a.date,
        })),
      ];
      // Sort by date descending
      all.sort((a, b) => new Date(b.date) - new Date(a.date));
      setEntries(all);
    }).catch(failure => { if (active) setError(failure.message || 'L’historique n’a pas pu être chargé.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sel?.id, sel?.statut, sel?.updatedAt, isStaff, auditAllowed, attempt]);

  if (!sel || !isStaff) return null;

  return (
    <div className="card p-4 anim-fade">
      {expanded ? <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Historique du dossier</h3> : <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex min-h-11 items-center gap-1.5 font-bold text-sm w-full text-left"
        aria-expanded={!collapsed}
        style={{ color: BRAND.navy }}
      >
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        Historique ({entries.length})
      </button>}

      {loading && <p role="status" className="py-3 text-sm text-slate-600 dark:text-slate-300">Chargement de l’historique…</p>}
      {error && <div role="alert" className="py-3 text-sm text-red-700 dark:text-red-300"><p>{error}</p><button className="min-h-11 font-semibold underline" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></div>}
      {!loading && !error && entries.length === 0 && <p className="py-3 text-sm text-slate-600 dark:text-slate-300">Aucun événement enregistré.</p>}

      {!collapsed && !loading && !error && (
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
                      <span className="text-[10px] font-bold" style={{ color: BRAND.goldD }}>{ACTION_NAMES[e.action] || (String(e.action).includes('_') ? 'Action enregistrée sur le dossier' : e.action)}</span>
                    </div>
                    <details className="text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2">Détails de cet événement</summary>{e.detail && <p className="whitespace-pre-wrap break-words">{typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2)}</p>}<CorrectionHistory entry={e} /></details>
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

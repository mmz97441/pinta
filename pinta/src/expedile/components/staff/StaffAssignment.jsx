import React, { useState, useEffect } from 'react';
import { UserCheck, CalendarClock, Save } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { assignColisWork } from '../../services/conversationApi';
import DossierWorkPanel from '../workspace/DossierWorkPanel';

const manualLocalDate = colis => colis?.nextActionSource === 'manual' && colis.nextActionAt && Number.isFinite(Date.parse(colis.nextActionAt))
  ? new Date(Date.parse(colis.nextActionAt) - new Date(colis.nextActionAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

export default function StaffAssignment({ dossier }) {
  const { sel: contextSel, auth, teamUsers = [], flash, refreshColis } = useApp();
  const sel = dossier || contextSel;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ owner: '', action: '', date: '' });
  const [baseline, setBaseline] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setExpanded(false); setError(''); }, [sel?.id]);
  useEffect(() => {
    if (expanded && baseline?.id === sel?.id) return;
    const localDate = manualLocalDate(sel);
    setDraft({
      owner: sel?.responsibleStaffId || '',
      action: sel?.nextAction || '',
      date: localDate,
    });
    setBaseline(sel);
  }, [sel?.id, sel?.responsibleStaffId, sel?.nextAction, sel?.nextActionAt, sel?.nextActionSource, sel?.updatedAt, expanded]);
  if (!sel) return null;
  const owner = teamUsers.find((user) => user.authId === sel.responsibleStaffId);
  const save = async (values) => {
    if (busy) return;
    setBusy(true);
    setError(''); setSaved(false);
    try {
      await assignColisWork(expanded ? baseline : sel, values);
      await refreshColis(sel.id);
      setExpanded(false);
      setSaved(true); flash('Suivi du dossier enregistré');
    } catch (error) {
      setError(error.message);
      flash({ msg: error.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3"><section className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 items-center min-w-0">
          <UserCheck size={17} className="text-gray-500 shrink-0" />
          <p className="text-xs font-semibold truncate">
            {sel.responsibleStaffId === auth?.u?.id
              ? 'Suit le dossier : vous'
              : owner
                ? `Suit le dossier : ${owner.prenom || ''} ${owner.nom}`
                : sel.responsibleStaffId
                  ? 'Suivi du dossier attribué'
                  : 'Personne qui suit le dossier : à désigner'}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="min-h-[44px] text-xs font-semibold text-blue-700"
        >
          Modifier
        </button>
      </div>
      {!sel.responsibleStaffId && !expanded && (
        <button
          disabled={busy}
          onClick={() => save({ responsibleStaffId: auth.u.id })}
          className="w-full min-h-[44px] rounded-lg bg-slate-100 dark:bg-gray-800 text-xs font-semibold"
        >
          Je suis ce dossier
        </button>
      )}
      {sel.nextAction && !expanded && (
        <p className="text-xs text-gray-600 dark:text-gray-300">{sel.nextAction}</p>
      )}
      {sel.nextActionSource === 'manual' && sel.nextActionAt && !expanded && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <CalendarClock size={13} />
          Échéance : {new Date(sel.nextActionAt).toLocaleString('fr-FR', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
      {saved && !expanded && <p role="status" className="text-sm text-emerald-700">Suivi du dossier enregistré.</p>}
      {!expanded && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {expanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const actionChanged = draft.action.trim() !== (baseline?.nextAction || '').trim() || draft.date !== manualLocalDate(baseline);
            save({
              responsibleStaffId: draft.owner || null,
              ...(actionChanged ? { nextAction: draft.action.trim() || null, nextActionAt: draft.date ? new Date(draft.date).toISOString() : null } : {}),
            });
          }}
          className="space-y-2"
        >
          <label className="block text-xs font-semibold">
            Personne qui suit le dossier
            <select
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              className="w-full min-h-[44px] rounded-lg border dark:border-gray-700 bg-transparent px-2 mt-1"
            >
              <option value="">Non attribué</option>
              {teamUsers
                .filter((user) => user.actif)
                .map((user) => (
                  <option key={user.authId} value={user.authId}>
                    {user.prenom} {user.nom}
                  </option>
                ))}
              {!teamUsers.some((user) => user.authId === auth.u.id) && (
                <option value={auth.u.id}>{auth.u.nom} (moi)</option>
              )}
            </select>
          </label>
          <label className="block text-xs font-semibold">
            Consigne de suivi du dossier
            <input
              maxLength={250}
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              placeholder="Ex. vérifier la dernière facture"
              className="w-full min-h-[44px] rounded-lg border dark:border-gray-700 bg-transparent px-2 mt-1"
            />
          </label>
          <label className="block text-xs font-semibold">
            À faire le (heure locale)
            <input
              type="datetime-local"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="w-full min-h-[44px] rounded-lg border dark:border-gray-700 bg-transparent px-2 mt-1"
            />
          </label>
          <button
            disabled={busy}
            className="w-full min-h-[44px] rounded-lg bg-[#17324D] text-white text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Save size={14} />
            {busy ? 'Enregistrement…' : 'Enregistrer le suivi'}
          </button>
          <button type="button" disabled={busy} onClick={() => setExpanded(false)} className="min-h-11 px-3 text-sm underline">Annuler les modifications</button>
          <p className="text-xs text-slate-600">La personne qui suit le dossier assure sa continuité. Chaque tâche peut être réalisée par un autre collègue.</p>
          {error && <div role="alert" className="text-xs text-red-700">{error}<p>Votre saisie est conservée. Fermez puis rouvrez le formulaire pour repartir des données actualisées.</p></div>}
        </form>
      )}
    </section><DossierWorkPanel dossier={sel} /></div>
  );
}

import React, { useState, useEffect } from 'react';
import { UserCheck, CalendarClock, Save } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { assignColisWork } from '../../services/conversationApi';

export default function StaffAssignment() {
  const { sel, auth, teamUsers = [], flash, refreshColis } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ owner: '', action: '', date: '' });
  useEffect(() => {
    const localDate = sel?.nextActionSource === 'manual' && sel?.nextActionAt
      ? new Date(
          Date.parse(sel.nextActionAt) - new Date(sel.nextActionAt).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : '';
    setDraft({
      owner: sel?.responsibleStaffId || '',
      action: sel?.nextAction || '',
      date: localDate,
    });
  }, [sel?.id, sel?.responsibleStaffId, sel?.nextAction, sel?.nextActionAt, sel?.nextActionSource]);
  if (!sel) return null;
  const owner = teamUsers.find((user) => user.authId === sel.responsibleStaffId);
  const save = async (values) => {
    if (busy) return;
    setBusy(true);
    try {
      await assignColisWork(sel, values);
      await refreshColis(sel.id);
      setExpanded(false);
      flash('Prise en charge enregistrée');
    } catch (error) {
      flash({ msg: error.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 items-center min-w-0">
          <UserCheck size={17} className="text-gray-500 shrink-0" />
          <p className="text-xs font-semibold truncate">
            {sel.responsibleStaffId === auth?.u?.id
              ? 'Vous suivez ce dossier'
              : owner
                ? `${owner.prenom || ''} ${owner.nom}`
                : sel.responsibleStaffId
                  ? 'Dossier pris en charge'
                  : 'Dossier à prendre en charge'}
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
          Je m’en occupe
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
      {expanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({
              responsibleStaffId: draft.owner || null,
              nextAction: draft.action.trim() || null,
              nextActionAt: draft.date ? new Date(draft.date).toISOString() : null,
            });
          }}
          className="space-y-2"
        >
          <label className="block text-xs font-semibold">
            Responsable
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
            Prochaine action
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
        </form>
      )}
    </section>
  );
}

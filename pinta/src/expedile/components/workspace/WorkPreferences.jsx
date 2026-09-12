import React, { useState, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { availableMissions, effectiveMissions } from '../../domain/personalWork';

const localDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

export default function WorkPreferences({ preference }) {
  const { can, saveWorkPreferences } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) return;
    setDraft({ missions: effectiveMissions(preference, can), active_mission: preference?.active_mission || null, density: preference?.density || 'comfortable', available: preference?.available !== false, absent_until: localDate(preference?.absent_until) });
    setBaseline(preference?.version ?? null);
  }, [preference, can, open]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await saveWorkPreferences({ ...draft, active_mission: draft.missions.includes(draft.active_mission) ? draft.active_mission : null, absent_until: !draft.available && draft.absent_until ? new Date(draft.absent_until).toISOString() : null }, { expectedVersion: baseline });
      setOpen(false);
    } catch (err) { setError(err.message || 'Les préférences ont changé. Rechargez avant de réessayer.'); }
    finally { setBusy(false); }
  }
  return <div><button onClick={() => setOpen(value => !value)} aria-expanded={open} className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold"><Settings2 size={16} />Mes missions et disponibilité</button>
    {open && draft && <form onSubmit={save} className="mt-3 max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <fieldset><legend className="text-sm font-semibold">Missions cumulables</legend><p className="mt-1 text-xs text-slate-600">Seules les missions permises par vos droits sont proposées. Ce choix organise votre écran.</p><div className="mt-2 flex flex-wrap gap-3">{availableMissions(can).map(mission => <label key={mission.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.missions.includes(mission.id)} onChange={event => setDraft(value => ({ ...value, missions: event.target.checked ? [...value.missions, mission.id] : value.missions.filter(id => id !== mission.id) }))} />{mission.label}</label>)}</div></fieldset>
      <label className="block text-sm font-semibold">Densité<select value={draft.density} onChange={event => setDraft(value => ({ ...value, density: event.target.value }))} className="ml-2 min-h-11 rounded-lg border border-slate-300 px-2"><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></label>
      <label className="block text-sm font-semibold">Mission à l’ouverture<select value={draft.active_mission || ''} onChange={event => setDraft(value => ({ ...value, active_mission: event.target.value || null }))} className="mt-1 min-h-11 rounded-lg border border-slate-300 px-2"><option value="">Toutes mes missions</option>{availableMissions(can).filter(item => draft.missions.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.available} onChange={event => setDraft(value => ({ ...value, available: event.target.checked }))} />Disponible pour prendre de nouvelles actions</label>
      {!draft.available && <label className="block text-sm">Absence jusqu’au (facultatif)<input type="datetime-local" value={draft.absent_until} onChange={event => setDraft(value => ({ ...value, absent_until: event.target.value }))} className="mt-1 block min-h-11 rounded-lg border border-slate-300 px-2" /></label>}
      <p className="text-xs text-slate-600">Vos actions restent attribuées jusqu’à un relais accepté ou une réaffectation explicite.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button disabled={busy} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm">Annuler</button></div>
    </form>}
  </div>;
}

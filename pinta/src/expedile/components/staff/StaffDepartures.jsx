import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plane, Download, Check, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DESTINATIONS } from '../../constants';
import * as sb from '../../lib/supabaseData';
import { confirmDeparture, departureManifest, exportDeparture } from '../../services/departures';

const FIELD = 'mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-800';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold disabled:opacity-50';
const isLegacySingle = (colis) => !colis.finalPackages?.length && !colis.outgoingParcelCount && [colis.finL,colis.finW,colis.finH,colis.finP].every((value) => Number(value) > 0);
const localInput = (value) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

export default function StaffDepartures({ embedded = false }) {
  const { envois, setEnvois, data, clients, can, refreshColis, refreshWork, flash } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const envoiFilter = params.get('envoi');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: '', destinationCode: '974', loadingClosesAt: '', weeks: 1 });
  const [review, setReview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [deferredReason, setDeferredReason] = useState('');
  const [manifest, setManifest] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const run = async (action) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (issue) { setError(issue.message || 'Opération impossible.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const refresh = async () => setEnvois(await sb.fetchEnvois());
  const create = async () => {
    if (!form.date || !Number.isInteger(Number(form.weeks)) || form.weeks < 1 || form.weeks > 12) throw new Error('Choisissez une date et entre 1 et 12 départs hebdomadaires.');
    const known = await sb.fetchEnvois();
    for (let index = 0; index < form.weeks; index++) {
      const date = new Date(`${form.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index * 7);
      const day = date.toISOString().slice(0, 10);
      if (known.some((item) => item.date === day && item.destinationCode === form.destinationCode && item.statut !== 'archive')) continue;
      const closure = form.loadingClosesAt ? new Date(form.loadingClosesAt) : null;
      if (closure) closure.setDate(closure.getDate() + index * 7);
      await sb.insertEnvoi({ ...form, date: day, loadingClosesAt: closure?.toISOString() || null });
    }
    setCreating(false); await refresh(); flash('Planning enregistré.');
  };
  const startReview = async (envoi) => {
    const all = await sb.fetchColis(null, { envoiId: envoi.id });
    const latest = (await sb.fetchEnvois()).find((item) => item.id === envoi.id);
    if (!latest) throw new Error('Départ introuvable.');
    setReview({ envoi: latest, dossiers: all.filter((item) => item.envoi === envoi.id && !['annule', 'livre', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(item.statut) && !item.dateExpedition) });
    setSelected([]); setDeferredReason(''); setManifest(null);
  };
  const confirm = async () => {
    const loaded = review.dossiers.filter((item) => selected.includes(item.id)).map((item) => isLegacySingle(item) ? { ...item, outgoingParcelCount: 1 } : item);
    if (!loaded.length) throw new Error('Sélectionnez les dossiers réellement embarqués.');
    if (loaded.length < review.dossiers.length && !deferredReason.trim()) throw new Error('Indiquez le motif du report des autres dossiers.');
    const saved = await confirmDeparture(review.envoi, loaded, deferredReason);
    const id = review.envoi.id;
    const affected = review.dossiers;
    setEnvois((previous) => previous.map((item) => item.id === saved.id ? saved : item));
    setReview(null);
    try {
      await Promise.all([refresh(), ...affected.map((item) => refreshColis(item.id)), refreshWork()]);
      setManifest(await departureManifest(id));
      flash('Départ confirmé. Le manifeste est conservé.');
    } catch (issue) { setError(`Départ confirmé et enregistré. Actualisation à réessayer : ${issue.message}`); }
  };
  const visible = envois.filter((item) => envoiFilter ? item.id === envoiFilter : (item.statut === 'archive') === archived).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return <div className={`${embedded ? '' : 'mx-auto max-w-6xl p-4 sm:p-6'} space-y-5`}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold brand-t">Départs</h1><p className="mt-1 text-sm text-gray-600">Planifier, vérifier le chargement et retrouver les manifestes confirmés.</p></div><div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} />Actualiser</button>{can('perm_envois_creer') && <button className={`${BUTTON} brand-bg text-white`} onClick={() => setCreating(!creating)}>Planifier un départ</button>}</div></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {creating && <form onSubmit={(event) => { event.preventDefault(); run(create); }} className="rounded-xl border border-gray-200 bg-white p-4"><fieldset disabled={busy} className="space-y-4"><legend className="font-bold text-gray-800">Planification</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm text-gray-700">Premier départ<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={FIELD} /></label><label className="text-sm text-gray-700">Destination<select value={form.destinationCode} onChange={(event) => setForm({ ...form, destinationCode: event.target.value })} className={FIELD}>{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="text-sm text-gray-700">Nombre de semaines<input type="number" min="1" max="12" value={form.weeks} onChange={(event) => setForm({ ...form, weeks: event.target.value })} className={FIELD} /></label><label className="text-sm text-gray-700">Clôture du chargement (heure locale)<input type="datetime-local" value={form.loadingClosesAt} onChange={(event) => setForm({ ...form, loadingClosesAt: event.target.value })} className={FIELD} /></label></div><p className="text-xs text-gray-600">Sans horaire de clôture, aucune urgence horaire n’est calculée. Pour une série, la même heure est reprise chaque semaine.</p><button type="submit" className={`${BUTTON} brand-bg text-white`}>Enregistrer le planning</button></fieldset></form>}
    {envoiFilter ? <button onClick={() => setParams({})} className={BUTTON}>Voir tous les départs</button> : <button onClick={() => setArchived(!archived)} aria-pressed={archived} className={BUTTON}>{archived ? 'Voir les départs actifs' : 'Voir les départs archivés'}</button>}
    {review && <section aria-label="Vérifier le chargement" className="space-y-4 rounded-xl border-2 border-slate-400 bg-white p-4"><h2 className="text-lg font-bold brand-t">Chargement de {review.envoi.ref}</h2><p className="text-sm text-gray-600">Cochez les expéditions réellement embarquées. Les autres seront retirées de ce départ et resteront à reprogrammer.</p>{review.dossiers.map((item) => { const eligible = item.statut === 'paye' && (item.outgoingParcelCount > 0 || isLegacySingle(item)); return <label key={item.id} className="flex min-h-16 items-center gap-3 border-b border-gray-100 py-2"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !eligible} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))} /><span className="text-sm text-gray-800"><strong>{item.ref}</strong> · {clients.find((client) => client.id === item.clientId)?.nom}<span className="mt-1 block text-xs text-gray-600">{eligible ? isLegacySingle(item) ? `En cochant, je confirme 1 colis physique de ${item.finL} × ${item.finW} × ${item.finH} cm · ${item.finP} kg (ancien dossier)` : `${item.outgoingParcelCount} colis physique(s) sortant(s) · ${item.finP} kg` : 'Paiement et mesures finales confirmées requis avant embarquement'}</span></span></label>; })}{!review.dossiers.length && <p className="text-sm text-gray-600">Aucun dossier affecté à ce départ.</p>}<label className="block text-sm text-gray-700">Motif du report des dossiers non cochés<textarea value={deferredReason} onChange={(event) => setDeferredReason(event.target.value)} className={`${FIELD} py-2`} maxLength={500} /></label><div className="flex flex-wrap gap-2"><button disabled={busy || !selected.length} onClick={() => run(confirm)} className={`${BUTTON} brand-bg text-white`}><Check size={16} />Confirmer le départ de {selected.length} expédition(s)</button><button disabled={busy} className={BUTTON} onClick={() => setReview(null)}>Annuler la vérification</button></div></section>}
    {manifest && <section aria-label="Manifeste confirmé" className="rounded-xl border border-emerald-300 bg-white p-4 space-y-3"><h2 className="font-bold text-gray-800">Manifeste {manifest.envoi.ref}</h2><p className="text-sm text-gray-600">Confirmé le {new Date(manifest.confirmedAt).toLocaleString('fr-FR')} · {manifest.colis.length} expédition(s) · {manifest.colis.reduce((sum, item) => sum + (item.outgoingParcelCount || 0), 0)} colis physiques.</p>{manifest.colis.map((item) => <p key={item.id} className="text-sm text-gray-700">{item.ref} · {item.outgoingParcelCount} colis · {item.finP} kg</p>)}{manifest.deferred.map((item) => <p key={item.id} className="text-sm text-amber-800">Reporté : {item.ref} · {item.reason}</p>)}{manifest.excluded?.map((item) => <p key={item.id} className="text-sm text-gray-600">Hors chargement : {item.ref} · {item.reason}</p>)}<button className={BUTTON} onClick={() => setManifest(null)}>Fermer le manifeste</button></section>}
    <div className="grid gap-4">{visible.map((envoi) => { const dossiers = data.filter((item) => item.envoi === envoi.id && !['annule', 'livre'].includes(item.statut)); const departed = envoi.manifestVersion > 0 || envoi.departedAt; return <article key={envoi.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold brand-t"><Plane size={18} />{envoi.ref} · {envoi.date}</h2><p className="mt-1 text-sm text-gray-600">{DESTINATIONS[envoi.destinationCode]?.label || envoi.destinationCode || 'Destination à préciser'} · {envoi.statut}</p><p className="mt-1 text-xs text-gray-600">{envoi.loadingClosesAt ? `Clôture : ${new Date(envoi.loadingClosesAt).toLocaleString('fr-FR')}` : 'Horaire de clôture à préciser'}</p></div>{!departed && <button className={BUTTON} onClick={() => navigate(`/colis?view=envoi&envoi=${envoi.id}`)}>{dossiers.length} dossier(s) actif(s)</button>}</div>
      {editing?.id === envoi.id && <form onSubmit={(event) => { event.preventDefault(); run(async () => { await sb.updateEnvoi(envoi.id, { date: editing.date, destinationCode: editing.destinationCode, loadingClosesAt: editing.closure ? new Date(editing.closure).toISOString() : null }, editing.updatedAt); setEditing(null); await refresh(); }); }} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Date<input type="date" required className={FIELD} value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} /></label><label className="text-sm">Destination<select className={FIELD} value={editing.destinationCode || ''} onChange={(event) => setEditing({ ...editing, destinationCode: event.target.value })}><option value="">À préciser</option>{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="text-sm">Clôture (heure locale)<input type="datetime-local" className={FIELD} value={editing.closure} onChange={(event) => setEditing({ ...editing, closure: event.target.value })} /></label></div><button disabled={busy} className={BUTTON}>Enregistrer le départ</button></form>}
      <div className="flex flex-wrap gap-2">{!departed && can('perm_envois_modifier') && <button className={BUTTON} disabled={busy} onClick={() => setEditing(editing?.id === envoi.id ? null : { ...envoi, closure: localInput(envoi.loadingClosesAt) })}>Modifier le planning</button>}{!departed && ['planifie', 'prochain', 'en_cours', 'en_preparation', 'pret'].includes(envoi.statut) && can('perm_colis_expedier') && can('perm_envois_modifier') && <button disabled={busy} className={`${BUTTON} brand-bg text-white`} onClick={() => run(() => startReview(envoi))}>Vérifier et confirmer le chargement</button>}{departed && <><button disabled={busy} className={BUTTON} onClick={() => run(async () => setManifest(await departureManifest(envoi.id)))}>Voir le manifeste</button>{[['manifest', 'Manifeste Excel', 'perm_export_colis'], ['invoice', 'Facture commerciale', 'perm_export_factures'], ['dau', 'Données douane', 'perm_export_dau']].filter(([, , permission]) => can(permission)).map(([type, label]) => <button key={type} disabled={busy} className={BUTTON} onClick={() => run(() => exportDeparture(envoi.id, type))}><Download size={15} />{label}</button>)}{can('perm_envois_modifier') && envoi.statut === 'parti' && <button disabled={busy} className={BUTTON} onClick={() => run(async () => { await sb.updateEnvoi(envoi.id, { statut: 'arrive' }, envoi.updatedAt); await refresh(); })}>Confirmer l’arrivée</button>}{can('perm_envois_modifier') && envoi.statut === 'arrive' && <button disabled={busy} className={BUTTON} onClick={() => run(async () => { await sb.updateEnvoi(envoi.id, { statut: 'archive' }, envoi.updatedAt); await refresh(); })}>Archiver ce départ</button>}</>}</div>
    </article>; })}</div>{!visible.length && <p className="p-6 text-sm text-gray-600">Aucun départ dans cette vue.</p>}
  </div>;
}

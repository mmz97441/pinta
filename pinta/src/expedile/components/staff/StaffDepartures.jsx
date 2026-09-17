import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { Plane, Download, Check, RefreshCw } from 'lucide-react';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { departureReadiness } from '../../domain/departureReadiness';
import { dossierTaskUrl } from '../../domain/dossierTasks';
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
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const envoiFilter = params.get('envoi');
  const departureView = params.get('vue') || 'a-preparer';
  const loadingId = params.get('loading');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = usePersistentDraft('departures:loading-selection', {});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: '', destinationCode: '974', loadingClosesAt: '', weeks: 1 });
  const [review, setReview] = useState(null);
  const selected = selection[loadingId]?.ids || [];
  const setSelected = next => setSelection(previous => ({ ...previous, [loadingId]: { ...previous[loadingId], ids: typeof next === 'function' ? next(previous[loadingId]?.ids || []) : next } }));
  const deferredReason = selection[loadingId]?.reason || '';
  const setDeferredReason = reason => setSelection(previous => ({ ...previous, [loadingId]: { ...previous[loadingId], reason } }));
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
    setManifest(null); setSearch('');
  };
  const confirm = async () => {
    const loaded = review.dossiers.filter((item) => selected.includes(item.id)).map((item) => isLegacySingle(item) ? { ...item, outgoingParcelCount: 1 } : item);
    if (!loaded.length) throw new Error('Sélectionnez les dossiers réellement embarqués.');
    if (loaded.length < review.dossiers.length && !deferredReason.trim()) throw new Error('Indiquez le motif du report des autres dossiers.');
    const saved = await confirmDeparture(review.envoi, loaded, deferredReason);
    const id = review.envoi.id;
    const affected = review.dossiers;
    setEnvois((previous) => previous.map((item) => item.id === saved.id ? saved : item));
    setReview(null); setParams(previous => { const next = new URLSearchParams(previous); next.delete('loading'); return next; });
    setSelection(previous => { const next = { ...previous }; delete next[id]; return next; });
    try {
      await Promise.all([refresh(), ...affected.map((item) => refreshColis(item.id)), refreshWork()]);
      setManifest(await departureManifest(id));
      flash('Départ confirmé. Le manifeste est conservé.');
    } catch (issue) { setError(`Départ confirmé et enregistré. Actualisation à réessayer : ${issue.message}`); }
  };
  useEffect(() => {
    if (!loadingId || review?.envoi.id === loadingId || busy) return;
    const envoi = envois.find(item => item.id === loadingId);
    if (envoi) run(() => startReview(envoi));
  }, [loadingId, envois]);
  const today = new Date().toLocaleDateString('en-CA');
  const visible = envois.filter(item => envoiFilter ? item.id === envoiFilter : departureView === 'archives' ? item.statut === 'archive' : item.statut !== 'archive' && Boolean(item.manifestVersion > 0 || item.departedAt) === (departureView === 'partis')).sort((a, b) => {
    if (departureView !== 'a-preparer') return (b.date || '').localeCompare(a.date || '');
    const overdueA = a.date < today, overdueB = b.date < today;
    return Number(overdueA) - Number(overdueB) || (a.date || '').localeCompare(b.date || '');
  });
  const returnTo = location.pathname + location.search;

  return <div className={`${embedded ? '' : 'mx-auto max-w-6xl p-4 sm:p-6'} space-y-5`}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold brand-t">Départs</h1><p className="mt-1 text-sm text-gray-600">Planifier, vérifier le chargement et retrouver les manifestes confirmés.</p></div><div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} />Actualiser</button>{can('perm_envois_creer') && <button className={`${BUTTON} brand-bg text-white`} onClick={() => setCreating(!creating)}>Planifier un départ</button>}</div></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {creating && <form onSubmit={(event) => { event.preventDefault(); run(create); }} className="rounded-xl border border-gray-200 bg-white p-4"><fieldset disabled={busy} className="space-y-4"><legend className="font-bold text-gray-800">Planification</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm text-gray-700">Premier départ<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={FIELD} /></label><label className="text-sm text-gray-700">Destination<select value={form.destinationCode} onChange={(event) => setForm({ ...form, destinationCode: event.target.value })} className={FIELD}>{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="text-sm text-gray-700">Nombre de semaines<input type="number" min="1" max="12" value={form.weeks} onChange={(event) => setForm({ ...form, weeks: event.target.value })} className={FIELD} /></label><label className="text-sm text-gray-700">Clôture du chargement (heure locale)<input type="datetime-local" value={form.loadingClosesAt} onChange={(event) => setForm({ ...form, loadingClosesAt: event.target.value })} className={FIELD} /></label></div><p className="text-xs text-gray-600">Sans horaire de clôture, aucune urgence horaire n’est calculée. Pour une série, la même heure est reprise chaque semaine.</p><button type="submit" className={`${BUTTON} brand-bg text-white`}>Enregistrer le planning</button></fieldset></form>}
    {envoiFilter ? <button onClick={() => setParams({})} className={BUTTON}>Voir tous les départs</button> : <nav aria-label="État des départs" className="flex flex-wrap gap-2">{[['a-preparer','À préparer'],['partis','Partis'],['archives','Archivés']].map(([key,label]) => <button key={key} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('vue',key); return next; })} aria-pressed={departureView === key} className={`${BUTTON} ${departureView === key ? 'brand-bg text-white' : ''}`}>{label}</button>)}</nav>}
    {review && <section aria-label="Vérifier le chargement" className="space-y-4 rounded-xl border-2 border-slate-400 bg-white p-4">
      <h2 className="text-lg font-bold brand-t">Chargement de {review.envoi.ref}</h2>
      <p className="text-sm text-gray-600">Cochez les expéditions réellement embarquées. Les autres seront à reprogrammer.</p>
      <label className="block text-sm font-semibold">Rechercher ou scanner une EXP<input value={search} onChange={event => setSearch(event.target.value)} className={FIELD} /></label>
      {[[true,'Prêts à charger'],[false,'À débloquer']].map(([ready,label]) => {
        const all = review.dossiers.filter(item => departureReadiness(item).eligible === ready);
        const rows = all.filter(item => !search || [item.ref,clients.find(client => client.id === item.clientId)?.nom].join(' ').toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')));
        return <div key={label}><h3 className="font-semibold">{label} ({all.length})</h3>{rows.map(item => {
          const status = departureReadiness(item);
          return <article key={item.id} className="border-b border-gray-100 py-3"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !status.eligible} onChange={event => setSelected(previous => event.target.checked ? [...previous,item.id] : previous.filter(id => id !== item.id))} /><span><strong>{item.ref}</strong> · {clients.find(client => client.id === item.clientId)?.nom}</span></label>
            {status.eligible && <p className="text-sm text-gray-600">{status.count} colis préparé(s) · {status.weights.realWeight.toLocaleString('fr-FR')} kg{status.legacySingle ? ' · En cochant, je confirme un colis physique (ancien dossier).' : ''}</p>}
            {status.reasons.map(reason => <div key={reason.task} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800"><span>{reason.text}</span><Link to={dossierTaskUrl(item.id,reason.task,new URLSearchParams({returnTo}).toString())} className="inline-flex min-h-11 items-center underline">{reason.task === 'paiement' ? 'Vérifier le paiement' : 'Vérifier la préparation'}</Link></div>)}
          </article>;
        })}{!rows.length && <p className="py-2 text-sm text-gray-600">{search ? 'Aucun dossier ne correspond à cette recherche.' : 'Aucun dossier dans ce groupe.'}</p>}</div>;
      })}
      <label className="block text-sm text-gray-700">Motif du report des dossiers non cochés<textarea value={deferredReason} onChange={event => setDeferredReason(event.target.value)} className={`${FIELD} py-2`} maxLength={500} /></label>
      <p role="status" className="text-sm font-semibold">{review.dossiers.filter(item => selected.includes(item.id) && departureReadiness(item).eligible).length} expédition(s) cochée(s) · {review.dossiers.filter(item => !selected.includes(item.id)).length} à reporter. La sélection est conservée pendant vos vérifications.</p>
      {selected.some(id => !review.dossiers.some(item => item.id === id && departureReadiness(item).eligible)) && <p role="alert" className="text-sm text-red-700">Un dossier coché a changé. Actualisez le chargement et revérifiez votre sélection.</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy || !selected.length || selected.some(id => !review.dossiers.some(item => item.id === id && departureReadiness(item).eligible))} onClick={() => run(confirm)} className={`${BUTTON} brand-bg text-white`}><Check size={16} />Confirmer le départ de {selected.length} expédition(s)</button><button disabled={busy} className={BUTTON} onClick={() => { setReview(null); setParams(previous => { const next = new URLSearchParams(previous); next.delete('loading'); return next; }); }}>Fermer le chargement</button><button className={BUTTON} disabled={busy} onClick={() => run(() => startReview(review.envoi))}>Actualiser le chargement</button></div>
    </section>}
    {manifest && <section aria-label="Manifeste confirmé" className="rounded-xl border border-emerald-300 bg-white p-4 space-y-3"><h2 className="font-bold text-gray-800">Manifeste {manifest.envoi.ref}</h2><p className="text-sm text-gray-600">Confirmé le {new Date(manifest.confirmedAt).toLocaleString('fr-FR')} · {manifest.colis.length} expédition(s) · {manifest.colis.reduce((sum, item) => sum + (item.outgoingParcelCount || 0), 0)} colis physiques.</p>{manifest.colis.map((item) => <p key={item.id} className="text-sm text-gray-700">{item.ref} · {item.outgoingParcelCount} colis · {departureReadiness(item).weights?.realWeight ?? 'À vérifier'} kg</p>)}{manifest.deferred.map((item) => <p key={item.id} className="text-sm text-amber-800">Reporté : {item.ref} · {item.reason}</p>)}{manifest.excluded?.map((item) => <p key={item.id} className="text-sm text-gray-600">Hors chargement : {item.ref} · {item.reason}</p>)}<button className={BUTTON} onClick={() => setManifest(null)}>Fermer le manifeste</button></section>}
    <div className="grid gap-4">{visible.map((envoi) => { const dossiers = data.filter((item) => item.envoi === envoi.id && !['annule', 'livre'].includes(item.statut)); const departed = envoi.manifestVersion > 0 || envoi.departedAt; return <article key={envoi.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold brand-t"><Plane size={18} />{envoi.ref} · {envoi.date ? new Date(`${envoi.date}T12:00:00`).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }) : 'Date à préciser'}</h2><p className="mt-1 text-sm text-gray-600">{DESTINATIONS[envoi.destinationCode]?.label || envoi.destinationCode || 'Destination à préciser'} · {departed ? 'Départ confirmé' : 'À préparer'}</p>{!departed && envoi.date < today && <p className="mt-1 text-sm font-semibold text-amber-800">Date dépassée · planning à vérifier ou reprogrammer</p>}<p className="mt-1 text-xs text-gray-600">{envoi.loadingClosesAt ? `Clôture : ${new Date(envoi.loadingClosesAt).toLocaleString('fr-FR')}` : 'Horaire de clôture à préciser'}</p></div>{!departed && <button className={BUTTON} onClick={() => navigate(`/colis?view=envoi&envoi=${envoi.id}`)}>{dossiers.length} dossier(s) actif(s)</button>}</div>
      {editing?.id === envoi.id && <form onSubmit={(event) => { event.preventDefault(); run(async () => { await sb.updateEnvoi(envoi.id, { date: editing.date, destinationCode: editing.destinationCode, loadingClosesAt: editing.closure ? new Date(editing.closure).toISOString() : null }, editing.updatedAt); setEditing(null); await refresh(); }); }} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Date<input type="date" required className={FIELD} value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} /></label><label className="text-sm">Destination<select className={FIELD} value={editing.destinationCode || ''} onChange={(event) => setEditing({ ...editing, destinationCode: event.target.value })}><option value="">À préciser</option>{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="text-sm">Clôture (heure locale)<input type="datetime-local" className={FIELD} value={editing.closure} onChange={(event) => setEditing({ ...editing, closure: event.target.value })} /></label></div><button disabled={busy} className={BUTTON}>Enregistrer le départ</button></form>}
      <div className="flex flex-wrap gap-2">{!departed && can('perm_envois_modifier') && <button className={BUTTON} disabled={busy} onClick={() => setEditing(editing?.id === envoi.id ? null : { ...envoi, closure: localInput(envoi.loadingClosesAt) })}>Modifier le planning</button>}{!departed && ['planifie', 'prochain', 'en_cours', 'en_preparation', 'pret'].includes(envoi.statut) && can('perm_colis_expedier') && can('perm_envois_modifier') && <button disabled={busy} className={`${BUTTON} brand-bg text-white`} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('loading',envoi.id); return next; })}>Vérifier et confirmer le chargement</button>}{departed && <><button disabled={busy} className={BUTTON} onClick={() => run(async () => setManifest(await departureManifest(envoi.id)))}>Voir le manifeste</button><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Documents du départ</summary><div className="flex flex-wrap gap-2">{[['manifest', 'Manifeste Excel', 'perm_export_colis'], ['invoice', 'Facture commerciale', 'perm_export_factures'], ['dau', 'Données douane', 'perm_export_dau']].filter(([, , permission]) => can(permission)).map(([type, label]) => <button key={type} disabled={busy} className={BUTTON} onClick={() => run(() => exportDeparture(envoi.id, type))}><Download size={15} />{label}</button>)}</div></details>{can('perm_envois_modifier') && envoi.statut === 'parti' && <button disabled={busy} className={BUTTON} onClick={() => run(async () => { await sb.updateEnvoi(envoi.id, { statut: 'arrive' }, envoi.updatedAt); await refresh(); })}>Confirmer l’arrivée</button>}{can('perm_envois_modifier') && envoi.statut === 'arrive' && <button disabled={busy} className={BUTTON} onClick={() => run(async () => { await sb.updateEnvoi(envoi.id, { statut: 'archive' }, envoi.updatedAt); await refresh(); })}>Archiver ce départ</button>}</>}</div>
    </article>; })}</div>{!visible.length && <p className="p-6 text-sm text-gray-600">Aucun départ dans cette vue.</p>}
  </div>;
}

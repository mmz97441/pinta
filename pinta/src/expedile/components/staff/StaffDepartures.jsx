import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Archive, CalendarCheck, CalendarPlus, Check, CheckCircle, ChevronRight, Clock, Loader2, Pencil, Plane, RefreshCw } from 'lucide-react';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { departureReadiness } from '../../domain/departureReadiness';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { departureDayLabel, isoCalendarDay, parisCalendarDay } from '../../domain/departureGroups';
import { subscriptionEndNote, wishesAfterSubscription, wishesSubscriptionConfirmation } from '../../domain/departureWishes';
import { closingLabel, departureDefaultClosing, destinationName, OPEN_DEPARTURE_STATUSES } from '../../domain/departurePlanning';
import {
  assignmentFailure, confirmedLine, countLabel, departureClosingLine, departureDeparted, departureEditErrors, departureInView, departureOverdue,
  departureStateLabel, loadableDossiers, planningErrors, preparedSummary, sortDepartures, weeklyDepartures, wishedDossiersFor,
} from '../../domain/departureBoard';
import { parisDateTimeInput, parisDateTimeInstant } from '../../domain/parisTime';
import { useApp } from '../../context/AppContext';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';
import { plural } from '../../domain/plural';
import { DESTINATIONS, STATUTS } from '../../constants';
import * as sb from '../../lib/supabaseData';
import { confirmDeparture, departureManifest, exportDeparture } from '../../services/departures';
import DepartureDocuments from './DepartureDocuments';
import './staffDepartures.css';

const FIELD = 'mt-1 min-h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 transition-all duration-200 ease-out focus:border-blue-400 aria-[invalid=true]:border-red-500';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';
const PRIMARY = `${BUTTON} brand-bg text-white hover:-translate-y-px disabled:hover:translate-y-0`;
const SEARCH_FIELD = 'mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-800';
const isLegacySingle = (colis) => !colis.finalPackages?.length && !colis.outgoingParcelCount && [colis.finL,colis.finW,colis.finH,colis.finP].every((value) => Number(value) > 0);
const NOT_LOADABLE = ['annule', 'livre', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison'];
// The commercial invoice has its own block, before and after the departure (DepartureDocuments).
const EXPORTS = [['manifest', 'Manifeste Excel', 'perm_export_colis'], ['dau', 'Données douane', 'perm_export_dau']];
const EMPTY_PLAN = { date: '', destinationCode: '974', weeks: '1', closing: '' };
const cardScope = id => `card:${id}`;
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A sentence whose references (« EXP-WISH-1 ») are never split at a hyphen. */
const keepWhole = (text, tokens = []) => {
  if (!tokens.length) return text;
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`));
  return <>{parts.map((part, index) => index % 2 ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}</>;
};
const withoutParam = (name) => (previous) => { const next = new URLSearchParams(previous); next.delete(name); return next; };

/** A labelled field with its help and its error under it (the form pattern). */
function Field({ id, label, help, error, children }) {
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="min-w-0">
    <label htmlFor={id} className="departures-label">{label}</label>
    {children({ id, className: FIELD, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
    {help && <p id={`${id}-help`} className="departures-help">{help}</p>}
    {error && <p id={`${id}-error`} className="departures-field-error">{error}</p>}
  </div>;
}

/** « Sans clôture saisie, la clôture habituelle s’applique : mercredi 21 octobre, 17 h (heure de Paris). » */
function closingHelp(closing, date, now, { series = false } = {}) {
  if (closing) {
    const instant = parisDateTimeInstant(closing);
    return instant ? `Clôture : ${closingLabel(instant, { today: now })} (heure de Paris).` : 'Heure de Paris.';
  }
  const day = isoCalendarDay(date);
  const habitual = day ? `${closingLabel(departureDefaultClosing(day), { today: now })} (heure de Paris)${series ? ' pour le premier départ' : ''}` : 'le mercredi 17 h qui précède le départ (heure de Paris)';
  return `Sans clôture saisie, la clôture habituelle s’applique : ${habitual}.`;
}

const focusFirstError = (errors, ids) => {
  const first = ids.find(([key]) => errors[key]);
  if (first) document.getElementById(first[1])?.focus();
};

export default function StaffDepartures({ embedded = false }) {
  const { envois, setEnvois, data, clients, can, refreshColis, refreshWork, flash, setCfm, ask, assignDeparture, dataError, dataLoading, sbReady, retryLoad } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const now = useMinuteNow();
  const today = parisCalendarDay(now);
  const envoiFilter = params.get('envoi');
  const departureView = params.get('vue') || 'a-preparer';
  const loadingId = params.get('loading');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = usePersistentDraft('departures:loading-selection', {});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_PLAN);
  const [planErrors, setPlanErrors] = useState({});
  const [review, setReview] = useState(null);
  const selected = selection[loadingId]?.ids || [];
  const setSelected = next => setSelection(previous => ({ ...previous, [loadingId]: { ...previous[loadingId], ids: typeof next === 'function' ? next(previous[loadingId]?.ids || []) : next } }));
  const deferredReason = selection[loadingId]?.reason || '';
  const setDeferredReason = reason => setSelection(previous => ({ ...previous, [loadingId]: { ...previous[loadingId], reason } }));
  const [manifest, setManifest] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // One message per place: the page, the planning form, the edit form, the loading review, or a card.
  const [errors, setErrors] = useState({});
  const [assigning, setAssigning] = useState(null);
  const [assignResults, setAssignResults] = useState({});
  const lock = useRef(false);
  const latestData = useRef(data);
  latestData.current = data;
  const pageHeading = useRef(null);
  const planButton = useRef(null);
  const planDate = useRef(null);
  const editDate = useRef(null);
  const reviewHeading = useRef(null);
  const manifestHeading = useRef(null);
  // The button that opened the loading review or the manifest: closing them gives it the focus back.
  const opener = useRef(null);
  // Applied after the next render: an element, or a function finding it once the page shows the saved state.
  const pendingFocus = useRef(null);

  const setScopeError = (scope, message) => setErrors(previous => ({ ...previous, [scope]: message }));
  const run = async (action, scope = 'page') => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setScopeError(scope, '');
    try { await action(); return true; }
    catch (issue) { setScopeError(scope, issue?.message || 'Opération impossible.'); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const refresh = async () => { const rows = await sb.fetchEnvois(); setEnvois(rows); return rows; };
  const mergeEnvois = saved => setEnvois(previous => [...previous.filter(item => !saved.some(row => row.id === item.id)), ...saved]
    .sort((left, right) => (left.date || '').localeCompare(right.date || '')));
  // Nothing loaded: the reason and « Réessayer » in place of the cards. A failed
  // refresh keeps the cards under the shell's banner; planning waits for the connection.
  const loadFailed = staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) }).state === 'failed';

  // ── Planning form ────────────────────────────────────────────────────
  const openPlanning = () => { setForm(EMPTY_PLAN); setPlanErrors({}); setScopeError('plan', ''); setCreating(true); };
  const closePlanning = () => { setCreating(false); setForm(EMPTY_PLAN); setPlanErrors({}); setScopeError('plan', ''); pendingFocus.current = () => planButton.current; };
  const submitPlanning = (event) => {
    event.preventDefault();
    if (busy) return;
    const found = planningErrors(form, { now: Date.now() });
    setPlanErrors(found);
    if (Object.keys(found).length) { focusFirstError(found, [['date', 'departure-plan-date'], ['destinationCode', 'departure-plan-destination'], ['weeks', 'departure-plan-weeks'], ['closing', 'departure-plan-closing']]); return; }
    run(async () => {
      const known = await sb.fetchEnvois();
      const created = [], skipped = [];
      try {
        for (const item of weeklyDepartures(form)) {
          if (known.some(other => other.date === item.date && other.destinationCode === form.destinationCode && other.statut !== 'archive')) { skipped.push(item.date); continue; }
          created.push(await sb.insertEnvoi({ date: item.date, destinationCode: form.destinationCode, loadingClosesAt: item.loadingClosesAt }));
        }
      } catch (issue) {
        if (!created.length) throw issue;
        mergeEnvois(created);
        throw new Error(`${countLabel(created.length, 'départ enregistré', 'départs enregistrés')} ; les suivants n’ont pas pu l’être : ${issue.message}`);
      }
      if (!created.length) throw new Error(skipped.length > 1 ? 'Ces départs existent déjà pour cette destination : rien n’a été ajouté.' : 'Un départ existe déjà ce jour-là pour cette destination : rien n’a été ajouté.');
      mergeEnvois(created);
      closePlanning();
      flash({ msg: `${countLabel(created.length, 'départ planifié', 'départs planifiés')}${skipped.length ? ` · ${countLabel(skipped.length, 'date déjà planifiée conservée', 'dates déjà planifiées conservées')}` : ''}.`, type: 'success' });
      // The saved departures are listed; the full planning follows when it can be read.
      refresh().catch(() => {});
    }, 'plan');
  };

  // ── Edit form ────────────────────────────────────────────────────────
  const startEditing = (envoi) => {
    if (editing?.id === envoi.id) { cancelEditing(); return; }
    const closure = parisDateTimeInput(envoi.loadingClosesAt);
    setEditing({ id: envoi.id, ref: envoi.ref, date: envoi.date || '', destinationCode: envoi.destinationCode || '', closure, initialClosure: closure, loadingClosesAt: envoi.loadingClosesAt || null, updatedAt: envoi.updatedAt });
    setEditErrors({}); setScopeError('edit', '');
  };
  const cancelEditing = () => {
    const id = editing?.id;
    setEditing(null); setEditErrors({}); setScopeError('edit', '');
    pendingFocus.current = () => document.querySelector(`[data-departure-card="${id}"] [data-action="edit"]`);
  };
  const saveEditing = (event) => {
    event.preventDefault();
    if (busy || !editing) return;
    const found = departureEditErrors({ date: editing.date, destinationCode: editing.destinationCode, closing: editing.closure }, { now: Date.now() });
    setEditErrors(found);
    if (Object.keys(found).length) { focusFirstError(found, [['date', 'departure-edit-date'], ['destinationCode', 'departure-edit-destination'], ['closing', 'departure-edit-closing']]); return; }
    const current = editing;
    run(async () => {
      // An untouched closing keeps its exact saved instant.
      const loadingClosesAt = current.closure === current.initialClosure ? current.loadingClosesAt : current.closure ? parisDateTimeInstant(current.closure) : null;
      const saved = await sb.updateEnvoi(current.id, { date: current.date, destinationCode: current.destinationCode, loadingClosesAt }, current.updatedAt);
      mergeEnvois([saved]);
      setEditing(null); setEditErrors({});
      pendingFocus.current = () => document.querySelector(`[data-departure-card="${saved.id}"] [data-action="edit"]`);
      flash({ msg: saved.ref ? `Départ ${saved.ref} enregistré.` : 'Départ enregistré.', type: 'success' });
      refresh().catch(() => {});
    }, 'edit');
  };

  // ── Loading review and manifest ──────────────────────────────────────
  const startReview = async (envoi) => {
    const all = await sb.fetchColis(null, { envoiId: envoi.id });
    const latest = (await sb.fetchEnvois()).find((item) => item.id === envoi.id);
    if (!latest) throw new Error('Départ introuvable.');
    setReview({ envoi: latest, dossiers: all.filter((item) => item.envoi === envoi.id && !NOT_LOADABLE.includes(item.statut) && !item.dateExpedition) });
    setManifest(null); setSearch('');
  };
  const openReview = (envoi, event) => {
    opener.current = event.currentTarget;
    if (loadingId === envoi.id && !review) { run(() => startReview(envoi), cardScope(envoi.id)); return; }
    setParams(previous => { const next = new URLSearchParams(previous); next.set('loading', envoi.id); return next; });
  };
  const closeReview = () => {
    setReview(null); setScopeError('review', ''); setParams(withoutParam('loading'));
    pendingFocus.current = opener.current;
  };
  const confirm = async () => {
    const loaded = review.dossiers.filter((item) => selected.includes(item.id)).map((item) => isLegacySingle(item) ? { ...item, outgoingParcelCount: 1 } : item);
    if (!loaded.length) throw new Error('Sélectionnez les dossiers réellement embarqués.');
    if (loaded.length < review.dossiers.length && !deferredReason.trim()) throw new Error('Indiquez le motif du report des autres dossiers.');
    const saved = await confirmDeparture(review.envoi, loaded, deferredReason);
    const id = review.envoi.id;
    const affected = review.dossiers;
    setEnvois((previous) => previous.map((item) => item.id === saved.id ? saved : item));
    setReview(null); setParams(withoutParam('loading'));
    setSelection(previous => { const next = { ...previous }; delete next[id]; return next; });
    flash('Départ confirmé. Le manifeste est conservé.');
    // Confirmed by the server: a failed reading afterwards never hides it.
    try { await Promise.all([refresh(), ...affected.map((item) => refreshColis(item.id)), refreshWork()]); }
    catch (issue) { setScopeError('page', `Départ confirmé et enregistré. Actualisation à réessayer : ${issue.message}`); }
    try { setManifest(await departureManifest(id)); }
    catch (issue) { setScopeError('page', `Départ confirmé et enregistré. Manifeste à rouvrir : ${issue.message}`); }
  };
  const openManifest = (envoi, event) => {
    opener.current = event.currentTarget;
    run(async () => setManifest(await departureManifest(envoi.id)), cardScope(envoi.id));
  };
  const closeManifest = () => { setManifest(null); pendingFocus.current = opener.current; };

  // ── Irreversible steps, confirmed first ──────────────────────────────
  const confirmStep = (envoi, step) => {
    const day = departureDayLabel(envoi.date, { today: now });
    const where = destinationName(envoi.destinationCode);
    const name = envoi.ref || 'ce départ';
    const arrival = step === 'arrive';
    setCfm({
      title: arrival ? `Confirmer l’arrivée de ${name} ?` : `Archiver ${name} ?`,
      msg: arrival
        ? `Le départ${day ? ` du ${day}` : ''}${where ? ` pour ${where}` : ''} sera enregistré comme arrivé à destination.\nCette action est définitive : elle ne pourra pas être annulée.`
        : 'Le départ et son manifeste seront rangés dans « Archivés », où ils restent consultables.\nCette action est définitive : elle ne pourra pas être annulée.',
      okLabel: arrival ? 'Confirmer l’arrivée' : 'Archiver ce départ',
      // A refusal (a colleague's change, a lost connection) stays in the dialog, which stays open.
      inlineError: true,
      onOk: async () => {
        const saved = await sb.updateEnvoi(envoi.id, { statut: step }, envoi.updatedAt);
        mergeEnvois([saved]);
        pendingFocus.current = () => document.querySelector(`[data-departure-card="${saved.id}"] h2`);
        flash({ msg: arrival ? `Arrivée confirmée : ${name} est arrivé à destination.` : `${name} est archivé. Il reste consultable dans « Archivés ».`, type: 'success' });
        refresh().catch(() => {});
      },
    });
  };

  // ── « Affecter ces dossiers » ─────────────────────────────────────────
  // As in the dossier calendar, a departure after a client's subscription end is
  // confirmed first, those dossiers named; cancelling writes nothing.
  const assignWishes = (envoi, proposed) => {
    if (busy || lock.current) return;
    const confirmation = wishesSubscriptionConfirmation(envoi, proposed, clients, { today: now });
    if (confirmation) ask(confirmation.title, keepWhole(confirmation.message, confirmation.refs), () => writeWishes(envoi, proposed), { okLabel: confirmation.okLabel });
    else writeWishes(envoi, proposed);
  };
  const writeWishes = (envoi, proposed) => run(async () => {
    setAssigning(envoi.id);
    setAssignResults(previous => ({ ...previous, [envoi.id]: null }));
    const assigned = [], failures = [];
    try {
      // One after the other, each with the version the page holds now.
      for (const item of proposed) {
        const current = latestData.current.find(dossier => dossier.id === item.id);
        if (!current || !wishedDossiersFor(envoi, [current], clients, Date.now()).length) { failures.push(`Le dossier ${item.ref} a changé : rechargez-le`); continue; }
        try { await assignDeparture(current, envoi.id); assigned.push(current.ref); }
        catch (failure) { failures.push(assignmentFailure(current, failure)); }
      }
    } finally {
      setAssigning(null);
      setAssignResults(previous => ({ ...previous, [envoi.id]: { assigned, failures } }));
    }
    if (assigned.length) flash({ msg: `${countLabel(assigned.length, 'dossier affecté', 'dossiers affectés')} à ${envoi.ref || 'ce départ'}.`, type: failures.length ? 'warning' : 'success' });
  }, cardScope(envoi.id));

  const filtered = envois.filter(item => envoiFilter ? item.id === envoiFilter : departureInView(item, departureView));
  const visible = sortDepartures(filtered, envoiFilter ? 'a-preparer' : departureView, now);
  const visibleIds = new Set(visible.map(item => item.id));
  const returnTo = location.pathname + location.search;

  useEffect(() => {
    if (!loadingId || review?.envoi.id === loadingId || busy) return;
    const envoi = envois.find(item => item.id === loadingId);
    if (!envoi) return;
    run(async () => {
      try { await startReview(envoi); }
      catch (issue) { setParams(withoutParam('loading'), { replace: true }); throw issue; }
    }, visibleIds.has(envoi.id) ? cardScope(envoi.id) : 'page');
  }, [loadingId, envois, busy]);
  // The panel opened from a card far below comes into view with the focus on its title.
  const reviewKey = review?.envoi.id || null;
  useEffect(() => {
    if (!reviewKey) return;
    reviewHeading.current?.scrollIntoView({ block: 'start' });
    reviewHeading.current?.focus({ preventScroll: true });
  }, [reviewKey]);
  const manifestKey = manifest ? `${manifest.envoi?.id}:${manifest.confirmedAt}` : null;
  useEffect(() => {
    if (!manifestKey) return;
    manifestHeading.current?.scrollIntoView({ block: 'start' });
    manifestHeading.current?.focus({ preventScroll: true });
  }, [manifestKey]);
  useEffect(() => { if (creating) planDate.current?.focus(); }, [creating]);
  useEffect(() => { if (editing?.id) editDate.current?.focus(); }, [editing?.id]);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = typeof target === 'function' ? target() : target;
    (element?.isConnected ? element : pageHeading.current)?.focus();
  });

  const canPlan = can('perm_envois_creer');
  const exports = EXPORTS.filter(([, , permission]) => can(permission));

  return <div className={`departures-page ${embedded ? '' : 'mx-auto max-w-6xl p-4 sm:p-6'} space-y-5`}>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 ref={pageHeading} tabIndex={-1} className="departures-panel-heading text-2xl font-bold brand-t">Départs</h1>
        <p className="mt-1 text-sm text-gray-600">Planifier, vérifier le chargement et retrouver les manifestes confirmés.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={busy} onClick={() => (loadFailed ? retryLoad() : run(async () => { await refresh(); setAssignResults({}); }))}>
          <RefreshCw size={16} aria-hidden="true" className={busy ? 'animate-spin' : ''} />Actualiser
        </button>
        {canPlan && <button ref={planButton} type="button" className={PRIMARY} disabled={!sbReady} aria-expanded={creating} aria-controls={creating ? 'departure-planning' : undefined} onClick={() => (creating ? closePlanning() : openPlanning())}>
          <CalendarPlus size={16} aria-hidden="true" />Planifier un départ
        </button>}
      </div>
    </header>
    {errors.page && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{errors.page}</p>}

    {creating && <form id="departure-planning" noValidate aria-labelledby="departure-planning-title" onSubmit={submitPlanning} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 id="departure-planning-title" className="font-bold text-gray-800">Planifier un départ</h2>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">Planification</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="departure-plan-date" label="Premier départ" help="À partir d’aujourd’hui (heure de Paris)." error={planErrors.date}>
            {props => <input ref={planDate} type="date" min={today} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} {...props} />}
          </Field>
          <Field id="departure-plan-destination" label="Destination" error={planErrors.destinationCode}>
            {props => <select value={form.destinationCode} onChange={(event) => setForm({ ...form, destinationCode: event.target.value })} {...props}>{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>}
          </Field>
          <Field id="departure-plan-weeks" label="Nombre de semaines" help="Un départ par semaine, de 1 à 12." error={planErrors.weeks}>
            {props => <input type="number" inputMode="numeric" min="1" max="12" step="1" value={form.weeks} onChange={(event) => setForm({ ...form, weeks: event.target.value })} {...props} />}
          </Field>
          <Field id="departure-plan-closing" label="Clôture (heure de Paris)" help={closingHelp(form.closing, form.date, now, { series: Number(form.weeks) > 1 })} error={planErrors.closing}>
            {props => <input type="datetime-local" min={parisDateTimeInput(now)} max={isoCalendarDay(form.date) ? `${form.date}T23:59` : undefined} value={form.closing} onChange={(event) => setForm({ ...form, closing: event.target.value })} {...props} />}
          </Field>
        </div>
        <p className="text-sm text-gray-600">Pour une série, la même heure de Paris est reprise chaque semaine ; une date déjà planifiée pour cette destination est conservée.</p>
        {errors.plan && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{errors.plan}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Check size={16} aria-hidden="true" />}Enregistrer le planning</button>
          <button type="button" className={BUTTON} onClick={closePlanning}>Annuler</button>
        </div>
      </fieldset>
    </form>}

    {envoiFilter ? <button type="button" onClick={() => setParams({})} className={BUTTON}>Voir tous les départs</button> : <nav aria-label="État des départs" className="flex flex-wrap gap-2">{[['a-preparer','À préparer'],['partis','Partis'],['archives','Archivés']].map(([key,label]) => <button type="button" key={key} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('vue',key); return next; })} aria-pressed={departureView === key} className={departureView === key ? PRIMARY : BUTTON}>{label}</button>)}</nav>}

    {review && <section aria-label="Vérifier le chargement" className="space-y-4 rounded-xl border-2 border-slate-400 bg-white p-4">
      <h2 ref={reviewHeading} tabIndex={-1} className="departures-panel-heading text-lg font-bold brand-t">Chargement de {review.envoi.ref}</h2>
      <p className="text-sm text-gray-600">Cochez les expéditions réellement embarquées. Les autres seront à reprogrammer.</p>
      <label className="block text-sm font-semibold">Rechercher ou scanner une EXP<input value={search} onChange={event => setSearch(event.target.value)} className={SEARCH_FIELD} /></label>
      {[[true,'Prêts à charger'],[false,'À débloquer']].map(([ready,label]) => {
        const all = review.dossiers.filter(item => departureReadiness(item).eligible === ready);
        const rows = all.filter(item => !search || [item.ref,clients.find(client => client.id === item.clientId)?.nom].join(' ').toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')));
        return <div key={label}><h3 className="font-semibold">{label} ({all.length})</h3>{rows.map(item => {
          const status = departureReadiness(item);
          return <article key={item.id} className="border-b border-gray-100 py-3"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !status.eligible} onChange={event => setSelected(previous => event.target.checked ? [...previous,item.id] : previous.filter(id => id !== item.id))} /><span><strong>{item.ref}</strong> · {clients.find(client => client.id === item.clientId)?.nom}</span></label>
            {status.eligible && <p className="text-sm text-gray-600">{preparedSummary(status.count, status.weights?.realWeight)}{status.legacySingle ? ' · En cochant, je confirme un colis physique (ancien dossier).' : ''}</p>}
            {status.reasons.map(reason => <div key={reason.task} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800"><span>{reason.text}</span><Link to={dossierTaskUrl(item.id,reason.task,new URLSearchParams({returnTo}).toString())} className="inline-flex min-h-11 items-center underline">{reason.task === 'paiement' ? 'Vérifier le paiement' : 'Vérifier la préparation'}</Link></div>)}
          </article>;
        })}{!rows.length && <p className="py-2 text-sm text-gray-600">{search ? 'Aucun dossier ne correspond à cette recherche.' : 'Aucun dossier dans ce groupe.'}</p>}</div>;
      })}
      <label className="block text-sm text-gray-700">Motif du report des dossiers non cochés<textarea value={deferredReason} onChange={event => setDeferredReason(event.target.value)} className={`${SEARCH_FIELD} py-2`} maxLength={500} /></label>
      <p role="status" className="text-sm font-semibold">{plural(review.dossiers.filter(item => selected.includes(item.id) && departureReadiness(item).eligible).length, 'expédition cochée', 'expéditions cochées')} · {review.dossiers.filter(item => !selected.includes(item.id)).length} à reporter. La sélection est conservée pendant vos vérifications.</p>
      {selected.some(id => !review.dossiers.some(item => item.id === id && departureReadiness(item).eligible)) && <p role="alert" className="text-sm text-red-700">Un dossier coché a changé. Actualisez le chargement et revérifiez votre sélection.</p>}
      {errors.review && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{errors.review}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !selected.length || selected.some(id => !review.dossiers.some(item => item.id === id && departureReadiness(item).eligible))} onClick={() => run(confirm, 'review')} className={PRIMARY}><Check size={16} aria-hidden="true" />Confirmer le départ de {plural(selected.length, 'expédition')}</button><button type="button" disabled={busy} className={BUTTON} onClick={closeReview}>Fermer le chargement</button><button type="button" className={BUTTON} disabled={busy} onClick={() => run(() => startReview(review.envoi), 'review')}>Actualiser le chargement</button></div>
    </section>}

    {manifest && <section aria-label="Manifeste confirmé" className="space-y-3 rounded-xl border border-emerald-300 bg-white p-4">
      <h2 ref={manifestHeading} tabIndex={-1} className="departures-panel-heading font-bold text-gray-800">Manifeste {manifest.envoi.ref}</h2>
      <p className="text-sm text-gray-600">{confirmedLine(manifest.confirmedAt, { today: now })} · {countLabel(manifest.colis.length, 'expédition', 'expéditions')} · {countLabel(manifest.colis.reduce((sum, item) => sum + (item.outgoingParcelCount || 0), 0), 'colis physique', 'colis physiques')}.</p>
      {manifest.colis.map((item) => <p key={item.id} className="text-sm text-gray-700">{item.ref} · {preparedSummary(item.outgoingParcelCount, departureReadiness(item).weights?.realWeight)}</p>)}
      {manifest.deferred.map((item) => <p key={item.id} className="text-sm text-amber-800">Reporté : {item.ref} · {item.reason}</p>)}
      {manifest.excluded?.map((item) => <p key={item.id} className="text-sm text-gray-600">Hors chargement : {item.ref} · {item.reason}</p>)}
      <button type="button" className={BUTTON} onClick={closeManifest}>Fermer le manifeste</button>
    </section>}

    {loadFailed ? <div role="alert" className="departures-error departures-load-error">
      <AlertTriangle size={20} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">Chargement impossible</p>
        <p>Les départs n’ont pas pu être chargés{dataError ? ` : ${dataError.replace(/^Chargement impossible\s*:\s*/, '')}` : ''}. Vérifiez la connexion puis réessayez.</p>
        <button type="button" onClick={() => retryLoad()} className={`${BUTTON} mt-3 departures-accent`}><RefreshCw size={16} aria-hidden="true" />Réessayer</button>
      </div>
    </div> : visible.length ? <div className="grid gap-4">{visible.map(renderCard)}</div> : renderEmpty()}
  </div>;

  // Plain render functions (never nested components): a card keeps its DOM, its open
  // disclosure and its focused field across renders.
  function renderEmpty() {
    if (envoiFilter) return <div className="departures-empty"><span className="departures-empty-icon"><Plane size={26} aria-hidden="true" /></span><h2 className="text-lg font-bold brand-t">Départ introuvable</h2><p>Ce départ n’existe plus ou n’est pas visible avec vos accès. Revenez à la liste de tous les départs.</p></div>;
    const [Icon, title, text] = departureView === 'partis' ? [Plane, 'Aucun départ parti', 'Un départ apparaît ici dès que son chargement est confirmé, avec son manifeste.']
      : departureView === 'archives' ? [Archive, 'Aucun départ archivé', 'Les départs arrivés puis archivés restent consultables ici avec leur manifeste.']
        : [CalendarPlus, 'Aucun départ à préparer', canPlan ? 'Planifiez le prochain départ : les dossiers pourront y être affectés, puis son chargement vérifié ici.' : 'Aucun départ n’est planifié pour le moment. La planification est faite par une personne autorisée de l’équipe ; les nouveaux départs apparaîtront ici.'];
    return <div className="departures-empty" data-testid="departures-empty">
      <span className="departures-empty-icon"><Icon size={26} aria-hidden="true" /></span>
      <h2 className="text-lg font-bold brand-t">{title}</h2>
      <p>{text}</p>
      {departureView === 'a-preparer' && canPlan && !creating && <button type="button" className={`${PRIMARY} mt-2`} onClick={openPlanning}><CalendarPlus size={16} aria-hidden="true" />Planifier un départ</button>}
    </div>;
  }

  function renderCard(envoi) {
    const departed = departureDeparted(envoi);
    const active = data.filter((item) => item.envoi === envoi.id && !['annule', 'livre'].includes(item.statut));
    const loadable = loadableDossiers(envoi, data);
    const overdue = departureOverdue(envoi, now);
    const closingLine = departureClosingLine(envoi, { today: now });
    const wished = departed ? [] : wishedDossiersFor(envoi, data, clients, now);
    const lateEnd = new Map(wishesAfterSubscription(envoi, wished, clients).map(item => [item.dossier.id, item.endDay]));
    const result = assignResults[envoi.id];
    const day = departureDayLabel(envoi.date, { today: now });
    const canModify = can('perm_envois_modifier');
    const canLoad = !departed && OPEN_DEPARTURE_STATUSES.includes(envoi.statut) && can('perm_colis_expedier') && canModify;
    const editingThis = editing?.id === envoi.id;
    const scope = cardScope(envoi.id);
    return <article key={envoi.id} data-departure-card={envoi.id} aria-labelledby={`departure-title-${envoi.id}`} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`departure-title-${envoi.id}`} tabIndex={-1} className="departures-panel-heading flex items-center gap-2 font-bold brand-t"><Plane size={18} aria-hidden="true" className="shrink-0" />{envoi.ref || 'Départ sans référence'} · {day || 'Date à préciser'}</h2>
          <p className="mt-1 text-sm text-gray-600">{DESTINATIONS[envoi.destinationCode]?.label || envoi.destinationCode || 'Destination à préciser'} · {departureStateLabel(envoi)}</p>
          {overdue && <p className="departures-flag"><AlertTriangle size={14} aria-hidden="true" />Date dépassée · planning à vérifier ou reprogrammer</p>}
          {closingLine && <p className="departures-closing"><Clock size={14} aria-hidden="true" className="shrink-0" />{closingLine}</p>}
        </div>
        {!departed && (active.length
          ? <button type="button" className={BUTTON} onClick={() => navigate(`/colis?view=envoi&envoi=${envoi.id}`)}>{countLabel(active.length, 'dossier actif', 'dossiers actifs')}<ChevronRight size={16} aria-hidden="true" /></button>
          : <p className="departures-reason">Aucun dossier actif</p>)}
      </div>

      {editingThis && <form noValidate onSubmit={saveEditing} aria-label={`Modifier le planning de ${envoi.ref || 'ce départ'}`} className="space-y-3 border-t border-gray-200 pt-3">
        <fieldset disabled={busy} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="departure-edit-date" label="Date" help="À partir d’aujourd’hui (heure de Paris)." error={editErrors.date}>
              {props => <input ref={editDate} type="date" min={today} value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} {...props} />}
            </Field>
            <Field id="departure-edit-destination" label="Destination" error={editErrors.destinationCode}>
              {props => <select value={editing.destinationCode} onChange={(event) => setEditing({ ...editing, destinationCode: event.target.value })} {...props}>{!DESTINATIONS[editing.destinationCode] && <option value="">À préciser</option>}{Object.values(DESTINATIONS).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>}
            </Field>
            <Field id="departure-edit-closing" label="Clôture (heure de Paris)" help={closingHelp(editing.closure, editing.date, now)} error={editErrors.closing}>
              {props => <input type="datetime-local" min={parisDateTimeInput(now)} max={isoCalendarDay(editing.date) ? `${editing.date}T23:59` : undefined} value={editing.closure} onChange={(event) => setEditing({ ...editing, closure: event.target.value })} {...props} />}
            </Field>
          </div>
          {errors.edit && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{errors.edit}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={PRIMARY}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Check size={16} aria-hidden="true" />}Enregistrer le départ</button>
            <button type="button" className={BUTTON} onClick={cancelEditing}>Annuler</button>
          </div>
        </fieldset>
      </form>}

      {wished.length > 0 && <section aria-labelledby={`departure-wishes-${envoi.id}`} className="departures-wishes">
        <h3 id={`departure-wishes-${envoi.id}`} className="departures-wishes-title"><CalendarCheck size={16} aria-hidden="true" /><span>{countLabel(wished.length, 'dossier souhaite', 'dossiers souhaitent')} partir ce <span className="whitespace-nowrap">jour-là</span></span></h3>
        <ul className="departures-wishes-list">{wished.map(dossier => <li key={dossier.id}>
          <Link to={`/colis/${dossier.id}?${new URLSearchParams({ returnTo })}`} className="departures-wishes-link">{dossier.ref}</Link>
          <span className="departures-wishes-client">{[clients.find(client => client.id === dossier.clientId)?.nom, STATUTS[dossier.statut]?.label, lateEnd.has(dossier.id) ? subscriptionEndNote(lateEnd.get(dossier.id), { today: now }) : null].filter(Boolean).join(' · ')}</span>
        </li>)}</ul>
        {can('perm_colis_affecter_envoi')
          ? <button type="button" className={`${BUTTON} departures-accent`} disabled={busy} onClick={() => assignWishes(envoi, wished)}>{assigning === envoi.id ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <CalendarCheck size={16} aria-hidden="true" />}Affecter ces dossiers</button>
          : <p className="departures-reason">L’affectation à un départ est réservée aux personnes autorisées.</p>}
      </section>}
      {result?.assigned.length > 0 && <p role="status" className="departures-success"><CheckCircle size={16} aria-hidden="true" />{countLabel(result.assigned.length, 'dossier affecté', 'dossiers affectés')}</p>}
      {result?.failures.length > 0 && <div role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" /><div className="min-w-0"><p>{countLabel(result.failures.length, 'dossier non affecté', 'dossiers non affectés')} :</p><ul>{result.failures.map(text => <li key={text}>{text}</li>)}</ul></div></div>}

      <div className="flex flex-wrap items-center gap-2">
        {!departed && canModify && !editingThis && <button type="button" data-action="edit" className={BUTTON} disabled={busy} onClick={() => startEditing(envoi)}><Pencil size={16} aria-hidden="true" />Modifier le planning</button>}
        {canLoad && (loadable.length
          ? <button type="button" data-action="loading" disabled={busy} className={PRIMARY} onClick={(event) => openReview(envoi, event)}>Vérifier et confirmer le chargement</button>
          : <><button type="button" data-action="loading" disabled className={BUTTON} aria-describedby={`departure-no-load-${envoi.id}`}>Vérifier et confirmer le chargement</button><span id={`departure-no-load-${envoi.id}`} className="departures-reason">Aucun dossier affecté à ce départ</span></>)}
        {departed && <button type="button" data-action="manifest" disabled={busy} className={BUTTON} onClick={(event) => openManifest(envoi, event)}>Voir le manifeste</button>}
        {departed && canModify && envoi.statut === 'parti' && <button key="arrive" type="button" data-action="arrive" disabled={busy} className={BUTTON} onClick={() => confirmStep(envoi, 'arrive')}>Confirmer l’arrivée</button>}
        {departed && canModify && envoi.statut === 'arrive' && <button key="archive" type="button" data-action="archive" disabled={busy} className={BUTTON} onClick={() => confirmStep(envoi, 'archive')}><Archive size={16} aria-hidden="true" />Archiver ce départ</button>}
      </div>
      <DepartureDocuments envoi={envoi} departed={departed} dossierCount={loadable.length} exports={exports} busy={busy} onExport={type => run(() => exportDeparture(envoi.id, type), scope)} />
      {errors[scope] && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{errors[scope]}</p>}
    </article>;
  }
}

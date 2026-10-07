import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Download, Loader2, Plus, RefreshCw, Search, Upload, Users, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { searchClients, eur, clientContactLabel, countLabel } from '../../utils';
import { useDialog } from '../ui/useDialog';
import { parseClientFile, detectDuplicates, COL_MAP } from '../../utils/importClients';
import { importRowIssue } from '../../domain/clientRequirements';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';

// Tokens of brand.css: subtle borders and surfaces follow the light and dark themes.
const BORDER = 'border-[color:var(--border-subtle)]';
const SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 dark:border-[color:var(--border-subtle)] bg-elevated px-4 py-2 text-sm font-semibold text-primary transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl brand-bg px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0';
const DANGER = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition-transform duration-200 ease-out active:scale-[0.98]';
const FIELD = 'mt-1.5 min-h-11 w-full rounded-xl border-2 border-gray-200 bg-elevated px-3 py-2 text-primary';
const LABEL = 'block text-[11px] font-bold uppercase tracking-wider text-gray-600';
const ACTIVE_EXCLUDED = ['livre', 'annule'];
const FILTERS = [
  ['all', 'Tous les clients', ''],
  ['active', 'Avec dossier actif', 'avec un dossier actif'],
  ['pro', 'Professionnels', 'professionnel'],
  ['telegram', 'Telegram lié', 'avec Telegram lié'],
];

const IMPORT_FIELDS = [...new Set(Object.values(COL_MAP))];
const FIELD_LABELS = {
  ref: 'Référence d’origine', numCommande: 'Numéro de commande', type: 'Type de client', raisonSociale: 'Raison sociale', genre: 'Civilité',
  nom: 'Nom', prenom: 'Prénom', abonnement: 'Offre', abonnementFin: 'Fin de l’abonnement', abonnementDebut: 'Début de l’abonnement',
  modePaiement: 'Modalité de paiement', tel: 'Téléphone', telFixe: 'Téléphone fixe', email: 'Email', commune: 'Commune', ville: 'Ville',
  cp: 'Code postal', adresseLigne1: 'Adresse', adresseLigne2: 'Complément d’adresse', departement: 'Département (ignoré)', siret: 'SIRET',
  telegramUsername: 'Identifiant Telegram', notes: 'Notes', dateNaissance: 'Date de naissance', infosLivraison: 'Informations de livraison', interlocuteur: 'Interlocuteur',
};

function downloadExample() {
  const url = URL.createObjectURL(new Blob(['\ufeffNom;Prénom;Email;Téléphone;Adresse;Code postal;Ville\nExemple;Camille;camille@example.com;+262692000000;12 rue des Lilas;97400;Saint-Denis\n'], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = 'exemple-import-clients.csv'; link.click(); URL.revokeObjectURL(url);
}

function ClientImport({ onClose }) {
  const { clients, addNewClient, can } = useApp();
  const [phase, setPhase] = useState('upload');
  const [parsed, setParsed] = useState(null);
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState({});
  const [included, setIncluded] = useState({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, created: 0, total: 0, failures: [], pending: [] });
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stop = useRef(false); const running = useRef(false); const parsing = useRef(0);
  const pressedBackdrop = useRef(false); const keepImporting = useRef(null); const focusBeforeConfirm = useRef(null);
  const busy = phase === 'importing';
  // The required information of a client account: a row without it is listed with all its reasons (missing and
  // invalid fields at once), never imported.
  const checked = parsed ? parsed.clients.map(client => ({ client, issue: importRowIssue(client) })) : [];
  const rows = parsed ? detectDuplicates(checked.filter(row => !row.issue).map(row => row.client), clients) : [];
  const lineOf = text => Number(/^Ligne (\d+)/.exec(text)?.[1]) || 0;
  const refused = parsed ? [...parsed.errors, ...checked.filter(row => row.issue).map(({ client, issue }) => `Ligne ${client._sourceRow} : ${issue}`)].sort((a, b) => lineOf(a) - lineOf(b)) : [];
  const selected = rows.filter(row => included[row.client._sourceRow] ?? !row.duplicate);
  const remaining = phase === 'done' ? progress.pending.length + progress.failures.length : 0;
  // Rows read from the file (or left to resume) are lost when the window closes: ask first.
  const unsaved = (phase === 'preview' && rows.length > 0) || remaining > 0;
  const requestClose = () => {
    if (running.current) return;
    if (confirmingClose) { setConfirmingClose(false); return; }
    if (unsaved) { focusBeforeConfirm.current = document.activeElement; setConfirmingClose(true); return; }
    onClose();
  };
  const dialog = useDialog(true, requestClose);
  useEffect(() => {
    if (confirmingClose) { keepImporting.current?.focus(); return; }
    const previous = focusBeforeConfirm.current;
    if (!previous) return;
    focusBeforeConfirm.current = null;
    // Back to where the person was, or to the window itself: focus never leaves the dialog.
    if (previous.isConnected && dialog.current?.contains(previous)) previous.focus();
    else (dialog.current?.querySelector('button:not([disabled])') || dialog.current)?.focus();
  }, [confirmingClose, dialog]);

  const read = async (source, next = {}) => {
    const version = ++parsing.current; setError(''); setPhase('reading'); setFile(source);
    try { const result = await parseClientFile(source, next); if (version !== parsing.current) return; setParsed(result); setIncluded({}); setPage(0); setPhase('preview'); }
    catch (e) { if (version === parsing.current) { setError(e.message); setPhase('upload'); } }
  };
  const choose = source => { setMapping({}); read(source); };
  const start = async () => {
    if (running.current || !selected.length) return;
    running.current = true; stop.current = false; setPhase('importing'); setError('');
    const snapshot = selected.map(row => row.client); let created = 0; let done = 0; const failures = [];
    setProgress({ total: snapshot.length, created: 0, done: 0, failures: [], pending: snapshot });
    for (const client of snapshot) {
      if (stop.current) break;
      try {
        const subscription = can('perm_clients_modifier_abonnement');
        const id = await addNewClient({ ...client, abonnement: subscription ? client.abonnement : 'freemium', abonnementDebut: subscription ? client.abonnementDebut || null : null, abonnementFin: subscription ? client.abonnementFin || null : null, dateNaissance: client.dateNaissance || null, points: 0 });
        if (!id) throw new Error('Création non confirmée'); created++;
      } catch (e) { failures.push({ client, error: e.message }); }
      done++; setProgress({ total: snapshot.length, created, done, failures: [...failures], pending: snapshot.slice(done) });
    }
    running.current = false; setPhase('done');
  };
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const lostRows = phase === 'done'
    ? `${remaining === 1 ? 'La ligne restante ne sera plus proposée' : `Les ${remaining} lignes restantes ne seront plus proposées`} à la reprise. Les fiches déjà créées restent enregistrées.`
    : `${rows.length === 1 ? 'La ligne lue ne sera pas importée' : `Les ${rows.length} lignes lues ne seront pas importées`}. Aucun client n’a été créé.`;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-2 sm:p-5"
      onMouseDown={event => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={event => { if (event.target === event.currentTarget && pressedBackdrop.current) requestClose(); pressedBackdrop.current = false; }}
    >
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="client-import-title" className="flex max-h-[94dvh] w-full max-w-4xl flex-col rounded-2xl bg-elevated text-primary shadow-xl">
        <header className={`flex items-center justify-between gap-3 border-b ${BORDER} py-2 pl-4 pr-2`}>
          <h2 id="client-import-title" className="text-lg font-bold">Importer des clients</h2>
          {!confirmingClose && <button type="button" aria-label="Fermer l’import" title={busy ? 'L’import en cours doit d’abord s’arrêter' : 'Fermer'} disabled={busy} onClick={requestClose} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-secondary transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.98] disabled:opacity-50"><X size={20} aria-hidden="true" /></button>}
        </header>
        {confirmingClose ? (
          <div role="group" aria-labelledby="client-import-close-title" className="space-y-4 p-4">
            <h3 id="client-import-close-title" className="font-semibold">{phase === 'done' ? 'Fermer sans reprendre les lignes restantes ?' : 'Fermer sans importer ?'}</h3>
            <p className="text-sm text-secondary">{lostRows}</p>
            <div className="flex flex-wrap gap-2">
              <button ref={keepImporting} type="button" className={PRIMARY} onClick={() => setConfirmingClose(false)}>Continuer l’import</button>
              <button type="button" className={DANGER} onClick={onClose}>{phase === 'done' ? 'Fermer sans reprendre' : 'Fermer sans importer'}</button>
            </div>
          </div>
        ) : <>
          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            <p className="text-sm text-secondary">Fichier CSV ou Excel, 10 Mo maximum. Colonnes obligatoires : nom, prénom, email, téléphone (mobile ou fixe), adresse, code postal et ville. Une ligne incomplète est listée avec toutes ses raisons et n’est pas importée. Aucun message n’est envoyé pendant l’import.</p>
            {error && <p role="alert" className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {phase === 'upload' && <>
              <button type="button" className={SECONDARY} onClick={downloadExample}><Download size={16} aria-hidden="true" />Télécharger le fichier exemple</button>
              <div
                data-testid="client-import-drop"
                onDragEnter={event => { event.preventDefault(); setDragging(true); }}
                onDragOver={event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
                onDrop={event => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer?.files?.[0]; if (dropped) choose(dropped); }}
                className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-transform duration-200 ease-out ${dragging ? 'border-[color:var(--brand-text)] bg-surface' : 'border-gray-300 dark:border-[color:var(--border-subtle)]'}`}
              >
                <Upload size={28} className="brand-t" aria-hidden="true" />
                <p className="font-semibold">{dragging ? 'Relâchez pour lire le fichier' : 'Glissez-déposez votre fichier ici'}</p>
                <p className="text-sm text-secondary">ou</p>
                <label className="flex w-full max-w-md flex-col items-center gap-2 text-sm font-semibold">
                  Choisir le fichier de clients
                  <input className="block w-full text-sm text-secondary file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-xl file:border-0 file:bg-[color:var(--brand-navy)] file:px-4 file:font-semibold file:text-white" type="file" accept=".csv,.xls,.xlsx" onChange={event => { if (event.target.files?.[0]) choose(event.target.files[0]); }} />
                </label>
              </div>
            </>}
            {phase === 'reading' && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Lecture et vérification du fichier…</p>}
            {phase === 'preview' && parsed && <>
              <section className={`rounded-xl border ${BORDER} p-3`}>
                <h3 className="font-semibold">Correspondance des colonnes</h3>
                <p className="text-sm text-secondary">Vérifiez chaque association avant l’import. Une colonne ne doit alimenter qu’un seul champ.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">{parsed.headers.map(h => <label key={h.raw} className="text-sm">{h.raw}<select className={FIELD} value={h.mapped || ''} onChange={e => {
                  const next = { ...mapping, [h.raw]: e.target.value };
                  const assigned = Object.fromEntries(parsed.headers.map(item => [item.raw, next[item.raw] ?? item.mapped]));
                  const values = Object.values(assigned).filter(Boolean);
                  if (new Set(values).size !== values.length) { setError('Ce champ est déjà associé à une autre colonne. Désassociez-la avant de le choisir.'); return; }
                  setMapping(next); read(file, next);
                }}><option value="">Ignorer cette colonne</option>{IMPORT_FIELDS.map(key => <option key={key} value={key}>{FIELD_LABELS[key] || key}</option>)}</select></label>)}</div>
              </section>
              {refused.length > 0 && <details open className="rounded-xl border border-red-200 dark:border-red-900 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-red-800">{countLabel(refused.length, 'ligne exclue', 'lignes exclues')} de l’import : informations obligatoires manquantes ou invalides</summary><ul className="space-y-1 text-sm">{refused.map((value, i) => <li key={i}>{value}</li>)}</ul></details>}
              <p className="font-semibold">{countLabel(selected.length, 'client sélectionné', 'clients sélectionnés')} sur {countLabel(rows.length, 'ligne valide', 'lignes valides')}</p>
              <p className="text-sm text-secondary">Les doublons possibles, dans le fichier ou la base, sont exclus par défaut. Une sélection manuelle crée une nouvelle fiche sans modifier l’existante.</p>
              <div className="space-y-2">{rows.slice(page * 20, (page + 1) * 20).map(row => {
                const duplicate = row.duplicate;
                return <label key={row.client._sourceRow} className={`flex min-h-16 items-start gap-3 rounded-xl border p-3 ${duplicate ? 'border-[color:var(--attention-border)] bg-[color:var(--attention-bg)]' : BORDER}`}>
                  <input className="mt-1 size-5 shrink-0" type="checkbox" checked={included[row.client._sourceRow] ?? !duplicate} onChange={e => setIncluded(p => ({ ...p, [row.client._sourceRow]: e.target.checked }))} />
                  <span className="min-w-0 break-words text-sm"><strong>Ligne {row.client._sourceRow} · {row.client.prenom} {row.client.nom}</strong><span className="block">{clientContactLabel(row.client) || 'Contact à compléter'} · {row.client.cp || 'Destination à compléter'}</span>
                    {duplicate && <span className="block font-semibold text-[color:var(--attention-text)]">Doublon possible de {[duplicate.prenom, duplicate.nomFamille || duplicate.nom].filter(Boolean).join(' ')}. Créer quand même une fiche séparée ?</span>}</span>
                </label>;
              })}</div>
              <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" disabled={!page} className={SECONDARY} onClick={() => setPage(p => p - 1)}>Précédent</button><span className="text-sm">Page {page + 1} sur {pages}</span><button type="button" disabled={(page + 1) * 20 >= rows.length} className={SECONDARY} onClick={() => setPage(p => p + 1)}>Suivant</button></div>
            </>}
            {busy && <section className="space-y-3">
              <p role="status">{countLabel(progress.done, 'client traité', 'clients traités')} sur {progress.total} · {countLabel(progress.created, 'fiche créée', 'fiches créées')}</p>
              <progress className="w-full" aria-label="Avancement de l’import" max={progress.total || 1} value={progress.done} />
              <p className="text-sm text-secondary">L’arrêt prend effet après la requête en cours. Les fiches déjà créées restent enregistrées.</p>
              <button type="button" className={SECONDARY} onClick={() => { stop.current = true; setError('Arrêt demandé : attente de la requête en cours.'); }}>Arrêter après le client en cours</button>
            </section>}
            {phase === 'done' && <section className="space-y-3">
              <h3 className="font-semibold">{progress.pending.length ? 'Import arrêté' : 'Import terminé'}</h3>
              <p role="status">{countLabel(progress.created, 'fiche créée', 'fiches créées')}, {countLabel(progress.failures.length, 'non confirmée', 'non confirmées')}, {countLabel(progress.pending.length, 'non traitée', 'non traitées')}.</p>
              {progress.failures.map(({ client, error: failure }) => <p key={client._sourceRow} className="text-sm text-red-800">Ligne {client._sourceRow} · {client.nom} : {failure}</p>)}
              {remaining > 0 && <>
                <p className="text-sm text-secondary">Avant de reprendre une création non confirmée, vérifiez la liste des clients : une réponse perdue peut masquer une fiche déjà créée.</p>
                <button type="button" className={SECONDARY} onClick={() => { const pending = [...progress.pending, ...progress.failures.map(f => f.client)]; setParsed(p => ({ ...p, clients: pending })); setIncluded(Object.fromEntries(progress.failures.map(f => [f.client._sourceRow, false]))); setPage(0); setPhase('preview'); }}>Revoir les lignes restantes avant reprise</button>
              </>}
            </section>}
          </div>
          {phase === 'preview' && <footer className={`flex flex-wrap justify-between gap-3 border-t ${BORDER} p-4`}><button type="button" className={SECONDARY} onClick={() => setPhase('upload')}>Changer de fichier</button><button type="button" className={PRIMARY} disabled={!selected.length} onClick={start}>Importer {countLabel(selected.length, 'client', 'clients')}</button></footer>}
          {phase === 'done' && <footer className={`flex flex-wrap justify-end gap-3 border-t ${BORDER} p-4`}><button type="button" className={PRIMARY} onClick={requestClose}>Terminer</button></footer>}
        </>}
      </section>
    </div>,
    document.body,
  );
}

function ListSkeleton() {
  return <div role="status" aria-label="Chargement des clients" className="space-y-3">
    <div className="h-11 w-full animate-pulse rounded-xl bg-gray-100" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}</div>
  </div>;
}

export default function StaffClients() {
  const navigate = useNavigate();
  const { clients, data, envois = [], can, dataLoading, dataError, sbReady, retryLoad } = useApp();
  const [view, setView] = usePersistentDraft('clients:list', { search: '', filter: 'all', layout: 'cards', selected: null });
  const [importing, setImporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const searchInput = useRef(null);
  const searchId = useId(); const filterId = useId(); const layoutId = useId();
  // One pass over the loaded dossiers: open dossiers and amounts received outside the archives.
  const stats = useMemo(() => {
    const byClient = new Map();
    for (const dossier of data) {
      if (!dossier.clientId) continue;
      const entry = byClient.get(dossier.clientId) || { active: 0, received: 0 };
      if (!dossier.archive && !ACTIVE_EXCLUDED.includes(dossier.statut)) entry.active += 1;
      if (!dossier.archive) entry.received += Number(dossier.paiementMontant) || 0;
      byClient.set(dossier.clientId, entry);
    }
    return byClient;
  }, [data]);
  const activeOf = id => stats.get(id)?.active || 0;
  const filter = FILTERS.some(([key]) => key === view.filter) ? view.filter : 'all';
  const search = (view.search || '').trim();
  const visible = searchClients(clients, view.search).filter(client => filter === 'all' || (filter === 'pro' ? client.type === 'pro' : filter === 'telegram' ? Boolean(client.telegramChatId) : activeOf(client.id) > 0));
  // The shell's rule (domain/dataLoad.js): nothing read → the failure here, with « Réessayer »; data held
  // after a failed refresh or retry → the list (or its empty view) under the shell's banner, which says it.
  const load = staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) });
  const state = clients.length ? 'ready' : load.state === 'loading' ? 'loading' : load.state === 'failed' ? 'error' : 'empty';
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !view.selected || !visible.length) return;
    const target = [...document.querySelectorAll(`[data-client-id="${view.selected}"]`)].find(node => node.getClientRects().length);
    if (target) { restored.current = true; requestAnimationFrame(() => { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }); }); }
  }, [view.selected, visible.length]);
  const open = client => { setView(p => ({ ...p, selected: client.id })); navigate(`/clients/${client.id}`); };
  const retry = async () => { if (retrying) return; setRetrying(true); try { await retryLoad(); } finally { setRetrying(false); } };
  const financial = can('perm_clients_voir_finances');
  const canCreate = can('perm_clients_creer');
  const summary = state !== 'ready' ? '' : visible.length === clients.length ? countLabel(clients.length, 'client', 'clients') : `${visible.length ? countLabel(visible.length, 'client affiché', 'clients affichés') : 'Aucun client affiché'} sur ${clients.length}`;
  const filterPhrase = FILTERS.find(([key]) => key === filter)?.[2] || '';
  const noResult = search
    ? `Aucun client ne correspond à « ${search} »${filter !== 'all' ? ` parmi les clients ${filterPhrase === 'professionnel' ? 'professionnels' : filterPhrase}` : ''}`
    : `Aucun client ${filterPhrase}`;

  return <div className="mx-auto max-w-7xl space-y-4 pb-20">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-primary">Clients</h1>{summary && <p role="status" className="text-sm text-secondary">{summary}</p>}</div>
      {state === 'ready' && canCreate && <div className="flex flex-wrap gap-2"><button type="button" className={SECONDARY} onClick={() => setImporting(true)}><Upload size={16} aria-hidden="true" />Importer des clients</button><button type="button" className={PRIMARY} onClick={() => navigate('/clients/new')}><Plus size={16} aria-hidden="true" />Nouveau client</button></div>}
    </header>
    {state === 'loading' && <ListSkeleton />}
    {state === 'error' && <section role="alert" className="space-y-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 p-5 text-red-800">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={18} aria-hidden="true" />Chargement impossible</p>
      <p className="text-sm">La liste des clients n’a pas pu être chargée{dataError ? ` (${dataError.replace(/^Chargement impossible : /, '')})` : ''}. Aucune fiche n’a été modifiée.</p>
      <button type="button" className={SECONDARY} disabled={retrying || dataLoading} onClick={retry}>{retrying || dataLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{retrying || dataLoading ? 'Nouvelle tentative…' : 'Réessayer'}</button>
    </section>}
    {state === 'empty' && <section className={`flex flex-col items-center gap-3 rounded-2xl border ${BORDER} bg-elevated px-6 py-12 text-center`}>
      <span className="flex size-16 items-center justify-center rounded-full bg-surface brand-t"><Users size={30} aria-hidden="true" /></span>
      <h2 className="text-lg font-bold text-primary">Aucun client pour l’instant</h2>
      <p className="max-w-md text-sm text-secondary">{canCreate ? 'Créez une première fiche ou importez votre fichier de clients pour commencer à réceptionner leurs colis.' : 'Les fiches créées par l’équipe apparaîtront ici.'}</p>
      {canCreate && <div className="flex flex-wrap justify-center gap-2"><button type="button" className={PRIMARY} onClick={() => navigate('/clients/new')}><Plus size={16} aria-hidden="true" />Nouveau client</button><button type="button" className={SECONDARY} onClick={() => setImporting(true)}><Upload size={16} aria-hidden="true" />Importer des clients</button></div>}
    </section>}
    {state === 'ready' && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div><label htmlFor={searchId} className={LABEL}>Rechercher un client</label><input id={searchId} ref={searchInput} type="search" className={FIELD} value={view.search} onChange={e => setView(p => ({ ...p, search: e.target.value }))} placeholder="Nom, référence, email, téléphone, @identifiant…" /></div>
        <div><label htmlFor={filterId} className={LABEL}>Afficher</label><select id={filterId} className={FIELD} value={filter} onChange={e => setView(p => ({ ...p, filter: e.target.value }))}>{FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="hidden lg:block"><label htmlFor={layoutId} className={LABEL}>Présentation</label><select id={layoutId} className={FIELD} value={view.layout} onChange={e => setView(p => ({ ...p, layout: e.target.value }))}><option value="cards">Fiches</option><option value="list">Tableau</option></select></div>
      </div>
      {!visible.length && <section aria-label="Aucun résultat" className={`flex flex-col items-center gap-3 rounded-2xl border ${BORDER} bg-elevated px-6 py-10 text-center`}>
        <span className="flex size-12 items-center justify-center rounded-full bg-surface brand-t"><Search size={22} aria-hidden="true" /></span>
        <p className="font-semibold text-primary">{noResult}</p>
        <p className="text-sm text-secondary">La recherche porte sur le nom, la référence client, l’email, le téléphone, la ville et l’identifiant Telegram.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {search && <button type="button" className={SECONDARY} onClick={() => { setView(p => ({ ...p, search: '' })); searchInput.current?.focus(); }}><X size={16} aria-hidden="true" />Effacer la recherche</button>}
          {filter !== 'all' && <button type="button" className={SECONDARY} onClick={() => setView(p => ({ ...p, filter: 'all' }))}>Afficher tous les clients</button>}
        </div>
      </section>}
      <div className={view.layout === 'list' ? 'grid gap-3 lg:hidden' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'}>{visible.map(client => {
        const contact = clientContactLabel(client);
        const selected = view.selected === client.id;
        return <button type="button" data-client-id={client.id} key={client.id} onClick={() => open(client)} className={`flex min-w-0 flex-col items-start justify-start gap-1 rounded-xl border p-4 text-left transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.99] ${selected ? 'border-[color:var(--brand-text)] bg-blue-50' : `${BORDER} bg-elevated`}`}>
          <span className="block break-words font-semibold text-primary">{client.nom}</span>
          <span className="block text-sm text-secondary">{client.type === 'pro' ? 'Professionnel' : 'Particulier'}{client.cp || client.ville ? ` · ${[client.cp, client.ville].filter(Boolean).join(' ')}` : ''}</span>
          <span className={`mt-1 block max-w-full break-words text-sm ${contact ? 'text-primary' : 'text-secondary italic'}`}>{contact || 'Contact à compléter'}</span>
          <span className="mt-1 block text-sm text-secondary">{activeOf(client.id) ? countLabel(activeOf(client.id), 'dossier actif', 'dossiers actifs') : 'Aucun dossier actif'} · {client.telegramChatId ? 'Telegram lié' : 'Telegram non lié'}</span>
        </button>;
      })}</div>
      {view.layout === 'list' && visible.length > 0 && <div className={`hidden overflow-x-auto rounded-xl border ${BORDER} lg:block`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Clients affichés</caption>
          <thead className="bg-surface"><tr>{['Client', 'Destination', 'Contact', 'Dossiers actifs', ...(financial ? ['Encaissé (dossiers non archivés)'] : [])].map(label => <th key={label} scope="col" className="p-3 text-left font-semibold text-primary">{label}</th>)}</tr></thead>
          <tbody>{visible.map(client => {
            const contact = clientContactLabel(client);
            return <tr key={client.id} className={`border-t ${BORDER} ${view.selected === client.id ? 'bg-blue-50' : ''}`}>
              <td className="p-3"><button type="button" data-client-id={client.id} className="min-h-11 text-left font-semibold text-primary underline-offset-2 hover:underline" onClick={() => open(client)}>{client.nom}</button></td>
              <td className="p-3">{[client.cp, client.ville].filter(Boolean).join(' ')}</td>
              <td className={`break-words p-3 ${contact ? '' : 'italic text-secondary'}`}>{contact || 'Contact à compléter'}</td>
              <td className="p-3">{activeOf(client.id)}</td>
              {financial && <td className="p-3">{eur(stats.get(client.id)?.received || 0)}</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </>}
    {importing && <ClientImport onClose={() => setImporting(false)} />}
  </div>;
}

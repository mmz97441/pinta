import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, ListFilter, MessageCircle, PanelRightOpen, Paperclip, Search, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { conversationState } from '../../domain/conversations';
import { CHANNEL_LABELS, clientDisplayName, conversationOverdue, conversationPreview, conversationSince, conversationTime, nameInitials, previewText, sortConversations, waitingAge } from '../../domain/conversationList';
import { receptionCartonManifest } from '../../domain/reception';
import { STATUTS } from '../../constants';
import { getClientDest } from '../../utils';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { staffName } from './WorkActionRow';
import InboxAttachment from './InboxAttachment';
import TaskOwnership from './TaskOwnership';
import ChatPanel from '../detail/ChatPanel';
import DossierContextPanel from '../detail/DossierContextPanel';
import { ColumnDialog } from '../staff/DossierColumnOptions';
import { workspaceReturnPath } from '../../domain/navigation';
import { inboxAssignmentMessage } from '../../domain/invoiceLock';
import '../staff/dossierTable.css';
import './conversations.css';

const WIDE = '(min-width: 1024px)';
const SEGMENTS = [['', 'Toutes'], ['a_traiter', 'À répondre'], ['attente_client', 'Attente client'], ['termine', 'Traitées']];
const SECTIONS = [['a_traiter', 'À répondre'], ['attente_client', 'Attente client'], ['termine', 'Traitées']];

// One layout at a time: the list and the exchange side by side need 1024px.
function useWideScreen() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE).matches));
  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return undefined;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export default function ConversationsView() {
  const { data = [], clients = [], inboxItems = [], workActions = [], workError, workLoading, teamUsers = [], auth, can, ask, flash, refreshInbox, refreshColis, refreshWork, sel, setSelId } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWideScreen();
  const now = useMinuteNow();
  const [assignment, setAssignment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [contextSection, setContextSection] = useState(null);
  // Work actions only add the owner labels: the skeleton covers their first load,
  // not the background refresh every minute.
  const [workSeen, setWorkSeen] = useState(!workLoading);
  useEffect(() => { if (!workLoading) setWorkSeen(true); }, [workLoading]);
  const filtersButton = useRef(null);
  const query = (params.get('q') || '').trim().toLocaleLowerCase('fr');
  const state = params.get('state') || '';
  const owner = params.get('owner') || '';
  // A legacy link, a conversation chosen on a narrow screen, or one missing from the
  // loaded list (archived, load failure) opens the dossier page, which tells
  // loading, network error and « introuvable » apart.
  const requested = params.get('ouvert');
  const missing = Boolean(requested) && !data.some(item => item.id === requested);
  const dossierId = params.get('dossier') || ((!wide || missing) && requested) || null;
  const openId = wide && !params.get('dossier') && !missing ? requested : null;
  useEffect(() => {
    if (!dossierId) return;
    const filters = new URLSearchParams(location.search);
    filters.delete('dossier'); filters.delete('ouvert'); filters.delete('action'); filters.delete('inbox'); filters.delete('returnTo');
    const back = `/conversations${filters.size ? `?${filters}` : ''}`;
    const next = new URLSearchParams({ onglet: 'conversation', returnTo: workspaceReturnPath(location.search, back) });
    if (params.get('action')) next.set('action', params.get('action'));
    navigate(`/colis/${encodeURIComponent(dossierId)}?${next}`, { replace: true });
  }, [dossierId, location.search, params, navigate]);
  // « Détails du dossier » reads the selected dossier, as on the dossier page.
  useEffect(() => {
    if (!openId) return undefined;
    setSelId(openId);
    return () => setSelId(null);
  }, [openId, setSelId]);
  useEffect(() => { setContextSection(null); }, [openId]);
  const inboxId = params.get('inbox');
  const selectedInbox = inboxItems.find(item => item.id === inboxId && item.status === 'unassigned');
  const clientMap = new Map(clients.map(item => [item.id, item]));
  const actionFor = id => { const actions = workActions.filter(action => action.colis_id === id && action.kind === 'conversation'); return actions.find(action => action.state !== 'done') || actions.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]; };
  const ownerMatches = action => !owner || (owner === 'me' ? action?.assignee_id === auth?.u?.id : owner === 'unassigned' ? !action?.assignee_id : action?.assignee_id === owner);
  const textMatches = text => !query || text.toLocaleLowerCase('fr').includes(query);
  // Search and owner apply to every segment: the counts answer « how many if I click ».
  const visible = data.filter(item => !item.archive && (item.messages?.length || conversationState(item) !== 'termine')
    && !(owner === 'unassigned' && conversationState(item) === 'termine' && !actionFor(item.id))
    && ownerMatches(actionFor(item.id))
    && textMatches([clientDisplayName(clientMap.get(item.clientId)), item.ref, ...(item.messages || []).map(message => message.texte)].join(' ')));
  const counts = { a_traiter: 0, attente_client: 0, termine: 0 };
  visible.forEach(item => { counts[conversationState(item)] += 1; });
  const dossiers = sortConversations(visible.filter(item => !state || conversationState(item) === state));
  const sections = SECTIONS.map(([key, label]) => ({ key, label, rows: dossiers.filter(item => conversationState(item) === key) })).filter(section => section.rows.length);
  const inbox = inboxItems.filter(item => item.status === 'unassigned' && (!state || state === 'a_traiter') && ownerMatches(null) && textMatches([clientDisplayName(clientMap.get(item.client_id || item.clientId)), item.texte].join(' ')))
    .toSorted((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  const oldestToAnswer = sortConversations(visible).find(item => conversationState(item) === 'a_traiter');
  const openDossier = openId ? data.find(item => item.id === openId) : null;
  const openClient = clientMap.get(openDossier?.clientId);
  const openAction = openDossier && workActions.find(action => action.colis_id === openDossier.id && action.kind === 'conversation' && action.state !== 'done');
  const selectedClient = clientMap.get(selectedInbox?.client_id || selectedInbox?.clientId);
  const initialLoading = workLoading && !workSeen && !workActions.length;
  const change = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; }, { replace: true });
  const clearFilters = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('state'); next.delete('owner'); return next; }, { replace: true });
  const select = (key, id) => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('ouvert'); next.delete('inbox'); next.set(key, id); return next; }); setError(''); setAssignment(''); };
  const close = () => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('ouvert'); next.delete('inbox'); return next; }); };
  async function assign() {
    if (!selectedInbox || !assignment || busy) return;
    const item = selectedInbox; const target = assignment; setBusy(true); setError('');
    try {
      const response = await supabase.functions.invoke('telegram-inbox-assign', { body: { inboxId: item.id, colisId: target } });
      if (response.error || response.data?.error) throw new Error(await functionErrorMessage(response, 'Le rattachement a échoué.'));
      // A document may have become a late invoice (D3): say what happened to the quote.
      const notice = inboxAssignmentMessage(response.data?.document, data.find(parcel => parcel.id === target)?.ref);
      await Promise.all([refreshInbox(), refreshColis(target), refreshWork()]);
      if (notice) flash?.({ msg: notice, type: 'info', duration: 9000 });
      select(wide ? 'ouvert' : 'dossier', target);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (dossierId) return <p role="status" className="p-6 text-sm text-slate-600">Ouverture de la conversation du dossier…</p>;

  const conversationRow = item => {
    const name = clientDisplayName(clientMap.get(item.clientId));
    const itemState = conversationState(item);
    const action = actionFor(item.id);
    const unread = (item.messages || []).filter(message => message.type === 'client' && !message.lu).length;
    const since = itemState === 'a_traiter' ? waitingAge(conversationSince(item), now) : '';
    const when = conversationTime(item.conversationUpdatedAt || item.messages?.at(-1)?.createdAt || item.updatedAt, now);
    // Reading is not handling: a closed exchange without a task is « Traitée », never « Non attribué ».
    const ownerLabel = itemState === 'termine' && !action ? 'Traitée' : action?.assignee_id && action.assignee_id === auth?.u?.id ? 'Vous' : staffName(action?.assignee_id, teamUsers);
    return <li key={item.id}><button type="button" aria-current={openId === item.id ? 'true' : undefined} data-unread={unread > 0 || undefined} onClick={() => select(wide ? 'ouvert' : 'dossier', item.id)} className="conversation-row">
      <span className="conversation-avatar" aria-hidden="true">{nameInitials(name)}</span>
      <span className="conversation-row__main">
        <span className="conversation-row__title"><span className="conversation-row__name">{name}</span>{' '}<span className="conversation-row__ref">{item.ref}</span></span>
        {' '}<span className="conversation-row__preview">{unread > 0 && <span className="conversation-row__dot" aria-hidden="true" />}{conversationPreview(item, { meId: auth?.u?.id, teamUsers }).text}</span>
        {unread > 0 && <span className="sr-only"> {unread} non lu(s)</span>}
      </span>
      {' '}<span className="conversation-row__meta">
        {since ? <span data-overdue={conversationOverdue(item, now) || undefined}><span className="conversation-row__since">depuis </span>{since}</span> : when && <span>{when}</span>}
        {' '}<span>{ownerLabel}</span>
      </span>
    </button></li>;
  };
  const inboxRow = item => {
    const name = clientDisplayName(clientMap.get(item.client_id || item.clientId));
    const attached = Boolean(item.payload?.document || item.payload?.photo?.length);
    return <li key={item.id}><button type="button" aria-current={wide && inboxId === item.id ? 'true' : undefined} data-inbox="" data-unread="" onClick={() => select('inbox', item.id)} className="conversation-row">
      <span className="conversation-avatar" aria-hidden="true">{nameInitials(name)}</span>
      <span className="conversation-row__main">
        <span className="conversation-row__title"><span className="conversation-row__name">{name}</span>{' '}<span className="conversation-row__ref">sans dossier</span></span>
        {' '}<span className="conversation-row__preview">{previewText(item.texte) || 'Document reçu sur Telegram'}</span>
      </span>
      {' '}<span className="conversation-row__meta">
        <span>{conversationTime(item.created_at, now)}</span>
        {attached && <><Paperclip size={15} aria-hidden="true" /><span className="sr-only"> Document joint</span></>}
      </span>
    </button></li>;
  };
  const empty = query || owner ? { text: 'Aucune conversation dans ces filtres.', action: 'Retirer les filtres', run: clearFilters }
    : state === 'a_traiter' ? { text: 'Aucune conversation à répondre.', action: 'Voir toutes les conversations', run: () => change('state', '') }
    : state === 'attente_client' ? { text: 'Aucune conversation en attente du client.', action: 'Voir toutes les conversations', run: () => change('state', '') }
    : state === 'termine' ? { text: 'Aucune conversation traitée.', action: 'Voir toutes les conversations', run: () => change('state', '') }
    : { text: 'Aucune conversation pour le moment.' };

  const assignmentForm = selectedInbox && <section aria-label="Message à rattacher" className="conversation-assign">
    {!wide && <button onClick={close} className="conversation-back"><ArrowLeft size={18} aria-hidden="true" />Retour aux conversations</button>}
    <h2>{clientDisplayName(selectedClient)} · Message sans dossier</h2>
    <p className="conversation-assign__intro">Vérifiez le contenu puis choisissez l’expédition concernée.</p>
    <p className="conversation-assign__message">{selectedInbox.texte || 'Document reçu sur Telegram'}</p><InboxAttachment item={selectedInbox} />
    <label>Dossier du client<select aria-label="Dossier du client" value={assignment} onChange={event => setAssignment(event.target.value)}><option value="">Choisir un dossier</option>{data.filter(item => item.clientId === (selectedInbox.client_id || selectedInbox.clientId)).map(item => <option key={item.id} value={item.id}>{[item.ref, item.desc || STATUTS[item.statut]?.label, `${receptionCartonManifest(item).nbColis} carton(s)`, item.dateReception ? new Date(item.dateReception).toLocaleDateString('fr-FR') : 'date à préciser'].filter(Boolean).join(' · ')}</option>)}</select></label>
    <button disabled={!assignment || busy || !can('perm_comm_telegram')} onClick={() => ask('Rattacher ce message ?', `Le message et son document seront rattachés à ${data.find(item => item.id === assignment)?.ref || 'cette expédition'} pour ${clientDisplayName(selectedClient)}.`, assign, { okLabel: 'Confirmer le rattachement' })} className="conversation-primary-button">{busy ? 'Rattachement…' : 'Rattacher au dossier'}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;

  const list = <div className="conversation-list">
    <div className="conversation-list__header">
      <h1>Conversations</h1>
      <div className="dossier-toolbar conversation-toolbar">
        <div className="dossier-toolbar-search relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="search" value={params.get('q') || ''} onChange={event => change('q', event.target.value)} aria-label="Rechercher un client ou EXP" placeholder="Client, EXP, message…" className="w-full" />
        </div>
        <button ref={filtersButton} type="button" className="dossier-toolbar-button dossier-toolbar-icon-button" aria-label={`Filtres${owner ? ' · 1' : ''}`} aria-haspopup="dialog" aria-expanded={filtersOpen} aria-controls={filtersOpen ? 'conversation-filters-dialog' : undefined} onClick={() => setFiltersOpen(open => !open)}>
          <ListFilter size={18} aria-hidden="true" />{owner && <span className="dossier-toolbar-badge" aria-hidden="true">1</span>}
        </button>
      </div>
      <div role="group" aria-label="Traitement des conversations" className="dossier-scope conversation-segments">
        {SEGMENTS.map(([key, label]) => <button key={key || 'all'} type="button" aria-pressed={state === key} onClick={() => change('state', key)}><span>{label}{['a_traiter', 'attente_client'].includes(key) && <> <b>{counts[key]}</b></>}</span></button>)}
      </div>
    </div>
    {filtersOpen && <ColumnDialog title="Filtres" anchor={filtersButton.current} onClose={() => setFiltersOpen(false)} id="conversation-filters-dialog" titleId="conversation-filters-title" testId="conversation-filters-dialog" closeLabel="Fermer les filtres" align="end">
      <div className="grid gap-3">
        <label>Responsable<select data-filter-focus aria-label="Responsable" value={owner} onChange={event => change('owner', event.target.value)}><option value="">Tous</option><option value="me">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>
        {owner && <button type="button" onClick={() => change('owner', '')}>Retirer le filtre</button>}
      </div>
    </ColumnDialog>}
    <div className="conversation-list__body">
      {workError && <p role="alert" className="conversation-workerror">Suivi des actions indisponible : {workError.message || String(workError)} <button onClick={() => refreshWork().catch(() => {})} className="min-h-11 underline">Réessayer</button></p>}
      {initialLoading ? <div role="status" aria-label="Chargement des conversations">{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="conversation-skeleton animate-pulse" aria-hidden="true"><span /><div><span style={{ width: `${48 + (index % 3) * 12}%` }} /><span style={{ width: `${72 - (index % 2) * 14}%` }} /></div><div><span /><span /></div></div>)}</div> : <>
        {inbox.length > 0 && <section aria-label="Messages sans dossier" className="conversation-section" data-tone="inbox">
          <h2 className="conversation-section__title"><Paperclip size={14} aria-hidden="true" />À rattacher à un dossier · {inbox.length}</h2>
          <ul className="conversation-rows">{inbox.map(inboxRow)}</ul>
        </section>}
        {sections.map(section => {
          const collapsible = section.key === 'termine' && !state;
          const expanded = !collapsible || showHandled;
          return <section key={section.key} aria-labelledby={`conversation-section-${section.key}`} className="conversation-section">
            <h2 id={`conversation-section-${section.key}`} className="conversation-section__title">{collapsible
              ? <button type="button" className="conversation-section__toggle" aria-expanded={showHandled} aria-controls={`conversation-rows-${section.key}`} onClick={() => setShowHandled(value => !value)}>{section.label} · {section.rows.length}<ChevronDown size={15} aria-hidden="true" /></button>
              : <>{section.label} · {section.rows.length}{section.key === 'a_traiter' && <span className="conversation-section__hint">· la plus ancienne en haut</span>}</>}</h2>
            {expanded && <ul id={`conversation-rows-${section.key}`} className="conversation-rows">{section.rows.map(conversationRow)}</ul>}
          </section>;
        })}
        {!dossiers.length && !inbox.length && <div className="conversation-list__empty"><MessageCircle size={24} aria-hidden="true" /><p className="m-0">{empty.text}</p>{empty.action && <button className="conversation-text-button" onClick={empty.run}>{empty.action}</button>}</div>}
      </>}
    </div>
  </div>;

  if (!wide) return <main className="conversation-inbox">{assignmentForm || list}</main>;

  const destination = openDossier ? getClientDest(openDossier.clientId, clients) : null;
  const cartons = openDossier ? receptionCartonManifest(openDossier).nbColis : 0;
  const channel = openClient?.telegramChatId ? 'telegram' : 'portal';
  const ChannelIcon = channel === 'telegram' ? Send : MessageCircle;
  const pane = assignmentForm || (openDossier ? <section aria-labelledby="conversation-thread-title" className="conversation-thread">
    <header className="conversation-thread__header">
      <span className="conversation-avatar" aria-hidden="true">{nameInitials(clientDisplayName(openClient))}</span>
      <div className="conversation-thread__identity">
        <h2 id="conversation-thread-title">{clientDisplayName(openClient)} <span className="conversation-thread__ref">{openDossier.ref}</span></h2>
        <p className="conversation-thread__facts">{destination && <span>{destination.label}</span>}{destination && <span aria-hidden="true">·</span>}<span>{cartons} {cartons > 1 ? 'cartons reçus' : 'carton reçu'}</span><span aria-hidden="true">·</span><span className="conversation-channel" data-channel={channel}><ChannelIcon size={14} aria-hidden="true" />{CHANNEL_LABELS[channel]}</span></p>
      </div>
      <div className="conversation-thread__actions">
        <button type="button" className="dossier-toolbar-button" aria-label="Détails du dossier" aria-haspopup="dialog" onClick={() => setContextSection('reception')}><PanelRightOpen size={17} aria-hidden="true" /><span className="conversation-thread__action-text">Détails du dossier</span></button>
        <Link to={`/colis/${encodeURIComponent(openDossier.id)}?${new URLSearchParams({ onglet: 'conversation', returnTo: location.pathname + location.search })}`} aria-label="Ouvrir le dossier" className="dossier-toolbar-button"><span className="conversation-thread__action-text">Ouvrir le dossier</span><ArrowRight size={17} aria-hidden="true" /></Link>
      </div>
    </header>
    <ChatPanel key={openDossier.id} colis={openDossier} client={openClient} embedded active ownership={openAction && <TaskOwnership key={openAction.id} action={openAction} compact />} />
  </section> : <div className="conversation-pane__empty">
    <MessageCircle size={28} aria-hidden="true" />
    <h2>Choisissez une conversation</h2>
    {oldestToAnswer && <button type="button" className="conversation-primary-button" onClick={() => select('ouvert', oldestToAnswer.id)}>Ouvrir la plus ancienne à répondre<ArrowRight size={17} aria-hidden="true" /></button>}
  </div>);

  return <main className="conversation-inbox conversation-inbox--two-panes">
    {list}
    <div className="conversation-pane">{pane}</div>
    {openDossier && sel?.id === openDossier.id && <DossierContextPanel key={openDossier.id} section={contextSection} onSectionChange={setContextSection} onClose={() => setContextSection(null)} taskSearch={`?${new URLSearchParams({ returnTo: location.pathname + location.search })}`} />}
  </main>;
}

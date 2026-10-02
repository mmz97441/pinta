import React, { useState, useEffect } from 'react';
import { useLocation, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { CONVERSATION_STATES, conversationState, conversationLabel } from '../../domain/conversations';
import { receptionCartonManifest } from '../../domain/reception';
import { workDate, staffName } from './WorkActionRow';
import InboxAttachment from './InboxAttachment';
import { workspaceReturnPath } from '../../domain/navigation';

export default function ConversationsView() {
  const { data = [], clients = [], inboxItems = [], workActions = [], workError, teamUsers = [], auth, can, ask, refreshInbox, refreshColis, refreshWork } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = (params.get('q') || '').trim().toLocaleLowerCase('fr');
  const state = params.get('state') || '';
  const owner = params.get('owner') || '';
  const dossierId = params.get('dossier');
  useEffect(() => {
    if (!dossierId) return;
    const filters = new URLSearchParams(location.search);
    filters.delete('dossier'); filters.delete('action'); filters.delete('inbox'); filters.delete('returnTo');
    const back = `/conversations${filters.size ? `?${filters}` : ''}`;
    const next = new URLSearchParams({ onglet: 'conversation', returnTo: workspaceReturnPath(location.search, back) });
    if (params.get('action')) next.set('action', params.get('action'));
    navigate(`/colis/${encodeURIComponent(dossierId)}?${next}`, { replace: true });
  }, [dossierId, location.search, params, navigate]);
  const inboxId = params.get('inbox');
  const selectedInbox = inboxItems.find(item => item.id === inboxId && item.status === 'unassigned');
  const clientMap = new Map(clients.map(item => [item.id, item]));
  const name = client => (client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client';
  const actionFor = id => { const actions = workActions.filter(action => action.colis_id === id && action.kind === 'conversation'); return actions.find(action => action.state !== 'done') || actions.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]; };
  const matches = (text, action) => (!query || text.toLocaleLowerCase('fr').includes(query)) && (!owner || (owner === 'me' ? action?.assignee_id === auth?.u?.id : owner === 'unassigned' ? !action?.assignee_id : action?.assignee_id === owner));
  const dossiers = data.filter(item => !item.archive && (item.messages?.length || conversationState(item) !== 'termine') && (!state || conversationState(item) === state) && !(owner === 'unassigned' && conversationState(item) === 'termine' && !actionFor(item.id)) && matches([name(clientMap.get(item.clientId)), item.ref, item.messages?.at(-1)?.texte].join(' '), actionFor(item.id)))
    .sort((a, b) => Date.parse(b.conversationUpdatedAt || b.updatedAt || 0) - Date.parse(a.conversationUpdatedAt || a.updatedAt || 0));
  const inbox = inboxItems.filter(item => item.status === 'unassigned' && (!state || state === 'a_traiter') && matches([name(clientMap.get(item.client_id || item.clientId)), item.texte].join(' '), null));
  const selectedClient = clientMap.get(selectedInbox?.client_id || selectedInbox?.clientId);
  const change = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; });
  const select = (key, id) => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('inbox'); next.set(key, id); return next; }); setError(''); setAssignment(''); };
  const close = () => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('inbox'); return next; }); };
  async function assign() {
    if (!selectedInbox || !assignment || busy) return;
    const item = selectedInbox; const target = assignment; setBusy(true); setError('');
    try {
      const response = await supabase.functions.invoke('telegram-inbox-assign', { body: { inboxId: item.id, colisId: target } });
      if (response.error || response.data?.error) throw new Error(await functionErrorMessage(response, 'Le rattachement a échoué.'));
      await Promise.all([refreshInbox(), refreshColis(target), refreshWork()]); select('dossier', target);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (dossierId) return <p role="status" className="p-6 text-sm text-slate-600">Ouverture de la conversation du dossier…</p>;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Conversations</h1><p className="mt-1 text-sm text-slate-600">Ouvrez un échange pour retrouver le colis et ce qui a déjà été fait.</p></div><Link to="/" className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold">Mon travail</Link></header>
    {workError && <p role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">Suivi des actions indisponible : {workError.message || String(workError)} <button onClick={() => refreshWork().catch(() => {})} className="min-h-11 underline">Réessayer</button></p>}
    {selectedInbox ? <section aria-label="Message à rattacher" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <button onClick={close} className="inline-flex min-h-11 items-center gap-2 font-semibold text-slate-700"><ArrowLeft size={18} />Retour aux conversations</button>
      <h2 className="text-lg font-bold text-slate-800">{name(selectedClient)} · Message sans dossier</h2>
      <p className="text-sm text-slate-600">Vérifiez le contenu puis choisissez l’expédition concernée.</p>
      <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm">{selectedInbox.texte || 'Document reçu sur Telegram'}</p><InboxAttachment item={selectedInbox} />
      <label className="block text-sm font-semibold">Dossier du client<select value={assignment} onChange={event => setAssignment(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border bg-white px-3"><option value="">Choisir un dossier</option>{data.filter(item => item.clientId === (selectedInbox.client_id || selectedInbox.clientId)).map(item => <option key={item.id} value={item.id}>{item.ref} · {item.desc || item.statut} · {receptionCartonManifest(item).nbColis} carton(s) · {item.dateReception ? new Date(item.dateReception).toLocaleDateString('fr-FR') : 'date à préciser'}</option>)}</select></label>
      <button disabled={!assignment || busy || !can('perm_comm_telegram')} onClick={() => ask('Rattacher ce message ?', `Le message et son document seront rattachés à ${data.find(item => item.id === assignment)?.ref || 'cette expédition'} pour ${name(selectedClient)}.`, assign, { okLabel: 'Confirmer le rattachement' })} className="min-h-12 rounded-xl brand-bg px-4 font-semibold text-white disabled:opacity-40">{busy ? 'Rattachement…' : 'Rattacher au dossier'}</button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section> : <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="text-sm font-semibold text-slate-700">Rechercher un client ou EXP<input value={params.get('q') || ''} onChange={event => change('q', event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Traitement<select value={state} onChange={event => change('state', event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3"><option value="">Tous</option>{Object.entries(CONVERSATION_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Responsable<select value={owner} onChange={event => change('owner', event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3"><option value="">Tous</option><option value="me">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>
      </div>
      {inbox.length > 0 && <section aria-label="Messages sans dossier" className="space-y-2"><h2 className="font-semibold text-slate-800">À rattacher à une expédition ({inbox.length})</h2>{inbox.map(item => <button key={item.id} onClick={() => select('inbox', item.id)} className="flex min-h-20 w-full items-center gap-4 rounded-xl border border-amber-200 bg-white p-4 text-left"><div className="min-w-0 flex-1"><span className="block text-sm font-semibold">{name(clientMap.get(item.client_id || item.clientId))}</span><span className="mt-1 line-clamp-2 text-sm text-slate-600">{item.texte || 'Document reçu sur Telegram'}</span></div><ChevronRight size={20} aria-hidden="true" /></button>)}</section>}
      <section aria-label="Liste des conversations" className="space-y-2"><h2 className="font-semibold text-slate-800">Échanges par expédition ({dossiers.length})</h2>
        {dossiers.map(item => { const ownAction = actionFor(item.id); const unread = (item.messages || []).filter(message => message.type === 'client' && !message.lu).length; return <button key={item.id} onClick={() => select('dossier', item.id)} className="flex min-h-24 w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left"><div className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-slate-800">{name(clientMap.get(item.clientId))}<span className="font-mono text-sm">{item.ref}</span>{unread > 0 && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">{unread} non lu(s)</span>}</span><span className="mt-1 line-clamp-2 text-sm text-slate-600">{item.messages?.at(-1)?.texte || 'Documents reçus'}</span><span className="mt-2 block text-xs text-slate-500">{conversationLabel(item)} · {conversationState(item) === 'termine' && !ownAction ? 'Traitée' : staffName(ownAction?.assignee_id, teamUsers)}{item.conversationUpdatedAt ? ` · ${workDate(item.conversationUpdatedAt)}` : ''}</span></div><ChevronRight size={20} aria-hidden="true" /></button>; })}
        {!dossiers.length && !inbox.length && <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-600"><MessageCircle size={24} className="mx-auto mb-3" /><p>Aucune conversation dans ces filtres.</p>{(query || state || owner) && <button className="mt-2 min-h-11 font-semibold underline" onClick={() => setParams({})}>Retirer les filtres</button>}</div>}
      </section>
    </>}
  </main>;
}

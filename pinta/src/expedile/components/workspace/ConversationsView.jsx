import React, { useState, useEffect } from 'react';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle, PanelRightOpen } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { CONVERSATION_STATES, conversationState, conversationLabel } from '../../domain/conversations';
import { receptionCartonManifest } from '../../domain/reception';
import { workDate, staffName, WorkActionControls } from './WorkActionRow';
import ChatPanel from '../detail/ChatPanel';
import ReceivedCartons from '../detail/ReceivedCartons';
import { Badge } from '../ui';

export default function ConversationsView() {
  const { data = [], clients = [], inboxItems = [], workActions = [], workError, teamUsers = [], auth, can, refreshInbox, refreshColis, refreshWork } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [contextVisible, setContextVisible] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const sync = () => { if (media.matches) setContextVisible(false); };
    media.addEventListener('change', sync); return () => media.removeEventListener('change', sync);
  }, []);
  const [assignment, setAssignment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = (params.get('q') || '').trim().toLocaleLowerCase('fr');
  const state = params.get('state') || '';
  const owner = params.get('owner') || '';
  const dossierId = params.get('dossier');
  const inboxId = params.get('inbox');
  const selected = data.find(item => item.id === dossierId);
  const selectedInbox = inboxItems.find(item => item.id === inboxId && item.status === 'unassigned');
  const clientMap = new Map(clients.map(item => [item.id, item]));
  const name = client => (client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client';
  const actionFor = id => { const actions = workActions.filter(action => action.colis_id === id && action.kind === 'conversation'); return actions.find(action => action.state !== 'done') || actions.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]; };
  const matches = (text, action) => (!query || text.toLocaleLowerCase('fr').includes(query)) && (!owner || (owner === 'me' ? action?.assignee_id === auth?.u?.id : owner === 'unassigned' ? !action?.assignee_id : action?.assignee_id === owner));
  const dossiers = data.filter(item => !item.archive && (item.messages?.length || conversationState(item) !== 'termine') && (!state || conversationState(item) === state) && !(owner === 'unassigned' && conversationState(item) === 'termine' && !actionFor(item.id)) && matches([name(clientMap.get(item.clientId)), item.ref, item.messages?.at(-1)?.texte].join(' '), actionFor(item.id)))
    .sort((a, b) => Date.parse(b.conversationUpdatedAt || b.updatedAt || 0) - Date.parse(a.conversationUpdatedAt || a.updatedAt || 0));
  const inbox = inboxItems.filter(item => item.status === 'unassigned' && (!state || state === 'a_traiter') && matches([name(clientMap.get(item.client_id || item.clientId)), item.texte].join(' '), null));
  const selectedClient = clientMap.get(selected?.clientId || selectedInbox?.client_id || selectedInbox?.clientId);
  const action = actionFor(selected?.id);
  const returnTo = location.pathname + location.search;
  const change = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; });
  const select = (key, id) => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('inbox'); next.set(key, id); return next; }); setContextVisible(false); setError(''); setAssignment(''); };
  const close = () => { setParams(previous => { const next = new URLSearchParams(previous); next.delete('dossier'); next.delete('inbox'); return next; }); setContextVisible(false); };
  async function assign() {
    if (!selectedInbox || !assignment || busy) return;
    const item = selectedInbox; const target = assignment; setBusy(true); setError('');
    try {
      const response = await supabase.functions.invoke('telegram-inbox-assign', { body: { inboxId: item.id, colisId: target } });
      if (response.error || response.data?.error) throw new Error(await functionErrorMessage(response, 'Le rattachement a échoué.'));
      await Promise.all([refreshInbox(), refreshColis(target), refreshWork()]); select('dossier', target);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="flex h-[calc(100dvh-8rem)] min-h-[520px] flex-col p-3 md:p-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-2xl font-bold text-slate-900">Conversations</h1><p className="mt-1 text-sm text-slate-600">{dossiers.length} conversations · {inbox.length} messages à rattacher dans ces filtres</p></div><Link to="/" className="hidden sm:block min-h-11 rounded-lg border px-3 py-3 text-sm font-semibold">Mon travail</Link></header>
    {workError && <p role="alert" className="mb-3 rounded-lg border border-red-200 p-3 text-sm text-red-700">Suivi des actions indisponible : {workError.message || String(workError)} <button onClick={() => refreshWork().catch(() => {})} className="min-h-11 underline">Réessayer</button></p>}
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <aside aria-label="Liste des conversations" className={`${selected || selectedInbox ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-r border-slate-200`}>
        <div className="space-y-2 border-b p-3"><label className="block text-xs font-semibold">Rechercher un client ou EXP<input value={params.get('q') || ''} onChange={event => change('q', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-2 text-sm" /></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold">Traitement<select value={state} onChange={event => change('state', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-1"><option value="">Tous</option>{Object.entries(CONVERSATION_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-semibold">Responsable<select value={owner} onChange={event => change('owner', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-1"><option value="">Tous</option><option value="me">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto">{inbox.map(item => <button key={item.id} onClick={() => select('inbox', item.id)} aria-current={selectedInbox?.id === item.id ? 'true' : undefined} className={`w-full border-b px-3 py-4 text-left ${selectedInbox?.id === item.id ? 'bg-blue-50' : ''}`}><span className="block text-xs font-semibold text-amber-800">Message sans dossier</span><span className="mt-1 block text-sm font-semibold">{name(clientMap.get(item.client_id || item.clientId))}</span><span className="mt-1 line-clamp-2 text-xs text-slate-600">{item.texte || 'Document reçu sur Telegram'}</span></button>)}
          {dossiers.map(item => { const ownAction = actionFor(item.id); const unread = (item.messages || []).filter(message => message.type === 'client' && !message.lu).length; return <button key={item.id} onClick={() => select('dossier', item.id)} aria-current={selected?.id === item.id ? 'true' : undefined} className={`w-full border-b px-3 py-4 text-left ${selected?.id === item.id ? 'bg-blue-50' : ''}`}><span className="flex items-center justify-between gap-2 text-sm font-semibold"><span className="truncate">{name(clientMap.get(item.clientId))}</span>{unread > 0 && <span className="rounded bg-slate-100 px-1.5 text-xs">{unread} non lu(s)</span>}</span><span className="mt-1 block text-xs text-slate-600">{item.ref} · {conversationLabel(item)}</span><span className="mt-1 line-clamp-2 text-xs text-slate-600">{item.messages?.at(-1)?.texte || 'Documents reçus'}</span><span className="mt-2 block text-xs text-slate-500">{conversationState(item) === 'termine' && !ownAction ? 'Traitée' : staffName(ownAction?.assignee_id, teamUsers)}</span></button>; })}
          {!dossiers.length && !inbox.length && <p className="p-5 text-sm text-slate-600">Aucune conversation dans ces filtres.</p>}
        </div>
      </aside>
      <section className={`${selected || selectedInbox ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col overflow-hidden`}>
        {selected || selectedInbox ? <><header className="flex flex-wrap items-center gap-2 border-b p-3"><button onClick={close} aria-label="Retour aux conversations" className="min-h-11 min-w-11 rounded-lg border lg:hidden"><ArrowLeft className="mx-auto" size={18} /></button><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{name(selectedClient)}</h2><p className="text-xs text-slate-600">{selected?.ref || 'Message à rattacher'}{selected?.casier ? ` · Casier ${selected.casier}` : ''}</p></div>{selected && <button aria-expanded={contextVisible} onClick={() => setContextVisible(value => !value)} className="min-h-11 rounded-lg border px-3 text-sm xl:hidden"><PanelRightOpen size={16} className="mr-1 inline" />{contextVisible ? 'Revenir aux messages' : 'Voir le dossier'}</button>}</header>
        {selectedInbox ? <div className="space-y-4 overflow-y-auto p-5"><p className="text-sm text-slate-600">Le client n’a pas encore précisé le dossier concerné. Rattachez le message après vérification de son contenu.</p><p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm">{selectedInbox.texte || 'Document reçu sur Telegram'}</p><label className="block text-sm font-semibold">Dossier du client<select value={assignment} onChange={event => setAssignment(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-2"><option value="">Choisir un dossier</option>{data.filter(item => item.clientId === (selectedInbox.client_id || selectedInbox.clientId)).map(item => <option key={item.id} value={item.id}>{item.ref} · {item.desc || item.statut} · {receptionCartonManifest(item).nbColis} carton(s)</option>)}</select></label><button disabled={!assignment || busy || !can('perm_comm_telegram')} onClick={assign} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Rattachement…' : 'Rattacher au dossier'}</button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div> : <>
          <div className={`${contextVisible ? 'hidden xl:flex' : 'flex'} min-h-0 flex-1 flex-col`}>{action && <div className="border-b px-3 py-2"><WorkActionControls action={action} returnTo={returnTo} compact /></div>}<ChatPanel colis={selected} client={selectedClient} embedded active={!contextVisible} /></div>
          {contextVisible && <div className="overflow-y-auto p-4 xl:hidden"><ConversationContext dossier={selected} client={selectedClient} returnTo={returnTo} /></div>}
        </>}</> : <div className="m-auto max-w-sm p-6 text-center text-slate-600"><MessageCircle size={28} className="mx-auto mb-3" /><p>Sélectionnez une conversation pour répondre et consulter le dossier à côté.</p></div>}
      </section>
      <aside aria-label="Contexte du dossier" className="hidden min-h-0 overflow-y-auto border-l border-slate-200 p-4 xl:block">{selected ? <ConversationContext dossier={selected} client={selectedClient} returnTo={returnTo} /> : <p className="text-sm text-slate-500">Le contexte du dossier apparaîtra ici.</p>}</aside>
    </div>
  </main>;
}

function ConversationContext({ dossier, client, returnTo }) {
  const { teamUsers = [], settings } = useApp();
  return <div className="space-y-4"><div><p className="font-mono font-semibold">{dossier.ref}</p><div className="mt-2"><Badge statut={dossier.statut} /></div></div><dl className="space-y-2 text-sm"><div><dt className="text-xs text-slate-500">Référent du dossier</dt><dd>{staffName(dossier.responsibleStaffId, teamUsers)}</dd></div><div><dt className="text-xs text-slate-500">Destination</dt><dd>{client?.cp || 'À préciser'} · {client?.ville || ''}</dd></div><div><dt className="text-xs text-slate-500">Prochaine action</dt><dd>{dossier.nextAction || 'Consulter les actions de l’équipe'}</dd>{dossier.nextActionSource === 'manual' && dossier.nextActionAt && <dd className="text-xs">{workDate(dossier.nextActionAt)}</dd>}</div></dl>{dossier.attenteClientDate && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Pause demandée par le client{dossier.attenteClientUntil ? ` jusqu’au ${workDate(dossier.attenteClientUntil)}` : ''}. Répondre à une question ne met pas fin à cette pause.</p>}<ReceivedCartons colis={dossier} settings={settings} /><Link to={`/colis/${encodeURIComponent(dossier.id)}?${new URLSearchParams({ returnTo })}`} className="block min-h-11 rounded-lg border px-3 py-3 text-center text-sm font-semibold">Ouvrir le dossier de travail</Link></div>;
}

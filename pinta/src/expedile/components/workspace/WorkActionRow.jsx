import React, { useState, useEffect } from 'react';
import { ArrowRight, Clock, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { WORK_KINDS, WORK_STATES, actionPriority, actionBlocked, canWorkAction, staffAvailable, workActionUrl } from '../../domain/personalWork';
import { receptionCartonManifest } from '../../domain/reception';
import InvoiceReviewIndicator from '../ui/InvoiceReviewIndicator';
import { TaskClaimButton } from './TaskOwnership';

export const workDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
export const staffName = (id, users = []) => { const person = users.find(user => user.authId === id); return person ? [person.prenom, person.nom].filter(Boolean).join(' ') : id ? 'Membre de l’équipe' : 'Non attribué'; };
const controlClass = 'min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40';

export function WorkActionControls({ action, returnTo = '/', compact = false }) {
  const { auth, authRole, can, teamUsers = [], workPreferences = [], data = [], mutateWorkAction, refreshWork } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('');
  const [formAction, setFormAction] = useState(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => { setMode(''); setFormAction(null); setNote(''); setDate(''); setError(''); }, [action.id]);
  const me = auth?.u?.id;
  const own = action.assignee_id === me;
  const recipient = action.handoff_to === me;
  const coordinate = ['directeur', 'vice_directeur'].includes(authRole);
  const allowed = canWorkAction(action, can);
  const candidates = teamUsers.filter(user => user.authId && user.authId !== action.assignee_id && user.actif !== false
    && staffAvailable(workPreferences.find(item => item.staff_id === user.authId))
    && canWorkAction(action, permission => ['directeur', 'vice_directeur'].includes(user.role) || user.permissions?.[permission] === true));
  const open = () => navigate(workActionUrl(action, returnTo, data.find(item => item.id === action.colis_id)));
  async function command(name, payload = {}, thenOpen = false) {
    if (busy) return;
    setBusy(true); setError('');
    try { await mutateWorkAction(['wait', 'handoff', 'reassign', 'prioritize'].includes(name) ? formAction || action : action, name, payload); setMode(''); setNote(''); setDate(''); if (thenOpen) open(); }
    catch (err) { setError(err.message || 'L’action a changé. Rechargez avant de réessayer.'); }
    finally { setBusy(false); }
  }
  function submit(event) {
    event.preventDefault();
    const value = date ? new Date(date).toISOString() : null;
    const payload = mode === 'wait' ? { reason: note.trim(), review_at: value }
      : mode === 'prioritize' ? { reason: note.trim(), until: value }
      : mode === 'reassign' ? { staff_id: target || null, reason: note.trim() }
      : { staff_id: target, note: note.trim() };
    command(mode, payload);
  }
  if (action.state === 'done') return null;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {recipient && <><button disabled={busy || !allowed} onClick={() => command('accept')} className={controlClass + ' bg-slate-900 text-white'}>Accepter le relais</button><button disabled={busy} onClick={() => command('reject')} className={controlClass}>Décliner</button></>}
      <TaskClaimButton key={action.id} action={action} onClaim={open} />
      {own && allowed && action.state === 'ready' && !actionBlocked(action) && <button disabled={busy} onClick={() => command('start', {}, true)} className={controlClass + ' bg-slate-900 text-white'}>Commencer</button>}
      {own && allowed && action.state === 'waiting' && !actionBlocked(action) && <button disabled={busy} onClick={() => command('resume', {}, true)} className={controlClass}>Reprendre cette tâche</button>}
      <button onClick={open} className={controlClass + (action.state === 'in_progress' && own ? ' bg-slate-900 text-white' : '')}>{action.state === 'in_progress' && own ? 'Reprendre le travail' : 'Consulter sans commencer'}<ArrowRight size={14} className="inline ml-2" /></button>
      {(own || coordinate) && <button aria-expanded={Boolean(mode)} onClick={() => { setFormAction(action); setMode(mode ? '' : 'menu'); }} className={controlClass} disabled={busy}>Suivi<ChevronDown size={14} className="inline ml-1" /></button>}
    </div>
    {mode === 'menu' && <div className="flex flex-wrap gap-2 text-sm">
      {own && <><button onClick={() => setMode('wait')} className={controlClass}>Mettre en attente</button><button onClick={() => setMode('handoff')} className={controlClass}>Proposer un relais</button><button disabled={busy} onClick={() => command('release')} className={controlClass}>Remettre à prendre</button></>}
      {coordinate && <><button onClick={() => setMode('reassign')} className={controlClass}>Réaffecter immédiatement</button><button onClick={() => setMode('prioritize')} className={controlClass}>Signaler une priorité</button></>}
    </div>}
    {mode && mode !== 'menu' && <form onSubmit={submit} className={`space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 ${compact ? '' : 'max-w-lg'}`}>
      {['handoff', 'reassign'].includes(mode) && <label className="block text-sm font-semibold">{mode === 'handoff' ? 'Proposer le relais à' : 'Nouveau responsable'}<select required={mode === 'handoff'} value={target} onChange={event => setTarget(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2"><option value="">{mode === 'handoff' ? 'Choisir une personne disponible et habilitée' : 'File commune — non attribué'}</option>{candidates.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>}
      <label className="block text-sm font-semibold">{mode === 'handoff' ? 'Consigne pour la reprise' : 'Motif'}<textarea required maxLength={500} value={note} onChange={event => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
      {['wait', 'prioritize'].includes(mode) && <label className="block text-sm font-semibold">{mode === 'wait' ? 'Date de réexamen (facultative)' : 'Priorité valable jusqu’au'}<input required={mode === 'prioritize'} type="datetime-local" value={date} onChange={event => setDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label>}
      {mode === 'handoff' && <p className="text-xs text-slate-600">Vous restez responsable jusqu’à l’acceptation. La personne qui suit le dossier ne change pas.</p>}
      {mode === 'reassign' && <p className="text-sm text-slate-600">L’attribution change immédiatement, sans attendre l’accord de la personne choisie.</p>}
      {['handoff', 'reassign'].includes(mode) && !candidates.length && <p className="text-sm text-amber-800">Aucun collègue disponible ne dispose des droits nécessaires. Vérifiez la disponibilité et les permissions avec la direction.</p>}
      {mode === 'wait' && <p className="text-xs text-slate-600">Cette attente concerne le travail de l’équipe. Elle ne constitue pas une pause demandée par le client.</p>}
      <div className="flex gap-2"><button disabled={busy} className={controlClass + ' bg-slate-900 text-white'}>{busy ? 'Enregistrement…' : 'Confirmer'}</button><button type="button" onClick={() => setMode('')} className={controlClass}>Annuler</button></div>
    </form>}
    {error && <div role="alert" className="text-sm text-red-700">{error}<button onClick={() => refreshWork().catch(err => setError(err.message))} className="ml-2 min-h-11 underline">Actualiser l’action</button></div>}
  </div>;
}

export default function WorkActionRow({ action, dossier, client, returnTo, now = Date.now(), density = 'comfortable', compactLayout = false, notice }) {
  const { teamUsers = [], auth } = useApp();
  const priority = actionPriority(action, now);
  const waiting = action.blocked_reason || action.waiting_reason;
  const title = action.action_hint || WORK_KINDS[action.kind]?.label || 'Action à préciser';
  const compact = compactLayout || density === 'compact';
  return <article data-work-action={action.id} className={`border-b border-slate-200 ${compact ? `${density === 'compact' ? 'py-2' : 'py-3'} lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-5` : 'py-5'} space-y-3`}>
    <div className="min-w-0 space-y-2">
      <div className={compact ? 'space-y-2 xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-center xl:gap-3' : 'space-y-2'}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 font-semibold text-slate-900"><Link to={workActionUrl(action, returnTo, dossier)} aria-label={`Ouvrir ${title} — ${dossier?.ref || 'dossier'}`} className="inline-flex min-h-11 items-center break-words hover:underline">{title}</Link></h2>
          <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${priority.urgent ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{WORK_STATES[action.state]}</span>
        </div>
        <p className="text-sm text-slate-600 break-words"><strong className="font-semibold text-slate-700">{dossier?.ref || 'Dossier à consulter'}</strong> · {(client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client'}{!compact && dossier ? ` · ${receptionCartonManifest(dossier).nbColis} carton(s) reçu(s)` : ''}</p>
        <p className={`text-xs ${priority.urgent ? 'text-amber-800 font-semibold' : 'text-slate-600'}`}><Clock size={13} className="inline mr-1" />{priority.reason}{action.due_at ? ` · ${workDate(action.due_at)}` : ''}</p>
      </div>
      {(!compact || action.assignee_id !== auth?.u?.id) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600"><span>Réalise la tâche : {action.assignee_id === auth?.u?.id ? 'vous' : staffName(action.assignee_id, teamUsers)}</span>{dossier?.responsibleStaffId && <span>Suit le dossier : {staffName(dossier.responsibleStaffId, teamUsers)}</span>}</div>}
      {waiting && <p className="text-sm text-slate-700"><strong>{action.blocked_reason ? 'Prérequis : ' : 'En attente : '}</strong>{waiting}{action.review_at ? ` · À revoir le ${workDate(action.review_at)}` : ''}</p>}
      {notice && <p className="text-sm text-amber-800">{notice}</p>}
      {action.handoff_to && <p className="text-sm text-slate-700">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue{action.handoff_note ? ` — ${action.handoff_note}` : ''}</p>}
      <InvoiceReviewIndicator dossier={dossier} returnTo={returnTo} />
    </div>
    <div className={compact ? 'lg:!mt-2 lg:max-w-sm' : ''}><WorkActionControls action={action} returnTo={returnTo} compact={compact} /></div>
  </article>;
}

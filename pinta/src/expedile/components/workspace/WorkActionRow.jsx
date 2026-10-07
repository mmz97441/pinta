import React, { useState, useEffect, useRef, useId } from 'react';
import { ArrowRight, Clock, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { WORK_KINDS, WORK_STATES, actionPriority, actionBlocked, actionWaiting, canWorkAction, staffAvailable, workActionUrl, workDate } from '../../domain/personalWork';
import { cartonCount, workRowModel } from '../../domain/workTable';
import { receptionCartonManifest } from '../../domain/reception';
import { pluralWord } from '../../domain/plural';
import InvoiceReviewIndicator from '../ui/InvoiceReviewIndicator';
import TaskTakeButton from './TaskTakeButton';
import { PRIMARY_COMMAND } from './workCommands';
import { pendingWorkDrafts } from '../../domain/workDrafts';

export { workDate, PRIMARY_COMMAND };
export const staffName = (id, users = []) => { const person = users.find(user => user.authId === id); return person ? [person.prenom, person.nom].filter(Boolean).join(' ') : id ? 'Membre de l’équipe' : 'Non attribué'; };
const controlClass = 'min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40';
const secondaryClass = 'min-h-11 rounded-lg px-2 text-sm font-semibold text-slate-600 underline underline-offset-4 hover:bg-slate-50 disabled:opacity-40';

// An open form of a task list outlives a change of layout (table ↔ cards when a
// tablet turns): its fields stay with the task until confirmed or cancelled.
const formDrafts = new Map();

/** State, guards and commands of one task. Buttons and panel (menu, forms,
 * conflict) render apart, so a table shows the panel in its own row; the drafts
 * live here and survive a background refresh of the same task. */
export function useWorkActionControls(action, { returnTo = '/', inTask = false } = {}) {
  const { auth, authRole, can, teamUsers = [], workPreferences = [], data = [], mutateWorkAction, refreshWork, flash } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  // Only list rows keep their form across a remount; a task page has one copy.
  const kept = id => inTask ? undefined : formDrafts.get(id);
  const [mode, setMode] = useState(() => kept(action.id)?.mode || '');
  const [formAction, setFormAction] = useState(() => kept(action.id)?.formAction || null);
  const [note, setNote] = useState(() => kept(action.id)?.note || '');
  const [target, setTarget] = useState(() => kept(action.id)?.target || '');
  const [date, setDate] = useState(() => kept(action.id)?.date || '');
  const shownAction = useRef(action.id);
  useEffect(() => {
    if (shownAction.current === action.id) return;
    shownAction.current = action.id;
    const draft = kept(action.id);
    setMode(draft?.mode || ''); setFormAction(draft?.formAction || null); setNote(draft?.note || ''); setTarget(draft?.target || ''); setDate(draft?.date || ''); setError('');
  }, [action.id]);
  useEffect(() => {
    if (inTask) return;
    if (mode && mode !== 'menu') formDrafts.set(action.id, { mode, formAction, note, target, date });
    else formDrafts.delete(action.id);
  }, [inTask, action.id, mode, formAction, note, target, date]);
  const me = auth?.u?.id;
  const own = action.assignee_id === me;
  const recipient = action.handoff_to === me;
  const coordinate = ['directeur', 'vice_directeur'].includes(authRole);
  const allowed = canWorkAction(action, can);
  const available = staffAvailable(workPreferences.find(item => item.staff_id === me));
  const waiting = actionWaiting(action);
  const canTake = allowed && action.state === 'ready' && !waiting && (!action.assignee_id && available || own);
  const canContinue = own && allowed && action.state === 'in_progress' && !waiting;
  const hasPrimaryCommand = recipient || canTake || canContinue;
  const candidates = teamUsers.filter(user => user.authId && user.authId !== action.assignee_id && user.actif !== false
    && staffAvailable(workPreferences.find(item => item.staff_id === user.authId))
    && canWorkAction(action, permission => ['directeur', 'vice_directeur'].includes(user.role) || user.permissions?.[permission] === true));
  const open = () => navigate(workActionUrl(action, returnTo, data.find(item => item.id === action.colis_id)));
  async function command(name, payload = {}, thenOpen = false) {
    if (pending.current) return;
    const requestUrl = window.location.href;
    if (['handoff', 'release', 'reassign'].includes(name)) {
      const drafts = pendingWorkDrafts(me, action.colis_id, action.kind === 'correction' ? undefined : action.kind);
      if (drafts.length) {
        setError(`Enregistrez ou annulez vos saisies avant de passer la main : ${drafts.map(draft => draft.label).join(', ')}. Elles restent sur votre écran ; le collègue reçoit uniquement les informations enregistrées.`);
        return;
      }
    }
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = await mutateWorkAction(['wait', 'handoff', 'reassign', 'prioritize'].includes(name) ? formAction || action : action, name, payload);
      if (!saved || window.location.href !== requestUrl) return;
      setMode(''); setNote(''); setDate('');
      flash({ accept: 'Relais accepté. La consigne et les informations enregistrées sont disponibles.', reject: 'Relais décliné. Le collègue garde la tâche.', handoff: 'Relais proposé. Vous gardez la tâche jusqu’à son acceptation.', wait: 'Tâche mise en attente.', release: 'Tâche rendue disponible à l’équipe.', resume: 'Attente levée. Vous pouvez continuer.', reassign: 'Attribution enregistrée.', prioritize: 'Priorité enregistrée.' }[name] || 'Modification enregistrée.');
      if (thenOpen && !inTask) open();
    }
    catch (err) { if (window.location.href === requestUrl) setError(err.message || 'L’action a changé. Rechargez avant de réessayer.'); }
    finally { pending.current = false; setBusy(false); }
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
  async function refreshTask() {
    try {
      const refreshed = await refreshWork();
      const fresh = refreshed?.actions?.find(item => item.id === action.id);
      if (fresh) { setFormAction(fresh); setError('Tâche actualisée. Votre saisie est conservée ; vérifiez son attribution avant de confirmer.'); }
      else setError('Cette tâche est terminée ou n’est plus disponible. Revenez à votre liste.');
    } catch (err) { setError(err.message); }
  }
  return {
    action, inTask, busy, error, mode, setMode, setFormAction, note, setNote, target, setTarget, date, setDate,
    own, recipient, coordinate, allowed, waiting, canContinue, hasPrimaryCommand, candidates, teamUsers,
    open, command, submit, refreshTask,
  };
}

/** `hideRedundantView`: in Mon travail the title link already opens a task
 * without taking it, so « Voir » only appears when no command leads there.
 * `options={false}` keeps a relay row to its decision. */
export function WorkActionButtons({ controls, hideRedundantView = false, options = true, panelId, className = 'flex flex-wrap items-center gap-2' }) {
  const { action, inTask, busy, mode, setMode, setFormAction, own, recipient, coordinate, allowed, waiting, canContinue, hasPrimaryCommand, open, command } = controls;
  return <div className={className}>
    {recipient && <><button disabled={busy || !allowed} onClick={() => command('accept', { start: !waiting }, true)} className={PRIMARY_COMMAND}>{waiting ? 'Accepter le suivi' : 'Accepter et ouvrir'}</button><button disabled={busy} onClick={() => command('reject')} className={secondaryClass}>Décliner</button></>}
    {!recipient && !(inTask && own) && <TaskTakeButton key={action.id} action={action} onClaim={inTask ? undefined : open} />}
    {/* The same « Continuer » as a task to start (TaskTakeButton): one look, the word alone. */}
    {!inTask && canContinue && <button onClick={open} data-work-continue="" className={PRIMARY_COMMAND}>Continuer</button>}
    {!inTask && !canContinue && !(hideRedundantView && hasPrimaryCommand) && <button onClick={open} className={hasPrimaryCommand ? secondaryClass : controlClass}>Voir<ArrowRight size={14} className="inline ml-2" /></button>}
    {options && (own || coordinate) && <button aria-expanded={Boolean(mode)} aria-controls={mode && panelId ? panelId : undefined} onClick={() => { setFormAction(action); setMode(mode ? '' : 'menu'); }} className={secondaryClass} disabled={busy}>Options<ChevronDown size={14} className="inline ml-1" /></button>}
  </div>;
}

/** The Options menu, its forms and the conflict message, in this order. */
export function WorkActionPanel({ controls, compact = false }) {
  const { action, busy, error, mode, setMode, note, setNote, target, setTarget, date, setDate, own, coordinate, allowed, candidates, teamUsers, command, submit, refreshTask } = controls;
  // A task nobody holds is attributed, not « reassigned »: the choice of a person is then required.
  const unassigned = !action.assignee_id;
  const choosePerson = mode === 'handoff' || mode === 'reassign' && unassigned;
  return <>
    {mode === 'menu' && <div className="flex flex-wrap gap-2 text-sm">
      {own && <>{action.state === 'waiting' && !actionBlocked(action) && allowed && <button disabled={busy} onClick={() => command('resume', { start: true }, true)} className={controlClass}>Lever l’attente et continuer</button>}<button onClick={() => setMode('wait')} className={controlClass}>Mettre en attente</button><button onClick={() => setMode('handoff')} className={controlClass}>Passer à un collègue</button><button disabled={busy} onClick={() => command('release')} className={controlClass}>Remettre à disposition</button></>}
      {coordinate && <><button onClick={() => setMode('reassign')} className={controlClass}>{unassigned ? 'Attribuer…' : 'Réaffecter immédiatement'}</button><button onClick={() => setMode('prioritize')} className={controlClass}>Signaler une priorité</button></>}
    </div>}
    {mode && mode !== 'menu' && <form onSubmit={submit} className={`space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 ${compact ? '' : 'max-w-lg'}`}>
      {['handoff', 'reassign'].includes(mode) && <label className="block text-sm font-semibold">{mode === 'handoff' ? 'Passer à' : unassigned ? 'Attribuer à' : 'Nouveau responsable'}<select aria-label={mode === 'handoff' ? 'Passer à' : unassigned ? 'Attribuer à' : 'Nouveau responsable'} required={choosePerson} value={target} onChange={event => setTarget(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2"><option value="">{choosePerson ? 'Choisir une personne disponible et habilitée' : 'File commune — non attribué'}</option>{candidates.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>}
      <label className="block text-sm font-semibold">{mode === 'handoff' ? 'Consigne pour la reprise' : 'Motif'}<textarea aria-label={mode === 'handoff' ? 'Consigne pour la reprise' : 'Motif'} required maxLength={500} value={note} onChange={event => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
      {['wait', 'prioritize'].includes(mode) && <label className="block text-sm font-semibold">{mode === 'wait' ? 'Date de réexamen (facultative)' : 'Priorité valable jusqu’au'}<input required={mode === 'prioritize'} type="datetime-local" value={date} onChange={event => setDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label>}
      {mode === 'handoff' && <p className="text-xs text-slate-600">Les informations enregistrées et cette consigne seront disponibles au collègue. Enregistrez vos saisies avant de passer la main. Vous gardez la tâche jusqu’à son acceptation.</p>}
      {mode === 'reassign' && <p className="text-sm text-slate-600">L’attribution change immédiatement, sans attendre l’accord de la personne choisie.</p>}
      {['handoff', 'reassign'].includes(mode) && !candidates.length && <p className="text-sm text-amber-800">Aucun collègue disponible ne dispose des droits nécessaires. Vérifiez la disponibilité et les permissions avec la direction.</p>}
      {mode === 'wait' && <p className="text-xs text-slate-600">Cette attente concerne le travail de l’équipe. Elle ne constitue pas une pause demandée par le client.</p>}
      <div className="flex gap-2"><button disabled={busy} className={PRIMARY_COMMAND}>{busy ? 'Enregistrement…' : mode === 'handoff' ? 'Proposer le relais' : 'Confirmer'}</button><button type="button" onClick={() => setMode('')} className={controlClass}>Annuler</button></div>
    </form>}
    {error && <div role="alert" className="text-sm text-red-700">{error}<button onClick={refreshTask} className="ml-2 min-h-11 underline">Actualiser la tâche</button></div>}
  </>;
}

export function WorkActionControls({ action, returnTo = '/', compact = false, inTask = false, hideRedundantView = false }) {
  const controls = useWorkActionControls(action, { returnTo, inTask });
  if (action.state === 'done') return null;
  return <div className="space-y-2">
    <WorkActionButtons controls={controls} hideRedundantView={hideRedundantView} />
    <WorkActionPanel controls={controls} compact={compact} />
  </div>;
}

/** The title link: it opens the task without taking it. */
export function WorkTaskLink({ action, dossier, title, returnTo }) {
  return <Link to={workActionUrl(action, returnTo, dossier)} aria-label={`Ouvrir ${title} — ${dossier?.ref || 'dossier'}`} className="work-task-link">{title}</Link>;
}

/** What only some tasks carry, under their title in the table and the cards. */
export function WorkTaskDetails({ model, action, dossier, returnTo, notice }) {
  const { teamUsers = [] } = useApp();
  return <>
    {model.assigneeId && <p className="work-task-detail">Réalise la tâche : {staffName(model.assigneeId, teamUsers)}</p>}
    {model.waiting && <p className="work-task-detail"><strong>{model.waitingLabel} : </strong>{model.waiting}</p>}
    {notice && <p className="work-task-detail work-task-notice">{notice}</p>}
    {model.handoff && <p className="work-task-detail">Relais proposé à {staffName(model.handoff.to, teamUsers)} · acceptation attendue{model.handoff.note ? ` — ${model.handoff.note}` : ''}</p>}
    {action.kind === 'documents' && <div className="work-invoice"><InvoiceReviewIndicator dossier={dossier} returnTo={returnTo} /></div>}
    {model.note && <p className="work-task-detail whitespace-pre-wrap"><strong>Consigne de reprise : </strong>{model.note}</p>}
  </>;
}

/** Mon travail card: the same facts and commands as a table row. */
function WorkActionCard({ action, dossier, client, returnTo, now = Date.now(), notice, visibleKeys }) {
  const { auth } = useApp();
  const controls = useWorkActionControls(action, { returnTo });
  const panelId = useId();
  const model = workRowModel(action, dossier, client, { now, meId: auth?.u?.id });
  const shows = key => !visibleKeys || visibleKeys.includes(key);
  const facts = [shows('casier') && model.casier && `Casier ${model.casier}`, shows('cartons') && model.cartons && cartonCount(model.cartons)].filter(Boolean).join(' · ');
  return <article data-work-action={action.id} data-urgent={model.urgent ? 'true' : undefined} className="dossier-table-card work-card">
    <div className="work-card-heading">
      <h2 className="work-card-title"><WorkTaskLink action={action} dossier={dossier} title={model.title} returnTo={returnTo} /></h2>
      {model.state && <span className="dossier-pill" data-tone={model.state.tone}>{model.state.label}</span>}
    </div>
    {(shows('ref') || shows('client')) && <p className="work-card-identity">{shows('ref') && <strong className="work-ref">{model.ref}</strong>}{shows('ref') && shows('client') && ' · '}{shows('client') && model.client}</p>}
    {facts && <p className="work-card-facts">{facts}</p>}
    {shows('due') && model.due && <p className="work-due" data-urgent={model.due.urgent ? 'true' : undefined}><Clock size={15} aria-hidden="true" />{model.due.label}</p>}
    <WorkTaskDetails model={model} action={action} dossier={dossier} returnTo={returnTo} notice={notice} />
    {action.state !== 'done' && <div className="work-card-controls">
      <WorkActionButtons controls={controls} hideRedundantView panelId={panelId} className="work-actions" />
      {(controls.mode || controls.error) && <div id={panelId} data-work-action-panel={action.id} className="work-panel space-y-2"><WorkActionPanel controls={controls} compact /></div>}
    </div>}
  </article>;
}

/** A relay proposed to me: one compact line, its decision beside it. */
function WorkHandoffRow({ action, dossier, client, returnTo, now = Date.now() }) {
  const { auth, teamUsers = [] } = useApp();
  const controls = useWorkActionControls(action, { returnTo });
  const panelId = useId();
  const model = workRowModel(action, dossier, client, { now, meId: auth?.u?.id });
  return <li data-work-action={action.id} className="work-handoff-row">
    <p className="work-handoff-text"><WorkTaskLink action={action} dossier={dossier} title={model.title} returnTo={returnTo} /> · <span className="work-ref">{model.ref}</span> · {model.client}{action.assignee_id && <span className="work-handoff-from"> — proposé par {staffName(action.assignee_id, teamUsers)}{action.handoff_note ? ` : « ${action.handoff_note} »` : ''}</span>}</p>
    <WorkActionButtons controls={controls} hideRedundantView options={false} panelId={panelId} className="work-actions" />
    {(controls.mode || controls.error) && <div id={panelId} data-work-action-panel={action.id} className="work-panel space-y-2"><WorkActionPanel controls={controls} /></div>}
  </li>;
}

function WorkActionListRow({ action, dossier, client, returnTo, now = Date.now(), density = 'comfortable', compactLayout = false, notice }) {
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
        <p className="text-sm text-slate-600 break-words"><strong className="font-semibold text-slate-700">{dossier?.ref || 'Dossier à consulter'}</strong> · {(client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client'}{!compact && dossier ? ` · ${cartonCount(receptionCartonManifest(dossier).nbColis)} ${pluralWord(receptionCartonManifest(dossier).nbColis, 'reçu', 'reçus')}` : ''}</p>
        {(priority.urgent || action.due_at) && <p className={`text-xs ${priority.urgent ? 'text-amber-800 font-semibold' : 'text-slate-600'}`}><Clock size={13} className="inline mr-1" />{priority.reason}{action.due_at ? ` · ${workDate(action.due_at, { now })}` : ''}</p>}
      </div>
      {(action.assignee_id || action.handoff_to) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600"><span>Réalise la tâche : {action.assignee_id === auth?.u?.id ? 'vous' : staffName(action.assignee_id, teamUsers)}</span></div>}
      {/* Beside the « En attente » state the line gives the reason, not the state again. */}
      {waiting && <p className="text-sm text-slate-700"><strong>{action.state === 'waiting' ? 'Raison' : 'En attente'} : </strong>{waiting}{action.review_at ? ` · À revoir le ${workDate(action.review_at, { now })}` : ''}</p>}
      {notice && <p className="text-sm text-amber-800">{notice}</p>}
      {action.handoff_to && <p className="text-sm text-slate-700">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue{action.handoff_note ? ` — ${action.handoff_note}` : ''}</p>}
      {action.kind === 'documents' && <InvoiceReviewIndicator dossier={dossier} returnTo={returnTo} />}
      {!action.handoff_to && action.handoff_note && <p className="whitespace-pre-wrap text-sm text-slate-700"><strong>Consigne de reprise : </strong>{action.handoff_note}</p>}
    </div>
    <div className={compact ? 'lg:!mt-2 lg:max-w-sm' : ''}><WorkActionControls action={action} returnTo={returnTo} compact={compact} /></div>
  </article>;
}

/** `card` and `handoff` belong to Mon travail; the team view keeps the list row. */
export default function WorkActionRow({ variant, ...props }) {
  if (variant === 'card') return <WorkActionCard {...props} />;
  if (variant === 'handoff') return <WorkHandoffRow {...props} />;
  return <WorkActionListRow {...props} />;
}

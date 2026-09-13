import React from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { WORK_KINDS, WORK_STATES, sortWorkActions } from '../../domain/personalWork';
import { WorkActionControls, staffName } from './WorkActionRow';

export default function DossierWorkPanel({ dossier }) {
  const { sel, workActions = [], teamUsers = [] } = useApp();
  const location = useLocation();
  const current = dossier || sel;
  const rows = sortWorkActions(workActions.filter(action => action.colis_id === current?.id && action.state !== 'done'));
  if (!rows.length) return null;
  return <section className="rounded-xl border border-slate-200 p-4 space-y-4"><h2 className="font-semibold text-sm">Actions de l’équipe</h2>{rows.map(action => <div key={action.id} className="space-y-2 border-t border-slate-100 pt-3"><p className="text-sm font-semibold">{action.action_hint || WORK_KINDS[action.kind]?.label} · {WORK_STATES[action.state]}</p><p className="text-xs text-slate-600">Responsable de cette action : {staffName(action.assignee_id, teamUsers)}</p>{(action.blocked_reason || action.waiting_reason) && <p className="text-xs text-slate-600">{action.blocked_reason || action.waiting_reason}</p>}{action.handoff_to && <p className="text-xs text-amber-800">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue</p>}<WorkActionControls action={action} returnTo={location.pathname + location.search} compact /></div>)}</section>;
}

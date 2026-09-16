import React from 'react';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Badge } from '../ui';
import { receptionCartonManifest } from '../../domain/reception';
import { workspaceReturnPath } from '../../domain/navigation';
import { DOSSIER_TASKS, dossierTaskUrl } from '../../domain/dossierTasks';

export default function DetailHeader({ task, onOpenContext }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sel, selClient, selDest, isStaff, teamUsers = [], can } = useApp();
  if (!sel) return null;

  if (isStaff && task) {
    const unread = (sel.messages || []).filter(message => message.type === 'client' && !message.lu).length;
    const showDocuments = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => can(permission));
    const showQuote = ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_finances_voir_total'].some(permission => can(permission));
    const tasks = Object.entries(DOSSIER_TASKS).filter(([key]) => key === task || (key !== 'documents' || showDocuments) && (key !== 'devis' || showQuote));
    return <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-3 sm:px-6 dark:border-slate-700 dark:bg-slate-900" data-testid="dossier-task-header">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 sm:gap-3">
        <button aria-label="Retour à la liste de travail" onClick={() => navigate(workspaceReturnPath(location.search))} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><ArrowLeft size={21} /></button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-200">{sel.ref}</span><h1 className="text-base font-bold text-slate-900 dark:text-white">{DOSSIER_TASKS[task]?.label || 'Dossier'}</h1></div>
          <p className="truncate text-xs text-slate-600 dark:text-slate-300">{selClient?.nom || 'Client'}{selDest ? ` · ${selDest.label || selDest.nom}` : ''}</p>
        </div>
        <button onClick={() => onOpenContext?.('reception')} aria-haspopup="dialog" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><PanelRightOpen size={17} />Contexte{unread > 0 && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800" aria-label={`${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`}>{unread}</span>}</button>
        <div className="flex w-full items-center justify-between gap-3 pl-12 sm:w-auto sm:pl-0">
          {(sel.archive || ['annule','livre','refuse_client'].includes(sel.statut)) && <Badge statut={sel.statut} />}
          <label className="min-w-0"><span className="sr-only">Tâche du dossier</span><select value={task} aria-label="Tâche du dossier" onChange={event => navigate(dossierTaskUrl(sel.id, event.target.value, location.search))} className="min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">{tasks.map(([key, definition]) => <option key={key} value={key}>{definition.label}</option>)}</select></label>
        </div>
      </div>
    </header>;
  }

  return (
    <div
      className="border-b border-white border-opacity-5 px-4 py-3.5 flex items-center gap-3 sticky top-0 z-20"
      style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}
    >
      <button aria-label="Retour à la liste de travail" onClick={() => navigate(workspaceReturnPath(location.search))} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white font-bold text-lg p-1 hover:bg-white hover:bg-opacity-10 rounded-xl transition-all">
        <ArrowLeft size={22} />
      </button>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="font-mono text-white">{sel.ref}</b>
          <Badge statut={sel.statut} />
          {selDest && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-white bg-opacity-20 text-white">
              {selDest.flag} {selDest.label}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-300">
          {isStaff && selClient ? `${selClient.nom} · ` : ''}{receptionCartonManifest(sel).nbColis} carton(s) reçus{sel.casier ? ` · Casier ${sel.casier}` : ''}
        </p>
        {isStaff && <p className="mt-1 text-xs text-gray-300">Référent : {teamUsers.find((person) => person.authId === sel.responsibleStaffId)?.nom || 'À attribuer'}</p>}
      </div>
    </div>
  );
}

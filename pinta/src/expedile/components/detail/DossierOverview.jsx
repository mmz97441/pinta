import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Clock, AlertTriangle, Lock, Circle, Minus, Pencil, Package, Ruler, FileText, CalendarClock } from 'lucide-react';
import { formatDossierTableDate } from '../../domain/dossierTable';
import { plural } from '../../domain/plural';
import CasierEditor from './CasierEditor';
import './dossierOverview.css';

// `planned`: a departure is assigned before the expedition is the current step;
// the step names it (« Prévu le jeudi 8 octobre », the model's stateLabel).
const STEP_STATES = {
  done: { label: 'Terminé', icon: Check },
  current: { label: 'À faire', icon: Circle },
  planned: { label: 'Prévu', icon: CalendarClock },
  waiting: { label: 'En attente', icon: Clock },
  upcoming: { label: 'À venir', icon: Circle },
  review: { label: 'À revoir', icon: AlertTriangle },
  unknown: { label: 'À vérifier', icon: AlertTriangle },
  restricted: { label: 'Accès réservé', icon: Lock },
  not_required: { label: 'Non nécessaire', shortLabel: 'Sans objet', icon: Minus },
};
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const positive = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;

function dimensions(boxes) {
  if (boxes?.length !== 1) return null;
  const box = boxes[0];
  if (![box.dimL, box.dimW, box.dimH].every(positive)) return null;
  return `${numberFormat.format(box.dimL)} × ${numberFormat.format(box.dimW)} × ${numberFormat.format(box.dimH)} cm`;
}

// In-page actions: each opens a step, an editor or the details panel of this
// page, never another site, so no external-link arrow.
function OverviewAction({ onClick, label, children }) {
  if (!onClick) return null;
  return <button type="button" className="dossier-overview-link" aria-label={label} onClick={onClick}>{children}</button>;
}

function ReceivedCartonArrival({ box }) {
  return <li data-received-carton={box.number}>
    <span className="dossier-overview-tracking-label">Carton {box.number}</span>
    <span className="dossier-overview-tracking-number">{box.tracking || 'Suivi non renseigné'}</span>
    {box.receivedAt ? <span className="dossier-overview-arrival-date">Reçu le <time dateTime={box.receivedAt}>{formatDossierTableDate(box.receivedAt)}</time></span>
      : <span className="dossier-overview-secondary">Date non renseignée</span>}
  </li>;
}

// Le résumé contient souvent déjà la date (« Prévu le 17/10/2026 ») : ne pas la répéter.
function stepDateLabel(step) {
  if (!step?.date) return '';
  const label = formatDossierTableDate(step.date);
  return step.summary?.includes(label) ? '' : label;
}

function Step({ step, viewedTask, onNavigateTask, summaryId }) {
  const state = STEP_STATES[step.state] || STEP_STATES.unknown;
  const Icon = state.icon;
  const viewed = viewedTask === step.id;
  const content = <>
    <span className="dossier-overview-step-label">{step.label}</span>
    <span className="dossier-overview-step-state"><Icon size={14} aria-hidden="true" />{step.stateLabel || state.shortLabel || state.label}</span>
  </>;
  const title = [step.summary, stepDateLabel(step)].filter(Boolean).join(' · ');
  return <li data-step={step.id} data-state={step.state}>
    {step.canOpen && onNavigateTask ? <button type="button" className="dossier-overview-step"
      aria-current={viewed ? 'step' : undefined}
      aria-label={`Consulter l’étape ${step.label} — ${step.stateLabel || state.label}`}
      aria-describedby={viewed ? summaryId : undefined}
      title={title || undefined} onClick={() => onNavigateTask(step.id)}>{content}</button>
      : <div className="dossier-overview-step dossier-overview-step-readonly" title={title || undefined}>{content}</div>}
  </li>;
}

/** A factual overview. Every action only opens an existing screen/editor;
 * reading an earlier step never changes the dossier or sends a notification.
 * `departure` is the dossier's « Départ » line, next to Casier; `departureEditor`,
 * its open editor, follows the heading's actions so the focus order matches the
 * layout. « Modifier » next to Casier opens its editor in place, like the
 * Départ field, at the same position (after the heading's actions). */
export default function DossierOverview({
  dossier, model, currentTask: viewedTask, onNavigateTask, onOpenContext, onCorrect,
  canEditCasier = false, canEditReception = false, canEditPreparation = false, canEditQuote = false, departure = null, departureEditor = null,
}) {
  const [casierEditing, setCasierEditing] = useState(false);
  const casierButton = useRef(null);
  const casierWasEditing = useRef(false);
  const casierEditorId = useId();
  const casierOpen = casierEditing && canEditCasier;
  useEffect(() => { casierWasEditing.current = false; setCasierEditing(false); }, [dossier?.id]);
  // Closing the editor (saved or cancelled) gives the focus back to « Modifier ».
  useEffect(() => {
    if (casierOpen) { casierWasEditing.current = true; return; }
    if (casierWasEditing.current) casierButton.current?.focus();
    casierWasEditing.current = false;
  }, [casierOpen]);
  if (!dossier || !model) return null;
  const received = model.received || {};
  const optimization = model.optimization || {};
  const invoices = model.invoices || {};
  const steps = model.steps || [];
  const canOpen = task => steps.some(step => step.id === task && step.canOpen);
  const openTask = task => canOpen(task) && onNavigateTask ? () => onNavigateTask(task) : undefined;
  const openContext = section => onOpenContext ? () => onOpenContext(section) : undefined;
  const editReception = canEditReception && onCorrect && canOpen('reception');
  const editPreparation = canEditPreparation && onCorrect && canOpen('preparation');
  const receivedDimensions = dimensions(received.boxes);
  const optimizedDimensions = dimensions(optimization.boxes);
  const receivedBoxes = received.boxes || [];
  const visibleBoxes = receivedBoxes.slice(0, 2);
  const remainingBoxes = receivedBoxes.slice(2);
  const alerts = model.alerts || [];
  const openedStep = steps.find(step => step.id === viewedTask);
  const openedStepSummaryId = `dossier-overview-opened-${dossier.id}`;

  // Three stable groups: who (reference), what (Casier, Départ), where to go
  // (open step, history). A group wraps whole, never one link alone.
  return <section aria-label="Vue d’ensemble du dossier" data-testid="dossier-overview" className="dossier-overview">
    <div className="dossier-overview-heading">
      <div className="dossier-overview-identity"><h2>Vue d’ensemble</h2><span data-overview="reference">{model.reference || dossier.ref}</span></div>
      <div className="dossier-overview-fields">
        <div className="dossier-overview-casier" data-overview="casier"><span>Casier <strong>{model.casier || 'à renseigner'}</strong></span>
          {canEditCasier && <button ref={casierButton} type="button" className="dossier-overview-casier-edit" aria-label="Modifier le casier du dossier"
            aria-expanded={casierOpen} aria-controls={casierOpen ? casierEditorId : undefined} onClick={() => setCasierEditing(editing => !editing)}>
            <Pencil size={14} aria-hidden="true" /><span>Modifier</span>
          </button>}
        </div>
        {departure}
      </div>
      <div className="dossier-overview-links">
        {canOpen(viewedTask) && <OverviewAction onClick={openTask(viewedTask)}>Aller à l’étape ouverte</OverviewAction>}
        <OverviewAction onClick={openContext('historique')} label="Consulter l’historique du dossier">Historique</OverviewAction>
      </div>
      {casierOpen && <CasierEditor id={casierEditorId} variant="summary" onDone={() => setCasierEditing(false)} />}
      {departureEditor}
    </div>

    <div className="dossier-overview-facts">
      <div className="dossier-overview-fact" data-overview="received">
        <h3><Package size={15} aria-hidden="true" />À réception</h3>
        <p className="dossier-overview-summary">{received.summary || 'Réception à vérifier'}</p>
        {received.date && <p className="dossier-overview-secondary">Réception du dossier : <time dateTime={received.date}>{formatDossierTableDate(received.date)}</time></p>}
        <p className="dossier-overview-weight">{positive(received.totalWeight) ? `${numberFormat.format(received.totalWeight)} kg reçus` : 'Poids à compléter'}</p>
        {receivedDimensions && <p className="dossier-overview-secondary">{receivedDimensions}</p>}
        <OverviewAction onClick={editReception ? () => onCorrect('reception') : openContext('reception') || openTask('reception')}
          label={editReception ? 'Modifier les mesures à réception' : 'Consulter les cartons et les mesures à réception'}>{editReception ? 'Modifier les mesures' : 'Consulter'}</OverviewAction>
      </div>
      <div className="dossier-overview-fact" data-overview="optimization">
        <h3><Ruler size={15} aria-hidden="true" />Après optimisation</h3>
        <p className="dossier-overview-summary">{optimization.summary || 'Optimisation à faire'}</p>
        <p className="dossier-overview-weight">{positive(optimization.totalWeight) ? `${numberFormat.format(optimization.totalWeight)} kg ${optimization.current ? 'après optimisation' : 'enregistrés · à vérifier'}` : 'Poids à compléter'}</p>
        {optimizedDimensions && <p className="dossier-overview-secondary">{optimizedDimensions}</p>}
        <OverviewAction onClick={editPreparation ? () => onCorrect('preparation') : openTask('preparation')}
          label={editPreparation ? 'Modifier les mesures après optimisation' : 'Consulter les mesures après optimisation'}>{editPreparation ? 'Modifier les mesures' : 'Consulter'}</OverviewAction>
      </div>
      <div className="dossier-overview-fact dossier-overview-invoices" data-overview="invoices">
        <div><h3><FileText size={15} aria-hidden="true" />Factures</h3>
          <p className="dossier-overview-summary">{invoices.visible ? invoices.summary || `${plural(invoices.receivedCount || 0, 'facture reçue', 'factures reçues')} · ${plural(invoices.validatedCount || 0, 'validée')}` : 'Accès réservé'}</p>
        </div>
        {invoices.visible && <OverviewAction onClick={openTask('documents') || openContext('documents')} label="Consulter les factures du dossier">Consulter</OverviewAction>}
      </div>
    </div>

    <div className="dossier-overview-trackings" data-overview="trackings">
      <h3 className="dossier-overview-arrivals-title">Arrivées à l’entrepôt</h3>
      {received.datesError && <p role="status" className="dossier-overview-secondary">Anciennes dates indisponibles. Actualisez le dossier.</p>}
      {visibleBoxes.length ? <ul>{visibleBoxes.map(box => <ReceivedCartonArrival key={box.number} box={box} />)}</ul> : <span className="dossier-overview-secondary">Aucun carton renseigné</span>}
      {remainingBoxes.length > 0 && <details className="dossier-overview-more-arrivals"><summary>{remainingBoxes.length === 1 ? 'Voir l’autre carton' : `Voir les ${remainingBoxes.length} autres cartons`}</summary><ul>{remainingBoxes.map(box => <ReceivedCartonArrival key={box.number} box={box} />)}</ul></details>}
      {canEditQuote && onCorrect && canOpen('devis') && <OverviewAction onClick={() => onCorrect('devis')} label="Modifier le devis et les taux">Modifier le devis et les taux</OverviewAction>}
    </div>

    {alerts.length > 0 && <details className="dossier-overview-alerts">
      <summary><AlertTriangle size={15} aria-hidden="true" /><span>{alerts[0].message}{alerts.length > 1 ? ` · ${plural(alerts.length - 1, 'autre point', 'autres points')} à vérifier` : ''}</span></summary>
      <ul>{alerts.map((alert, index) => <li key={alert.code || index}><span>{alert.message}</span>{canOpen(alert.task) && <OverviewAction onClick={openTask(alert.task)} label={`Vérifier : ${alert.message}`}>Vérifier</OverviewAction>}</li>)}</ul>
    </details>}

    <nav aria-label="Parcours du dossier" className="dossier-overview-path">
      <ol>{steps.map(step => <Step key={step.id} step={step} viewedTask={viewedTask} onNavigateTask={onNavigateTask} summaryId={openedStep ? openedStepSummaryId : undefined} />)}</ol>
    </nav>
    {openedStep && <p id={openedStepSummaryId} data-overview="opened-step" className="dossier-overview-opened-step">
      <strong>Étape ouverte : {openedStep.label}.</strong>{' '}{openedStep.summary || STEP_STATES[openedStep.state]?.label}
      {stepDateLabel(openedStep) && <>{' · '}<time dateTime={openedStep.date}>{stepDateLabel(openedStep)}</time></>}
    </p>}
  </section>;
}

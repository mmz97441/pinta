import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowRight, MessageCircle, Filter, AlertTriangle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { getDestByCP, getSecteurByCP } from '../../constants';
import { actionWaiting, canWorkAction, staffAvailable, workActionOpensClient } from '../../domain/personalWork';
import { receptionCartonManifest } from '../../domain/reception';
import { needsConversationAction } from '../../domain/conversations';
import { TABLE_COLUMNS, dossierTableAmount, dossierTableAmountState, dossierTableMissingAmountLabel, formatDossierTableDate, isDossierTableColumnSortable, dossierTableSortDirectionLabel, parallelTasksLabel, dossierFactHasValue, REQUEST_NOT_SENT_LABEL, NO_RELANCE_LABEL } from '../../domain/dossierTable';
import { clampColumnWidth, columnWidthBounds } from '../../domain/dossierTablePreferences';
import { consentTone, paymentTone, statusTone } from '../../domain/dossierTableTone';
import { consentRelance, consentState, consentWaitLabel } from '../../domain/consentQueue';
import { clientDisplayName } from '../../domain/clientGroups';
import { SelectionCheckbox } from './DossierGroupHeader';
import { dossierAlertsLabel } from '../../domain/dossierAlerts';
import TaskTakeButton from '../workspace/TaskTakeButton';
import InvoiceReviewIndicator from '../ui/InvoiceReviewIndicator';
import './dossierTable.css';

export const TABLE_VIEWS = [
  { key: 'daily', label: 'Travail quotidien' },
  { key: 'payments', label: 'Paiements' },
  { key: 'departures', label: 'Départs' },
  // The one view that lists only some dossiers: those whose consent is to obtain.
  { key: 'accords', label: 'Accords clients' },
];

export { TABLE_COLUMNS };
const referenceColumn = TABLE_COLUMNS.daily.find(column => column.key === 'ref');

const moneyFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const stopPropagation = event => event.stopPropagation();

/** The tone only helps scanning; the text stays exactly the state label. */
function Pill({ tone, children }) {
  return <span className="dossier-pill" data-tone={tone}>{children}</span>;
}

/** Missing facts stay readable but quieter than recorded values. */
function Placeholder({ children }) {
  return <span className="dossier-table-placeholder">{children}</span>;
}
const PLACEHOLDERS = new Set(['Non renseigné', 'Non attribué', 'À renseigner', '—', REQUEST_NOT_SENT_LABEL, NO_RELANCE_LABEL]);
const Fact = ({ children }) => PLACEHOLDERS.has(children) ? <Placeholder>{children}</Placeholder> : <span>{children}</span>;
/** A saved instant on the table's calendar, or a quiet `empty` wording
 * (« Non renseigné » by default). */
function TableDate({ value, empty = formatDossierTableDate(null) }) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{formatDossierTableDate(value)}</time> : <Fact>{empty}</Fact>;
}

function money(value, missingLabel) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? missingLabel : moneyFormatter.format(Number(value));
}

function ClientIdentity({ client }) {
  // « Payet Flavie », the same name as the client band of a grouped list.
  const name = clientDisplayName(client) || 'Client non renseigné';
  // An absent or foreign postcode must not invent a Réunion destination.
  const knownDestination = /^(971|972|974|976)/.test(String(client?.cp || '').trim());
  const destination = knownDestination ? getDestByCP(client.cp) : null;
  const sector = getSecteurByCP(client?.cp);
  const zone = [destination?.label, sector ? sector[0] + sector.slice(1).toLowerCase() : ''].filter(Boolean).join(' · ');
  return <div>
    <span className="dossier-table-client-name">{name}</span>
    {zone && <span className="dossier-table-secondary">{zone}</span>}
  </div>;
}

/** « Le dossier a changé. Actualisez les tâches. »: the tasks are refreshed
 * right there, with the same command as the page's own reload. */
function RefreshTasksButton() {
  const { refreshWork } = useApp();
  const [state, setState] = useState('idle');
  const refresh = async () => {
    if (state === 'busy') return;
    setState('busy');
    try { await refreshWork(); setState('idle'); } catch { setState('error'); }
  };
  return <span className="dossier-table-refresh" onClick={stopPropagation}>
    <button type="button" disabled={state === 'busy'} onClick={refresh}>
      <RefreshCw size={14} aria-hidden="true" className={state === 'busy' ? 'animate-spin' : undefined} />{state === 'busy' ? 'Actualisation…' : 'Actualiser les tâches'}
    </button>
    {state === 'error' && <span role="alert" className="dossier-table-refresh-error">Les tâches n’ont pas pu être actualisées. Réessayez.</span>}
  </span>;
}

function TaskSummary({ model, c, returnTo }) {
  return <div>
    <span className="dossier-table-task-title">{model.title || 'Consulter le dossier'}</span>
    {model.detail && <span className="dossier-table-secondary">{model.detail}</span>}
    {model.refreshable && <RefreshTasksButton />}
    {model.otherActionsCount > 0 && <span className="dossier-table-secondary">{parallelTasksLabel(model.otherActionsCount)}</span>}
    <InvoiceReviewIndicator dossier={c} returnTo={returnTo} />
  </div>;
}

/** The row and its reference open the dossier; this button opens the task.
 * Taking a task always uses the atomic action. */
function MainAction({ action, dossier, onOpen, title }) {
  const { auth, can, workPreferences = [] } = useApp();
  const own = Boolean(action?.assignee_id && action.assignee_id === auth?.u?.id);
  const allowed = Boolean(action && canWorkAction(action, can));
  const waiting = Boolean(action && actionWaiting(action));
  const available = own || staffAvailable(workPreferences.find(preference => preference.staff_id === auth?.u?.id));
  const canTake = allowed && action.state === 'ready' && !waiting && available && (!action.assignee_id || own);
  const canContinue = allowed && own && action.state === 'in_progress' && !waiting;
  // A task worked on another page says where it leads.
  const openLabel = workActionOpensClient(action, dossier) ? 'Ouvrir la fiche client' : canContinue ? 'Continuer' : 'Consulter';
  return <div className="dossier-table-action" onClick={stopPropagation}>
    {title && <p className="dossier-table-action-title" title={title}>{title}</p>}
    {canTake
      ? <TaskTakeButton action={action} onClaim={saved => onOpen?.(saved)} />
      : <button type="button" className={`dossier-table-open${canContinue ? ' dossier-table-open-primary' : ''}`} onClick={() => onOpen?.(action)}>
        {openLabel}<ArrowRight size={16} aria-hidden="true" />
      </button>}
  </div>;
}

/** Something is « À vérifier » on this dossier: the mark names it for
 * assistive technology and on hover; the dossier page shows each line with its
 * link. It is not a tab stop: the reference opens the dossier. */
function AlertMark({ alerts }) {
  if (!alerts?.length) return null;
  const label = dossierAlertsLabel(alerts);
  return <span className="dossier-table-alert" role="img" aria-label={label} title={label}><AlertTriangle aria-hidden="true" /></span>;
}

function CellContent({ column, c, client, model, alerts, onOpen, onOpenDossier, returnTo, showActionTitle }) {
  switch (column.key) {
    case 'ref': return <div>
      <button type="button" className="dossier-table-reference" onClick={event => { event.stopPropagation(); onOpenDossier?.(); }}>{c.ref || 'Sans référence'}</button>
      <AlertMark alerts={alerts} />
      {model.action?.kind !== 'conversation' && needsConversationAction(c) && <Link className="dossier-table-message" aria-label={`Message client à traiter — ${c.ref}`} to={`/colis/${encodeURIComponent(c.id)}?${new URLSearchParams({ onglet: 'conversation', returnTo: returnTo || '/colis' })}`} onClick={stopPropagation}><MessageCircle size={14} aria-hidden="true" />À répondre</Link>}
    </div>;
    case 'client': return <ClientIdentity client={client} />;
    case 'statusLabel': return <Pill tone={statusTone(c, model)}>{model.statusLabel || 'Statut à vérifier'}</Pill>;
    case 'paymentState': return <Pill tone={paymentTone(model)}>{model.payment?.stateLabel || 'À vérifier'}</Pill>;
    case 'optimizedDimensions': return model.optimized ? <span className="dossier-table-dimensions">{(model.optimizedDimensions || []).map((dimensions, index) => <span key={index}>{dimensions}</span>)}</span> : null;
    case 'optimizedWeight': return model.optimizedWeight == null ? null : <span>{Number(model.optimizedWeight).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</span>;
    case 'statut': return <TaskSummary model={model} c={c} returnTo={returnTo} />;
    case 'owner': return <Fact>{model.ownerName || 'Non attribué'}</Fact>;
    case 'casier': return <Fact>{c.casier || 'À renseigner'}</Fact>;
    case 'cartons': return <span>{receptionCartonManifest(c).nbColis}</span>;
    case 'requested': {
      const amount = dossierTableAmount(model, column), state = dossierTableAmountState(model, column);
      return <div><span className="dossier-table-money">{money(amount, state || dossierTableMissingAmountLabel(model.payment, 'requested'))}</span>{amount !== null && state && <span className="dossier-table-secondary">{state}</span>}</div>;
    }
    case 'paid':
      // Nothing is due before the quote: no « 0,00 € » beside « À calculer ».
      if (model.payment?.requested == null && model.payment?.paid === 0) return <Fact>—</Fact>;
      return <span className="dossier-table-money">{money(model.payment?.paid, dossierTableMissingAmountLabel(model.payment, 'paid'))}</span>;
    case 'remaining': {
      const amount = money(model.payment?.remaining, dossierTableMissingAmountLabel(model.payment, 'remaining'));
      return <div><span className="dossier-table-money dossier-table-task-title">{amount}</span>{model.payment?.detailLabel && model.payment.detailLabel !== amount && <span className="dossier-table-secondary">{model.payment.detailLabel}</span>}</div>;
    }
    case 'receivedAt': return <div>{model.reception?.lastReceivedAt ? <time dateTime={model.reception.lastReceivedAt}>{formatDossierTableDate(model.reception.lastReceivedAt)}</time> : <Fact>{formatDossierTableDate(null)}</Fact>}{model.reception && !model.reception.complete && <span className="dossier-table-secondary">{model.reception.knownCount} / {model.reception.totalCount} cartons datés</span>}</div>;
    case 'sentAt': return <TableDate value={model.payment?.sentAt} />;
    case 'consentState': {
      // A dated wait that has ended reads « Attente terminée · le 25/10 · à réexaminer ».
      const consent = model.consent ?? consentState(c);
      const end = consent && consentWaitLabel(consent.until, { over: consent.over });
      return consent && <div><Pill tone={consent.over ? 'review' : consentTone(consent.stage)}>{consent.label}</Pill>{end && <span className="dossier-table-secondary">{end}</span>}</div>;
    }
    case 'consentRequestedAt': return <TableDate value={c.demandeFeuVertEnvoyeeAt} empty={REQUEST_NOT_SENT_LABEL} />;
    case 'lastRelanceAt': {
      // A relance not yet confirmed says where it stands, never reads as sent.
      const relance = model.relance ?? consentRelance(c);
      if (!relance) return <Fact>{NO_RELANCE_LABEL}</Fact>;
      return <div><TableDate value={relance.at} />{relance.deliveryLabel && <span className="dossier-table-secondary">{relance.deliveryLabel}</span>}</div>;
    }
    case 'departure': return <span>{model.departure?.label || 'À choisir'}</span>;
    case 'destination': return <Fact>{model.departure?.destination || 'À renseigner'}</Fact>;
    case 'packages': return <span>{model.departure?.packagesLabel || 'À préparer'}</span>;
    case 'readiness': return <span>{model.departure?.readinessLabel || 'À vérifier'}</span>;
    case 'action': return <MainAction action={model.action} dossier={c} onOpen={onOpen} title={showActionTitle ? model.title : undefined} />;
    default: return null;
  }
}


function ColumnResize({ column, width, onResize }) {
  const drag = useRef(null);
  const { min, max, initial } = columnWidthBounds(column);
  const currentWidth = clampColumnWidth(column, width);
  return <button type="button" role="separator" aria-orientation="vertical" aria-label={`Redimensionner ${column.label}`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={currentWidth} aria-valuetext={`${currentWidth} pixels`} title={`Largeur de ${column.label} : glisser ce bord. Double-clic ou Entrée pour rétablir ; flèches gauche/droite pour régler.`}
    className="dossier-table-resize" onClick={stopPropagation}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onResize(column, initial); }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); drag.current = { x: event.clientX, width: currentWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) onResize(column, drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => { const step = event.shiftKey ? 50 : 10; const value = { ArrowLeft: currentWidth - step, ArrowRight: currentWidth + step, Home: min, End: max, Enter: initial }[event.key]; if (value !== undefined) { event.preventDefault(); event.stopPropagation(); onResize(column, value); } }}><span aria-hidden="true" className="dossier-table-resize-line" /></button>;
}

/** `selection` of the displayed dossiers: 'all', 'some' (a mixed checkbox) or 'none'. */
export function DossierTableHead({ columns = TABLE_COLUMNS.daily, onSelectAll, selection = 'none', onSort, sortCol, sortDir, widths, onResize, filters = {}, onFilterColumn, openFilterKey = null }) {
  return <tr className="dossier-table-head">
    <th scope="col" className="dossier-table-select" data-column="select">
      <label className="dossier-table-checkbox"><SelectionCheckbox aria-label="Sélectionner tous les dossiers affichés" selection={selection} onChange={onSelectAll} /></label>
    </th>
    {columns.map(column => <th key={column.key} scope="col" data-column={column.key} data-column-label={column.label}
      className={column.align === 'right' ? 'dossier-table-align-right' : undefined}
      aria-sort={isDossierTableColumnSortable(column) ? sortCol === column.key ? sortDir === 'desc' ? 'descending' : 'ascending' : 'none' : undefined}>
      <div className="dossier-table-heading-label">{isDossierTableColumnSortable(column) && onSort ? <button type="button" className="dossier-table-sort" aria-label={column.label} onClick={() => onSort(column.key)}
        title={`Trier ${column.label} : ${dossierTableSortDirectionLabel(column, sortCol === column.key && sortDir === 'asc' ? 'desc' : 'asc')}`}>
        <span className="dossier-table-heading-text" title={column.label}>{column.shortLabel || column.label}</span>{sortCol === column.key ? sortDir === 'desc' ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" /> : <ArrowUpDown size={14} aria-hidden="true" className="dossier-table-sort-idle" />}
      </button> : <span className="dossier-table-heading-text" title={column.label}>{column.shortLabel || column.label}</span>}
      {isDossierTableColumnSortable(column) && onFilterColumn && <button type="button" className="dossier-table-filter" aria-label={`Filtrer la colonne ${column.label}`} aria-pressed={Boolean(filters[column.key])} aria-haspopup="dialog" aria-expanded={openFilterKey === column.key} aria-controls={openFilterKey === column.key ? 'dossier-column-dialog' : undefined} title={`${filters[column.key] ? 'Modifier le filtre' : 'Filtrer'} : ${column.label}`} onClick={event => onFilterColumn(column.key, event.currentTarget)}><Filter size={14} aria-hidden="true" /></button>}</div>
      {onResize && <ColumnResize column={column} width={widths?.[column.key]} onResize={onResize} />}
    </th>)}
  </tr>;
}

/** `onOpenDossier()` opens the dossier itself (row and reference);
 * `onOpen(action)` opens a task (action button). `alerts` are the dossier's
 * « À vérifier » lines, marked next to the reference. */
export function DossierTableRow({ c, client, model = {}, alerts, columns = TABLE_COLUMNS.daily, checked, onCheck, onOpen, onOpenDossier, returnTo }) {
  const showActionTitle = !columns.some(column => column.key === 'statut');
  return <tr className="dossier-table-row dossier-list-item" data-dossier-row={c.id} data-selected={checked ? 'true' : 'false'} onClick={() => onOpenDossier?.()}>
    <td className="dossier-table-select" data-column="select" onClick={stopPropagation}>
      <label className="dossier-table-checkbox"><input type="checkbox" aria-label={`Sélectionner le dossier ${c.ref}`} checked={Boolean(checked)} onChange={onCheck} /></label>
    </td>
    {columns.map(column => <td key={column.key} data-column={column.key} className={column.align === 'right' ? 'dossier-table-align-right' : undefined}>
      <CellContent column={column} c={c} client={client} model={model} alerts={alerts} onOpen={onOpen} onOpenDossier={onOpenDossier} returnTo={returnTo} showActionTitle={showActionTitle} />
    </td>)}
  </tr>;
}

// The pill beside a card's reference: the dossier status, or its « Accord » in « Accords clients ».
const HEADING_STATUS_KEYS = ['statusLabel', 'consentState'];

export function DossierTableCard({ c, view, client, model = {}, alerts, columns = TABLE_COLUMNS.daily, checked, onCheck, onOpen, onOpenDossier, returnTo }) {
  const statusColumn = columns.find(column => HEADING_STATUS_KEYS.includes(column.key));
  // A fact without value (no final weight before the optimisation) is left out.
  const facts = columns.filter(column => !['ref', 'client', 'statut', 'action', ...HEADING_STATUS_KEYS].includes(column.key) && dossierFactHasValue(column, model));
  const showActionTitle = !columns.some(column => column.key === 'statut');
  return <article className="dossier-table-card dossier-list-item" aria-label={`Dossier ${c.ref}`} data-view={view || (columns === TABLE_COLUMNS.daily ? 'daily' : undefined)} data-dossier-card={c.id} data-dossier-row={c.id} data-selected={checked ? 'true' : 'false'}>
    <div className="dossier-table-card-heading">
      <label className="dossier-table-checkbox"><input type="checkbox" aria-label={`Sélectionner le dossier ${c.ref}`} checked={Boolean(checked)} onChange={onCheck} /></label>
      <div data-column="ref"><CellContent column={referenceColumn} c={c} model={model} alerts={alerts} onOpenDossier={onOpenDossier} returnTo={returnTo} /></div>
      {statusColumn && <div data-column={statusColumn.key} className="dossier-table-card-status"><CellContent column={statusColumn} c={c} model={model} /></div>}
    </div>
    {columns.some(column => column.key === 'client') && <div data-column="client"><ClientIdentity client={client} /></div>}
    {columns.some(column => column.key === 'statut') && <div data-column="statut" className="dossier-table-card-task"><TaskSummary model={model} c={c} returnTo={returnTo} /></div>}
    {columns.some(column => column.key === 'action') && <div data-column="action" className="dossier-table-card-main-action"><MainAction action={model.action} dossier={c} onOpen={onOpen} title={showActionTitle ? model.title : undefined} /></div>}
    {facts.length > 0 && <dl className="dossier-table-card-facts">{facts.map(column => <div key={column.key} data-column={column.key}>
      <dt>{column.label}</dt><dd><CellContent column={column} c={c} client={client} model={model} onOpen={onOpen} /></dd>
    </div>)}</dl>}
  </article>;
}

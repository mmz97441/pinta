import React, { useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowRight, MessageCircle, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { getDestByCP, getSecteurByCP } from '../../constants';
import { actionWaiting, canWorkAction, staffAvailable } from '../../domain/personalWork';
import { receptionCartonManifest } from '../../domain/reception';
import { needsConversationAction } from '../../domain/conversations';
import { TABLE_COLUMNS, dossierTableAmount, dossierTableAmountState, dossierTableMissingAmountLabel, formatDossierTableDate, isDossierTableColumnSortable, dossierTableSortDirectionLabel } from '../../domain/dossierTable';
import { clampColumnWidth, columnWidthBounds } from '../../domain/dossierTablePreferences';
import { paymentTone, statusTone } from '../../domain/dossierTableTone';
import TaskTakeButton from '../workspace/TaskTakeButton';
import InvoiceReviewIndicator from '../ui/InvoiceReviewIndicator';
import './dossierTable.css';

export const TABLE_VIEWS = [
  { key: 'daily', label: 'Travail quotidien' },
  { key: 'payments', label: 'Paiements' },
  { key: 'departures', label: 'Départs' },
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
const PLACEHOLDERS = new Set(['Non renseigné', 'Non attribué', 'À renseigner', '—']);
const Fact = ({ children }) => PLACEHOLDERS.has(children) ? <Placeholder>{children}</Placeholder> : <span>{children}</span>;

function money(value, missingLabel) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? missingLabel : moneyFormatter.format(Number(value));
}

function ClientIdentity({ client }) {
  const name = client?.nomFamille
    ? [client.nomFamille, client.prenom].filter(Boolean).join(' ')
    : client?.nom || client?.prenom || 'Client non renseigné';
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

function TaskSummary({ model, c, returnTo }) {
  return <div>
    <span className="dossier-table-task-title">{model.title || 'Consulter le dossier'}</span>
    {model.detail && <span className="dossier-table-secondary">{model.detail}</span>}
    {model.otherActionsCount > 0 && <span className="dossier-table-secondary">{model.otherActionsCount} autre{model.otherActionsCount > 1 ? 's' : ''} tâche{model.otherActionsCount > 1 ? 's' : ''} en parallèle</span>}
    <InvoiceReviewIndicator dossier={c} returnTo={returnTo} />
  </div>;
}

/** Opening a row only consults it; taking a task always uses the atomic action. */
function MainAction({ action, onOpen, title }) {
  const { auth, can, workPreferences = [] } = useApp();
  const own = Boolean(action?.assignee_id && action.assignee_id === auth?.u?.id);
  const allowed = Boolean(action && canWorkAction(action, can));
  const waiting = Boolean(action && actionWaiting(action));
  const available = own || staffAvailable(workPreferences.find(preference => preference.staff_id === auth?.u?.id));
  const canTake = allowed && action.state === 'ready' && !waiting && available && (!action.assignee_id || own);
  const canContinue = allowed && own && action.state === 'in_progress' && !waiting;
  return <div className="dossier-table-action" onClick={stopPropagation}>
    {title && <p className="dossier-table-action-title">{title}</p>}
    {canTake
      ? <TaskTakeButton action={action} onClaim={saved => onOpen?.(saved)} />
      : <button type="button" className={`dossier-table-open${canContinue ? ' dossier-table-open-primary' : ''}`} onClick={() => onOpen?.(action)}>
        {canContinue ? 'Continuer' : 'Consulter'}<ArrowRight size={16} aria-hidden="true" />
      </button>}
  </div>;
}

function CellContent({ column, c, client, model, onOpen, returnTo, showActionTitle }) {
  switch (column.key) {
    case 'ref': return <div>
      <button type="button" className="dossier-table-reference" onClick={event => { event.stopPropagation(); onOpen?.(model.action); }}>{c.ref || 'Sans référence'}</button>
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
    case 'paid': return <span className="dossier-table-money">{money(model.payment?.paid, dossierTableMissingAmountLabel(model.payment, 'paid'))}</span>;
    case 'remaining': {
      const amount = money(model.payment?.remaining, dossierTableMissingAmountLabel(model.payment, 'remaining'));
      return <div><span className="dossier-table-money dossier-table-task-title">{amount}</span>{model.payment?.stateLabel && model.payment.stateLabel !== amount && <span className="dossier-table-secondary">{model.payment.stateLabel}</span>}</div>;
    }
    case 'receivedAt': return <div>{model.reception?.lastReceivedAt ? <time dateTime={model.reception.lastReceivedAt}>{formatDossierTableDate(model.reception.lastReceivedAt)}</time> : <Fact>{formatDossierTableDate(null)}</Fact>}{model.reception && !model.reception.complete && <span className="dossier-table-secondary">{model.reception.knownCount} / {model.reception.totalCount} cartons datés</span>}</div>;
    case 'sentAt': return model.payment?.sentAt ? <time dateTime={model.payment.sentAt}>{formatDossierTableDate(model.payment.sentAt)}</time> : <Fact>{formatDossierTableDate(null)}</Fact>;
    case 'departure': return <span>{model.departure?.label || 'À prévoir'}</span>;
    case 'destination': return <Fact>{model.departure?.destination || 'À renseigner'}</Fact>;
    case 'packages': return <span>{model.departure?.packagesLabel || 'À préparer'}</span>;
    case 'readiness': return <span>{model.departure?.readinessLabel || 'À vérifier'}</span>;
    case 'action': return <MainAction action={model.action} onOpen={onOpen} title={showActionTitle ? model.title : undefined} />;
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

export function DossierTableHead({ columns = TABLE_COLUMNS.daily, onSelectAll, allSelected, onSort, sortCol, sortDir, widths, onResize, filters = {}, onFilterColumn, openFilterKey = null }) {
  return <tr className="dossier-table-head">
    <th scope="col" className="dossier-table-select" data-column="select">
      <label className="dossier-table-checkbox"><input type="checkbox" aria-label="Sélectionner tous les dossiers affichés" checked={Boolean(allSelected)} onChange={onSelectAll} /></label>
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

export function DossierTableRow({ c, client, model = {}, columns = TABLE_COLUMNS.daily, checked, onCheck, onOpen, returnTo }) {
  const showActionTitle = !columns.some(column => column.key === 'statut');
  return <tr className="dossier-table-row dossier-list-item" data-dossier-row={c.id} data-selected={checked ? 'true' : 'false'} onClick={() => onOpen?.(model.action)}>
    <td className="dossier-table-select" data-column="select" onClick={stopPropagation}>
      <label className="dossier-table-checkbox"><input type="checkbox" aria-label={`Sélectionner le dossier ${c.ref}`} checked={Boolean(checked)} onChange={onCheck} /></label>
    </td>
    {columns.map(column => <td key={column.key} data-column={column.key} className={column.align === 'right' ? 'dossier-table-align-right' : undefined}>
      <CellContent column={column} c={c} client={client} model={model} onOpen={onOpen} returnTo={returnTo} showActionTitle={showActionTitle} />
    </td>)}
  </tr>;
}

export function DossierTableCard({ c, view, client, model = {}, columns = TABLE_COLUMNS.daily, checked, onCheck, onOpen, returnTo }) {
  const statusColumn = columns.find(column => column.key === 'statusLabel');
  const facts = columns.filter(column => !['ref', 'client', 'statut', 'action', 'statusLabel'].includes(column.key) && (column.key !== 'optimizedDimensions' || model.optimized));
  const showActionTitle = !columns.some(column => column.key === 'statut');
  return <article className="dossier-table-card dossier-list-item" aria-label={`Dossier ${c.ref}`} data-view={view || (columns === TABLE_COLUMNS.daily ? 'daily' : undefined)} data-dossier-card={c.id} data-dossier-row={c.id} data-selected={checked ? 'true' : 'false'}>
    <div className="dossier-table-card-heading">
      <label className="dossier-table-checkbox"><input type="checkbox" aria-label={`Sélectionner le dossier ${c.ref}`} checked={Boolean(checked)} onChange={onCheck} /></label>
      <div data-column="ref"><CellContent column={referenceColumn} c={c} model={model} onOpen={onOpen} returnTo={returnTo} /></div>
      {statusColumn && <div data-column="statusLabel" className="dossier-table-card-status"><CellContent column={statusColumn} c={c} model={model} /></div>}
    </div>
    {columns.some(column => column.key === 'client') && <div data-column="client"><ClientIdentity client={client} /></div>}
    {columns.some(column => column.key === 'statut') && <div data-column="statut" className="dossier-table-card-task"><TaskSummary model={model} c={c} returnTo={returnTo} /></div>}
    {columns.some(column => column.key === 'action') && <div data-column="action" className="dossier-table-card-main-action"><MainAction action={model.action} onOpen={onOpen} title={showActionTitle ? model.title : undefined} /></div>}
    {facts.length > 0 && <dl className="dossier-table-card-facts">{facts.map(column => <div key={column.key} data-column={column.key}>
      <dt>{column.label}</dt><dd><CellContent column={column} c={c} client={client} model={model} onOpen={onOpen} /></dd>
    </div>)}</dl>}
  </article>;
}

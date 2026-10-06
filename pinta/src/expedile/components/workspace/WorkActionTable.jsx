import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { workRowModel } from '../../domain/workTable';
import { WorkActionButtons, WorkActionPanel, WorkTaskDetails, WorkTaskLink, useWorkActionControls } from './WorkActionRow';
import '../staff/dossierTable.css';
import './workTable.css';

const Placeholder = () => <span className="dossier-table-placeholder">—</span>;

/** One row per task, in the server priority order. Options and its forms open
 * in a row of their own under the task, never inside the narrow action cell. */
function WorkTableRow({ action, dossier, client, columns, returnTo, now, notice }) {
  const { auth } = useApp();
  const controls = useWorkActionControls(action, { returnTo });
  const panelId = useId();
  const model = workRowModel(action, dossier, client, { now, meId: auth?.u?.id });
  const expanded = Boolean(controls.mode || controls.error);
  const cell = key => {
    switch (key) {
      case 'task': return <div className="work-task">
        <div className="work-task-heading"><WorkTaskLink action={action} dossier={dossier} title={model.title} returnTo={returnTo} />{model.state && <span className="dossier-pill" data-tone={model.state.tone}>{model.state.label}</span>}</div>
        <WorkTaskDetails model={model} action={action} dossier={dossier} returnTo={returnTo} notice={notice} />
      </div>;
      case 'due': return model.due ? <span className="work-due" data-urgent={model.due.urgent ? 'true' : undefined}><Clock size={15} aria-hidden="true" /><span>{model.due.text}</span></span> : <Placeholder />;
      case 'ref': return <span className="work-ref">{model.ref}</span>;
      case 'client': return model.client;
      case 'casier': return model.casier || <Placeholder />;
      case 'cartons': return model.cartons ?? <Placeholder />;
      case 'action': return <WorkActionButtons controls={controls} hideRedundantView panelId={panelId} className="work-actions" />;
      default: return null;
    }
  };
  return <>
    <tr className="dossier-table-row work-table-row" data-work-action={action.id} data-urgent={model.urgent ? 'true' : undefined} data-selected={expanded ? 'true' : 'false'}>
      {columns.map(column => <td key={column.key} data-work-column={column.key} className={column.align === 'right' ? 'work-table-number' : undefined}>{cell(column.key)}</td>)}
    </tr>
    {expanded && <tr className="work-table-panel" data-work-action-panel={action.id}>
      <td colSpan={columns.length}><div id={panelId} className="work-panel space-y-2"><WorkActionPanel controls={controls} /></div></td>
    </tr>}
  </>;
}

/** The table scrolls inside its own frame when it is wider than the page; when
 * it fits, nothing scrolls there and the header sticks to the page instead. */
export default function WorkActionTable({ caption, actions, dossierById, clientById, columns, returnTo, now, notice }) {
  const frameRef = useRef(null);
  const tableRef = useRef(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const frame = frameRef.current, table = tableRef.current;
    const measure = () => setFits(table.getBoundingClientRect().width <= frame.clientWidth + 0.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame); observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return <div ref={frameRef} className="work-table-frame" data-fits={fits ? 'true' : undefined}>
    <table ref={tableRef} className="dossier-data-table work-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr className="dossier-table-head">{columns.map(column => <th key={column.key} scope="col" data-work-column={column.key} className={column.align === 'right' ? 'work-table-number' : undefined}>{column.label}</th>)}</tr></thead>
      <tbody>{actions.map(action => {
        const dossier = dossierById.get(action.colis_id);
        return <WorkTableRow key={action.id} action={action} dossier={dossier} client={clientById.get(dossier?.clientId)} columns={columns} returnTo={returnTo} now={now} notice={notice} />;
      })}</tbody>
    </table>
  </div>;
}

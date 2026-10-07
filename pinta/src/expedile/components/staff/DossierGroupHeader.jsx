import React, { useId, useLayoutEffect, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { countLabel } from '../../domain/dossierTable';

export const dossierCountLabel = count => countLabel(count, 'dossier');

/** A checkbox that also shows a partial selection: checked when every dossier
 * is selected, mixed (« indeterminate ») when only some are. */
export function SelectionCheckbox({ selection = 'none', ...props }) {
  const input = useRef(null);
  useLayoutEffect(() => { if (input.current) input.current.indeterminate = selection === 'some'; }, [selection]);
  return <input ref={input} type="checkbox" checked={selection === 'all'} {...props} />;
}

/** The heading of a group of dossiers, the same above table rows and cards: a
 * departure (« Départ du jeudi 15 octobre · Réunion », then its reference), a
 * stage or a client (« Payet Flavie », as its rows read), then its number of
 * dossiers. The title folds the group; the checkbox selects every dossier of
 * the group, folded or not, and shows when only part of it is selected. */
function DossierGroupHeader({ group, titleId, collapsed, onToggle, selection = 'none', onToggleAll }) {
  const refId = useId(), countId = useId();
  const Icon = group.icon;
  return <div className="dossier-group-header">
    <label className="dossier-table-checkbox"><SelectionCheckbox aria-label={`Sélectionner le groupe ${group.ref ? `${group.title} · ${group.ref}` : group.title}`} selection={selection} onChange={onToggleAll} /></label>
    {/* On a narrow screen the reference and the count go under the title. */}
    <div className="dossier-group-heading">
      <button type="button" className="dossier-group-toggle" aria-expanded={!collapsed} aria-describedby={group.ref ? `${refId} ${countId}` : countId} onClick={onToggle}>
        {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        {Icon && <Icon size={16} aria-hidden="true" className="dossier-group-icon" style={{ color: group.color }} />}
        <span id={titleId} className="dossier-group-title">{group.title}</span>
      </button>
      <span className="dossier-group-details">
        {group.ref && <span id={refId} className="dossier-group-ref">{group.ref}</span>}
        <span id={countId} className="dossier-group-count">{dossierCountLabel(group.dossiers.length)}</span>
      </span>
    </div>
  </div>;
}

/** Table: one full-width row; the heading stays at the left edge while the
 * columns scroll horizontally. */
export function DossierGroupRow({ group, colSpan, ...header }) {
  return <tr className="dossier-group-row" data-dossier-group={group.key}>
    <td colSpan={colSpan}><DossierGroupHeader group={group} {...header} /></td>
  </tr>;
}

/** Cards: the heading leads its own cards, which it names for assistive technology. */
export function DossierCardGroup({ group, children, ...header }) {
  const titleId = useId();
  return <div role="group" aria-labelledby={titleId} className="dossier-card-group" data-dossier-group={group.key}>
    <DossierGroupHeader group={group} titleId={titleId} {...header} />
    {children}
  </div>;
}

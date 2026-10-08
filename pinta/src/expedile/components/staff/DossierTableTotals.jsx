import React, { useId } from 'react';
import { TOTAL_UNKNOWN_LABEL, dossierTableTotalSummary } from '../../domain/dossierTableTotals';

/** One column's total, written like its cells; under it « 4 sur 6 dossiers »
 * when some of the dossiers have no value (assistive technology reads « Total de
 * 4 dossiers sur 6 ; 2 sans valeur. »), and « Non renseigné » when none has one. */
function TotalValue({ total }) {
  if (total.value === null) return <span className="dossier-table-placeholder">{TOTAL_UNKNOWN_LABEL}</span>;
  return <>
    <span className="dossier-table-total-value">{total.text}</span>
    {total.note && <><span className="dossier-table-total-note" aria-hidden="true">{total.note}</span><span className="sr-only">{total.description}</span></>}
  </>;
}

/** « Sous-total · » then « 3 dossiers »: a narrow column breaks the label
 * between its words and its count, never inside « 3 dossiers ». */
function TotalLabel({ text }) {
  const parts = /^(.*?)\s(\d[\d\u202f\u00a0]*\sdossiers?)(.*)$/.exec(text);
  if (!parts) return text;
  return <><span className="dossier-nowrap">{parts[1]}</span> <span className="dossier-nowrap">{parts[2]}</span>{parts[3]}</>;
}

/** A row of totals, one cell per visible column, aligned with them: the total of
 * the displayed dossiers (`variant="total"`, the foot of the table, pinned to the
 * bottom of the list) or the subtotal closing a group (`variant="subtotal"`). Its
 * label takes the first column; `context` (the group's title) follows it for
 * assistive technology. Not a dossier: no checkbox, no action, no tab stop; its
 * cells name their column with `data-total-column`, never `data-column`, which
 * belongs to the headings and the dossiers. */
export function DossierTotalRow({ variant = 'total', columns, totals, label, context, groupKey, rowRef }) {
  return <tr ref={rowRef} className="dossier-table-total-row" data-total={variant} data-dossier-subtotal={variant === 'subtotal' ? groupKey : undefined}>
    <td className="dossier-table-select" data-total-column="select" />
    {columns.map((column, index) => index === 0
      ? <th key={column.key} scope="row" data-total-column={column.key} className="dossier-table-total-label"><TotalLabel text={label} />{context && <span className="sr-only"> · {context}</span>}</th>
      : <td key={column.key} data-total-column={column.key} className={column.align === 'right' ? 'dossier-table-align-right' : undefined}>
        {totals.columns[column.key] && <TotalValue total={totals.columns[column.key]} />}
      </td>)}
  </tr>;
}

/** Cards: the one-line subtotal under a group heading, « Poids 45,2 kg · Prix
 * 1 250,00 € · Taxes 180,00 € », each incomplete total with its « 4 sur 6
 * dossiers »; the columns without any value close the line, « Non renseigné :
 * prix, taxes ». A line breaks between two totals, never before a « · ».
 * Assistive technology hears a comma where the « · » shows: « Colis 4, Poids
 * 7,75 kg », never « Colis 4 Poids ». */
export function DossierGroupTotals({ totals, columns }) {
  const items = dossierTableTotalSummary(totals, columns);
  if (!items.length) return null;
  const known = items.filter(item => item.known), unknown = items.filter(item => !item.known);
  const parts = [...known.map(item => <span key={item.key} className="dossier-group-total" data-total-key={item.key}>
    <span className="dossier-group-total-figure"><span className="dossier-group-total-label">{item.label}</span>{' '}<span className="dossier-group-total-value">{item.text}</span></span>
    {item.note && <><span className="dossier-group-total-note" aria-hidden="true">{` (${item.note})`}</span><span className="sr-only">, {item.description}</span></>}
  </span>), ...(unknown.length ? [<span key="unknown" className="dossier-group-total dossier-table-placeholder" data-total-key="unknown">
    {TOTAL_UNKNOWN_LABEL}{'\u00a0: '}{unknown.map(item => item.label.toLocaleLowerCase('fr')).join(', ')}
  </span>] : [])];
  return <p className="dossier-group-totals" data-group-totals="">
    <span className="sr-only">Sous-total : </span>
    {parts.map((part, index) => <React.Fragment key={part.key}>
      {index > 0 && <><span className="sr-only">,</span><span aria-hidden="true" className="dossier-group-total-separator">{'\u00a0·'}</span>{' '}</>}
      {part}
    </React.Fragment>)}
  </p>;
}

/** Cards: the block that ends the list, « Total des 12 dossiers » (« … filtrés »),
 * one line per visible column that adds up, as the cards show their facts. */
export function DossierCardTotal({ totals, columns, label }) {
  const titleId = useId();
  const shown = columns.filter(column => totals.columns[column.key]);
  if (!shown.length) return null;
  return <div role="group" aria-labelledby={titleId} className="dossier-card-total" data-dossier-total="">
    <p id={titleId} className="dossier-card-total-title">{label}</p>
    <dl className="dossier-card-total-facts">{shown.map(column => <div key={column.key} data-total-column={column.key}>
      <dt>{column.label}</dt><dd><TotalValue total={totals.columns[column.key]} /></dd>
    </div>)}</dl>
  </div>;
}

import * as XLSX from 'xlsx';
import { buildDossierTableExport, dossierTableExportFormat } from '../domain/dossierTable.js';
import { dossierTableTotals, TOTAL_UNKNOWN_LABEL } from '../domain/dossierTableTotals.js';

export const DOSSIER_TABLE_TOTAL_LABEL = 'Total';

/** The « Dossiers » sheet: the dossiers in screen order under the visible
 * columns, their numbers as numbers in their format; then one empty row and the
 * « Total » row: SUBTOTAL(9, …) of each column that adds up, its value (the
 * screen's total, dossierTableTotals) cached, so the total follows the filters
 * applied in Excel. The header row carries the filter; no group row is inserted
 * among the dossiers, so the sheet sorts as it is. */
export function buildDossierTableWorkbook(dossiers, clients, models, view, columns) {
  const { columns: selected, dossiers: exported, rows, formats } = buildDossierTableExport(dossiers, clients, models, view, columns);
  if (!selected.length) throw new Error('Aucune colonne visible à exporter.');
  const ws = XLSX.utils.json_to_sheet(rows, { header: selected.map(column => column.label) });
  rows.forEach((row, index) => selected.forEach((column, col) => {
    const cell = ws[XLSX.utils.encode_cell({ r: index + 1, c: col })];
    const format = formats[index][column.label];
    if (cell?.t === 'n' && format) cell.z = format;
  }));
  const totalTexts = {};
  if (rows.length) {
    const last = rows.length; // the header is row 0, the dossiers rows 1 to last
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: last, c: selected.length - 1 } }) };
    // « Dimensions finales » is text in the sheet: its volumetric total stays on screen.
    const totals = dossierTableTotals(exported, selected, models).columns;
    const totalRow = last + 2;
    selected.forEach((column, col) => {
      const total = totals[column.key];
      if (!total || total.kind === 'volumetric') return;
      const name = XLSX.utils.encode_col(col);
      ws[XLSX.utils.encode_cell({ r: totalRow, c: col })] = total.value === null
        ? { t: 's', v: TOTAL_UNKNOWN_LABEL }
        : { t: 'n', v: total.value, f: `SUBTOTAL(9,${name}2:${name}${last + 1})`, z: dossierTableExportFormat(total.kind) };
      totalTexts[column.label] = total.value === null ? TOTAL_UNKNOWN_LABEL : total.text;
    });
    if (Object.keys(totalTexts).length) {
      ws[XLSX.utils.encode_cell({ r: totalRow, c: 0 })] = { t: 's', v: DOSSIER_TABLE_TOTAL_LABEL };
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: selected.length - 1 } });
    }
  }
  // A column is as wide as its longest text: a cell of several lines (« Dimensions finales ») by its
  // longest line, a number as its format writes it (« 1,289.50 € · Brouillon »), never « ### ».
  const longestLine = value => String(value ?? '').split('\n').reduce((width, line) => Math.max(width, line.length), 0);
  const shown = (row, index, label) => typeof row[label] === 'number' && formats[index][label] ? XLSX.SSF.format(formats[index][label], row[label]) : row[label];
  ws['!cols'] = selected.map(({ label }) => ({ wch: Math.min(60, [...rows.map((row, index) => shown(row, index, label)), totalTexts[label]].reduce((width, value) => Math.max(width, longestLine(value)), label.length)) + 2 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dossiers');
  return wb;
}

export function exportDossierTableExcel(dossiers, clients, models, view, columns, filename = 'dossiers.xlsx') {
  XLSX.writeFile(buildDossierTableWorkbook(dossiers, clients, models, view, columns), filename);
}

export function exportColisExcel(colis, clients, columns, filename = 'export-colis.xlsx') {
  const clientById=typeof clients==='function'?clients:id=>(clients || []).find(client=>client.id===id);
  if(Array.isArray(columns))columns=undefined;
  const allColumns = {
    ref: (c) => ({ 'Référence': c.ref }),
    client: (c) => ({ 'Client': clientById(c.clientId)?.nom || '—' }),
    statut: (c) => ({ 'Statut': c.statut }),
    description: (c) => ({ 'Description': c.desc || '' }),
    dims: (c) => ({ 'Dimensions (cm)': c.dimL ? `${c.dimL}×${c.dimW}×${c.dimH}` : '' }),
    poids: (c) => ({ 'Poids (kg)': c.poids || '' }),
    transport: (c) => ({ 'Transport (€)': c.devisTransport ?? '' }),
    taxes: (c) => ({ 'Taxes (€)': (c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0) || '' }),
    total: (c) => ({ 'Total (€)': c.devisTotal ?? '' }),
    dateReception: (c) => ({ 'Date réception': c.dateReception ? new Date(c.dateReception).toLocaleDateString('fr-FR') : '' }),
    casier: (c) => ({ 'Casier': c.casier || '' }),
    envoi: (c) => ({ 'Envoi': c.envoi || '' }),
    fournisseurs: (c) => ({ 'Fournisseurs': [...new Set((c.trackingsDetail || []).map(t=>t.fournisseur).filter(Boolean))].join(', ') }),
  };

  // If no columns specified, include all (backward-compatible)
  const selectedCols = columns
    ? Object.keys(allColumns).filter((k) => k === 'ref' || columns[k])
    : Object.keys(allColumns);

  const rows = colis.map((c) => {
    let row = {};
    selectedCols.forEach((k) => {
      if (allColumns[k]) Object.assign(row, allColumns[k](c));
    });
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...rows.map((r) => String(r[key] || '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Colis');
  XLSX.writeFile(wb, filename);
}

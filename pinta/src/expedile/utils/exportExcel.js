import * as XLSX from 'xlsx';
import { buildDossierTableExportRows, dossierTableExportColumns } from '../domain/dossierTable.js';

export function exportDossierTableExcel(dossiers, clients, models, view, columns, filename = 'dossiers.xlsx') {
  const selected = dossierTableExportColumns(view, columns);
  if (!selected.length) throw new Error('Aucune colonne visible à exporter.');
  const rows = buildDossierTableExportRows(dossiers, clients, models, view, selected);
  const ws = XLSX.utils.json_to_sheet(rows, { header: selected.map(column => column.label) });
  // A cell of several lines (« Dimensions finales ») is as wide as its longest line.
  const longestLine = value => String(value ?? '').split('\n').reduce((width, line) => Math.max(width, line.length), 0);
  ws['!cols'] = selected.map(({ label }) => ({ wch: Math.min(60, rows.reduce((width, row) => Math.max(width, longestLine(row[label])), label.length)) + 2 }));
  selected.forEach((column, col) => {
    if (!['requested', 'paid', 'remaining'].includes(column.key)) return;
    rows.forEach((row, index) => {
      const cell = ws[XLSX.utils.encode_cell({ r: index + 1, c: col })];
      if (cell?.t === 'n') cell.z = '#,##0.00 "€"';
    });
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dossiers');
  XLSX.writeFile(wb, filename);
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

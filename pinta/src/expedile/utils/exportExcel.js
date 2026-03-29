import * as XLSX from 'xlsx';

export function exportColisExcel(colis, clients, columns, filename = 'export-colis.xlsx') {
  const allColumns = {
    ref: (c) => ({ 'Référence': c.ref }),
    client: (c) => ({ 'Client': (clients.find((x) => x.id === c.clientId))?.nom || '—' }),
    statut: (c) => ({ 'Statut': c.statut }),
    description: (c) => ({ 'Description': c.desc || '' }),
    dims: (c) => ({ 'Dimensions (cm)': c.dimL ? `${c.dimL}×${c.dimW}×${c.dimH}` : '' }),
    poids: (c) => ({ 'Poids (kg)': c.poids || '' }),
    transport: (c) => ({ 'Transport (€)': c.devisTransport || '' }),
    taxes: (c) => ({ 'Taxes (€)': (c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0) || '' }),
    total: (c) => ({ 'Total (€)': c.devisTotal || '' }),
    dateReception: (c) => ({ 'Date réception': c.dateReception ? new Date(c.dateReception).toLocaleDateString('fr-FR') : '' }),
    casier: (c) => ({ 'Casier': c.casier || '' }),
    envoi: (c) => ({ 'Envoi': c.envoi || '' }),
    fournisseurs: (c) => ({ 'Fournisseurs': (c.fournisseurs || []).join(', ') }),
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

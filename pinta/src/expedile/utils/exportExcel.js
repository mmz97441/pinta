import * as XLSX from 'xlsx';

export function exportColisExcel(colis, clients, filename = 'export-colis.xlsx') {
  const rows = colis.map((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const taxes = (c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0);
    return {
      'Référence': c.ref,
      'Client': cl?.nom || '—',
      'Statut': c.statut,
      'Description': c.desc || '',
      'Dimensions (cm)': c.dimL ? `${c.dimL}×${c.dimW}×${c.dimH}` : '',
      'Poids (kg)': c.poids || '',
      'Transport (€)': c.devisTransport || '',
      'Taxes (€)': taxes || '',
      'Total (€)': c.devisTotal || '',
      'Date réception': c.dateReception ? new Date(c.dateReception).toLocaleDateString('fr-FR') : '',
      'Casier': c.casier || '',
      'Envoi': c.envoi || '',
    };
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

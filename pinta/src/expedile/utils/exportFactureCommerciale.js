import * as XLSX from 'xlsx';

/**
 * Generate a commercial invoice Excel for a given envoi (shipment batch).
 *
 * @param {Object} envoi - The envoi object {id, ref, date, ...}
 * @param {Array} colis - All colis in this envoi
 * @param {Array} clients - All clients
 * @param {Array} categories - All categories (with codeHs field)
 */
export function exportFactureCommerciale(envoi, colis, clients, categories) {
  const rows = [];

  colis.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const clientRef = `${c.ref} ${cl?.nom || ''}`;

    (c.lignes || []).forEach((ligne) => {
      const cat = categories.find((x) => x.id === ligne.cat);
      rows.push({
        'Code HS': cat?.codeHs || cat?.code_hs || '',
        'Description': ligne.desc || '',
        'Qté': ligne.qte || 1,
        'P.U HT': ligne.prix || 0,
        'Prix total': (ligne.qte || 1) * (ligne.prix || 0),
        'Référence': clientRef,
      });
    });

    // If no lignes, add at least one line from the colis description
    if (!c.lignes || c.lignes.length === 0) {
      rows.push({
        'Code HS': '',
        'Description': c.desc || 'Marchandise diverse',
        'Qté': 1,
        'P.U HT': c.valeur || 0,
        'Prix total': c.valeur || 0,
        'Référence': clientRef,
      });
    }
  });

  // Add totals row
  const sousTotal = rows.reduce((sum, r) => sum + (r['Prix total'] || 0), 0);
  rows.push({});  // empty row
  rows.push({
    'Code HS': '',
    'Description': '',
    'Qté': '',
    'P.U HT': 'Sous-total',
    'Prix total': sousTotal,
    'Référence': '',
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const headers = ['Code HS', 'Description', 'Qté', 'P.U HT', 'Prix total', 'Référence'];
  ws['!cols'] = headers.map((h) => ({
    wch: Math.max(h.length, ...rows.map((r) => String(r[h] || '').length)) + 2,
  }));

  const wb = XLSX.utils.book_new();
  const sheetName = `Facture ${envoi?.ref || 'COM'}`;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const filename = `facture-commerciale-${envoi?.ref || 'export'}.xlsx`;
  XLSX.writeFile(wb, filename);

  return rows.length - 2; // number of article lines (excluding total rows)
}

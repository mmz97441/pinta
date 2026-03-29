import * as XLSX from 'xlsx';
import { getDestByCP } from '../constants';

/**
 * Generate a monthly recap Excel for a pro client.
 * Shows all colis delivered/paid in a given month with full cost breakdown.
 */
export function exportRecapProExcel(client, colis, month, year) {
  // Filter colis for this client, paid or delivered in the given month
  const filtered = colis.filter((c) => {
    if (c.clientId !== client.id) return false;
    if (!['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(c.statut)) return false;
    // Check if paiement date or expedition date is in the target month
    const date = c.paiementDate || c.dateReception;
    if (!date) return false;
    const d = new Date(date);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  if (filtered.length === 0) return 0;

  const dest = getDestByCP(client.cp);

  // Sheet 1: Recap par colis
  const recapRows = filtered.map((c) => ({
    'Référence': c.ref,
    'Description': c.desc || '',
    'Date réception': c.dateReception ? new Date(c.dateReception).toLocaleDateString('fr-FR') : '',
    'Date paiement': c.paiementDate ? new Date(c.paiementDate).toLocaleDateString('fr-FR') : '',
    'Nb cartons': c.trackings?.filter(t => t).length || 1,
    'Poids fact. (kg)': c.poidsFact || c.finP || c.poids || '',
    'Transport (€)': c.devisTransport || 0,
    'OM (€)': c.devisOM || 0,
    'OMR (€)': c.devisOMR || 0,
    'TVA (€)': c.devisTVA || 0,
    'Frais divers (€)': (c.fraisDivers || []).reduce((s, f) => s + (f.montant || 0), 0),
    'Total TTC (€)': c.devisTotal || 0,
  }));

  // Totals row
  const totals = {
    'Référence': 'TOTAL',
    'Description': `${filtered.length} colis`,
    'Transport (€)': filtered.reduce((s, c) => s + (c.devisTransport || 0), 0),
    'OM (€)': filtered.reduce((s, c) => s + (c.devisOM || 0), 0),
    'OMR (€)': filtered.reduce((s, c) => s + (c.devisOMR || 0), 0),
    'TVA (€)': filtered.reduce((s, c) => s + (c.devisTVA || 0), 0),
    'Frais divers (€)': filtered.reduce((s, c) => s + (c.fraisDivers || []).reduce((s2, f) => s2 + (f.montant || 0), 0), 0),
    'Total TTC (€)': filtered.reduce((s, c) => s + (c.devisTotal || 0), 0),
  };
  recapRows.push({});
  recapRows.push(totals);

  // Sheet 2: Cout de revient par article (for resellers)
  const coutRevientRows = [];
  filtered.forEach((c) => {
    (c.lignes || []).forEach((l) => {
      const prixAchat = (l.qte || 1) * (l.prix || 0);
      // Proportion of transport/taxes for this line vs total value
      const totalValeur = (c.lignes || []).reduce((s, li) => s + (li.qte || 1) * (li.prix || 0), 0);
      const ratio = totalValeur > 0 ? prixAchat / totalValeur : 0;
      const transportPart = (c.devisTransport || 0) * ratio;
      const taxesPart = ((c.devisOM || 0) + (c.devisOMR || 0)) * ratio;
      const tvaPart = (c.devisTVA || 0) * ratio;
      const fraisPart = (c.fraisDivers || []).reduce((s, f) => s + (f.montant || 0), 0) * ratio;
      const coutTotal = prixAchat + transportPart + taxesPart + tvaPart + fraisPart;

      coutRevientRows.push({
        'Réf. colis': c.ref,
        'Article': l.desc || '',
        'Qté': l.qte || 1,
        'Prix achat unitaire (€)': l.prix || 0,
        'Prix achat total (€)': prixAchat,
        'Transport prorata (€)': Math.round(transportPart * 100) / 100,
        'Taxes prorata (€)': Math.round(taxesPart * 100) / 100,
        'TVA prorata (€)': Math.round(tvaPart * 100) / 100,
        'Frais prorata (€)': Math.round(fraisPart * 100) / 100,
        'COÛT DE REVIENT (€)': Math.round(coutTotal * 100) / 100,
      });
    });
  });

  // Sheet 3: Resume facturation
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const resumeRows = [
    { 'Champ': 'Client', 'Valeur': client.nom + (client.prenom ? ' ' + client.prenom : '') },
    { 'Champ': 'Type', 'Valeur': client.type || 'pro' },
    { 'Champ': 'Destination', 'Valeur': dest ? `${dest.flag} ${dest.nom}` : client.cp },
    { 'Champ': 'Période', 'Valeur': `${MOIS[month]} ${year}` },
    { 'Champ': 'Nombre de colis', 'Valeur': filtered.length },
    { 'Champ': 'Total Transport', 'Valeur': totals['Transport (€)'].toFixed(2) + ' €' },
    { 'Champ': 'Total Taxes (OM+OMR)', 'Valeur': (totals['OM (€)'] + totals['OMR (€)']).toFixed(2) + ' €' },
    { 'Champ': 'Total TVA', 'Valeur': totals['TVA (€)'].toFixed(2) + ' €' },
    { 'Champ': 'Total Frais divers', 'Valeur': totals['Frais divers (€)'].toFixed(2) + ' €' },
    { 'Champ': 'TOTAL TTC', 'Valeur': totals['Total TTC (€)'].toFixed(2) + ' €' },
    { 'Champ': 'Méthode paiement', 'Valeur': client.methodePaiement || 'fin_de_mois' },
  ];

  const wb = XLSX.utils.book_new();

  // Sheet 1
  const ws1 = XLSX.utils.json_to_sheet(recapRows);
  ws1['!cols'] = Object.keys(recapRows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) + 2 }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Récap colis');

  // Sheet 2 (only if there are lines)
  if (coutRevientRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(coutRevientRows);
    ws2['!cols'] = Object.keys(coutRevientRows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) + 2 }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Coût de revient');
  }

  // Sheet 3
  const ws3 = XLSX.utils.json_to_sheet(resumeRows);
  ws3['!cols'] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Résumé facturation');

  const clientName = (client.nom || 'client').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `recap-pro-${clientName}-${MOIS[month]}-${year}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filtered.length;
}

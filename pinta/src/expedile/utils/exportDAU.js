import * as XLSX from 'xlsx';

/**
 * Generate a DAU (Déclaration Administrative Unique) data export.
 * This provides the data needed for the customs declaration form.
 * The actual DAU form is filled by the customs broker (e.g., Schenker).
 *
 * @param {Object} envoi - Shipment batch
 * @param {Array} colis - Colis in this envoi
 * @param {Array} clients - All clients
 * @param {Array} categories - Categories with HS codes
 */
export function exportDAUData(envoi, colis, clients, categories) {
  // Group articles by HS code for the declaration
  const byHsCode = {};
  let totalMasseBrute = 0;
  let totalMasseNette = 0;
  let totalValeur = 0;

  colis.forEach((c) => {
    const poidsBrut = c.poids || 0;
    const poidsNet = c.finP || c.poids || 0;
    totalMasseBrute += poidsBrut;
    totalMasseNette += poidsNet;

    (c.lignes || []).forEach((ligne) => {
      const cat = categories.find((x) => x.id === ligne.cat);
      const hs = cat?.codeHs || cat?.code_hs || '99999999';
      const val = (ligne.qte || 1) * (ligne.prix || 0);
      totalValeur += val;

      if (!byHsCode[hs]) {
        byHsCode[hs] = {
          codeHs: hs,
          description: cat?.label || ligne.desc || 'Divers',
          quantite: 0,
          valeur: 0,
        };
      }
      byHsCode[hs].quantite += ligne.qte || 1;
      byHsCode[hs].valeur += val;
    });
  });

  const rows = Object.values(byHsCode).map((item) => ({
    'Code HS': item.codeHs,
    'Désignation': item.description,
    'Nb articles': item.quantite,
    'Valeur (€)': Math.round(item.valeur * 100) / 100,
  }));

  // Summary sheet
  const summary = [
    { 'Champ': 'Envoi', 'Valeur': envoi?.ref || '' },
    { 'Champ': 'Date départ', 'Valeur': envoi?.date || '' },
    { 'Champ': 'Nb colis total', 'Valeur': colis.length },
    { 'Champ': 'Masse brute (kg)', 'Valeur': Math.round(totalMasseBrute * 100) / 100 },
    { 'Champ': 'Masse nette (kg)', 'Valeur': Math.round(totalMasseNette * 100) / 100 },
    { 'Champ': 'Valeur totale (€)', 'Valeur': Math.round(totalValeur * 100) / 100 },
    { 'Champ': 'Mode transport', 'Valeur': 'AVION' },
    { 'Champ': 'Pays origine', 'Valeur': 'FRANCE' },
  ];

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(summary);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé DAU');

  const wsArticles = XLSX.utils.json_to_sheet(rows);
  wsArticles['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsArticles, 'Articles par code HS');

  const filename = `dau-data-${envoi?.ref || 'export'}.xlsx`;
  XLSX.writeFile(wb, filename);

  return rows.length;
}

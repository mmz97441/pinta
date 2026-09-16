import { receptionCartonManifest, hasCompleteReceptionMeasurements } from './reception.js';
import { currentInvoices, excludedInvoiceIds } from './invoiceDocuments.js';

/** Deterministic quote calculation. This module has no network, clock or UI dependency. */
export const QUOTE_SCHEMA_VERSION = 1;
export const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const number = (value) => value === '' || value == null ? NaN : Number(value);
const positive = (value) => Number.isFinite(number(value)) && number(value) > 0;
const nonNegative = (value) => Number.isFinite(number(value)) && number(value) >= 0;

/** Stable comparison of saved inputs; database relation ordering is not meaningful. */
export function quoteInputFingerprint(snapshot) {
  if (!snapshot?.inputs) return '';
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const inputs = canonical(snapshot.inputs);
  for (const key of ['lines', 'invoices']) {
    if (inputs[key]) inputs[key].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return JSON.stringify({ schemaVersion: snapshot.schemaVersion, mode: snapshot.mode, inputs });
}

export function volumetricDivisor(settings = {}) {
  return number(settings.volumetricDivisor ?? settings.diviseurVolumetrique ?? 5000);
}

export function measureShipment(boxes, divisor = 5000) {
  if (!Array.isArray(boxes) || !boxes.length || !positive(divisor)) return null;
  if (boxes.some((box) => !box || !['dimL', 'dimW', 'dimH', 'poids'].every((key) => positive(box[key])))) return null;
  const realWeight = boxes.reduce((sum, box) => sum + number(box.poids), 0);
  const volumetricWeight = boxes.reduce((sum, box) => sum + number(box.dimL) * number(box.dimW) * number(box.dimH) / divisor, 0);
  if (!Number.isFinite(volumetricWeight) || !Number.isFinite(realWeight)) return null;
  // Preserve the existing grouped-shipment policy: max(sum weights, sum volumes).
  return { realWeight, volumetricWeight, billableWeight: Math.max(realWeight, volumetricWeight) };
}

export function calculateQuote({ colis = {}, client = {}, destination, tarif, categories = [], settings = {}, mode = 'final' } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (field, message) => errors.push({ field, message });
  const isPro = client.type === 'pro';
  const divisor = volumetricDivisor(settings);
  if (mode === 'final' && colis.archive) fail('dossier', 'Désarchivez le dossier avant de préparer un nouveau devis.');
  if (mode === 'final' && colis.produitInterdit) fail('dossier', 'Un produit interdit est signalé : faites vérifier ce blocage avant le devis.');
  if (mode === 'final' && colis.feuVert !== undefined && colis.feuVert !== 'autorise') fail('dossier', 'Le feu vert du client doit être enregistré avant de préparer le devis.');
  if (!['final', 'estimate'].includes(mode)) fail('mode', 'Mode de calcul inconnu.');
  if (!destination?.code) fail('destination', 'Choisissez une destination prise en charge.');
  if (client.cp && String(client.cp).slice(0, 3) !== destination?.code) fail('destination', 'La destination du devis ne correspond pas au code postal du client.');
  if (!client.type || !['pro', 'particulier'].includes(client.type)) fail('client', 'Le type de client doit être renseigné.');
  if (!positive(divisor)) fail('settings', 'Le diviseur volumétrique doit être positif.');
  if (!tarif || !nonNegative(tarif.base) || !nonNegative(tarif.parKg)) fail('tarif', 'Aucun tarif valide pour cette destination et cette offre.');
  if (!isPro && !nonNegative(destination?.tva)) fail('destination', 'Le taux de TVA de cette destination est absent.');

  if (mode === 'final' && colis.preparationCompositionVersion != null && colis.finalMeasurementsVersion !== colis.preparationCompositionVersion) fail('dimensions.freshness', 'La composition du dossier a changé : mesurez à nouveau le colis optimisé et enregistrez ces mesures.');

  const finalPackages = Array.isArray(colis.finalPackages) && colis.finalPackages.length
    ? colis.finalPackages : [{ dimL: colis.finL, dimW: colis.finW, dimH: colis.finH, poids: colis.finP }];
  const labels = { dimL: 'longueur', dimW: 'largeur', dimH: 'hauteur', poids: 'poids' };
  finalPackages.forEach((box, index) => Object.entries(labels).forEach(([key, label]) => {
    if (!positive(box?.[key])) fail(`dimensions.${index}.${key}`, `Colis sortant ${index + 1} : renseignez une valeur positive pour ${label}.`);
  }));
  const after = measureShipment(finalPackages, divisor);
  if (mode === 'final' && after && colis.preparationCompositionVersion != null && Number(colis.outgoingParcelCount) !== finalPackages.length) fail('dimensions.count', 'Enregistrez les mesures de préparation pour confirmer le nombre de colis physiques à expédier.');
  const finalBox = finalPackages.length === 1 ? finalPackages[0] : null;
  if (!after && !errors.some((error) => error.field.startsWith('dimensions') || error.field === 'settings')) fail('dimensions', 'Les dimensions dépassent les limites de calcul.');

  const invoices = currentInvoices(colis.factures).filter((invoice) => !(invoice.rejetMotif || invoice.rejet_motif));
  if (!isPro && mode === 'final') {
    if (!invoices.length || !invoices.some((invoice) => invoice.valide)) fail('factures', 'Validez au moins une facture avant de préparer le devis.');
    if (invoices.some((invoice) => !invoice.valide)) fail('factures', 'Vérifiez toutes les factures en attente de ce dossier.');
    if (invoices.some((invoice) => invoice.valide && !invoice.fichier && !invoice.fichierUrl && !invoice.storagePath)) fail('factures', 'Joignez le justificatif des factures validées.');
    if (invoices.some((invoice) => !positive(invoice.montant))) fail('factures', 'Les factures validées doivent avoir un montant positif.');
  }

  const excludedIds = excludedInvoiceIds(colis.factures);
  const activeLines = (colis.lignes || []).filter(line => !line.factureId || !excludedIds.has(line.factureId));
  if (activeLines.length !== (colis.lignes || []).length) warnings.push('Les articles des factures rejetées, remplacées ou classées en doublon sont exclus de ce devis.');
  const lines = [];
  if (!isPro) {
    if (!activeLines.length) fail('lignes', 'Ajoutez les articles et leur catégorie pour calculer les taxes.');
    activeLines.forEach((line, index) => {
      const field = `lignes.${index}`;
      const category = categories.find((item) => item.id === line.cat);
      const rates = category?.taux?.[destination?.code];
      if (!String(line.desc || '').trim()) fail(field, `Article ${index + 1} : ajoutez une description.`);
      if (!positive(line.qte) || !Number.isInteger(number(line.qte))) fail(field, `Article ${index + 1} : la quantité doit être un entier positif.`);
      if (!nonNegative(line.prix)) fail(field, `Article ${index + 1} : corrigez le prix unitaire.`);
      if (!category) fail(field, `Article ${index + 1} : sélectionnez une catégorie connue.`);
      else if (!rates || !nonNegative(rates.om) || !nonNegative(rates.omr)) fail(field, `Article ${index + 1} : taux manquants pour ${destination?.nom || 'cette destination'}.`);
      lines.push({ id: line.id || null, factureId: line.factureId || null, description: String(line.desc || ''), quantity: number(line.qte), unitPrice: number(line.prix), categoryId: category?.id, categoryLabel: category?.label, rates: rates ? { om: number(rates.om), omr: number(rates.omr) } : null });
    });
    if (lines.length && lines.every((line) => Number.isFinite(line.quantity * line.unitPrice)) && lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) <= 0) fail('lignes', 'La valeur totale des marchandises doit être positive.');
  }

  const fees = (colis.fraisDivers || []).map((fee, index) => {
    if (!String(fee.libelle || '').trim() || !nonNegative(fee.montant)) fail(`fraisDivers.${index}`, 'Chaque frais doit avoir un libellé et un montant positif ou nul.');
    return { libelle: String(fee.libelle || '').trim(), montant: roundMoney(number(fee.montant)) };
  });
  if (errors.length) return { ok: false, errors, warnings, amounts: null, patch: null, snapshot: null };

  function price(weights) {
    const transport = roundMoney(number(tarif.base) + weights.billableWeight * number(tarif.parKg));
    const rawMerchandiseValue = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const merchandiseValue = roundMoney(rawMerchandiseValue);
    const taxLines = lines.map((line) => {
      const value = line.quantity * line.unitPrice;
      const transportShare = rawMerchandiseValue ? transport * value / rawMerchandiseValue : 0;
      const cif = value + transportShare;
      return { ...line, value, transportShare, cif, om: cif * line.rates.om / 100, omr: cif * line.rates.omr / 100 };
    });
    const om = roundMoney(taxLines.reduce((sum, line) => sum + line.om, 0));
    const omr = roundMoney(taxLines.reduce((sum, line) => sum + line.omr, 0));
    const tva = isPro ? 0 : roundMoney((transport + om + omr) * number(destination.tva) / 100);
    const feeTotal = roundMoney(fees.reduce((sum, fee) => sum + fee.montant, 0));
    return { ...weights, transport, merchandiseValue, om, omr, tva, fees: feeTotal, total: roundMoney(transport + om + omr + tva + feeTotal), taxLines };
  }

  const amounts = price(after);
  if (![amounts.total, amounts.transport, amounts.om, amounts.omr, amounts.tva].every(Number.isFinite) || amounts.total <= 0) {
    fail('total', 'Le total doit être un montant positif et fini.');
    return { ok: false, errors, warnings, amounts: null, patch: null, snapshot: null };
  }
  // Reception scalar dimensions are a summary, never the volume of several cartons.
  const originalBoxes = receptionCartonManifest(colis).dimsParColis;
  const beforeWeights = hasCompleteReceptionMeasurements(colis) ? measureShipment(originalBoxes, divisor) : null;
  const before = beforeWeights ? price(beforeWeights) : null;
  if (!before) warnings.push('Mesures de réception incomplètes : aucune économie avant/après annoncée.');
  if (!isPro && mode === 'final' && lines.some((line) => !line.factureId)) warnings.push('Certains articles historiques ne sont pas reliés à une facture : vérifiez leur provenance.');
  if (!isPro && invoices.length) {
    const invoiceTotal = roundMoney(invoices.filter((invoice) => invoice.valide).reduce((sum, invoice) => sum + number(invoice.montant), 0));
    if (Math.abs(invoiceTotal - amounts.merchandiseValue) > 0.02) warnings.push('Le total des articles diffère des factures : vérifiez la base HT/TTC et la répartition entre dossiers.');
  }
  const savings = before ? Math.max(0, roundMoney(before.total - amounts.total)) : 0;
  const patch = {
    devisTransport: amounts.transport, devisOM: amounts.om, devisOMR: amounts.omr, devisTVA: amounts.tva,
    devisTotal: amounts.total, poidsFact: roundMoney(amounts.billableWeight),
    avantOptimTransport: before?.transport || 0, avantOptimTotal: before?.total || 0, economie: savings,
  };
  const snapshot = {
    schemaVersion: QUOTE_SCHEMA_VERSION, currency: 'EUR', mode,
    inputs: {
      colisId: colis.id || null, reference: colis.ref || null, description: colis.desc || '',
      client: { id: client.id || null, type: client.type, nom: client.nom || '', email: client.email || '', abonnement: client.abonnement || 'freemium' },
      destination: { code: destination.code, nom: destination.nom, tva: isPro ? 0 : number(destination.tva) },
      tarif: { base: number(tarif.base), parKg: number(tarif.parKg) },
      paymentTerms: { mode: isPro ? colis.modePaiementPro || client.methodePaiement || 'virement' : 'payplug' },
      volumetricDivisor: divisor, weightPolicy: 'max_grouped_real_and_volumetric',
      finalBox: finalBox ? Object.fromEntries(Object.entries(finalBox).map(([key, value]) => [key, number(value)])) : null,
      finalPackages: finalPackages.map(box => Object.fromEntries(Object.keys(labels).map(key => [key, number(box[key])]))),
      originalBoxes: beforeWeights ? originalBoxes.map((box) => ({ dimL: number(box.dimL), dimW: number(box.dimW), dimH: number(box.dimH), poids: number(box.poids) })) : [],
      trackings: [...(colis.trackings || [])], invoices: invoices.map((invoice) => ({ id: invoice.id, montant: number(invoice.montant), valide: !!invoice.valide })),
      lines, fees,
    }, amounts, before, savings, warnings: [...warnings],
  };
  return { ok: true, errors, warnings, amounts, before, patch, snapshot };
}

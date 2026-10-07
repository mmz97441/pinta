import { buildCommercialInvoice } from '../domain/commercialInvoice';
import { loadableDossiers } from '../domain/departureBoard';
import { departureReadiness } from '../domain/departureReadiness';
import { supabase } from '../lib/supabase';
import { fetchColis, mapColis, mapClient, mapEnvoi, mapLigne, mapFact } from '../lib/supabaseData';

export async function confirmDeparture(envoi, loaded, deferredReason) {
  const { data, error } = await supabase.rpc('confirm_departure', {
    p_envoi_id: envoi.id, p_expected_updated_at: envoi.updatedAt,
    p_loaded: loaded.map((colis) => ({ id: colis.id, updated_at: colis.updatedAt, outgoing_parcel_count: colis.outgoingParcelCount })),
    p_deferred_reason: deferredReason?.trim() || null,
  });
  if (error) throw error;
  return mapEnvoi(Array.isArray(data) ? data[0] : data);
}

export async function departureManifest(envoiId) {
  const { data, error } = await supabase.rpc('get_departure_manifest', { p_envoi_id: envoiId });
  if (error) throw error;
  if (!data?.items?.length) throw new Error('Ce départ ne dispose pas de manifeste confirmé.');
  return {
    envoi: mapEnvoi(data.envoi), confirmedAt: data.confirmed_at,
    colis: data.items.map((item) => mapColis({ ...item.colis, _lignes: (item.lignes || []).map(mapLigne), _factures: (item.factures || []).map(mapFact) })),
    clients: [...new Map(data.items.map((item) => [item.client.id, mapClient(item.client)])).values()],
    categories: [...new Map(data.items.flatMap((item) => (item.categories || []).map((category) => [category.id, { id: category.id, label: category.label, codeHs: category.code_hs || '' }]))).values()],
    deferred: data.deferred || [],
    excluded: data.excluded || [],
  };
}

/** The departure's spreadsheets from its confirmed manifest: « manifest » or « dau ».
 *  The commercial invoice has its own functions below. */
export async function exportDeparture(envoiId, type) {
  if (!['manifest', 'dau'].includes(type)) throw new Error('Document de départ inconnu.');
  const manifest = await departureManifest(envoiId);
  if (type === 'dau') {
    const { exportDAUData } = await import('../utils/exportDAU');
    exportDAUData(manifest.envoi, manifest.colis, manifest.clients, manifest.categories);
  } else {
    const XLSX = await import('xlsx');
    const rows = manifest.colis.map((colis) => ({
      'Expédition': colis.ref, 'Client': manifest.clients.find((client) => client.id === colis.clientId)?.nom,
      'Colis physiques expédiés': colis.outgoingParcelCount, 'Poids après optimisation (kg)': departureReadiness(colis).weights?.realWeight ?? '',
      'Cartons reçus': colis.nbColis, 'Embarquement confirmé': manifest.confirmedAt,
      'Transport (€)': colis.devisTransport, 'Total devis (€)': colis.devisTotal,
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Embarqués');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(manifest.deferred.map((row) => ({ 'Expédition': row.ref, 'Motif du report': row.reason }))), 'Reportés');
    if (manifest.excluded.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(manifest.excluded.map((row) => ({ 'Expédition': row.ref, 'Hors chargement': row.reason }))), 'Exclus');
    XLSX.writeFile(book, `manifeste-${manifest.envoi.ref}.xlsx`);
  }
}

/** The commercial invoice before the departure (domain/commercialInvoice.js): its dossiers
 *  read again from the server, like the loading review; those ready to load are included,
 *  the others listed with their reason. It says so, with the instant of the export
 *  (meta.basis 'loading', meta.issuedAt), and its files end with « -avant-depart ». */
export async function loadingCommercialInvoice(envoi, { clients = [], categories = [], issuedAt = Date.now() } = {}) {
  const dossiers = loadableDossiers(envoi, await fetchColis(null, { envoiId: envoi.id }));
  return buildCommercialInvoice({
    envoi, categories, issuedAt,
    items: dossiers.map((colis) => ({ colis, client: clients.find((client) => client.id === colis.clientId) || null })),
  });
}

/** The commercial invoice of a departure that left, from its confirmed manifest: the loaded
 *  dossiers, their clients, articles and quotes as frozen at the confirmation, dated at that
 *  instant (meta.basis 'manifest'). A category that had no HS code then takes the one
 *  completed since in the categories (decision D33: a missing code is completed there, never
 *  invented). */
export async function manifestCommercialInvoice(envoiId, { categories = [] } = {}) {
  const manifest = await departureManifest(envoiId);
  const current = new Map(categories.map((category) => [category.id, category]));
  const frozen = manifest.categories.map((category) => ({ ...category, codeHs: category.codeHs || current.get(category.id)?.codeHs || '' }));
  const known = new Set(frozen.map((category) => category.id));
  return buildCommercialInvoice({
    envoi: manifest.envoi, issuedAt: manifest.confirmedAt, confirmed: true,
    items: manifest.colis.map((colis) => ({ colis, client: manifest.clients.find((client) => client.id === colis.clientId) || null })),
    categories: [...frozen, ...categories.filter((category) => !known.has(category.id))],
  });
}

/** Downloads a commercial invoice without blocking point, as « pdf » or « xlsx » (exporters loaded on demand). */
export async function downloadCommercialInvoice(invoice, format) {
  if (format === 'pdf') {
    const { exportFactureCommerciPDF } = await import('../utils/exportFactureCommerciPDF');
    return exportFactureCommerciPDF(invoice);
  }
  const { exportFactureCommerciale } = await import('../utils/exportFactureCommerciale');
  return exportFactureCommerciale(invoice);
}

import { departureReadiness } from '../domain/departureReadiness';
import { supabase } from '../lib/supabase';
import { mapColis, mapClient, mapEnvoi, mapLigne, mapFact } from '../lib/supabaseData';

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

export async function exportDeparture(envoiId, type) {
  const manifest = await departureManifest(envoiId);
  if (type === 'invoice') {
    const { exportFactureCommerciPDF } = await import('../utils/exportFactureCommerciPDF');
    exportFactureCommerciPDF({ ...manifest.envoi, confirmedAt: manifest.confirmedAt }, manifest.colis, manifest.clients, manifest.categories);
  } else if (type === 'dau') {
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

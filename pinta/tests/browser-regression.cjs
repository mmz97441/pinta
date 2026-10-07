const { openTaskNavigation } = require('./task-navigation.helper.cjs');
/* Network-isolated browser regression suite. Every non-local request is intercepted. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PINTA_TEST_URL || 'http://127.0.0.1:4175';
const output =
  process.env.PINTA_TEST_OUT ||
  path.resolve(__dirname, '../../docs/verification-expedile-2026-09-10');
const A = '11111111-1111-4111-8111-111111111111',
  C = '22222222-2222-4222-8222-222222222222',
  P = '33333333-3333-4333-8333-333333333333',
  F = '44444444-4444-4444-8444-444444444444',
  L = '55555555-5555-4555-8555-555555555555',
  S = '66666666-6666-4666-8666-666666666666';
const observations = [];
// Server freeze/lock evidence (D2/D4), mirrored for the mocked review context.
const TRANSPORT = ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'];
function frozenReason(colis) {
  if (!colis) return 'closed';
  if (colis.paiement_date || colis.paiement_montant != null || colis.statut === 'paye') return 'payment';
  if (colis.date_expedition || TRANSPORT.includes(colis.statut)) return 'departure';
  if (colis.archive || !['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client', 'en_preparation', 'devis_envoye', 'attente_paiement'].includes(colis.statut)) return 'closed';
  return null;
}
const quoteSent = colis => ['devis_envoye', 'attente_paiement'].includes(colis?.statut);
// Departure commands (lot 3a), mirrored on Paris time; the SQL suite
// departure-any-step.sql covers locks, audit and every refusal in depth.
const PARIS_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
function parisClock(time) {
  const parts = Object.fromEntries(PARIS_CLOCK.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
// departure_default_closing: the last Wednesday strictly before the day, 17:00 Paris.
function departureDefaultClosing(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const wednesday = new Date(date.getTime() - (((date.getUTCDay() || 7) + 3) % 7 + 1) * 86400000);
  const instant = [2, 1].map(offset => Date.UTC(wednesday.getUTCFullYear(), wednesday.getUTCMonth(), wednesday.getUTCDate(), 17 - offset)).find(time => parisClock(time).hour === 17);
  return new Date(instant).toISOString();
}
const DEPARTED_STATUSES = ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule'];
// Loading control (20261007000004): the outgoing parcels a check expects (_loading_expected_parcels): those of the current
// preparation, one for a legacy single final measure, null while nothing is prepared.
const finalMeasured = parcel => ['fin_l', 'fin_w', 'fin_h', 'fin_p'].every(key => Number(parcel[key]) > 0);
const listsParcels = parcel => Array.isArray(parcel.final_packages) && parcel.final_packages.length > 0;
const expectedParcels = parcel => listsParcels(parcel) ? parcel.outgoing_parcel_count ?? null : finalMeasured(parcel) ? parcel.outgoing_parcel_count ?? 1 : null;
const OPEN_DEPARTURE_STATUSES = ['planifie', 'prochain', 'en_cours', 'en_preparation', 'pret'];
function invoiceLock(colis, withdrawal = null) {
  return { frozenReason: frozenReason(colis), quoteLocked: quoteSent(colis) || !!(colis?.payplug_payment_id || colis?.payplug_payment_url), quoteSent: quoteSent(colis), liveLink: !!(colis?.payplug_payment_id || colis?.payplug_payment_url), withdrawal };
}
// D1: validated invoices get no analysis unless a modification draft is open.
function analysisReason(colis, invoice, draft) {
  if (frozenReason(colis)) return 'frozen';
  if (invoice.duplicate_of_facture_id || invoice.rejet_motif) return 'inactive';
  if (invoice.valide && !draft) return 'validated';
  return null;
}
function fixtures(role) {
  return {
    profiles: [{ id: A, nom: 'Camille', role, actif: true }],
    clients: [
      {
        id: C,
        user_id: role === 'client' ? A : null,
        ref: 'CLI-TEST',
        nom: 'Exemple',
        prenom: 'Camille',
        email: 'camille@example.test',
        // A complete record (prénom, nom, email, téléphone, address): « À vérifier » stays silent. A landline,
        // so the screens that offer to call or invite a mobile keep their usual state.
        tel_fixe: '0262 00 00 01',
        cp: '97400',
        ville: 'Saint-Denis',
        adresse_ligne1: '1 rue Exemple',
        type: 'particulier',
        abonnement: 'freemium',
        onboarded: true,
        created_at: '2026-09-01T08:00:00Z',
      },
    ],
    colis: [
      {
        id: P,
        client_id: C,
        ref: 'EXP-TEST-001',
        statut: role === 'client' ? 'attente_feu_vert' : 'en_preparation',
        desc_contenu: 'Deux achats à regrouper',
        trackings: ['TEST-001', 'TEST-002'],
        trackings_detail: [
          { number: 'TEST-001', fournisseur: 'Boutique A' },
          { number: 'TEST-002', fournisseur: 'Boutique B' },
        ],
        casier: 'A-03',
        nb_colis: 2,
        date_reception: '2026-09-08T08:00:00Z',
        created_at: '2026-09-08T08:00:00Z',
        updated_at: '2026-09-09T08:00:00Z',
        dim_l: 40,
        dim_w: 30,
        dim_h: 20,
        poids: 3,
        fin_l: 30,
        fin_w: 20,
        fin_h: 20,
        fin_p: 3,
        final_packages: [{ dimL: 30, dimW: 20, dimH: 20, poids: 3 }],
        preparation_composition_version: 1,
        final_measurements_version: 1,
        final_measurements_at: '2026-09-09T08:00:00Z',
        outgoing_parcel_count: 1,
        feu_vert: role === 'client' ? 'en_attente' : 'autorise',
        archive: false,
        quote_version: 0,
        frais_divers: [],
      },
    ],
    factures: [
      {
        id: F,
        colis_id: P,
        vendeur: 'Boutique A',
        montant: 100,
        valide: true,
        fichier_url: P + '/facture.pdf',
        fichier_nom: 'facture.pdf',
      },
    ],
    lignes: [
      {
        id: L,
        colis_id: P,
        facture_id: F,
        description: 'Article vérifié',
        qte: 1,
        prix_unitaire: 100,
        categorie_id: 'cat-test',
      },
    ],
    categories: [{ id: 'cat-test', label: 'Divers', position: 1 }],
    taux_categories: [
      { id: 'rate-test', categorie_id: 'cat-test', destination_code: '974', om: 10, omr: 2.5 },
    ],
    tarifs: [{ id: 'tarif-test', destination_code: '974', base: 25, par_kg: 5, actif: true }],
    staff_users: [
      {
        id: S,
        auth_id: A,
        role,
        nom: 'Camille',
        prenom: 'Test',
        email: 'audit@example.test',
        actif: true,
        must_change_password: false,
        staff_permissions: [],
      },
    ],
    app_settings: [
      {
        key: 'business',
        value: {
          diviseurVolumetrique: 5000,
          fraisStockage: 1.5,
          stockageGratuit: 14,
          relancesFeuVert: 'J+2, J+5, J+7',
          relancesPaiement: 'J+3, J+7, J+14',
        },
      },
    ],
    message_templates: [],
    envois: [],
    messages: [],
    notifications: [
      {
        id: 'notif-test',
        user_id: A,
        titre: 'Bienvenue',
        msg: 'Dossier à consulter',
        lu: false,
        colis_id: P,
        created_at: '2026-09-09T12:00:00Z',
      },
    ],
    client_inbox: [],
    staff_work_actions: [{ id: '77777777-0000-4000-8000-000000000001', colis_id: P, kind: 'preparation', state: 'ready', assignee_id: A, version: 1, created_at: '2026-09-09T08:00:00Z', updated_at: '2026-09-09T08:00:00Z' }],
    staff_work_preferences: [{ staff_id: A, missions: ['reception','preparation','communication','documents','departures','coordination'], active_mission: 'preparation', density: 'comfortable', available: true, version: 1 }],
    audit_actions: [],
    logs_statut: [],
    staff_permissions: [],
    departure_loading_checks: [],
    departure_manifests: [],
  };
}
async function setup(browser, role, { failTable = null, timezoneId = null, device = {} } = {}) {
  // timezoneId: a device far from Paris (Réunion, New York…) proves that business times never follow it.
  // device: touch and mobile emulation ({ hasTouch, isMobile }) for a tablet or a phone.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
    ...(timezoneId ? { timezoneId } : {}),
    ...device,
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const tables = fixtures(role),
    requests = [],
    errors = [],
    networkDenied = [];
  // The mocked server's clock; a suite that fixes the browser clock sets server.now too.
  const server = { now: () => Date.now() };
  const allowed = permission => ['directeur', 'vice_directeur'].includes(tables.staff_users[0]?.role) || (tables.staff_permissions || []).some(row => row[permission] === true);
  const destinationOf = parcel => {
    const prefix = String(tables.clients.find(client => client.id === parcel.client_id)?.cp ?? '').slice(0, 3);
    return parcel.paiement_date ? parcel.devis_snapshot?.inputs?.destination?.code || parcel.devis_snapshot?.destination?.code || prefix : prefix;
  };
  // valid_departure_for_colis (guard_colis_departure).
  const validDeparture = (envoi, parcel) => Boolean(envoi) && envoi.destination_code === destinationOf(parcel) && OPEN_DEPARTURE_STATUSES.includes(envoi.statut)
    && !envoi.departed_at && envoi.date_depart >= parisClock(server.now()).day && (!envoi.loading_closes_at || Date.parse(envoi.loading_closes_at) > server.now());
  const bump = parcel => { parcel.updated_at = new Date(Math.max(server.now(), Date.parse(parcel.updated_at) + 1000)).toISOString(); };
  /** The common refusals of the three departure commands, as the server orders them. */
  function departureRefusal(rpc, parcel, input) {
    if (!parcel) return [400, { code: 'P0002', message: 'Dossier introuvable' }];
    const assignment = parcel.envoi_id ? 'perm_envois_reaffecter' : 'perm_colis_affecter_envoi';
    if (rpc === 'create_departure_for_colis' ? !allowed('perm_envois_creer') || !allowed(assignment) : !allowed(assignment))
      return [403, { code: '42501', message: rpc === 'create_departure_for_colis' ? 'Permissions de création du départ et d’affectation requises' : 'Permission d’affectation ou de réaffectation requise' }];
    if (input.p_expected_updated_at !== parcel.updated_at) return [409, { code: '40001', message: rpc === 'assign_colis_departure' ? 'Le dossier a changé. Rechargez-le.' : 'Le dossier a changé. Actualisez avant de réessayer.' }];
    if (DEPARTED_STATUSES.includes(parcel.statut) || parcel.archive) return [400, { code: '22023', message: 'Ce dossier ne peut plus être affecté' }];
    return null;
  }
  // ── Loading control (20261007000004): the four commands and confirm_departure, with the server's rules, French
  // messages, SQLSTATEs and HINTs; supabase/tests/loading-checks.sql covers locks, audit and every refusal in depth. ──
  const loadingChecks = () => (tables.departure_loading_checks ||= []);
  const refused = (status, code, message, reason = null, details = null) => [status, { code, message, details, hint: reason ? `loading_check:${reason}` : null }];
  const sameInstant = (a, b) => a != null && b != null && Date.parse(a) === Date.parse(b);
  const touch = row => { row.updated_at = new Date(Math.max(server.now(), (Date.parse(row.updated_at) || 0) + 1000)).toISOString(); };
  const copy = value => JSON.parse(JSON.stringify(value));
  const checkerName = id => {
    const name = row => (row ? [row.prenom, row.nom].filter(Boolean).join(' ').trim() : '');
    return name((tables.staff_users || []).find(row => row.auth_id === id)) || name((tables.profiles || []).find(row => row.id === id)) || 'Membre de l’équipe';
  };
  const checkJson = row => ({ colis_id: row.colis_id, parcel_index: row.parcel_index, parcel_count: row.parcel_count, method: row.method, checked_by: row.checked_by, checked_by_name: checkerName(row.checked_by), checked_at: row.checked_at });
  const dossierChecks = (envoiId, colisId) => loadingChecks().filter(row => row.envoi_id === envoiId && row.colis_id === colisId).sort((a, b) => a.parcel_index - b.parcel_index);
  // colis_loading_checks_forget: after any write of a dossier, one that left its departure (reassigned, deferred at the
  // confirmation, detached) keeps only the checks of its current departure, and one prepared again (final measurements
  // stamped or cleared, composition changed: save_preparation_measurements, correct_colis_task('preparation'), a carton
  // appended) loses them all; any other write, the confirmation included, keeps them. The foreign keys cascade as well: a
  // dossier or a departure deleted by the write takes its checks with it.
  const PREPARATION_STAMP = ['final_measurements_version', 'preparation_composition_version', 'final_measurements_at'];
  const sameValue = (a, b) => a === b || (typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b));
  /** The rows before a mocked server write: each dossier's departure and preparation stamp, the departures. */
  const beforeWrite = () => ({
    dossiers: new Map((tables.colis || []).map(row => [row.id, { envoi_id: row.envoi_id ?? null, ...Object.fromEntries(PREPARATION_STAMP.map(key => [key, row[key] ?? null])) }])),
    departures: new Set((tables.envois || []).map(row => row.id)),
  });
  /** After the write: the trigger and the cascades, on the checks of the dossiers and departures it changed. */
  function afterWrite({ dossiers, departures }) {
    const remaining = new Map((tables.colis || []).map(row => [row.id, row])), envois = new Set((tables.envois || []).map(row => row.id));
    const kept = loadingChecks().filter(check => {
      if ((dossiers.has(check.colis_id) && !remaining.has(check.colis_id)) || (departures.has(check.envoi_id) && !envois.has(check.envoi_id))) return false;
      const before = dossiers.get(check.colis_id), row = remaining.get(check.colis_id);
      if (!before || !row) return true;
      const envoi = row.envoi_id ?? null, prepared = PREPARATION_STAMP.some(key => !sameValue(before[key], row[key] ?? null));
      if (!prepared && before.envoi_id === envoi) return true;
      return !prepared && check.envoi_id === envoi;
    });
    if (kept.length !== loadingChecks().length) tables.departure_loading_checks = kept;
  }
  /** Runs a mocked server write (a command, or rows written through the API) as the database does, its trigger included. */
  function serverWrite(write) {
    const before = beforeWrite();
    try { return write(); } finally { afterWrite(before); }
  }
  /** _loading_check_target: an open departure that has not left, the dossier on it, neither shipped, cancelled nor archived. */
  function loadingTarget(input, prepared) {
    const envoi = tables.envois.find(row => row.id === input?.p_envoi_id);
    if (!envoi) return { refusal: refused(400, 'P0002', 'Départ introuvable', 'departure_not_found') };
    if (envoi.departed_at || !OPEN_DEPARTURE_STATUSES.includes(envoi.statut)) return { refusal: refused(400, '22023', 'Ce départ est déjà confirmé ou clos : son contrôle du chargement ne peut plus changer.', 'departure_closed') };
    const parcel = tables.colis.find(row => row.id === input?.p_colis_id);
    if (!parcel) return { refusal: refused(400, 'P0002', 'Dossier introuvable', 'dossier_not_found') };
    if (parcel.envoi_id !== envoi.id) return { refusal: refused(409, '40001', `${parcel.ref} n’est pas affecté à ce départ : ne chargez pas ses colis. Actualisez le chargement.`, 'not_assigned') };
    if (parcel.archive || parcel.date_expedition || DEPARTED_STATUSES.includes(parcel.statut)) return { refusal: refused(400, '22023', `${parcel.ref} est déjà expédié, annulé ou archivé : il ne fait plus partie de ce chargement.`, 'dossier_closed') };
    if (prepared && expectedParcels(parcel) == null) return { refusal: refused(400, '22023', `${parcel.ref} : ses colis sortants ne sont pas encore préparés. Terminez sa préparation avant de contrôler son chargement.`, 'not_prepared') };
    return { envoi, parcel };
  }
  /** The confirmation's control of one loaded dossier: the refusal « Contrôle incomplet », or its checks as evidence. */
  function loadingEvidence(envoi, parcel, count) {
    const found = dossierChecks(envoi.id, parcel.id).filter(row => row.parcel_count === count);
    if (found.length < count) return { refusal: refused(400, '22023', `Contrôle incomplet : ${parcel.ref} (${found.length}/${count} colis ${count > 1 ? 'vérifiés' : 'vérifié'}). Scannez ou comptez ses colis, ou reportez-le.`, 'incomplete', JSON.stringify({ colis_id: parcel.id, ref: parcel.ref, checked: found.length, expected: count })) };
    return { evidence: found.map(checkJson) };
  }
  const activeInvoice = invoice => invoice.valide && !String(invoice.rejet_motif ?? '').trim() && !invoice.duplicate_of_facture_id && !tables.factures.some(other => other.replaces_facture_id === invoice.id);
  /** confirm_departure: the server's order of refusals, then the writes and the frozen manifest. */
  function confirmDeparture(input) {
    if (!(allowed('perm_envois_modifier') && allowed('perm_colis_expedier'))) return refused(403, '42501', 'Permissions de modification du départ et d’expédition requises');
    const loaded = input?.p_loaded;
    if (!Array.isArray(loaded) || !loaded.length) return refused(400, '22023', 'Sélectionnez les dossiers effectivement embarqués');
    const envoi = tables.envois.find(row => row.id === input.p_envoi_id);
    if (!envoi) return refused(400, 'P0002', 'Départ introuvable');
    if (envoi.departed_at || !OPEN_DEPARTURE_STATUSES.includes(envoi.statut)) return refused(400, '22023', 'Ce départ est déjà confirmé ou clos');
    if (!sameInstant(input.p_expected_updated_at, envoi.updated_at)) return refused(409, '40001', 'Le départ a changé. Rechargez le chargement.');
    if (!envoi.date_depart || envoi.date_depart !== parisClock(server.now()).day) return refused(400, '22023', 'La confirmation doit avoir lieu à la date prévue du départ. Corrigez sa date si nécessaire.');
    const ids = loaded.map(item => item?.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return refused(400, '22023', 'Dossiers embarqués invalides ou dupliqués');
    const attached = tables.colis.filter(parcel => parcel.envoi_id === envoi.id);
    if (ids.some(id => !attached.some(parcel => parcel.id === id))) return refused(409, '40001', 'Un dossier sélectionné n’appartient plus à ce départ');
    const others = attached.filter(parcel => !ids.includes(parcel.id) && !parcel.date_expedition && !['annule', 'livre', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(parcel.statut));
    if (others.length && !allowed('perm_envois_reaffecter')) return refused(403, '42501', 'Permission de réaffectation requise pour reporter les autres dossiers');
    if (others.length && !String(input.p_deferred_reason ?? '').trim()) return refused(400, '22023', 'Expliquez le report des dossiers non embarqués');
    // Every loaded dossier is validated before any write: the server's transaction keeps nothing of a refusal.
    const plan = [];
    for (const item of loaded) {
      const parcel = attached.find(row => row.id === item.id), ref = parcel.ref;
      const given = item.outgoing_parcel_count == null ? null : Number(item.outgoing_parcel_count);
      if (!sameInstant(item.updated_at, parcel.updated_at)) return refused(409, '40001', `Le dossier ${ref} a changé. Rechargez le chargement.`);
      if (parcel.archive || parcel.statut !== 'paye' || !parcel.paiement_date || Number(parcel.paiement_montant || 0) < Number(parcel.devis_total || 0) || !(Number(parcel.devis_total) > 0)) return refused(400, '22023', `${ref} : paiement confirmé et complet requis avant départ`);
      if (destinationOf(parcel) !== envoi.destination_code) return refused(400, '22023', `${ref} : destination incompatible`);
      if (!finalMeasured(parcel)) return refused(400, '22023', `${ref} : mesures finales manquantes`);
      if (parcel.final_packages != null && !Array.isArray(parcel.final_packages)) return refused(400, '22023', `${ref} : mesures sortantes invalides`);
      if (listsParcels(parcel)) {
        if (parcel.outgoing_parcel_count !== parcel.final_packages.length || (parcel.preparation_composition_version ?? null) !== (parcel.final_measurements_version ?? null)) return refused(400, '22023', `${ref} : préparation sortante à vérifier`);
      } else if ((given ?? parcel.outgoing_parcel_count) !== 1) return refused(400, '22023', `${ref} : les mesures historiques décrivent un seul colis ; vérifiez physiquement ce colis avant confirmation`);
      const count = given ?? parcel.outgoing_parcel_count;
      if (!(count > 0)) return refused(400, '22023', `${ref} : confirmez le nombre de colis physiques sortants`);
      if (parcel.outgoing_parcel_count != null && count !== parcel.outgoing_parcel_count) return refused(409, '40001', `${ref} : le nombre sortant ne correspond plus à la préparation`);
      const control = loadingEvidence(envoi, parcel, count);
      if (control.refusal) return control.refusal;
      plan.push({ parcel, count, evidence: control.evidence });
    }
    const stamp = new Date(server.now()).toISOString();
    const deferred = others.map(parcel => ({ id: parcel.id, ref: parcel.ref, reason: input.p_deferred_reason }));
    for (const parcel of others) { parcel.envoi_id = null; touch(parcel); }
    const excluded = attached.filter(parcel => !ids.includes(parcel.id) && !others.includes(parcel)).map(parcel => ({ id: parcel.id, ref: parcel.ref, statut: parcel.statut, reason: 'Dossier historique ou annulé : hors chargement' }));
    const items = plan.map(({ parcel, count, evidence }) => {
      Object.assign(parcel, { statut: 'expedie', date_expedition: stamp, outgoing_parcel_count: count }); touch(parcel);
      const lignes = tables.lignes.filter(line => line.colis_id === parcel.id && (!line.facture_id || tables.factures.some(invoice => invoice.id === line.facture_id && activeInvoice(invoice))));
      return { legacy_measurements_confirmed: !listsParcels(parcel), colis: copy(parcel), client: copy(tables.clients.find(client => client.id === parcel.client_id) ?? null), lignes: copy(lignes),
        factures: copy(tables.factures.filter(invoice => invoice.colis_id === parcel.id && activeInvoice(invoice))),
        categories: copy(tables.categories.filter(category => lignes.some(line => line.categorie_id === category.id))), loading_checks: evidence };
    });
    const volume = parcel => (listsParcels(parcel) ? parcel.final_packages : [{ dimL: parcel.fin_l, dimW: parcel.fin_w, dimH: parcel.fin_h }]).reduce((sum, box) => sum + Number(box.dimL) * Number(box.dimW) * Number(box.dimH) / 1000000, 0);
    Object.assign(envoi, { statut: 'parti', departed_at: stamp, manifest_version: 1, nb_colis: ids.length,
      poids_total: plan.reduce((sum, { parcel }) => sum + Number(parcel.fin_p), 0), volume_total: plan.reduce((sum, { parcel }) => sum + volume(parcel), 0) });
    touch(envoi);
    (tables.departure_manifests ||= []).push({ envoi_id: envoi.id, version: 1, confirmed_at: stamp, confirmed_by: user.id, snapshot: copy({ envoi, confirmed_at: stamp, items, deferred, excluded }) });
    return [200, envoi];
  }
  /** The loading-control commands, confirm_departure and get_departure_manifest; null for any other RPC. */
  function loadingRpc(rpc, input) {
    if (rpc === 'confirm_departure') return confirmDeparture(input);
    if (rpc === 'get_departure_manifest') {
      if (!allowed('perm_envois_voir')) return refused(403, '42501', 'Permission de consultation des envois requise');
      const manifest = (tables.departure_manifests || []).find(row => row.envoi_id === input?.p_envoi_id);
      return manifest ? [200, manifest.snapshot] : refused(400, 'P0002', 'Le chargement de ce départ n’a pas été confirmé. Aucun manifeste historique fiable n’est disponible.');
    }
    if (rpc === 'get_loading_checks') {
      // One JSON array, as the server returns a single jsonb value (PostgREST's max-rows never cuts it).
      if (!allowed('perm_envois_voir')) return refused(403, '42501', 'Permission de consultation des envois requise', 'permission');
      if (!tables.envois.some(row => row.id === input?.p_envoi_id)) return refused(400, 'P0002', 'Départ introuvable', 'departure_not_found');
      return [200, loadingChecks().filter(row => row.envoi_id === input.p_envoi_id && tables.colis.some(parcel => parcel.id === row.colis_id && parcel.envoi_id === row.envoi_id))
        .sort((a, b) => String(a.colis_id).localeCompare(String(b.colis_id)) || a.parcel_index - b.parcel_index).map(checkJson)];
    }
    if (!['record_loading_check', 'record_loading_count', 'clear_loading_checks'].includes(rpc)) return null;
    if (!allowed('perm_colis_expedier')) return refused(403, '42501', 'Permission d’expédition requise pour contrôler le chargement', 'permission');
    if (rpc === 'record_loading_check') {
      if (!['scan', 'camera'].includes(input?.p_method)) return refused(400, '22023', 'Contrôle inconnu : scannez l’étiquette, ou comptez les colis du dossier.', 'invalid_method');
      const { p_parcel_index: index, p_parcel_count: count } = input;
      if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) return refused(400, '22023', 'Étiquette illisible : numéro de colis invalide. Scannez-la à nouveau.', 'invalid_label');
    }
    if (rpc === 'record_loading_count' && (!Number.isInteger(input?.p_counted) || input.p_counted < 0)) return refused(400, '22023', 'Indiquez le nombre de colis comptés.', 'invalid_count');
    const target = loadingTarget(input, rpc !== 'clear_loading_checks');
    if (target.refusal) return target.refusal;
    const { envoi, parcel } = target, expected = expectedParcels(parcel), now = new Date(server.now()).toISOString();
    if (rpc === 'clear_loading_checks') {
      const removed = dossierChecks(envoi.id, parcel.id);
      tables.departure_loading_checks = loadingChecks().filter(row => !removed.includes(row));
      if (removed.length) (tables.audit_actions ||= []).push({ id: crypto.randomUUID(), colis_id: parcel.id, user_id: user.id, user_nom: checkerName(user.id), action: 'loading_checks_cleared', detail: JSON.stringify({ envoi_id: envoi.id, cleared: removed.length }), before_data: removed.map(checkJson), created_at: now });
      return [200, { status: removed.length ? 'cleared' : 'none', cleared: removed.length, checked: 0, expected }];
    }
    if (rpc === 'record_loading_check' && input.p_parcel_count !== expected) return refused(400, '22023', `Étiquette périmée : ce dossier compte maintenant ${expected} colis. Réimprimez ses étiquettes.`, 'stale_label');
    if (rpc === 'record_loading_count' && input.p_counted !== expected) return refused(400, '22023', `Comptage différent : ${parcel.ref} compte ${expected} colis, vous en avez compté ${input.p_counted}. Recomptez ses colis, ou reportez-le.`, 'count_mismatch');
    // Checks of another count describe older labels: the current labels replace them.
    tables.departure_loading_checks = loadingChecks().filter(row => !(row.envoi_id === envoi.id && row.colis_id === parcel.id && row.parcel_count !== expected));
    const indexes = rpc === 'record_loading_check' ? [input.p_parcel_index] : Array.from({ length: expected }, (_, position) => position + 1);
    let added = 0;
    for (const index of indexes) {
      if (dossierChecks(envoi.id, parcel.id).some(row => row.parcel_index === index)) continue;
      loadingChecks().push({ envoi_id: envoi.id, colis_id: parcel.id, parcel_index: index, parcel_count: expected, method: rpc === 'record_loading_check' ? input.p_method : 'count', checked_by: user.id, checked_at: now });
      added += 1;
    }
    const status = added ? 'recorded' : 'already', checked = dossierChecks(envoi.id, parcel.id).length;
    if (rpc === 'record_loading_count') return [200, { status, checked, expected, added }];
    return [200, { status, checked, expected, check: checkJson(dossierChecks(envoi.id, parcel.id).find(row => row.parcel_index === input.p_parcel_index)) }];
  }
  const user = {
    id: A,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'audit@example.test',
    user_metadata: { role: role === 'client' ? 'directeur' : 'client', nom: 'Metadata non fiable' },
    created_at: new Date().toISOString(),
  };
  const token =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({ sub: A, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url') +
    '.test';
  const session = {
    access_token: token,
    refresh_token: 'test',
    token_type: 'bearer',
    expires_in: 3600,
    user,
  };
  function filterRows(rows, params) {
    return rows.filter((row) =>
      [...params].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true;
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value.startsWith('neq.')) return String(row[key]) !== value.slice(4);
        if (value.startsWith('gt.')) return String(row[key]) > value.slice(3);
        if (value.startsWith('in.('))
          return value.slice(4, -1).split(',').includes(String(row[key]));
        return true;
      }),
    );
  }
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method();
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue();
    const input = ['POST', 'PATCH', 'PUT'].includes(method) ? req.postDataJSON() : null;
    requests.push({ method, path: url.pathname, search: url.search, input });
    if (method === 'GET' && url.pathname.includes('/storage/v1/object/sign/')) {
      const { jsPDF } = require('jspdf');
      const pdf = new jsPDF(); pdf.text('Facture fictive - Boutique A - 100 EUR HT', 20, 30);
      pdf.addPage(); pdf.text('Page 2 - Detail des articles et montant HT', 20, 60); pdf.text('Article A : 100 EUR HT', 20, 80);
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(pdf.output('arraybuffer')) });
    }
    let body = {},
      status = 200;
    const responseHeaders = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    // Each request is one server write: the forget trigger and the cascades apply once it is handled (synchronously).
    const written = beforeWrite();
    if (url.pathname.includes('/auth/v1/token')) body = session;
    else if (url.pathname.includes('/auth/v1/user')) body = user;
    else if (url.pathname.includes('/auth/v1/logout')) {
      status = 204;
      body = null;
    } else if (url.pathname.includes('/auth/v1/recover')) body = {};
    else if (url.pathname.endsWith('/functions/v1/get-tracking')) body = {
      ok: true, expediteur: 'Camille E.', destination: { cp: '97400', ville: 'Saint-Denis' },
      colis: [{ ref: 'EXP-TEST-001', desc: 'Deux achats à regrouper', statut: 'attente_paiement', quoteNeedsReview: false, receivedCount: 2, preparedPackages: [{ L: 30, W: 20, H: 20, P: 5 }], outgoingParcelCount: 1, dateReception: '2026-09-08T08:00:00Z', dims: { L: 30, W: 20, H: 20, P: 5 } }],
    };
    else if (url.pathname.endsWith('/functions/v1/ocr-facture') && input?.action === 'resume') body = { success: true, extraction: null };
    else if (url.pathname.endsWith('/functions/v1/client-invoice-deposit')) {
      // Portal deposit (D3), idempotent on the private path. The lock, PayPlug
      // and freeze branches are covered by the SQL/Edge suites and by
      // tests/client-late-invoice.browser.cjs.
      const parcel = tables.colis.find(item => item.id === input?.colisId);
      if (!parcel || typeof input?.path !== 'string' || !input.path.startsWith(parcel.id + '/') || input.path.includes('..')) { status = 400; body = { error: 'Document rattaché à un autre colis' }; }
      else if (frozenReason(parcel)) body = { ok: true, status: 'frozen' };
      else {
        let invoice = tables.factures.find(item => item.colis_id === parcel.id && item.fichier_url === input.path);
        if (!invoice) {
          invoice = { id: crypto.randomUUID(), colis_id: parcel.id, vendeur: (input.vendor || '').trim() || input.fileName, montant: 0, valide: false, fichier_url: input.path, fichier_nom: input.fileName, replaces_facture_id: input.replacesFactureId || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          tables.factures.push(invoice);
        }
        body = { ok: true, status: 'added', facture: invoice };
      }
    }
    else if (url.pathname.endsWith('/functions/v1/invoice-quote-withdrawal')) {
      // Staff D2 withdrawal: PayPlug proof first, then the database (SQL/Edge suites).
      const parcel = tables.colis.find(item => item.id === input?.colisId);
      if (!parcel) { status = 404; body = { error: 'Dossier introuvable.' }; }
      else if (input.action === 'retry') body = { ok: true, withdrawal: { id: input.withdrawalId, status: 'pending' } };
      else if (input.expectedUpdatedAt !== parcel.updated_at) { status = 409; body = { ok: false, code: '40001', error: 'Le dossier a changé. Actualisez puis réessayez.' }; }
      else {
        const linked = !!(parcel.payplug_payment_id || parcel.payplug_payment_url), changed = invoiceLock(parcel).quoteLocked;
        if (changed) Object.assign(parcel, { statut: quoteSent(parcel) ? 'en_preparation' : parcel.statut, devis_total: null, devis_snapshot: null, devis_brouillon: true, payplug_payment_id: null, payplug_payment_url: null, quote_version: (parcel.quote_version || 0) + 1, updated_at: new Date(Math.max(Date.now(), Date.parse(parcel.updated_at) + 1000)).toISOString() });
        body = { ok: true, changed, colis: parcel, withdrawal: changed ? { id: crypto.randomUUID(), colis_id: parcel.id, source: input.action === 'import_attachment' ? 'conversation_import' : 'staff', action: input.action, status: 'withdrawn', link_cancelled: linked, reason: input.reason } : null, paymentLinkCancelled: changed && linked };
      }
    }
    else if (url.pathname.includes('/storage/v1/object/sign/'))
      body = { signedURL: '/storage/v1/object/sign/factures/test.pdf?token=fake' };
    else if (url.pathname.includes('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').pop(),
        colis = tables.colis.find((c) => c.id === input?.p_colis_id);
      const loading = loadingRpc(rpc, input);
      if (loading) [status, body] = loading;
      else if (rpc === 'client_outgoing_tracking') body = tables.colis.filter(c => input.p_colis_ids.includes(c.id) && tables.clients.some(client => client.id === c.client_id && client.user_id === user.id) && ['expedie','transit','dedouanement','arrive','livraison','livre'].includes(c.statut)).map(c => ({ colis_id: c.id, tracking_principal: tables.envois.find(envoi => envoi.id === c.envoi_id)?.tracking_principal || null }));
      // client_planned_departures (20261007000002): own dossiers at the listed steps, a non-archived departure still to
      // come before departure, the confirmed one after; supabase/tests/client-planned-departure.sql covers it in depth.
      else if (rpc === 'client_planned_departures') body = tables.colis.filter(c => (input.p_colis_ids || []).includes(c.id) && tables.clients.some(client => client.id === c.client_id && client.user_id === user.id)
        && !c.archive && ['autorise','en_preparation','devis_envoye','attente_paiement','paye','expedie'].includes(c.statut)).flatMap(c => {
        const envoi = tables.envois.find(item => item.id === c.envoi_id);
        const shown = Boolean(envoi?.date_depart) && envoi.statut !== 'archive' && (c.statut === 'expedie' ? Boolean(envoi.departed_at) : !envoi.departed_at && envoi.date_depart >= parisClock(server.now()).day);
        return shown ? [{ colis_id: c.id, date_depart: envoi.date_depart }] : [];
      });
      else if (rpc === 'suggest_customs_tariffs') body = (input.p_items || []).map(item => ({ lineId: item.lineId, candidates: [], status: 'no_match', notice: 'Catalogue fictif sans proposition automatique.' }));
      else if (rpc === 'get_invoice_review_context') body = {
        invoices: tables.factures.filter(invoice => invoice.colis_id === input.p_colis_id).map(invoice => { const reason = analysisReason(colis, invoice, null); return { factureId: invoice.id, reviewToken: 'fixture-review-' + invoice.id, extraction: null, draft: null, documentHash: null, duplicateCandidateIds: [], analysisAllowed: reason === null, analysisBlockedReason: reason }; }),
        unlinkedLines: tables.lignes.filter(line => line.colis_id === input.p_colis_id && !line.facture_id),
        lock: invoiceLock(colis),
      };
      else if (rpc === 'open_invoice_modification' || rpc === 'close_invoice_modification') {
        // D1 commands: the draft itself is modelled by the invoice suites.
        const invoice = tables.factures.find(item => item.id === input.p_facture_id);
        if (!invoice) { status = 400; body = { code: '22023', message: 'Facture introuvable.' }; }
        else body = rpc === 'open_invoice_modification' ? { reviewToken: 'fixture-review-' + invoice.id, draft: null, created: false } : { reviewToken: 'fixture-review-' + invoice.id, closed: true };
      }
      else if (rpc === 'get_reception_dates') body = tables.colis.filter(parcel=>(input.p_colis_ids || []).includes(parcel.id)).map(parcel=>({colis_id:parcel.id,reception_dates:parcel.reception_dates || []}));
      else if (rpc === 'refresh_staff_work_actions') body = null;
      else if (rpc === 'save_message_template') {
        const existing = tables.message_templates.find(row => row.key === input.p_key && row.canal === input.p_canal);
        if ((existing?.body ?? null) !== input.p_expected) {
          status = 409; body = { code: '40001', message: 'Le modèle a changé. Rechargez sa version enregistrée.' };
        } else {
          const saved = { ...(existing || { id: crypto.randomUUID() }), key: input.p_key, canal: input.p_canal, body: input.p_body };
          if (existing) Object.assign(existing, saved); else tables.message_templates.push(saved);
          body = saved.body;
        }
      }
      else if (rpc === 'append_reception_cartons') {
        // Model the command boundary used by receipt UI tests. SQL tests cover
        // locking, provider evidence, permissions and all validation branches.
        const cartons = input.p_cartons || [];
        if (input.p_expected_updated_at !== colis?.updated_at) {
          status = 409; body = { code: '40001', message: 'Le dossier a été modifié par un collègue. Actualisez-le ; vos saisies sont conservées.' };
        } else if (colis.paiement_date || colis.paiement_montant != null || colis.archive || !['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement'].includes(colis.statut)) {
          status = 400; body = { code: '22023', message: 'Ajoutez les cartons à un dossier ouvert, avant paiement et départ.' };
        } else if (colis.payplug_payment_url || colis.payplug_payment_id) {
          status = 400; body = { code: '22023', message: 'Un lien de paiement existe. Ouvrez Corriger le montant pour le fermer avant d’ajouter un carton. Aucun carton n’a été ajouté.' };
        } else {
          const oldCount = Math.max(colis.nb_colis || 0, colis.trackings_detail?.length || 0, colis.trackings?.length || 0, colis.dims_par_colis?.length || 0, 1);
          const details = Array.from({ length: oldCount }, (_, index) => colis.trackings_detail?.[index] || { number: colis.trackings?.[index] || '', fournisseur: '' });
          const boxes = Array.from({ length: oldCount }, (_, index) => colis.dims_par_colis?.[index] || (oldCount === 1 ? { dimL: colis.dim_l, dimW: colis.dim_w, dimH: colis.dim_h, poids: colis.poids } : {}));
          const keys = ['dimL','dimW','dimH','poids'];
          for (const carton of cartons) {
            boxes.push(Object.fromEntries(keys.map(key => [key, Number(carton[key])])));
            details.push({ number: carton.tracking || '', fournisseur: carton.fournisseur || '' });
          }
          const complete = boxes.every(box => keys.every(key => Number(box[key]) > 0));
          Object.assign(colis, {
            nb_colis: boxes.length, dims_par_colis: boxes, trackings_detail: details,
            trackings: [...(colis.trackings || []), ...cartons.map(carton => carton.tracking).filter(Boolean)],
            dim_l: complete ? Math.max(...boxes.map(box => +box.dimL)) : null,
            dim_w: complete ? Math.max(...boxes.map(box => +box.dimW)) : null,
            dim_h: complete ? Math.max(...boxes.map(box => +box.dimH)) : null,
            poids: complete ? Math.round(boxes.reduce((sum, box) => sum + +box.poids, 0) * 100) / 100 : null,
            statut: complete ? 'mesure' : 'receptionne', feu_vert: 'en_attente', feu_vert_date: null,
            attente_client_date: null, attente_client_until: null, demande_feu_vert_envoyee_at: null,
            preparation_composition_version: (colis.preparation_composition_version || 0) + 1,
            final_measurements_version: null, final_measurements_at: null,
            devis_total: null, devis_snapshot: null, devis_brouillon: true,
            updated_at: new Date(Math.max(Date.now(), Date.parse(colis.updated_at)) + 1000).toISOString(),
          });
          if (input.p_casier?.trim()) colis.casier = input.p_casier.trim();
          if (input.p_notes_reception?.trim()) colis.notes_reception = [colis.notes_reception, input.p_notes_reception.trim()].filter(Boolean).join('\n');
          colis.check_interdits = [...new Set([...(colis.check_interdits || []), ...(input.p_check_interdits || [])])];
          colis.produit_interdit = colis.produit_interdit || colis.check_interdits.length > 0;
          body = { colis, added: cartons.length, firstCarton: oldCount + 1, lastCarton: boxes.length };
        }
      }
      else if (rpc === 'save_preparation_measurements') {
        if (input.p_expected_updated_at !== colis.updated_at || input.p_expected_composition_version !== colis.preparation_composition_version) {
          status = 409; body = { code: '40001', message: 'Le dossier a changé. Votre brouillon est conservé.' };
        } else {
          const boxes = input.p_final_packages;
          Object.assign(colis, { statut: 'en_preparation', final_packages: boxes, fin_l: Math.max(...boxes.map(b => +b.dimL)), fin_w: Math.max(...boxes.map(b => +b.dimW)), fin_h: Math.max(...boxes.map(b => +b.dimH)), fin_p: boxes.reduce((n,b) => n + +b.poids, 0), final_measurements_version: colis.preparation_composition_version, final_measurements_at: new Date().toISOString(), outgoing_parcel_count: boxes.length, updated_at: new Date().toISOString() });
          body = { colis };
        }
      }
      else if (rpc === 'save_quote') {
        const m = {
          devisTransport: 'devis_transport',
          devisOM: 'devis_om',
          devisOMR: 'devis_omr',
          devisTVA: 'devis_tva',
          devisTotal: 'devis_total',
          poidsFact: 'poids_facturable',
          avantOptimTransport: 'avant_optim_transport',
          avantOptimTotal: 'avant_optim_total',
          economie: 'economie',
          finL: 'fin_l',
          finW: 'fin_w',
          finH: 'fin_h',
          finP: 'fin_p',
          fraisDivers: 'frais_divers',
          finalPackages: 'final_packages',
        };
        for (const [key, value] of Object.entries(input.p_snapshot))
          if (m[key]) colis[m[key]] = value;
        colis.devis_snapshot = input.p_snapshot;
        colis.quote_version++;
        colis.updated_at = new Date().toISOString();
        body = { colis, quote: { version: colis.quote_version } };
      } else if (rpc === 'client_decision') {
        if (input.p_action === 'wait') {
          colis.attente_client_date = new Date().toISOString();
          colis.attente_client_motif = input.p_reason;
          colis.attente_client_until = input.p_wait_until;
        } else {
          colis.statut = input.p_action === 'approve' ? 'autorise' : 'refuse_client';
          colis.feu_vert = input.p_action === 'approve' ? 'autorise' : 'refuse';
        }
        colis.updated_at = new Date().toISOString();
        body = colis;
      } else if (['assign_colis_departure', 'set_colis_departure_wish', 'create_departure_for_colis'].includes(rpc)) {
        const refusal = departureRefusal(rpc, colis, input);
        const today = parisClock(server.now()).day;
        const destination = colis && destinationOf(colis);
        if (refusal) [status, body] = refusal;
        else if (rpc === 'assign_colis_departure') {
          if (input.p_envoi_id && !validDeparture(tables.envois.find(envoi => envoi.id === input.p_envoi_id), colis)) { status = 400; body = { code: '22023', message: 'Départ incompatible, passé ou clôturé' }; }
          else {
            Object.assign(colis, { envoi_id: input.p_envoi_id || null, depart_souhaite: input.p_envoi_id ? null : colis.depart_souhaite ?? null });
            bump(colis); body = colis;
          }
        } else if (input.p_date && input.p_date < today || rpc === 'create_departure_for_colis' && !input.p_date) { status = 400; body = { code: '22023', message: 'Choisissez une date à venir.' }; }
        else if (rpc === 'set_colis_departure_wish') {
          // The valid departure of that day is assigned (the current one first), otherwise the day is kept.
          const departure = input.p_date ? tables.envois.filter(envoi => envoi.date_depart === input.p_date && validDeparture(envoi, colis))
            .sort((a, b) => Number(a.id !== colis.envoi_id) - Number(b.id !== colis.envoi_id) || String(a.id).localeCompare(String(b.id)))[0] : null;
          Object.assign(colis, { envoi_id: input.p_date ? departure?.id ?? null : colis.envoi_id, depart_souhaite: departure ? null : input.p_date || null });
          bump(colis); body = colis;
        } else if (!['974', '976', '971', '972'].includes(destination)) { status = 400; body = { code: '22023', message: 'Destination du client inconnue : complétez son code postal.' }; }
        else {
          // One departure per destination and day: only an open one is reused; a day whose departure is closed or gone is refused.
          let envoi = tables.envois.filter(item => item.date_depart === input.p_date && validDeparture(item, colis)).sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
          const dayTaken = !envoi && tables.envois.some(item => item.destination_code === destination && item.date_depart === input.p_date && item.statut !== 'archive');
          if (dayTaken) { status = 400; body = { code: '22023', message: 'Le départ de ce jour est clôturé : choisissez un autre jour.' }; }
          else if (!envoi && Date.parse(departureDefaultClosing(input.p_date)) <= server.now()) { status = 400; body = { code: '22023', message: 'La clôture de ce départ est déjà passée.' }; }
          else {
            if (!envoi) {
              const stamp = new Date(server.now()).toISOString();
              envoi = { id: crypto.randomUUID(), ref: `ENV-${input.p_date.slice(0, 4)}-${String(900 + tables.envois.length).padStart(3, '0')}`, date_depart: input.p_date, destination_code: destination, statut: 'planifie', mode_transport: 'aerien',
                loading_closes_at: departureDefaultClosing(input.p_date), cree_par: A, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: stamp, updated_at: stamp };
              tables.envois.push(envoi);
            }
            Object.assign(colis, { envoi_id: envoi.id, depart_souhaite: null });
            bump(colis); body = { colis, envoi };
          }
        }
      } else if (rpc === 'acquire_colis_lock')
        body = { staff_id: A, staff_nom: 'Camille', locked_at: new Date().toISOString() };
      else if (rpc === 'release_colis_lock') body = true;
      else if (rpc === 'queue_message') {
        const message = {
          id: crypto.randomUUID(),
          colis_id: input.p_colis_id,
          texte: input.p_text,
          type: 'staff',
          auteur_nom: 'Camille',
          statut: input.p_canal === 'portal' ? 'en_attente' : 'envoi',
          canal: input.p_canal,
          created_at: new Date().toISOString(),
        };
        tables.messages.push(message);
        body = { message, outbox: { id: crypto.randomUUID() } };
      } else if (rpc === 'create_telegram_invitation')
        body = {
          token: 'one-use-token',
          url: 'https://t.me/Expedilebot?start=one-use-token',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        };
      else {
        status = 400;
        body = { message: 'Unexpected RPC ' + rpc };
      }
    } else if (url.pathname.includes('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      if (['departure_loading_checks', 'departure_manifests'].includes(table)) {
        // Read and written through the commands only (no privilege, RLS without policy).
        status = 403;
        body = { code: '42501', message: `permission denied for table ${table}` };
      } else if (table === failTable) {
        status = 503;
        body = { message: 'Indisponibilité simulée' };
      } else {
        let rows = filterRows(
          tables[table.replace(/^client_(clients|colis)$/, '$1')] || [],
          url.searchParams,
        );
        if (method === 'POST') {
          const inputs = Array.isArray(input) ? input : [input];
          body = [];
          for (const item of inputs) {
            let row =
              table === 'message_templates'
                ? tables[table].find((r) => r.key === item.key && r.canal === item.canal)
                : table === 'app_settings'
                  ? tables[table].find((r) => r.key === item.key)
                  : null;
            if (row) Object.assign(row, item);
            else {
              row = {
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...item,
              };
              (tables[table] ||= []).push(row);
            }
            body.push(row);
          }
        } else if (method === 'PATCH') {
          rows.forEach((row) =>
            Object.assign(row, input, { updated_at: new Date().toISOString() }),
          );
          body = rows;
        } else if (method === 'DELETE') {
          tables[table] = (tables[table] || []).filter((r) => !rows.includes(r));
          body = [];
        } else {
          const ordering = (url.searchParams.get('order') || '').split(',').filter(Boolean);
          if (ordering.length) rows.sort((a,b) => { for (const order of ordering) { const [key,direction] = order.split('.'); const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (compared) return direction === 'desc' ? -compared : compared; } return 0; });
          const offset = Number(url.searchParams.get('offset')) || 0;
          const limit = Number(url.searchParams.get('limit')) || rows.length;
          body = rows.slice(offset,offset + limit);
          responseHeaders['content-range'] = `${offset}-${Math.max(offset,offset + body.length - 1)}/${rows.length}`;
        }
        if (req.headers().accept?.includes('vnd.pgrst.object'))
          body = Array.isArray(body) ? body[0] || null : body;
      }
    } else {
      networkDenied.push(url.pathname);
      status = 400;
      body = { error: 'Blocked unexpected external request' };
    }
    afterWrite(written);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 204 ? '' : JSON.stringify(body),
      headers: responseHeaders,
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const login = async () => {
    await page.goto(base);
    await page.getByLabel('Email', { exact: true }).fill('audit@example.test');
    await page.getByLabel('Mot de passe', { exact: true }).fill('test-password-long');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#login-email') &&
        !document.body.innerText.includes('Chargement de votre espace'),
    );
  };
  /** confirm_departure's loading control alone: the refusal of the first loaded dossier not fully checked, or null. */
  const loadingControl = (envoiId, loaded) => {
    const envoi = tables.envois.find(row => row.id === envoiId);
    for (const item of loaded || []) {
      const parcel = tables.colis.find(row => row.id === item?.id);
      if (!envoi || !parcel) continue;
      const control = loadingEvidence(envoi, parcel, Number(item.outgoing_parcel_count ?? parcel.outgoing_parcel_count ?? expectedParcels(parcel)));
      if (control.refusal) return { status: control.refusal[0], body: control.refusal[1] };
    }
    return null;
  };
  /** Runs a mocked loading-control command as the signed-in user, without the page: { status, body }. */
  const rpc = (name, input) => {
    const answer = serverWrite(() => loadingRpc(name, input));
    if (!answer) throw new Error(`No mocked loading-control command ${name}`);
    return { status: answer[0], body: answer[1] };
  };
  // serverWrite: for a suite that mocks another command writing dossiers (correct-colis-task…), so that its write forgets
  // the loading checks as the server's trigger does: f.serverWrite(() => Object.assign(row, changes)).
  return { context, page, tables, requests, errors, networkDenied, login, server, rpc, loadingControl, serverWrite };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    let f = await setup(browser, 'client');
    await f.login();
    await f.page.waitForTimeout(400);
    assert.equal(
      await f.page.getByRole('heading', { name: 'Mon travail' }).count(),
      0,
      'Client must not enter staff dashboard despite forged metadata',
    );
    await f.page.screenshot({ path: path.join(output, 'client-home-desktop.png'), fullPage: true });
    await f.page.reload();
    await f.page.waitForTimeout(500);
    assert.equal(await f.page.locator('#login-email').count(), 0, 'Client session restored');
    await f.page.goto(base + '/colis/' + P);
    await f.page.getByRole('button', { name: 'Attendre d’autres achats' }).click();
    await f.page.locator('textarea').first().fill('Je souhaite regrouper une dernière commande.');
    await f.page.getByRole('button', { name: 'Enregistrer mon attente' }).click();
    await f.page.waitForFunction(
      () =>
        document.body.innerText.includes('attente est enregistrée') ||
        document.body.innerText.includes('attente demandée') ||
        document.body.innerText.includes('Attente demandée'),
    );
    assert.equal(
      f.tables.colis[0].attente_client_motif,
      'Je souhaite regrouper une dernière commande.',
    );
    f.tables.colis[0].attente_client_motif = 'Attente confirmée depuis un autre appareil.';
    await f.page.getByText('Reprendre ma décision', { exact: true }).click();
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Reprendre ma décision$/ }) }).getByText('Attente confirmée depuis un autre appareil.', { exact: true }).waitFor();
    assert.ok(f.requests.some((r) => r.path.endsWith('/client_colis')), 'Client refresh uses safe views');
    observations.push({ test: 'client-safe-view-refresh-on-focus', pass: true });
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.reload();
    await f.page.getByText('Reprendre ma décision', { exact: true }).click();
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    await f.page.locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Reprendre ma décision$/ }) }).getByText('Attente confirmée depuis un autre appareil.', { exact: true }).waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({
      path: path.join(output, 'client-detail-mobile.png'),
      fullPage: false,
    });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    observations.push({ test: 'client-login-canonical-role-session-wait', pass: true });
    await f.context.close();

    f = await setup(browser, 'directeur');
    await f.login();
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    await f.page.screenshot({
      path: path.join(output, 'staff-dashboard-desktop.png'),
      fullPage: true,
    });
    await f.page.reload();
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    observations.push({ test: 'staff-session-restored', pass: true });
    await f.page.goto(base + '/settings');
    await f.page.getByRole('heading', { name: 'Paramètres', exact: true }).waitFor();
    assert.equal(
      f.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/envois')).length,
      0,
      'Settings cannot create departures on navigation',
    );
    await f.page.getByRole('button', { name: 'Modèles de messages', exact: true }).click();
    await f.page
      .locator('textarea')
      .first()
      .fill('Bonjour {{prenom}}, votre dossier {{ref}} est disponible.');
    await f.page.getByRole('button', { name: 'Enregistrer le modèle', exact: true }).click();
    await f.page.getByText('Modèle enregistré. Aucun message n’a été envoyé.', { exact: true }).waitFor();
    assert.equal(
      f.tables.message_templates[0].body,
      'Bonjour {{prenom}}, votre dossier {{ref}} est disponible.',
    );
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Modèles de messages', exact: true }).click();
    assert.equal(
      await f.page.locator('textarea').first().inputValue(),
      f.tables.message_templates[0].body,
    );
    observations.push({ test: 'settings-no-implicit-writes-template-durable', pass: true });
    await f.page.goto(base + '/colis/' + P + '?section=devis');
    await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis' }).waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({
      path: path.join(output, 'staff-detail-desktop.png'),
      fullPage: true,
    });
    await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('preparation');
    await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).click();
    const num = f.page.locator('input[type="number"]');
    const labels = await num.evaluateAll((inputs) =>
      inputs.map((i) => ({
        value: i.value,
        placeholder: i.placeholder,
        aria: i.getAttribute('aria-label'),
      })),
    );
    observations.push({ test: 'quote-fields', fields: labels });
    // The final weight is the only number input initially equal to 3 in the preparation form.
    const weight = f.page.locator('input[type="number"]').filter({ visible: true });
    const candidates = await weight.count();
    let changed = false;
    for (let i = 0; i < candidates; i++)
      if ((await weight.nth(i).inputValue()) === '3') {
        await weight.nth(i).fill('5');
        changed = true;
        break;
      }
    assert.ok(changed, 'Final weight field found');
    await f.page.getByRole('button', { name: 'Enregistrer l’optimisation' }).click();
    await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).waitFor();
    await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('devis');
    await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis' }).click();
    await f.page.getByRole('button', { name: 'Envoyer le devis au client' }).waitFor();
    assert.equal(f.tables.colis[0].devis_transport, 50);
    assert.equal(Number(f.tables.colis[0].fin_p), 5);
    assert.equal(f.tables.colis[0].quote_version, 1);
    observations.push({
      test: 'quote-explicit-latest-weight-persisted',
      pass: true,
      total: f.tables.colis[0].devis_total,
    });
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.goto(base + '/colis?dossier=' + P);
    await f.page.getByTestId('dossier-task-header').waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({ path: path.join(output, 'staff-detail-mobile.png'), fullPage: true });
    const visibleControls = await f.page
      .locator('input,button,textarea,select')
      .evaluateAll((elements) =>
        elements
          .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
          .map((e) => ({
            text: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 35),
            x: e.getBoundingClientRect().x,
            right: e.getBoundingClientRect().right,
          }))
          .filter((r) => r.x < 0 || r.right > window.innerWidth + 1),
      );
    assert.deepEqual(visibleControls, [], 'No visible detail control clipped offscreen');
    await f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
    await f.page.waitForURL(url => url.pathname === '/colis');
    assert.ok(!f.page.url().includes(P), 'Explicit return restores list without reopening dossier');
    observations.push({ test: 'mobile-full-page-detail-controls-and-return', pass: true });
    await f.page.goto(base + '/');
    const openReception = () => f.page.getByRole('button', { name: /Nouveau colis|Réceptionner/ }).first().click();
    await openReception();
    const reception = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
    await reception.waitFor();
    await f.page.waitForTimeout(100);
    await f.page.screenshot({ path: path.join(output, 'reception-mobile.png'), fullPage: true });
    await f.page.keyboard.press('Escape');
    assert.equal(await reception.count(), 1, 'Escape does not discard a full-page receipt.');
    await reception.getByPlaceholder('Rechercher un client…').fill('Camille');
    await reception.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    await reception.getByRole('button', { name: 'Créer une nouvelle expédition (nouveau EXP)', exact: true }).click();
    const receiptWeight = reception.getByLabel('Poids à réception (kg) · carton 1', { exact: true });
    await receiptWeight.fill('2.75');
    await f.page.getByRole('button', { name: 'Retour à ma liste, conserver le brouillon', exact: true }).click();
    await f.page.waitForURL(url => url.pathname === '/');
    await openReception(); await receiptWeight.waitFor();
    assert.equal(await receiptWeight.inputValue(), '2.75', 'Explicit departure and reopening preserve the receipt draft.');
    await reception.getByRole('button', { name: 'Terminer la réception', exact: true }).scrollIntoViewIfNeeded();
    const clipped = await reception.locator('input,button,textarea,select').evaluateAll(elements => elements
      .filter(e => e.getClientRects().length).map(e => ({ label: e.textContent.trim().slice(0, 40), x: e.getBoundingClientRect().x, right: e.getBoundingClientRect().right }))
      .filter(e => e.x < 0 || e.right > window.innerWidth + 1));
    assert.deepEqual(clipped, [], 'Long reception controls stay within mobile viewport');
    await f.page.screenshot({ path: path.join(output, 'reception-long-mobile.png') });
    await f.page.getByRole('button', { name: 'Retour à ma liste, conserver le brouillon', exact: true }).click();
    observations.push({ test: 'reception-full-page-mobile-controls-and-preserved-draft', pass: true });
    await f.page.goto(base + '/settings');
    await f.page.getByRole('heading', { name: 'Paramètres', exact: true }).waitFor();
    await f.page.waitForTimeout(350);
    const settingsNav = f.page.getByRole('navigation', { name: 'Paramètres', exact: true });
    const settingsSection = settingsNav.getByLabel('Rubrique', { exact: true });
    const sections = await settingsSection.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent })));
    assert.equal(sections.length, 7, 'All seven settings sections remain reachable on mobile');
    for (const section of sections) {
      await settingsSection.selectOption(section.value);
      await f.page.getByRole('heading', { name: section.label, exact: true }).waitFor();
      assert.ok(await settingsSection.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth + 1; }), 'Settings selector stays entirely inside mobile viewport');
    }
    observations.push({ test: 'mobile-settings-labels-and-section-navigation', pass: true });
    await f.page.screenshot({ path: path.join(output, 'settings-mobile.png'), fullPage: true });
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    await f.page.goto(base + '/');
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    await f.page.getByRole('button', { name: 'Passer en mode sombre', exact: true }).click();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({ path: path.join(output, 'staff-dashboard-dark.png'), fullPage: true });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
    observations.push({ test: 'staff-no-runtime-errors', pass: true });
    await f.context.close();

    f = await setup(browser, 'client');
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.goto(base + '/suivi/fixture-public-token-123456789');
    await f.page.getByText('EXP-TEST-001', { exact: true }).waitFor();
    await f.page.getByText('Règlement attendu du client', { exact: true }).waitFor();
    await f.page.getByText('Cartons et mesures', { exact: true }).click();
    await f.page.getByText('Colis sortant 1 · 30 × 20 × 20 cm · 5 kg', { exact: true }).waitFor();
    await f.page.getByText('Parcours du colis', { exact: true }).click();
    const timeline = f.page.getByRole('list', { name: 'Progression du colis' });
    assert.equal(await timeline.locator('li').count(), 8, 'All eight lifecycle phases remain available');
    assert.ok(await timeline.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Public timeline wraps without horizontal scrolling');
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Public tracking fits the mobile screen');
    await f.page.screenshot({ path: path.join(output, 'tracking-public-mobile.png'), fullPage: true });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
    observations.push({ test: 'public-tracking-payment-status-and-mobile-timeline', pass: true });
    await f.context.close();

    f = await setup(browser, 'directeur', { failTable: 'factures' });
    await f.login();
    await f.page.getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
    assert.equal(await f.page.getByText('EXP-TEST-001', { exact: true }).count(), 0);
    observations.push({ test: 'failed-related-data-no-demo-fallback', pass: true });
    await f.context.close();

    // ── An interrupted load is stated once per screen, with one « Réessayer » (domain/dataLoad.js) ──
    const spa = (page, target) => page.evaluate(route => { history.pushState({}, '', route); dispatchEvent(new PopStateEvent('popstate')); }, target);
    const failures = page => page.evaluate(() => {
      const shown = node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
      return { alerts: [...document.querySelectorAll('[role="alert"]')].filter(shown).map(node => node.innerText.replace(/\s+/g, ' ').trim()),
        retries: [...document.querySelectorAll('button')].filter(shown).filter(button => /^Réessayer$/.test(button.textContent.trim())).length };
    });
    // The screen is settled once its own reads are over: no loading view, the expected heading.
    async function oneFailure(page, route, heading, label) {
      await spa(page, route);
      await (typeof heading === 'string' ? page.getByRole('heading', { name: heading, exact: true }).first() : heading(page)).waitFor({ timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('[data-testid="loading-view"]') && !document.body.innerText.includes('Chargement de l’historique'), null, { timeout: 20000 });
      const state = await failures(page);
      assert.equal(state.alerts.length, 1, `${label} ${route}: one failure message (${JSON.stringify(state)})`);
      assert.equal(state.retries, 1, `${label} ${route}: one « Réessayer » (${JSON.stringify(state)})`);
      return state;
    }
    // 1. The first load failed, nothing held: the new-client form shows the shell's banner (it
    // has no failure of its own); the dossier page states nothing a second time.
    f = await setup(browser, 'directeur', { failTable: 'colis' });
    await f.login();
    let state = await oneFailure(f.page, '/clients/new', 'Nouveau client', 'first load');
    assert.match(state.alerts[0], /Indisponibilité simulée/);
    await oneFailure(f.page, `/colis/${P}`, 'Dossier pas encore disponible', 'first load');
    await f.page.getByText('Réessayez depuis le bandeau en haut de la page.', { exact: false }).waitFor();
    await oneFailure(f.page, '/settings', 'Chargement impossible', 'first load');
    await f.page.screenshot({ path: path.join(output, 'load-failure-first-settings.png') });
    assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
    observations.push({ test: 'first-load-failure-stated-once-per-screen', pass: true });
    await f.context.close();

    // 2. Loaded, then a refresh and its « Réessayer » failed: the data held stay readable under
    // the banner, never a second failure (Paramètres read only, the dossier, the client history).
    for (const team of ['with-dossiers', 'clients-only']) {
      f = await setup(browser, 'directeur');
      // A team with clients but no active dossier yet: the failure must still be visible.
      if (team === 'clients-only') f.tables.colis = [];
      const outage = { index: false, all: false };
      await f.context.route('**/rest/v1/colis?*', route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') return route.fallback();
        const index = url.searchParams.get('select') === 'id,updated_at,client_id';
        return outage.all || (outage.index && index) ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: outage.all ? 'Indisponibilité simulée' : 'Actualisation refusée (essai)' }) }) : route.fallback();
      });
      await f.login();
      await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
      outage.index = true;
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const banner = f.page.getByRole('alert').filter({ hasText: 'Actualisation des dossiers impossible' });
      await banner.waitFor();
      outage.all = true;
      await banner.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Chargement impossible : Indisponibilité simulée' }).waitFor({ timeout: 20000 });
      state = await oneFailure(f.page, '/clients', 'Clients', team);
      assert.match(state.alerts[0], /Chargement impossible : Indisponibilité simulée/, 'The banner, on the clients list too.');
      await f.page.getByText('Exemple Camille', { exact: true }).first().waitFor();
      await oneFailure(f.page, '/settings', 'Paramètres', team);
      await f.page.getByTestId('settings-read-only').waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Enregistrer les tarifs', exact: true }).isDisabled(), true, 'Read only until the data are loaded again.');
      await f.page.screenshot({ path: path.join(output, `load-failure-retry-settings-${team}.png`) });
      if (team === 'with-dossiers') {
        await oneFailure(f.page, `/colis/${P}`, page => page.getByTestId('dossier-task-header'), team);
        await oneFailure(f.page, `/clients/${C}`, 'Exemple Camille', team);
      } else {
        // An unknown client page refers to the banner, which is shown.
        await oneFailure(f.page, '/clients/c9999999-0000-4000-8000-000000000999', 'Fiche pas encore disponible', team);
        await f.page.getByText('Réessayez depuis le bandeau en haut de la page.', { exact: false }).waitFor();
      }
      assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
      observations.push({ test: `failed-retry-stated-once-per-screen-${team}`, pass: true });
      await f.context.close();
    }

    // ── Loading control (20261007000004): the mocked commands follow the server's rules, refusals and HINTs ──
    f = await setup(browser, 'directeur');
    {
      const E = 'e1000000-0000-4000-8000-0000000000aa', parcel = f.tables.colis[0];
      f.tables.envois = [{ id: E, ref: 'ENV-CONTROLE', destination_code: '974', date_depart: parisClock(f.server.now()).day, statut: 'planifie', updated_at: '2026-10-07T06:00:00Z', manifest_version: 0 }];
      Object.assign(parcel, { envoi_id: E, statut: 'paye', paiement_date: '2026-10-06T10:00:00Z', paiement_montant: 60, devis_total: 60, devis_snapshot: { inputs: { destination: { code: '974' } } } });
      const call = (name, input) => f.rpc(name, { p_envoi_id: E, p_colis_id: P, ...input });
      const loaded = () => ({ p_envoi_id: E, p_loaded: [{ id: P, updated_at: parcel.updated_at, outgoing_parcel_count: 1 }], p_expected_updated_at: f.tables.envois[0].updated_at, p_deferred_reason: null });
      const refusedWith = (answer, code, reason, message) => {
        assert.equal(answer.body.code, code); assert.equal(answer.body.hint, `loading_check:${reason}`);
        if (message) assert.equal(answer.body.message, message);
      };
      refusedWith(f.rpc('confirm_departure', loaded()), '22023', 'incomplete', 'Contrôle incomplet : EXP-TEST-001 (0/1 colis vérifié). Scannez ou comptez ses colis, ou reportez-le.');
      assert.deepEqual(JSON.parse(f.rpc('confirm_departure', loaded()).body.details), { colis_id: P, ref: 'EXP-TEST-001', checked: 0, expected: 1 });
      refusedWith(call('record_loading_check', { p_parcel_index: 1, p_parcel_count: 2, p_method: 'scan' }), '22023', 'stale_label', 'Étiquette périmée : ce dossier compte maintenant 1 colis. Réimprimez ses étiquettes.');
      refusedWith(call('record_loading_check', { p_parcel_index: 2, p_parcel_count: 1, p_method: 'scan' }), '22023', 'invalid_label');
      refusedWith(call('record_loading_check', { p_parcel_index: 1, p_parcel_count: 1, p_method: 'count' }), '22023', 'invalid_method');
      refusedWith(call('record_loading_count', { p_counted: 2 }), '22023', 'count_mismatch', 'Comptage différent : EXP-TEST-001 compte 1 colis, vous en avez compté 2. Recomptez ses colis, ou reportez-le.');
      refusedWith(f.rpc('record_loading_check', { p_envoi_id: E, p_colis_id: C, p_parcel_index: 1, p_parcel_count: 1, p_method: 'scan' }), 'P0002', 'dossier_not_found');
      const first = call('record_loading_check', { p_parcel_index: 1, p_parcel_count: 1, p_method: 'scan' });
      assert.equal(first.status, 200); assert.equal(first.body.status, 'recorded'); assert.equal(first.body.check.checked_by_name, 'Test Camille');
      const again = call('record_loading_check', { p_parcel_index: 1, p_parcel_count: 1, p_method: 'camera' });
      assert.equal(again.body.status, 'already'); assert.equal(again.body.check.method, 'scan'); assert.equal(again.body.check.checked_at, first.body.check.checked_at);
      assert.deepEqual(call('record_loading_count', { p_counted: 1 }).body, { status: 'already', checked: 1, expected: 1, added: 0 });
      assert.deepEqual(f.rpc('get_loading_checks', { p_envoi_id: E }).body.map(row => [row.colis_id, row.parcel_index, row.method]), [[P, 1, 'scan']]);
      assert.deepEqual(call('clear_loading_checks', {}).body, { status: 'cleared', cleared: 1, checked: 0, expected: 1 });
      assert.equal(f.tables.audit_actions.filter(row => row.action === 'loading_checks_cleared').length, 1);
      assert.equal(call('record_loading_count', { p_counted: 1 }).body.status, 'recorded');
      const confirmed = f.rpc('confirm_departure', loaded());
      assert.equal(confirmed.status, 200); assert.equal(confirmed.body.statut, 'parti'); assert.equal(parcel.statut, 'expedie');
      assert.deepEqual(f.rpc('get_departure_manifest', { p_envoi_id: E }).body.items[0].loading_checks.map(row => [row.parcel_index, row.method]), [[1, 'count']]);
      refusedWith(call('record_loading_check', { p_parcel_index: 1, p_parcel_count: 1, p_method: 'scan' }), '22023', 'departure_closed');
      // The checks are read and written through the commands only.
      await f.page.goto(base);
      assert.equal(await f.page.evaluate(async () => (await fetch('https://pinta-ci.supabase.co/rest/v1/departure_loading_checks?select=*')).status), 403);
      f.tables.staff_users[0].role = 'preparateur';
      refusedWith(call('record_loading_count', { p_counted: 1 }), '42501', 'permission', 'Permission d’expédition requise pour contrôler le chargement');
      assert.deepEqual(f.errors, []);
      observations.push({ test: 'loading-control-mock-follows-the-server', pass: true });
    }
    await f.context.close();

    // ── colis_loading_checks_forget in the mock: a dossier prepared again (the same count included), given a carton or
    // moved off its departure loses its loading checks; any other write, the confirmation included, keeps them ──
    f = await setup(browser, 'directeur');
    {
      const day = offset => new Date(Date.parse(`${parisClock(f.server.now()).day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
      const E = 'e1000000-0000-4000-8000-0000000000bb', LATER = 'e1000000-0000-4000-8000-0000000000bc', Q = '33333333-3333-4333-8333-3333333333aa';
      const departure = (id, ref, date) => ({ id, ref, destination_code: '974', date_depart: date, statut: 'planifie', loading_closes_at: null, departed_at: null, updated_at: '2026-10-07T06:00:00Z', manifest_version: 0 });
      f.tables.envois = [departure(E, 'ENV-OUBLI', day(0)), departure(LATER, 'ENV-SUIVANT', day(7))];
      const parcel = f.tables.colis[0];
      Object.assign(parcel, { envoi_id: E, final_packages: [{ dimL: 40, dimW: 30, dimH: 30, poids: 12 }, { dimL: 30, dimW: 30, dimH: 20, poids: 7.5 }], outgoing_parcel_count: 2, fin_l: 40, fin_w: 30, fin_h: 30, fin_p: 19.5 });
      const command = (name, input) => f.page.evaluate(async ([name, input]) => {
        const response = await fetch(`https://pinta-ci.supabase.co/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
      }, [name, input]);
      const checksOf = id => f.tables.departure_loading_checks.filter(row => row.colis_id === id).map(row => [f.tables.envois.find(envoi => envoi.id === row.envoi_id)?.ref ?? row.envoi_id, row.parcel_index]).sort();
      const both = ref => [[ref, 1], [ref, 2]];
      await f.page.goto(base);
      // Packed again into two other boxes: the same count and versions, a new preparation stamp.
      scanLoading(f, E, [P]);
      assert.deepEqual(checksOf(P), both('ENV-OUBLI'));
      let answer = await command('save_preparation_measurements', { p_colis_id: P, p_final_packages: [{ dimL: 60, dimW: 40, dimH: 40, poids: 16 }, { dimL: 20, dimW: 20, dimH: 10, poids: 3.5 }], p_expected_updated_at: parcel.updated_at, p_expected_composition_version: 1 });
      assert.equal(answer.status, 200); assert.deepEqual([parcel.outgoing_parcel_count, parcel.preparation_composition_version, parcel.final_measurements_version], [2, 1, 1]);
      assert.deepEqual(checksOf(P), [], 'Prepared again with the same count: the checks of the former boxes are dropped');
      assert.equal(f.rpc('record_loading_check', { p_envoi_id: E, p_colis_id: P, p_parcel_index: 1, p_parcel_count: 2, p_method: 'scan' }).body.status, 'recorded', 'A label of the new boxes is recorded afresh');
      // Any other write keeps them: a field of the dossier written through the API.
      scanLoading(f, E, [P]);
      assert.equal(await f.page.evaluate(async id => (await fetch(`https://pinta-ci.supabase.co/rest/v1/colis?id=eq.${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ casier: 'B-12' }) })).status, P), 200);
      assert.equal(parcel.casier, 'B-12'); assert.deepEqual(checksOf(P), both('ENV-OUBLI'), 'Any other write keeps the checks');
      // A suite mocking another command (correct-colis-task) writes through serverWrite: its new stamp drops them too.
      f.serverWrite(() => Object.assign(parcel, { final_packages: [{ dimL: 45, dimW: 35, dimH: 30, poids: 14 }, { dimL: 25, dimW: 20, dimH: 15, poids: 5.5 }], final_measurements_at: new Date(Date.parse(parcel.final_measurements_at) + 60000).toISOString() }));
      assert.deepEqual(checksOf(P), [], 'A corrected preparation drops the checks');
      // Moved to another departure, by its wish, or onto a departure created for it: its former checks go.
      scanLoading(f, E, [P]);
      answer = await command('assign_colis_departure', { p_colis_id: P, p_envoi_id: LATER, p_expected_updated_at: parcel.updated_at });
      assert.equal(answer.status, 200); assert.equal(parcel.envoi_id, LATER); assert.deepEqual(checksOf(P), [], 'Moved to another departure');
      scanLoading(f, LATER, [P]);
      answer = await command('set_colis_departure_wish', { p_colis_id: P, p_date: day(0), p_expected_updated_at: parcel.updated_at });
      assert.equal(answer.status, 200); assert.equal(parcel.envoi_id, E); assert.deepEqual(checksOf(P), [], 'Its wish moved it to today\'s departure');
      scanLoading(f, E, [P]);
      answer = await command('create_departure_for_colis', { p_colis_id: P, p_date: day(21), p_expected_updated_at: parcel.updated_at });
      assert.equal(answer.status, 200); assert.equal(parcel.envoi_id, answer.body.envoi.id); assert.deepEqual(checksOf(P), [], 'Put on a departure created for it');
      // A carton appended: the composition changes and the outgoing parcels are to prepare again.
      answer = await command('assign_colis_departure', { p_colis_id: P, p_envoi_id: E, p_expected_updated_at: parcel.updated_at });
      assert.equal(answer.status, 200);
      scanLoading(f, E, [P]);
      answer = await command('append_reception_cartons', { p_colis_id: P, p_cartons: [{ dimL: 20, dimW: 20, dimH: 20, poids: 2 }], p_expected_updated_at: parcel.updated_at });
      assert.equal(answer.status, 200); assert.deepEqual([parcel.preparation_composition_version, parcel.final_measurements_version], [2, null]);
      assert.deepEqual(checksOf(P), [], 'A carton appended drops the checks');
      // At the confirmation, the dossier deferred loses its checks; the loaded one keeps them, also in the reading.
      Object.assign(parcel, { statut: 'paye', feu_vert: 'autorise', paiement_date: '2026-10-06T10:00:00Z', paiement_montant: 60, devis_total: 60, devis_snapshot: { inputs: { destination: { code: '974' } } },
        outgoing_parcel_count: 2, final_measurements_version: 2, final_measurements_at: new Date().toISOString() });
      f.tables.colis.push({ ...structuredClone(parcel), id: Q, ref: 'EXP-TEST-002', statut: 'en_preparation', paiement_date: null, paiement_montant: null, devis_total: null, devis_snapshot: null });
      scanLoading(f, E, [P, Q]);
      assert.deepEqual(checksOf(Q), both('ENV-OUBLI'));
      const confirmed = f.rpc('confirm_departure', { p_envoi_id: E, p_loaded: [{ id: P, updated_at: parcel.updated_at, outgoing_parcel_count: 2 }], p_expected_updated_at: f.tables.envois[0].updated_at, p_deferred_reason: 'Paiement attendu' });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body)); assert.equal(confirmed.body.statut, 'parti');
      assert.equal(f.tables.colis.find(row => row.id === Q).envoi_id, null);
      assert.deepEqual(checksOf(Q), [], 'The deferred dossier leaves the departure with no check');
      assert.deepEqual(checksOf(P), both('ENV-OUBLI'), 'The loaded dossier keeps its checks through the confirmation');
      assert.deepEqual(f.rpc('get_loading_checks', { p_envoi_id: E }).body.map(row => [row.colis_id, row.parcel_index]), [[P, 1], [P, 2]]);
      assert.deepEqual(f.rpc('get_departure_manifest', { p_envoi_id: E }).body.items[0].loading_checks.map(row => row.parcel_index), [1, 2]);
      // A departure deleted takes its checks with it (the foreign key cascades).
      f.tables.departure_loading_checks.push({ envoi_id: LATER, colis_id: Q, parcel_index: 1, parcel_count: 2, method: 'scan', checked_by: A, checked_at: new Date().toISOString() });
      assert.equal(await f.page.evaluate(async id => (await fetch(`https://pinta-ci.supabase.co/rest/v1/envois?id=eq.${id}`, { method: 'DELETE' })).status, LATER), 200);
      assert.deepEqual(checksOf(Q), [], 'The checks follow their departure when it is deleted');
      assert.deepEqual(f.errors, []);
      observations.push({ test: 'loading-checks-forgotten-like-the-server-trigger', pass: true });
    }
    await f.context.close();
  } catch (error) {
    observations.push({ test: 'failure', message: error.stack });
    const failedPage = browser.contexts().flatMap(context => context.pages()).pop();
    if (failedPage) await failedPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (!process.exitCode) await fs.rm(path.join(output, 'failure.png'), { force: true });
    await fs.writeFile(
      path.join(output, 'browser-results.json'),
      JSON.stringify(observations, null, 2),
    );
    console.log(JSON.stringify(observations, null, 2));
  }
}
/**
 * Scans every outgoing parcel of these dossiers through the mocked command, as the loading control does on the
 * departure's screen, before a confirmation. Returns the commands' answers by dossier; throws on a refusal.
 */
function scanLoading(f, envoiId, colisIds, method = 'scan') {
  return Object.fromEntries(colisIds.map(colisId => {
    const parcel = f.tables.colis.find(row => row.id === colisId);
    const count = parcel && expectedParcels(parcel);
    if (!count) throw new Error(`No outgoing parcel to check for ${colisId}`);
    const answers = Array.from({ length: count }, (_, position) => f.rpc('record_loading_check', { p_envoi_id: envoiId, p_colis_id: colisId, p_parcel_index: position + 1, p_parcel_count: count, p_method: method }));
    const refusal = answers.find(answer => answer.status !== 200);
    if (refusal) throw new Error(`Loading check refused: ${refusal.body.message}`);
    return [colisId, answers.map(answer => answer.body)];
  }));
}
module.exports = { setup, fixtures, ids: { A, C, P, F, L, S }, base, invoiceLock, frozenReason, analysisReason, scanLoading, expectedParcels };
if (require.main === module) main();

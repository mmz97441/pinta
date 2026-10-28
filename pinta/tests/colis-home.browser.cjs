/* « Colis » (/) and the Brouillon sheet (/brouillon/:id), docs/specification-brouillon-reception-2026-10-28.md.
   Fictitious dossiers only: every request is answered by the shared mocked server (browser-regression.cjs) and by the
   commands mocked below (list_pending_receptions, list_arrival_notices, queue_message, send-telegram). Nothing real is
   read or sent. Screenshots go to PINTA_COLIS_HOME_OUT; PINTA_COLIS_HOME_FILTER runs the scenarios whose name contains it. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, registerRequestMock } = require('./browser-regression.cjs');

const output = process.env.PINTA_COLIS_HOME_OUT || '/tmp/pinta-colis-home';
const FILTER = process.env.PINTA_COLIS_HOME_FILTER || '';
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };
const TABLET_PORTRAIT = { viewport: { width: 768, height: 1024 }, hasTouch: true };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const results = [];

// ── Fictitious data ───────────────────────────────────────────────────────────
const NOW = Date.now();
const ago = (days, hours = 0) => new Date(NOW - days * 86400000 - hours * 3600000).toISOString();
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const parisDay = offset => PARIS_DAY.format(new Date(NOW + offset * 86400000));
const uuid = n => `c0115000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENT = { abdallah: uuid(101), boyer: uuid(102), grondin: uuid(103), hoarau: uuid(104), payet: uuid(105), riviere: uuid(106), techer: uuid(107), lebon: uuid(108), fontaine: uuid(109), maillot: uuid(110), dupont: uuid(111) };
const D = { abdallah: uuid(201), boyer: uuid(202), grondin: uuid(203), hoarau: uuid(204), payet: uuid(205), riviere: uuid(206), techer: uuid(207), lebon: uuid(208), fontaine: uuid(209), maillot: uuid(210), archive: uuid(211), techer2: uuid(212) };
const E = { past: uuid(300), soon: uuid(301), mayotte: uuid(302), later: uuid(303) };
const NOTICE = { riviere: uuid(401), techer: uuid(402) };
const MESSAGE = { riviere: uuid(501), techer: uuid(502) };
const RIVIERE_TEXT = 'Bonjour Marie-Claude,\n\nBonne nouvelle : nous avons reçu 2 colis pour vous à notre entrepôt de Paris. Nous vous tenons au courant à chaque étape.\n\nLe détail :\n1. Zara — ZARA-889 — 30 × 20 × 10 cm — 0,9 kg\n2. Amazon — TBA 3021 8876 5410 — 45 × 35 × 25 cm — 3,6 kg\n\nProchaine étape : avant toute préparation, nous vous demanderons votre accord. Vous pourrez alors autoriser la préparation ou choisir d’attendre vos autres achats. Après votre accord, notre équipe prépare et optimise votre envoi, puis vous recevrez le devis.\n\nCordialement,\nL’équipe Expedîle';

// A 48 × 36 PNG (a carton-coloured gradient) served for the private reception photos.
const zlib = require('node:zlib');
function pngImage(width, height) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) rows.set([196 - y, 150 - (x >> 1), 92], row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO = pngImage(48, 36);
/** Signed reading of the private bucket photos-colis, as Storage answers it: a signed URL, then the image itself. */
async function servePhotos(f) {
  f.photoReads = [];
  await f.context.route('**/object/sign/photos-colis/**', route => {
    const request = route.request();
    const objectPath = decodeURIComponent(new URL(request.url()).pathname.split('/object/sign/photos-colis/')[1] || '');
    if (request.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ signedURL: `/object/sign/photos-colis/${objectPath}?token=fictif` }) });
    f.photoReads.push(objectPath);
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PHOTO });
  });
}

const client = (id, nom, prenom, cp, ville, extra = {}) => ({ id, user_id: null, ref: `CLI-${nom.toUpperCase()}`, nom, prenom, cp, ville, commune: ville, type: 'particulier', abonnement: 'freemium', onboarded: true, created_at: ago(60), email: null, telegram_chat_id: null, ...extra });
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const received = (cartons, days) => cartons.map((_, index) => ({ receivedAt: Array.isArray(days) ? ago(...[].concat(days[index])) : ago(days, cartons.length - index), source: index ? 'append_receipt' : 'initial_receipt' }));
function dossier(id, clientId, ref, statut, cartons, extra = {}) {
  return {
    id, client_id: clientId, ref, statut, archive: false, casier: null, nb_colis: cartons.length,
    trackings: cartons.map(carton => carton.number).filter(Boolean), trackings_detail: cartons.map(carton => ({ number: carton.number, fournisseur: carton.fournisseur })),
    dims_par_colis: cartons.map(carton => box(carton.dimL, carton.dimW, carton.dimH, carton.poids)),
    feu_vert: 'en_attente', consent_request_version: 0, quote_version: 0, frais_divers: [], desc_contenu: 'Achats à regrouper',
    reception_dates: received(cartons, 3), date_reception: ago(10), created_at: ago(10), updated_at: ago(1), ...extra,
  };
}
const prepared = (packages, version = 1) => ({ final_packages: packages, preparation_composition_version: version, final_measurements_version: version, final_measurements_at: ago(1), outgoing_parcel_count: packages.length,
  fin_l: Math.max(...packages.map(item => item.dimL)), fin_w: Math.max(...packages.map(item => item.dimW)), fin_h: Math.max(...packages.map(item => item.dimH)), fin_p: packages.reduce((sum, item) => sum + item.poids, 0) });
const quote = (amounts, { packages, savings = 0, fees = [], brouillon = true } = {}) => ({
  devis_total: amounts.total, quote_version: 1, devis_brouillon: brouillon,
  devis_snapshot: { version: 1, schemaVersion: 1, mode: 'final', savings, inputs: { client: { type: 'particulier' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, finalPackages: packages, volumetricDivisor: 5000, fees }, amounts },
});
const carton = (number, fournisseur, dimL, dimW, dimH, poids) => ({ number, fournisseur, dimL, dimW, dimH, poids });

function seed(tables) {
  tables.colisHome = true;
  tables.signal_calls = [];
  tables.telegram_calls = [];
  tables.queue_calls = [];
  tables.clients = [
    client(CLIENT.abdallah, 'Abdallah', 'Mohamed', '97600', 'Mamoudzou', { telegram_chat_id: '7001' }),
    client(CLIENT.boyer, 'Boyer', 'Sandrine', '97430', 'Le Tampon', { telegram_chat_id: '7002' }),
    client(CLIENT.grondin, 'Grondin', 'Jean', '97460', 'Saint-Paul'),
    client(CLIENT.hoarau, 'Hoarau', 'Jean-Marc', '97400', 'Saint-Denis'),
    client(CLIENT.payet, 'Payet', 'Flavie', '97410', 'Saint-Pierre'),
    client(CLIENT.riviere, 'Rivière', 'Marie-Claude', '97470', 'Saint-Benoît', { email: 'mc.riviere@example.test' }),
    client(CLIENT.techer, 'Técher', 'Johnny', '97450', 'Saint-Louis', { telegram_chat_id: '7007' }),
    client(CLIENT.lebon, 'Lebon', 'Marc', '97400', 'Saint-Denis'),
    client(CLIENT.fontaine, 'Fontaine', 'Lucas', '97420', 'Le Port'),
    client(CLIENT.maillot, 'Maillot', 'Anne', '97410', 'Saint-Pierre'),
    client(CLIENT.dupont, 'Dupont', 'Paul', '97400', 'Saint-Denis'),
  ];
  tables.envois = [
    { id: E.past, ref: 'ENV-TEST-00', date_depart: parisDay(-2), destination_code: '974', statut: 'parti', mode_transport: 'aerien', loading_closes_at: null, departed_at: ago(2), manifest_version: 1, nb_colis: 1, created_at: ago(20), updated_at: ago(2) },
    { id: E.soon, ref: 'ENV-TEST-01', date_depart: parisDay(8), destination_code: '974', statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: ago(5), updated_at: ago(5) },
    { id: E.mayotte, ref: 'ENV-TEST-02', date_depart: parisDay(13), destination_code: '976', statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: ago(5), updated_at: ago(5) },
    { id: E.later, ref: 'ENV-TEST-03', date_depart: parisDay(22), destination_code: '974', statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: ago(5), updated_at: ago(5) },
  ];
  const riviereCartons = [carton('SHEIN-4471', 'Shein', 40, 30, 15, 1.8), carton('SHEIN-4472', 'Shein', 35, 25, 12, 1.2), carton('6A 123 456 789 01', 'Amazon', 50, 40, 30, 4.5), carton('ZARA-889', 'Zara', 30, 20, 10, 0.9), carton('TBA 3021 8876 5410', 'Amazon', 45, 35, 25, 3.6)];
  const riviereParcels = [box(50, 40, 30, 7.6), box(40, 30, 20, 4.6)];
  const grondinParcels = [box(40, 30, 20, 3.2)];
  tables.colis = [
    dossier(D.abdallah, CLIENT.abdallah, 'EXP-TEST-101', 'mesure', [carton('MAY-0001', 'Shein', 30, 20, 20, 2.1)], { casier: 'D-04', envoi_id: E.mayotte, reception_dates: received([1], 1) }),
    dossier(D.boyer, CLIENT.boyer, 'EXP-TEST-102', 'attente_feu_vert', [carton('BOY-1', 'Amazon', 30, 30, 30, 2.4), carton('BOY-2', 'Amazon', 40, 30, 20, 2.6), carton('BOY-3', 'Fnac', 35, 25, 25, 2.2), carton('BOY-4', 'Fnac', 30, 20, 20, 2.2)],
      { casier: 'B-02', envoi_id: E.later, consent_request_version: 1, demande_feu_vert_envoyee_at: ago(6), reception_dates: received([1, 2, 3, 4], 8) }),
    dossier(D.grondin, CLIENT.grondin, 'EXP-TEST-103', 'en_preparation', [carton('GR-001', 'Cdiscount', 30, 25, 20, 1.6), carton('GR-002', 'Fnac', 30, 20, 15, 1.5)],
      { casier: 'A-11', envoi_id: E.soon, feu_vert: 'autorise', feu_vert_date: ago(4), reception_dates: received([1, 2], 5), ...prepared(grondinParcels),
        ...quote({ transport: 52, om: 9.6, omr: 2.4, tva: 7.36, fees: 0, total: 71.36, realWeight: 3.2, volumetricWeight: 4.8, billableWeight: 4.8 }, { packages: grondinParcels }) }),
    dossier(D.hoarau, CLIENT.hoarau, 'EXP-TEST-104', 'en_preparation', [carton('HO-1', 'Darty', 40, 30, 20, 2.3), carton('HO-2', 'Darty', 30, 30, 20, 2.2), carton('HO-3', 'Boulanger', 30, 20, 20, 2.3)],
      { casier: 'B-12', envoi_id: E.later, feu_vert: 'autorise', feu_vert_date: ago(3), reception_dates: received([1, 2, 3], 4), ...prepared([box(50, 40, 30, 6.9)]) }),
    dossier(D.payet, CLIENT.payet, 'EXP-TEST-105', 'autorise', [carton('PA-1', 'Shein', 30, 25, 20, 1.4), carton('PA-2', 'Zalando', 40, 25, 20, 1.6)],
      { casier: 'A-07', envoi_id: E.soon, feu_vert: 'autorise', feu_vert_date: ago(2), preparation_composition_version: 1, final_measurements_version: null, reception_dates: received([1, 2], 3) }),
    dossier(D.riviere, CLIENT.riviere, 'EXP-TEST-106', 'en_preparation', riviereCartons,
      { casier: 'C-03', envoi_id: E.soon, feu_vert: 'autorise', feu_vert_date: ago(1, 5), reception_dates: received(riviereCartons, [[9, 3], [9, 2], [9, 1], [1, 2], [0, 20]]), ...prepared(riviereParcels, 3),
        ...quote({ transport: 109, om: 29.22, omr: 7.53, tva: 12.39, fees: 0, total: 158.14, realWeight: 12.2, volumetricWeight: 16.8, billableWeight: 16.8 }, { packages: riviereParcels, savings: 60.72 }) }),
    dossier(D.techer, CLIENT.techer, 'EXP-TEST-107', 'mesure', [carton('TECH-0001', 'Amazon', 40, 30, 20, 2.5), carton('TECH-0002', 'Cdiscount', 30, 20, 10, 1.2)],
      { casier: 'C-09', reception_dates: [{ receivedAt: ago(2), source: 'initial_receipt' }, { receivedAt: ago(0, 3), source: 'append_receipt' }] }),
    dossier(D.lebon, CLIENT.lebon, 'EXP-TEST-108', 'devis_envoye', [carton('LEB-77 001', 'Amazon', 40, 30, 15, 3.6)],
      { casier: 'E-01', envoi_id: E.later, feu_vert: 'autorise', devis_envoye_le: ago(3), reception_dates: received([1], 7), ...prepared([box(40, 30, 15, 3.6)]),
        ...quote({ transport: 70, om: 10.5, omr: 2.5, tva: 7.06, fees: 5, total: 95.06, realWeight: 3.6, volumetricWeight: 3.6, billableWeight: 3.6 }, { packages: [box(40, 30, 15, 3.6)], fees: [{ libelle: 'Stockage', montant: 5 }], brouillon: false }) }),
    dossier(D.fontaine, CLIENT.fontaine, 'EXP-TEST-109', 'paye', [carton('FON-1', 'Fnac', 30, 30, 30, 4)],
      { casier: 'F-02', envoi_id: E.soon, feu_vert: 'autorise', devis_envoye_le: ago(4), paiement_montant: 80, paiement_date: ago(1), reception_dates: received([1], 9), ...prepared([box(30, 30, 30, 4)]),
        ...quote({ transport: 60, om: 9, omr: 3, tva: 8, fees: 0, total: 80, realWeight: 4, volumetricWeight: 5.4, billableWeight: 5.4 }, { packages: [box(30, 30, 30, 4)], brouillon: false }) }),
    dossier(D.maillot, CLIENT.maillot, 'EXP-TEST-110', 'expedie', [carton('MAI-1', 'Amazon', 30, 20, 20, 2)],
      { casier: 'G-03', envoi_id: E.past, feu_vert: 'autorise', devis_envoye_le: ago(8), paiement_montant: 40, paiement_date: ago(6), date_expedition: ago(2), reception_dates: received([1], 15), ...prepared([box(30, 20, 20, 2)]),
        ...quote({ transport: 30, om: 4, omr: 1, tva: 5, fees: 0, total: 40, realWeight: 2, volumetricWeight: 2.4, billableWeight: 2.4 }, { packages: [box(30, 20, 20, 2)], brouillon: false }) }),
    dossier(D.archive, CLIENT.dupont, 'EXP-TEST-111', 'livre', [carton('DUP-1', 'Fnac', 30, 20, 20, 2)], { archive: true, casier: 'H-01' }),
  ];
  const invoice = (n, colisId, vendeur, montant) => ({ id: uuid(600 + n), colis_id: colisId, vendeur, montant, valide: true, fichier_url: `${colisId}/facture-${n}.pdf`, fichier_nom: `facture-${n}.pdf` });
  tables.factures = [invoice(1, D.grondin, 'Cdiscount', 89.9), invoice(2, D.riviere, 'Amazon', 192.35), invoice(3, D.lebon, 'Amazon', 100), invoice(4, D.fontaine, 'Fnac', 90), invoice(5, D.maillot, 'Amazon', 40)];
  tables.lignes = tables.factures.map((item, index) => ({ id: uuid(700 + index), colis_id: item.colis_id, facture_id: item.id, description: 'Article vérifié', qte: 1, prix_unitaire: item.montant, categorie_id: 'cat-test' }));
  tables.messages = [{ id: uuid(800), colis_id: D.boyer, type: 'staff', template: 'demande_feu_vert', texte: 'Bonjour Sandrine, vos cartons sont reçus.', statut: 'envoye', canal: 'telegram', auteur_nom: 'Camille', created_at: ago(6), notification_outbox: [{ status: 'sent', sent_at: ago(6) }] }];
  tables.staff_work_actions = [];
  tables.notifications = [];
  // list_pending_receptions: the 2nd carton of Técher, recorded three hours ago and not validated.
  tables.pending_receptions = [{ colisId: D.techer, ref: 'EXP-TEST-107', clientId: CLIENT.techer, statut: 'mesure', casier: 'C-09', firstCarton: 2, lastCarton: 2, cartonCount: 1, receivedFrom: ago(0, 3), receivedTo: ago(0, 3),
    cartons: [{ carton: 2, number: 'TECH-0002', fournisseur: 'Cdiscount', dimL: 30, dimW: 20, dimH: 10, poids: 1.2, receivedAt: ago(0, 3) }] }];
  // list_reception_photos: one photo of Técher's carton 2, two of Rivière's carton 4, oldest first.
  tables.reception_photos = [
    { id: uuid(1201), colisId: D.riviere, carton: 4, path: `${D.riviere}/carton-4-a.png`, createdAt: ago(1, 3), actor: { nom: 'Camille Test' } },
    { id: uuid(1202), colisId: D.riviere, carton: 4, path: `${D.riviere}/carton-4-b.png`, createdAt: ago(1, 3), actor: { nom: 'Camille Test' } },
    { id: uuid(1203), colisId: D.techer, carton: 2, path: `${D.techer}/carton-2.png`, createdAt: ago(0, 3), actor: { nom: 'Lucie Martin' } },
  ];
  // list_arrival_notices, most recent first: Rivière's e-mail still to send, Técher's Telegram notice not delivered.
  tables.arrival_notices = [
    { id: NOTICE.riviere, createdAt: ago(1), clientId: CLIENT.riviere, client: { nom: 'Rivière', prenom: 'Marie-Claude' }, actor: { nom: 'Camille Test' }, notify: true, canal: 'email', template: 'arrivee_colis',
      items: [{ colisId: D.riviere, ref: 'EXP-TEST-106', firstCarton: 4, lastCarton: 5 }], cartons: [{ colisId: D.riviere, ref: 'EXP-TEST-106', carton: 4 }, { colisId: D.riviere, ref: 'EXP-TEST-106', carton: 5 }],
      message: { id: MESSAGE.riviere, statut: 'envoi', texte: RIVIERE_TEXT, createdAt: ago(1) }, outbox: { id: uuid(901), status: 'manual', attempts: 0, sentAt: null, lastError: null } },
    { id: NOTICE.techer, createdAt: ago(2), clientId: CLIENT.techer, client: { nom: 'Técher', prenom: 'Johnny' }, actor: { nom: 'Camille Test' }, notify: true, canal: 'telegram', template: 'arrivee_colis',
      items: [{ colisId: D.techer, ref: 'EXP-TEST-107', firstCarton: 1, lastCarton: 1 }], cartons: [{ colisId: D.techer, ref: 'EXP-TEST-107', carton: 1 }],
      message: { id: MESSAGE.techer, statut: 'echec', texte: 'Bonjour Johnny 👋 …', createdAt: ago(2) }, outbox: { id: uuid(902), status: 'failed', attempts: 3, sentAt: null, lastError: 'Le client a bloqué le bot Telegram' } },
  ];
}

// The commands of the new screens, as the server answers them (supabase/migrations/20261028000001_reception_validation.sql,
// queue_message, send-telegram). Registered once: they answer only for the contexts seeded above.
registerRequestMock(({ url, method, input, tables }) => {
  if (!tables.colisHome) return undefined;
  // A dossier whose own read fails (refreshColis), the list being loaded.
  if (method === 'GET' && url.pathname.endsWith('/rest/v1/colis') && tables.failReadOf && url.searchParams.get('id') === `eq.${tables.failReadOf}`)
    return [503, { message: 'Lecture du dossier indisponible' }];
  if (method !== 'POST') return undefined;
  const rpc = url.pathname.includes('/rest/v1/rpc/') ? url.pathname.split('/').pop() : null;
  if (rpc === 'list_pending_receptions') {
    tables.signal_calls.push({ rpc, input, at: Date.now() });
    if (tables.failPending) return [503, { message: 'Service des réceptions indisponible' }];
    return [200, tables.pending_receptions.filter(row => !input?.p_client_id || row.clientId === input.p_client_id)];
  }
  if (rpc === 'list_arrival_notices') {
    tables.signal_calls.push({ rpc, input, at: Date.now() });
    if (tables.failNotices) return [503, { message: 'Service des avis indisponible' }];
    return [200, tables.arrival_notices.filter(row => (!input?.p_client_id || row.clientId === input.p_client_id)
      && (!input?.p_colis_id || row.items.some(item => item.colisId === input.p_colis_id))).slice(0, input?.p_limit || 50)];
  }
  if (rpc === 'list_reception_photos') {
    tables.signal_calls.push({ rpc, input, at: Date.now() });
    if (tables.failPhotos) return [503, { message: 'Photos indisponibles' }];
    return [200, tables.reception_photos.filter(row => row.colisId === input?.p_colis_id)];
  }
  if (rpc === 'queue_message') {
    tables.queue_calls.push(input);
    const parcel = tables.colis.find(row => row.id === input.p_colis_id);
    if (!parcel) return [400, { message: 'Colis introuvable' }];
    if (['demande_feu_vert', 'relance_feu_vert'].includes(input.p_template) && input.p_expected_consent_version !== parcel.consent_request_version)
      return [409, { code: '40001', message: 'La demande a changé. Préparez un nouvel aperçu avant de l’envoyer.' }];
    const at = new Date().toISOString();
    const message = { id: uuid(1000 + tables.queue_calls.length), colis_id: parcel.id, type: 'staff', template: input.p_template, texte: input.p_text, canal: input.p_canal, statut: 'envoi', auteur_nom: 'Camille', created_at: at, notification_outbox: [{ status: 'pending', sent_at: null }] };
    tables.messages.push(message);
    if (input.p_template === 'demande_feu_vert') Object.assign(parcel, { statut: 'attente_feu_vert', feu_vert: 'en_attente', demande_feu_vert_envoyee_at: at });
    parcel.updated_at = at;
    return [200, { message, outbox: { id: uuid(1100 + tables.queue_calls.length), status: 'pending' } }];
  }
  if (url.pathname.endsWith('/functions/v1/send-telegram')) {
    tables.telegram_calls.push(input);
    const at = new Date().toISOString();
    const message = tables.messages.find(row => row.id === input?.messageId);
    if (message) Object.assign(message, { statut: 'envoye', notification_outbox: [{ status: 'sent', sent_at: at }] });
    const notice = tables.arrival_notices.find(row => row.message?.id === input?.messageId);
    if (notice) {
      if (!input.retryConfirmed) return [409, { ok: false, error: 'Envoi incertain : vérifiez avant de réessayer.' }];
      Object.assign(notice.message, { statut: 'envoye' });
      Object.assign(notice.outbox, { status: 'sent', sentAt: at, lastError: null, attempts: notice.outbox.attempts + 1 });
    }
    return [200, { ok: true, status: 'sent' }];
  }
  return undefined;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const tabs = f => f.page.getByRole('navigation', { name: 'Étapes des colis', exact: true });
const rowOf = (f, id) => f.page.locator(`[data-colis-row="${id}"]`);
const namesInOrder = f => f.page.locator('[data-colis-name]').evaluateAll(links => links.map(link => link.textContent.trim()));
/** Waits until the list shows these clients, in this order (a sort is applied on the next render). */
async function waitForOrder(f, expected, count = expected.length) {
  await f.page.waitForFunction(([names, length]) => JSON.stringify([...document.querySelectorAll('[data-colis-name]')].slice(0, length).map(link => link.textContent.trim())) === JSON.stringify(names), [expected, count]).catch(() => {});
  assert.deepEqual((await namesInOrder(f)).slice(0, count), expected);
}
async function openHome(f, search = '') {
  await f.page.goto(`${base}/${search}`);
  await tabs(f).waitFor();
  await f.page.locator('[data-colis-row]').first().waitFor();
}
function grant(f, values) {
  const row = { id: uuid(990), staff_id: f.tables.staff_users[0].id, ...values };
  f.tables.staff_permissions = [row];
  f.tables.staff_users[0].staff_permissions = row;
}
async function setTheme(f, theme) {
  await f.page.evaluate(value => localStorage.setItem('expedile-theme', value), theme);
}
/** Text under 15 px, targets under 44 px and a horizontal scroll, in the page content (<main>). */
async function readability(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main');
    const visible = element => {
      if (element.closest('.sr-only, [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const small = [], tiny = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
      if (size < 15) small.push(`${size}px « ${node.textContent.trim().slice(0, 50)} »`);
    }
    for (const element of root.querySelectorAll('a[href], button, select, input:not([type="hidden"]), summary, [role="button"], [role="tab"]')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height < 44 || rect.width < 44) tiny.push(`${Math.round(rect.width)}×${Math.round(rect.height)} « ${(element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 50)} »`);
    }
    return { small, tiny, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 || root.scrollWidth > root.clientWidth + 1, h1: document.querySelectorAll('h1').length };
  });
}
async function assertReadable(f, label) {
  const measure = await readability(f.page);
  assert.deepEqual(measure.small, [], `${label}: text of 15 px at least`);
  assert.deepEqual(measure.tiny, [], `${label}: targets of 44 px at least`);
  assert.equal(measure.overflow, false, `${label}: no horizontal scroll`);
  assert.equal(measure.h1, 1, `${label}: one h1`);
}
async function assertAccessible(f, label) {
  const audit = await new AxeBuilder({ page: f.page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.slice(0, 4).map(node => `${node.target} ${node.failureSummary || ''}`.slice(0, 220)) })), [], `${label}: axe`);
}
/** innerText with every space, no-break space and line break as one space. */
const flat = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim();
/** A screenshot of the page; `fullPage`: its whole content (the staff shell scrolls <main>, not the page). */
async function shot(f, name, fullPage = true) {
  const unbox = open => f.page.evaluate(open => {
    const main = document.querySelector('main');
    const shell = main?.closest('.h-\\[100dvh\\]');
    for (const [element, keys] of [[shell, ['height', 'overflow']], [main, ['overflow']]]) {
      if (!element) continue;
      for (const key of keys) if (open) element.style.setProperty(key, key === 'height' ? 'auto' : 'visible'); else element.style.removeProperty(key);
    }
    // The fixed bottom navigation would sit in the middle of a whole-page capture.
    const bar = document.querySelector('[data-staff-bottom-nav]');
    if (bar) bar.style.visibility = open ? 'hidden' : '';
  }, open);
  if (fullPage) await unbox(true);
  try { await f.page.screenshot({ path: path.join(output, `${name}.png`), fullPage }); }
  finally { if (fullPage) await unbox(false); }
}
/** Waits until the reception photos of the sheet are loaded and decoded, so that a capture paints them, not their place. */
async function photosShown(f, count) {
  await f.page.waitForFunction(count => [...document.querySelectorAll('.fiche-photos img')].filter(image => image.complete && image.naturalWidth === 48).length === count, count);
  await f.page.locator('.fiche-photos').first().scrollIntoViewIfNeeded();
  await f.page.evaluate(() => Promise.all([...document.querySelectorAll('.fiche-photos img')].map(image => image.decode().catch(() => {}))));
}
/** Waits until a condition on the mocked server's state holds. */
async function until(condition, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Condition not reached in time.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
const noSend = f => assert.equal(f.requests.some(request => /\/(queue_message|send-telegram|send-email|validate_reception)$/.test(request.path)), false, 'Browsing never sends nor validates.');

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, { role = 'directeur', device = TABLET, theme = 'light', permissions = null, failTable = null, prepare = null, failedRequests = false } = {}) {
    if (FILTER && !name.includes(FILTER)) return;
    const f = await setup(browser, role, { device, failTable });
    f.page.setDefaultTimeout(10000);
    seed(f.tables);
    await servePhotos(f);
    if (permissions) grant(f, permissions);
    if (prepare) await prepare(f);
    const consoleErrors = [];
    f.page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    try {
      await f.login();
      if (theme === 'dark') await setTheme(f, 'dark');
      await run(f);
      assert.deepEqual(f.errors, [], 'No page error.');
      assert.deepEqual(f.networkDenied, [], 'No request outside the mocked server.');
      assert.deepEqual(consoleErrors.filter(text => !((failTable || failedRequests) && /^Failed to load resource: the server responded with a status of 503/.test(text))), [], 'No console error.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1;
      results.push({ test: name, pass: false, error: error.stack });
      await shot(f, `${name}-failure`).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => '')).catch(() => {});
    } finally { await f.context.close(); }
  }

  try {
    await scenario('tablet-tabs-counts-totals-and-alerts', async f => {
      await openHome(f);
      const nav = tabs(f);
      for (const [label, count] of [['Brouillon', 7], ['À payer', 1], ['Prêt à partir', 1], ['Parti', 1]])
        await nav.getByRole('link', { name: `${label} ${count} ${count > 1 ? 'dossiers' : 'dossier'}`, exact: true }).waitFor();
      assert.equal(await nav.getByRole('link', { name: /^Brouillon/ }).getAttribute('aria-current'), 'page');
      await waitForOrder(f, ['Abdallah Mohamed', 'Boyer Sandrine', 'Grondin Jean', 'Hoarau Jean-Marc', 'Payet Flavie', 'Rivière Marie-Claude', 'Técher Johnny']); // « Par nom » by default
      // One step and one action (or « Rien à faire ») per dossier.
      const expected = {
        abdallah: ['Accord à demander', 'Jamais demandé', 'button', 'Demander l’accord'], boyer: ['Attend le client', 'Sans réponse', 'button', 'Relancer'],
        grondin: ['Prêt pour le devis', 'Devis enregistré', 'link', 'Envoyer le devis'], hoarau: ['Facture manquante', '', 'link', 'Ajouter la facture'],
        payet: ['À préparer', 'Accord donné le', 'link', 'Préparer'], riviere: ['Prêt pour le devis', '', 'link', 'Envoyer le devis'],
        techer: ['Réception à valider', '1 carton à valider', 'link', 'Valider la réception'],
      };
      for (const [key, [stage, detail, role, action]] of Object.entries(expected)) {
        const row = rowOf(f, D[key]);
        await row.getByText(stage, { exact: true }).waitFor();
        if (detail) assert.match(await flat(row), new RegExp(detail));
        await row.getByRole(role, { name: action, exact: true }).waitFor();
      }
      // Never a false zero: a dossier without a saved quote reads « À calculer ».
      assert.match(await flat(rowOf(f, D.payet)), /À calculer/);
      assert.match(await flat(rowOf(f, D.riviere)), /158,14 €/);
      // Totals of the tab, and the two alerts.
      const totals = await flat(f.page.getByTestId('colis-totals'));
      assert.match(totals, /^En stock, devis pas encore envoyé · 7 clients · 19 cartons · [\d,]+ kg · [\d,]+ m³$/);
      // One alert, one link to what is to do.
      const reception = f.page.getByRole('link', { name: 'Réception à valider : 1 carton Valider et prévenir', exact: true });
      assert.equal(await reception.getAttribute('href'), `/recevoir?client=${CLIENT.techer}&valider=1`);
      const notices = f.page.getByRole('link', { name: '1 avis d’arrivée non remis Voir les avis', exact: true });
      assert.equal(await notices.getAttribute('href'), '/avis');
      // A table with its headers.
      const table = f.page.getByRole('table', { name: 'Brouillon, classé par nom' });
      for (const header of ['Client', 'Colis', 'Où en est-on', 'Total à payer', 'Action']) await table.getByRole('columnheader', { name: header, exact: true }).waitFor();
      await assertReadable(f, 'tablet Brouillon');
      await assertAccessible(f, 'tablet Brouillon');
      await shot(f, 'colis-tablette-brouillon', false);
      // The other tabs, their step and their action; the address keeps the tab.
      await nav.getByRole('link', { name: /^À payer/ }).click();
      await f.page.waitForURL(url => url.searchParams.get('onglet') === 'a_payer');
      await rowOf(f, D.lebon).getByText('Paiement attendu', { exact: true }).waitFor();
      assert.match(await rowOf(f, D.lebon).getByRole('link', { name: 'Suivre le paiement', exact: true }).getAttribute('href'), new RegExp(`^/colis/${D.lebon}\\?returnTo=%2F%3Fonglet%3Da_payer&section=paiement#dossier-work$`));
      assert.match(await flat(f.page.getByTestId('colis-totals')), /^Devis envoyé, paiement attendu · 1 client · 1 carton/);
      assert.equal(await f.page.locator('[data-colis-row]').count(), 1);
      await nav.getByRole('link', { name: /^Prêt à partir/ }).click();
      await rowOf(f, D.fontaine).getByRole('link', { name: 'Préparer le départ', exact: true }).waitFor();
      await nav.getByRole('link', { name: /^Parti/ }).click();
      await rowOf(f, D.maillot).getByText('Expédié', { exact: false }).first().waitFor();
      assert.equal(await f.page.locator(`[data-colis-row="${D.archive}"]`).count(), 0, 'An archived dossier is in no tab.');
      await shot(f, 'colis-tablette-parti', false);
      noSend(f);
    });

    await scenario('sorts-and-departure-groups', async f => {
      await openHome(f);
      const sorts = f.page.getByRole('group', { name: 'Classer', exact: true });
      assert.deepEqual(await sorts.getByRole('button').allInnerTexts(), ['Par nom', 'Par date d’envoi', 'Par réception', 'Par montant']);
      await sorts.getByRole('button', { name: 'Par date d’envoi', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('classer') === 'depart');
      await sorts.locator('button[aria-pressed="true"]', { hasText: 'Par date d’envoi' }).waitFor();
      await f.page.locator('.colis-group-row').first().waitFor();
      const groups = await f.page.locator('.colis-group-row').evaluateAll(rows => rows.map(row => row.innerText.replace(/\s+/g, ' ').trim()));
      assert.equal(groups.length, 4, groups.join('\n'));
      assert.match(groups[0], /^Départ du .+ · Réunion ENV-TEST-01 clôture .+, 17 h 3 clients · 9 cartons · [\d,]+ kg · [\d,]+ m³ · 229,50 € \(2 prix connus sur 3\)$/);
      assert.match(groups[1], /^Départ du .* · Mayotte ENV-TEST-02 .*1 client · 1 carton .*prix à calculer$/);
      assert.match(groups[2], /^Départ du .* · Réunion ENV-TEST-03 .*2 clients · 7 cartons/);
      assert.match(groups[3], /^Départ à choisir 1 client · 2 cartons/);
      await waitForOrder(f, ['Grondin Jean', 'Payet Flavie', 'Rivière Marie-Claude', 'Abdallah Mohamed', 'Boyer Sandrine', 'Hoarau Jean-Marc', 'Técher Johnny']);
      await assertReadable(f, 'groups');
      await assertAccessible(f, 'groups');
      await shot(f, 'colis-tablette-par-envoi');
      // The address keeps the sort.
      await f.page.reload();
      await f.page.locator('.colis-group-row').first().waitFor();
      await sorts.getByRole('button', { name: 'Par réception', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('classer') === 'reception');
      await waitForOrder(f, ['Técher Johnny', 'Rivière Marie-Claude', 'Abdallah Mohamed'], 3); // the latest carton received first
      await sorts.getByRole('button', { name: 'Par montant', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('classer') === 'montant');
      await waitForOrder(f, ['Rivière Marie-Claude', 'Grondin Jean', 'Abdallah Mohamed', 'Boyer Sandrine', 'Hoarau Jean-Marc', 'Payet Flavie', 'Técher Johnny']); // highest price first, no price last
      noSend(f);
    });

    await scenario('search-by-tracking-number-and-scanner', async f => {
      await openHome(f);
      const search = f.page.getByLabel('Chercher un client, une référence, un casier ou un numéro de suivi', { exact: true });
      // A tracking number typed without its spaces finds its dossier; the tabs count what is found.
      await search.fill('6A12345678901');
      await f.page.waitForFunction(() => document.querySelectorAll('[data-colis-row]').length === 1);
      await rowOf(f, D.riviere).waitFor();
      await tabs(f).getByRole('link', { name: 'Brouillon 1 dossier', exact: true }).waitFor();
      await tabs(f).getByRole('link', { name: 'À payer 0 dossier', exact: true }).waitFor();
      await f.page.waitForURL(url => url.searchParams.get('q') === '6A12345678901');
      assert.match(await flat(f.page.getByTestId('colis-totals')), /^Recherche « 6A12345678901 » · 1 client · 5 cartons/);
      // A scanner types fast, then Enter: the only dossier found opens its sheet, with the way back to this search.
      await search.fill('');
      await search.focus();
      await f.page.keyboard.type('TECH-0002', { delay: 4 });
      await f.page.keyboard.press('Enter');
      await f.page.waitForURL(url => url.pathname === `/brouillon/${D.techer}`);
      await f.page.getByRole('heading', { level: 1, name: 'Técher Johnny', exact: true }).waitFor();
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?q=TECH-0002');
      await f.page.getByRole('link', { name: 'Colis', exact: true }).first().click();
      await f.page.waitForURL(url => url.pathname === '/' && url.searchParams.get('q') === 'TECH-0002');
      assert.equal(await search.inputValue(), 'TECH-0002');
      // Found in another tab only: said, one click away; Enter opens it when it is the only one.
      await search.fill('LEB-77001');
      const empty = f.page.getByRole('region', { name: /^Aucun dossier de l’onglet Brouillon ne correspond/ });
      await empty.waitFor();
      await empty.getByRole('link', { name: 'Voir 1 dossier dans À payer', exact: true }).waitFor();
      await search.press('Enter');
      await f.page.waitForURL(url => url.pathname === `/brouillon/${D.lebon}`);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?q=LEB-77001&onglet=a_payer');
      // A casier and a reference are searched as well.
      await openHome(f, '?q=C-09');
      await waitForOrder(f, ['Técher Johnny']);
      assert.equal(await f.page.locator('[data-colis-name]').count(), 1);
      await openHome(f, '?q=EXP-TEST-105');
      await waitForOrder(f, ['Payet Flavie']);
      assert.equal(await f.page.locator('[data-colis-name]').count(), 1);
      await shot(f, 'colis-tablette-recherche', false);
      noSend(f);
    });

    await scenario('row-actions-open-their-page', async f => {
      await openHome(f, '?classer=nom');
      const href = async (key, name) => rowOf(f, D[key]).getByRole('link', { name, exact: true }).getAttribute('href');
      const back = '%2F%3Fclasser%3Dnom';
      assert.equal(await href('grondin', 'Envoyer le devis'), `/colis/${D.grondin}?returnTo=${back}&section=devis#dossier-work`);
      assert.equal(await href('hoarau', 'Ajouter la facture'), `/colis/${D.hoarau}?returnTo=${back}&section=documents#dossier-work`);
      assert.equal(await href('payet', 'Préparer'), `/colis/${D.payet}?returnTo=${back}&section=preparation#dossier-work`);
      assert.equal(await href('techer', 'Valider la réception'), `/recevoir?client=${CLIENT.techer}&valider=1`);
      // The client's name opens the Brouillon sheet; the action opens the dossier task.
      assert.equal(await rowOf(f, D.payet).getByRole('link', { name: 'Payet Flavie', exact: true }).getAttribute('href'), `/brouillon/${D.payet}?returnTo=${back}`);
      await rowOf(f, D.payet).getByRole('link', { name: 'Préparer', exact: true }).click();
      await f.page.getByTestId('dossier-task-header').waitFor();
      assert.equal(new URL(f.page.url()).searchParams.get('section'), 'preparation');
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?classer=nom');
      await f.page.goto(`${base}/?classer=nom`);
      await rowOf(f, D.techer).getByRole('link', { name: 'Valider la réception', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/recevoir' && url.searchParams.get('client') === CLIENT.techer && url.searchParams.get('valider') === '1');
      noSend(f);
    });

    await scenario('consent-request-panel-sends-in-place', async f => {
      await openHome(f);
      const row = rowOf(f, D.abdallah);
      const trigger = row.getByRole('button', { name: 'Demander l’accord', exact: true });
      await trigger.click();
      const panel = f.page.getByRole('region', { name: 'Demander l’accord · Abdallah Mohamed', exact: true });
      await panel.waitFor();
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(await panel.evaluate(element => element === document.activeElement), true, 'The panel takes the focus.');
      const message = panel.getByLabel('Message à envoyer au client', { exact: true });
      await message.waitFor();
      assert.match(await message.inputValue(), /MAY-0001/);
      assert.equal(await panel.getByLabel('Canal de notification', { exact: true }).inputValue(), 'telegram');
      assert.equal(f.tables.queue_calls.length, 0, 'Opening the panel sends nothing.');
      await assertReadable(f, 'consent panel');
      await assertAccessible(f, 'consent panel');
      await shot(f, 'colis-tablette-panneau-accord');
      const reads = () => f.tables.signal_calls.filter(call => call.rpc === 'list_pending_receptions').length;
      const readsBefore = reads();
      await panel.getByRole('button', { name: 'Envoyer la demande d’accord', exact: true }).click();
      await panel.getByText('Message livré à Telegram.', { exact: true }).waitFor();
      assert.equal(f.tables.queue_calls.length, 1);
      const [queued] = f.tables.queue_calls;
      assert.deepEqual([queued.p_colis_id, queued.p_template, queued.p_canal, queued.p_expected_consent_version], [D.abdallah, 'demande_feu_vert', 'telegram', 0]);
      assert.ok(queued.p_reply_markup.inline_keyboard.some(line => line.some(button => button.callback_data === `fv_oui_${D.abdallah}`)));
      assert.equal(f.tables.telegram_calls.length, 1);
      assert.equal(f.tables.telegram_calls[0].colisId, D.abdallah);
      assert.equal(f.tables.telegram_calls[0].messageId, f.tables.messages[f.tables.messages.length - 1].id);
      // The line now says where the dossier is: the client is asked, nothing to do.
      await row.getByText('Attend le client', { exact: true }).waitFor();
      await row.getByText('Rien à faire', { exact: true }).waitFor();
      // The dossier changed in the loaded data (no window event): the receptions and notices are read again.
      for (let wait = 0; wait < 40 && reads() <= readsBefore; wait += 1) await f.page.waitForTimeout(250);
      assert.ok(reads() > readsBefore, 'A change of the loaded dossiers is followed by a new read.');
      await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
      await panel.waitFor({ state: 'detached' });
      assert.equal(await row.getByRole('link', { name: 'Abdallah Mohamed', exact: true }).evaluate(element => element === document.activeElement), true, 'The focus returns to the line.');
    });

    await scenario('relance-panel-on-phone-dark', async f => {
      await openHome(f);
      const row = rowOf(f, D.boyer);
      await row.getByRole('button', { name: 'Relancer', exact: true }).click();
      const panel = f.page.getByRole('region', { name: 'Relancer · Boyer Sandrine', exact: true });
      await panel.getByLabel('Message à envoyer au client', { exact: true }).waitFor();
      await assertReadable(f, 'phone relance panel');
      await assertAccessible(f, 'phone relance panel (dark)');
      await shot(f, 'colis-telephone-sombre-relance');
      await panel.getByRole('button', { name: 'Envoyer ce message', exact: true }).click();
      await panel.getByText('Message livré à Telegram.', { exact: true }).waitFor();
      assert.deepEqual(f.tables.queue_calls.map(call => [call.p_colis_id, call.p_template, call.p_expected_consent_version]), [[D.boyer, 'relance_feu_vert', 1]]);
      await row.getByText('Rien à faire', { exact: true }).waitFor();
    }, { device: PHONE, theme: 'dark' });

    await scenario('phone-list-light-and-dark', async f => {
      for (const theme of ['light', 'dark']) {
        await setTheme(f, theme);
        await openHome(f);
        // Four tabs on two lines, a menu to sort, one card per dossier.
        const boxes = await tabs(f).getByRole('link').evaluateAll(links => links.map(link => link.getBoundingClientRect()).map(rect => ({ top: Math.round(rect.top), height: rect.height })));
        assert.equal(new Set(boxes.map(item => item.top)).size, 2, 'Two lines of tabs.');
        const sort = f.page.getByLabel('Classer', { exact: true });
        assert.deepEqual(await sort.locator('option').allInnerTexts(), ['Par nom', 'Par date d’envoi', 'Par réception', 'Par montant']);
        assert.equal(await f.page.getByRole('table').count(), 0, 'Cards on a phone.');
        await rowOf(f, D.abdallah).getByRole('button', { name: 'Demander l’accord', exact: true }).waitFor();
        await assertReadable(f, `phone list ${theme}`);
        await assertAccessible(f, `phone list ${theme}`);
        await shot(f, `colis-telephone-${theme === 'dark' ? 'sombre' : 'clair'}`);
        await sort.selectOption('depart');
        await f.page.waitForURL(url => url.searchParams.get('classer') === 'depart');
        await f.page.getByRole('heading', { level: 2, name: /^Départ à choisir/ }).waitFor();
        assert.equal(await f.page.locator('.colis-group-section').count(), 4);
        await assertReadable(f, `phone groups ${theme}`);
        await assertAccessible(f, `phone groups ${theme}`);
        await shot(f, `colis-telephone-${theme === 'dark' ? 'sombre' : 'clair'}-par-envoi`);
      }
      noSend(f);
    }, { device: PHONE });

    await scenario('brouillon-sheet-tablet-light-and-dark', async f => {
      for (const theme of ['light', 'dark']) {
        await setTheme(f, theme);
        await openHome(f, '?classer=depart');
        await rowOf(f, D.riviere).getByRole('link', { name: 'Rivière Marie-Claude', exact: true }).click();
        await f.page.waitForURL(url => url.pathname === `/brouillon/${D.riviere}`);
        const sheet = f.page.getByTestId('brouillon-fiche');
        await sheet.getByRole('heading', { level: 1, name: 'Rivière Marie-Claude', exact: true }).waitFor();
        // The sheet reads the notices of its dossier and the receptions of its client only.
        await f.page.getByTestId('fiche-avis').getByText('À envoyer', { exact: true }).waitFor();
        assert.ok(f.tables.signal_calls.some(call => call.rpc === 'list_arrival_notices' && call.input.p_colis_id === D.riviere && call.input.p_limit === 50));
        assert.ok(f.tables.signal_calls.some(call => call.rpc === 'list_pending_receptions' && call.input.p_client_id === CLIENT.riviere));
        assert.match(await flat(sheet.locator('header')), /Réunion · Saint-Benoît · Particulier · Casier C-03 · EXP-TEST-106 Prêt pour le devis/);
        // The price of the saved quote: transport and its billed weight, the import taxes and their detail, the total, the saving.
        const action = f.page.getByTestId('fiche-action');
        await action.getByRole('heading', { name: 'Prix à payer', exact: true }).waitFor();
        const price = await flat(action);
        for (const part of [/Transport\s+109,00 €/, /Poids facturé : 16,8 kg/, /Taxes à l’importation estimées\s+49,14 €/, /payées à l’arrivée, comprises dans le prix/, /dont estimation octroi de mer de La Réunion\s+29,22 €/,
          /dont estimation octroi de mer régional de La Réunion\s+7,53 €/, /dont estimation TVA à l’importation de La Réunion\s+12,39 €/, /Total à payer\s+158,14 €/, /Économie réalisée grâce à l’optimisation : 60,72 €/]) assert.match(price, part);
        assert.equal(await action.getByRole('link', { name: 'Envoyer le devis', exact: true }).getAttribute('href'), `/colis/${D.riviere}?returnTo=%2Fbrouillon%2F${D.riviere}&section=devis#dossier-work`);
        assert.equal(await action.getByRole('link', { name: 'Tout le dossier', exact: true }).getAttribute('href'), `/colis/${D.riviere}?returnTo=%2Fbrouillon%2F${D.riviere}`);
        assert.equal(await action.getByRole('link', { name: 'Ajouter un carton', exact: true }).getAttribute('href'), `/recevoir?dossier=${D.riviere}`);
        // Cartons received, then after optimisation and the volume gained.
        const receivedTable = f.page.getByTestId('fiche-recus').getByRole('table');
        assert.equal(await receivedTable.locator('tbody tr:not(.fiche-photo-row)').count(), 5);
        assert.match(await flat(receivedTable), /3 Amazon 6A 123 456 789 01 50 × 40 × 30 cm 4,5 kg 0,060 m³/);
        assert.match(await flat(receivedTable.locator('tfoot')), /Total reçu · 5 cartons 12 kg 0,134 m³/);
        const optimized = f.page.getByTestId('fiche-optimise');
        assert.match(await flat(optimized), /2 colis à expédier · 12,2 kg · 0,084 m³/);
        await optimized.getByText('Gain de volume : 37 %', { exact: true }).waitFor();
        // The arrival notice: an e-mail to send, its text, the copy and the draft.
        const notice = f.page.getByTestId('fiche-avis');
        await notice.getByText('À envoyer', { exact: true }).waitFor();
        assert.match(await flat(notice), /E-mail · \d{2}\/\d{2}\/\d{4} · Cartons 4 et 5/);
        assert.equal(await notice.getByLabel('Texte de l’avis', { exact: true }).inputValue(), RIVIERE_TEXT);
        const draft = await notice.getByRole('link', { name: 'Ouvrir un brouillon d’e-mail', exact: true }).getAttribute('href');
        assert.ok(draft.startsWith(`mailto:mc.riviere@example.test?subject=${encodeURIComponent('Vos 2 colis sont arrivés chez Expedîle')}&body=`), draft);
        assert.equal(decodeURIComponent(draft.split('&body=')[1]), RIVIERE_TEXT);
        if (theme === 'light') {
          await notice.getByRole('button', { name: 'Copier le texte', exact: true }).click();
          await notice.getByText('Texte copié : collez-le dans votre messagerie.', { exact: true }).waitFor();
          assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()), RIVIERE_TEXT);
        }
        await assertReadable(f, `sheet tablet ${theme}`);
        await assertAccessible(f, `sheet tablet ${theme}`);
        await photosShown(f, 2);
        await shot(f, `fiche-tablette-${theme === 'dark' ? 'sombre' : 'clair'}`);
        // The way back keeps the list as it was.
        await f.page.getByRole('link', { name: 'Colis', exact: true }).first().click();
        await f.page.waitForURL(url => url.pathname === '/' && url.searchParams.get('classer') === 'depart');
      }
      noSend(f);
    }, { prepare: f => f.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }) });

    await scenario('brouillon-sheet-phone-order', async f => {
      await f.page.goto(`${base}/brouillon/${D.riviere}`);
      const sheet = f.page.getByTestId('brouillon-fiche');
      await sheet.getByRole('heading', { level: 1, name: 'Rivière Marie-Claude', exact: true }).waitFor();
      await f.page.getByTestId('fiche-avis').getByText('À envoyer', { exact: true }).waitFor();
      // On a phone: the total and the action, the parcels after optimisation, then the cartons received.
      const order = await sheet.locator('[data-testid^="fiche-"]').evaluateAll(sections => sections.map(section => section.dataset.testid).filter(id => ['fiche-action', 'fiche-optimise', 'fiche-recus', 'fiche-avis'].includes(id)));
      assert.deepEqual(order, ['fiche-action', 'fiche-optimise', 'fiche-recus', 'fiche-avis']);
      assert.equal(await sheet.getByRole('table').count(), 0, 'Lists on a phone.');
      assert.match(await flat(f.page.getByTestId('fiche-recus')), /3 · Amazon 4,5 kg 50 × 40 × 30 cm · 0,060 m³ 6A 123 456 789 01/);
      // The carton photographed at the reception: its mark and its thumbnails, in the list too.
      const photographed = f.page.getByTestId('fiche-recus').locator('li[data-photos="true"]');
      assert.equal(await photographed.count(), 1);
      assert.match(await flat(photographed), /^4 · Zara .*ZARA-889 2 photos \d{2}\/\d{2}\/\d{4} · Camille Test/);
      await photosShown(f, 2);
      await assertReadable(f, 'sheet phone');
      await assertAccessible(f, 'sheet phone');
      await shot(f, 'fiche-telephone-clair');
      await setTheme(f, 'dark');
      await f.page.reload();
      await sheet.getByRole('heading', { level: 1, name: 'Rivière Marie-Claude', exact: true }).waitFor();
      await f.page.getByTestId('fiche-avis').getByText('À envoyer', { exact: true }).waitFor();
      await assertReadable(f, 'sheet phone dark');
      await assertAccessible(f, 'sheet phone dark');
      await photosShown(f, 2);
      await shot(f, 'fiche-telephone-sombre');
      noSend(f);
    }, { device: PHONE });

    await scenario('sheet-reception-to-validate-and-telegram-retry', async f => {
      await f.page.goto(`${base}/brouillon/${D.techer}?returnTo=${encodeURIComponent('/?onglet=brouillon')}`);
      await f.page.getByRole('heading', { level: 1, name: 'Técher Johnny', exact: true }).waitFor();
      const action = f.page.getByTestId('fiche-action');
      assert.equal(await action.getByRole('link', { name: 'Valider la réception', exact: true }).getAttribute('href'), `/recevoir?client=${CLIENT.techer}&valider=1`);
      // Without a saved quote: what the quote still needs, never a price.
      assert.equal(await action.getByTestId('fiche-prix-etat').innerText(), 'À calculer');
      assert.match(await flat(action), /Pour calculer le devis, il manque : Accord du client Mesures après optimisation/);
      const received = f.page.getByTestId('fiche-recus');
      await received.getByText('1 carton à valider', { exact: true }).waitFor();
      const waiting = received.locator('tbody tr[data-pending="true"]:not(.fiche-photo-row)');
      assert.equal(await waiting.count(), 1);
      assert.match(await flat(waiting), /^2 À valider 1 photo Cdiscount TECH-0002/);
      // A Telegram notice not delivered: its reason, then « Réessayer » after the check asked by the confirmation.
      const notice = f.page.getByTestId('fiche-avis');
      await notice.getByText('Non remis', { exact: true }).waitFor();
      await notice.getByText('Raison : Le client a bloqué le bot Telegram', { exact: true }).waitFor();
      await assertReadable(f, 'sheet with a notice to retry');
      await assertAccessible(f, 'sheet with a notice to retry');
      await photosShown(f, 1);
      await shot(f, 'fiche-tablette-avis-non-remis');
      await notice.getByRole('button', { name: 'Réessayer', exact: true }).click();
      const confirm = f.page.getByRole('dialog', { name: 'Réessayer l’avis d’arrivée', exact: true });
      await confirm.getByText('Vérifiez dans Telegram que le client n’a pas reçu cet avis, puis confirmez le renvoi.', { exact: true }).waitFor();
      assert.equal(f.tables.telegram_calls.length, 0, 'Nothing is sent before the confirmation.');
      await confirm.getByRole('button', { name: 'Réessayer l’envoi', exact: true }).click();
      await notice.getByText('Envoyé', { exact: true }).waitFor();
      assert.deepEqual(f.tables.telegram_calls, [{ colisId: D.techer, messageId: MESSAGE.techer, retryConfirmed: true }]);
      // Back to the list: the notice delivered, its alert is gone.
      await f.page.getByRole('link', { name: 'Colis', exact: true }).first().click();
      await f.page.waitForURL(url => url.pathname === '/' && url.searchParams.get('onglet') === 'brouillon');
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor();
      assert.equal(await f.page.locator('[data-alert="avis_non_remis"]').count(), 0);
    });

    await scenario('sheet-shows-reception-photos-per-carton', async f => {
      await f.page.goto(`${base}/brouillon/${D.riviere}`);
      const received = f.page.getByTestId('fiche-recus');
      // The carton photographed is marked, its photos are shown under it, signed on read from the private bucket.
      const marked = received.locator('tbody tr[data-photos="true"]');
      await marked.waitFor();
      assert.equal(await marked.count(), 1);
      assert.match(await flat(marked), /^4 2 photos Zara ZARA-889/);
      const photos = received.getByRole('list', { name: 'Photos du carton 4', exact: true }).getByRole('img');
      await photosShown(f, 2);
      assert.equal(await photos.count(), 2);
      assert.deepEqual(await photos.evaluateAll(images => images.map(image => image.alt)), ['Carton 4 (Zara) à la réception', 'Carton 4 (Zara) à la réception']);
      assert.match(await flat(received.locator('.fiche-photos li').first()), /^\d{2}\/\d{2}\/\d{4} · Camille Test$/);
      assert.deepEqual([...new Set(f.photoReads)].sort(), [`${D.riviere}/carton-4-a.png`, `${D.riviere}/carton-4-b.png`]);
      assert.ok(f.tables.signal_calls.some(call => call.rpc === 'list_reception_photos' && call.input.p_colis_id === D.riviere));
      await assertReadable(f, 'sheet with photos');
      await assertAccessible(f, 'sheet with photos');
      await shot(f, 'fiche-tablette-photos');
      // No photo: no mark, no note.
      await f.page.goto(`${base}/brouillon/${D.payet}`);
      await f.page.getByRole('heading', { level: 1, name: 'Payet Flavie', exact: true }).waitFor();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="fiche-recus"] tbody tr'));
      await until(() => f.tables.signal_calls.some(call => call.rpc === 'list_reception_photos' && call.input.p_colis_id === D.payet));
      await f.page.waitForTimeout(300);
      assert.equal(await f.page.locator('[data-photos="true"], [data-testid="fiche-photos-erreur"]').count(), 0);
      // The photos cannot be read: the sheet stays, the cartons too, a quiet note offers « Réessayer ».
      f.tables.failPhotos = true;
      await f.page.goto(`${base}/brouillon/${D.techer}`);
      const note = f.page.getByTestId('fiche-photos-erreur');
      await note.waitFor();
      assert.match(await flat(note), /^Les photos de réception n’ont pas pu être chargées \(Photos indisponibles\)\. Réessayer$/);
      assert.equal(await f.page.getByTestId('fiche-recus').locator('tbody tr:not(.fiche-photo-row)').count(), 2);
      f.tables.failPhotos = false;
      await note.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await note.waitFor({ state: 'detached' });
      assert.match(await flat(f.page.getByTestId('fiche-recus').locator('tbody tr[data-photos="true"]')), /^2 À valider 1 photo Cdiscount/);
      await f.page.waitForFunction(() => [...document.querySelectorAll('.fiche-photos img')].some(image => image.complete && image.naturalWidth === 48));
      noSend(f);
    }, { failedRequests: true });

    await scenario('notice-to-check-is-retried-on-the-dossier-that-carries-it', async f => {
      // The list says both: one notice not delivered, one to check.
      await openHome(f);
      await f.page.getByRole('link', { name: '1 avis d’arrivée non remis, 1 à vérifier Voir les avis', exact: true }).waitFor();
      await f.page.goto(`${base}/brouillon/${D.techer}`);
      const notice = f.page.getByTestId('fiche-avis');
      const pill = notice.locator('.colis-pill[data-notice="a_verifier"]');
      await pill.getByText('Envoi à vérifier', { exact: true }).waitFor();
      // Amber, as what is to check; « Non remis » keeps its own colour.
      assert.equal(await pill.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 241, 204)');
      await notice.getByText('Toujours pas parti au bout de 10 minutes : l’envoi automatique ne l’a pas pris en charge.', { exact: true }).waitFor();
      await assertReadable(f, 'notice to check');
      await assertAccessible(f, 'notice to check');
      await photosShown(f, 1);
      await shot(f, 'fiche-tablette-avis-a-verifier');
      await notice.getByRole('button', { name: 'Réessayer', exact: true }).click();
      const confirm = f.page.getByRole('dialog', { name: 'Réessayer l’avis d’arrivée', exact: true });
      await confirm.getByRole('button', { name: 'Réessayer l’envoi', exact: true }).click();
      await notice.getByText('Envoyé', { exact: true }).waitFor();
      // Sent from the dossier that carries the message, not from the first dossier of the reception.
      assert.deepEqual(f.tables.telegram_calls, [{ colisId: D.techer2, messageId: MESSAGE.techer, retryConfirmed: true }]);
    }, { prepare: f => {
      // A second dossier of Técher, validated in the same reception, carries the notice (it still requested its invoice).
      f.tables.colis.push(dossier(D.techer2, CLIENT.techer, 'EXP-TEST-112', 'mesure', [carton('TECH-0003', 'Fnac', 30, 30, 20, 2)], { casier: 'C-09', reception_dates: received([1], 2) }));
      Object.assign(f.tables.arrival_notices.find(item => item.id === NOTICE.techer), {
        items: [{ colisId: D.techer, ref: 'EXP-TEST-107', firstCarton: 1, lastCarton: 1 }, { colisId: D.techer2, ref: 'EXP-TEST-112', firstCarton: 1, lastCarton: 1 }],
        cartons: [{ colisId: D.techer, ref: 'EXP-TEST-107', carton: 1 }, { colisId: D.techer2, ref: 'EXP-TEST-112', carton: 1 }],
        createdAt: ago(0, 0.5),
        message: { id: MESSAGE.techer, colisId: D.techer2, statut: 'envoi', texte: 'Bonjour Johnny 👋 …', createdAt: ago(0, 0.5) },
        outbox: { id: uuid(902), status: 'pending', attempts: 0, sentAt: null, lastError: null },
      });
      // Abdallah: a notice not delivered.
      f.tables.arrival_notices.push({ id: uuid(403), createdAt: ago(3), clientId: CLIENT.abdallah, client: { nom: 'Abdallah', prenom: 'Mohamed' }, actor: { nom: 'Camille Test' }, notify: true, canal: 'telegram', template: 'arrivee_colis',
        items: [{ colisId: D.abdallah, ref: 'EXP-TEST-101', firstCarton: 1, lastCarton: 1 }], cartons: [{ colisId: D.abdallah, ref: 'EXP-TEST-101', carton: 1 }],
        message: { id: uuid(503), colisId: D.abdallah, statut: 'echec', texte: 'Bonjour Mohamed 👋 …', createdAt: ago(3) }, outbox: { id: uuid(903), status: 'failed', attempts: 3, sentAt: null, lastError: 'Chat introuvable' } });
    } });

    await scenario('notice-on-its-way-becomes-to-check-after-ten-minutes', async f => {
      // Five minutes after its validation, a notice on its way is no alert; ten minutes after, the screen says so by itself.
      await rowOf(f, D.techer).waitFor();
      await f.page.waitForTimeout(500);
      assert.equal(await f.page.locator('[data-alert="avis_non_remis"]').count(), 0);
      await f.page.clock.fastForward('06:00');
      await f.page.getByRole('link', { name: '1 avis d’arrivée à vérifier Voir les avis', exact: true }).waitFor();
      // Its sheet: a send started without confirmation is to check in Telegram, never sent again from here.
      await rowOf(f, D.techer).getByRole('link', { name: 'Técher Johnny', exact: true }).click();
      const notice = f.page.getByTestId('fiche-avis');
      await notice.getByText('Envoi à vérifier', { exact: true }).waitFor();
      await notice.getByText('Envoi commencé il y a plus de 10 minutes, sans confirmation de Telegram : vérifiez dans Telegram si le message est arrivé.', { exact: true }).waitFor();
      assert.equal(await notice.getByRole('button', { name: 'Réessayer', exact: true }).count(), 0);
      noSend(f);
    }, { prepare: async f => {
      await f.page.clock.install();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
      Object.assign(f.tables.arrival_notices.find(item => item.id === NOTICE.techer), {
        createdAt: fiveMinutesAgo, message: { id: MESSAGE.techer, colisId: D.techer, statut: 'envoi', texte: 'Bonjour Johnny 👋 …', createdAt: fiveMinutesAgo },
        outbox: { id: uuid(902), status: 'sending', attempts: 1, sentAt: null, lastError: null },
      });
    } });

    await scenario('sheet-dossier-not-found-or-archived', async f => {
      const missing = uuid(999);
      await f.page.goto(`${base}/brouillon/${missing}`);
      await f.page.getByRole('heading', { level: 1, name: 'Dossier introuvable', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('link', { name: 'Ouvrir le dossier complet', exact: true }).getAttribute('href'), `/colis/${missing}?returnTo=%2Fbrouillon%2F${missing}`);
      await assertReadable(f, 'sheet not found');
      await shot(f, 'fiche-introuvable', false);
      await f.page.goto(`${base}/brouillon/${D.archive}`);
      await f.page.getByRole('heading', { level: 1, name: 'Dossier archivé', exact: true }).waitFor();
      await f.page.getByText('EXP-TEST-111 n’apparaît plus dans Colis : il est archivé. Le dossier complet garde son historique.', { exact: true }).waitFor();
      assert.equal(await f.page.getByRole('link', { name: 'Ouvrir le dossier complet', exact: true }).getAttribute('href'), `/colis/${D.archive}?returnTo=%2Fbrouillon%2F${D.archive}`);
      await f.page.goto(`${base}/brouillon/pas-un-dossier`);
      await f.page.getByRole('heading', { level: 1, name: 'Dossier introuvable', exact: true }).waitFor();
      noSend(f);
    });

    await scenario('rights-without-amounts-consent-or-reception', async f => {
      await openHome(f, '?classer=montant');
      // No amount anywhere, no « Par montant », its address falls back to « Par nom ».
      assert.equal(await f.page.getByRole('columnheader', { name: 'Total à payer' }).count(), 0);
      assert.deepEqual(await f.page.getByRole('group', { name: 'Classer', exact: true }).getByRole('button').allInnerTexts(), ['Par nom', 'Par date d’envoi', 'Par réception']);
      assert.equal(await f.page.getByRole('group', { name: 'Classer', exact: true }).getByRole('button', { name: 'Par nom', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.doesNotMatch(await flat(f.page.locator('main')), /€|À calculer/);
      // Actions that need a right: disabled, with the reason.
      const consent = rowOf(f, D.abdallah).getByRole('button', { name: 'Demander l’accord', exact: true });
      assert.equal(await consent.isDisabled(), true);
      await rowOf(f, D.abdallah).getByText('Réservé aux personnes autorisées à demander l’accord.', { exact: true }).waitFor();
      assert.equal(await rowOf(f, D.techer).getByRole('button', { name: 'Valider la réception', exact: true }).isDisabled(), true);
      await rowOf(f, D.techer).getByText('Réservé aux personnes autorisées à réceptionner.', { exact: true }).waitFor();
      await f.page.locator('[data-alert="reception_a_valider"]').getByText('Validation réservée aux personnes autorisées à réceptionner.', { exact: true }).waitFor();
      // Other actions open the dossier task, which keeps its own checks.
      await rowOf(f, D.payet).getByRole('link', { name: 'Préparer', exact: true }).waitFor();
      await assertReadable(f, 'restricted list');
      await assertAccessible(f, 'restricted list');
      await shot(f, 'colis-tablette-sans-montants', false);
      // The sheet: no price, the next step; « Ajouter un carton » and « Réessayer » disabled with their reason.
      await rowOf(f, D.techer).getByRole('link', { name: 'Técher Johnny', exact: true }).click();
      const action = f.page.getByTestId('fiche-action');
      await action.getByRole('heading', { name: 'Prochaine étape', exact: true }).waitFor();
      assert.doesNotMatch(await flat(f.page.locator('main')), /€|Prix à payer/);
      assert.equal(await action.getByRole('button', { name: 'Ajouter un carton', exact: true }).isDisabled(), true);
      await action.getByText('Réservé aux personnes autorisées à réceptionner.', { exact: true }).first().waitFor();
      const notice = f.page.getByTestId('fiche-avis');
      assert.equal(await notice.getByRole('button', { name: 'Réessayer', exact: true }).isDisabled(), true);
      await notice.getByText('Réservé aux personnes autorisées à écrire sur Telegram.', { exact: true }).waitFor();
      await assertReadable(f, 'restricted sheet');
      await assertAccessible(f, 'restricted sheet');
      noSend(f);
    }, { role: 'preparateur', permissions: { perm_colis_preparer: true, perm_clients_voir: true } });

    await scenario('reads-pending-and-notices-quietly-without-a-storm', async f => {
      // The page reached at login: one read at mount.
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor();
      const calls = rpc => f.tables.signal_calls.filter(call => call.rpc === rpc).length;
      assert.equal(calls('list_pending_receptions'), 1);
      assert.equal(f.tables.signal_calls.find(call => call.rpc === 'list_arrival_notices').input.p_limit, 50);
      // A burst of window events is one read, not one per event, and never within five seconds of the last.
      for (let index = 0; index < 5; index += 1) await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await f.page.waitForTimeout(1500);
      assert.equal(calls('list_pending_receptions'), 1, 'No read within five seconds of the last.');
      await f.page.waitForTimeout(4500);
      assert.equal(calls('list_pending_receptions'), 2, 'The burst is read once, five seconds after the last read.');
      // A failed read keeps the list and says so quietly; « Réessayer » reads again at once.
      f.tables.failPending = true;
      f.tables.pending_receptions = [];
      await f.page.waitForTimeout(5200);
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const problem = f.page.getByTestId('colis-signals-error');
      await problem.waitFor();
      assert.match(await flat(problem), /Les réceptions à valider n’ont pas pu être vérifiées \(Service des réceptions indisponible\)\./);
      assert.equal(await f.page.locator('[data-colis-row]').count(), 7, 'The list stays.');
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor();
      await assertReadable(f, 'quiet failure');
      await shot(f, 'colis-tablette-verification-impossible', false);
      f.tables.failPending = false;
      await problem.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await problem.waitFor({ state: 'detached' });
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor({ state: 'detached' });
      await rowOf(f, D.techer).getByText('Accord à demander', { exact: true }).waitFor();
      // Dossiers that change (a carton recorded by a colleague) are followed by a new read.
      const before = calls('list_pending_receptions');
      f.tables.pending_receptions = [{ ...f.tables.pending_receptions[0] || {}, colisId: D.payet, ref: 'EXP-TEST-105', clientId: CLIENT.payet, statut: 'autorise', casier: 'A-07', firstCarton: 3, lastCarton: 3, cartonCount: 1, receivedFrom: ago(0, 1), receivedTo: ago(0, 1), cartons: [{ carton: 3, number: 'PA-3', fournisseur: 'Shein', dimL: 20, dimW: 20, dimH: 10, poids: 0.5, receivedAt: ago(0, 1) }] }];
      const payet = f.tables.colis.find(row => row.id === D.payet);
      Object.assign(payet, { updated_at: new Date().toISOString() });
      await f.page.waitForTimeout(5200);
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await rowOf(f, D.payet).getByText('Réception à valider', { exact: true }).waitFor({ timeout: 15000 });
      assert.ok(calls('list_pending_receptions') > before);
      noSend(f);
    }, { failedRequests: true });

    await scenario('reads-again-every-minute-while-visible', async f => {
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor();
      const reads = () => f.tables.signal_calls.filter(call => call.rpc === 'list_pending_receptions').length;
      assert.equal(reads(), 1);
      // A colleague validates the reception elsewhere: the next minute's read removes the alert, without any action here.
      f.tables.pending_receptions = [];
      await f.page.clock.fastForward('01:01');
      await f.page.locator('[data-alert="reception_a_valider"]').waitFor({ state: 'detached' });
      assert.equal(reads(), 2);
      await rowOf(f, D.techer).getByText('Accord à demander', { exact: true }).waitFor();
      noSend(f);
    }, { prepare: f => f.page.clock.install() });

    await scenario('empty-tab-says-why-and-what-to-do', async f => {
      await f.page.getByRole('heading', { level: 2, name: 'Aucun colis en stock', exact: true }).waitFor();
      await f.page.getByText('Les cartons réceptionnés apparaissent ici jusqu’à l’envoi du devis.', { exact: true }).waitFor();
      assert.equal(await f.page.getByRole('link', { name: 'Réceptionner des cartons', exact: true }).getAttribute('href'), '/recevoir');
      assert.equal(await tabs(f).getByRole('link', { name: 'Brouillon 0 dossier', exact: true }).count(), 1);
      assert.match(await flat(f.page.getByTestId('colis-totals')), /^En stock, devis pas encore envoyé · aucun dossier$/);
      await assertReadable(f, 'empty tab');
      await shot(f, 'colis-tablette-vide', false);
      noSend(f);
    }, { prepare: f => {
      // Nothing in stock: every dossier of the Brouillon tab is gone, nothing waits for its validation.
      f.tables.colis = f.tables.colis.filter(row => !['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'refuse_client'].includes(row.statut));
      f.tables.pending_receptions = []; f.tables.arrival_notices = [];
    } });

    await scenario('email-notice-not-delivered-offers-to-fix-the-address', async f => {
      await f.page.goto(`${base}/brouillon/${D.riviere}`);
      const notice = f.page.getByTestId('fiche-avis');
      await notice.getByText('Non remis', { exact: true }).waitFor();
      await notice.getByText('Raison : Adresse e-mail refusée par le serveur du destinataire', { exact: true }).waitFor();
      assert.equal(await notice.getByRole('link', { name: 'Corriger l’adresse', exact: true }).getAttribute('href'), `/clients/${CLIENT.riviere}`);
      assert.equal(await notice.getByRole('button', { name: 'Copier le texte', exact: true }).count(), 0, 'Nothing to copy for a notice already handed to the provider.');
      await assertReadable(f, 'e-mail not delivered');
      noSend(f);
    }, { prepare: f => Object.assign(f.tables.arrival_notices[0].outbox, { status: 'failed', lastError: 'Adresse e-mail refusée par le serveur du destinataire' }) });

    await scenario('sheet-keeps-the-dossier-when-its-refresh-fails', async f => {
      f.tables.failReadOf = D.payet;
      await f.page.goto(`${base}/brouillon/${D.payet}`);
      await f.page.getByRole('heading', { level: 1, name: 'Payet Flavie', exact: true }).waitFor();
      const note = f.page.getByTestId('fiche-actualisation');
      await note.waitFor();
      assert.match(await flat(note), /^Ce dossier n’a pas pu être actualisé \(Lecture du dossier indisponible\) : vous voyez sa dernière version chargée\. Réessayer$/);
      await f.page.getByTestId('fiche-action').getByRole('link', { name: 'Préparer', exact: true }).waitFor();
      f.tables.failReadOf = null;
      await note.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await note.waitFor({ state: 'detached' });
      // Not loaded and not readable: said as such, with « Réessayer », never as « introuvable ».
      f.tables.failReadOf = D.archive;
      await f.page.goto(`${base}/brouillon/${D.archive}`);
      await f.page.getByRole('heading', { level: 1, name: 'Chargement impossible', exact: true }).waitFor();
      await f.page.getByText('Ce dossier n’a pas pu être chargé (Lecture du dossier indisponible). Rien n’a été modifié : réessayez dans un instant.', { exact: true }).waitFor();
      await assertReadable(f, 'sheet read failure');
      noSend(f);
    }, { failedRequests: true });

    await scenario('sheet-of-a-paid-dossier-and-legacy-work-addresses', async f => {
      // A paid dossier: its departure to prepare, and no carton added without a manager's check.
      await f.page.goto(`${base}/brouillon/${D.fontaine}`);
      await f.page.getByRole('heading', { level: 1, name: 'Fontaine Lucas', exact: true }).waitFor();
      const action = f.page.getByTestId('fiche-action');
      assert.equal(await action.getByRole('link', { name: 'Préparer le départ', exact: true }).getAttribute('href'), `/colis/${D.fontaine}?returnTo=%2Fbrouillon%2F${D.fontaine}&section=expedition#dossier-work`);
      assert.match(await flat(action), /Total à payer 80,00 €/);
      assert.equal(await action.getByRole('button', { name: 'Ajouter un carton', exact: true }).isDisabled(), true);
      await action.getByText('Le paiement est déjà enregistré. Un responsable doit vérifier ce dossier avant tout ajout.', { exact: true }).waitFor();
      await assertReadable(f, 'paid sheet');
      // Mon travail was the home page: its addresses open it at /travail, with their parameters.
      await f.page.goto(`${base}/?section=pool&mission=documents`);
      await f.page.waitForURL(url => url.pathname === '/travail' && url.searchParams.get('section') === 'pool' && url.searchParams.get('mission') === 'documents');
      await f.page.getByRole('heading', { level: 1, name: 'Mon travail', exact: true }).waitFor();
      noSend(f);
    });

    await scenario('first-load-failure-is-stated-in-place', async f => {
      await f.page.getByRole('heading', { name: 'Les colis n’ont pas pu être chargés', exact: true }).waitFor();
      await f.page.getByText(/Indisponibilité simulée/).first().waitFor();
      assert.equal(await tabs(f).count(), 0, 'No tab and no count of 0.');
      assert.equal(await f.page.getByRole('button', { name: 'Réessayer', exact: true }).count(), 1, 'One « Réessayer ».');
      await assertReadable(f, 'failed load');
      await shot(f, 'colis-chargement-impossible', false);
    }, { failTable: 'colis' });

    await scenario('tablet-portrait-768', async f => {
      await openHome(f);
      await f.page.getByRole('table', { name: 'Brouillon, classé par nom' }).waitFor();
      await assertReadable(f, 'tablet portrait');
      await shot(f, 'colis-tablette-portrait');
      await f.page.goto(`${base}/brouillon/${D.riviere}`);
      await f.page.getByRole('heading', { level: 1, name: 'Rivière Marie-Claude', exact: true }).waitFor();
      await f.page.getByTestId('fiche-avis').getByText('À envoyer', { exact: true }).waitFor();
      await assertReadable(f, 'sheet tablet portrait');
      await photosShown(f, 2);
      await shot(f, 'fiche-tablette-portrait');
      noSend(f);
    }, { device: TABLET_PORTRAIT });

    await scenario('desktop-1440-two-columns', async f => {
      await f.page.goto(`${base}/brouillon/${D.riviere}`);
      await f.page.getByRole('heading', { level: 1, name: 'Rivière Marie-Claude', exact: true }).waitFor();
      await f.page.getByTestId('fiche-avis').getByText('À envoyer', { exact: true }).waitFor();
      const [received, action] = await Promise.all(['fiche-recus', 'fiche-action'].map(id => f.page.getByTestId(id).boundingBox()));
      assert.ok(action.x > received.x + received.width, 'Price and action beside the cartons.');
      await assertReadable(f, 'desktop sheet');
      await photosShown(f, 2);
      await shot(f, 'fiche-bureau');
      await openHome(f);
      await shot(f, 'colis-bureau', false);
      noSend(f);
    }, { device: { viewport: { width: 1440, height: 1000 } } });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (!results.length) { console.error('No scenario ran.'); process.exitCode = 1; }
}

module.exports = { seed, ids: { CLIENT, D, E, NOTICE, MESSAGE } };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

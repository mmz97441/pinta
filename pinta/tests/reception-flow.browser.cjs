/* « Réceptionner des cartons » (/recevoir) and « Avis d’arrivée » (/avis), docs/specification-brouillon-reception-2026-10-28.md:
 * the four steps of a reception, the grouped arrival notice and its states, phone and tablet, light and dark. The
 * server's commands are mocked here as the migrations write them (append_reception_cartons and its receipts,
 * list_pending_receptions, validate_reception, list_arrival_notices, send-telegram, the photo upload): nothing leaves
 * the machine. Screenshots go to PINTA_RECEPTION_FLOW_OUT; PINTA_RECEPTION_FLOW_FILTER runs the scenarios whose name
 * contains it. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, ids, base, registerRequestMock } = require('./browser-regression.cjs');

const out = process.env.PINTA_RECEPTION_FLOW_OUT || '/tmp/pinta-reception-flow';
const only = process.env.PINTA_RECEPTION_FLOW_FILTER || '';
const results = [];
const PHONE = { name: 'telephone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const TABLET = { name: 'tablette', viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true };
const H = '88888888-8888-4888-8888-888888888888'; // a client without any dossier and without contact
const E = '99999999-9999-4999-8999-999999999999'; // a client reached by e-mail
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── The server's commands, as supabase/migrations/20261001000001_reception_append.sql and
// 20261028000001_reception_validation.sql define them (the SQL suites test them in depth). ──
const APPEND_STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement'];
const now = () => new Date().toISOString();
const cartonCount = row => Math.max(Number(row.nb_colis) || 0, (row.trackings_detail || []).length, (row.trackings || []).filter(Boolean).length, (row.dims_par_colis || []).length, 1);
const allowed = (tables, permission) => ['directeur', 'vice_directeur'].includes(tables.staff_users[0]?.role) || (tables.staff_permissions || []).some(row => row[permission] === true);
const refused = (status, code, message) => [status, { code, message, details: null, hint: null }];
const number = value => value == null || value === '' ? null : Number(value);

function serverState(tables) {
  // reception_validation_settings.started_at: two hours ago (the fixture's cartons, received in September, are history).
  if (!tables.reception_server) tables.reception_server = { startedAt: Date.now() - 7200000, validations: [], items: [], receipts: [], outbox: [], telegram: 'ok' };
  return tables.reception_server;
}
/** stamp_reception_dates: every carton gets its arrival when it is recorded. */
function stampReceptionDates(tables) {
  for (const row of tables.colis || []) {
    const dates = Array.isArray(row.reception_dates) ? row.reception_dates.slice() : [];
    if (dates.length >= cartonCount(row)) continue;
    while (dates.length < cartonCount(row)) dates.push({ receivedAt: now(), source: 'server' });
    row.reception_dates = dates;
  }
}
function cartonOf(row, position) {
  const detail = (row.trackings_detail || [])[position - 1] || {};
  const boxes = row.dims_par_colis || [];
  const box = boxes[position - 1] || (position === 1 && !boxes.length && cartonCount(row) === 1 ? { dimL: row.dim_l, dimW: row.dim_w, dimH: row.dim_h, poids: row.poids } : {});
  return { carton: position, number: String(detail.number || '').trim() || null, fournisseur: String(detail.fournisseur || '').trim() || null,
    dimL: number(box.dimL), dimW: number(box.dimW), dimH: number(box.dimH), poids: number(box.poids), receivedAt: row.reception_dates?.[position - 1]?.receivedAt || null };
}
function pendingOf(state, row) {
  if (row.archive || row.statut === 'annule') return [];
  const validated = Math.max(0, ...state.items.filter(item => item.colis_id === row.id).map(item => item.last_carton));
  const list = [];
  for (let position = validated + 1; position <= cartonCount(row); position += 1) {
    const at = Date.parse(row.reception_dates?.[position - 1]?.receivedAt);
    if (Number.isFinite(at) && at >= state.startedAt) list.push(cartonOf(row, position));
  }
  return list;
}
function listPending(tables, state, clientId) {
  return tables.colis.filter(row => !clientId || row.client_id === clientId).map(row => ({ row, pending: pendingOf(state, row) })).filter(entry => entry.pending.length)
    .sort((a, b) => Date.parse(a.pending[0].receivedAt) - Date.parse(b.pending[0].receivedAt) || String(a.row.ref).localeCompare(String(b.row.ref)))
    .map(({ row, pending }) => ({ colisId: row.id, ref: row.ref, clientId: row.client_id, statut: row.statut, casier: row.casier, firstCarton: pending[0].carton,
      lastCarton: pending[pending.length - 1].carton, cartonCount: pending.length, receivedFrom: pending[0].receivedAt, receivedTo: pending[pending.length - 1].receivedAt, cartons: pending }));
}
function validationResult(tables, state, row, reused) {
  return { validation: { id: row.id, requestId: row.request_id, clientId: row.client_id, notify: row.notify, canal: row.canal, template: row.template, createdAt: row.created_at, items: row.items, cartons: row.cartons },
    message: tables.messages.find(message => message.id === row.message_id) || null, outbox: state.outbox.find(item => item.id === row.outbox_id) || null, reused };
}
function validateReception(tables, state, user, input) {
  if (!allowed(tables, 'perm_colis_receptionner')) return refused(403, '42501', 'Permission réception requise pour valider une réception.');
  const payload = JSON.stringify({ clientId: input.p_client_id, items: input.p_items, notify: input.p_notify, canal: input.p_canal ?? null, template: input.p_template ?? null, text: input.p_text ?? null });
  const recorded = state.validations.find(row => row.request_id === input.p_request_id);
  if (recorded) {
    if (recorded.actor_id !== user.id || recorded.payload !== payload) return refused(409, '40001', 'Cette validation a déjà été enregistrée avec un autre contenu. Actualisez la liste avant de continuer.');
    return [200, validationResult(tables, state, recorded, true)];
  }
  const client = tables.clients.find(row => row.id === input.p_client_id);
  if (!client) return refused(400, '22023', 'Client introuvable.');
  let channel = null;
  if (input.p_notify) {
    channel = String(client.telegram_chat_id || '').trim() ? 'telegram' : String(client.email || '').trim() ? 'email' : null;
    if (!channel) return refused(400, '22023', 'Ce client n’a ni Telegram ni e-mail : validez sans prévenir.');
    if (!['telegram', 'email'].includes(input.p_canal)) return refused(400, '22023', 'Précisez le canal de l’avis d’arrivée : telegram ou email.');
    if (input.p_canal !== channel) return refused(409, '40001', `Le contact du client a changé : l’avis partira par ${channel === 'telegram' ? 'Telegram' : 'e-mail'}. Actualisez avant de valider.`);
    if (!allowed(tables, channel === 'email' ? 'perm_comm_email' : 'perm_comm_telegram')) return refused(403, '42501', 'Permission communication requise pour prévenir le client : validez sans prévenir ou confiez l’avis à un collègue.');
    if (!['arrivee_colis', 'arrivee_colis_facture'].includes(input.p_template)) return refused(400, '22023', 'Choisissez le modèle de l’avis d’arrivée : arrivee_colis ou arrivee_colis_facture.');
    if (!String(input.p_text || '').trim() || input.p_text.length > 4096) return refused(400, '22023', 'Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.');
  } else if (input.p_canal != null || input.p_template != null || input.p_text != null) return refused(400, '22023', 'Sans avis, ne transmettez ni canal, ni modèle, ni texte.');
  const items = [], cartons = [];
  for (const item of input.p_items || []) {
    const row = tables.colis.find(colis => colis.id === item.colisId);
    if (!row) return refused(400, '22023', 'Dossier introuvable : actualisez la liste.');
    if (row.client_id !== input.p_client_id) return refused(400, '22023', `Le dossier ${row.ref} n’appartient pas à ce client.`);
    const pending = pendingOf(state, row);
    if (!pending.length) return refused(400, '22023', `Le dossier ${row.ref} n’a aucun carton en attente de validation : actualisez la liste.`);
    if (!pending.some(carton => carton.carton === item.throughCarton)) return refused(400, '22023', `Le carton n° ${item.throughCarton} du dossier ${row.ref} n’est pas en attente de validation : actualisez la liste.`);
    const selected = pending.filter(carton => carton.carton <= item.throughCarton);
    items.push({ colisId: row.id, ref: row.ref, firstCarton: selected[0].carton, lastCarton: item.throughCarton });
    cartons.push(...selected.map(carton => ({ colisId: row.id, ref: row.ref, ...carton })));
  }
  const id = crypto.randomUUID();
  let message = null, outbox = null;
  if (input.p_notify) {
    // queue_message(<first dossier>, text, template, 'arrival:<id>', NULL, canal): « envoi », pending (Telegram) or manual (e-mail).
    message = { id: crypto.randomUUID(), colis_id: items[0].colisId, type: 'staff', auteur_nom: 'Camille', texte: input.p_text, statut: 'envoi', canal: channel, template: input.p_template, created_at: now() };
    tables.messages.push(message);
    outbox = { id: crypto.randomUUID(), message_id: message.id, client_id: client.id, colis_id: message.colis_id, canal: channel, status: channel === 'email' ? 'manual' : 'pending', attempts: 0, sent_at: null, last_error: null, idempotency_key: `arrival:${id}` };
    state.outbox.push(outbox);
  }
  const row = { id, request_id: input.p_request_id, client_id: client.id, actor_id: user.id, notify: input.p_notify, canal: channel, template: input.p_notify ? input.p_template : null,
    message_id: message?.id || null, outbox_id: outbox?.id || null, items, cartons, payload, created_at: now() };
  state.validations.push(row);
  for (const item of items) state.items.push({ validation_id: id, colis_id: item.colisId, first_carton: item.firstCarton, last_carton: item.lastCarton });
  return [200, validationResult(tables, state, row, false)];
}
function listNotices(tables, state, input) {
  return state.validations.map((row, order) => ({ row, order }))
    .filter(({ row }) => (!input.p_client_id || row.client_id === input.p_client_id) && (!input.p_colis_id || row.items.some(item => item.colisId === input.p_colis_id)))
    .sort((a, b) => Date.parse(b.row.created_at) - Date.parse(a.row.created_at) || b.order - a.order).slice(0, input.p_limit ?? 50)
    .map(({ row }) => {
      const client = tables.clients.find(item => item.id === row.client_id) || {};
      const message = tables.messages.find(item => item.id === row.message_id);
      const outbox = state.outbox.find(item => item.id === row.outbox_id);
      return { id: row.id, createdAt: row.created_at, clientId: row.client_id, client: { nom: client.nom, prenom: client.prenom }, actor: { nom: 'Camille Test' },
        notify: row.notify, canal: row.canal, template: row.template, items: row.items, cartons: row.cartons,
        message: message ? { id: message.id, statut: message.statut, texte: message.texte, createdAt: message.created_at } : null,
        outbox: outbox ? { id: outbox.id, status: outbox.status, attempts: outbox.attempts, sentAt: outbox.sent_at, lastError: outbox.last_error } : null };
    });
}
/** send-telegram with { colisId, messageId, retryConfirmed }: claims a pending delivery only; a failed one again only when confirmed. */
function sendTelegram(tables, state, input) {
  if (!allowed(tables, 'perm_comm_telegram')) return [403, { error: 'Permission requise' }];
  const outbox = state.outbox.find(item => item.message_id === input.messageId);
  if (!outbox) return [400, { error: 'Un message enregistré dans la file d’envoi est requis' }];
  if (outbox.canal !== 'telegram' || (input.colisId && input.colisId !== outbox.colis_id)) return [400, { error: 'Message et dossier incompatibles' }];
  if (input.retryConfirmed === true && outbox.status === 'failed') Object.assign(outbox, { status: 'pending', last_error: null });
  if (!['pending', 'blocked'].includes(outbox.status)) return [200, { ok: outbox.status === 'sent', status: outbox.status, messageId: outbox.message_id }];
  const message = tables.messages.find(item => item.id === outbox.message_id);
  outbox.attempts += 1;
  if (state.telegram === 'fail') {
    Object.assign(outbox, { status: 'failed', last_error: 'Telegram : chat introuvable' });
    message.statut = 'echec';
    return [200, { ok: false, status: 'failed', error: outbox.last_error, messageId: message.id }];
  }
  Object.assign(outbox, { status: 'sent', sent_at: now() });
  message.statut = 'envoye';
  return [200, { ok: true, status: 'sent', messageId: message.id }];
}
/** append_reception_cartons: the receipt of a request identifier answers its replay; the cartons are appended once. */
function appendCartons(tables, state, user, input) {
  if (!allowed(tables, 'perm_colis_receptionner')) return refused(403, '42501', 'Permission réception requise');
  const row = tables.colis.find(item => item.id === input.p_colis_id);
  if (!row) return refused(400, '22023', 'Dossier introuvable.');
  const payload = JSON.stringify({ cartons: input.p_cartons, casier: input.p_casier ?? null, notes: input.p_notes_reception ?? null, checks: input.p_check_interdits ?? null });
  const receipt = state.receipts.find(item => item.request_id === input.p_request_id);
  if (receipt) {
    if (receipt.colis_id !== row.id || receipt.actor_id !== user.id || receipt.payload !== payload) return refused(409, '40001', 'Cette réception a déjà été enregistrée avec un autre contenu. Actualisez le dossier avant de continuer.');
    return [200, { colis: row, added: receipt.added, firstCarton: receipt.first, lastCarton: receipt.first + receipt.added - 1, reused: true }];
  }
  if (row.archive || row.paiement_date || row.paiement_montant != null || !APPEND_STATUSES.includes(row.statut)) return refused(400, '22023', 'Ajoutez les cartons à un dossier ouvert, avant paiement et départ.');
  if (input.p_expected_updated_at !== row.updated_at) return refused(409, '40001', 'Le dossier a changé. Actualisez-le avant de rattacher vos cartons ; vos saisies sont conservées.');
  const cartons = input.p_cartons || [];
  const keys = ['dimL', 'dimW', 'dimH', 'poids'];
  if (!cartons.length || cartons.some(carton => !keys.every(key => Number(carton[key]) > 0))) return refused(400, '22023', 'Renseignez longueur, largeur, hauteur et poids positifs de chaque nouveau carton.');
  for (const carton of cartons) {
    const code = String(carton.tracking || '').trim().toLowerCase();
    if (!code) continue;
    const owner = tables.colis.find(other => [...(other.trackings || []), ...(other.trackings_detail || []).map(detail => detail.number)].some(value => String(value || '').trim().toLowerCase() === code));
    if (owner) return refused(400, '22023', owner === row ? `Ce numéro de suivi est déjà présent dans ce dossier : ${carton.tracking}.` : 'Ce numéro de suivi est déjà enregistré dans un autre dossier. Vérifiez le carton.');
  }
  const oldCount = cartonCount(row);
  const details = Array.from({ length: oldCount }, (_, index) => row.trackings_detail?.[index] || { number: row.trackings?.[index] || '', fournisseur: '' });
  const boxes = Array.from({ length: oldCount }, (_, index) => row.dims_par_colis?.[index] || (oldCount === 1 ? { dimL: row.dim_l, dimW: row.dim_w, dimH: row.dim_h, poids: row.poids } : {}));
  for (const carton of cartons) {
    boxes.push(Object.fromEntries(keys.map(key => [key, Number(carton[key])])));
    details.push({ number: String(carton.tracking || '').trim(), fournisseur: String(carton.fournisseur || '').trim() });
  }
  const complete = boxes.every(box => keys.every(key => Number(box[key]) > 0));
  Object.assign(row, {
    nb_colis: boxes.length, dims_par_colis: boxes, trackings_detail: details, trackings: [...(row.trackings || []), ...cartons.map(carton => String(carton.tracking || '').trim()).filter(Boolean)],
    dim_l: complete ? Math.max(...boxes.map(box => +box.dimL)) : null, dim_w: complete ? Math.max(...boxes.map(box => +box.dimW)) : null, dim_h: complete ? Math.max(...boxes.map(box => +box.dimH)) : null,
    poids: complete ? Math.round(boxes.reduce((sum, box) => sum + +box.poids, 0) * 100) / 100 : null,
    statut: complete ? 'mesure' : 'receptionne', feu_vert: 'en_attente', feu_vert_date: null, attente_client_date: null, attente_client_until: null, attente_client_motif: null, demande_feu_vert_envoyee_at: null,
    preparation_composition_version: (row.preparation_composition_version || 0) + 1, final_measurements_version: null, final_measurements_at: null,
    updated_at: new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1000)).toISOString(),
  });
  if (String(input.p_casier || '').trim()) row.casier = input.p_casier.trim();
  if (String(input.p_notes_reception || '').trim()) row.notes_reception = [row.notes_reception, input.p_notes_reception.trim()].filter(Boolean).join('\n');
  row.check_interdits = [...new Set([...(row.check_interdits || []), ...(input.p_check_interdits || [])])].sort();
  row.produit_interdit = Boolean(row.produit_interdit) || (input.p_check_interdits || []).length > 0;
  state.receipts.push({ request_id: input.p_request_id, colis_id: row.id, actor_id: user.id, payload, first: oldCount + 1, added: cartons.length });
  return [200, { colis: row, added: cartons.length, firstCarton: oldCount + 1, lastCarton: boxes.length }];
}

registerRequestMock(({ url, method, input, tables, user }) => {
  const state = serverState(tables);
  stampReceptionDates(tables);
  if (url.pathname.endsWith('/functions/v1/send-telegram')) return sendTelegram(tables, state, input || {});
  if (!url.pathname.includes('/rest/v1/rpc/')) return undefined;
  const rpc = url.pathname.split('/').pop();
  if (rpc === 'list_pending_receptions') return [200, listPending(tables, state, input?.p_client_id || null)];
  if (rpc === 'validate_reception') return validateReception(tables, state, user, input || {});
  if (rpc === 'list_arrival_notices') return [200, listNotices(tables, state, input || {})];
  if (rpc === 'append_reception_cartons') return appendCartons(tables, state, user, input || {});
  return undefined;
});

// ── Fixtures and helpers ──
function fixtures(f, { telegram = false, email = true } = {}) {
  const [camille] = f.tables.clients;
  Object.assign(camille, { tel: '0692 11 22 33', commune: 'Saint-Denis', telegram_chat_id: telegram ? 'chat-camille' : null, email: email ? 'camille@example.test' : null });
  f.tables.clients.push(
    { id: H, ref: 'CLI-HOARAU', nom: 'Hoarau', prenom: 'Jean', tel: '0693 44 55 66', cp: '97430', ville: 'Le Tampon', adresse_ligne1: '2 chemin Hoarau', type: 'particulier', abonnement: 'freemium', onboarded: true, created_at: '2026-09-02T08:00:00Z' },
    { id: E, ref: 'CLI-GRONDIN', nom: 'Grondin', prenom: 'Marie', email: 'marie.grondin@example.test', tel: '0692 77 88 99', cp: '97460', ville: 'Saint-Paul', adresse_ligne1: '3 rue des Lilas', type: 'particulier', abonnement: 'freemium', onboarded: true, created_at: '2026-09-03T08:00:00Z' },
  );
  // The fixture dossier: its two cartons measured one by one, received before the start of the validated receptions
  // (nothing to validate).
  const parcel = f.tables.colis.find(row => row.id === ids.P);
  parcel.dims_par_colis = [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 30, dimW: 20, dimH: 10, poids: 1 }];
  for (const row of f.tables.colis) row.reception_dates = Array.from({ length: cartonCount(row) }, () => ({ receivedAt: '2026-09-08T08:00:00.000Z', source: 'server' }));
  return serverState(f.tables);
}
/** A carton of P recorded earlier (the old /reception screen, or a colleague): it waits for its validation. */
function earlierPendingCarton(f, { tracking = 'TBA30219911', fournisseur = 'Amazon' } = {}) {
  const parcel = f.tables.colis.find(row => row.id === ids.P);
  parcel.trackings_detail = [...parcel.trackings_detail, { number: tracking, fournisseur }];
  parcel.trackings = [...parcel.trackings, tracking];
  parcel.dims_par_colis = [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 30, dimW: 20, dimH: 10, poids: 1 }, { dimL: 30, dimW: 25, dimH: 15, poids: 1.1 }];
  parcel.nb_colis = 3;
  parcel.statut = 'mesure'; parcel.feu_vert = 'en_attente';
  parcel.reception_dates = [...parcel.reception_dates, { receivedAt: new Date(Date.now() - 3600000).toISOString(), source: 'server' }];
}
const flowRoot = page => page.locator('.rf').first();
const requestsTo = (f, suffix) => f.requests.filter(request => request.method === 'POST' && request.path.endsWith(suffix));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function fillCarton(page, { casier, tracking, vendor, measures }) {
  if (casier != null) await page.getByLabel(/^Casier/).fill(casier);
  if (tracking != null) await page.getByLabel(/^Numéro de suivi/).fill(tracking);
  if (vendor != null) await page.getByLabel(/^Vendu par/).fill(vendor);
  for (const [index, label] of ['Longueur (cm)', 'Largeur (cm)', 'Hauteur (cm)', 'Poids (kg)'].entries())
    if (measures?.[index] != null) await page.getByLabel(label, { exact: true }).fill(String(measures[index]));
}
async function chooseClient(page, query, name) {
  await page.getByLabel('Nom, téléphone ou numéro client').fill(query);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.getByRole('heading', { level: 2, name: /^Le (premier )?carton$/ }).waitFor();
}
async function addCarton(page) {
  await page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: /^Cette réception : \d+ cartons?$/ }).waitFor();
}

/** Text of 15 px or more, targets of 44 px or more (56 px for the reception's main buttons), no horizontal scroll,
 * no emoji in the interface, no accessibility violation (axe, WCAG 2.2 AA) in the screen. */
async function checkScreen(f, label) {
  await settle(f.page);
  const report = await f.page.evaluate(() => {
    const root = document.querySelector('.rf');
    const shown = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-hidden') === 'true' || node.classList.contains('sr-only')) return false;
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const small = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !shown(node.parentElement)) continue;
      const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
      if (size < 15) small.push(`${node.textContent.trim().slice(0, 40)} (${size}px)`);
    }
    const controls = [...root.querySelectorAll('button, a[href], input, select, textarea, summary')]
      .filter(element => !(element.matches('input[type="checkbox"], input[type="file"]')) && !element.classList.contains('rf-note-link') && shown(element));
    const tooSmall = controls.map(element => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 43.5 || box.width < 43.5).map(({ element, box }) => `${(element.getAttribute('aria-label') || element.textContent || element.id).trim().slice(0, 40)} (${Math.round(box.width)}×${Math.round(box.height)})`);
    const mainTooSmall = [...root.querySelectorAll('.rf-primary, .rf-secondary')].filter(shown).map(element => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 55.5).map(({ element, box }) => `${element.textContent.trim().slice(0, 40)} (${Math.round(box.height)})`);
    // Actions are written from 17 px (the discreet « Valider sans prévenir » aside).
    const smallActions = [...root.querySelectorAll('.rf-primary, .rf-secondary, .rf-small-action, .rf-toggle')].filter(shown)
      .filter(element => parseFloat(getComputedStyle(element).fontSize) < 17).map(element => element.textContent.trim().slice(0, 40));
    const clone = root.cloneNode(true);
    clone.querySelectorAll('pre.rf-message').forEach(node => node.remove());
    const emoji = (clone.textContent.match(/\p{Extended_Pictographic}/gu) || []).join('');
    const main = document.querySelector('main');
    // A title is never covered by a control, nor cut: the box of its text, not of its element.
    const covered = [];
    for (const heading of [...root.querySelectorAll('h1, h2, h3')].filter(shown)) {
      const range = document.createRange(); range.selectNodeContents(heading);
      const text = range.getBoundingClientRect();
      if (heading.scrollWidth > heading.clientWidth + 1) covered.push(`${heading.textContent.trim()} is cut`);
      for (const control of controls) {
        if (heading.contains(control) || control.contains(heading)) continue;
        const box = control.getBoundingClientRect();
        if (Math.min(text.right, box.right) - Math.max(text.left, box.left) > 1 && Math.min(text.bottom, box.bottom) - Math.max(text.top, box.top) > 1)
          covered.push(`${heading.textContent.trim()} under ${(control.textContent || control.id).trim().slice(0, 30)}`);
      }
    }
    return { small, tooSmall, mainTooSmall, smallActions, emoji, covered, overflowX: document.documentElement.scrollWidth > innerWidth + 1 || (main ? main.scrollWidth > main.clientWidth + 1 : false) };
  });
  assert.deepEqual(report.covered, [], `${label}: titles neither covered nor cut`);
  assert.deepEqual(report.smallActions, [], `${label}: actions of 17 px or more`);
  assert.deepEqual(report.small, [], `${label}: text of 15 px or more`);
  assert.deepEqual(report.tooSmall, [], `${label}: targets of 44 px or more`);
  assert.deepEqual(report.mainTooSmall, [], `${label}: main reception buttons of 56 px or more`);
  assert.equal(report.emoji, '', `${label}: no emoji in the interface`);
  assert.equal(report.overflowX, false, `${label}: no horizontal scroll`);
  const axe = await new AxeBuilder({ page: f.page }).include('.rf').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target.join(' ')).slice(0, 4) })), [], `${label}: no accessibility violation`);
}
/** What the operator sees, then the whole screen (taller window, same width). */
async function snap(f, name) {
  const page = f.page;
  await settle(page);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  const size = page.viewportSize();
  const needed = await page.evaluate(() => {
    const main = document.querySelector('main.staff-main');
    return main ? Math.ceil(innerHeight + main.scrollHeight - main.clientHeight) : document.documentElement.scrollHeight;
  });
  if (needed > size.height + 8) {
    await page.setViewportSize({ width: size.width, height: Math.min(needed, 4000) });
    await settle(page);
    await page.screenshot({ path: path.join(out, `${name}-complet.png`) });
    await page.setViewportSize(size);
    await settle(page);
  }
}

async function scenario(browser, name, options, run) {
  if (only && !name.includes(only)) return;
  const { role = 'directeur', layout = TABLET, dark = false, expectedConsole = null } = options;
  const f = await setup(browser, role, { device: { viewport: layout.viewport, hasTouch: layout.hasTouch, isMobile: layout.isMobile } });
  f.page.setDefaultTimeout(10000);
  const consoleErrors = [];
  f.page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await f.page.addInitScript(isDark => { try { localStorage.setItem('expedile-theme', isDark ? 'dark' : 'light'); } catch { /* the default theme */ } }, dark);
  const started = Date.now();
  try {
    await run(f);
    assert.deepEqual(f.errors, [], 'no page error');
    assert.deepEqual(consoleErrors.filter(text => !(expectedConsole && expectedConsole.test(text))), [], 'no console error');
    assert.deepEqual(f.networkDenied, [], 'every request is answered by the mocks');
    results.push({ test: name, pass: true, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    process.exitCode = 1;
    results.push({ test: name, pass: false, error: error.stack });
    await f.page.screenshot({ path: path.join(out, `${name}-echec.png`) }).catch(() => {});
    await fs.writeFile(path.join(out, `${name}-echec.txt`), await f.page.locator('body').innerText().catch(() => '')).catch(() => {});
  } finally {
    await f.context.close();
  }
}

(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await scenario(browser, 'nouveau-client-nouveau-brouillon-deux-cartons-avis-telegram', { layout: TABLET }, async f => {
      const state = fixtures(f);
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      const search = f.page.getByLabel('Nom, téléphone ou numéro client');
      await search.waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-client-search', 'the search takes the focus');
      await search.fill('Payet Flavie');
      await f.page.getByText('Aucun client ne correspond à « Payet Flavie ».').waitFor();
      await checkScreen(f, 'step 1 nothing found');
      await f.page.getByRole('button', { name: 'Créer un nouveau client' }).click();
      const form = f.page.getByRole('form', { name: 'Nouveau client' });
      assert.equal(await form.getByLabel('Nom', { exact: true }).inputValue(), 'Payet Flavie', 'the search fills the name');
      await form.getByLabel('Nom', { exact: true }).fill('Payet');
      await form.getByRole('button', { name: 'Créer le client' }).click();
      await form.getByText(/^Fiche client incomplète : il manque/).waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-new-client-prenom', 'the first field to complete takes the focus');
      assert.equal(requestsTo(f, '/rest/v1/clients').length, 0, 'an incomplete client is never sent');
      await form.getByLabel('Prénom', { exact: true }).fill('Flavie');
      await form.getByLabel('Téléphone mobile', { exact: true }).fill('0692 12 34 56');
      await form.getByLabel('E-mail', { exact: true }).fill('flavie.payet@example.test');
      await form.getByLabel('Adresse de livraison', { exact: true }).fill('12 rue des Bougainvilliers');
      await form.getByLabel('Code postal', { exact: true }).fill('97410');
      await form.getByLabel('Ville', { exact: true }).fill('Saint-Pierre');
      await checkScreen(f, 'step 1 new client');
      await snap(f, 'tablette-clair-1b-nouveau-client');
      await form.getByRole('button', { name: 'Créer le client' }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Le premier carton' }).waitFor();
      const created = f.tables.clients.find(row => row.email === 'flavie.payet@example.test');
      assert.ok(created, 'the client is created through the API');
      assert.equal(new URL(f.page.url()).searchParams.get('client'), created.id);
      await f.page.getByText('Aucun brouillon en cours : ce carton en ouvre un nouveau.').waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-casier', 'the locker of a new brouillon takes the focus');
      // The client links Telegram meanwhile (invitation): the validation reads the client again and uses Telegram.
      created.telegram_chat_id = 'chat-flavie';

      // Carton 1: the new brouillon, created with its stable identifier.
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      await f.page.getByText('Indiquez le casier où vous rangez ce carton.').waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-casier');
      assert.equal(requestsTo(f, '/rest/v1/colis').length, 0, 'nothing is recorded without its measures');
      await fillCarton(f.page, { casier: 'b-07', tracking: 'LP00498821', vendor: 'Shein', measures: ['45', '32', '20', '2,4'] });
      assert.equal(await f.page.getByLabel(/^Casier/).inputValue(), 'B-07', 'the locker is written in capitals');
      await checkScreen(f, 'step 2 new brouillon');
      await snap(f, 'tablette-clair-2b-premier-carton');
      await addCarton(f.page);
      const inserts = requestsTo(f, '/rest/v1/colis');
      assert.equal(inserts.length, 1);
      const insert = inserts[0].input;
      assert.match(insert.id, /^[0-9a-f-]{36}$/, 'insertColis receives its createId');
      assert.deepEqual({ client: insert.client_id, statut: insert.statut, casier: insert.casier, trackings: insert.trackings, details: insert.trackings_detail, boxes: insert.dims_par_colis, count: insert.nb_colis, checks: insert.check_interdits, prohibited: insert.produit_interdit },
        { client: created.id, statut: 'mesure', casier: 'B-07', trackings: ['LP00498821'], details: [{ number: 'LP00498821', fournisseur: 'Shein' }], boxes: [{ dimL: 45, dimW: 32, dimH: 20, poids: 2.4 }], count: 1, checks: [], prohibited: false });
      const dossier = f.tables.colis.find(row => row.id === insert.id);
      const insertedRevision = dossier.updated_at;
      await f.page.getByText(`Carton n° 1 enregistré dans ${dossier.ref} (nouveau brouillon).`).waitFor();
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();

      // Carton 2 joins the same brouillon.
      await f.page.getByRole('button', { name: 'Ajouter un autre carton pour Flavie' }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Le carton' }).waitFor();
      await f.page.getByText('Brouillon en cours : 1 carton · Casier B-07').waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-tracking', 'the tracking number takes the focus');
      await fillCarton(f.page, { vendor: 'Amazon', measures: ['30', '25', '15', '1.1'] });
      await addCarton(f.page);
      const appends = requestsTo(f, '/rpc/append_reception_cartons');
      assert.equal(appends.length, 1);
      assert.equal(appends[0].input.p_colis_id, dossier.id);
      assert.equal(appends[0].input.p_expected_updated_at, insertedRevision, 'the addition names the revision it saw');
      assert.deepEqual(appends[0].input.p_cartons, [{ dimL: 30, dimW: 25, dimH: 15, poids: 1.1, fournisseur: 'Amazon', tracking: '' }]);
      assert.match(appends[0].input.p_request_id, /^[0-9a-f-]{36}$/);
      await f.page.getByRole('heading', { name: 'Cette réception : 2 cartons' }).waitFor();
      await f.page.getByText('En validant, Flavie reçoit un seul message Telegram pour 2 colis.').waitFor();
      await checkScreen(f, 'step 3 telegram');
      await snap(f, 'tablette-clair-3-validation-telegram');

      // One tap: one validation, one message for the two cartons, delivered at once.
      await f.page.getByRole('button', { name: 'Valider la réception et prévenir Flavie' }).click();
      await f.page.getByRole('heading', { level: 2, name: `Réception validée : 2 colis ajoutés au brouillon de Flavie Payet` }).waitFor();
      const validations = requestsTo(f, '/rpc/validate_reception');
      assert.equal(validations.length, 1);
      const sent = validations[0].input;
      assert.deepEqual({ client: sent.p_client_id, items: sent.p_items, notify: sent.p_notify, canal: sent.p_canal, template: sent.p_template },
        { client: created.id, items: [{ colisId: dossier.id, throughCarton: 2 }], notify: true, canal: 'telegram', template: 'arrivee_colis_facture' });
      assert.match(sent.p_text, /^Bonjour Flavie/);
      assert.match(sent.p_text, /2 colis/);
      assert.match(sent.p_text, /1\. Shein — LP00498821 — 45×32×20 cm — 2\.4 kg\n2\. Amazon — Sans numéro de suivi — 30×25×15 cm — 1\.1 kg/);
      assert.equal(state.validations.length, 1);
      assert.equal(f.tables.messages.length, 1, 'one message for the two cartons');
      const deliveries = requestsTo(f, '/functions/v1/send-telegram');
      assert.equal(deliveries.length, 1, 'the Telegram message is delivered at once');
      assert.deepEqual(deliveries[0].input, { colisId: dossier.id, messageId: f.tables.messages[0].id });
      await f.page.getByText('B-07', { exact: true }).waitFor();
      await f.page.getByText('Message Telegram envoyé à Flavie · 2 colis').waitFor();
      await f.page.getByText('Rangez-les dans le casier').waitFor();
      await checkScreen(f, 'step 4 telegram');
      await snap(f, 'tablette-clair-4-rangement-telegram');
      await f.page.getByRole('button', { name: 'Client suivant' }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Pour quel client ?' }).waitFor();
      assert.equal(await f.page.getByLabel('Nom, téléphone ou numéro client').inputValue(), '', 'the next client starts from an empty search');
      assert.equal(await f.page.evaluate(id => Object.keys(sessionStorage).some(key => key.includes(encodeURIComponent(`reception-flow:client:${id}`))), created.id), false, 'the finished reception leaves nothing in the session');
    });

    await scenario(browser, 'client-existant-rejoint-son-brouillon-avis-email-produit-interdit', { layout: PHONE, dark: true }, async f => {
      fixtures(f);
      await f.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByLabel('Nom, téléphone ou numéro client').fill('0692 11 22 33');
      const result = f.page.getByRole('button', { name: /^Exemple Camille/ });
      await result.waitFor();
      assert.match(await result.innerText(), /Brouillon en cours : 2 cartons · Casier A-03/);
      assert.match(await result.innerText(), /Le carton rejoint son brouillon/);
      await checkScreen(f, 'phone dark step 1');
      await snap(f, 'telephone-sombre-1-client');
      await result.click();
      await f.page.getByRole('heading', { level: 2, name: 'Le carton' }).waitFor();
      await f.page.getByText('Il faudra redemander l’accord du client et vérifier la préparation avec le nouveau carton.', { exact: false }).waitFor();
      assert.equal(await f.page.getByLabel(/^Casier/).count(), 0, 'the brouillon keeps its locker');
      await fillCarton(f.page, { tracking: 'TBA3021991100', vendor: 'Amazon', measures: ['30', '25', '15', '1,1'] });
      const lithium = f.page.getByRole('button', { name: 'Batteries lithium' });
      await lithium.click();
      assert.equal(await lithium.getAttribute('aria-pressed'), 'true');
      await f.page.getByText(/^Produit interdit signalé : Batteries lithium/).waitFor();
      await checkScreen(f, 'phone dark step 2');
      await snap(f, 'telephone-sombre-2-carton');
      await addCarton(f.page);
      const append = requestsTo(f, '/rpc/append_reception_cartons')[0].input;
      assert.deepEqual({ dossier: append.p_colis_id, cartons: append.p_cartons, checks: append.p_check_interdits, casier: append.p_casier, notes: append.p_notes_reception, expected: append.p_expected_updated_at },
        { dossier: ids.P, cartons: [{ dimL: 30, dimW: 25, dimH: 15, poids: 1.1, fournisseur: 'Amazon', tracking: 'TBA3021991100' }], checks: ['Batteries lithium'], casier: null, notes: null, expected: '2026-09-09T08:00:00Z' });
      assert.equal(f.tables.colis[0].produit_interdit, true, 'the forbidden product reaches the server');
      await f.page.getByText('Déjà en stock : 2 cartons · Casier A-03').waitFor();
      await f.page.getByText(/^En validant, l’e-mail pour Camille est préparé pour 1 colis/).waitFor();
      await checkScreen(f, 'phone dark step 3');
      await snap(f, 'telephone-sombre-3-validation-email');
      await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Réception validée : 1 colis ajouté au brouillon de Camille Exemple' }).waitFor();
      const sent = requestsTo(f, '/rpc/validate_reception')[0].input;
      assert.deepEqual({ canal: sent.p_canal, template: sent.p_template, items: sent.p_items }, { canal: 'email', template: 'arrivee_colis', items: [{ colisId: ids.P, throughCarton: 3 }] });
      assert.equal(requestsTo(f, '/functions/v1/send-telegram').length, 0, 'an e-mail is never sent through Telegram');
      await f.page.getByText('E-mail à envoyer à Camille · 1 colis').waitFor();
      await f.page.getByText('Camille avait donné son accord pour 2 cartons. Pour ce nouveau carton, son accord est à redemander : sa ligne passe à « Accord à demander » dans le Brouillon.').waitFor();
      await f.page.getByRole('button', { name: 'Copier le texte' }).click();
      await f.page.getByText('Texte copié : collez-le dans un e-mail à camille@example.test.').waitFor();
      assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()), sent.p_text, 'the text copied is the recorded notice');
      const mailto = await f.page.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href');
      assert.match(mailto, /^mailto:camille@example\.test\?subject=Votre%20colis%20est%20arriv%C3%A9%20chez%20Exped%C3%AEle&body=Bonjour%20Camille/);
      await checkScreen(f, 'phone dark step 4');
      await snap(f, 'telephone-sombre-4-rangement-email');
      await f.page.getByRole('button', { name: 'Voir le Brouillon' }).click();
      await f.page.waitForURL(url => url.pathname === '/');
    });

    await scenario(browser, 'client-sans-contact-seulement-sans-avis', { layout: PHONE }, async f => {
      fixtures(f);
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByLabel('Nom, téléphone ou numéro client').fill('CLI-HOARAU');
      const result = f.page.getByRole('button', { name: /^Hoarau Jean/ });
      assert.match(await result.innerText(), /Aucun brouillon en cours/);
      assert.match(await result.innerText(), /Nouveau brouillon/);
      await result.click();
      await f.page.getByRole('heading', { level: 2, name: 'Le premier carton' }).waitFor();
      await f.page.getByText('Vous validerez ensuite la réception.', { exact: false }).waitFor();
      await fillCarton(f.page, { casier: 'C-12', measures: ['50', '40', '30', '6'] });
      await checkScreen(f, 'phone light step 2');
      await snap(f, 'telephone-clair-2-premier-carton');
      await addCarton(f.page);
      await f.page.getByText('Jean n’a ni Telegram ni e-mail : la réception sera validée sans avis.', { exact: false }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /prévenir Jean/ }).count(), 0, 'no notice is offered without a contact');
      assert.equal(await f.page.getByRole('link', { name: 'Compléter sa fiche' }).getAttribute('href'), `/clients/${H}`);
      await checkScreen(f, 'phone light step 3 without contact');
      await snap(f, 'telephone-clair-3-validation-sans-contact');
      await f.page.getByRole('button', { name: 'Valider sans prévenir', exact: true }).click();
      await f.page.getByText('Réception validée sans avis : le client n’est pas prévenu').waitFor();
      const sent = requestsTo(f, '/rpc/validate_reception')[0].input;
      assert.deepEqual({ notify: sent.p_notify, canal: sent.p_canal, template: sent.p_template, text: sent.p_text }, { notify: false, canal: null, template: null, text: null });
      assert.equal(f.tables.messages.length, 0);
      await f.page.getByText('C-12', { exact: true }).waitFor();
      await checkScreen(f, 'phone light step 4 without notice');
      await snap(f, 'telephone-clair-4-rangement-sans-avis');
    });

    await scenario(browser, 'reprise-apres-rechargement-et-carton-abime-avec-photo', { layout: TABLET }, async f => {
      fixtures(f);
      // The private photo bucket (a multipart upload, answered before the shared JSON server).
      const uploads = [];
      await f.context.route('**/storage/v1/object/photos-colis/**', route => {
        uploads.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'photos-colis/carton.png', Id: crypto.randomUUID() }) });
      });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}`);
      await f.page.getByRole('heading', { level: 2, name: 'Le carton' }).waitFor();
      await fillCarton(f.page, { tracking: 'COLISSIMO-778', vendor: 'Zara', measures: ['44', '33'] });
      await f.page.getByRole('button', { name: 'Aérosols' }).click();
      await f.page.getByRole('checkbox', { name: /Carton abîmé ou ouvert/ }).check();
      await f.page.getByLabel(/^Ce que vous constatez/).fill('Coin enfoncé');
      assert.ok(await f.page.evaluate(() => Object.keys(sessionStorage).some(key => key.includes('reception-flow'))), 'the typing is kept in the tab');
      await f.page.reload();
      await f.page.getByRole('heading', { level: 2, name: 'Le carton' }).waitFor();
      assert.deepEqual([await f.page.getByLabel(/^Numéro de suivi/).inputValue(), await f.page.getByLabel(/^Vendu par/).inputValue(), await f.page.getByLabel('Longueur (cm)', { exact: true }).inputValue(), await f.page.getByLabel('Largeur (cm)', { exact: true }).inputValue()],
        ['COLISSIMO-778', 'Zara', '44', '33'], 'the carton being typed survives a reload');
      assert.equal(await f.page.getByRole('button', { name: 'Aérosols' }).getAttribute('aria-pressed'), 'true');
      assert.equal(await f.page.getByRole('checkbox', { name: /Carton abîmé ou ouvert/ }).isChecked(), true);
      await fillCarton(f.page, { measures: [null, null, '22', '3'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      await f.page.getByText('Prenez une photo du carton abîmé, ou décochez « Carton abîmé ou ouvert ».').waitFor();
      assert.equal(requestsTo(f, '/rpc/append_reception_cartons').length, 0, 'a damaged carton waits for its photo');
      await f.page.locator('#rf-photo-camera').setInputFiles({ name: 'carton.png', mimeType: 'image/png', buffer: PNG });
      await f.page.getByRole('img', { name: 'Photo du carton abîmé' }).waitFor();
      await checkScreen(f, 'tablet light damaged carton');
      await snap(f, 'tablette-clair-2-carton-abime');
      await addCarton(f.page);
      const append = requestsTo(f, '/rpc/append_reception_cartons')[0].input;
      assert.equal(append.p_notes_reception, 'Carton n° 3 (Zara, COLISSIMO-778) abîmé ou ouvert à la réception : Coin enfoncé.');
      assert.deepEqual(append.p_check_interdits, ['Aérosols']);
      const photoPatch = f.requests.find(request => request.method === 'PATCH' && request.path === '/rest/v1/colis' && request.input?.photo_reception === true);
      assert.ok(photoPatch, 'the photo is attached with the existing mechanism');
      assert.equal(uploads.length, 1, 'one photo uploaded to the private bucket');
      assert.match(uploads[0], new RegExp(`/storage/v1/object/photos-colis/${ids.P}/[0-9a-f-]{36}\\.png$`));
      assert.match(photoPatch.input.photo_reception_url, new RegExp(`^${ids.P}/[0-9a-f-]{36}\\.png$`));
      await f.page.getByText(`Carton n° 3 enregistré dans EXP-TEST-001.`).waitFor();
      await f.page.reload();
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();
      await f.page.getByText('Carton n° 3 enregistré dans EXP-TEST-001.').waitFor();
      await f.page.getByText('COLISSIMO-778', { exact: true }).waitFor();
    });

    await scenario(browser, 'reponse-perdue-verifier-enregistrement-sans-doublon', { layout: TABLET, dark: true, expectedConsole: /Failed to load resource|ERR_FAILED/ }, async f => {
      const state = fixtures(f);
      let lost = true;
      const sent = [];
      await f.context.route('**/rest/v1/rpc/append_reception_cartons', async route => {
        sent.push(route.request().postDataJSON());
        if (!lost) return route.fallback();
        lost = false;
        // The server records the cartons, then the answer is lost on the way back.
        appendCartons(f.tables, state, { id: ids.A }, route.request().postDataJSON());
        await route.abort('failed');
      });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}`);
      await f.page.getByRole('heading', { level: 2, name: 'Le carton' }).waitFor();
      await fillCarton(f.page, { tracking: 'DHL-1234567890', vendor: 'Cdiscount', measures: ['60', '40', '40', '8,5'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await check.waitFor();
      assert.equal(await f.page.getByLabel(/^Numéro de suivi/).isDisabled(), true, 'the carton cannot change while its save is checked');
      await checkScreen(f, 'tablet dark uncertain save');
      await snap(f, 'tablette-sombre-2-enregistrement-a-verifier');
      await f.page.reload();
      await check.waitFor();
      await check.click();
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();
      assert.equal(sent.length, 2, 'the lost save, then its check');
      assert.deepEqual(sent[1], sent[0], 'the very same request is replayed');
      assert.match(sent[0].p_request_id, /^[0-9a-f-]{36}$/);
      const parcel = f.tables.colis.find(row => row.id === ids.P);
      assert.equal(parcel.nb_colis, 3, 'the carton is recorded once');
      assert.equal(parcel.trackings.filter(code => code === 'DHL-1234567890').length, 1);
    });

    await scenario(browser, 'creation-reseau-coupe-verifier-enregistrement-sans-doublon', { layout: PHONE, expectedConsole: /Failed to load resource|ERR_FAILED/ }, async f => {
      fixtures(f);
      let down = false, inserts = 0;
      await f.context.route('**/rest/v1/colis*', async route => {
        const request = route.request();
        if (request.method() === 'POST') {
          inserts += 1;
          if (inserts > 1) return route.fallback();
          // The dossier is created, then the network drops before the answer and before the check.
          const input = request.postDataJSON();
          f.tables.colis.push({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...input });
          down = true;
          return route.abort('failed');
        }
        if (down) return route.abort('failed');
        return route.fallback();
      });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${H}`);
      await f.page.getByRole('heading', { level: 2, name: 'Le premier carton' }).waitFor();
      await fillCarton(f.page, { casier: 'D-04', tracking: 'UPS-1Z999', measures: ['35', '25', '12', '1,8'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await check.waitFor();
      await snap(f, 'telephone-clair-2-creation-a-verifier');
      down = false;
      await check.click();
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();
      assert.equal(inserts, 1, 'the check finds the dossier: no second insert');
      assert.equal(f.tables.colis.filter(row => row.client_id === H).length, 1, 'one brouillon');
    });

    await scenario(browser, 'validation-reponse-perdue-meme-requete-un-seul-avis', { layout: TABLET, expectedConsole: /Failed to load resource|ERR_FAILED/ }, async f => {
      const state = fixtures(f, { telegram: true });
      earlierPendingCarton(f);
      let lost = true;
      const sent = [];
      await f.context.route('**/rest/v1/rpc/validate_reception', async route => {
        sent.push(route.request().postDataJSON());
        if (!lost) return route.fallback();
        lost = false;
        validateReception(f.tables, state, { id: ids.A }, route.request().postDataJSON());
        await route.abort('failed');
      });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-step-title', 'the step title takes the focus');
      await f.page.getByText(/enregistré .* pas encore validé/).waitFor();
      await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier la validation' });
      await check.waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).count(), 0, 'no second validation while the first is unknown');
      await snap(f, 'tablette-clair-3-validation-a-verifier');
      await f.page.reload();
      await check.click();
      await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
      assert.equal(sent.length, 2, 'the lost validation, then its check');
      assert.deepEqual(sent[1], sent[0], 'the same request identifier and content are replayed');
      assert.equal(state.validations.length, 1, 'one validation');
      assert.equal(f.tables.messages.length, 1, 'one notice');
      assert.equal(requestsTo(f, '/functions/v1/send-telegram').length, 1);
    });

    await scenario(browser, 'contact-change-pendant-la-validation', { layout: TABLET, expectedConsole: /Failed to load resource/ }, async f => {
      fixtures(f);
      earlierPendingCarton(f);
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByRole('heading', { name: 'Cette réception : 1 carton' }).waitFor();
      await f.page.getByText(/^En validant, l’e-mail pour Camille/).waitFor();
      // The client links Telegram after the screen read its contact.
      f.tables.clients[0].telegram_chat_id = 'chat-camille';
      await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).click();
      await f.page.getByText(/Le contact du client a changé : l’avis partira par Telegram\. La liste et le contact de Camille sont actualisés/).waitFor();
      await f.page.getByText('En validant, Camille reçoit un seul message Telegram pour 1 colis.').waitFor();
      await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).click();
      await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
      const validations = requestsTo(f, '/rpc/validate_reception');
      assert.equal(validations.length, 2);
      assert.notEqual(validations[1].input.p_request_id, validations[0].input.p_request_id, 'a refused request is never replayed');
      assert.equal(validations[1].input.p_canal, 'telegram');
    });

    for (const [layout, dark] of [[TABLET, true], [PHONE, false]]) {
      const tag = `${layout.name}-${dark ? 'sombre' : 'clair'}`;
      await scenario(browser, `avis-arrivee-${tag}`, { layout, dark }, async f => {
        const state = fixtures(f, { telegram: true });
        const user = { id: ids.A };
        const marie = f.tables.clients.find(row => row.id === E);
        // Four receptions validated: Telegram not delivered, e-mail to send, Telegram sent, without notice.
        const record = (clientId, notify, text) => {
          const parcel = { id: crypto.randomUUID(), client_id: clientId, ref: `EXP-AV${f.tables.colis.length}`, statut: 'mesure', nb_colis: 1, casier: 'E-01', trackings: [], trackings_detail: [{ number: `TRK-${f.tables.colis.length}`, fournisseur: 'Fnac' }],
            dims_par_colis: [{ dimL: 30, dimW: 20, dimH: 10, poids: 1 }], dim_l: 30, dim_w: 20, dim_h: 10, poids: 1, created_at: now(), updated_at: now(), reception_dates: [{ receivedAt: now(), source: 'server' }] };
          f.tables.colis.push(parcel);
          const client = f.tables.clients.find(row => row.id === clientId);
          const canal = notify ? (client.telegram_chat_id ? 'telegram' : 'email') : null;
          const [, body] = validateReception(f.tables, state, user, { p_client_id: clientId, p_items: [{ colisId: parcel.id, throughCarton: 1 }], p_notify: notify, p_canal: canal, p_template: notify ? 'arrivee_colis' : null, p_text: notify ? text : null, p_request_id: crypto.randomUUID() });
          return body;
        };
        state.telegram = 'fail';
        const failed = record(ids.C, true, 'Bonjour Camille, vos colis sont arrivés.');
        sendTelegram(f.tables, state, { colisId: failed.message.colis_id, messageId: failed.message.id });
        record(E, true, 'Bonjour Marie,\n\nBonne nouvelle : nous avons reçu 1 colis pour vous.');
        state.telegram = 'ok';
        const delivered = record(ids.C, true, 'Bonjour Camille, un autre colis est arrivé.');
        sendTelegram(f.tables, state, { colisId: delivered.message.colis_id, messageId: delivered.message.id });
        record(H, false, null);
        earlierPendingCarton(f);
        assert.ok(marie.email);
        await f.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
        await f.login();
        await f.page.goto(`${base}/avis`);
        await f.page.getByRole('heading', { level: 1, name: 'Avis d’arrivée' }).waitFor();
        const pending = f.page.getByRole('link', { name: 'Valider et prévenir' });
        await pending.waitFor();
        assert.equal(await pending.getAttribute('href'), `/recevoir?client=${ids.C}&valider=1`);
        await f.page.getByText(/^Exemple Camille$/).first().waitFor();
        const list = f.page.getByRole('list', { name: 'Avis d’arrivée récents' });
        await list.getByText('Non remis', { exact: true }).waitFor();
        await list.getByText('Raison : Telegram : chat introuvable').waitFor();
        await list.getByText('À envoyer', { exact: true }).waitFor();
        await list.getByText('Envoyé', { exact: true }).waitFor();
        await list.getByText('Sans avis', { exact: true }).waitFor();
        await checkScreen(f, `${tag} avis`);
        await snap(f, `${tag}-avis-arrivee`);
        // E-mail to send: the text to copy.
        await list.getByRole('button', { name: 'Copier le texte' }).click();
        assert.match(await f.page.evaluate(() => navigator.clipboard.readText()), /^Bonjour Marie/);
        assert.match(await list.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href'), /^mailto:marie\.grondin@example\.test\?subject=/);
        // Telegram not delivered: checked in Telegram, then sent again on purpose.
        await list.getByText('Avant de réessayer, vérifiez dans Telegram que le message n’est pas arrivé.').waitFor();
        await list.getByRole('button', { name: 'Réessayer l’envoi' }).click();
        await list.getByText('Telegram a confirmé l’envoi.').waitFor();
        const retry = requestsTo(f, '/functions/v1/send-telegram');
        assert.equal(retry.length, 1);
        assert.deepEqual(retry[0].input, { colisId: failed.message.colis_id, messageId: failed.message.id, retryConfirmed: true });
        await f.page.waitForFunction(() => !document.body.innerText.includes('Non remis'));
        // An e-mail refused by the provider: the client's sheet, at its e-mail.
        state.outbox.find(item => item.canal === 'email').status = 'failed';
        state.outbox.find(item => item.canal === 'email').last_error = 'Adresse e-mail refusée';
        await f.page.getByRole('button', { name: 'Actualiser' }).click();
        const fix = list.getByRole('link', { name: 'Corriger l’adresse' });
        await fix.waitFor();
        assert.equal(await fix.getAttribute('href'), `/clients/${E}?completer=email`);
        await checkScreen(f, `${tag} avis after retry`);
      });
    }

    await scenario(browser, 'droits-sans-reception-acces-refuse', { role: 'preparateur', layout: TABLET }, async f => {
      fixtures(f);
      earlierPendingCarton(f);
      const permissions = { perm_colis_receptionner: false, perm_comm_telegram: true };
      f.tables.staff_users[0].staff_permissions = [permissions];
      f.tables.staff_permissions = [permissions];
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByRole('heading', { name: 'Accès limité' }).waitFor();
      assert.equal(await f.page.locator('.rf').count(), 0, 'no reception without its permission');
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByRole('heading', { name: 'Accès limité' }).waitFor();
      await f.page.goto(`${base}/avis`);
      await f.page.getByRole('heading', { level: 1, name: 'Avis d’arrivée' }).waitFor();
      await f.page.getByText('À valider par un membre de l’équipe qui réceptionne.').waitFor();
      assert.equal(await f.page.getByRole('link', { name: 'Valider et prévenir' }).count(), 0);
      assert.equal(requestsTo(f, '/rpc/validate_reception').length + requestsTo(f, '/rpc/append_reception_cartons').length, 0);
    });

    await scenario(browser, 'droits-reception-sans-telegram-ni-creation-client', { role: 'preparateur', layout: PHONE }, async f => {
      fixtures(f, { telegram: true });
      earlierPendingCarton(f);
      const permissions = { perm_colis_receptionner: true, perm_comm_telegram: false, perm_clients_creer: false, perm_clients_voir: true };
      f.tables.staff_users[0].staff_permissions = [permissions];
      f.tables.staff_permissions = [permissions];
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByLabel('Nom, téléphone ou numéro client').fill('Personne');
      await f.page.getByText('Aucun client ne correspond à « Personne ».').waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Créer un nouveau client' }).count(), 0, 'creating a client needs its permission');
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByText('Votre accès ne permet pas de prévenir Camille par Telegram : validez sans prévenir, ou demandez à un collègue autorisé de valider la réception.').waitFor();
      assert.equal(await f.page.getByRole('button', { name: /prévenir Camille/ }).count(), 0);
      await checkScreen(f, 'phone light step 3 without telegram permission');
      await f.page.getByRole('button', { name: 'Valider sans prévenir', exact: true }).click();
      await f.page.getByText('Réception validée sans avis : le client n’est pas prévenu').waitFor();
      assert.equal(requestsTo(f, '/rpc/validate_reception')[0].input.p_notify, false);
    });

    for (const [layout, dark] of [[PHONE, false], [TABLET, true]]) {
      const tag = `${layout.name}-${dark ? 'sombre' : 'clair'}`;
      await scenario(browser, `mise-en-page-${tag}`, { layout, dark }, async f => {
        fixtures(f, { telegram: true });
        await f.login();
        await f.page.goto(`${base}/recevoir`);
        await f.page.getByLabel('Nom, téléphone ou numéro client').fill('Exemple');
        await f.page.getByRole('button', { name: /^Exemple Camille/ }).waitFor();
        await checkScreen(f, `${tag} step 1`);
        await snap(f, `${tag}-1-client`);
        await chooseClient(f.page, 'Exemple', 'Exemple Camille');
        await f.page.getByRole('checkbox', { name: /Carton abîmé ou ouvert/ }).check();
        await checkScreen(f, `${tag} step 2`);
        await snap(f, `${tag}-2-carton`);
        await fillCarton(f.page, { tracking: 'LP00112233', vendor: 'Temu', measures: ['20', '15', '10', '0,8'] });
        await f.page.getByRole('checkbox', { name: /Carton abîmé ou ouvert/ }).uncheck();
        await addCarton(f.page);
        await checkScreen(f, `${tag} step 3`);
        await snap(f, `${tag}-3-validation`);
        await f.page.getByText('Voir le message').click();
        await f.page.locator('pre.rf-message').waitFor();
        assert.match(await f.page.locator('pre.rf-message').innerText(), /^Bonjour Camille/);
        await f.page.getByRole('button', { name: 'Valider la réception et prévenir Camille' }).click();
        await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
        await checkScreen(f, `${tag} step 4`);
        await snap(f, `${tag}-4-rangement`);
      });
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();

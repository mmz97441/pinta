/* « Réceptionner des cartons » (/recevoir) and « Avis d’arrivée » (/avis), docs/specification-brouillon-reception-2026-10-28.md:
 * the three steps of a reception (client, cartons added then validated on one screen, rangement), the grouped arrival
 * notice and its states, phone and tablet, light and dark. The
 * server's commands are mocked here as the migrations write them (append_reception_cartons and its receipts,
 * list_pending_receptions, validate_reception and its first carton, list_arrival_notices, add_reception_photo,
 * send-telegram, the photo bucket, the unique identifiers of clients and dossiers): nothing leaves the machine.
 * Screenshots go to PINTA_RECEPTION_FLOW_OUT; PINTA_RECEPTION_FLOW_FILTER runs the scenarios whose name contains it. */
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
const DESKTOP = { name: 'ordinateur', viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false };
const H = '88888888-8888-4888-8888-888888888888'; // a client without any dossier and without contact
const E = '99999999-9999-4999-8999-999999999999'; // a client reached by e-mail
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── The server's commands, as supabase/migrations/20261001000001_reception_append.sql and
// 20261028000001_reception_validation.sql define them (the SQL suites test them in depth). ──
const APPEND_STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement'];
// _reception_validation_at_depot: the only dossiers whose cartons may wait for a validation.
const DEPOT_STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'refuse_client', 'devis_envoye', 'attente_paiement'];
const atDepot = row => DEPOT_STATUSES.includes(row.statut) && !row.paiement_date && !row.archive;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const cartonCount = row => Math.max(Number(row.nb_colis) || 0, (row.trackings_detail || []).length, (row.trackings || []).filter(Boolean).length, (row.dims_par_colis || []).length, 1);
const allowed = (tables, permission) => ['directeur', 'vice_directeur'].includes(tables.staff_users[0]?.role) || (tables.staff_permissions || []).some(row => row[permission] === true);
const refused = (status, code, message) => [status, { code, message, details: null, hint: null }];
const number = value => value == null || value === '' ? null : Number(value);

function serverState(tables) {
  // reception_validation_settings.started_at: two hours ago (the fixture's cartons, received in September, are history).
  if (!tables.reception_server) tables.reception_server = { startedAt: Date.now() - 7200000, validations: [], items: [], receipts: [], outbox: [], photos: [], objects: new Set(), telegram: 'ok' };
  return tables.reception_server;
}
/** _reception_validation_invoice_requested: no current invoice free of a rejection, or a current one rejected. */
function invoiceRequested(tables, colisId) {
  const invoices = (tables.factures || []).filter(invoice => invoice.colis_id === colisId && !invoice.duplicate_of_facture_id
    && !(tables.factures || []).some(other => other.replaces_facture_id === invoice.id));
  return !invoices.some(invoice => !invoice.rejet_motif) || invoices.some(invoice => invoice.rejet_motif);
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
  if (!atDepot(row)) return [];
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
  if (!input.p_request_id) return refused(400, '22023', 'Identifiant de validation requis.');
  const payload = JSON.stringify({ clientId: input.p_client_id, items: input.p_items, notify: input.p_notify, canal: input.p_canal ?? null, template: input.p_template ?? null, text: input.p_text ?? null });
  const recorded = state.validations.find(row => row.request_id === input.p_request_id);
  if (recorded) {
    if (recorded.actor_id !== user.id || recorded.payload !== payload) return refused(409, '40001', 'Cette validation a déjà été enregistrée avec un autre contenu. Actualisez la liste avant de continuer.');
    return [200, validationResult(tables, state, recorded, true)];
  }
  const list = input.p_items;
  if (!Array.isArray(list) || list.length < 1 || list.length > 20) return refused(400, '22023', 'Validez de 1 à 20 dossiers à la fois.');
  const whole = value => Number.isInteger(value) && value >= 1 && value <= 999999;
  if (list.some(item => !item || typeof item !== 'object' || !UUID.test(item.colisId || '') || !whole(item.fromCarton) || !whole(item.throughCarton)))
    return refused(400, '22023', 'Chaque dossier indique son identifiant, le premier et le dernier carton à valider.');
  if (list.some(item => item.fromCarton > item.throughCarton)) return refused(400, '22023', 'Le premier carton à valider ne peut pas suivre le dernier.');
  if (new Set(list.map(item => item.colisId.toLowerCase())).size !== list.length) return refused(400, '22023', 'Un dossier ne figure qu’une fois dans une validation.');
  const client = tables.clients.find(row => row.id === input.p_client_id);
  if (!client) return refused(400, '22023', 'Client introuvable.');
  let channel = null;
  if (input.p_notify) {
    channel = /[^ ]/.test(client.telegram_chat_id || '') ? 'telegram' : /[^ ]/.test(client.email || '') ? 'email' : null;
    if (!channel) return refused(400, '22023', 'Ce client n’a ni Telegram ni e-mail : validez sans prévenir.');
    if (!['telegram', 'email'].includes(input.p_canal)) return refused(400, '22023', 'Précisez le canal de l’avis d’arrivée : telegram ou email.');
    if (input.p_canal !== channel) return refused(409, '40001', `Le contact du client a changé : l’avis partira par ${channel === 'telegram' ? 'Telegram' : 'e-mail'}. Actualisez avant de valider.`);
    if (!allowed(tables, channel === 'email' ? 'perm_comm_email' : 'perm_comm_telegram')) return refused(403, '42501', `Permission communication requise pour prévenir le client par ${channel === 'telegram' ? 'Telegram' : 'e-mail'} : validez sans prévenir ou confiez l’avis à un collègue.`);
    if (!['arrivee_colis', 'arrivee_colis_facture'].includes(input.p_template)) return refused(400, '22023', 'Choisissez le modèle de l’avis d’arrivée : arrivee_colis ou arrivee_colis_facture.');
    if (!String(input.p_text || '').trim() || Array.from(input.p_text).length > 4096) return refused(400, '22023', 'Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.');
  } else if (input.p_canal != null || input.p_template != null || input.p_text != null) return refused(400, '22023', 'Sans avis, ne transmettez ni canal, ni modèle, ni texte.');
  const items = [], cartons = [];
  for (const item of list) {
    const row = tables.colis.find(colis => colis.id === item.colisId);
    if (!row) return refused(400, '22023', 'Dossier introuvable : actualisez la liste.');
    if (row.client_id !== input.p_client_id) return refused(400, '22023', `Le dossier ${row.ref} n’appartient pas à ce client.`);
    if (row.archive) return refused(400, '22023', `Le dossier ${row.ref} est archivé : sa réception ne se valide plus.`);
    if (row.statut === 'annule') return refused(400, '22023', `Le dossier ${row.ref} est annulé : sa réception ne se valide plus.`);
    if (!atDepot(row)) return refused(400, '22023', `Le dossier ${row.ref} n’est plus au dépôt avant expédition : sa réception ne se valide plus.`);
    const pending = pendingOf(state, row);
    // The first pending carton must be the one the screen listed first.
    if (pending[0]?.carton !== item.fromCarton) {
      if (pending.length || state.items.some(entry => entry.colis_id === row.id && entry.last_carton >= item.fromCarton))
        return refused(409, '40001', 'Des cartons de ce dossier ont été validés entre-temps : actualisez la liste.');
      return refused(400, '22023', `Le dossier ${row.ref} n’a aucun carton en attente de validation : actualisez la liste.`);
    }
    if (!pending.some(carton => carton.carton === item.throughCarton)) return refused(400, '22023', `Le carton n° ${item.throughCarton} du dossier ${row.ref} n’est pas en attente de validation : actualisez la liste.`);
    const selected = pending.filter(carton => carton.carton <= item.throughCarton);
    items.push({ colisId: row.id, ref: row.ref, firstCarton: item.fromCarton, lastCarton: item.throughCarton });
    cartons.push(...selected.map(carton => ({ colisId: row.id, ref: row.ref, ...carton })));
  }
  if (cartons.length > 100) return refused(400, '22023', 'Validez au plus 100 cartons à la fois.');
  const id = crypto.randomUUID();
  let message = null, outbox = null;
  if (input.p_notify) {
    // queue_message(<notice dossier>, text, template, 'arrival:<id>', NULL, canal): « envoi », pending (Telegram) or manual
    // (e-mail). The notice dossier: the first one; for the invoice variant, the first one still requesting its invoice.
    const noticeDossier = (input.p_template === 'arrivee_colis_facture' && items.find(item => invoiceRequested(tables, item.colisId))) || items[0];
    message = { id: crypto.randomUUID(), colis_id: noticeDossier.colisId, type: 'staff', auteur_nom: 'Camille', texte: input.p_text, statut: 'envoi', canal: channel, template: input.p_template, created_at: now() };
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
        message: message ? { id: message.id, colisId: message.colis_id, statut: message.statut, texte: message.texte, createdAt: message.created_at } : null,
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

/** add_reception_photo: one more photo of a carton, already stored in the dossier's folder; its replay returns it. */
function addPhoto(tables, state, user, input) {
  if (!allowed(tables, 'perm_colis_receptionner')) return refused(403, '42501', 'Permission réception requise pour ajouter une photo de réception.');
  const { p_colis_id: colisId, p_carton: carton, p_path: photoPath } = input;
  if (!colisId || carton == null || !photoPath) return refused(400, '22023', 'Indiquez le dossier, le carton et la photo.');
  if (!photoPath.startsWith(`${colisId}/`) || photoPath.includes('..') || photoPath.slice(37).includes('/') || photoPath.length > 300 || !/^[^/]+\/[^/]+\.(jpe?g|png|webp)$/.test(photoPath.toLowerCase()))
    return refused(400, '22023', 'La photo doit être une image JPEG, PNG ou WebP enregistrée dans le dossier.');
  const row = tables.colis.find(item => item.id === colisId);
  if (!row) return refused(400, '22023', 'Dossier introuvable.');
  if (row.archive) return refused(400, '22023', `Le dossier ${row.ref} est archivé : sa réception ne se complète plus.`);
  if (carton < 1 || carton > cartonCount(row)) return refused(400, '22023', `Le dossier ${row.ref} n’a pas de carton n° ${carton}.`);
  if (!state.objects.has(photoPath)) return refused(400, '22023', 'Photo introuvable dans le dossier : envoyez-la avant de l’enregistrer.');
  const json = photo => ({ id: photo.id, carton: photo.carton, path: photo.path, createdAt: photo.created_at, actor: { nom: 'Camille Test' } });
  const existing = state.photos.find(photo => photo.path === photoPath);
  if (existing) {
    if (existing.colis_id !== colisId || existing.carton !== carton) return refused(400, '22023', 'Cette photo est déjà enregistrée pour un autre carton.');
    return [200, { ...json(existing), colisId, reused: true }];
  }
  const photo = { id: crypto.randomUUID(), colis_id: colisId, carton, path: photoPath, created_by: user.id, created_at: now() };
  state.photos.push(photo);
  return [200, { ...json(photo), colisId, reused: false }];
}

registerRequestMock(({ url, method, input, tables, user }) => {
  const state = serverState(tables);
  stampReceptionDates(tables);
  if (url.pathname.endsWith('/functions/v1/send-telegram')) return sendTelegram(tables, state, input || {});
  // The primary keys: a client or a dossier created under an identifier already taken (a lost answer replayed) is refused.
  const table = url.pathname.split('/').pop();
  if (method === 'POST' && url.pathname.startsWith('/rest/v1/') && ['clients', 'colis'].includes(table)
    && (Array.isArray(input) ? input : [input]).some(row => row?.id && tables[table].some(existing => existing.id === row.id)))
    return refused(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
  if (!url.pathname.includes('/rest/v1/rpc/')) return undefined;
  if (table === 'list_pending_receptions') return [200, listPending(tables, state, input?.p_client_id || null)];
  if (table === 'validate_reception') return validateReception(tables, state, user, input || {});
  if (table === 'list_arrival_notices') return [200, listNotices(tables, state, input || {})];
  if (table === 'append_reception_cartons') return appendCartons(tables, state, user, input || {});
  if (table === 'add_reception_photo') return addPhoto(tables, state, user, input || {});
  if (table === 'list_reception_photos') return [200, state.photos.filter(photo => photo.colis_id === input?.p_colis_id).map(photo => ({ id: photo.id, carton: photo.carton, path: photo.path, createdAt: photo.created_at, actor: { nom: 'Camille Test' } }))];
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
/** The private photo bucket (a multipart upload, answered before the shared JSON server): each stored object is
 * known to add_reception_photo. Returns the names stored, `<dossier>/<file>`. */
async function photoBucket(f) {
  const state = serverState(f.tables);
  const uploads = [];
  await f.context.route('**/storage/v1/object/photos-colis/**', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/storage/v1/object/photos-colis/')[1] || '');
    uploads.push(name);
    state.objects.add(name);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `photos-colis/${name}`, Id: crypto.randomUUID() }) });
  });
  return uploads;
}
/** A reception of one carton of `clientId`, validated by the server (with its notice when `notify`). */
function recordValidation(f, state, clientId, notify, text) {
  const parcel = { id: crypto.randomUUID(), client_id: clientId, ref: `EXP-AV${f.tables.colis.length}`, statut: 'mesure', nb_colis: 1, casier: 'E-01', trackings: [], trackings_detail: [{ number: `TRK-${f.tables.colis.length}`, fournisseur: 'Fnac' }],
    dims_par_colis: [{ dimL: 30, dimW: 20, dimH: 10, poids: 1 }], dim_l: 30, dim_w: 20, dim_h: 10, poids: 1, created_at: now(), updated_at: now(), reception_dates: [{ receivedAt: now(), source: 'server' }] };
  f.tables.colis.push(parcel);
  const client = f.tables.clients.find(row => row.id === clientId);
  const canal = notify ? (client.telegram_chat_id ? 'telegram' : 'email') : null;
  const [status, body] = validateReception(f.tables, state, { id: ids.A }, { p_client_id: clientId, p_items: [{ colisId: parcel.id, fromCarton: 1, throughCarton: 1 }], p_notify: notify, p_canal: canal,
    p_template: notify ? 'arrivee_colis' : null, p_text: notify ? text : null, p_request_id: crypto.randomUUID() });
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}
/** Five receptions validated (Camille on Telegram): a notice never taken by the automatic sending, half an hour ago (to
 * check); a Telegram notice not delivered; an e-mail to send (Marie); a Telegram notice sent; one without notice. */
function noticeHistory(f, state) {
  const stale = recordValidation(f, state, ids.C, true, 'Bonjour Camille, votre colis est arrivé.');
  f.tables.messages.find(item => item.id === stale.message.id).created_at = ago(30);
  state.validations.find(item => item.id === stale.validation.id).created_at = ago(30);
  state.telegram = 'fail';
  const failed = recordValidation(f, state, ids.C, true, 'Bonjour Camille, vos colis sont arrivés.');
  sendTelegram(f.tables, state, { colisId: failed.message.colis_id, messageId: failed.message.id });
  recordValidation(f, state, E, true, 'Bonjour Marie,\n\nBonne nouvelle : nous avons reçu 1 colis pour vous.');
  state.telegram = 'ok';
  const delivered = recordValidation(f, state, ids.C, true, 'Bonjour Camille, un autre colis est arrivé.');
  sendTelegram(f.tables, state, { colisId: delivered.message.colis_id, messageId: delivered.message.id });
  recordValidation(f, state, H, false, null);
  return { stale, failed, delivered };
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
  await page.getByRole('table', { name: /^Clients trouvés/ }).getByRole('button', { name: `Choisir ${name}` }).click();
  await page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
}
/** « À valider : 3 cartons ». */
const toValidate = total => `À valider : ${total} ${total > 1 ? 'cartons' : 'carton'}`;
/** « Signaler un problème » : « Produit interdit » opens the list of the products, « Carton abîmé ou ouvert » toggles. */
async function flagForbidden(page, product) {
  const toggle = page.getByRole('button', { name: /^Produit interdit/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByRole('button', { name: product, exact: true }).click();
}
const damagedToggle = page => page.getByRole('button', { name: 'Carton abîmé ou ouvert', exact: true });
/** The row of a table whose header cell (first column) is `name`. */
const rowOf = (scope, name) => scope.getByRole('row').filter({ has: scope.page().getByRole('rowheader', { name }) });
/** « Ajouter ce carton », then the list below it holds `total` cartons to validate (read again from the server). */
async function addCarton(page, total) {
  await page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: toValidate(total), exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).waitFor();
}

/** Text of 15 px or more, targets of 44 px or more (56 px for the reception's main buttons), no horizontal scroll of
 * the page, no emoji in the interface, rows of data in tables only (no list of cards), each table with its column
 * headers, its first column pinned (opaque, an edge line, a shadow while the frame scrolls), its actions in its last
 * column and its frame scrolling sideways when it overflows; no accessibility violation (axe, WCAG 2.2 AA). */
async function checkScreen(f, label) {
  await settle(f.page);
  const tables = await f.page.evaluate(() => {
    const root = document.querySelector('.rf');
    const opaque = color => { const match = /rgba?\(([^)]+)\)/.exec(color); if (!match) return false; const parts = match[1].split(',').map(part => part.trim()); return parts.length < 4 || Number(parts[3]) === 1; };
    // The only lists left: the steps of the reception and the lockers shown in very large.
    const lists = [...root.querySelectorAll('ul, ol')].filter(list => list.getAttribute('aria-label') !== 'Étapes de la réception' && !list.closest('.rf-casier'))
      .map(list => (list.getAttribute('aria-label') || list.textContent).trim().slice(0, 40));
    const problems = [];
    const found = [...root.querySelectorAll('table')].filter(table => table.getBoundingClientRect().width > 0).map(table => {
      const name = (table.querySelector('caption')?.textContent || '').trim();
      const frame = table.closest('.rf-table-frame');
      if (!frame || !['auto', 'scroll'].includes(getComputedStyle(frame).overflowX)) problems.push(`${name}: no scrolling frame`);
      if (table.querySelectorAll('thead th[scope="col"]').length < 2) problems.push(`${name}: no column headers`);
      const overflow = frame ? frame.scrollWidth > frame.clientWidth + 1 : false;
      if (overflow && frame.getAttribute('tabindex') !== '0') problems.push(`${name}: a scrolling frame the keyboard cannot reach`);
      for (const row of table.querySelectorAll('tr')) {
        const first = row.firstElementChild, style = getComputedStyle(first);
        if (style.position !== 'sticky' || style.left !== '0px') problems.push(`${name}: first column not pinned`);
        if (!opaque(style.backgroundColor)) problems.push(`${name}: first column not opaque (${style.backgroundColor})`);
        if (!(parseFloat(style.borderRightWidth) >= 1)) problems.push(`${name}: first column without its edge line`);
        if (overflow && style.boxShadow === 'none') problems.push(`${name}: first column without its edge shadow`);
        if (row.parentElement.tagName === 'TBODY') for (const control of row.querySelectorAll('button, a[href]'))
          if (control.closest('td, th') !== row.lastElementChild) problems.push(`${name}: « ${control.textContent.trim().slice(0, 30)} » outside the last column`);
      }
      // A cell never breaks inside a word or a code (« Exe / mple »): its columns keep the room they need. (A line may
      // still end at a hyphen of a sentence.) An action keeps its label on one line.
      const lineCount = (node, start, end) => {
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, end);
        return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
      };
      const walker = document.createTreeWalker(table.tBodies[0] || table, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent.matchAll(/[^\s\-‑]+/g))
          if (lineCount(node, match.index, match.index + match[0].length) > 1) problems.push(`${name}: « ${match[0]} » broken across lines`);
      }
      for (const control of table.querySelectorAll('tbody button, tbody a[href]')) {
        const range = document.createRange(); range.selectNodeContents(control);
        const centers = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.top + rect.height / 2).sort((a, b) => a - b);
        if (centers.some((center, index) => index > 0 && center - centers[index - 1] > 8)) problems.push(`${name}: « ${control.textContent.trim().slice(0, 30)} » on several lines`);
      }
      return { name, rows: table.querySelectorAll('tbody tr').length, overflow };
    });
    return { lists, problems: [...new Set(problems)], found };
  });
  assert.deepEqual(tables.lists, [], `${label}: rows of data in tables, no list of cards`);
  assert.deepEqual(tables.problems, [], `${label}: tables at every width`);
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
    const mainTooSmall = [...root.querySelectorAll('.rf-primary, .rf-validate, .rf-secondary')].filter(shown).map(element => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 55.5).map(({ element, box }) => `${element.textContent.trim().slice(0, 40)} (${Math.round(box.height)})`);
    // Actions are written from 17 px (the discreet « Valider sans prévenir » aside).
    const smallActions = [...root.querySelectorAll('.rf-primary, .rf-validate, .rf-secondary, .rf-small-action, .rf-toggle')].filter(shown)
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
    return { small, tooSmall, mainTooSmall, smallActions, emoji, covered, overflowX: document.documentElement.scrollWidth > innerWidth + 1 || (main ? main.scrollWidth > main.clientWidth + 1 : false),
      // Only <main> scrolls: nothing positioned inside it makes the whole page taller (a focus would slide the menu up).
      pageTaller: document.documentElement.scrollHeight > innerHeight + 1 };
  });
  assert.deepEqual(report.covered, [], `${label}: titles neither covered nor cut`);
  assert.deepEqual(report.smallActions, [], `${label}: actions of 17 px or more`);
  assert.deepEqual(report.small, [], `${label}: text of 15 px or more`);
  assert.deepEqual(report.tooSmall, [], `${label}: targets of 44 px or more`);
  assert.deepEqual(report.mainTooSmall, [], `${label}: main reception buttons of 56 px or more`);
  assert.equal(report.emoji, '', `${label}: no emoji in the interface`);
  assert.equal(report.overflowX, false, `${label}: no horizontal scroll`);
  assert.equal(report.pageTaller, false, `${label}: only the main area scrolls`);
  const axe = await new AxeBuilder({ page: f.page }).include('.rf').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target.join(' ')).slice(0, 4) })), [], `${label}: no accessibility violation`);
  return tables.found;
}
/** Each table that overflows, scrolled to its end in its frame: the page does not move, the first column stays at the
 * frame's left edge, the last column (its actions) comes into view; then back to the start. */
async function scrollTables(f, label) {
  const report = await f.page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const results = [];
    for (const element of document.querySelectorAll('.rf .rf-table-frame')) {
      if (element.scrollWidth <= element.clientWidth + 1) continue;
      const table = element.querySelector('table');
      const name = (table.querySelector('caption')?.textContent || '').trim();
      const pageX = window.scrollX, mainX = document.querySelector('main')?.scrollLeft || 0;
      element.scrollLeft = element.scrollWidth;
      await frame();
      const box = element.getBoundingClientRect();
      const first = table.querySelector('tbody tr > :first-child').getBoundingClientRect();
      const last = table.querySelector('tbody tr > :last-child').getBoundingClientRect();
      results.push({ name, scrolled: element.scrollLeft > 0, pinned: Math.abs(first.left - box.left - 1) <= 1.5, lastShown: last.right <= box.right + 1,
        shell: element.parentElement.getAttribute('data-scrolled') === 'true', pageStill: window.scrollX === pageX && (document.querySelector('main')?.scrollLeft || 0) === mainX });
      element.scrollLeft = 0;
      await frame();
    }
    return results;
  });
  for (const item of report) assert.deepEqual({ ...item, name: undefined }, { name: undefined, scrolled: true, pinned: true, lastShown: true, shell: true, pageStill: true }, `${label}: ${item.name} scrolls in its frame`);
  return report.length;
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
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      const created = f.tables.clients.find(row => row.email === 'flavie.payet@example.test');
      assert.ok(created, 'the client is created through the API');
      const creations = requestsTo(f, '/rest/v1/clients');
      assert.equal(creations.length, 1);
      assert.match(creations[0].input.id, /^[0-9a-f-]{36}$/, 'the client is created under the identifier of its form');
      assert.equal(created.id, creations[0].input.id);
      assert.equal(new URL(f.page.url()).searchParams.get('client'), created.id);
      await f.page.getByText('Aucun brouillon en cours : le premier carton en ouvre un nouveau.').waitFor();
      // Nothing to validate yet: the list below the form says where the cartons will gather.
      await f.page.getByRole('heading', { level: 2, name: 'À valider', exact: true }).waitFor();
      await f.page.getByText('Les cartons que vous ajoutez s’affichent ici. Vous les validez ensuite tous ensemble : Flavie recevra un seul message.').waitFor();
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
      await addCarton(f.page, 1);
      const inserts = requestsTo(f, '/rest/v1/colis');
      assert.equal(inserts.length, 1);
      const insert = inserts[0].input;
      assert.match(insert.id, /^[0-9a-f-]{36}$/, 'insertColis receives its createId');
      assert.deepEqual({ client: insert.client_id, statut: insert.statut, casier: insert.casier, trackings: insert.trackings, details: insert.trackings_detail, boxes: insert.dims_par_colis, count: insert.nb_colis, checks: insert.check_interdits, prohibited: insert.produit_interdit },
        { client: created.id, statut: 'mesure', casier: 'B-07', trackings: ['LP00498821'], details: [{ number: 'LP00498821', fournisseur: 'Shein' }], boxes: [{ dimL: 45, dimW: 32, dimH: 20, poids: 2.4 }], count: 1, checks: [], prohibited: false });
      const dossier = f.tables.colis.find(row => row.id === insert.id);
      const insertedRevision = dossier.updated_at;
      await f.page.locator('.rf-saved').getByText(`Carton n° 1 enregistré dans ${dossier.ref} (nouveau brouillon).`).waitFor();

      // Carton 2, on the same screen: the form is empty again, ready for the next scan, and joins the same brouillon.
      await f.page.getByText('Brouillon en cours : 1 carton · Casier B-07').waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-tracking', 'the tracking number takes the focus');
      assert.deepEqual([await f.page.getByLabel(/^Numéro de suivi/).inputValue(), await f.page.getByLabel('Poids (kg)', { exact: true }).inputValue()], ['', ''], 'the form is empty for the next carton');
      assert.equal(await f.page.getByLabel(/^Casier/).count(), 0, 'the brouillon has its locker now');
      await fillCarton(f.page, { vendor: 'Amazon', measures: ['30', '25', '15', '1.1'] });
      await addCarton(f.page, 2);
      const appends = requestsTo(f, '/rpc/append_reception_cartons');
      assert.equal(appends.length, 1);
      assert.equal(appends[0].input.p_colis_id, dossier.id);
      assert.equal(appends[0].input.p_expected_updated_at, insertedRevision, 'the addition names the revision it saw');
      assert.deepEqual(appends[0].input.p_cartons, [{ dimL: 30, dimW: 25, dimH: 15, poids: 1.1, fournisseur: 'Amazon', tracking: '' }]);
      assert.match(appends[0].input.p_request_id, /^[0-9a-f-]{36}$/);
      await f.page.locator('.rf-saved').getByText(`Carton n° 2 enregistré dans ${dossier.ref}.`).waitFor();
      const listed = f.page.getByRole('table', { name: /^Cartons à valider/ });
      assert.match(await rowOf(listed, 'Carton 1').innerText(), /Shein\s+LP00498821\s+45\s×\s32\s×\s20\scm\s+2,4\skg/);
      assert.match(await rowOf(listed, 'Carton 2').innerText(), /Amazon\s+Sans numéro de suivi\s+30\s×\s25\s×\s15\scm\s+1,1\skg/);
      await f.page.getByText('Flavie recevra un seul message Telegram pour 2 colis.').waitFor();
      await checkScreen(f, 'step 2 two cartons to validate');
      await snap(f, 'tablette-clair-2c-deux-cartons-a-valider');

      // A third carton being typed is not validated with the others: the list says so instead of validating.
      await fillCarton(f.page, { tracking: 'LP-OUBLIE' });
      const typing = f.page.getByRole('note').filter({ hasText: 'Un carton est en cours de saisie' });
      await typing.waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^Valider 2 cartons/ }).count(), 0, 'no validation while a carton is being typed');
      await checkScreen(f, 'step 2 carton being typed');
      await typing.getByRole('button', { name: 'Effacer la saisie' }).click();
      assert.equal(await f.page.getByLabel(/^Numéro de suivi/).inputValue(), '', 'the typing is cleared');
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-validation-title', 'the list keeps the focus');

      // One tap: one validation, one message for the two cartons, delivered at once.
      await f.page.getByRole('button', { name: 'Valider 2 cartons et prévenir Flavie', exact: true }).click();
      await f.page.getByRole('heading', { level: 2, name: `Réception validée : 2 colis ajoutés au brouillon de Flavie Payet` }).waitFor();
      const validations = requestsTo(f, '/rpc/validate_reception');
      assert.equal(validations.length, 1);
      const sent = validations[0].input;
      assert.deepEqual({ client: sent.p_client_id, items: sent.p_items, notify: sent.p_notify, canal: sent.p_canal, template: sent.p_template },
        { client: created.id, items: [{ colisId: dossier.id, fromCarton: 1, throughCarton: 2 }], notify: true, canal: 'telegram', template: 'arrivee_colis_facture' });
      assert.match(sent.p_text, /^Bonjour Flavie/);
      assert.match(sent.p_text, /2 colis/);
      assert.match(sent.p_text, /1\. Shein — LP00498821 — 45 × 32 × 20 cm — 2,4 kg\n2\. Amazon — Sans numéro de suivi — 30 × 25 × 15 cm — 1,1 kg/);
      assert.equal(state.validations.length, 1);
      assert.equal(f.tables.messages.length, 1, 'one message for the two cartons');
      const deliveries = requestsTo(f, '/functions/v1/send-telegram');
      assert.equal(deliveries.length, 1, 'the Telegram message is delivered at once');
      assert.deepEqual(deliveries[0].input, { colisId: dossier.id, messageId: f.tables.messages[0].id });
      await f.page.getByText('B-07', { exact: true }).waitFor();
      await f.page.getByText('Message Telegram envoyé à Flavie · 2 colis').waitFor();
      await f.page.getByText('Rangez-les dans le casier').waitFor();
      assert.match(await f.page.locator('ol[aria-label="Étapes de la réception"] [aria-current="step"]').innerText(), /^3\s*Rangement$/, 'the third and last step');
      await checkScreen(f, 'step 3 telegram');
      await snap(f, 'tablette-clair-3-rangement-telegram');
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
      const result = rowOf(f.page.getByRole('table', { name: /^Clients trouvés/ }), /^Exemple Camille/);
      await result.waitFor();
      assert.match(await result.innerText(), /Brouillon en cours : 2 cartons · Casier A-03/);
      assert.match(await result.innerText(), /Le carton rejoint son brouillon/);
      await checkScreen(f, 'phone dark step 1');
      await snap(f, 'telephone-sombre-1-client');
      // The whole line answers the tap, its action waiting on the right of the phone.
      await result.getByRole('rowheader').click();
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await f.page.getByText('Il faudra redemander l’accord du client et vérifier la préparation avec le nouveau carton.', { exact: false }).waitFor();
      assert.equal(await f.page.getByLabel(/^Casier/).count(), 0, 'the brouillon keeps its locker');
      await fillCarton(f.page, { tracking: 'TBA3021991100', vendor: 'Amazon', measures: ['30', '25', '15', '1,1'] });
      await flagForbidden(f.page, 'Batteries lithium');
      assert.equal(await f.page.getByRole('button', { name: 'Batteries lithium' }).getAttribute('aria-pressed'), 'true');
      await f.page.getByText(/^Produit interdit signalé : Batteries lithium/).waitFor();
      await checkScreen(f, 'phone dark step 2');
      await snap(f, 'telephone-sombre-2-carton');
      await addCarton(f.page, 1);
      const append = requestsTo(f, '/rpc/append_reception_cartons')[0].input;
      assert.deepEqual({ dossier: append.p_colis_id, cartons: append.p_cartons, checks: append.p_check_interdits, casier: append.p_casier, notes: append.p_notes_reception, expected: append.p_expected_updated_at },
        { dossier: ids.P, cartons: [{ dimL: 30, dimW: 25, dimH: 15, poids: 1.1, fournisseur: 'Amazon', tracking: 'TBA3021991100' }], checks: ['Batteries lithium'], casier: null, notes: null, expected: '2026-09-09T08:00:00Z' });
      assert.equal(f.tables.colis[0].produit_interdit, true, 'the forbidden product reaches the server');
      await f.page.getByText('Brouillon en cours : 3 cartons · Casier A-03').waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^Produit interdit/ }).getAttribute('aria-expanded'), 'false', 'the next carton starts without a problem flagged');
      await f.page.getByText(/^L’e-mail pour Camille sera préparé pour 1 colis/).waitFor();
      // The forbidden product is not in the notice: the team is reminded to tell the client from the conversation.
      const reminder = f.page.getByRole('note').filter({ hasText: 'À signaler à Camille vous-même' });
      const flaggedRow = rowOf(reminder, 'Carton 3');
      assert.match(await flaggedRow.innerText(), /EXP-TEST-001\s+Produit interdit : Batteries lithium\s+Ouvrir la conversation/);
      await reminder.getByText('L’avis d’arrivée n’en parle pas : prévenez Camille depuis la conversation du dossier.').waitFor();
      assert.equal(await flaggedRow.getByRole('link', { name: 'Ouvrir la conversation du dossier EXP-TEST-001' }).getAttribute('href'),
        `/colis/${ids.P}?onglet=conversation&returnTo=${encodeURIComponent(`/recevoir?client=${ids.C}&valider=1`)}`);
      await checkScreen(f, 'phone dark step 2 to validate');
      await snap(f, 'telephone-sombre-2b-a-valider-email');
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Réception validée : 1 colis ajouté au brouillon de Camille Exemple' }).waitFor();
      const sent = requestsTo(f, '/rpc/validate_reception')[0].input;
      assert.deepEqual({ canal: sent.p_canal, template: sent.p_template, items: sent.p_items }, { canal: 'email', template: 'arrivee_colis', items: [{ colisId: ids.P, fromCarton: 3, throughCarton: 3 }] });
      assert.doesNotMatch(sent.p_text, /lithium|interdit/i, 'the notice says nothing of the forbidden product');
      assert.match(await rowOf(f.page.getByRole('note').filter({ hasText: 'Pensez à prévenir Camille' }), 'Carton 3').innerText(), /Produit interdit : Batteries lithium/);
      assert.equal(requestsTo(f, '/functions/v1/send-telegram').length, 0, 'an e-mail is never sent through Telegram');
      await f.page.getByText('E-mail à envoyer à Camille · 1 colis').waitFor();
      await f.page.getByText('Camille avait donné son accord pour 2 cartons. Pour ce nouveau carton, son accord est à redemander : sa ligne passe à « Accord à demander » dans le Brouillon.').waitFor();
      await f.page.getByRole('button', { name: 'Copier le texte' }).click();
      await f.page.getByText('Texte copié : collez-le dans un e-mail à camille@example.test.').waitFor();
      assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()), sent.p_text, 'the text copied is the recorded notice');
      const mailto = await f.page.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href');
      assert.match(mailto, /^mailto:camille@example\.test\?subject=Votre%20colis%20est%20arriv%C3%A9%20chez%20Exped%C3%AEle&body=Bonjour%20Camille/);
      await checkScreen(f, 'phone dark step 3');
      await snap(f, 'telephone-sombre-3-rangement-email');
      await f.page.getByRole('button', { name: 'Voir le Brouillon' }).click();
      await f.page.waitForURL(url => url.pathname === '/');
    });

    await scenario(browser, 'client-sans-contact-seulement-sans-avis', { layout: PHONE }, async f => {
      fixtures(f);
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByLabel('Nom, téléphone ou numéro client').fill('CLI-HOARAU');
      const result = rowOf(f.page.getByRole('table', { name: /^Clients trouvés/ }), /^Hoarau Jean/);
      assert.match(await result.innerText(), /Aucun brouillon en cours/);
      assert.match(await result.innerText(), /Nouveau brouillon/);
      await result.getByRole('button', { name: 'Choisir Hoarau Jean' }).click();
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await f.page.getByText('Le brouillon est créé avec ce carton. Ajoutez les suivants, puis validez-les ensemble.', { exact: true }).waitFor();
      await fillCarton(f.page, { casier: 'C-12', measures: ['50', '40', '30', '6'] });
      await checkScreen(f, 'phone light step 2');
      await snap(f, 'telephone-clair-2-premier-carton');
      await addCarton(f.page, 1);
      await f.page.getByText('Jean n’a ni Telegram ni e-mail : la réception sera validée sans avis.', { exact: false }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /prévenir Jean/ }).count(), 0, 'no notice is offered without a contact');
      assert.equal(await f.page.getByRole('link', { name: 'Compléter sa fiche' }).getAttribute('href'), `/clients/${H}`);
      await checkScreen(f, 'phone light step 2 without contact');
      await snap(f, 'telephone-clair-2b-validation-sans-contact');
      // Validating without a notice is confirmed; « Annuler » sends nothing.
      await f.page.getByRole('button', { name: 'Valider 1 carton sans prévenir', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Valider sans prévenir Jean ?' });
      await dialog.getByText('Aucun avis ne sera envoyé pour ces cartons.').waitFor();
      await snap(f, 'telephone-clair-2c-confirmation-sans-avis');
      await dialog.getByRole('button', { name: 'Annuler' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(requestsTo(f, '/rpc/validate_reception').length, 0, 'nothing is validated without the confirmation');
      await f.page.getByRole('button', { name: 'Valider 1 carton sans prévenir', exact: true }).click();
      await dialog.getByRole('button', { name: 'Valider sans prévenir' }).click();
      await f.page.getByText('Réception validée sans avis : le client n’est pas prévenu').waitFor();
      const sent = requestsTo(f, '/rpc/validate_reception')[0].input;
      assert.deepEqual({ notify: sent.p_notify, canal: sent.p_canal, template: sent.p_template, text: sent.p_text }, { notify: false, canal: null, template: null, text: null });
      assert.equal(f.tables.messages.length, 0);
      await f.page.getByText('C-12', { exact: true }).waitFor();
      await checkScreen(f, 'phone light step 3 without notice');
      await snap(f, 'telephone-clair-3-rangement-sans-avis');
    });

    await scenario(browser, 'reprise-apres-rechargement-et-cartons-abimes-avec-photos', { layout: TABLET }, async f => {
      const state = fixtures(f);
      const uploads = await photoBucket(f);
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}`);
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await fillCarton(f.page, { tracking: 'COLISSIMO-778', vendor: 'Zara', measures: ['44', '33'] });
      await flagForbidden(f.page, 'Aérosols');
      await damagedToggle(f.page).click();
      await f.page.getByLabel(/^Ce que vous constatez/).fill('Coin enfoncé');
      assert.ok(await f.page.evaluate(() => Object.keys(sessionStorage).some(key => key.includes('reception-flow'))), 'the typing is kept in the tab');
      await f.page.reload();
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      assert.deepEqual([await f.page.getByLabel(/^Numéro de suivi/).inputValue(), await f.page.getByLabel(/^Vendu par/).inputValue(), await f.page.getByLabel('Longueur (cm)', { exact: true }).inputValue(), await f.page.getByLabel('Largeur (cm)', { exact: true }).inputValue()],
        ['COLISSIMO-778', 'Zara', '44', '33'], 'the carton being typed survives a reload');
      assert.equal(await f.page.getByRole('button', { name: 'Aérosols' }).getAttribute('aria-pressed'), 'true');
      assert.equal(await damagedToggle(f.page).getAttribute('aria-pressed'), 'true');
      await fillCarton(f.page, { measures: [null, null, '22', '3'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      await f.page.getByText('Prenez une photo du carton abîmé. S’il ne l’est pas, touchez à nouveau « Carton abîmé ou ouvert ».').waitFor();
      assert.equal(requestsTo(f, '/rpc/append_reception_cartons').length, 0, 'a damaged carton waits for its photo');
      // An image the server would not keep is refused at once.
      await f.page.locator('input[type="file"]').nth(1).setInputFiles({ name: 'carton.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
      await f.page.getByText('Cette image n’est pas au format JPEG, PNG ou WebP : reprenez la photo ou choisissez-en une autre.').waitFor();
      await f.page.locator('#rf-photo-camera').setInputFiles({ name: 'carton.png', mimeType: 'image/png', buffer: PNG });
      await f.page.getByRole('img', { name: 'Photo du carton abîmé' }).waitFor();
      await checkScreen(f, 'tablet light damaged carton');
      await snap(f, 'tablette-clair-2-carton-abime');
      await addCarton(f.page, 1);
      const append = requestsTo(f, '/rpc/append_reception_cartons')[0].input;
      assert.equal(append.p_notes_reception, 'Carton n° 3 (Zara, COLISSIMO-778) abîmé ou ouvert à la réception : Coin enfoncé.');
      assert.deepEqual(append.p_check_interdits, ['Aérosols']);
      // The photo of carton n° 3: stored in the dossier's folder, then recorded with its carton.
      assert.equal(uploads.length, 1, 'one photo uploaded to the private bucket');
      assert.match(uploads[0], new RegExp(`^${ids.P}/[0-9a-f-]{36}\\.png$`));
      assert.deepEqual(requestsTo(f, '/rpc/add_reception_photo').map(request => request.input), [{ p_colis_id: ids.P, p_carton: 3, p_path: uploads[0] }]);
      assert.deepEqual(state.photos.map(photo => [photo.carton, photo.path]), [[3, uploads[0]]]);
      // The dossier had no photo yet: this one becomes its photo.
      const photoPatches = () => f.requests.filter(request => request.method === 'PATCH' && request.path === '/rest/v1/colis' && request.input?.photo_reception === true);
      assert.equal(photoPatches().length, 1);
      assert.equal(photoPatches()[0].input.photo_reception_url, uploads[0]);
      await f.page.locator('.rf-saved').getByText(`Carton n° 3 enregistré dans EXP-TEST-001.`).waitFor();

      // A second damaged carton, photographed by the camera (a file without extension): its own photo, the dossier's
      // photo unchanged. The form was emptied: neither the damage nor the forbidden product of carton n° 3 remain.
      assert.equal(await damagedToggle(f.page).getAttribute('aria-pressed'), 'false');
      assert.equal(await f.page.getByRole('img', { name: 'Photo du carton abîmé' }).count(), 0);
      await fillCarton(f.page, { tracking: 'COLISSIMO-779', vendor: 'Zara', measures: ['40', '30', '20', '2'] });
      await damagedToggle(f.page).click();
      await f.page.locator('#rf-photo-camera').setInputFiles({ name: 'image', mimeType: 'image/jpeg', buffer: PNG });
      await f.page.getByRole('img', { name: 'Photo du carton abîmé' }).waitFor();
      await addCarton(f.page, 2);
      assert.equal(uploads.length, 2);
      assert.match(uploads[1], new RegExp(`^${ids.P}/[0-9a-f-]{36}\\.jpg$`), 'the stored file is named after its type');
      assert.deepEqual(requestsTo(f, '/rpc/add_reception_photo')[1].input, { p_colis_id: ids.P, p_carton: 4, p_path: uploads[1] });
      assert.equal(photoPatches().length, 1, 'the dossier keeps its first photo');
      assert.deepEqual(state.photos.map(photo => photo.carton), [3, 4], 'one photo per carton');

      // Neither damage is in the notice: the validation reminds the team to tell the client.
      const reminder = f.page.getByRole('note').filter({ hasText: 'À signaler à Camille vous-même' });
      assert.match(await rowOf(reminder, 'Carton 3').innerText(), /Abîmé ou ouvert\s+Produit interdit : Aérosols/);
      assert.match(await rowOf(reminder, 'Carton 4').innerText(), /Abîmé ou ouvert/);
      assert.doesNotMatch(await rowOf(reminder, 'Carton 4').innerText(), /Produit interdit/);
      await checkScreen(f, 'tablet light flagged cartons');
      await snap(f, 'tablette-clair-3-cartons-signales');
      await f.page.reload();
      await f.page.getByRole('heading', { name: toValidate(2), exact: true }).waitFor();
      await f.page.locator('.rf-saved').getByText('Carton n° 4 enregistré dans EXP-TEST-001.').waitFor();
      await f.page.getByText('COLISSIMO-778', { exact: true }).waitFor();
      await rowOf(reminder, 'Carton 4').waitFor();
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
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await fillCarton(f.page, { tracking: 'DHL-1234567890', vendor: 'Cdiscount', measures: ['60', '40', '40', '8,5'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await check.waitFor();
      assert.equal(await f.page.getByLabel(/^Numéro de suivi/).isDisabled(), true, 'the carton cannot change while its save is checked');
      // Nothing is validated while the carton is to check.
      await f.page.getByText('Vérifiez d’abord l’enregistrement du carton ci-dessus', { exact: false }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^Valider / }).count(), 0);
      await checkScreen(f, 'tablet dark uncertain save');
      await snap(f, 'tablette-sombre-2-enregistrement-a-verifier');
      await f.page.reload();
      await check.waitFor();
      await check.click();
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
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
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await fillCarton(f.page, { casier: 'D-04', tracking: 'UPS-1Z999', measures: ['35', '25', '12', '1,8'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await check.waitFor();
      await snap(f, 'telephone-clair-2-creation-a-verifier');
      down = false;
      await check.click();
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
      assert.equal(inserts, 1, 'the check finds the dossier: no second insert');
      assert.equal(f.tables.colis.filter(row => row.client_id === H).length, 1, 'one brouillon');
    });

    await scenario(browser, 'creation-reponse-perdue-brouillon-complete-entre-temps', { layout: PHONE, expectedConsole: /Failed to load resource|ERR_FAILED/ }, async f => {
      fixtures(f);
      let down = false, created = null;
      await f.context.route('**/rest/v1/colis*', async route => {
        const request = route.request();
        if (request.method() === 'POST' && !created) {
          // The brouillon is created, then the network drops before the answer and before the check.
          created = { created_at: now(), updated_at: now(), ...request.postDataJSON() };
          f.tables.colis.push(created);
          down = true;
          return route.abort('failed');
        }
        if (down) return route.abort('failed');
        return route.fallback();
      });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${H}`);
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await fillCarton(f.page, { casier: 'D-05', tracking: 'UPS-1Z777', vendor: 'Fnac', measures: ['35', '25', '12', '1,8'] });
      await f.page.getByRole('button', { name: 'Ajouter ce carton', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await check.waitFor();
      // Meanwhile a colleague adds a carton to that brouillon: it is no longer the receipt sent (insertColis: 40001).
      Object.assign(created, { nb_colis: 2, trackings: ['UPS-1Z777', 'COLLEGUE-1'], trackings_detail: [...created.trackings_detail, { number: 'COLLEGUE-1', fournisseur: 'Temu' }],
        dims_par_colis: [...created.dims_par_colis, { dimL: 20, dimW: 20, dimH: 20, poids: 1 }], updated_at: now() });
      down = false;
      await check.click();
      // The carton is recorded: the brouillon is opened, never « non enregistré ».
      await f.page.getByRole('heading', { level: 2, name: toValidate(2), exact: true }).waitFor();
      await f.page.locator('.rf-saved').getByText(`Carton n° 1 enregistré dans ${created.ref} (nouveau brouillon).`).waitFor();
      await f.page.getByText('Ce brouillon a été complété depuis par un collègue : il reste ouvert, vos prochains cartons s’y ajoutent.').waitFor();
      assert.equal(await f.page.getByText(/pas (été )?enregistré/).count(), 0, 'a recorded carton is never said not recorded');
      assert.equal(f.tables.colis.filter(row => row.client_id === H).length, 1, 'one brouillon');
      await checkScreen(f, 'phone light recorded in a brouillon changed meanwhile');
      await snap(f, 'telephone-clair-2-brouillon-complete-entre-temps');
      // The next carton joins that brouillon, on the same screen.
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      await f.page.getByText('Brouillon en cours : 2 cartons · Casier D-05').waitFor();
      assert.equal(await f.page.getByLabel(/^Casier/).count(), 0);
    });

    await scenario(browser, 'creation-client-reponse-perdue-verifier-enregistrement', { layout: PHONE, expectedConsole: /Failed to load resource|ERR_FAILED/ }, async f => {
      fixtures(f);
      let down = false, createId = null;
      const posts = [];
      await f.context.route('**/rest/v1/clients*', async route => {
        const request = route.request();
        if (request.method() === 'POST') {
          posts.push(request.postDataJSON());
          if (posts.length > 1) return route.fallback();
          // The client is created, then the network drops before the answer and before the check.
          createId = posts[0].id;
          f.tables.clients.push({ created_at: now(), updated_at: now(), ...posts[0] });
          down = true;
          return route.abort('failed');
        }
        if (down && createId && request.url().includes(createId)) return route.abort('failed');
        return route.fallback();
      });
      await f.login();
      await f.page.goto(`${base}/recevoir`);
      await f.page.getByLabel('Nom, téléphone ou numéro client').fill('Rivière');
      await f.page.getByRole('button', { name: 'Créer un nouveau client' }).click();
      const form = f.page.getByRole('form', { name: 'Nouveau client' });
      await form.getByLabel('Prénom', { exact: true }).fill('Lucas');
      await form.getByLabel('Téléphone mobile', { exact: true }).fill('0692 98 76 54');
      await form.getByLabel('E-mail', { exact: true }).fill('lucas.riviere@example.test');
      await form.getByLabel('Adresse de livraison', { exact: true }).fill('4 rue du Port');
      await form.getByLabel('Code postal', { exact: true }).fill('97420');
      await form.getByLabel('Ville', { exact: true }).fill('Le Port');
      await form.getByRole('button', { name: 'Créer le client' }).click();
      const verify = form.getByRole('button', { name: 'Vérifier l’enregistrement' });
      await verify.waitFor();
      await form.getByText('Création à vérifier').waitFor();
      assert.equal(await form.getByRole('button', { name: 'Créer le client' }).count(), 0, '« Créer le client » waits for the check');
      assert.equal(await form.getByLabel('E-mail', { exact: true }).isDisabled(), true, 'the client cannot change while its creation is checked');
      await checkScreen(f, 'phone light client creation to check');
      await snap(f, 'telephone-clair-1c-creation-client-a-verifier');
      // The tablet is switched off and on: the creation is still to check, with its typing.
      await f.page.reload();
      await verify.waitFor();
      assert.equal(await form.getByLabel('Nom', { exact: true }).inputValue(), 'Rivière');
      assert.equal(await f.page.evaluate(() => document.activeElement?.textContent), 'Vérifier l’enregistrement', 'the check takes the focus');
      down = false;
      await verify.click();
      await f.page.getByRole('heading', { level: 2, name: 'Ajouter un carton' }).waitFor();
      assert.equal(posts.length, 2, 'the lost creation, then its check');
      const { ref: _first, ...firstPost } = posts[0];
      const { ref: _second, ...secondPost } = posts[1];
      assert.deepEqual(secondPost, firstPost, 'the very same creation is replayed (its client number aside)');
      assert.equal(f.tables.clients.filter(row => row.email === 'lucas.riviere@example.test').length, 1, 'one client');
      assert.equal(new URL(f.page.url()).searchParams.get('client'), createId);
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
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'rf-validation-title', 'the list to validate takes the focus');
      // Opened to validate: the form waits behind one button.
      assert.equal(await f.page.getByLabel(/^Numéro de suivi/).count(), 0, 'the form is closed');
      await f.page.getByRole('button', { name: 'Ajouter un carton pour Camille', exact: true }).waitFor();
      // The carton recorded earlier: its vendor and number, its measures and when it arrived.
      const earlier = rowOf(f.page.getByRole('table', { name: /^Cartons à valider/ }), 'Carton 3');
      assert.match(await earlier.innerText(), /Amazon\s+TBA30219911\s+30\s×\s25\s×\s15\scm\s+1,1\skg\s+(Aujourd’hui|Hier)\s+\d{1,2}\s*h\s*\d{2}/);
      await checkScreen(f, 'tablet light opened to validate');
      await snap(f, 'tablette-clair-2-ouvert-pour-valider');
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      const check = f.page.getByRole('button', { name: 'Vérifier la validation' });
      await check.waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille' }).count(), 0, 'no second validation while the first is unknown');
      await snap(f, 'tablette-clair-2-validation-a-verifier');
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
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
      await f.page.getByText(/^L’e-mail pour Camille sera préparé/).waitFor();
      // The client links Telegram after the screen read its contact.
      f.tables.clients[0].telegram_chat_id = 'chat-camille';
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      await f.page.getByText(/Le contact du client a changé : l’avis partira par Telegram\. La liste et le contact de Camille sont actualisés/).waitFor();
      await f.page.getByText('Camille recevra un seul message Telegram pour 1 colis.').waitFor();
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
      const validations = requestsTo(f, '/rpc/validate_reception');
      assert.equal(validations.length, 2);
      assert.notEqual(validations[1].input.p_request_id, validations[0].input.p_request_id, 'a refused request is never replayed');
      assert.equal(validations[1].input.p_canal, 'telegram');
    });

    // The user's screenshot of 2026-10-29: « Could not find the function public.list_pending_receptions(p_client_id) in
    // the schema cache ». A technical answer is never shown: a plain sentence and « Réessayer ».
    await scenario(browser, 'erreur-technique-message-lisible', { layout: TABLET, expectedConsole: /Failed to load resource/ }, async f => {
      fixtures(f);
      earlierPendingCarton(f);
      let broken = true;
      await f.context.route('**/rest/v1/rpc/list_pending_receptions', route => broken
        ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.list_pending_receptions(p_client_id) in the schema cache', details: null, hint: null }) })
        : route.fallback());
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      const alert = f.page.getByRole('alert').filter({ hasText: 'La liste des cartons à valider n’a pas pu être lue.' });
      await alert.waitFor();
      assert.equal(await f.page.getByText(/schema cache|Could not find/).count(), 0, 'a technical answer is never shown');
      assert.equal(await f.page.getByRole('button', { name: /^Valider / }).count(), 0, 'nothing to validate without the list');
      await checkScreen(f, 'tablet light list unreadable');
      await snap(f, 'tablette-clair-2-liste-illisible');
      broken = false;
      await alert.getByRole('button', { name: 'Réessayer' }).click();
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('alert').filter({ hasText: 'n’a pas pu être lue' }).count(), 0);
    });

    await scenario(browser, 'validation-concurrente-premier-carton-change', { layout: TABLET, expectedConsole: /Failed to load resource/ }, async f => {
      const state = fixtures(f, { telegram: true });
      earlierPendingCarton(f);
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByRole('heading', { name: toValidate(1), exact: true }).waitFor();
      await f.page.getByText('TBA30219911', { exact: true }).waitFor();
      // Meanwhile a colleague validates carton n° 3, and carton n° 4 arrives.
      const [colleague] = validateReception(f.tables, state, { id: 'collegue' }, { p_client_id: ids.C, p_items: [{ colisId: ids.P, fromCarton: 3, throughCarton: 3 }], p_notify: false, p_request_id: crypto.randomUUID() });
      assert.equal(colleague, 200);
      const parcel = f.tables.colis.find(row => row.id === ids.P);
      Object.assign(parcel, { nb_colis: 4, trackings: [...parcel.trackings, 'DPD-0004'], trackings_detail: [...parcel.trackings_detail, { number: 'DPD-0004', fournisseur: 'Decathlon' }],
        dims_par_colis: [...parcel.dims_par_colis, { dimL: 50, dimW: 40, dimH: 30, poids: 4 }], reception_dates: [...parcel.reception_dates, { receivedAt: ago(5), source: 'server' }] });
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      // The first carton is no longer the one shown (40001): the list is read again, the refusal said once.
      const failure = f.page.getByRole('alert').filter({ hasText: 'La réception n’est pas validée' });
      await failure.getByText('Des cartons de ce dossier ont été validés entre-temps. La liste et le contact de Camille sont actualisés : vérifiez, puis validez à nouveau.').waitFor();
      assert.doesNotMatch(await failure.innerText(), /actualisez la liste/i, 'the advice to refresh is not repeated');
      await f.page.getByText('DPD-0004', { exact: true }).waitFor();
      assert.equal(await f.page.getByText('TBA30219911', { exact: true }).count(), 0, 'the carton validated meanwhile is gone');
      await checkScreen(f, 'tablet light validated meanwhile');
      await snap(f, 'tablette-clair-2-valide-entre-temps');
      await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
      await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
      const validations = requestsTo(f, '/rpc/validate_reception');
      assert.deepEqual(validations.map(request => request.input.p_items), [[{ colisId: ids.P, fromCarton: 3, throughCarton: 3 }], [{ colisId: ids.P, fromCarton: 4, throughCarton: 4 }]]);
      assert.notEqual(validations[1].input.p_request_id, validations[0].input.p_request_id);
      assert.equal(state.validations.length, 2, 'the colleague’s validation, then this one');
    });

    await scenario(browser, 'gros-lot-decoupe-au-texte-de-l-avis', { layout: TABLET }, async f => {
      const state = fixtures(f);
      // Marie (e-mail) has 90 cartons waiting in two brouillons: EXP-LOT-A, waiting longest, her invoice received;
      // EXP-LOT-B, still requesting its invoice (it comes first: the notice is filed there).
      const lot = (letter, size, minutes) => {
        const id = crypto.randomUUID();
        const boxes = Array.from({ length: size }, () => ({ dimL: 30, dimW: 20, dimH: 10, poids: 1.5 }));
        const codes = boxes.map((_, index) => `TBA${letter}${String(index + 1).padStart(11, '0')}`);
        f.tables.colis.push({ id, client_id: E, ref: `EXP-LOT-${letter}`, statut: 'mesure', casier: `F-0${letter === 'A' ? 1 : 2}`, nb_colis: size, desc_contenu: 'Commandes groupées',
          trackings: codes, trackings_detail: codes.map(number => ({ number, fournisseur: 'Amazon' })), dims_par_colis: boxes, archive: false, feu_vert: 'en_attente',
          created_at: ago(minutes), updated_at: ago(minutes - 1), date_reception: ago(minutes), reception_dates: boxes.map(() => ({ receivedAt: ago(minutes), source: 'server' })) });
        return id;
      };
      const first = lot('A', 50, 90), second = lot('B', 40, 60);
      f.tables.factures.push({ id: crypto.randomUUID(), colis_id: first, vendeur: 'Amazon', montant: 80, valide: true, fichier_url: `${first}/facture.pdf`, fichier_nom: 'facture.pdf' });
      await f.login();
      await f.page.goto(`${base}/recevoir?client=${E}&valider=1`);
      const heading = f.page.getByRole('heading', { level: 2, name: /^À valider : \d+ cartons$/ });
      await heading.waitFor();
      const shown = Number((await heading.innerText()).match(/(\d+) cartons/)[1]);
      assert.ok(shown > 40 && shown < 90, `the notice holds part of the 90 cartons (${shown})`);
      await f.page.getByText(`Encore ${90 - shown} cartons à valider ensuite : un avis d’arrivée ne peut pas en annoncer davantage en un seul message.`).waitFor();
      await checkScreen(f, 'tablet big batch');
      await snap(f, 'tablette-clair-2-gros-lot');
      await f.page.evaluate(() => document.querySelector('main.staff-main')?.scrollTo({ top: 1e6 }));
      await settle(f.page);
      await f.page.screenshot({ path: path.join(out, 'tablette-clair-2-gros-lot-bas.png') });
      await f.page.getByRole('button', { name: `Valider ${shown} cartons et prévenir Marie`, exact: true }).click();
      await f.page.getByRole('heading', { level: 2, name: `Réception validée : ${shown} colis pour Marie Grondin` }).waitFor();
      const sent = requestsTo(f, '/rpc/validate_reception')[0].input;
      // The brouillon still requesting its invoice first, then the other one, cut where the text is full.
      assert.deepEqual(sent.p_items, [{ colisId: second, fromCarton: 1, throughCarton: 40 }, { colisId: first, fromCarton: 1, throughCarton: shown - 40 }]);
      assert.equal(sent.p_template, 'arrivee_colis_facture');
      assert.ok(Array.from(sent.p_text).length <= 4096, 'the text holds in one message');
      const lines = sent.p_text.split('\n').filter(line => /^\d+\. Amazon — /.test(line));
      assert.equal(lines.length, shown, 'one line per carton validated');
      assert.equal(lines[0], '1. Amazon — TBAB00000000001 — 30 × 20 × 10 cm — 1,5 kg');
      assert.equal(lines[lines.length - 1], `${shown}. Amazon — TBAA${String(shown - 40).padStart(11, '0')} — 30 × 20 × 10 cm — 1,5 kg`);
      const next = `${shown + 1}. Amazon — TBAA${String(shown - 39).padStart(11, '0')} — 30 × 20 × 10 cm — 1,5 kg`;
      assert.ok(sent.p_text.length + next.length + 1 > 4096, 'one carton more would not hold');
      assert.equal(f.tables.messages[0].colis_id, second, 'the notice is filed on the brouillon requesting its invoice');
      // The rest: a next validation, with its own notice.
      await f.page.getByText(`Encore ${90 - shown} cartons de Marie à valider`).waitFor();
      await checkScreen(f, 'tablet big batch validated');
      await snap(f, 'tablette-clair-3-gros-lot-reste');
      await f.page.getByRole('button', { name: 'Valider les cartons restants' }).click();
      await f.page.getByRole('heading', { level: 2, name: toValidate(90 - shown), exact: true }).waitFor();
      assert.equal(await f.page.getByText(/^Encore \d+ cartons? à valider ensuite/).count(), 0, 'the rest holds in one notice');
      await f.page.getByRole('button', { name: `Valider ${90 - shown} cartons et prévenir Marie`, exact: true }).click();
      await f.page.getByRole('heading', { level: 2, name: `Réception validée : ${90 - shown} colis ajoutés au brouillon de Marie Grondin` }).waitFor();
      assert.deepEqual(requestsTo(f, '/rpc/validate_reception')[1].input.p_items, [{ colisId: first, fromCarton: shown - 39, throughCarton: 50 }]);
      assert.equal(state.validations.length, 2);
    });

    for (const [layout, dark] of [[TABLET, true], [PHONE, false]]) {
      const tag = `${layout.name}-${dark ? 'sombre' : 'clair'}`;
      await scenario(browser, `avis-arrivee-${tag}`, { layout, dark }, async f => {
        const state = fixtures(f, { telegram: true });
        const marie = f.tables.clients.find(row => row.id === E);
        const { stale, failed } = noticeHistory(f, state);
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
        const list = f.page.getByRole('table', { name: 'Avis d’arrivée récents' });
        await list.getByText('Non remis', { exact: true }).waitFor();
        await list.getByText('Raison : Telegram : chat introuvable').waitFor();
        await list.getByText('À envoyer', { exact: true }).waitFor();
        await list.getByText('Envoyé', { exact: true }).waitFor();
        await list.getByText('Sans avis', { exact: true }).waitFor();
        const toCheck = list.locator('tbody tr', { hasText: 'Envoi à vérifier' });
        await toCheck.getByText('Toujours pas parti au bout de 10 minutes : l’envoi automatique ne l’a pas pris en charge.').waitFor();
        await toCheck.getByText('Il n’est jamais parti : vous pouvez l’envoyer maintenant.').waitFor();
        await f.page.getByText('1 envoi à vérifier', { exact: true }).waitFor();
        await checkScreen(f, `${tag} avis`);
        await snap(f, `${tag}-avis-arrivee`);
        // E-mail to send: the text to copy.
        await list.getByRole('button', { name: 'Copier le texte' }).click();
        assert.match(await f.page.evaluate(() => navigator.clipboard.readText()), /^Bonjour Marie/);
        assert.match(await list.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href'), /^mailto:marie\.grondin@example\.test\?subject=/);
        // Telegram not delivered: checked in Telegram, then sent again on purpose.
        const notDelivered = list.locator('tbody tr', { hasText: 'Non remis' });
        await notDelivered.getByText('Avant de réessayer, vérifiez dans Telegram que le message n’est pas arrivé.').waitFor();
        await notDelivered.getByRole('button', { name: 'Réessayer l’envoi' }).click();
        await f.page.waitForFunction(() => !document.body.innerText.includes('Non remis'));
        const retry = requestsTo(f, '/functions/v1/send-telegram');
        assert.equal(retry.length, 1);
        assert.deepEqual(retry[0].input, { colisId: failed.message.colis_id, messageId: failed.message.id, retryConfirmed: true });
        await list.getByText('Telegram a confirmé l’envoi.').waitFor();
        // The notice never taken: sent now (the message's own dossier, as list_arrival_notices names it).
        await toCheck.getByRole('button', { name: 'Réessayer l’envoi' }).click();
        await f.page.waitForFunction(() => !document.body.innerText.includes('Envoi à vérifier'));
        const sends = requestsTo(f, '/functions/v1/send-telegram');
        assert.equal(sends.length, 2);
        assert.deepEqual(sends[1].input, { colisId: stale.message.colis_id, messageId: stale.message.id, retryConfirmed: true });
        assert.equal(state.outbox.find(item => item.message_id === stale.message.id).status, 'sent');
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
      await f.page.getByText('Demandez à un responsable de créer ce client.').waitFor();
      await checkScreen(f, 'phone light step 1 without client creation');
      await snap(f, 'telephone-clair-1-sans-creation-client');
      await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
      await f.page.getByText('Votre accès ne permet pas de prévenir Camille par Telegram : validez sans prévenir, ou demandez à un collègue autorisé de valider la réception.').waitFor();
      assert.equal(await f.page.getByRole('button', { name: /prévenir Camille/ }).count(), 0);
      await checkScreen(f, 'phone light step 2 without telegram permission');
      await f.page.getByRole('button', { name: 'Valider 1 carton sans prévenir', exact: true }).click();
      await f.page.getByRole('dialog', { name: 'Valider sans prévenir Camille ?' }).getByRole('button', { name: 'Valider sans prévenir' }).click();
      await f.page.getByText('Réception validée sans avis : le client n’est pas prévenu').waitFor();
      assert.equal(requestsTo(f, '/rpc/validate_reception')[0].input.p_notify, false);
    });

    // Tables on every device (390 px phone, 768 and 820 px tablets upright, 1024 px tablet lying, 1440 px computer): the
    // clients found, the cartons to validate and those to tell the client about, the receptions to validate and the
    // notices; never a list of cards, never a page that scrolls sideways.
    for (const [layout, dark, widths] of [[PHONE, false, [390, 768, 820, 1024]], [DESKTOP, false, [1024, 1440]], [PHONE, true, [390, 820]], [DESKTOP, true, [1440]]]) {
      const theme = dark ? 'sombre' : 'clair';
      await scenario(browser, `tableaux-${layout === DESKTOP ? 'ordinateur' : 'tactile'}-${theme}`, { layout, dark }, async f => {
        const state = fixtures(f, { telegram: true });
        noticeHistory(f, state);
        earlierPendingCarton(f);
        // Carton n° 3 arrived damaged: the validation recalls it, in a table of its own.
        f.tables.colis.find(row => row.id === ids.P).notes_reception = 'Carton n° 3 (Amazon, TBA30219911) abîmé ou ouvert à la réception : coin enfoncé.';
        await f.login();
        for (const width of widths) {
          await f.page.setViewportSize({ width, height: layout === DESKTOP ? 900 : 844 });
          const tag = `${width}-${theme}`;
          await f.page.goto(`${base}/recevoir`);
          await f.page.getByLabel('Nom, téléphone ou numéro client').fill('a');
          await f.page.getByRole('table', { name: /^Clients trouvés/ }).waitFor();
          let found = await checkScreen(f, `${tag} clients`);
          assert.ok(found.length === 1 && found[0].rows >= 2, `${tag}: the clients found in a table`);
          await scrollTables(f, `${tag} clients`);
          await snap(f, `tableaux-${tag}-1-clients`);

          await f.page.goto(`${base}/recevoir?client=${ids.C}&valider=1`);
          await f.page.getByRole('table', { name: /^Cartons à valider/ }).waitFor();
          found = await checkScreen(f, `${tag} validation`);
          assert.deepEqual(found.map(table => [table.name, table.rows]), [['Cartons à valider pour Exemple Camille', 1], ['Cartons signalés à la réception', 1]]);
          await scrollTables(f, `${tag} validation`);
          await snap(f, `tableaux-${tag}-2-a-valider`);

          await f.page.goto(`${base}/avis`);
          await f.page.getByRole('table', { name: 'Avis d’arrivée récents' }).waitFor();
          found = await checkScreen(f, `${tag} avis`);
          assert.deepEqual(found.map(table => [table.name, table.rows]), [['Réceptions à valider, par client', 1], ['Avis d’arrivée récents', 5]]);
          const scrolled = await scrollTables(f, `${tag} avis`);
          if (width === 390) assert.equal(scrolled, 2, 'on a phone both tables scroll in their frames');
          await snap(f, `tableaux-${tag}-avis`);
        }
      });
    }

    for (const [layout, dark] of [[PHONE, false], [TABLET, true]]) {
      const tag = `${layout.name}-${dark ? 'sombre' : 'clair'}`;
      await scenario(browser, `mise-en-page-${tag}`, { layout, dark }, async f => {
        fixtures(f, { telegram: true });
        await f.login();
        await f.page.goto(`${base}/recevoir`);
        await f.page.getByLabel('Nom, téléphone ou numéro client').fill('Exemple');
        await f.page.getByRole('button', { name: 'Choisir Exemple Camille' }).waitFor();
        await checkScreen(f, `${tag} step 1`);
        await snap(f, `${tag}-1-client`);
        await chooseClient(f.page, 'Exemple', 'Exemple Camille');
        await checkScreen(f, `${tag} step 2`);
        await snap(f, `${tag}-2-carton`);
        // Both problems open: the photo of the damaged carton and the forbidden products.
        await damagedToggle(f.page).click();
        await f.page.getByRole('button', { name: /^Produit interdit/ }).click();
        await checkScreen(f, `${tag} step 2 problems`);
        await snap(f, `${tag}-2-carton-probleme`);
        await fillCarton(f.page, { tracking: 'LP00112233', vendor: 'Temu', measures: ['20', '15', '10', '0,8'] });
        await damagedToggle(f.page).click();
        await f.page.getByRole('button', { name: /^Produit interdit/ }).click();
        await addCarton(f.page, 1);
        await checkScreen(f, `${tag} step 2 to validate`);
        await snap(f, `${tag}-2-a-valider`);
        await f.page.getByText('Voir le message').click();
        await f.page.locator('pre.rf-message').waitFor();
        assert.match(await f.page.locator('pre.rf-message').innerText(), /^Bonjour Camille/);
        await f.page.getByRole('button', { name: 'Valider 1 carton et prévenir Camille', exact: true }).click();
        await f.page.getByText('Message Telegram envoyé à Camille · 1 colis').waitFor();
        await checkScreen(f, `${tag} step 3`);
        await snap(f, `${tag}-3-rangement`);
      });
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();

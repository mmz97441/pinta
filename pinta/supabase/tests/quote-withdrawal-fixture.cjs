'use strict';
// Shared fixture for the late-invoice and quote-withdrawal Edge tests (not a test file itself).
// It models, in memory, the SQL contract the Edge functions rely on (spec §4.7–§4.12:
// invoice_lock_state, claim/release/complete_quote_withdrawal, mark_quote_withdrawal_message,
// withdraw_quote_for_documents, client_document_precheck, deposit_client_invoice,
// register_telegram_document, register_late_invoice_from_message, queue_message…), then runs
// the real bundled functions against it. PayPlug and Telegram are simulated: no network access.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const esbuild = require('../../node_modules/esbuild');

const root = path.resolve(__dirname, '../functions');
const ID = {
  colis: '30000000-0000-4000-8000-000000000001', otherColis: '30000000-0000-4000-8000-000000000002',
  client: '20000000-0000-4000-8000-000000000001', otherClient: '20000000-0000-4000-8000-000000000002',
  clientUser: '10000000-0000-4000-8000-000000000101', otherClientUser: '10000000-0000-4000-8000-000000000102',
  staff: '10000000-0000-4000-8000-000000000001', colleague: '10000000-0000-4000-8000-000000000002',
  intent: '50000000-0000-4000-8000-000000000001', invoice: '40000000-0000-4000-8000-000000000001',
};
const UPDATED_AT = '2026-10-04T07:00:00.123456+00:00';
const CHAT = 4242;
const ENV = { SUPABASE_URL:'https://fixture.supabase.co', SUPABASE_ANON_KEY:'anon-fixture', SUPABASE_SERVICE_ROLE_KEY:'service-fixture',
  PAYPLUG_SECRET_KEY:'sk_test_fixture', PAYPLUG_MODE:'test', TELEGRAM_BOT_TOKEN:'bot-fixture', TELEGRAM_WEBHOOK_SECRET:'webhook-fixture',
  RELANCES_CRON_SECRET:'cron-fixture', APP_URL:'https://app.example.test' };
const OPEN = ['receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement'];
const TRANSPORT = ['expedie','transit','dedouanement','arrive','livraison','livre'];
const SENT = ['devis_envoye','attente_paiement'];
const OPEN_REQUEST = ['pending','processing','needs_review'];
const FROZEN = { payment:'Un paiement est enregistré pour ce dossier : factures, articles et analyses sont figés. Ils restent consultables.',
  departure:'Ce dossier est parti : factures, articles et analyses sont figés. Ils restent consultables.', closed:'Ce dossier est clos : factures, articles et analyses restent consultables.' };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sha256 = async text => Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(text))).toString('hex');
const instant = value => { const fraction = (String(value).match(/\.(\d+)/)?.[1] || '').padEnd(6, '0'); return `${Date.parse(value)}:${fraction.slice(3)}`; };
const sqlError = (code, message, hint = null) => Object.assign(new Error(message), { sql: { code, message, hint } });

function world(options = {}) {
  const clock = { now: Date.parse('2026-10-04T08:00:00.000Z') };
  let micro = 0; let sequence = 0;
  const iso = () => new Date(clock.now).toISOString();
  const stamp = () => `${iso().slice(0, 23)}${String(++micro % 1000).padStart(3, '0')}+00:00`;
  const newId = () => webcrypto.randomUUID();
  const intent = { id:ID.intent, colis_id:ID.colis, quote_version:2, provider_id:'pay_fixture', payment_url:'https://secure.payplug.com/fixture', amount_cents:4000,
    currency:'EUR', status:'pending', provider_is_live:false, provider_cancelled_at:null };
  const tables = {
    profiles: [{ id:ID.staff, role:options.role || 'operateur', actif:true, nom:'Équipe Paris' }, { id:ID.colleague, role:'operateur', actif:true, nom:'Collègue' },
      { id:ID.clientUser, role:'client', actif:true, nom:'Martin' }, { id:ID.otherClientUser, role:'client', actif:true, nom:'Autre' }],
    staff_users: [{ id:'staff-row', auth_id:ID.staff, actif:true }],
    staff_permissions: [{ staff_id:'staff-row', perm_factures_modifier_articles:true, perm_factures_ajouter:true, perm_factures_refuser:true, perm_factures_valider:true, ...options.permissions }],
    clients: [{ id:ID.client, prenom:'Flavie', nom:'Martin', type:'particulier', cp:'97400', telegram_chat_id:String(CHAT), user_id:ID.clientUser, ...options.client },
      { id:ID.otherClient, prenom:'Hugo', nom:'Autre', type:'particulier', cp:'97400', telegram_chat_id:'5151', user_id:ID.otherClientUser }],
    destinations: [{ code:'974', nom:'La Réunion', flag:'🇷🇪', tva:8.5 }],
    colis: [{ id:ID.colis, ref:'EXP-LATE01', client_id:ID.client, statut:'devis_envoye', archive:false, devis_total:40, devis_snapshot:{ total:40 }, devis_brouillon:false,
      quote_version:2, payplug_payment_id:'pay_fixture', payplug_payment_url:'https://secure.payplug.com/fixture', paiement_date:null, paiement_montant:null,
      date_expedition:null, envoi_id:null, updated_at:UPDATED_AT, nb_colis:1, trackings:['TRK1'], trackings_detail:[], desc_contenu:'Vêtements', ...options.colis },
      { id:ID.otherColis, ref:'EXP-OTHER1', client_id:ID.otherClient, statut:'en_preparation', archive:false, quote_version:1, updated_at:UPDATED_AT }],
    payment_intents: clone(options.intents ?? [intent]), legacy_payplug_payments: clone(options.legacy || []),
    paiements: clone(options.paiements || []), envois: clone(options.envois || []),
    quote_withdrawals: [], staff_work_actions: clone(options.workActions || []), message_templates: clone(options.templates || []),
    messages: [], notification_outbox: [], factures: [], audit_actions: [], invoice_review_drafts: [], client_inbox: [], telegram_updates: [],
  };
  const payplug = clone(options.payplug ?? { pay_fixture: { id:'pay_fixture', object:'payment', is_live:false, is_paid:false, amount:4000, currency:'EUR',
    amount_refunded:0, metadata:{ colis_id:ID.colis, intent_id:ID.intent, quote_version:'2' }, failure:null } });
  const w = { clock, tables, payplug, storage: { factures: {} }, calls: [], provider: [], telegram: [], writes: [], env: { ...ENV, ...options.env },
    tokens: { 'staff-jwt': { id:ID.staff }, 'colleague-jwt': { id:ID.colleague }, 'client-jwt': { id:ID.clientUser }, 'other-client-jwt': { id:ID.otherClientUser } },
    iso, stamp, newId, failRpc: {}, rpcOverride: {}, invoiceRequested: () => false };
  w.advance = ms => { clock.now += ms; };
  const byId = (table, id) => tables[table].find(row => row.id === id);
  const colisOf = id => byId('colis', id);
  const audit = (colisId, action, after) => tables.audit_actions.push({ id:newId(), colis_id:colisId, action, after_data:after, created_at:iso() });

  // ---- predicates (spec §4.2) -------------------------------------------------------------
  w.frozenReason = c => {
    if (c.statut === 'paye' || c.paiement_date || c.paiement_montant != null || tables.paiements.some(p => p.colis_id === c.id && p.statut === 'confirme')
      || tables.payment_intents.some(i => i.colis_id === c.id && i.status === 'paid')
      || tables.legacy_payplug_payments.some(l => l.colis_id === c.id && (l.observed_payment_date || l.observed_payment_amount != null))) return 'payment';
    if (c.date_expedition || TRANSPORT.includes(c.statut) || tables.envois.some(e => e.id === c.envoi_id && (e.departed_at || e.manifest_version > 0))) return 'departure';
    if (c.archive || !OPEN.includes(c.statut)) return 'closed';
    return null;
  };
  w.liveLink = c => tables.payment_intents.some(i => i.colis_id === c.id && (i.status === 'creating' || !i.provider_cancelled_at && (i.provider_id || i.payment_url || i.status === 'pending')))
    || tables.legacy_payplug_payments.some(l => l.colis_id === c.id && !l.provider_cancelled_at)
    || c.payplug_payment_url && !c.payplug_payment_id
    || c.payplug_payment_id && ![...tables.payment_intents, ...tables.legacy_payplug_payments].some(r => r.colis_id === c.id && r.provider_id === c.payplug_payment_id && r.provider_cancelled_at);
  w.quoteLocked = c => SENT.includes(c.statut) || Boolean(w.liveLink(c));
  const requestOf = factureId => tables.quote_withdrawals.find(r => !r.closed_at && r.facture_ids.includes(factureId) && [...OPEN_REQUEST, 'withdrawn'].includes(r.status));
  const identical = (colisId, sha) => sha && tables.factures.find(f => f.colis_id === colisId && f.valide && !f.duplicate_of_facture_id && !f.rejet_motif
    && !tables.factures.some(r => r.replaces_facture_id === f.id) && f.__sha === sha);
  const openLateRequest = (c, factureId, source) => {
    let row = tables.quote_withdrawals.find(r => r.colis_id === c.id && OPEN_REQUEST.includes(r.status));
    if (row) { if (!row.facture_ids.includes(factureId)) row.facture_ids.push(factureId); }
    else tables.quote_withdrawals.push(row = { id:newId(), colis_id:c.id, source, action:null, quote_version:c.quote_version, facture_ids:[factureId],
      reason:'Facture reçue du client après l’envoi du devis', status:'pending', attempts:0, next_attempt_at:iso(), locked_at:null, last_error:null,
      withdrawn_at:null, withdrawn_quote_version:null, previous_statut:null, link_cancelled:false, client_message_status:'not_required', message_id:null,
      created_at:iso(), closed_at:null, closed_reason:null });
    audit(c.id, 'late_invoice_received', { withdrawalId:row.id, factureId, source });
    return row;
  };
  // factures INSERT with its triggers: a client-origin invoice on a locked quote opens a request, nothing else changes.
  w.insertInvoice = (c, values, clientSource) => {
    const invoice = { id:newId(), colis_id:c.id, vendeur:'Document à vérifier', montant:0, valide:false, duplicate_of_facture_id:null, rejet_motif:null,
      replaces_facture_id:null, telegram_event_key:null, created_at:iso(), ...values };
    if (!clientSource && w.quoteLocked(c)) throw sqlError('22023', 'Le devis envoyé couvre ces factures. Utilisez « Retirer le devis et modifier ».', 'quote_withdrawal_required');
    tables.factures.push(invoice);
    if (clientSource && w.quoteLocked(c)) openLateRequest(c, invoice.id, clientSource);
    return invoice;
  };
  // _withdraw_quote (spec §4.6)
  w.withdraw = (c, source, action, reason, actor, factureIds) => {
    if (tables.payment_intents.some(i => i.colis_id === c.id && i.status === 'creating')) throw sqlError('40001', 'Un lien de paiement est en cours de création. Réessayez dans un instant.', 'payment_link_creating');
    if (w.liveLink(c)) throw sqlError('22023', 'L’ancien lien de paiement doit d’abord être annulé chez PayPlug.', 'link_cancellation_required');
    const previous = clone(c);
    const linked = previous.payplug_payment_url != null || tables.payment_intents.some(i => i.colis_id === c.id && i.quote_version === previous.quote_version && i.provider_cancelled_at);
    const announce = SENT.includes(previous.statut);
    Object.assign(c, { devis_total:null, devis_snapshot:null, devis_brouillon:true, payplug_payment_id:null, payplug_payment_url:null,
      statut: announce ? 'en_preparation' : c.statut, quote_version: c.quote_version + (previous.devis_total != null || previous.devis_snapshot != null ? 1 : 0), updated_at: stamp() });
    tables.payment_intents.filter(i => i.colis_id === c.id && ['creating','pending'].includes(i.status)).forEach(i => { i.status = 'superseded'; });
    tables.notification_outbox.filter(o => o.colis_id === c.id && ['pending','blocked','manual','failed'].includes(o.status)
      && ['devis_final','devis_final_pro','relance_paiement'].includes(byId('messages', o.message_id)?.template)).forEach(o => { o.status = 'cancelled'; });
    const done = { status:'withdrawn', withdrawn_at:iso(), withdrawn_quote_version:previous.quote_version, previous_statut:previous.statut, link_cancelled:linked, locked_at:null, last_error:null };
    tables.quote_withdrawals.filter(r => r.colis_id === c.id && OPEN_REQUEST.includes(r.status))
      .forEach(r => Object.assign(r, done, { client_message_status: announce ? 'pending' : 'not_required' }));
    let row;
    if (['staff','conversation_import'].includes(source)) tables.quote_withdrawals.push(row = { id:newId(), colis_id:c.id, source, action, quote_version:previous.quote_version,
      facture_ids:[...(factureIds || [])], reason, requested_by:actor, attempts:0, next_attempt_at:iso(), message_id:null, created_at:iso(), closed_at:null, closed_reason:null,
      ...done, client_message_status: source === 'conversation_import' && announce ? 'pending' : 'not_required' });
    else row = tables.quote_withdrawals.filter(r => r.colis_id === c.id && r.status === 'withdrawn' && r.withdrawn_quote_version === previous.quote_version).at(-1);
    audit(c.id, 'quote_withdrawn', { withdrawalId:row?.id, source, action, withdrawnQuoteVersion:previous.quote_version, linkCancelled:linked });
    return row;
  };
  const staffOnly = ctx => { const profile = tables.profiles.find(p => p.id === ctx.uid); if (ctx.role !== 'authenticated' || !profile || profile.role === 'client') throw sqlError('42501', 'Accès équipe requis'); };
  const serviceOnly = ctx => { if (ctx.role !== 'service_role') throw sqlError('42501', 'Service requis'); };
  const depositStatus = invoice => { const row = requestOf(invoice.id);
    return { status: row && OPEN_REQUEST.includes(row.status) ? 'intake' : row?.status === 'withdrawn' ? 'withdrawn' : 'added', facture:clone(invoice), withdrawalId:row?.id ?? null }; };

  // ---- RPC models ---------------------------------------------------------------------------
  w.rpcs = {
    invoice_lock_state({ p_colis_id }, ctx) { serviceOnly(ctx); const c = colisOf(p_colis_id);
      return { frozenReason:w.frozenReason(c), quoteLocked:w.quoteLocked(c), quoteSent:SENT.includes(c.statut), statut:c.statut, quoteVersion:c.quote_version, updatedAt:c.updated_at,
        creating:tables.payment_intents.some(i => i.colis_id === c.id && i.status === 'creating') }; },
    claim_quote_withdrawal({ p_id = null, p_rearm = false }, ctx) {
      serviceOnly(ctx);
      if (p_rearm && p_id) { const row = byId('quote_withdrawals', p_id); if (row?.status === 'needs_review') Object.assign(row, { status:'pending', attempts:0, last_error:null }); }
      const row = tables.quote_withdrawals.filter(r => (!p_id || r.id === p_id) && (r.status === 'pending' && (p_id || Date.parse(r.next_attempt_at) <= clock.now)
        || r.status === 'processing' && Date.parse(r.locked_at) < clock.now - 300000)).sort((a, b) => Date.parse(a.next_attempt_at) - Date.parse(b.next_attempt_at))[0];
      if (!row) return null;
      Object.assign(row, { status:'processing', locked_at:iso(), attempts:row.attempts + 1 });
      return clone(row);
    },
    release_quote_withdrawal({ p_id, p_outcome, p_error }, ctx) {
      serviceOnly(ctx); const row = byId('quote_withdrawals', p_id);
      if (row?.status !== 'processing') return clone(row ?? null);
      // PayPlug's word alone never closes a request as paid (spec PAY-1): only a booked payment does.
      if (p_outcome === 'paid' && w.frozenReason(colisOf(row.colis_id)) !== 'payment') { p_outcome = 'review'; p_error = 'Paiement signalé chez PayPlug mais non enregistré dans le dossier (rapprochement nécessaire)'; }
      if (p_outcome === 'retry') Object.assign(row, row.attempts >= 6 ? { status:'needs_review' } : { status:'pending', next_attempt_at:new Date(clock.now + [5,10,20,40,60,60][Math.min(row.attempts, 6) - 1] * 60000).toISOString() });
      else if (p_outcome === 'review') row.status = 'needs_review';
      else Object.assign(row, { status:p_outcome, closed_at:iso(), closed_reason:p_outcome, client_message_status: row.client_message_status === 'pending' ? 'skipped' : row.client_message_status });
      Object.assign(row, { locked_at:null, last_error:p_error ? String(p_error).slice(0, 500) : null });
      return clone(row);
    },
    complete_quote_withdrawal({ p_id }, ctx) {
      serviceOnly(ctx); const row = byId('quote_withdrawals', p_id); const c = colisOf(row.colis_id);
      if (!OPEN_REQUEST.includes(row.status)) return { status:row.status, withdrawal:clone(row), colis:clone(c) };
      const reason = w.frozenReason(c);
      if (reason || !w.quoteLocked(c) || c.quote_version !== row.quote_version) {
        Object.assign(row, { status: reason === 'payment' ? 'paid' : 'superseded', closed_at:iso(), closed_reason: reason === 'payment' ? 'paid' : 'superseded', locked_at:null,
          client_message_status: row.client_message_status === 'pending' ? 'skipped' : row.client_message_status });
        return { status:row.status, withdrawal:clone(row), colis:clone(c) };
      }
      w.withdraw(c, row.source, null, row.reason, null, row.facture_ids);
      return { status:row.status, withdrawal:clone(row), colis:clone(c) };
    },
    mark_quote_withdrawal_message({ p_colis_id, p_version, p_status, p_message_id = null, p_error = null }, ctx) {
      serviceOnly(ctx);
      tables.quote_withdrawals.filter(r => r.colis_id === p_colis_id && r.withdrawn_quote_version === p_version && r.client_message_status === 'pending')
        .forEach(r => Object.assign(r, { client_message_status:p_status, message_id:p_message_id ?? r.message_id, last_error:p_error ? String(p_error).slice(0, 500) : r.last_error }));
      return null;
    },
    queue_message({ p_colis_id, p_text, p_template = null, p_idempotency_key = null, p_reply_markup = null, p_canal = 'telegram' }, ctx) {
      if (ctx.role !== 'service_role') staffOnly(ctx);
      const c = colisOf(p_colis_id); const client = byId('clients', c.client_id);
      if (!['telegram','email','portal'].includes(p_canal) || !String(p_text || '').trim() || p_text.length > 4096) throw sqlError('P0001', 'Message invalide (1 à 4096 caractères)');
      if (p_canal === 'portal' && !client.user_id) throw sqlError('22023', 'Activez l’accès client avant d’envoyer un message dans son espace');
      if (p_canal === 'telegram' && !client.telegram_chat_id) throw sqlError('P0001', 'Telegram doit être lié au compte client');
      const existing = p_idempotency_key && tables.notification_outbox.find(o => o.idempotency_key === p_idempotency_key);
      if (existing) return { message:clone(byId('messages', existing.message_id)), outbox:clone(existing) };
      const message = { id:newId(), colis_id:c.id, type:'staff', auteur_nom:'Expedîle', texte:p_text, statut: p_canal === 'portal' ? 'envoye' : 'envoi', canal:p_canal,
        template:p_template, request_snapshot:null, created_at:iso() };
      const outbox = { id:newId(), message_id:message.id, client_id:client.id, colis_id:c.id, quote_version:c.quote_version, canal:p_canal, reply_markup:p_reply_markup,
        idempotency_key:p_idempotency_key, status:{ email:'manual', portal:'sent' }[p_canal] || 'pending', attempts:0, available_at:iso(), created_at:iso() };
      tables.messages.push(message); tables.notification_outbox.push(outbox);
      return { message:clone(message), outbox:clone(outbox) };
    },
    record_payplug_cancellation({ p_colis_id, p_provider_id, p_payment }, ctx) {
      serviceOnly(ctx);
      if (p_payment?.is_paid !== false || p_payment?.failure?.code !== 'aborted' || p_payment.id !== p_provider_id) throw sqlError('22023', 'Annulation PayPlug non prouvée');
      const link = [...tables.payment_intents, ...tables.legacy_payplug_payments].find(r => r.colis_id === p_colis_id && r.provider_id === p_provider_id);
      if (!link) throw sqlError('22023', 'Référence de l’annulation incompatible');
      link.provider_cancelled_at ||= iso();
      return { providerId:p_provider_id, cancelledAt:link.provider_cancelled_at };
    },
    withdraw_quote_preflight({ p_colis_id, p_action, p_facture_id = null, p_expected_review_token = null, p_message_id = null }, ctx) {
      serviceOnly(ctx); const c = colisOf(p_colis_id); if (!c) throw sqlError('22023', 'Dossier introuvable.');
      // Invoices are only modelled when a test stores them (ID.invoice stands for a validated invoice otherwise).
      const invoice = p_facture_id ? byId('factures', p_facture_id) : null;
      if (invoice && invoice.colis_id !== c.id) throw sqlError('22023', 'Cette facture n’appartient pas à ce dossier.');
      if (p_action === 'open_modification' && invoice && !invoice.valide) throw sqlError('22023', 'Seule une facture validée et active peut être modifiée.');
      if (p_action === 'open_modification' && w.reviewTokens && p_expected_review_token !== w.reviewTokens[p_facture_id]) throw sqlError('40001', 'La facture ou ses articles ont changé. Rechargez la vérification.');
      if (p_action === 'import_attachment') { const message = byId('messages', p_message_id); if (!message || message.colis_id !== c.id || !message.attachment_path) throw sqlError('22023', 'Ce message ne contient pas de document importable'); }
      return true;
    },
    withdraw_quote_for_documents(args, ctx) {
      staffOnly(ctx); const c = colisOf(args.p_colis_id);
      if (tables.staff_work_actions.some(a => a.colis_id === c.id && ['documents','correction'].includes(a.kind) && a.state !== 'done' && a.assignee_id && a.assignee_id !== ctx.uid))
        throw sqlError('40001', 'Tâche suivie par un collègue.');
      const reason = w.frozenReason(c); if (reason) throw sqlError('22023', FROZEN[reason], `invoices_frozen:${reason}`);
      if (instant(c.updated_at) !== instant(args.p_expected_updated_at)) throw sqlError('40001', 'Le dossier a changé. Actualisez avant de réessayer.');
      let withdrawal = null; let facture = null; let reviewToken = null;
      if (w.quoteLocked(c)) withdrawal = w.withdraw(c, args.p_action === 'import_attachment' ? 'conversation_import' : 'staff', args.p_action,
        args.p_reason || 'Retrait du devis après son envoi', ctx.uid, args.p_facture_id ? [args.p_facture_id] : []);
      if (args.p_action === 'open_modification') { tables.invoice_review_drafts.push({ facture_id:args.p_facture_id }); reviewToken = `review-${++sequence}`; }
      if (args.p_action === 'import_attachment') {
        const message = byId('messages', args.p_message_id);
        if (!message || message.colis_id !== c.id || !message.attachment_path) throw sqlError('22023', 'Pièce jointe introuvable dans ce dossier.');
        facture = tables.factures.find(f => f.colis_id === c.id && f.fichier_url === message.attachment_path)
          || w.insertInvoice(c, { fichier_url:message.attachment_path, fichier_nom:message.attachment_name }, null);
        if (withdrawal && !withdrawal.facture_ids.includes(facture.id)) withdrawal.facture_ids.push(facture.id);
      }
      return { colis:clone(c), changed:Boolean(withdrawal), withdrawal:clone(withdrawal), reviewToken, facture:clone(facture) };
    },
    client_document_precheck({ p_colis_id, p_user_id, p_path, p_sha256 }, ctx) {
      serviceOnly(ctx); const c = colisOf(p_colis_id); const client = c && byId('clients', c.client_id);
      if (!client || client.user_id !== p_user_id) throw sqlError('42501', 'Dossier non autorisé');
      if (!/^[0-9a-f]{64}$/.test(p_sha256)) throw sqlError('22023', 'Empreinte invalide');
      const original = identical(c.id, p_sha256);
      if (original) audit(c.id, 'client_invoice_identical_ignored', { path:p_path, originalId:original.id, sha256:p_sha256 });
      return { identicalTo:original?.id ?? null, quoteSent:['devis_envoye','attente_paiement'].includes(c.statut) };
    },
    deposit_client_invoice({ p_colis_id, p_path, p_file_name, p_vendor = null, p_replaces_facture_id = null }, ctx) {
      const c = colisOf(p_colis_id); const client = c && byId('clients', c.client_id);
      if (ctx.role !== 'authenticated' || !client || client.user_id !== ctx.uid) throw sqlError('42501', 'Dépôt réservé au client du dossier');
      if (!p_path.startsWith(`${c.id}/`) || p_path.includes('..') || !w.storage.factures[p_path]) throw sqlError('22023', 'Document introuvable dans votre dossier.');
      const existing = tables.factures.find(f => f.colis_id === c.id && f.fichier_url === p_path);
      if (existing) return depositStatus(existing);
      if (w.frozenReason(c)) {
        if (!tables.messages.some(m => m.attachment_path === p_path)) tables.messages.push({ id:newId(), colis_id:c.id, type:'client', auteur_id:ctx.uid, canal:'portal',
          template:'client_document', texte:`Document reçu après le paiement : ${p_file_name}`, attachment_path:p_path, attachment_name:p_file_name, created_at:iso() });
        return { status:'frozen', reason:w.frozenReason(c) };
      }
      return depositStatus(w.insertInvoice(c, { vendeur:p_vendor || p_file_name, fichier_url:p_path, fichier_nom:p_file_name, replaces_facture_id:p_replaces_facture_id }, 'portal'));
    },
    register_telegram_document({ p_message_id, p_reply_message_id = null, p_document_sha256 = null }, ctx) {
      serviceOnly(ctx); const message = byId('messages', p_message_id);
      if (!message || message.type !== 'client' || message.canal !== 'telegram' || !message.attachment_path) return { status:'not_invoice' };
      const c = colisOf(message.colis_id); const client = byId('clients', c.client_id); const base = { ref:c.ref, prenom:client.prenom || client.nom };
      const existing = tables.factures.find(f => f.colis_id === c.id && f.fichier_url === message.attachment_path);
      if (existing) return { ...base, status:'registered', factureId:existing.id, withdrawalId:requestOf(existing.id)?.id ?? null };
      if (w.frozenReason(c)) return { ...base, status:'frozen', reason:w.frozenReason(c) };
      const original = identical(c.id, p_document_sha256);
      if (original) { audit(c.id, 'client_invoice_identical_ignored', { originalId:original.id }); return { ...base, status:'identical', originalId:original.id, quoteSent:['devis_envoye','attente_paiement'].includes(c.statut) }; }
      if (w.invoiceRequested(message, p_reply_message_id)) {
        const invoice = w.insertInvoice(c, { fichier_url:message.attachment_path, fichier_nom:message.attachment_name, telegram_event_key:message.telegram_event_key }, 'telegram');
        return { ...base, status:'registered', factureId:invoice.id, withdrawalId:requestOf(invoice.id)?.id ?? null };
      }
      const late = tables.quote_withdrawals.some(r => r.colis_id === c.id && r.source !== 'staff' && !r.closed_at && [...OPEN_REQUEST, 'withdrawn'].includes(r.status));
      return { ...base, status: w.quoteLocked(c) || late ? 'ask_client' : 'not_invoice' };
    },
    register_late_invoice_from_message({ p_message_id, p_chat_id }, ctx) {
      serviceOnly(ctx); const message = byId('messages', p_message_id);
      if (!message || message.type !== 'client' || message.canal !== 'telegram' || !message.attachment_path) throw sqlError('22023', 'Ce document ne peut pas être ajouté comme facture.');
      const c = colisOf(message.colis_id); const client = byId('clients', c.client_id);
      if (client.telegram_chat_id !== p_chat_id) throw sqlError('42501', 'Ce document ne correspond pas à votre compte');
      const base = { ref:c.ref, prenom:client.prenom || client.nom };
      const existing = tables.factures.find(f => f.colis_id === c.id && f.fichier_url === message.attachment_path);
      if (existing) return { ...base, status:'registered', factureId:existing.id, withdrawalId:requestOf(existing.id)?.id ?? null };
      if (w.frozenReason(c)) return { ...base, status:'frozen', reason:w.frozenReason(c) };
      const lateOpen = tables.quote_withdrawals.some(r => r.colis_id === c.id && r.source !== 'staff' && !r.closed_at && [...OPEN_REQUEST, 'withdrawn'].includes(r.status));
      if (!(w.quoteLocked(c) || lateOpen) || c.devis_envoye_le && Date.parse(c.devis_envoye_le) > Date.parse(message.created_at)) return { ...base, status:'stale' };
      const invoice = w.insertInvoice(c, { fichier_url:message.attachment_path, fichier_nom:message.attachment_name, telegram_event_key:message.telegram_event_key }, 'telegram');
      audit(c.id, 'telegram_late_invoice_confirmed', { factureId:invoice.id });
      return { ...base, status:'registered', factureId:invoice.id, withdrawalId:requestOf(invoice.id)?.id ?? null };
    },
    claim_telegram_update({ p_update_id }) {
      const row = tables.telegram_updates.find(u => u.update_id === p_update_id);
      if (row?.status === 'done') return 'done';
      if (row) row.status = 'processing'; else tables.telegram_updates.push({ id:newId(), update_id:p_update_id, status:'processing' });
      return 'claimed';
    },
    resolve_telegram_message_colis({ p_client_id }) { const c = tables.colis.find(row => row.client_id === p_client_id); return c ? { id:c.id, ref:c.ref, statut:c.statut } : null; },
    claim_inbox_assignment({ p_inbox_id }) { const row = byId('client_inbox', p_inbox_id); if (row.status === 'assigned') return { status:'assigned' }; row.status = 'assigning'; return { status:'assigning' }; },
    client_has_open_conversation() { return false; },
  };
  w.callRpc = async (name, args, ctx) => {
    w.calls.push({ name, args:clone(args), role:ctx.role, uid:ctx.uid });
    const failure = w.failRpc[name];
    if (failure) { if (failure.once) delete w.failRpc[name]; return { data:null, error:failure.error }; }
    const fn = w.rpcOverride[name] || w.rpcs[name];
    assert.ok(fn, `Unexpected RPC ${name}`);
    try { return { data:clone(await fn(args, ctx, w)) ?? null, error:null }; }
    catch (error) { if (error.sql) return { data:null, error:error.sql }; throw error; }
  };

  // ---- PostgREST-like table access ----------------------------------------------------------
  w.query = (name, role) => {
    const rows = tables[name] || (tables[name] = []);
    const filters = []; let mode = 'select'; let values; let upsert = {}; let order; let limit = Infinity;
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, neq(k, v) { filters.push(r => r[k] !== v); return q; },
      in(k, list) { filters.push(r => list.includes(r[k])); return q; }, is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      lt(k, v) { filters.push(r => r[k] != null && r[k] < v); return q; }, lte(k, v) { filters.push(r => r[k] != null && r[k] <= v); return q; },
      gt(k, v) { filters.push(r => r[k] != null && r[k] > v); return q; }, gte(k, v) { filters.push(r => r[k] != null && r[k] >= v); return q; },
      not(k, _op, v) { const list = String(v).replace(/[()]/g, '').split(','); filters.push(r => !list.includes(String(r[k]))); return q; },
      order(k, o = {}) { order = { k, asc:o.ascending !== false }; return q; }, limit(n) { limit = n; return q; },
      update(v) { mode = 'update'; values = v; return q; }, insert(v) { mode = 'insert'; values = v; return q; },
      upsert(v, o = {}) { mode = 'upsert'; values = v; upsert = o; return q; }, delete() { mode = 'delete'; return q; },
      single: () => Promise.resolve().then(() => run('single')), maybeSingle: () => Promise.resolve().then(() => run('maybe')),
      then: (yes, no) => Promise.resolve().then(() => run('many')).then(yes, no),
    };
    function shape(list, kind) {
      if (kind === 'single') return list.length === 1 ? { data:clone(list[0]), error:null } : { data:null, error:{ code:'PGRST116', message:'Expected one row' } };
      if (kind === 'maybe') return list.length > 1 ? { data:null, error:{ code:'PGRST116', message:'Expected one row' } } : { data:clone(list[0] ?? null), error:null };
      return { data:clone(list), error:null };
    }
    function run(kind) {
      const refused = w.refuse?.({ table:name, mode, values, role });
      if (refused) return { data:null, error:refused };
      if (mode === 'insert' || mode === 'upsert') {
        const out = [];
        for (const value of [values].flat()) {
          const keys = mode === 'upsert' && upsert.onConflict ? upsert.onConflict.split(',') : null;
          const existing = keys && rows.find(r => keys.every(k => r[k] === value[k]));
          if (existing) { if (!upsert.ignoreDuplicates) { Object.assign(existing, clone(value)); out.push(existing); } continue; }
          const row = { id:newId(), created_at:iso(), ...clone(value) }; rows.push(row); out.push(row);
        }
        w.writes.push({ table:name, mode, values:clone(values) });
        return shape(out, kind);
      }
      let matched = rows.filter(r => filters.every(f => f(r)));
      if (mode === 'update') {
        w.writes.push({ table:name, mode, values:clone(values), ids:matched.map(r => r.id) });
        matched.forEach(r => { Object.assign(r, clone(values)); if (name === 'colis') r.updated_at = stamp(); });
        return shape(matched, kind);
      }
      if (mode === 'delete') { matched.forEach(r => rows.splice(rows.indexOf(r), 1)); return shape(matched, kind); }
      if (order) matched = [...matched].sort((a, b) => (a[order.k] > b[order.k] ? 1 : a[order.k] < b[order.k] ? -1 : 0) * (order.asc ? 1 : -1));
      return shape(matched.slice(0, limit), kind);
    }
    return q;
  };
  w.client = (key, config) => {
    const service = key === w.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!service) assert.equal(key, w.env.SUPABASE_ANON_KEY, 'Only the service or the anonymous key with a user JWT is used');
    const token = service ? null : String(config?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const uid = token ? w.tokens[token]?.id ?? null : null;
    const ctx = { role: service ? 'service_role' : uid ? 'authenticated' : 'anon', uid };
    return {
      auth: { getUser: async t => w.tokens[t] ? { data:{ user:{ id:w.tokens[t].id, email:'user@example.test' } }, error:null } : { data:{ user:null }, error:{ message:'invalid' } } },
      storage: { from: bucket => ({
        list: async (folder, options = {}) => { w.listings = (w.listings || 0) + 1; return { data:Object.entries(w.storage[bucket] || {}).filter(([p]) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/') && (!options.search || p.slice(folder.length + 1).includes(options.search)))
          .map(([p, bytes]) => ({ name:p.slice(folder.length + 1), metadata:{ size:bytes.length } })), error:null }; },
        download: async p => { w.downloads = (w.downloads || 0) + 1; const bytes = w.storage[bucket]?.[p]; return bytes ? { data:new Blob([bytes]), error:null } : { data:null, error:{ message:'Object not found' } }; },
        upload: async (p, bytes) => { (w.storage[bucket] ||= {})[p] = Buffer.from(bytes); return { data:{ path:p }, error:null }; },
      }) },
      from: name => w.query(name, ctx.role),
      rpc: (name, args) => w.callRpc(name, clone(args), ctx),
    };
  };

  // ---- providers ----------------------------------------------------------------------------
  w.fetch = async (url, config = {}) => {
    const method = config.method || 'GET';
    if (url.startsWith('https://api.payplug.com/')) {
      assert.equal(config.headers['PayPlug-Version'], '2019-08-06'); assert.equal(config.headers.Authorization, `Bearer ${w.env.PAYPLUG_SECRET_KEY}`);
      const id = decodeURIComponent(url.split('/').pop()); const call = { id, method, at:clock.now }; w.provider.push(call);
      if (method === 'PATCH') assert.deepEqual(JSON.parse(config.body), { aborted:true });
      const custom = await w.onPayplug?.(call, w); if (custom) return custom;
      const payment = payplug[id]; if (!payment) return new Response('{}', { status:404 });
      if (method === 'PATCH' && !payment.is_paid) payment.failure = { code:'aborted' };
      return Response.json(clone(payment));
    }
    if (url.startsWith('https://api.telegram.org/')) {
      if (url.includes('/file/bot')) { w.telegram.push({ method:'download' }); return new Response(w.telegramFile ?? 'SYNTHETIC PDF'); }
      const method = url.split('/').pop(); const body = config.body ? JSON.parse(config.body) : null; const call = { method, body }; w.telegram.push(call);
      const custom = await w.onTelegram?.(call, w); if (custom) return custom;
      if (method === 'getFile') return Response.json({ ok:true, result:{ file_path:w.telegramFilePath || 'documents/file_7.pdf' } });
      return Response.json({ ok:true, result:{ message_id:700 + w.telegram.length } });
    }
    throw new Error(`Unexpected network request: ${url}`);
  };
  w.sent = () => w.telegram.filter(call => call.method === 'sendMessage');
  w.rpcNames = () => w.calls.map(call => call.name);
  return w;
}

const bundles = new Map();
async function handler(name, w) {
  if (!bundles.has(name)) bundles.set(name, (await esbuild.build({ entryPoints:[path.join(root, name, 'index.ts')], bundle:true, write:false, format:'iife', platform:'browser', logLevel:'silent',
    plugins:[{ name:'mock-supabase', setup(build) {
      build.onResolve({ filter:/^https:\/\/esm.sh\/@supabase\// }, () => ({ path:'supabase', namespace:'mock' }));
      build.onLoad({ filter:/.*/, namespace:'mock' }, () => ({ contents:'export const createClient=(url,key,options)=>globalThis.__client(key,options);', loader:'js' }));
    } }] })).outputFiles[0].text);
  const clock = w.clock;
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  let serve;
  vm.runInNewContext(bundles.get(name), { __client:w.client, Deno:{ env:{ get:key => w.env[key] }, serve:fn => { serve = fn; } }, Request, Response, URL, Blob,
    TextEncoder, Uint8Array, ArrayBuffer, AbortSignal, crypto:webcrypto, fetch:w.fetch, btoa:s => Buffer.from(s, 'binary').toString('base64'),
    console:{ log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Date:FakeDate });
  return serve;
}
async function call(w, name, body, { token, headers = {} } = {}) {
  const serve = await handler(name, w);
  const response = await serve(new Request(`${ENV.SUPABASE_URL}/functions/v1/${name}`, { method:'POST',
    headers:{ 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...headers }, body:JSON.stringify(body) }));
  return { status:response.status, body:await response.json() };
}

module.exports = { ID, ENV, CHAT, UPDATED_AT, clone, sha256, world, handler, call };

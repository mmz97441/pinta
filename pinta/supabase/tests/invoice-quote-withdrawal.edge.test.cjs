const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, UPDATED_AT, world, call } = require('./quote-withdrawal-fixture.cjs');

const request = (w, body = {}, token = 'staff-jwt') => call(w, 'invoice-quote-withdrawal',
  { action:'open_modification', colisId:ID.colis, expectedUpdatedAt:UPDATED_AT, factureId:ID.invoice, expectedReviewToken:'review-0', ...body }, { token });
const businessCalls = w => w.calls.filter(c => ['record_payplug_cancellation','withdraw_quote_for_documents'].includes(c.name));
const colis = w => w.tables.colis.find(c => c.id === ID.colis);
// A client message with a document, as stored by the Telegram webhook.
function attachment(w) {
  const message = { id:w.newId(), colis_id:ID.colis, type:'client', canal:'telegram', texte:'Document reçu pour EXP-LATE01', attachment_path:`${ID.colis}/telegram_9.pdf`,
    attachment_name:'facture.pdf', attachment_type:'application/pdf', telegram_event_key:'telegram:9', created_at:w.iso() };
  w.tables.messages.push(message); return message;
}

test('every permission is checked before PayPlug is contacted', async () => {
  for (const [body, options] of [[{}, { permissions:{ perm_factures_modifier_articles:false } }], [{ action:'add_document' }, { permissions:{ perm_factures_ajouter:false } }],
    [{ action:'import_attachment', messageId:ID.invoice }, { permissions:{ perm_factures_ajouter:false } }], [{ action:'request_correction' }, { permissions:{ perm_factures_refuser:false } }],
    [{ action:'classify_duplicate' }, { permissions:{ perm_factures_valider:false } }], [{ action:'restore_duplicate' }, { permissions:{ perm_factures_valider:false } }], [{}, { role:'client' }]]) {
    const w = world(options); const result = await request(w, body);
    assert.equal(result.status, 403, JSON.stringify(body)); assert.equal(w.provider.length, 0); assert.equal(businessCalls(w).length, 0);
  }
  const anonymous = world(); assert.equal((await request(anonymous, {}, '')).status, 401); assert.equal(anonymous.provider.length, 0);
  // Modifying articles is enough to open a modification or change a purchase; the correction permission is not required.
  for (const action of ['open_modification', 'manual_articles']) {
    const w = world({ permissions:{ perm_factures_ajouter:false, perm_factures_refuser:false, perm_factures_valider:false } });
    assert.equal((await request(w, { action })).status, 200, action);
  }
});

test('a stale dossier is refused before PayPlug, to the microsecond', async () => {
  const w = world(); const result = await request(w, { expectedUpdatedAt:'2026-10-04T07:00:00.123455+00:00' });
  assert.equal(result.status, 409); assert.equal(result.body.code, '40001'); assert.equal(w.provider.length, 0); assert.equal(businessCalls(w).length, 0);
});

test('a payment, a departure or a closed dossier freezes the invoices before any PayPlug key check', async () => {
  for (const [options, reason] of [[{ colis:{ paiement_montant:40 } }, 'payment'], [{ paiements:[{ id:'p', colis_id:ID.colis, statut:'confirme' }] }, 'payment'],
    [{ intents:[{ id:ID.intent, colis_id:ID.colis, quote_version:2, provider_id:'pay_fixture', status:'paid' }] }, 'payment'],
    [{ colis:{ date_expedition:'2026-10-03' } }, 'departure'], [{ colis:{ archive:true } }, 'closed']]) {
    const w = world({ ...options, env:{ PAYPLUG_SECRET_KEY:'' } }); const result = await request(w);
    assert.equal(result.status, 409); assert.equal(result.body.code, '22023'); assert.equal(result.body.hint, `invoices_frozen:${reason}`);
    assert.equal(w.provider.length, 0); assert.equal(businessCalls(w).length, 0);
  }
});

test('a colleague following the documents or correction task stops the withdrawal before and during PayPlug', async () => {
  for (const kind of ['documents', 'correction']) {
    const w = world({ workActions:[{ colis_id:ID.colis, kind, state:'in_progress', assignee_id:ID.colleague }] });
    const result = await request(w); assert.equal(result.status, 409); assert.equal(result.body.code, '40001'); assert.equal(w.provider.length, 0);
  }
  const w = world(); w.onPayplug = (_call, state) => { state.tables.staff_work_actions.push({ colis_id:ID.colis, kind:'documents', state:'in_progress', assignee_id:ID.colleague }); };
  const result = await request(w);
  assert.equal(result.status, 409); assert.equal(result.body.code, '40001'); assert.deepEqual(w.provider.map(p => p.method), ['GET']); assert.equal(businessCalls(w).length, 0);
  assert.equal(colis(w).statut, 'devis_envoye');
});

test('a stale review token, an invoice of another dossier or a bad attachment is refused before PayPlug', async () => {
  const stale = world(); stale.reviewTokens = { [ID.invoice]:'review-current' };
  for (const [w, body, code] of [[stale, {}, '40001'],
    [(() => { const x = world(); x.tables.factures.push({ id:ID.invoice, colis_id:ID.otherColis, valide:true }); return x; })(), {}, '22023'],
    [world(), { action:'import_attachment', messageId:ID.invoice, factureId:undefined, expectedReviewToken:undefined }, '22023']]) {
    const result = await request(w, body);
    assert.equal(result.status, 409); assert.equal(result.body.code, code, JSON.stringify(body)); assert.equal(result.body.paymentLinkCancelled, undefined);
    assert.equal(w.provider.length, 0); assert.equal(businessCalls(w).length, 0);
    assert.equal(colis(w).statut, 'devis_envoye'); assert.equal(colis(w).payplug_payment_url, 'https://secure.payplug.com/fixture');
  }
});

test('a SQL refusal after an earlier attempt attested the link is reported as such, not as a new cancellation', async () => {
  const w = world(); w.tables.payment_intents[0].provider_cancelled_at = w.iso();
  w.rpcOverride.withdraw_quote_for_documents = () => { throw Object.assign(new Error('owner'), { sql:{ code:'42501', message:'Votre rôle ne permet pas de retirer un devis envoyé.', hint:null } }); };
  const result = await request(w);
  assert.equal(result.status, 403); assert.equal(result.body.code, '42501'); assert.equal(result.body.paymentLinkCancelled, undefined); assert.equal(w.provider.length, 0);
});

test('a sent quote without payment link only runs the staff-scoped command', async () => {
  const w = world({ intents:[], colis:{ payplug_payment_id:null, payplug_payment_url:null } });
  const result = await request(w, { action:'manual_articles', factureId:undefined, expectedReviewToken:undefined });
  assert.equal(result.status, 200); assert.equal(result.body.changed, true); assert.equal(result.body.paymentLinkCancelled, false); assert.equal(w.provider.length, 0);
  assert.deepEqual(businessCalls(w).map(c => [c.name, c.role, c.uid]), [['withdraw_quote_for_documents', 'authenticated', ID.staff]]);
  assert.equal(colis(w).statut, 'en_preparation'); assert.equal(w.sent().length, 0, 'D2 sends no client message');
});

test('the link is read, aborted and attested before the command runs with the staff JWT', async () => {
  const w = world(); const result = await request(w);
  assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.changed, true); assert.equal(result.body.paymentLinkCancelled, true);
  assert.equal(result.body.reviewToken, 'review-1'); assert.equal(result.body.colis.statut, 'en_preparation'); assert.equal(result.body.message, undefined);
  assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  assert.deepEqual(businessCalls(w).map(c => [c.name, c.role]), [['record_payplug_cancellation', 'service_role'], ['withdraw_quote_for_documents', 'authenticated']]);
  const args = w.calls.find(c => c.name === 'withdraw_quote_for_documents').args;
  assert.deepEqual(args, { p_colis_id:ID.colis, p_expected_updated_at:UPDATED_AT, p_action:'open_modification', p_reason:null, p_facture_id:ID.invoice, p_expected_review_token:'review-0', p_message_id:null });
  assert.equal(colis(w).quote_version, 3); assert.equal(colis(w).payplug_payment_url, null);
  const row = w.tables.quote_withdrawals[0]; assert.equal(row.source, 'staff'); assert.equal(row.status, 'withdrawn'); assert.equal(row.link_cancelled, true);
  assert.equal(row.client_message_status, 'not_required'); assert.equal(w.sent().length, 0);
});

test('an unconfirmed abort writes nothing; the retry reads first and attests without a second PATCH', async () => {
  const w = world(); let timeout = true;
  w.onPayplug = call => { if (call.method === 'PATCH' && timeout) { timeout = false; w.payplug.pay_fixture.failure = { code:'aborted' }; throw new Error('response timeout'); } };
  const first = await request(w);
  assert.equal(first.status, 502); assert.equal(first.body.code, 'payplug_uncertain'); assert.match(first.body.error, /pas confirmé l’annulation/);
  assert.equal(businessCalls(w).length, 0); assert.equal(colis(w).statut, 'devis_envoye'); assert.equal(colis(w).payplug_payment_url, 'https://secure.payplug.com/fixture');
  const second = await request(w);
  assert.equal(second.status, 200); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH', 'GET']);
  assert.equal(w.calls.filter(c => c.name === 'record_payplug_cancellation').length, 1);
});

test('a paid or refunded link is never aborted and the quote is kept', async () => {
  for (const change of [{ is_paid:true }, { amount_refunded:100 }]) {
    const w = world(); Object.assign(w.payplug.pay_fixture, change);
    const result = await request(w);
    assert.equal(result.status, 409); assert.equal(result.body.code, 'payplug_paid'); assert.equal(result.body.paymentLinkCancelled, undefined);
    assert.deepEqual(w.provider.map(p => p.method), ['GET']); assert.equal(businessCalls(w).length, 0); assert.equal(colis(w).devis_total, 40);
  }
});

test('mismatches, unknown references, a missing key and a link being created are refused without a PATCH', async () => {
  for (const metadata of [{ amount:4001 }, { currency:'USD' }, { is_live:true }, { metadata:{ colis_id:ID.colis, intent_id:'other', quote_version:'2' } },
    { metadata:{ colis_id:ID.colis, intent_id:ID.intent, quote_version:'1' } }, { metadata:{ colis_id:ID.otherColis, intent_id:ID.intent, quote_version:'2' } }]) {
    const w = world(); Object.assign(w.payplug.pay_fixture, metadata);
    const result = await request(w); assert.equal(result.status, 409); assert.equal(result.body.code, 'payplug_mismatch', JSON.stringify(metadata));
    assert.deepEqual(w.provider.map(p => p.method), ['GET']); assert.equal(businessCalls(w).length, 0);
  }
  const creating = world({ intents:[{ id:ID.intent, colis_id:ID.colis, quote_version:2, status:'creating', provider_id:null }] });
  const busy = await request(creating);
  assert.equal(busy.status, 409); assert.equal(busy.body.code, '40001'); assert.equal(busy.body.hint, 'payment_link_creating'); assert.equal(creating.provider.length, 0);
  const unknown = world({ colis:{ payplug_payment_id:'pay_unknown' } }); const orphan = await request(unknown);
  assert.equal(orphan.status, 409); assert.equal(orphan.body.code, 'payplug_unknown_link'); assert.equal(unknown.provider.length, 0);
  const unconfigured = world({ env:{ PAYPLUG_SECRET_KEY:'' } }); const config = await request(unconfigured);
  assert.equal(config.status, 503); assert.equal(config.body.code, 'payplug_config'); assert.equal(unconfigured.provider.length, 0); assert.equal(businessCalls(unconfigured).length, 0);
});

test('a SQL conflict after the abort clears only the cancelled URL and says the withdrawal is not saved', async () => {
  for (const replacement of [false, true]) {
    const w = world();
    w.rpcOverride.withdraw_quote_for_documents = (_args, _ctx, state) => {
      Object.assign(state.tables.colis[0], { updated_at:'2026-10-04T07:05:00.000001+00:00', ...(replacement ? { payplug_payment_id:'pay_new', payplug_payment_url:'https://secure.payplug.com/new' } : {}) });
      throw Object.assign(new Error('changed'), { sql:{ code:'40001', message:'Le dossier a changé. Actualisez avant de réessayer.', hint:null } });
    };
    const result = await request(w);
    assert.equal(result.status, 409); assert.equal(result.body.code, '40001'); assert.equal(result.body.paymentLinkCancelled, true); assert.equal(result.body.withdrawalSaved, false);
    assert.match(result.body.error, /annulé, mais le retrait du devis n’est pas enregistré/);
    assert.equal(colis(w).payplug_payment_url, replacement ? 'https://secure.payplug.com/new' : null);
    assert.deepEqual(w.writes.filter(x => x.table === 'colis').map(x => x.values), [{ payplug_payment_url:null }]);
  }
});

test('a conversation import withdraws the quote, adds the invoice and tells the client once', async () => {
  const w = world(); const message = attachment(w);
  const result = await request(w, { action:'import_attachment', messageId:message.id, factureId:undefined, expectedReviewToken:undefined });
  assert.equal(result.status, 200); assert.equal(result.body.changed, true); assert.ok(result.body.facture?.id);
  assert.deepEqual(result.body.message, { canal:'telegram', status:'sent' });
  const row = w.tables.quote_withdrawals[0]; assert.equal(row.source, 'conversation_import'); assert.equal(row.client_message_status, 'sent');
  assert.deepEqual(row.facture_ids, [result.body.facture.id]);
  const queued = w.calls.filter(c => c.name === 'queue_message');
  assert.equal(queued.length, 1); assert.equal(queued[0].role, 'service_role'); assert.equal(queued[0].args.p_idempotency_key, `late-invoice:${ID.colis}:2`);
  assert.equal(queued[0].args.p_template, 'facture_apres_devis'); assert.equal(queued[0].args.p_canal, 'telegram');
  assert.equal(w.sent().length, 1); assert.match(w.sent()[0].body.text, /^Bonjour Flavie 👋[\s\S]*EXP-LATE01[\s\S]*L’ancien lien de paiement n’est plus valable/);
  assert.doesNotMatch(w.sent()[0].body.text, /[*_]/);
  // Importing it again finds the quote already withdrawn: no second withdrawal and no second message.
  const again = await request(w, { action:'import_attachment', messageId:message.id, factureId:undefined, expectedReviewToken:undefined, expectedUpdatedAt:colis(w).updated_at });
  assert.equal(again.status, 200); assert.equal(again.body.changed, false); assert.equal(again.body.facture.id, result.body.facture.id);
  assert.equal(w.sent().length, 1); assert.equal(w.tables.quote_withdrawals.length, 1);
});

test('a quote sent without a link uses the no-link message, and the email channel stays a manual draft', async () => {
  const w = world({ intents:[], colis:{ payplug_payment_id:null, payplug_payment_url:null }, client:{ telegram_chat_id:null, user_id:null } }); const message = attachment(w);
  const result = await request(w, { action:'import_attachment', messageId:message.id, factureId:undefined, expectedReviewToken:undefined });
  assert.equal(result.status, 200); assert.deepEqual(result.body.message, { canal:'email', status:'manual' });
  const queued = w.calls.find(c => c.name === 'queue_message').args;
  assert.equal(queued.p_template, 'facture_apres_devis_sans_lien'); assert.equal(queued.p_canal, 'email');
  assert.match(queued.p_text, /^Bonjour Flavie,[\s\S]*Cordialement,\nL’équipe Expedîle$/); assert.doesNotMatch(queued.p_text, /lien/);
  assert.equal(w.sent().length, 0); assert.equal(w.tables.notification_outbox[0].status, 'manual');
});

test('an unknown template variable fails the message visibly and keeps the withdrawal', async () => {
  const w = world({ templates:[{ key:'facture_apres_devis', canal:'telegram', body:'Bonjour {{prenom}}, {{variable_inconnue}}' }] }); const message = attachment(w);
  const result = await request(w, { action:'import_attachment', messageId:message.id, factureId:undefined, expectedReviewToken:undefined });
  assert.equal(result.status, 200); assert.equal(result.body.changed, true); assert.deepEqual(result.body.message, { canal:'telegram', status:'failed' });
  const row = w.tables.quote_withdrawals[0]; assert.equal(row.status, 'withdrawn'); assert.equal(row.client_message_status, 'failed');
  assert.match(row.last_error, /Modèle de message invalide : Variable de message inconnue : variable_inconnue/);
  assert.equal(w.calls.some(c => c.name === 'queue_message'), false); assert.equal(w.sent().length, 0);
});

test('an open client request is absorbed by a staff withdrawal and the client is told', async () => {
  const w = world(); w.insertInvoice(w.tables.colis[0], { fichier_url:`${ID.colis}/portal.pdf` }, 'portal');  // as a portal deposit does
  assert.equal(w.tables.quote_withdrawals[0].status, 'pending');
  const result = await request(w);
  assert.equal(result.status, 200); assert.deepEqual(result.body.message, { canal:'telegram', status:'sent' });
  const [client, staff] = w.tables.quote_withdrawals;
  assert.equal(client.status, 'withdrawn'); assert.equal(client.client_message_status, 'sent'); assert.equal(staff.client_message_status, 'not_required');
  assert.equal(w.sent().length, 1);
});

test('retry re-arms a request left for review and starts with a PayPlug read', async () => {
  const w = world(); w.insertInvoice(w.tables.colis[0], { fichier_url:`${ID.colis}/portal.pdf` }, 'portal');
  Object.assign(w.tables.quote_withdrawals[0], { status:'needs_review', attempts:6, last_error:'PayPlug ne répond pas' });
  const result = await call(w, 'invoice-quote-withdrawal', { action:'retry', colisId:ID.colis, withdrawalId:w.tables.quote_withdrawals[0].id }, { token:'staff-jwt' });
  assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.withdrawal.status, 'withdrawn'); assert.equal(result.body.withdrawal.linkCancelled, true);
  assert.deepEqual(result.body.withdrawal.message, { canal:'telegram', status:'sent' });
  assert.equal(w.calls.find(c => c.name === 'claim_quote_withdrawal').args.p_rearm, true); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  const elsewhere = await call(w, 'invoice-quote-withdrawal', { action:'retry', colisId:ID.otherColis, withdrawalId:w.tables.quote_withdrawals[0].id }, { token:'staff-jwt' });
  assert.equal(elsewhere.status, 404);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, ENV, CHAT, world, call, sha256 } = require('./quote-withdrawal-fixture.cjs');

const secret = { 'X-Telegram-Bot-Api-Secret-Token':ENV.TELEGRAM_WEBHOOK_SECRET };
const send = (w, update) => call(w, 'telegram-webhook', update, { headers:secret });
const documentUpdate = (w, updateId = 1001, extra = {}) => ({ update_id:updateId, message:{ message_id:123, date:Math.floor(w.clock.now / 1000), chat:{ id:CHAT, type:'private' }, from:{ id:CHAT },
  caption:'Ma facture', document:{ file_id:'file-1', file_size:13, file_name:'facture.pdf' }, ...extra } });
const press = (updateId, data, chat = CHAT) => ({ update_id:updateId, callback_query:{ id:`cb-${updateId}`, data, from:{ id:chat }, message:{ message_id:555, chat:{ id:chat, type:'private' } } } });
const replies = w => w.sent().map(call => call.body);
const saved = w => w.tables.messages.find(m => m.telegram_event_key === 'telegram:1001');

test('a received document is hashed on the bytes stored and registered with its reply context', async () => {
  const w = world({ intents:[], colis:{ statut:'en_preparation', devis_total:null, payplug_payment_id:null, payplug_payment_url:null } });
  assert.equal((await send(w, documentUpdate(w))).status, 200);
  const registered = w.calls.find(c => c.name === 'register_telegram_document');
  assert.deepEqual(registered.args, { p_message_id:saved(w).id, p_reply_message_id:null, p_document_sha256:await sha256('SYNTHETIC PDF') });
  assert.equal(registered.role, 'service_role'); assert.ok(w.storage.factures[`${ID.colis}/telegram_1001.pdf`]);
  assert.match(replies(w)[0].text, /^Bonjour Flavie, votre document est enregistré pour EXP-LATE01/, 'An ordinary document keeps the usual acknowledgement');
  const reply = world(); await send(reply, documentUpdate(reply, 1002, { reply_to_message:{ message_id:90 } }));
  assert.equal(reply.calls.find(c => c.name === 'register_telegram_document').args.p_reply_message_id, '90');
});

test('a requested invoice on a sent quote is processed at once: the delivered D3 message replaces the acknowledgement', async () => {
  const w = world(); w.invoiceRequested = () => true;
  const result = await send(w, documentUpdate(w));
  assert.equal(result.status, 200); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  assert.equal(w.tables.colis[0].statut, 'en_preparation'); assert.equal(w.tables.factures[0].telegram_event_key, 'telegram:1001');
  assert.equal(replies(w).length, 1, 'Only the D3 message, no generic acknowledgement');
  assert.match(replies(w)[0].text, /^Bonjour Flavie 👋\n\nVotre facture pour le dossier EXP-LATE01 est bien reçue/);
  assert.equal(w.tables.quote_withdrawals[0].client_message_status, 'sent'); assert.equal(w.tables.telegram_updates[0].status, 'done');
});

test('when PayPlug cannot confirm, the client is asked to wait before paying', async () => {
  const w = world(); w.invoiceRequested = () => true; w.onPayplug = () => { throw new Error('timeout'); };
  assert.equal((await send(w, documentUpdate(w))).status, 200);
  assert.equal(w.tables.quote_withdrawals[0].status, 'pending'); assert.equal(w.tables.colis[0].statut, 'devis_envoye');
  assert.deepEqual(replies(w).map(r => r.text), ['Bonjour Flavie, votre facture pour EXP-LATE01 est bien reçue, merci ! Notre équipe met à jour votre devis avec cet achat. Merci d’attendre notre prochain message avant tout paiement : nous revenons vers vous très vite.\n\nL’équipe Expedîle']);
});

test('an identical copy of a validated invoice changes nothing and is acknowledged as such', async () => {
  const w = world(); w.invoiceRequested = () => true;
  w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:true, fichier_url:`${ID.colis}/validated.pdf`, __sha:await sha256('SYNTHETIC PDF') });
  await send(w, documentUpdate(w));
  assert.equal(w.tables.factures.length, 1); assert.equal(w.provider.length, 0); assert.equal(w.tables.quote_withdrawals.length, 0);
  assert.deepEqual(replies(w).map(r => r.text), ['Bonjour Flavie, nous avions déjà ce document pour EXP-LATE01 : rien ne change pour votre devis. Merci !\n\nL’équipe Expedîle']);
});

test('an identical copy before any quote never mentions a quote (R2-03)', async () => {
  const w = world(); w.invoiceRequested = () => true; w.tables.colis[0].statut = 'en_preparation';
  w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:true, fichier_url:`${ID.colis}/validated.pdf`, __sha:await sha256('SYNTHETIC PDF') });
  await send(w, documentUpdate(w));
  assert.deepEqual(replies(w).map(r => r.text), ['Bonjour Flavie, nous avions déjà ce document dans votre dossier EXP-LATE01, merci ! Notre équipe poursuit la préparation.\n\nL’équipe Expedîle']);
});

test('another document on a sent quote asks the client with two short buttons', async () => {
  const w = world(); await send(w, documentUpdate(w));
  assert.equal(w.tables.factures.length, 0); assert.equal(w.provider.length, 0);
  const [question] = replies(w); const messageId = saved(w).id;
  assert.equal(question.text, 'Bonjour Flavie, votre document pour EXP-LATE01 est bien reçu. S’agit-il d’une facture d’achat à ajouter à ce dossier ? Si oui, votre devis sera mis à jour avec cet achat et nous vous enverrons le nouveau devis.\n\nL’équipe Expedîle');
  assert.deepEqual(question.reply_markup, { inline_keyboard:[[{ text:'Oui, c’est une facture d’achat', callback_data:`lf_oui_${messageId}` }], [{ text:'Non, autre document', callback_data:`lf_non_${messageId}` }]] });
  for (const [button] of question.reply_markup.inline_keyboard) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});

test('« Oui » registers the late invoice and runs D3; « Non » keeps the document in the conversation', async () => {
  const w = world(); await send(w, documentUpdate(w)); const messageId = saved(w).id;
  assert.equal((await send(w, press(2001, `lf_non_${messageId}`))).status, 200);
  assert.equal(replies(w).at(-1).text, 'C’est noté, merci ! Votre document reste dans le dossier EXP-LATE01 et notre équipe le consulte.\n\nL’équipe Expedîle');
  assert.equal(w.calls.some(c => c.name === 'register_late_invoice_from_message'), false); assert.equal(w.tables.factures.length, 0);
  assert.equal((await send(w, press(2002, `lf_oui_${messageId}`))).status, 200);
  assert.deepEqual(w.calls.find(c => c.name === 'register_late_invoice_from_message').args, { p_message_id:messageId, p_chat_id:String(CHAT) });
  assert.equal(w.tables.factures.length, 1); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  assert.equal(replies(w).length, 3, 'question, « Non » acknowledgement, then only the D3 message');
  assert.match(replies(w).at(-1).text, /L’ancien lien de paiement n’est plus valable/);
  assert.equal(w.telegram.filter(c => c.method === 'answerCallbackQuery').length, 2);
  // Pressing « Oui » again is idempotent: no second invoice, withdrawal or message.
  await send(w, press(2003, `lf_oui_${messageId}`));
  assert.equal(w.tables.factures.length, 1); assert.equal(w.tables.quote_withdrawals.length, 1); assert.equal(replies(w).length, 3);
});

test('« Oui » on a paid dossier keeps the document, and buttons from another account change nothing', async () => {
  const w = world(); await send(w, documentUpdate(w)); const messageId = saved(w).id;
  let updateId = 3000;
  for (const chat of [5151, 7777]) {
    for (const answer of ['oui', 'non']) {
      const before = replies(w).length; await send(w, press(++updateId, `lf_${answer}_${messageId}`, chat));
      assert.equal(replies(w).length, before + 1); assert.equal(replies(w).at(-1).chat_id, chat);
      assert.equal(replies(w).at(-1).text.replace(/\.$/, ''), 'Ce document ne correspond pas à votre compte', `${answer} from ${chat}`);
    }
  }
  assert.equal(w.tables.factures.length, 0); assert.equal(w.calls.filter(c => c.name === 'register_late_invoice_from_message').length, 1, 'Only the linked account of another client reaches the command');
  w.tables.colis[0].paiement_montant = 40;
  await send(w, press(4001, `lf_oui_${messageId}`));
  assert.equal(replies(w).at(-1).text, 'Votre paiement pour EXP-LATE01 est déjà enregistré : nous conservons ce document et notre équipe revient vers vous si nécessaire.\n\nL’équipe Expedîle');
  // A departure or a closed dossier never says « paiement ».
  Object.assign(w.tables.colis[0], { paiement_montant:null, date_expedition:'2026-10-04' });
  await send(w, press(4002, `lf_oui_${messageId}`));
  assert.equal(replies(w).at(-1).text, 'Votre colis EXP-LATE01 est déjà parti : nous conservons ce document et notre équipe revient vers vous si nécessaire.\n\nL’équipe Expedîle');
  Object.assign(w.tables.colis[0], { date_expedition:null, archive:true });
  await send(w, press(4003, `lf_oui_${messageId}`));
  assert.equal(replies(w).at(-1).text, 'Votre dossier EXP-LATE01 est clôturé : nous conservons ce document et notre équipe revient vers vous si nécessaire.\n\nL’équipe Expedîle');
  assert.equal(w.tables.factures.length, 0); assert.equal(w.provider.length, 0);
});

test('a stale « Oui » (newer quote sent, or no quote left to update) registers nothing and withdraws nothing', async () => {
  const w = world(); await send(w, documentUpdate(w)); const messageId = saved(w).id;
  // A newer quote was sent after the document arrived.
  w.advance(60000); w.tables.colis[0].devis_envoye_le = w.iso();
  await send(w, press(5001, `lf_oui_${messageId}`));
  assert.equal(replies(w).at(-1).text, 'Merci ! Votre document reste dans le dossier EXP-LATE01 et notre équipe le consulte. Elle revient vers vous si nécessaire.\n\nL’équipe Expedîle');
  assert.equal(w.tables.factures.length, 0); assert.equal(w.tables.quote_withdrawals.length, 0); assert.equal(w.provider.length, 0);
  // The quote is no longer locked (withdrawn by the team meanwhile).
  const unlocked = world(); await send(unlocked, documentUpdate(unlocked)); const id = saved(unlocked).id;
  Object.assign(unlocked.tables.colis[0], { statut:'en_preparation', payplug_payment_id:null, payplug_payment_url:null }); unlocked.tables.payment_intents.length = 0;
  await send(unlocked, press(5002, `lf_oui_${id}`));
  assert.match(replies(unlocked).at(-1).text, /notre équipe le consulte/); assert.equal(unlocked.tables.factures.length, 0);
});

test('a staff inbox assignment returns what became of the document without prompting the client', async () => {
  const w = world({ permissions:{ perm_comm_telegram:true } });
  const inbox = { id:w.newId(), client_id:ID.client, status:'unassigned', texte:'Document reçu', telegram_update_id:1500, payload:documentUpdate(w, 1500).message };
  w.tables.client_inbox.push(inbox);
  const result = await call(w, 'telegram-inbox-assign', { inboxId:inbox.id, colisId:ID.colis }, { token:'staff-jwt' });
  assert.equal(result.status, 200); assert.equal(result.body.success, true); assert.equal(result.body.colisId, ID.colis);
  assert.equal(result.body.document.status, 'ask_client'); assert.equal(result.body.document.ref, 'EXP-LATE01');
  assert.equal(replies(w).length, 0); assert.equal(w.tables.client_inbox[0].status, 'assigned');
});

test('a webhook retry after a failure registers once, and a duplicate update has no side effect', async () => {
  const w = world(); w.invoiceRequested = () => true;
  w.failRpc.register_telegram_document = { once:true, error:{ code:'57014', message:'canceling statement due to statement timeout' } };
  const failed = await send(w, documentUpdate(w));
  assert.equal(failed.status, 500); assert.equal(w.tables.telegram_updates[0].status, 'failed'); assert.equal(replies(w).length, 0); assert.equal(w.tables.messages.length, 1);
  assert.equal((await send(w, documentUpdate(w))).status, 200);
  assert.equal(w.tables.factures.length, 1); assert.equal(w.tables.messages.filter(m => m.type === 'client').length, 1); assert.equal(replies(w).length, 1);
  const calls = w.calls.length; const duplicate = await send(w, documentUpdate(w));
  assert.deepEqual(duplicate.body, { ok:true, duplicate:true }); assert.equal(w.calls.length, calls + 1); assert.equal(replies(w).length, 1);
});

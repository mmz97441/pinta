// Confirmation of a choice made with the Telegram buttons of a preparation request (lot 3b, 2026-10-06): the real
// bundled telegram-webhook against the in-memory model of quote-withdrawal-fixture.cjs. No network, no real message.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, ENV, CHAT, clone, world, call } = require('./quote-withdrawal-fixture.cjs');

const secret = { 'X-Telegram-Bot-Api-Secret-Token':ENV.TELEGRAM_WEBHOOK_SECRET };
const send = (w, update) => call(w, 'telegram-webhook', update, { headers:secret });
const press = (updateId, data, chat = CHAT) => ({ update_id:updateId, callback_query:{ id:`cb-${updateId}`, data, from:{ id:chat }, message:{ message_id:555, chat:{ id:chat, type:'private' } } } });
const oui = (updateId = 9001) => press(updateId, `fv_oui_${ID.colis}`);
const replies = w => w.sent().map(item => item.body);
const sqlError = (code, message) => Object.assign(new Error(message), { sql:{ code, message, hint:null } });
const FRIENDLY = 'Votre réponse n’a pas pu être enregistrée. Réessayez depuis votre espace client ou écrivez-nous ici.';
let defaults;
async function bodies() { return defaults ||= (await import('../../src/expedile/services/messageDefaults.js')).DEFAULT_BODIES; }
const rendered = (body, prenom = 'Flavie') => body.replace('{{prenom}}', prenom).replace('{{ref}}', 'EXP-LATE01');

// A dossier awaiting the client's answer, nothing quoted; telegram_client_decision modelled on its SQL contract.
function awaiting(options = {}) {
  const w = world({ intents:[], ...options, colis:{ statut:'attente_feu_vert', feu_vert:'en_attente', devis_total:null, devis_snapshot:null, devis_brouillon:true,
    quote_version:0, payplug_payment_id:null, payplug_payment_url:null, consent_request_version:2, ...options.colis } });
  w.decisions = [];
  w.rpcOverride.telegram_client_decision = ({ p_colis_id, p_action, p_chat_id, p_message_id }, ctx) => {
    assert.equal(ctx.role, 'service_role'); w.decisions.push({ p_colis_id, p_action, p_chat_id, p_message_id });
    const c = w.tables.colis.find(row => row.id === p_colis_id); const client = c && w.tables.clients.find(row => row.id === c.client_id);
    if (!c || client.telegram_chat_id !== p_chat_id) throw sqlError('P0001', 'Ce dossier ne correspond pas à votre compte');
    if (c.statut !== 'attente_feu_vert') throw sqlError('P0001', 'Cette demande ne peut plus être modifiée');
    if (p_action === 'approve') Object.assign(c, { statut:'autorise', feu_vert:'autorise', feu_vert_date:w.iso(), attente_client_date:null });
    else if (p_action === 'wait') Object.assign(c, { attente_client_date:w.iso(), attente_client_motif:'Attend d’autres colis' });
    else Object.assign(c, { statut:'refuse_client', feu_vert:'refuse' });
    c.updated_at = w.stamp();
    return clone(c);
  };
  // The reply is queued only once the update is marked done: a failure can never replay the decision.
  w.rpcOverride.queue_message = (args, ctx) => {
    assert.equal(w.tables.telegram_updates.find(row => row.status === 'processing'), undefined, 'The update is done before the confirmation is queued');
    return w.rpcs.queue_message(args, ctx);
  };
  return w;
}
const confirmation = w => w.tables.messages.filter(message => message.type === 'staff');
const queued = w => w.calls.filter(item => item.name === 'queue_message');

test('« Oui » while the purchase invoice is missing: the stored confirmation asks for it, by first name, through the outbox', async () => {
  const w = awaiting(); const DEFAULT = await bodies();
  const result = await send(w, oui());
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok:true });
  assert.deepEqual(w.decisions, [{ p_colis_id:ID.colis, p_action:'approve', p_chat_id:String(CHAT), p_message_id:'555' }]);
  assert.deepEqual(queued(w).map(item => ({ ...item.args, p_text:undefined })), [{ p_colis_id:ID.colis, p_text:undefined, p_template:'feu_vert_recu_facture',
    p_idempotency_key:`consent-reply:${ID.colis}:2:approve`, p_canal:'telegram' }]);
  assert.equal(queued(w)[0].role, 'service_role');
  const text = rendered(DEFAULT.feu_vert_recu_facture_telegram);
  assert.match(text, /^Bonjour Flavie 👋\n\nMerci, votre accord pour EXP-LATE01 est bien enregistré ✅/);
  assert.match(text, /Il nous manque encore votre facture d’achat/);
  assert.deepEqual(replies(w), [{ chat_id:String(CHAT), text }], 'One plain-text confirmation, no Markdown mode, no second message');
  const [stored] = confirmation(w);
  assert.equal(confirmation(w).length, 1);
  assert.deepEqual({ template:stored.template, auteur:stored.auteur_nom, statut:stored.statut, canal:stored.canal, texte:stored.texte },
    { template:'feu_vert_recu_facture', auteur:'Expedîle', statut:'envoye', canal:'telegram', texte:text });
  assert.ok(/^\d+$/.test(stored.telegram_msg_id), 'The Telegram message id is stored, so a reply resolves to the dossier');
  assert.equal(w.tables.notification_outbox[0].status, 'sent');
  assert.deepEqual(w.telegram.filter(item => item.method === 'answerCallbackQuery').map(item => item.body), [{ callback_query_id:'cb-9001', text:'Réponse traitée' }]);
  assert.equal(w.tables.telegram_updates[0].status, 'done');
  // The client answers the confirmation with the invoice: the reply context reaches the registration.
  w.invoiceRequested = (message, replyId) => replyId === stored.telegram_msg_id;
  await send(w, { update_id:9002, message:{ message_id:124, date:Math.floor(w.clock.now / 1000), chat:{ id:CHAT, type:'private' }, from:{ id:CHAT },
    reply_to_message:{ message_id:Number(stored.telegram_msg_id) }, document:{ file_id:'file-1', file_size:13, file_name:'facture.pdf' } } });
  assert.equal(w.calls.find(item => item.name === 'register_telegram_document').args.p_reply_message_id, stored.telegram_msg_id);
  assert.equal(w.tables.factures.length, 1, 'The document answering the confirmation is the requested invoice');
});

test('« Oui » without a requested invoice, or for a professional client: the plain confirmation', async () => {
  const DEFAULT = await bodies();
  const scenarios = [
    ['a validated invoice', w => w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:true, rejet_motif:null, duplicate_of_facture_id:null, replaces_facture_id:null })],
    ['an invoice received and still to verify', w => w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:false, rejet_motif:null, duplicate_of_facture_id:null, replaces_facture_id:null })],
    ['a rejected invoice replaced by its correction', w => w.tables.factures.push({ id:'41000000-0000-4000-8000-000000000001', colis_id:ID.colis, valide:false, rejet_motif:'Illisible' },
      { id:'41000000-0000-4000-8000-000000000002', colis_id:ID.colis, valide:false, rejet_motif:null, replaces_facture_id:'41000000-0000-4000-8000-000000000001' })],
    ['a professional client without invoice', w => Object.assign(w.tables.clients[0], { type:'pro' })],
  ];
  for (const [label, prepare] of scenarios) {
    const w = awaiting(); prepare(w);
    assert.equal((await send(w, oui())).status, 200, label);
    assert.equal(queued(w)[0].args.p_template, 'feu_vert_recu', label);
    assert.deepEqual(replies(w).map(item => item.text), [rendered(DEFAULT.feu_vert_recu_telegram)], label);
    assert.doesNotMatch(replies(w)[0].text, /facture/, `${label}: no invoice line`);
  }
  // A rejected invoice is still requested (the correction is awaited).
  const w = awaiting(); w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:false, rejet_motif:'Page manquante' });
  await send(w, oui());
  assert.equal(queued(w)[0].args.p_template, 'feu_vert_recu_facture');
});

test('« Attendre » and « Non » confirm the recorded choice with their own templates', async () => {
  const DEFAULT = await bodies();
  for (const [button, action, template] of [['wait', 'wait', 'choix_attente_recu'], ['non', 'refuse', 'refus_recu']]) {
    const w = awaiting();
    assert.equal((await send(w, press(9100, `fv_${button}_${ID.colis}`))).status, 200);
    assert.equal(w.decisions[0].p_action, action);
    assert.deepEqual(queued(w).map(item => [item.args.p_template, item.args.p_idempotency_key]), [[template, `consent-reply:${ID.colis}:2:${action}`]]);
    assert.deepEqual(replies(w).map(item => item.text), [rendered(DEFAULT[`${template}_telegram`])]);
    assert.match(replies(w)[0].text, /^Bonjour Flavie 👋\n\n[\s\S]+\n\nL’équipe Expedîle$/u);
    assert.equal(confirmation(w)[0].template, template);
  }
});

test('a saved template wins over the default and is sent as saved', async () => {
  const saved = 'Bonjour {{prenom}},\n\nAccord bien noté pour {{ref}}. Pensez à nous envoyer votre facture d’achat.\n\nL’équipe Expedîle';
  const w = awaiting({ templates:[{ key:'feu_vert_recu_facture', canal:'telegram', body:saved }, { key:'feu_vert_recu_facture', canal:'email', body:'Ignoré {{prenom}}' }] });
  await send(w, oui());
  assert.deepEqual(replies(w).map(item => item.text), [rendered(saved)]);
  assert.equal(confirmation(w)[0].texte, rendered(saved));
});

test('a render error is recorded and replaced by nothing; the decision is never replayed', async () => {
  const w = awaiting({ templates:[{ key:'feu_vert_recu_facture', canal:'telegram', body:'Bonjour {{prenom}}, {{variable_inconnue}}' }] });
  const result = await send(w, oui());
  assert.equal(result.status, 200); assert.equal(w.tables.telegram_updates[0].status, 'done');
  assert.equal(queued(w).length, 0, 'No other text is queued in place of the saved template');
  assert.deepEqual(replies(w), [], 'No message reaches the client');
  assert.equal(w.telegram.filter(item => item.method === 'answerCallbackQuery').length, 1, 'The button is still acknowledged');
  const [failure] = w.tables.audit_actions.filter(row => row.action === 'consent_reply_failed');
  assert.equal(failure.colis_id, ID.colis); assert.match(failure.detail, /feu_vert_recu_facture.*Variable de message inconnue : variable_inconnue/);
  assert.deepEqual(await send(w, oui()), { status:200, body:{ ok:true, duplicate:true } });
  assert.equal(w.decisions.length, 1, 'The same update is not processed twice');
});

test('a Telegram send failure stays failed on the stored message: no throw, no resend, no replayed decision', async () => {
  const w = awaiting(); let attempts = 0;
  w.onTelegram = item => item.method === 'sendMessage' ? (attempts++, new Response('{"ok":false}', { status:502 })) : undefined;
  const result = await send(w, oui());
  assert.equal(result.status, 200); assert.equal(w.tables.telegram_updates[0].status, 'done');
  assert.equal(attempts, 1, 'A single provider attempt');
  assert.equal(w.tables.notification_outbox[0].status, 'failed'); assert.equal(confirmation(w)[0].statut, 'echec');
  assert.equal(w.tables.audit_actions.some(row => row.action === 'consent_reply_failed'), false, 'The stored message itself shows the failure');
  assert.deepEqual((await send(w, oui())).body, { ok:true, duplicate:true });
  assert.equal(attempts, 1); assert.equal(w.decisions.length, 1);
});

test('a refused queue is recorded for the team and the update stays done', async () => {
  const w = awaiting(); w.failRpc.queue_message = { error:{ code:'P0001', message:'Telegram doit être lié au compte client' } };
  assert.equal((await send(w, oui())).status, 200);
  assert.equal(w.tables.telegram_updates[0].status, 'done'); assert.deepEqual(replies(w), []);
  assert.match(w.tables.audit_actions.find(row => row.action === 'consent_reply_failed').detail, /Telegram doit être lié au compte client/);
});

test('an unavailable button acknowledgement does not stop the confirmation', async () => {
  const w = awaiting(); w.onTelegram = item => item.method === 'answerCallbackQuery' ? new Response('{"ok":false}', { status:500 }) : undefined;
  assert.equal((await send(w, oui())).status, 200);
  assert.equal(replies(w).length, 1); assert.equal(w.tables.notification_outbox[0].status, 'sent');
});

test('the client sees the business refusals of the decision commands, never a technical error', async () => {
  const cases = [
    [{ code:'P0001', message:'Cette demande ne peut plus être modifiée' }, 'Cette demande ne peut plus être modifiée'],
    [{ code:'40001', message:'Cette demande a été remplacée. Utilisez la nouvelle demande de préparation.' }, 'Cette demande a été remplacée. Utilisez la nouvelle demande de préparation.'],
    [{ code:'P0001', message:'Ce dossier ne correspond pas à votre compte' }, 'Ce dossier ne correspond pas à votre compte'],
    [{ code:'57014', message:'canceling statement due to statement timeout' }, FRIENDLY],
    [{ code:'40001', message:'could not serialize access due to concurrent update' }, FRIENDLY],
    [{ code:'42501', message:'permission denied for function telegram_client_decision' }, FRIENDLY],
    [{ code:'PGRST202', message:'Could not find the function public.telegram_client_decision in the schema cache' }, FRIENDLY],
    [{ code:'', message:'TypeError: fetch failed' }, FRIENDLY],
  ];
  for (const [error, expected] of cases) {
    const w = awaiting(); w.failRpc.telegram_client_decision = { error };
    const result = await send(w, oui());
    assert.equal(result.status, 200, error.message);
    assert.deepEqual(replies(w).map(item => item.text), [expected], error.message);
    assert.equal(queued(w).length, 0, `${error.message}: no confirmation`); assert.equal(w.tables.telegram_updates[0].status, 'done');
  }
  // A real refusal of the model (the dossier is no longer awaiting the answer) reaches the client as written.
  const w = awaiting({ colis:{ statut:'autorise' } }); await send(w, oui());
  assert.deepEqual(replies(w).map(item => item.text), ['Cette demande ne peut plus être modifiée']);
});

test('a duplicate update is processed once, and a repeated choice is confirmed once', async () => {
  const w = awaiting();
  await send(w, press(9200, `fv_wait_${ID.colis}`));
  assert.deepEqual((await send(w, press(9200, `fv_wait_${ID.colis}`))).body, { ok:true, duplicate:true });
  assert.equal(w.decisions.length, 1); assert.equal(replies(w).length, 1);
  // The client presses « Attendre » again (a new update): the choice is recorded, the stored confirmation is not resent.
  assert.equal((await send(w, press(9201, `fv_wait_${ID.colis}`))).status, 200);
  assert.equal(w.decisions.length, 2); assert.equal(queued(w).length, 2);
  assert.equal(confirmation(w).length, 1); assert.equal(replies(w).length, 1, 'One confirmation for this request and choice');
});

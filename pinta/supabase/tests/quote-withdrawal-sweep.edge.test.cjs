const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, world, call } = require('./quote-withdrawal-fixture.cjs');

const sweep = w => call(w, 'relances-auto', {}, { token:'cron-fixture' });
// A late portal invoice on the sent quote opens a due request (as deposit_client_invoice does).
function lateInvoice(w, colisId = ID.colis) { w.insertInvoice(w.tables.colis.find(c => c.id === colisId), { fichier_url:`${colisId}/late.pdf` }, 'portal'); return w.tables.quote_withdrawals.at(-1); }
function lockedDossier(w, n) {
  const id = `30000000-0000-4000-8000-00000000010${n}`; const intent = `50000000-0000-4000-8000-00000000010${n}`; const provider = `pay_extra${n}`;
  w.tables.colis.push({ ...w.tables.colis[0], id, ref:`EXP-LATE0${n + 1}`, payplug_payment_id:provider, payplug_payment_url:`https://secure.payplug.com/${n}` });
  w.tables.payment_intents.push({ ...w.tables.payment_intents[0], id:intent, colis_id:id, provider_id:provider });
  w.payplug[provider] = { ...w.payplug.pay_fixture, id:provider, metadata:{ colis_id:id, intent_id:intent, quote_version:'2' } };
  return id;
}

test('due requests are processed read-first and the client is told once', async () => {
  const w = world(); const row = lateInvoice(w);
  const first = await sweep(w);
  assert.equal(first.status, 200); assert.deepEqual(first.body.withdrawals, { processed:1, messages:1 });
  assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']); assert.equal(row.status, 'withdrawn'); assert.equal(row.client_message_status, 'sent');
  assert.deepEqual(w.rpcNames().filter(name => /quote_withdrawal|payplug|queue_message/.test(name)),
    ['claim_quote_withdrawal','record_payplug_cancellation','complete_quote_withdrawal','queue_message','mark_quote_withdrawal_message','claim_quote_withdrawal'], 'PayPlug proof before the database withdrawal');
  assert.equal(w.tables.colis[0].statut, 'en_preparation'); assert.equal(w.sent().length, 1);
  const second = await sweep(w);
  assert.deepEqual(second.body.withdrawals, { processed:0, messages:0 }); assert.equal(w.provider.length, 2); assert.equal(w.sent().length, 1);
});

test('PayPlug failures back off 5, 10, 20, 40 and 60 minutes, then leave the request for review', async () => {
  const w = world(); const row = lateInvoice(w); w.onPayplug = () => new Response('{}', { status:503 });
  const delays = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sweep(w); assert.equal(w.provider.length, attempt); assert.equal(row.attempts, attempt);
    if (attempt === 6) break;
    assert.equal(row.status, 'pending'); delays.push((Date.parse(row.next_attempt_at) - w.clock.now) / 60000);
    w.advance(60000); await sweep(w); assert.equal(w.provider.length, attempt, 'Not due yet: PayPlug is not contacted');
    w.advance(Date.parse(row.next_attempt_at) - w.clock.now);
  }
  assert.deepEqual(delays, [5, 10, 20, 40, 60]); assert.equal(row.status, 'needs_review'); assert.match(row.last_error, /PayPlug ne répond pas/);
  w.advance(3600000); await sweep(w); assert.equal(w.provider.length, 6, 'A request left for review waits for an explicit retry');
  assert.equal(w.tables.colis[0].statut, 'devis_envoye'); assert.equal(w.sent().length, 0);
});

test('a request stuck in processing is reclaimed after five minutes, starting with a PayPlug read', async () => {
  const w = world(); const row = lateInvoice(w);
  Object.assign(row, { status:'processing', attempts:1, locked_at:new Date(w.clock.now - 4 * 60000).toISOString() });
  await sweep(w); assert.equal(w.provider.length, 0); assert.equal(row.status, 'processing');
  w.advance(2 * 60000); const result = await sweep(w);
  assert.deepEqual(result.body.withdrawals, { processed:1, messages:1 }); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']); assert.equal(row.status, 'withdrawn');
});

test('a link found paid is never aborted; without a booked payment the request waits for reconciliation', async () => {
  const w = world(); const row = lateInvoice(w); w.payplug.pay_fixture.is_paid = true;
  await sweep(w);
  assert.deepEqual(w.provider.map(p => p.method), ['GET']); assert.equal(row.status, 'needs_review'); assert.equal(row.closed_at, null);
  assert.match(row.last_error, /rapprochement nécessaire/); assert.equal(row.client_message_status, 'not_required');
  assert.equal(w.tables.colis[0].devis_total, 40); assert.equal(w.sent().length, 0);
  // Once the payment is booked, the request closes as paid.
  w.tables.colis[0].paiement_montant = 40; row.status = 'processing';
  const released = await w.callRpc('release_quote_withdrawal', { p_id:row.id, p_outcome:'paid', p_error:null }, { role:'service_role' });
  assert.equal(released.data.status, 'paid'); assert.ok(row.closed_at);
});

test('a paid older (superseded) link never closes the request nor leaves the current link payable unseen', async () => {
  const w = world({ intents:[
    { id:'50000000-0000-4000-8000-000000000009', colis_id:ID.colis, quote_version:1, provider_id:'pay_old', payment_url:'https://secure.payplug.com/old', amount_cents:4000,
      currency:'EUR', status:'superseded', provider_is_live:false, provider_cancelled_at:null },
    { id:ID.intent, colis_id:ID.colis, quote_version:2, provider_id:'pay_fixture', payment_url:'https://secure.payplug.com/fixture', amount_cents:4000,
      currency:'EUR', status:'pending', provider_is_live:false, provider_cancelled_at:null }] });
  w.payplug.pay_old = { ...w.payplug.pay_fixture, id:'pay_old', is_paid:true, metadata:{ colis_id:ID.colis, intent_id:'50000000-0000-4000-8000-000000000009', quote_version:'1' } };
  const row = lateInvoice(w);
  await sweep(w);
  assert.deepEqual(w.provider.map(p => [p.id, p.method]), [['pay_old', 'GET']]);
  assert.equal(row.status, 'needs_review'); assert.equal(row.closed_at, null); assert.equal(row.closed_reason, null);
  assert.equal(w.tables.colis[0].statut, 'devis_envoye'); assert.equal(w.payplug.pay_fixture.failure, null); assert.equal(w.sent().length, 0);
});

test('a request opened on an older quote never touches the link of a newer quote', async () => {
  const w = world(); const row = lateInvoice(w);
  // Meanwhile the quote was corrected (old link cancelled with its proof) and sent again with a new link.
  Object.assign(w.tables.payment_intents[0], { status:'superseded', provider_cancelled_at:w.iso() });
  w.tables.payment_intents.push({ ...w.tables.payment_intents[0], id:'50000000-0000-4000-8000-000000000004', quote_version:4, provider_id:'pay_new', status:'pending', provider_cancelled_at:null });
  w.payplug.pay_new = { ...w.payplug.pay_fixture, id:'pay_new', metadata:{ colis_id:ID.colis, intent_id:'50000000-0000-4000-8000-000000000004', quote_version:'4' } };
  Object.assign(w.tables.colis[0], { quote_version:4, payplug_payment_id:'pay_new', payplug_payment_url:'https://secure.payplug.com/new' });
  const result = await sweep(w);
  assert.deepEqual(result.body.withdrawals, { processed:1, messages:0 }); assert.equal(w.provider.length, 0);
  assert.equal(row.status, 'superseded'); assert.ok(row.closed_at); assert.equal(w.payplug.pay_new.failure, null);
  assert.equal(w.tables.colis[0].payplug_payment_url, 'https://secure.payplug.com/new'); assert.equal(w.sent().length, 0);
});

test('a message not delivered inline is sent once; a failed or stuck send is never resent', async () => {
  const w = world(); const row = lateInvoice(w);
  // Delivered by a later sweep when the inline attempt could not queue it.
  w.failRpc.queue_message = { once:true, error:{ code:'57014', message:'statement timeout' } };
  await sweep(w); assert.equal(row.status, 'withdrawn'); assert.equal(row.client_message_status, 'pending'); assert.equal(w.sent().length, 0);
  await sweep(w); assert.equal(row.client_message_status, 'sent'); assert.equal(w.sent().length, 1);
  await sweep(w); assert.equal(w.sent().length, 1);
  // A failed outbox row stays failed: the message is marked failed, nothing is sent again.
  const failed = world(); const failedRow = lateInvoice(failed); failed.onTelegram = callInfo => { if (callInfo.method === 'sendMessage') throw new Error('network down'); };
  await sweep(failed); assert.equal(failedRow.client_message_status, 'failed'); assert.equal(failed.tables.notification_outbox[0].status, 'failed');
  const attempts = failed.telegram.filter(c => c.method === 'sendMessage').length;
  failedRow.client_message_status = 'pending'; await sweep(failed); await sweep(failed);
  assert.equal(failed.telegram.filter(c => c.method === 'sendMessage').length, attempts); assert.equal(failedRow.client_message_status, 'failed');
  // A send left in progress stays pending, is marked failed by the stale check, and is never resent.
  const stuck = world(); const stuckRow = lateInvoice(stuck); await sweep(stuck);
  stuckRow.client_message_status = 'pending'; Object.assign(stuck.tables.notification_outbox[0], { status:'sending', locked_at:new Date(stuck.clock.now).toISOString() });
  await sweep(stuck); assert.equal(stuckRow.client_message_status, 'pending');
  stuck.advance(6 * 60000); await sweep(stuck); assert.equal(stuck.tables.notification_outbox[0].status, 'failed');
  await sweep(stuck); assert.equal(stuckRow.client_message_status, 'failed'); assert.equal(stuck.sent().length, 1);
});

test('a dispatch that fails before claiming the outbox row keeps the message pending, and the outbox delivers it once', async () => {
  const w = world(); const row = lateInvoice(w); let refused = false;
  w.refuse = ({ table, mode, values }) => { if (!refused && table === 'notification_outbox' && mode === 'update' && values.status === 'sending') { refused = true; return { code:'57014', message:'statement timeout' }; } return null; };
  const first = await sweep(w);
  // Never marked failed: the outbox loop of the same run sends the still pending row.
  assert.equal(first.status, 200); assert.equal(row.status, 'withdrawn'); assert.equal(row.client_message_status, 'pending'); assert.equal(w.sent().length, 1);
  await sweep(w); assert.equal(row.client_message_status, 'sent', 'The next run records the confirmed send'); assert.equal(w.sent().length, 1);
});

test('the sweep stops claiming new requests after its 10 second budget', async () => {
  const w = world(); lateInvoice(w); lateInvoice(w, lockedDossier(w, 1)); lateInvoice(w, lockedDossier(w, 2));
  w.onPayplug = () => { w.advance(12000); };
  const result = await sweep(w);
  assert.deepEqual(result.body.withdrawals, { processed:1, messages:1 }); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  assert.deepEqual(w.tables.quote_withdrawals.map(r => [r.status, r.attempts]), [['withdrawn', 1], ['pending', 0], ['pending', 0]]);
  const next = await sweep(w); assert.equal(next.body.withdrawals.processed, 1);
});

test('a missing withdrawal schema never stops reminders, outbox delivery or OCR', async () => {
  const w = world(); w.failRpc.claim_quote_withdrawal = { error:{ code:'PGRST202', message:'Could not find the function public.claim_quote_withdrawal' } };
  const result = await sweep(w);
  assert.equal(result.status, 200); assert.deepEqual(result.body.withdrawals, { processed:0, messages:0 }); assert.equal(result.body.scanned, 1);
});

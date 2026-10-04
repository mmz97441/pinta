const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, world, call, sha256 } = require('./quote-withdrawal-fixture.cjs');

const PATH = `${ID.colis}/facture-tardive.pdf`;
const BYTES = 'late invoice from the client portal';
function stored(options) { const w = world(options); w.storage.factures[PATH] = Buffer.from(BYTES); return w; }
const deposit = (w, body = {}, token = 'client-jwt') => call(w, 'client-invoice-deposit', { colisId:ID.colis, path:PATH, fileName:'facture.pdf', vendor:null, replacesFactureId:null, ...body }, { token });
const colis = w => w.tables.colis.find(c => c.id === ID.colis);
const rpc = (w, name) => w.calls.filter(c => c.name === name);

test('only the client of the dossier deposits, inside its folder and under 20 MB', async () => {
  const anonymous = stored(); assert.equal((await deposit(anonymous, {}, '')).status, 401);
  const staff = stored(); assert.equal((await deposit(staff, {}, 'staff-jwt')).status, 403);
  const other = stored(); assert.equal((await deposit(other, {}, 'other-client-jwt')).status, 403); assert.equal(other.downloads, undefined, 'No file is read for another account');
  const outside = stored(); assert.equal((await deposit(outside, { path:`${ID.otherColis}/facture.pdf` })).status, 400);
  const traversal = stored(); assert.equal((await deposit(traversal, { path:`${ID.colis}/../${ID.otherColis}/facture.pdf` })).status, 400);
  const format = stored(); format.storage.factures[`${ID.colis}/archive.zip`] = Buffer.from('zip'); assert.equal((await deposit(format, { path:`${ID.colis}/archive.zip` })).status, 400);
  const large = stored(); large.storage.factures[PATH] = Buffer.alloc(20 * 1024 * 1024 + 1); assert.equal((await deposit(large)).status, 400);
  assert.equal(large.downloads, undefined, 'An oversized object is refused from its metadata, before any download');
  const missing = world(); assert.equal((await deposit(missing)).status, 400); assert.equal(missing.downloads, undefined);
  for (const w of [anonymous, staff, other, outside, traversal, format, large, missing]) {
    assert.equal(rpc(w, 'client_document_precheck').length + rpc(w, 'deposit_client_invoice').length, 0); assert.equal(w.provider.length, 0);
  }
});

test('the stored file is hashed on the server; an identical copy of a validated invoice changes nothing', async () => {
  const w = stored(); w.tables.factures.push({ id:ID.invoice, colis_id:ID.colis, valide:true, fichier_url:`${ID.colis}/validated.pdf`, __sha:await sha256(BYTES) });
  const result = await deposit(w);
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok:true, status:'duplicate', quoteSent:true });
  const precheck = rpc(w, 'client_document_precheck')[0];
  assert.deepEqual(precheck.args, { p_colis_id:ID.colis, p_user_id:ID.clientUser, p_path:PATH, p_sha256:await sha256(BYTES) }); assert.equal(precheck.role, 'service_role');
  assert.equal(rpc(w, 'deposit_client_invoice').length, 0); assert.equal(w.tables.factures.length, 1); assert.equal(w.provider.length, 0); assert.equal(colis(w).statut, 'devis_envoye');
});

test('a dossier without a sent quote simply receives the invoice through the client-scoped command', async () => {
  const w = stored({ intents:[], colis:{ statut:'en_preparation', devis_total:null, devis_snapshot:null, payplug_payment_id:null, payplug_payment_url:null } });
  const result = await deposit(w, { vendor:'  Boutique  ' });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'added'); assert.equal(result.body.facture.fichier_url, PATH); assert.equal(result.body.facture.vendeur, 'Boutique');
  assert.deepEqual(rpc(w, 'deposit_client_invoice').map(c => [c.role, c.uid]), [['authenticated', ID.clientUser]]);
  assert.equal(w.provider.length, 0); assert.equal(w.sent().length, 0);
});

test('a late invoice cancels the old link first, then withdraws the quote and tells the client on Telegram', async () => {
  const w = stored(); const result = await deposit(w);
  assert.equal(result.status, 200); assert.equal(result.body.status, 'quote_withdrawn'); assert.equal(result.body.linkCancelled, true);
  assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
  const order = w.rpcNames().filter(name => ['deposit_client_invoice','claim_quote_withdrawal','record_payplug_cancellation','complete_quote_withdrawal','queue_message','mark_quote_withdrawal_message'].includes(name));
  assert.deepEqual(order, ['deposit_client_invoice','claim_quote_withdrawal','record_payplug_cancellation','complete_quote_withdrawal','queue_message','mark_quote_withdrawal_message']);
  assert.equal(colis(w).statut, 'en_preparation'); assert.equal(colis(w).payplug_payment_url, null);
  assert.equal(w.sent().length, 1); assert.equal(w.sent()[0].body.chat_id, '4242'); assert.match(w.sent()[0].body.text, /L’ancien lien de paiement n’est plus valable/);
  assert.equal(w.tables.quote_withdrawals[0].client_message_status, 'sent'); assert.equal(JSON.stringify(result.body).includes('pay_'), false, 'No PayPlug detail reaches the client');
});

test('without Telegram the client is told in the portal', async () => {
  const w = stored({ client:{ telegram_chat_id:null } }); const result = await deposit(w);
  assert.equal(result.body.status, 'quote_withdrawn'); assert.equal(w.sent().length, 0);
  assert.equal(rpc(w, 'queue_message')[0].args.p_canal, 'portal'); assert.equal(w.tables.quote_withdrawals[0].client_message_status, 'portal');
});

test('PayPlug down: the invoice is kept, the quote stays payable and nothing is announced', async () => {
  const w = stored(); w.onPayplug = () => new Response('{}', { status:503 });
  const result = await deposit(w);
  assert.equal(result.status, 200); assert.equal(result.body.status, 'received_pending');
  const row = w.tables.quote_withdrawals[0];
  assert.equal(row.status, 'pending'); assert.equal(Date.parse(row.next_attempt_at) - w.clock.now, 5 * 60000); assert.match(row.last_error, /PayPlug ne répond pas/);
  assert.equal(colis(w).statut, 'devis_envoye'); assert.equal(colis(w).payplug_payment_url, 'https://secure.payplug.com/fixture');
  assert.deepEqual(w.provider.map(p => p.method), ['GET']); assert.equal(rpc(w, 'queue_message').length, 0); assert.equal(w.tables.factures.length, 1);
});

test('a payment seen at PayPlug but not booked is never aborted: the client is told the quote is updating, the team reconciles', async () => {
  const w = stored(); w.payplug.pay_fixture.is_paid = true;
  const result = await deposit(w);
  assert.equal(result.body.status, 'received_pending'); assert.deepEqual(w.provider.map(p => p.method), ['GET']);
  assert.equal(w.tables.quote_withdrawals[0].status, 'needs_review'); assert.equal(w.tables.quote_withdrawals[0].closed_at, null);
  assert.equal(colis(w).devis_total, 40); assert.equal(rpc(w, 'queue_message').length, 0);
});

test('a frozen dossier keeps the document in the conversation, without an invoice, and says why', async () => {
  const w = stored({ colis:{ paiement_montant:40 } }); const result = await deposit(w);
  assert.equal(result.status, 200); assert.equal(result.body.status, 'frozen'); assert.equal(result.body.reason, 'payment'); assert.equal(result.body.facture, undefined);
  assert.equal(w.tables.factures.length, 0); assert.equal(w.tables.messages.filter(m => m.attachment_path === PATH).length, 1); assert.equal(w.provider.length, 0);
  const departed = stored({ colis:{ date_expedition:'2026-10-03' } }); assert.equal((await deposit(departed)).body.reason, 'departure');
});

test('a database refusal reaches the client only as a fixed text, except the business reason (22023)', async () => {
  const w = stored(); w.failRpc.deposit_client_invoice = { error:{ code:'23505', message:'duplicate key value violates unique constraint "factures_pkey"' } };
  const result = await deposit(w);
  assert.equal(result.status, 500); assert.equal(result.body.error, 'Le dépôt n’a pas été enregistré. Réessayez.');
  const business = stored(); business.failRpc.deposit_client_invoice = { error:{ code:'22023', message:'Choisissez la facture à corriger de ce dossier.' } };
  const refused = await deposit(business); assert.equal(refused.status, 409); assert.equal(refused.body.error, 'Choisissez la facture à corriger de ce dossier.');
});

test('a retry with the same path creates no second invoice, withdrawal or message', async () => {
  const w = stored(); const first = await deposit(w); const second = await deposit(w);
  assert.equal(first.body.status, 'quote_withdrawn'); assert.equal(second.body.status, 'quote_withdrawn'); assert.equal(second.body.linkCancelled, true);
  assert.equal(second.body.facture.id, first.body.facture.id); assert.equal(w.tables.factures.length, 1); assert.equal(w.tables.quote_withdrawals.length, 1);
  assert.equal(rpc(w, 'queue_message').length, 1); assert.equal(w.sent().length, 1); assert.deepEqual(w.provider.map(p => p.method), ['GET', 'PATCH']);
});

test('a second file while the request is open joins it, and a refused deposit keeps the server message', async () => {
  const w = stored(); w.onPayplug = () => new Response('{}', { status:503 });
  w.storage.factures[`${ID.colis}/second.pdf`] = Buffer.from('second invoice');
  assert.equal((await deposit(w)).body.status, 'received_pending');
  assert.equal((await deposit(w, { path:`${ID.colis}/second.pdf`, fileName:'second.pdf' })).body.status, 'received_pending');
  assert.equal(w.tables.quote_withdrawals.length, 1); assert.equal(w.tables.quote_withdrawals[0].facture_ids.length, 2);
  const missing = await deposit(w, { path:`${ID.colis}/never-uploaded.pdf` });
  assert.equal(missing.status, 400); assert.match(missing.body.error, /introuvable/);
});

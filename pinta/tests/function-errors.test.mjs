import test from 'node:test';
import assert from 'node:assert/strict';
import { functionErrorBody, functionErrorMessage } from '../src/expedile/services/functionErrors.js';

test('payment configuration error is extracted from the non-2xx Edge response in French', async () => {
  const message = 'Le paiement réel est indisponible : la clé PayPlug de production doit être configurée. Aucun lien de test ne sera envoyé.';
  const response = Response.json({ ok: false, error: message }, { status: 503 });
  assert.equal(await functionErrorMessage({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: response } }), message);
  assert.equal(response.bodyUsed, false);
});
test('an inaccessible Edge response keeps a meaningful action-specific failure', async () => {
  assert.equal(await functionErrorMessage({ error: { message: 'Failed to fetch' } }, 'Paiement indisponible, devis conservé.'), 'Paiement indisponible, devis conservé.');
});
test('the structured body of a refused withdrawal is available without consuming the response', async () => {
  const body = { ok: false, code: '40001', hint: 'payment_link_creating', paymentLinkCancelled: true, withdrawalSaved: false, error: 'Conflit' };
  const response = Response.json(body, { status: 409 });
  const result = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: response } };
  assert.deepEqual(await functionErrorBody(result), body);
  assert.equal(await functionErrorMessage(result), 'Conflit', 'The message can still be read afterwards.');
  assert.deepEqual(await functionErrorBody({ data: { ok: false, code: 'payplug_paid' } }), { ok: false, code: 'payplug_paid' });
  assert.equal(await functionErrorBody({ error: { message: 'Failed to fetch' } }), null);
  assert.equal(await functionErrorBody({ error: { context: new Response('not json', { status: 502 }) } }), null);
});

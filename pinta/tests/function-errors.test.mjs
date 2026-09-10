import test from 'node:test';
import assert from 'node:assert/strict';
import { functionErrorMessage } from '../src/expedile/services/functionErrors.js';

test('payment configuration error is extracted from the non-2xx Edge response in French', async () => {
  const message = 'Le paiement réel est indisponible : la clé PayPlug de production doit être configurée. Aucun lien de test ne sera envoyé.';
  const response = Response.json({ ok: false, error: message }, { status: 503 });
  assert.equal(await functionErrorMessage({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: response } }), message);
  assert.equal(response.bodyUsed, false);
});
test('an inaccessible Edge response keeps a meaningful action-specific failure', async () => {
  assert.equal(await functionErrorMessage({ error: { message: 'Failed to fetch' } }, 'Paiement indisponible, devis conservé.'), 'Paiement indisponible, devis conservé.');
});

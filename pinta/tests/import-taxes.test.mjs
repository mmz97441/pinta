// {{estimation_taxes}} (decision of 10 October 2026): the browser preview (services/messageTemplates.js) and the
// Edge renderer (_shared/messageTemplate.ts) write the same text, in every version, from the same saved quote.
// CLAUDE.md § 7: the two renderers stay identical; an unknown variable stops a message, never silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const bundle = await build({
  stdin: { contents: [
    "export { renderTemplate } from './src/expedile/services/messageTemplates.js';",
    "export { renderMessage } from './supabase/functions/_shared/messageTemplate.ts';",
    "export { IMPORT_TAX_PLACES as SERVER_PLACES } from './supabase/functions/_shared/importTaxes.ts';",
    "export { IMPORT_TAX_PLACES as BROWSER_PLACES } from './src/expedile/domain/importTaxes.js';",
    "export { DEFAULT_BODIES as SERVER_DEFAULTS } from './supabase/functions/_shared/messageDefaults.ts';",
    "export { DEFAULT_BODIES } from './src/expedile/services/messageDefaults.js';",
    "export { DESTINATIONS } from './src/expedile/constants/index.js';",
  ].join('\n'), resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'isolated-http', setup(builder) {
    builder.onResolve({ filter: /^\.\/http\.ts$/ }, () => ({ path: 'http', namespace: 'message-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'message-test' }, () => ({ contents: 'export class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }', loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: loaded, exports: loaded.exports, require: createRequire(import.meta.url), Deno: { env: { get: () => 'https://example.test' } } });
const { renderTemplate, renderMessage, SERVER_PLACES, BROWSER_PLACES, SERVER_DEFAULTS, DEFAULT_BODIES, DESTINATIONS } = loaded.exports;

// The same saved dossier as each renderer receives it: camelCase in the browser, the colis row on the server.
const row = colis => ({ ref: colis.ref, devis_transport: colis.devisTransport, devis_om: colis.devisOM, devis_omr: colis.devisOMR, devis_tva: colis.devisTVA, devis_total: colis.devisTotal });
// The browser holds DESTINATIONS (code, nom, label, tva), the server a destinations row (code, nom, flag, tva).
const serverDestination = destination => destination && { code: destination.code, nom: destination.nom, flag: destination.flag, tva: destination.tva };
const both = (body, { client, colis, destination }) => [
  renderTemplate(body, { client, colis, destination }),
  renderMessage(body, client, row(colis), serverDestination(destination), {}),
];

const particulier = { prenom: 'Flavie', nom: 'Payet', type: 'particulier' };
const CASES = [
  ['La Réunion, three taxes', particulier, { ref: 'EXP-1', devisTransport: 36.25, devisOM: 30.2, devisOMR: 15.4, devisTVA: 6.96, devisTotal: 93.81 }, DESTINATIONS['974']],
  ['Mayotte, an octroi de mer only', particulier, { ref: 'EXP-2', devisTransport: 40, devisOM: 12, devisOMR: 0, devisTVA: 0, devisTotal: 52 }, DESTINATIONS['976']],
  ['Guadeloupe, amounts as strings', particulier, { ref: 'EXP-3', devisTransport: '30.00', devisOM: '2.50', devisOMR: '0.50', devisTVA: '2.81', devisTotal: '35.81' }, DESTINATIONS['971']],
  ['Martinique, nothing estimated', particulier, { ref: 'EXP-4', devisTransport: 40, devisOM: 0, devisOMR: 0, devisTVA: 0, devisTotal: 40 }, DESTINATIONS['972']],
  ['no quote yet', particulier, { ref: 'EXP-5', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null }, DESTINATIONS['974']],
  ['an unknown destination', particulier, { ref: 'EXP-6', devisTransport: 30, devisOM: 3, devisOMR: 1, devisTVA: 2.89, devisTotal: 36.89 }, { code: '973', nom: 'Guyane', flag: '', tva: 0 }],
  ['a professional', { prenom: 'Marc', nom: 'Hoarau', type: 'pro' }, { ref: 'EXP-7', devisTransport: 60, devisOM: 0, devisOMR: 0, devisTVA: 0, devisTotal: 60 }, DESTINATIONS['974']],
];

test('{{estimation_taxes}}: the preview and the delivered text are identical in every version', () => {
  const expected = {
    'La Réunion, three taxes': 'Estimation des taxes à l’importation à La Réunion (payées à l’arrivée, comprises dans le prix) : 52.56 €\n• dont estimation octroi de mer de La Réunion : 30.20 €\n• dont estimation octroi de mer régional de La Réunion : 15.40 €\n• dont estimation TVA à l’importation de La Réunion : 6.96 €',
    'Mayotte, an octroi de mer only': 'Estimation des taxes à l’importation à Mayotte (payées à l’arrivée, comprises dans le prix) : 12.00 €\n• dont estimation octroi de mer de Mayotte : 12.00 €',
    'Guadeloupe, amounts as strings': 'Estimation des taxes à l’importation en Guadeloupe (payées à l’arrivée, comprises dans le prix) : 5.81 €\n• dont estimation octroi de mer de la Guadeloupe : 2.50 €\n• dont estimation octroi de mer régional de la Guadeloupe : 0.50 €\n• dont estimation TVA à l’importation de la Guadeloupe : 2.81 €',
    'Martinique, nothing estimated': 'Aucune taxe à l’importation n’est estimée en Martinique pour ce devis.',
    'no quote yet': 'Estimation des taxes à l’importation : à calculer avec le devis.',
    'an unknown destination': 'Estimation des taxes à l’importation à destination (payées à l’arrivée, comprises dans le prix) : 6.89 €\n• dont estimation octroi de mer à destination : 3.00 €\n• dont estimation octroi de mer régional à destination : 1.00 €\n• dont estimation TVA à l’importation à destination : 2.89 €',
    'a professional': '',
  };
  for (const [name, client, colis, destination] of CASES) {
    const [preview, delivered] = both('{{estimation_taxes}}', { client, colis, destination });
    assert.equal(preview, delivered, `${name}: same text in the preview and the delivery`);
    assert.equal(preview, expected[name], name);
    assert.doesNotMatch(preview, /TVA \(|0\.00 €|undefined|NaN|[_*]/, `${name}: no tax of the price, no empty amount, plain text`);
  }
});

test('both renderers know the same destinations, and the variable in every default and saved body', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SERVER_PLACES)), JSON.parse(JSON.stringify(BROWSER_PLACES)));
  assert.deepEqual(Object.keys(BROWSER_PLACES).sort(), Object.keys(DESTINATIONS).sort(), 'Each destination served has its wording.');
  // The quote defaults, rendered by both: the same estimate block, never « TVA ( » nor « OM : ».
  const [client, colis, destination] = [particulier, CASES[0][2], DESTINATIONS['974']];
  for (const key of ['devis_final_telegram', 'devis_final_email']) {
    assert.equal(SERVER_DEFAULTS[key], DEFAULT_BODIES[key], `${key}: the Edge copy is the browser's`);
    const [preview, delivered] = both(DEFAULT_BODIES[key], { client, colis, destination });
    const block = text => text.split('\n').filter(line => /estimation|importation/i.test(line));
    assert.deepEqual(block(preview), block(delivered), `${key}: the same estimate lines`);
    assert.equal(block(preview).length, 4, `${key}: the estimate and its three lines`);
    assert.doesNotMatch(preview, /TVA \(|^\s*(?:OMR?|Octroi de mer|TVA)\b|Taxes : |📊/mu, key);
  }
  // A body saved before the variable existed still renders as saved (legacy variables kept), never rewritten.
  const former = '🏛️ Taxes : {{taxes}}\n📊 TVA ({{taux_tva}}) : {{tva}}';
  assert.equal(renderTemplate(former, { client, colis, destination }), '🏛️ Taxes : 45.60 €\n📊 TVA (8.5%) : 6.96 €');
  assert.equal(renderMessage(former, client, row(colis), serverDestination(destination), {}), '🏛️ Taxes : 45.60 €\n📊 TVA (8.5%) : 6.96 €');
  // An unknown variable still stops both.
  assert.throws(() => renderTemplate('{{estimation_taxe}}', { client, colis, destination }), /Variable de message inconnue : estimation_taxe/);
  assert.throws(() => renderMessage('{{estimation_taxe}}', client, row(colis), serverDestination(destination), {}), /Variable de message inconnue : estimation_taxe/);
});

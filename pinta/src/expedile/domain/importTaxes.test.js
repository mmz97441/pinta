import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_TAX_NOTE, importTaxEstimate, importTaxHeading, importTaxLabel, importTaxMessage, importTaxPlace, legacyTaxLines, savedTemplatesWithLegacyTaxes } from './importTaxes.js';
import { DESTINATIONS } from '../constants/index.js';
import { DEFAULT_BODIES } from '../services/messageDefaults.js';

const money = value => `${Number(value).toFixed(2)} €`;

test('each destination is named with its own article, an unknown one is never given a wrong one', () => {
  assert.deepEqual(Object.fromEntries(Object.keys(DESTINATIONS).map(code => [code, importTaxPlace(DESTINATIONS[code])])), {
    974: { at: 'à La Réunion', of: 'de La Réunion' }, 976: { at: 'à Mayotte', of: 'de Mayotte' },
    971: { at: 'en Guadeloupe', of: 'de la Guadeloupe' }, 972: { at: 'en Martinique', of: 'de la Martinique' },
  });
  // A former dossier knows its destination by name only (the quote snapshot keeps code and name).
  assert.equal(importTaxPlace({ nom: 'La Réunion' }).at, 'à La Réunion');
  assert.equal(importTaxPlace({ label: 'Guadeloupe' }).of, 'de la Guadeloupe');
  for (const unknown of [{ code: '973', nom: 'Guyane' }, {}, null, undefined]) assert.deepEqual(importTaxPlace(unknown), { at: 'à destination', of: 'à destination' });
  assert.equal(importTaxHeading({ code: '976' }), 'Estimation des taxes à l’importation à Mayotte');
  assert.equal(importTaxLabel({ code: '974' }), 'Estimation des taxes à l’importation à La Réunion (payées à l’arrivée, comprises dans le prix)');
  assert.equal(IMPORT_TAX_NOTE, 'payées à l’arrivée, comprises dans le prix');
});

test('the estimate reads the saved amounts as they are: positive lines only, a total in cents, none for a professional', () => {
  const estimate = importTaxEstimate({ om: 30.2, omr: 15.4, tva: 6.96 }, { code: '974' });
  assert.deepEqual(estimate.lines, [
    { key: 'om', label: 'dont estimation octroi de mer de La Réunion', amount: 30.2 },
    { key: 'omr', label: 'dont estimation octroi de mer régional de La Réunion', amount: 15.4 },
    { key: 'tva', label: 'dont estimation TVA à l’importation de La Réunion', amount: 6.96 },
  ]);
  assert.equal(estimate.total, 52.56, 'Added in cents: never 52.559999.');
  assert.equal(importTaxEstimate({ om: 0.1, omr: 0.2, tva: 0 }, { code: '974' }).total, 0.3);
  // Mayotte: an octroi de mer only; a zero or missing amount is no line.
  assert.deepEqual(importTaxEstimate({ om: '12.00', omr: 0, tva: null }, { code: '976' }).lines.map(line => [line.label, line.amount]), [['dont estimation octroi de mer de Mayotte', 12]]);
  assert.deepEqual(importTaxEstimate({}, { code: '974' }).lines, []);
  assert.equal(importTaxEstimate({}, { code: '974' }).total, 0);
  assert.deepEqual(importTaxEstimate({ om: -3, omr: 'x', tva: Infinity }, { code: '974' }).lines, [], 'Never a negative or invalid amount.');
  assert.equal(importTaxEstimate({ om: 5, omr: 1, tva: 2 }, { code: '974' }, { professional: true }), null);
  for (const line of estimate.lines) assert.doesNotMatch(line.label, /^(?:TVA|Octroi|OM)/, 'Each line is an estimate of the destination’s tax.');
});

test('the message block has its versions: the estimate, nothing estimated, still to calculate, and nothing for a professional', () => {
  assert.equal(importTaxMessage({ om: 30.2, omr: 15.4, tva: 6.96, total: 93.81 }, { code: '974' }, { money }), [
    'Estimation des taxes à l’importation à La Réunion (payées à l’arrivée, comprises dans le prix) : 52.56 €',
    '• dont estimation octroi de mer de La Réunion : 30.20 €',
    '• dont estimation octroi de mer régional de La Réunion : 15.40 €',
    '• dont estimation TVA à l’importation de La Réunion : 6.96 €',
  ].join('\n'));
  assert.equal(importTaxMessage({ om: 0, omr: 0, tva: 0, total: 40 }, { code: '971' }, { money }), 'Aucune taxe à l’importation n’est estimée en Guadeloupe pour ce devis.');
  for (const total of [null, undefined, 0, '', 'x']) assert.equal(importTaxMessage({ om: 3, total }, { code: '974' }, { money }), 'Estimation des taxes à l’importation : à calculer avec le devis.');
  assert.equal(importTaxMessage({ om: 3, omr: 1, tva: 2, total: 50 }, { code: '974' }, { professional: true, money }), '');
  // Plain text: no Markdown marker can reach the client literally.
  assert.doesNotMatch(importTaxMessage({ om: 3, omr: 1, tva: 2, total: 50 }, { code: '972' }, { money }), /[_*]/);
});

test('saved templates written before 10 October are named by their lines, never rewritten', () => {
  // The defaults of 9 October 2026, as a team may have saved them.
  const telegram = 'Bonjour {{prenom}} 👋\n\n🚀 Transport : {{transport}}\n🏛️ Taxes : {{taxes}}\n📊 TVA ({{taux_tva}}) : {{tva}}\n{{frais_divers}}\n💰 TOTAL : {{total}}\n\nL’équipe Expedîle';
  const email = 'Bonjour {{nom_complet}},\n\nTransport : {{transport}}\nOM : {{om}}\nOMR : {{omr}}\nTVA ({{taux_tva}}) : {{tva}}\n{{frais_divers}}\n\nTOTAL : {{total}}\n\nCordialement,\nL’équipe Expedîle';
  assert.deepEqual(legacyTaxLines(telegram), ['🏛️ Taxes : {{taxes}}', '📊 TVA ({{taux_tva}}) : {{tva}}']);
  assert.deepEqual(legacyTaxLines(email), ['OM : {{om}}', 'OMR : {{omr}}', 'TVA ({{taux_tva}}) : {{tva}}']);
  for (const line of ['📊 TVA (8.5%) : 6.96 €', 'Octroi de mer : 16,90 €', 'Octroi de mer régional ....... 4.22 €', '🏛️ Taxes douanières : *45.60 €*', 'Dont octroi de mer : 30.20 €', '{{taxes}}', 'Montant TVA (8,5 %) : {{tva}}'])
    assert.deepEqual(legacyTaxLines(line), [line], line);
  // The new wording, a custom estimate line and the other lines of a message are not flagged.
  for (const line of ['🏛️ {{estimation_taxes}}', 'dont estimation TVA à l’importation : {{tva}}', 'Estimation des taxes à l’importation : {{taxes}}', '🚀 Transport : {{transport}}', '📄 Pourquoi ? Calcul des taxes, déclaration douane, devis final.', 'Optimisation de l’emballage', 'Omnicanal : {{lien_espace}}'])
    assert.deepEqual(legacyTaxLines(line), [], line);
  // Every default uses the new wording.
  for (const [key, body] of Object.entries(DEFAULT_BODIES)) assert.deepEqual(legacyTaxLines(body), [], key);
  assert.match(DEFAULT_BODIES.devis_final_telegram, /🚀 Transport : \{\{transport\}\}\n🏛️ \{\{estimation_taxes\}\}\n\{\{frais_divers\}\}/);
  assert.match(DEFAULT_BODIES.devis_final_email, /Transport : \{\{transport\}\}\n\{\{estimation_taxes\}\}\n\{\{frais_divers\}\}/);
  assert.doesNotMatch(DEFAULT_BODIES.devis_final_pro_telegram + DEFAULT_BODIES.devis_final_pro_email, /taxes|TVA/i, 'The professional quote is unchanged: no taxes.');
  // Paramètres lists the saved ones, in the order of its template list, Telegram before email; unknown keys aside.
  const saved = { devis_final_email: email, relance_paiement_telegram: 'Bonjour {{prenom}}, {{total}}', devis_final_telegram: telegram, ancien_modele_telegram: telegram, notes: telegram };
  assert.deepEqual(savedTemplatesWithLegacyTaxes(saved, ['reception', 'devis_final', 'relance_paiement']).map(item => [item.key, item.canal, item.lines.length]), [['devis_final', 'telegram', 2], ['devis_final', 'email', 3]]);
  assert.deepEqual(savedTemplatesWithLegacyTaxes({}, ['devis_final']), []);
  assert.deepEqual(savedTemplatesWithLegacyTaxes(null), []);
});

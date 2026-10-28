// Arrival notice (docs/specification-brouillon-reception-2026-10-28.md, « Messages : l'avis d'arrivée »).
// The browser preview (services/messageTemplates.js) and the Edge renderer (_shared/messageTemplate.ts) write the same
// {{nb_colis_recus}} and {{liste_colis_recus}}; the four default bodies are mirrored, plain text and signed;
// services/arrivalNotice.js decides the channel like validate_reception, the invoice variant with the rule of
// « facture manquante », and the body with the saved template first. CLAUDE.md § 7: an unknown variable stops a message.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const bundle = await build({
  stdin: { contents: [
    "export { renderTemplate } from './src/expedile/services/messageTemplates.js';",
    "export { renderMessage } from './supabase/functions/_shared/messageTemplate.ts';",
    "export { DEFAULT_BODIES } from './src/expedile/services/messageDefaults.js';",
    "export { DEFAULT_BODIES as SERVER_DEFAULTS } from './supabase/functions/_shared/messageDefaults.ts';",
    "export { arrivalChannel, arrivalTemplate, renderArrivalNotice } from './src/expedile/services/arrivalNotice.js';",
    "export { invoiceRequested } from './supabase/functions/_shared/invoiceRequest.ts';",
    "export { mapClient, mapColis } from './src/expedile/lib/supabaseData.js';",
    "export { DESTINATIONS } from './src/expedile/constants/index.js';",
  ].join('\n'), resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'isolated-modules', setup(builder) {
    // The Deno HTTP helpers and the browser Supabase client are replaced: nothing here reaches a network.
    builder.onResolve({ filter: /^\.\/http\.ts$/ }, () => ({ path: 'http', namespace: 'message-test' }));
    builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'message-test' }));
    builder.onLoad({ filter: /^http$/, namespace: 'message-test' }, () => ({ contents: 'export class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }', loader: 'js' }));
    builder.onLoad({ filter: /^supabase$/, namespace: 'message-test' }, () => ({ contents: 'export const supabase = null;', loader: 'js' }));
  } }],
});
const APP = 'https://example.test';
const loaded = { exports: {} };
// {{lien_espace}}: the browser uses its own origin, the Edge function APP_URL; both are the same application here.
vm.runInNewContext(bundle.outputFiles[0].text, { module: loaded, exports: loaded.exports, require: createRequire(import.meta.url), console, URL,
  window: { location: { origin: APP } }, Deno: { env: { get: name => (name === 'APP_URL' ? APP : undefined) } } });
const { renderTemplate, renderMessage, DEFAULT_BODIES, SERVER_DEFAULTS, arrivalChannel, arrivalTemplate, renderArrivalNotice, invoiceRequested, mapClient, mapColis, DESTINATIONS } = loaded.exports;
// Objects built in the module's context: compared as JSON.
const plain = value => JSON.parse(JSON.stringify(value));

const ARRIVAL_KEYS = ['arrivee_colis_telegram', 'arrivee_colis_email', 'arrivee_colis_facture_telegram', 'arrivee_colis_facture_email'];
const NEW_VARIABLES = '{{nb_colis_recus}}\n{{liste_colis_recus}}';

// The same client and dossier as each renderer receives them: mapped in the browser, the database rows on the server.
const clientRow = { id: 'client-1', prenom: 'Flavie', nom: 'PAYET', type: 'particulier', cp: '97400', email: 'flavie@example.test', telegram_chat_id: '7001' };
const browserClient = mapClient(clientRow);
const colisRow = { id: 'colis-1', client_id: 'client-1', ref: 'EXP-ARR001', statut: 'receptionne', nb_colis: 3 };
const browserColis = mapColis({ ...colisRow, _factures: [] });
const destination = DESTINATIONS['974'];
const serverDestination = { code: destination.code, nom: destination.nom, flag: destination.flag, tva: destination.tva };
const both = (body, reception) => [
  renderTemplate(body, { client: browserClient, colis: browserColis, destination, settings: {}, ...(reception === undefined ? {} : { reception }) }),
  renderMessage(body, clientRow, colisRow, serverDestination, {}, [], [], reception),
];

const THREE = [
  { carton: 1, number: 'LP123456789FR', fournisseur: 'Amazon', dimL: 35.5, dimW: 28, dimH: 18, poids: 2.45 },
  { carton: 2, number: 'SH789', fournisseur: 'SHEIN', dimL: '40', dimW: '30', dimH: '20', poids: '1.2' },
  { carton: 3, number: '', fournisseur: '', dimL: 20, dimW: 15, dimH: 10, poids: 0.8 },
];
const THREE_LINES = '1. Amazon — LP123456789FR — 35,5 × 28 × 18 cm — 2,45 kg\n2. SHEIN — SH789 — 40 × 30 × 20 cm — 1,2 kg\n3. Sans numéro de suivi — 20 × 15 × 10 cm — 0,8 kg';

// [name, reception context, {{nb_colis_recus}}, {{liste_colis_recus}}]
const CASES = [
  ['three cartons, numbers and strings', { cartons: THREE }, '3 colis', THREE_LINES],
  ['one carton', { cartons: [{ number: 'ZR-55', fournisseur: 'Zara', dimL: 30, dimW: 20, dimH: 10, poids: 1 }] }, '1 colis', '1. Zara — ZR-55 — 30 × 20 × 10 cm — 1 kg'],
  ['numbered in the order given, not by carton number', { cartons: [{ carton: 5, number: 'B-2', fournisseur: 'Fnac', dimL: 10, dimW: 10, dimH: 10, poids: 1 }, { carton: 2, number: 'A-1', fournisseur: 'Darty', dimL: 20, dimW: 20, dimH: 20, poids: 2 }] },
    '2 colis', '1. Fnac — B-2 — 10 × 10 × 10 cm — 1 kg\n2. Darty — A-1 — 20 × 20 × 20 cm — 2 kg'],
  ['French numbers: decimal comma, two decimals at most, no thousands separator, never a false zero', { cartons: [
    { number: 'D-1', dimL: 120.25, dimW: 0.5, dimH: 1000, poids: 2.456 },
    { number: 'D-2', dimL: '99.999', dimW: '45.10', dimH: 7, poids: '3.10' },
    { number: 'D-3', dimL: 10, dimW: 10, dimH: 10, poids: 0.004 },
    { number: 'D-4', dimL: 0.001, dimW: 10, dimH: 10, poids: 1e-9 },
  ] }, '4 colis', [
    '1. D-1 — 120,25 × 0,5 × 1000 cm — 2,46 kg',
    '2. D-2 — 100 × 45,1 × 7 cm — 3,1 kg',
    '3. D-3 — 10 × 10 × 10 cm — < 0,01 kg',
    '4. D-4 — < 0,01 × 10 × 10 cm — < 0,01 kg',
  ].join('\n')],
  ['missing vendor, tracking, measures and weight', { cartons: [
    { number: null, fournisseur: '   ', dimL: 30, dimW: null, dimH: 10, poids: 0 },
    { number: '  ', fournisseur: 'Cdiscount', dimL: '12foo', dimW: 10, dimH: 10, poids: -1 },
    { number: 'K-7', dimL: 0, dimW: 10, dimH: 10, poids: '' },
    { number: 'K-8', fournisseur: 'Boulanger', dimL: 10, dimW: 10, dimH: 10, poids: Infinity },
    { number: 'K-9', dimL: '45,5', dimW: 10, dimH: 10, poids: '2,4' },
    {},
    null,
  ] }, '7 colis', [
    '1. Sans numéro de suivi — dimensions à mesurer — poids à peser',
    '2. Cdiscount — Sans numéro de suivi — dimensions à mesurer — poids à peser',
    '3. K-7 — dimensions à mesurer — poids à peser',
    '4. Boulanger — K-8 — 10 × 10 × 10 cm — poids à peser',
    '5. K-9 — dimensions à mesurer — poids à peser',
    '6. Sans numéro de suivi — dimensions à mesurer — poids à peser',
    '7. Sans numéro de suivi — dimensions à mesurer — poids à peser',
  ].join('\n')],
  ['legacy names and surrounding spaces, like {{liste_cartons}}', { cartons: [{ vendeur: 'Fnac', tracking: ' FN-1 ', dimL: '35.0', dimW: 28, dimH: 18, poids: '2.50' }, { fournisseur: '  Darty  ', numero: 'N-9', dimL: 10, dimW: 10, dimH: 10, poids: 0.35 }] },
    '2 colis', '1. Fnac — FN-1 — 35 × 28 × 18 cm — 2,5 kg\n2. Darty — N-9 — 10 × 10 × 10 cm — 0,35 kg'],
  ['no reception context', undefined, '', ''],
  ['a null context', null, '', ''],
  ['a context without cartons', {}, '', ''],
  ['an empty reception', { cartons: [] }, '', ''],
  ['cartons that are not a list', { cartons: 'LP123' }, '', ''],
];

test('{{nb_colis_recus}} and {{liste_colis_recus}}: the preview and the delivered text are identical in every case', () => {
  for (const [name, reception, count, list] of CASES) {
    const [preview, delivered] = both(NEW_VARIABLES, reception);
    assert.equal(preview, delivered, `${name}: same text in the preview and the delivery`);
    assert.equal(preview, `${count}\n${list}`, name);
    assert.doesNotMatch(preview, /undefined|null|NaN|Infinity|\[object|\d\.\d|\d×|×\d|\de[+-]?\d/, `${name}: French numbers, never a raw value`);
  }
});

test('existing callers are unchanged: without the context the new variables are empty, the other variables untouched', () => {
  // The Edge callers pass five or seven arguments; the browser callers pass no reception key.
  assert.equal(renderMessage(NEW_VARIABLES, clientRow, colisRow, serverDestination, {}), '\n');
  assert.equal(renderMessage(NEW_VARIABLES, clientRow, colisRow, serverDestination, {}, [], []), '\n');
  assert.equal(renderTemplate(NEW_VARIABLES, { client: browserClient, colis: browserColis, destination }), '\n');
  // The dossier's own cartons ({{nb_cartons}}, {{liste_cartons}}, {{dims_brutes}}) never read the reception context.
  const former = '{{prenom}} {{ref}} {{nb_cartons}}\n{{liste_cartons}}\n{{dims_brutes}}';
  const parcel = { ...colisRow, nb_colis: 2, trackings: ['TRACK-A'], trackings_detail: [{ number: 'TRACK-A', fournisseur: 'Boutique A' }, {}] };
  const mapped = mapColis({ ...parcel, _factures: [] });
  const expected = 'Flavie EXP-ARR001 2\n1. Boutique A — TRACK-A\n2. Sans numéro de suivi\nÀ mesurer';
  assert.equal(renderTemplate(former, { client: browserClient, colis: mapped, destination }), expected);
  assert.equal(renderTemplate(former, { client: browserClient, colis: mapped, destination, reception: { cartons: THREE } }), expected);
  assert.equal(renderMessage(former, clientRow, parcel, serverDestination, {}), expected);
  assert.equal(renderMessage(former, clientRow, parcel, serverDestination, {}, [], [], { cartons: THREE }), expected);
});

test('an unknown variable still stops both renderers, with or without the reception context', () => {
  for (const reception of [undefined, { cartons: THREE }]) {
    for (const variable of ['liste_colis_recu', 'nb_colis', 'colis_recus']) {
      const body = `Bonjour {{prenom}} : {{${variable}}}`;
      assert.throws(() => renderTemplate(body, { client: browserClient, colis: browserColis, destination, ...(reception ? { reception } : {}) }), new RegExp(`Variable de message inconnue : ${variable}$`));
      assert.throws(() => renderMessage(body, clientRow, colisRow, serverDestination, {}, [], [], reception), (error) => error.status === 422 && error.message === `Variable de message inconnue : ${variable}`);
    }
  }
});

test('the four default bodies: mirrored in the Edge copy, plain text, signed, exact, Telegram shorter than the email', () => {
  const keys = Object.keys(DEFAULT_BODIES);
  assert.deepEqual(keys.slice(keys.indexOf(ARRIVAL_KEYS[0]), keys.indexOf(ARRIVAL_KEYS[0]) + 4), ARRIVAL_KEYS, 'The four keys, together and in this order.');
  assert.deepEqual(plain(Object.keys(SERVER_DEFAULTS)), plain(keys), 'The Edge copy holds the same keys in the same order.');
  for (const key of ARRIVAL_KEYS) {
    const body = DEFAULT_BODIES[key];
    const invoice = key.startsWith('arrivee_colis_facture_');
    assert.equal(SERVER_DEFAULTS[key], body, `${key}: the Edge copy is the browser's`);
    assert.deepEqual([...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))].sort(),
      key === 'arrivee_colis_facture_email' ? ['lien_espace', 'liste_colis_recus', 'nb_colis_recus', 'prenom'] : ['liste_colis_recus', 'nb_colis_recus', 'prenom'], `${key}: only variables known to both renderers`);
    // Telegram receives plain text: an underscore or an asterisk would reach the client literally.
    assert.doesNotMatch(body.replace(/\{\{\w+\}\}/g, ''), /[_*`#[\]]/, `${key}: no Markdown marker outside its variables`);
    assert.match(body, /\n\{\{liste_colis_recus\}\}\n\n/, `${key}: the list stands on its own lines`);
    // No price, date, delay or departure is promised; « accord » is never « préparation commencée ».
    assert.doesNotMatch(body, /\d|€|d[ée]part|livraison|aujourd|demain|bient[ôo]t|\bheures?\b|\bjours?\b|\bsemaines?\b|en cours de pr[ée]paration|pr[ée]paration (en cours|commenc)/i, `${key}: no date, price or started preparation`);
    // A carton may be damaged or hold a forbidden product (the team tells the client separately): nothing is promised
    // about the cartons' condition, and the client is not told there is nothing (else) to do.
    assert.doesNotMatch(body, /s[ée]curit|rien à faire|seule chose|bon [ée]tat|intact|aucun (probl|souci)|tout va bien/i, `${key}: no claim about the cartons' condition`);
    assert.match(body, /^Bonjour \{\{prenom\}\}(?: 👋|,)\n\nBonne nouvelle : nous avons reçu \{\{nb_colis_recus\}\} pour vous à notre entrepôt de Paris\. Nous vous tenons au courant à chaque étape\.\n\n/u, `${key}: the context, warm and exact`);
    assert.match(body, /Prochaine étape : [^\n]*accord[^\n]*avant toute préparation|Prochaine étape : avant toute préparation, nous vous demanderons votre accord/, `${key}: the next step is the consent request`);
    assert.match(body, /vous recevrez (ensuite )?le devis/i, `${key}: the quote follows`);
    assert.equal(/factures d’achat/.test(body), invoice, `${key}: only the invoice variant asks for the purchase invoices`);
    assert.doesNotMatch(body, /votre facture|la facture/, `${key}: a reception often covers several sellers, « vos factures d’achat »`);
    if (key.endsWith('_telegram')) {
      assert.match(body, /^Bonjour \{\{prenom\}\} 👋\n\n[\s\S]+\n\nL’équipe Expedîle$/u, `${key}: greets by first name and is signed`);
      assert.ok(body.length < DEFAULT_BODIES[key.replace(/_telegram$/, '_email')].length, `${key}: shorter than the email`);
    } else {
      assert.match(body, /^Bonjour \{\{prenom\}\},\n\n[\s\S]+\n\nCordialement,\nL’équipe Expedîle$/, `${key}: greets by first name and is signed`);
      assert.doesNotMatch(body, /\p{Extended_Pictographic}/u, `${key}: no emoji in an email`);
    }
  }
  assert.doesNotMatch(DEFAULT_BODIES.arrivee_colis_telegram + DEFAULT_BODIES.arrivee_colis_email, /facture/, 'The standard notice never mentions an invoice.');
  // How to send the invoices: on Telegram in reply to the notice (the server records it as the requested invoice) or in
  // the client space; by email, the link of the dossier ({{lien_espace}}).
  assert.match(DEFAULT_BODIES.arrivee_colis_facture_telegram, /\n\n📄 Pour établir votre devis, nous avons besoin de vos factures d’achat : envoyez-les en réponse à ce message \(photos ou PDF\) ou déposez-les dans votre espace client\.\n\nL’équipe Expedîle$/u);
  assert.match(DEFAULT_BODIES.arrivee_colis_facture_email, /\n\nPour établir votre devis, nous avons besoin de vos factures d’achat\. Déposez-les dans les documents de votre dossier \(photos ou PDF\) : \{\{lien_espace\}\}\n\nCordialement,/);
  // The invoice reminder follows the next step, before the signature.
  for (const key of ['arrivee_colis_facture_telegram', 'arrivee_colis_facture_email']) assert.ok(DEFAULT_BODIES[key].indexOf('factures d’achat') > DEFAULT_BODIES[key].indexOf('Prochaine étape'), key);
});

test('the default bodies render identically in the preview and the delivery, singular and plural', () => {
  for (const key of ARRIVAL_KEYS) {
    for (const [cartons, count] of [[THREE, '3 colis'], [THREE.slice(0, 1), '1 colis']]) {
      const [preview, delivered] = both(DEFAULT_BODIES[key], { cartons });
      assert.equal(preview, delivered, `${key}, ${count}: same text`);
      assert.ok(preview.includes(`nous avons reçu ${count} pour vous`), `${key}, ${count}`);
      assert.ok(preview.startsWith(key.endsWith('_telegram') ? 'Bonjour Flavie 👋\n\n' : 'Bonjour Flavie,\n\n'), key);
      assert.ok(preview.includes(`\n${cartons.length === 3 ? THREE_LINES : '1. Amazon — LP123456789FR — 35,5 × 28 × 18 cm — 2,45 kg'}\n\n`), `${key}, ${count}: the numbered list`);
      assert.doesNotMatch(preview, /\{\{|undefined|NaN/, key);
    }
  }
  const [email] = both(DEFAULT_BODIES.arrivee_colis_facture_email, { cartons: THREE });
  assert.ok(email.includes(`Déposez-les dans les documents de votre dossier (photos ou PDF) : ${APP}/colis/colis-1\n\nCordialement,`), 'The link of the dossier carrying the notice');
});

// The SQL rule of validate_reception: nullif(btrim(value),'') IS NOT NULL. btrim removes only U+0020 at both ends.
const sqlFilled = value => value != null && String(value).replace(/^ +| +$/g, '') !== '';
const CONTACT_VALUES = [null, undefined, '', ' ', '   ', '\t', '\n', ' \t ', ' ', ' ', '﻿', ' 7001 ', '7001'];

test('arrivalChannel: exactly the rule of validate_reception, on the clients of lib/supabaseData.js', () => {
  const channel = row => arrivalChannel(mapClient({ ...clientRow, ...row }));
  assert.equal(channel({}), 'telegram', 'Telegram linked: Telegram, even with an email');
  assert.equal(channel({ email: null }), 'telegram');
  assert.equal(channel({ telegram_chat_id: null }), 'email', 'No Telegram: the email');
  assert.equal(channel({ telegram_chat_id: '' }), 'email', 'An empty chat is no Telegram link');
  assert.equal(channel({ telegram_chat_id: '   ' }), 'email', 'Spaces only: no Telegram link, as btrim says');
  for (const email of [null, '', '   ']) assert.equal(channel({ telegram_chat_id: null, email }), null, `No Telegram and email ${JSON.stringify(email)}: no notice`);
  for (const client of [null, undefined, {}]) assert.equal(arrivalChannel(client), null);
  // btrim keeps a tab or a no-break space: the server sees a value there, so the screen must too (else 40001 each time).
  assert.equal(channel({ telegram_chat_id: '\t' }), 'telegram', 'A tab is a value for btrim: Telegram, as the server decides');
  assert.equal(channel({ telegram_chat_id: ' ' }), 'telegram');
  assert.equal(channel({ telegram_chat_id: null, email: '\t' }), 'email');
  for (const value of CONTACT_VALUES) {
    assert.equal(arrivalChannel({ telegramChatId: value, email: 'flavie@example.test' }), sqlFilled(value) ? 'telegram' : 'email', `chat ${JSON.stringify(value)}`);
    assert.equal(arrivalChannel({ telegramChatId: null, email: value }), sqlFilled(value) ? 'email' : null, `email ${JSON.stringify(value)}`);
  }
});

// A dossier of the reception with its loaded invoices (lib/supabaseData.js mapFact), and the same rows on the server.
const factures = rows => rows.map(row => ({ id: row.id, valide: Boolean(row.valide), fichier: row.fichier_url || null, rejetMotif: row.rejet_motif || null, replacesFactureId: row.replaces_facture_id || null, duplicateOfId: row.duplicate_of_facture_id || null }));
const INVOICE_CASES = [
  ['no invoice yet', [], true],
  ['a validated invoice', [{ id: 'f1', valide: true, fichier_url: 'colis-1/achat.pdf' }], false],
  ['a received document awaiting review (never requested again)', [{ id: 'f1', valide: false, fichier_url: 'colis-1/achat.pdf' }], false],
  ['a rejected invoice to correct', [{ id: 'f1', valide: false, fichier_url: 'colis-1/achat.pdf', rejet_motif: 'Illisible' }], true],
  ['a rejected invoice replaced by a new one', [{ id: 'f1', fichier_url: 'colis-1/a.pdf', rejet_motif: 'Illisible' }, { id: 'f2', fichier_url: 'colis-1/b.pdf', replaces_facture_id: 'f1' }], false],
  ['only a retired copy', [{ id: 'f2', valide: true, fichier_url: 'colis-1/b.pdf', duplicate_of_facture_id: 'f1' }], true],
];

test('arrivalTemplate: the invoice variant follows the « facture manquante » rule, the same as the server', () => {
  for (const [name, rows, requested] of INVOICE_CASES) {
    const dossier = mapColis({ ...colisRow, _factures: factures(rows) });
    assert.equal(invoiceRequested(rows), requested, `${name}: server rule (_shared/invoiceRequest.ts)`);
    assert.equal(arrivalTemplate([dossier]), requested ? 'arrivee_colis_facture' : 'arrivee_colis', name);
    assert.equal(arrivalTemplate([dossier], browserClient), requested ? 'arrivee_colis_facture' : 'arrivee_colis', `${name}, with the client`);
    // As for the consent confirmation, a professional client is never asked for a purchase invoice.
    assert.equal(arrivalTemplate([dossier], { ...browserClient, type: 'pro' }), 'arrivee_colis', `${name}: professional`);
  }
  const complete = mapColis({ ...colisRow, _factures: factures(INVOICE_CASES[1][1]) });
  const missing = mapColis({ ...colisRow, id: 'colis-2', ref: 'EXP-ARR002', _factures: [] });
  assert.equal(arrivalTemplate([complete, missing], browserClient), 'arrivee_colis_facture', 'One dossier of the reception without its invoice is enough.');
  assert.equal(arrivalTemplate([complete, complete], browserClient), 'arrivee_colis');
  assert.equal(arrivalTemplate([], browserClient), 'arrivee_colis');
});

const notice = (overrides = {}) => renderArrivalNotice({ client: browserClient, colisList: [browserColis], cartons: THREE, destination, settings: {}, bodies: {}, ...overrides });

test('renderArrivalNotice: channel, variant and the default body, as validate_reception expects them', () => {
  const telegram = notice();
  assert.deepEqual(Object.keys(plain(telegram)), ['canal', 'template', 'text']);
  assert.equal(telegram.canal, 'telegram');
  assert.equal(telegram.template, 'arrivee_colis_facture', 'No invoice in the dossier yet');
  assert.equal(telegram.text, renderMessage(SERVER_DEFAULTS.arrivee_colis_facture_telegram, clientRow, colisRow, serverDestination, {}, [], [], { cartons: THREE }), 'The server would write the same text');
  assert.ok(telegram.text.includes(`nous avons reçu 3 colis pour vous à notre entrepôt de Paris. Nous vous tenons au courant à chaque étape.\n\n📦 Le détail :\n${THREE_LINES}\n\n`));

  const invoiced = mapColis({ ...colisRow, _factures: factures(INVOICE_CASES[1][1]) });
  const emailClient = mapClient({ ...clientRow, telegram_chat_id: null });
  const email = notice({ client: emailClient, colisList: [invoiced], cartons: THREE.slice(1, 2) });
  assert.deepEqual(plain(email), { canal: 'email', template: 'arrivee_colis', text: renderTemplate(DEFAULT_BODIES.arrivee_colis_email, { client: browserClient, colis: invoiced, destination, reception: { cartons: THREE.slice(1, 2) } }) });
  assert.match(email.text, /^Bonjour Flavie,\n\nBonne nouvelle : nous avons reçu 1 colis pour vous à notre entrepôt de Paris\. Nous vous tenons au courant à chaque étape\.\n\nLe détail :\n1\. SHEIN — SH789 — 40 × 30 × 20 cm — 1,2 kg\n\n/);
  assert.doesNotMatch(email.text, /facture/);
  // The invoice variant by email links the dossier that carries the notice (the first of the reception).
  const second = mapColis({ ...colisRow, id: 'colis-2', ref: 'EXP-ARR002', _factures: [] });
  const emailInvoice = notice({ client: emailClient, colisList: [second, invoiced] });
  assert.equal(emailInvoice.template, 'arrivee_colis_facture');
  assert.ok(emailInvoice.text.includes(`(photos ou PDF) : ${APP}/colis/colis-2\n\nCordialement,\nL’équipe Expedîle`));

  // No contact: nothing to render, the team validates without notice (before any other check).
  for (const client of [mapClient({ ...clientRow, telegram_chat_id: null, email: null }), mapClient({ ...clientRow, telegram_chat_id: '  ', email: '  ' }), null])
    assert.deepEqual(plain(renderArrivalNotice({ client, colisList: [], cartons: [] })), { canal: null });
});

test('renderArrivalNotice: the saved body of the chosen key and channel first, never replaced when it is invalid', () => {
  const saved = 'Salut {{prenom}} ! {{nb_colis_recus}} pour {{ref}} :\n{{liste_colis_recus}}\nL’équipe Expedîle';
  const bodies = { arrivee_colis_facture_telegram: saved, arrivee_colis_facture_email: 'Email {{prenom}}', arrivee_colis_telegram: 'Autre variante {{prenom}}' };
  const result = notice({ bodies });
  assert.equal(result.template, 'arrivee_colis_facture');
  assert.equal(result.text, `Salut Flavie ! 3 colis pour EXP-ARR001 :\n${THREE_LINES}\nL’équipe Expedîle`, 'The saved Telegram body of this variant, with the first dossier of the reception');
  assert.equal(notice({ bodies: { arrivee_colis_facture_email: 'Email {{prenom}}' } }).text, notice({ bodies: undefined }).text, 'A body saved for another channel is not used');
  assert.equal(notice({ bodies: undefined }).text, notice({ bodies: {} }).text);
  // The first dossier carries the message (queue_message on the first item) and feeds {{ref}}.
  const second = mapColis({ ...colisRow, id: 'colis-2', ref: 'EXP-ARR002', _factures: [] });
  assert.match(notice({ bodies, colisList: [second, browserColis] }).text, /pour EXP-ARR002 :/);
  // CLAUDE.md § 7: an unknown variable stops the notice, it is never replaced by the default text.
  assert.throws(() => notice({ bodies: { arrivee_colis_facture_telegram: 'Bonjour {{prenom}} {{colis_recus}}' } }), /Variable de message inconnue : colis_recus/);
});

test('renderArrivalNotice: refuses a notice without dossier, without carton, or longer than 4096 characters', () => {
  assert.throws(() => notice({ cartons: [] }), /aucun colis à annoncer/);
  assert.throws(() => notice({ cartons: undefined }), /aucun colis à annoncer/);
  assert.throws(() => notice({ colisList: [] }), /aucun dossier/);
  assert.throws(() => notice({ colisList: [null] }), /aucun dossier/);
  assert.throws(() => notice({ bodies: { arrivee_colis_facture_telegram: '   ' } }), /Le message est vide/);
  const many = Array.from({ length: 100 }, (_, index) => ({ number: `TRACKING-NUMBER-${String(index).padStart(20, '0')}`, fournisseur: 'Un vendeur au nom assez long', dimL: 100, dimW: 100, dimH: 100, poids: 30 }));
  assert.throws(() => notice({ cartons: many }), /L’avis d’arrivée compte \d+ caractères, 4096 au plus : raccourcissez le modèle ou validez moins de colis à la fois\./);
  const fitting = notice({ cartons: many.slice(0, 30) });
  assert.ok(fitting.text.length > 3000 && fitting.text.length <= 4096, `${fitting.text.length} characters`);
  assert.ok(fitting.text.includes('\n30. Un vendeur au nom assez long — TRACKING-NUMBER-00000000000000000029 — 100 × 100 × 100 cm — 30 kg\n'));
  // A missing destination or settings never breaks the notice.
  assert.equal(notice({ destination: null, settings: null }).text, notice().text);
});

test('the template editor offers both notices and the two variables, so they can be saved', () => {
  const source = readFileSync(new URL('../src/expedile/components/staff/TemplateEditor.jsx', import.meta.url), 'utf8');
  assert.match(source, /\{ key: 'arrivee_colis', label: 'Avis d’arrivée'/);
  assert.match(source, /\{ key: 'arrivee_colis_facture', label: 'Avis d’arrivée, facture d’achat à envoyer'/);
  // The editor refuses to save a body with a variable it does not offer (Variables inconnues).
  const offered = new Map([...source.matchAll(/\{ key: '(\w+)', label: '[^']*', ex: '([^']*)' \}/g)].map(match => [match[1], match[2].replace(/\\n/g, '\n')]));
  for (const key of ARRIVAL_KEYS) for (const [, variable] of DEFAULT_BODIES[key].matchAll(/\{\{(\w+)\}\}/g)) assert.ok(offered.has(variable), `${variable} is offered by the editor`);
  // The editor's examples are what the renderers write.
  const example = [{ number: 'LP123456789FR', fournisseur: 'Amazon', dimL: 35.5, dimW: 28, dimH: 18, poids: 2.45 }, { number: 'SH789', fournisseur: 'SHEIN', dimL: 40, dimW: 30, dimH: 20, poids: 1.2 }];
  assert.deepEqual(both(NEW_VARIABLES, { cartons: example }), [`${offered.get('nb_colis_recus')}\n${offered.get('liste_colis_recus')}`, `${offered.get('nb_colis_recus')}\n${offered.get('liste_colis_recus')}`]);
});

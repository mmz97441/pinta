/* Client dossier detail (/colis/:id in the portal), final review D of 2026-10-07: planned departure, client wording of
 * the next step, missing-invoice explanation, latest news, timeline, contrast, structure, quote without link, consent
 * block, states without their other version, quote PDF and desktop layout. Fictitious data, every request intercepted;
 * light and dark, 390 and 1440 px, axe on the dossier, French typography audit, screenshots of every state. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, fixtures, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_CLIENT_DETAIL_OUT || '/tmp/pinta-client-dossier-detail';
const only = process.env.PINTA_CLIENT_DETAIL_FILTER || '';
const P = ids.P;
const ROOT = '[data-testid="client-dossier-detail"]';
const REGION = 'État actuel et prochaine étape';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const flat = text => String(text).replace(/[\u00a0\u202f]/g, ' ');
const results = [];

// ── Dates as the portal writes them (Paris calendar day for departures, local day otherwise) ──
const parisDay = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + offset * 86400000));
function frenchDay(value, weekday = false) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('fr-FR', { ...(weekday ? { weekday: 'long' } : {}), day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
    .replace(/(^|\s)1(?=\s)/u, (_, space) => `${space}1er`);
}

// ── Fictitious dossier states ──
function snapshot({ total = 87.5, transport = 60, om = 8.2, omr = 2.05, tva = 0, savings = 41.9, mode = 'payplug', type = 'particulier' } = {}) {
  return {
    schemaVersion: 2, currency: 'EUR', mode: 'final', version: 2, createdAt: '2026-10-02T09:30:00Z',
    inputs: {
      colisId: P, reference: 'EXP-TEST-001', description: 'Deux achats à regrouper',
      client: { id: ids.C, type, nom: 'Exemple Camille', email: 'camille@example.test' },
      destination: { code: '974', nom: 'La Réunion', tva: 0 }, paymentTerms: { mode },
      finalBox: { dimL: 40, dimW: 30, dimH: 25, poids: 6.2 }, finalPackages: [{ dimL: 40, dimW: 30, dimH: 25, poids: 6.2 }],
      originalBoxes: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3.4 }, { dimL: 35, dimW: 25, dimH: 25, poids: 2.8 }],
      trackings: ['TEST-001', 'TEST-002'], invoices: [], lines: [], fees: [],
    },
    amounts: { transport, om, omr, tva, total, billableWeight: 7 }, before: { transport: 96, total: 129.4 }, savings, warnings: [],
  };
}
const quote = (over = {}) => ({ devis_brouillon: false, devis_envoye_le: '2026-10-02T09:35:00Z', quote_version: 2, devis_total: 87.5, devis_transport: 60, devis_om: 8.2,
  devis_omr: 2.05, devis_tva: 0, avant_optim_transport: 96, avant_optim_total: 129.4, economie: 41.9, devis_snapshot: snapshot(),
  payplug_payment_url: 'https://secure.payplug.com/pay/fictitious-link', feu_vert: 'autorise', feu_vert_date: '2026-10-01T18:20:00Z', ...over });
const PLANNED = { id: 'e1000000-0000-4000-8000-000000000001', ref: 'ENV-TEST-PLANNED', date_depart: parisDay(10), statut: 'planifie', destination_code: '974', departed_at: null, tracking_principal: null };
const DEPARTED = { id: 'e1000000-0000-4000-8000-000000000002', ref: 'ENV-TEST-DEPARTED', date_depart: '2026-10-03', statut: 'parti', destination_code: '974', departed_at: '2026-10-03T06:00:00Z', tracking_principal: '1Z84A9E30412345678' };
const paid = { paiement_montant: 87.5, paiement_date: '2026-10-02T19:04:00Z' };
const shipped = (statut, over = {}) => ({ ...quote({ payplug_payment_url: null }), ...paid, statut, envoi_id: DEPARTED.id, date_expedition: '2026-10-03T06:00:00Z', statut_updated_at: '2026-10-03T06:00:00Z', ...over });
const perCarton = { dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3.4 }, { dimL: 35, dimW: 25, dimH: 25, poids: 2.8 }], dim_l: 40, dim_w: 30, dim_h: 25, poids: 6.2 };
const MESSAGE = { id: 'aa000000-0000-4000-8000-000000000001', colis_id: P, type: 'staff', auteur_nom: 'Camille — Expedîle', canal: 'portal', statut: 'envoye', texte: 'Nous avons annulé ce dossier comme convenu.', created_at: '2026-10-04T10:00:00Z', lu: true };

/** Fresh fixtures, then the state of the scenario (the route handler reads f.tables in place). */
function reset(f, { colis = {}, factures, envois = [], messages = [], client = {} } = {}) {
  const fresh = fixtures('client');
  for (const key of Object.keys(f.tables)) delete f.tables[key];
  Object.assign(f.tables, fresh);
  Object.assign(f.tables.colis[0], colis);
  if (factures) f.tables.factures = factures;
  f.tables.envois = envois;
  f.tables.messages = messages;
  Object.assign(f.tables.clients[0], client);
}

// ── Audits scoped to the dossier (other portal pages belong to other suites) ──
async function audit(page, theme) {
  return page.evaluate(({ root, theme }) => {
    const scopes = [document.querySelector(root), document.querySelector('#client-documents:not([hidden])')].filter(Boolean);
    const visible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && element.checkVisibility?.() !== false; };
    const typography = []; const apostrophes = []; const dots = [];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue; if (!text?.trim() || !visible(walker.currentNode.parentElement)) continue;
        if (/ [:;!?»]|[A-Za-zÀ-ÿ)][;!?](?![\w])|« (?=\S)/.test(text)) typography.push(text.trim().slice(0, 100));
        if (/[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(text)) apostrophes.push(text.trim().slice(0, 100));
        if (/\.\.\./.test(text)) dots.push(text.trim().slice(0, 100));
      }
    }
    const text = scopes.map(scope => scope.innerText).join('\n');
    const forbidden = ['undefined', 'null', 'NaN', 'Invalid Date', 'attente_paiement', 'devis_envoye', 'en_preparation', 'attente_feu_vert', 'receptionne', 'refuse_client',
      'A-03', 'Casier', 'carton(s)', 'réceptionné(s)', '(2 colis)', 'Dimensions mesurées', 'Étape de dédouanement passée'].filter(word => text.includes(word));
    // A zero amount (« 0,00 € »), read as a whole amount: « 100.00 € » is not one.
    const amounts = [...text.matchAll(/(\d[\d \u00a0\u202f]*[.,]\d{2})[ \u00a0\u202f]?€/g)].map(match => Number(match[1].replace(/[ \u00a0\u202f]/g, '').replace(',', '.')));
    if (amounts.some(value => value === 0)) forbidden.push('montant nul');
    const targets = scopes.flatMap(scope => [...scope.querySelectorAll('button, a[href], summary, input:not([type=hidden]), select, textarea')])
      .filter(visible).map(element => ({ label: (element.getAttribute('aria-label') || element.innerText || element.tagName).trim().slice(0, 50), w: Math.round(element.getBoundingClientRect().width), h: Math.round(element.getBoundingClientRect().height) }))
      .filter(target => target.h < 44 || target.w < 44);
    // Icon contrast (WCAG 1.4.11, 3:1) against the composited background of each icon.
    const parse = value => { const match = /rgba?\(([^)]+)\)/.exec(value || ''); if (!match) return null; const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }; };
    const luminance = ({ r, g, b }) => { const channel = value => { value /= 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }; return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const ratio = (one, two) => { const [high, low] = [luminance(one), luminance(two)].sort((a, b) => b - a); return (high + 0.05) / (low + 0.05); };
    const backgroundOf = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') return null;
        const color = parse(style.backgroundColor);
        if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
      }
      let result = theme === 'dark' ? { r: 28, g: 26, b: 23, a: 1 } : { r: 250, g: 250, b: 246, a: 1 };
      for (const layer of layers.reverse()) result = { r: layer.r * layer.a + result.r * (1 - layer.a), g: layer.g * layer.a + result.g * (1 - layer.a), b: layer.b * layer.a + result.b * (1 - layer.a), a: 1 };
      return result;
    };
    const icons = scopes.flatMap(scope => [...scope.querySelectorAll('svg')]).filter(visible).flatMap(svg => {
      const color = parse(getComputedStyle(svg).color); const background = backgroundOf(svg);
      if (!color || !background || svg.closest('button:disabled')) return [];
      const value = ratio(color, background);
      return value < 3 ? [{ icon: svg.getAttribute('class')?.split(' ').find(name => name.startsWith('lucide-')) || 'svg', near: (svg.parentElement?.innerText || '').trim().slice(0, 40), ratio: Math.round(value * 100) / 100 }] : [];
    });
    // Separators (border-t, border-b, divide-y children) stay a token colour in dark mode, never a white line.
    const separators = scopes.flatMap(scope => [...scope.querySelectorAll('.border-t, .border-b, [class*="divide-y"] > *')]).filter(visible);
    const dividers = separators.flatMap(element => { const style = getComputedStyle(element); return [[style.borderTopWidth, style.borderTopColor], [style.borderBottomWidth, style.borderBottomColor]]; })
      .filter(([width]) => parseFloat(width) > 0).map(([, color]) => luminance(parse(color))).filter(value => theme === 'dark' && value > 0.5);
    return { typography, apostrophes, dots, forbidden, targets, icons, brightDividers: dividers.length, overflow: document.documentElement.scrollWidth > innerWidth + 1, h1: [...document.querySelectorAll('h1')].map(h => h.innerText.trim()) };
  }, { root: ROOT, theme });
}
async function axe(page) {
  const builder = new AxeBuilder({ page }).include(ROOT).withTags(AXE_TAGS);
  if (await page.locator('#client-documents:not([hidden])').count()) builder.include('#client-documents');
  const report = await builder.analyze();
  return report.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target.join(' ')).slice(0, 4) }));
}
const regionText = async f => flat(await f.page.getByRole('region', { name: REGION, exact: true }).innerText());
async function openDetails(f) {
  const summary = f.page.getByText('Suivi et détails de l’expédition', { exact: true });
  if (!await summary.evaluate(element => element.closest('details').open)) await summary.click();
}

// ── States: each check runs in light and dark, at 390 and 1440 px ──
const STATES = [
  { name: 'consentement-deux-cartons', state: { colis: { ...perCarton } }, async check(f) {
    const text = await regionText(f);
    assert.match(text, /2 cartons réceptionnés · dossier EXP-TEST-001/);
    assert.match(text, /Numéros de suivi de vos achats : TEST-001 · TEST-002/);
    assert.match(text, /Votre accord concerne ces 2 cartons uniquement\./);
    assert.equal(await f.page.getByTestId('consent-without-invoice').count(), 0, 'an invoice is in the dossier');
    assert.equal(await f.page.locator(`${ROOT} span.whitespace-nowrap`, { hasText: 'EXP-TEST-001' }).evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap', 'the reference never breaks');
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    const measures = flat(await f.page.getByTestId('carton-measures').innerText());
    assert.match(measures, /Mesures de vos 2 cartons/i); assert.match(measures, /Carton 1 · TEST-001\s+40 × 30 × 20 cm · 3,4 kg/); assert.match(measures, /Carton 2 · TEST-002\s+35 × 25 × 25 cm · 2,8 kg/);
    const how = flat(await f.page.locator(ROOT).getByRole('list').filter({ hasText: 'Vous donnez votre accord' }).innerText());
    assert.match(how, /Vous donnez votre accord avec le bouton « Autoriser la préparation »\./);
  } },
  { name: 'consentement-sans-facture', state: { colis: { ...perCarton }, factures: [] }, async check(f) {
    const block = f.page.getByTestId('consent-without-invoice');
    assert.equal(flat(await block.innerText()), 'Votre facture d’achat n’est pas encore dans votre dossier : vous pouvez tout de même donner votre accord dès maintenant. Joignez-la ensuite dans « Mes factures » : elle nous permet d’établir votre devis.');
    await f.page.getByRole('button', { name: 'Autoriser la préparation', exact: true }).waitFor();
  } },
  { name: 'consentement-mesures-globales', state: { colis: { nb_colis: 3, trackings: ['ZAL-1', 'SHEIN-2', 'SHEIN-3'], trackings_detail: [], dims_par_colis: [], dim_l: 40, dim_w: 30, dim_h: 25, poids: 6.2 } }, async check(f) {
    assert.match(await regionText(f), /3 cartons réceptionnés · dossier EXP-TEST-001/);
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    const measures = flat(await f.page.getByTestId('carton-measures').innerText());
    assert.match(measures, /Mesures de vos 3 cartons/i);
    assert.match(measures, /Ces mesures concernent l’ensemble de vos cartons : 40 × 30 × 25 cm · 6,2 kg\./);
    assert.doesNotMatch(measures, /Carton 1/, 'never shown as one fake box');
  } },
  { name: 'attente-client', state: { colis: { attente_client_date: '2026-10-01T18:00:00Z', attente_client_motif: 'J’attends encore un colis Zalando', attente_client_until: '2099-10-09' } }, async check(f) {
    const text = await regionText(f);
    assert.match(text, /Aucune action attendue de votre part\.\s+Nous conservons vos cartons en attendant vos autres achats\. Quand vous serez prêt\(e\), il vous suffira de donner votre accord pour lancer la préparation\./);
    assert.doesNotMatch(text, /Autoriser la préparation lorsque/);
    assert.match(text, new RegExp(`Votre attente est enregistrée depuis le ${frenchDay('2026-10-01T18:00:00Z')} · Réexamen prévu le ${frenchDay('2099-10-09')}\\.`));
    assert.doesNotMatch(text, /Attente demandée|Attente enregistrée le/, 'one date line, not two');
  } },
  { name: 'facture-attendue-apres-accord', state: { colis: { statut: 'autorise', feu_vert: 'autorise', feu_vert_date: '2026-10-01T18:20:00Z' }, factures: [] }, async check(f) {
    const text = await regionText(f);
    assert.match(text, /À vous · Transmettre mes factures/);
    assert.equal(flat(await f.page.getByTestId('client-task-explanation').innerText()), 'Votre facture d’achat nous permet d’établir votre devis : elle justifie la valeur de vos achats pour le calcul de l’octroi de mer. Dès réception, notre équipe la vérifie puis prépare votre devis.');
    await f.page.getByRole('button', { name: 'Transmettre mes factures', exact: true }).waitFor();
    assert.equal(flat(await f.page.getByTestId('planned-departure').innerText()), 'Votre date de départ n’est pas encore fixée : elle s’affichera ici dès que notre équipe l’aura confirmée.');
    await openDetails(f);
    const consent = f.page.getByRole('button', { name: /^Votre accord/ });
    assert.equal(await consent.locator('text=Étape en cours').count(), 0, 'the consent step is done once given');
    assert.match(await consent.innerText(), /Votre accord/);
    await f.page.getByText('Accord donné', { exact: true }).waitFor();
    await f.page.getByTestId('consent-invoice-reminder').waitFor();
  } },
  { name: 'preparation-depart-prevu', state: { colis: { statut: 'en_preparation', feu_vert: 'autorise', envoi_id: PLANNED.id, depart_souhaite: parisDay(30) }, envois: [PLANNED] }, async check(f) {
    const line = flat(await f.page.getByTestId('planned-departure').innerText());
    assert.equal(line, `Départ prévu : ${frenchDay(PLANNED.date_depart, true)}. Il s’agit du départ, pas de la date de livraison.`);
    assert.doesNotMatch(await regionText(f), new RegExp(frenchDay(parisDay(30)).replace(/\s/g, '\\s')), 'the staff-only desired day never reaches the client');
    assert.match(await regionText(f), /Notre équipe regroupe et réemballe vos achats, puis calcule le prix final ; vous serez prévenu\(e\) dès que votre devis sera prêt\./);
    assert.ok(f.requests.some(request => request.path.endsWith('/rpc/client_planned_departures') && request.input?.p_colis_ids?.join() === P), 'this dossier only');
  } },
  { name: 'devis-avec-lien', state: { colis: { statut: 'attente_paiement', ...quote(), envoi_id: PLANNED.id }, envois: [PLANNED] }, async check(f, { width }) {
    const savings = f.page.getByTestId('quote-savings');
    assert.ok(await savings.isVisible(), 'the real saving is visible without opening the quote detail');
    assert.match(flat(await savings.innerText()), /^Économie réalisée grâce à l’optimisation : 41[.,]90 €$/);
    assert.equal(await f.page.locator('details', { hasText: 'Détail du devis' }).evaluate(element => element.open), false);
    const pay = f.page.getByRole('button', { name: /^Payer / });
    if (width >= 1024) assert.ok((await pay.boundingBox()).width <= 600, 'a comfortable payment width on desktop');
    const pdf = f.page.getByRole('button', { name: 'Télécharger le devis (PDF)', exact: true });
    const surface = await pdf.evaluate(element => { const style = getComputedStyle(element); return { border: style.borderTopColor, width: style.borderTopWidth }; });
    assert.notEqual(surface.width, '0px', 'the PDF action keeps a visible button surface');
    assert.match(flat(await f.page.getByTestId('planned-departure').innerText()), /^Départ prévu : /);
    assert.match(await regionText(f), /Modalités convenues : Carte bancaire sécurisée\./);
  } },
  { name: 'devis-sans-lien', state: { colis: { statut: 'devis_envoye', ...quote({ payplug_payment_url: null }) } }, async check(f) {
    const pending = f.page.getByTestId('payment-link-pending');
    assert.match(flat(await pending.innerText()), /^Votre lien de paiement sécurisé arrive : vous serez prévenu\(e\) dès qu’il est prêt\.\s+Poser une question à l’équipe$/);
    assert.equal(await f.page.getByRole('button', { name: /^Payer |Contacter l’équipe pour le règlement/ }).count(), 0);
  } },
  { name: 'paye-documents', state: { colis: { statut: 'paye', ...quote({ payplug_payment_url: null }), ...paid } }, path: '?panel=documents', async check(f) {
    assert.match(await regionText(f), /Aucune action attendue de votre part\.\s+Merci pour votre règlement ! Notre équipe prépare le départ de votre colis ; vous suivez chaque étape ici\./);
    assert.equal(flat(await f.page.getByTestId('client-deposit-closed').innerText()), 'Votre paiement est enregistré : vos factures sont conservées dans ce dossier et ne peuvent plus être modifiées. Une question ? Écrivez à notre équipe depuis « Messages ».');
    assert.equal(await f.page.getByLabel('Facture ou photo', { exact: true }).count(), 0);
    await openDetails(f);
    const payment = f.page.getByRole('button', { name: /^Paiement/ });
    assert.equal(await payment.locator('text=Étape en cours').count(), 0, 'the payment step is done once received');
  } },
  { name: 'reception', state: { colis: { statut: 'receptionne', feu_vert: null, dim_l: null, dim_w: null, dim_h: null, poids: null } }, async check(f) {
    assert.match(await regionText(f), /Aucune action attendue de votre part\.\s+Notre équipe mesure vos cartons ; vous recevrez ensuite la demande d’accord pour les préparer\./);
    assert.equal(await f.page.getByTestId('planned-departure').count(), 0, 'no departure line before the consent');
  } },
  { name: 'devis-professionnel', state: { colis: { statut: 'devis_envoye', ...quote({ payplug_payment_url: null, mode_paiement_pro: 'virement', economie: 0, devis_snapshot: snapshot({ mode: 'virement', type: 'pro', savings: 0 }) }) }, client: { type: 'pro' } }, async check(f) {
    const text = await regionText(f);
    assert.match(text, /Modalités convenues : Virement bancaire\./);
    assert.match(text, /Référence à communiquer pour le règlement : EXP-TEST-001 · /);
    await f.page.getByRole('button', { name: 'Consulter les échanges de règlement', exact: true }).waitFor();
    assert.equal(await f.page.getByTestId('quote-savings').count(), 0, 'no saving is invented');
    assert.equal(await f.page.getByTestId('payment-link-pending').count(), 0, 'a professional has no card link to wait for');
  } },
  { name: 'expedie-jour-de-depart', state: { colis: shipped('expedie'), envois: [DEPARTED] }, async check(f) {
    assert.equal(flat(await f.page.getByTestId('planned-departure').innerText()), `Départ du ${frenchDay(DEPARTED.date_depart, true)}. Il s’agit du départ, pas de la date de livraison.`);
    const text = await regionText(f);
    assert.doesNotMatch(text, /Dernière nouvelle/, 'the departure is told once');
    await f.page.getByRole('link', { name: 'Suivre mon colis', exact: true }).waitFor();
  } },
  { name: 'transit', state: { colis: shipped('transit', { statut_updated_at: '2026-10-04T08:00:00Z' }), envois: [DEPARTED] }, async check(f) {
    const text = await regionText(f);
    assert.match(text, new RegExp(`Dernière nouvelle : colis en route le ${frenchDay('2026-10-04T08:00:00Z')}\\. La date de livraison vous sera précisée dès qu’elle sera confirmée\\.`));
    assert.match(text, /Votre colis est en route vers votre destination\. Vous suivez chaque étape ici\./);
    assert.equal(await f.page.getByTestId('planned-departure').count(), 0, 'after departure, the latest news speaks');
  } },
  { name: 'douane-derniere-nouvelle', state: { colis: shipped('dedouanement', { statut_updated_at: '2026-10-05T09:00:00Z' }), envois: [DEPARTED] }, async check(f) {
    const text = await regionText(f);
    assert.match(text, new RegExp(`Dernière nouvelle : arrivée en douane le ${frenchDay('2026-10-05T09:00:00Z')}\\. La date de livraison vous sera précisée dès qu’elle sera confirmée\\.`));
    assert.doesNotMatch(text, /expédition enregistrée/i, 'never the stale expedition date');
    assert.equal(text.split('La date de livraison').length - 1, 1, 'the delivery date sentence once');
    assert.match(text, /Notre équipe s’occupe des formalités de douane avant la livraison ; vous n’avez rien à faire\./);
  } },
  { name: 'depot-local', state: { colis: shipped('arrive', { statut_updated_at: '2026-10-06T09:00:00Z' }), envois: [DEPARTED] }, async check(f) {
    const text = await regionText(f);
    assert.match(text, new RegExp(`Dernière nouvelle : arrivée au dépôt local le ${frenchDay('2026-10-06T09:00:00Z')}\\.`));
    assert.doesNotMatch(text, /expédition enregistrée/i);
  } },
  { name: 'livraison-en-cours', state: { colis: shipped('livraison', { statut_updated_at: '2026-10-06T15:00:00Z' }), envois: [DEPARTED] }, async check(f) {
    const text = await regionText(f);
    assert.equal(text.split('sera précisée').length - 1, 1, 'the delivery date is announced once');
  } },
  { name: 'livre', state: { colis: shipped('livre', { date_livraison: '2026-10-06T15:20:00Z', statut_updated_at: '2026-10-06T15:20:00Z' }), envois: [DEPARTED] }, async check(f) {
    const celebration = f.page.getByTestId('delivered-celebration');
    assert.ok(await celebration.isVisible(), 'the delivery is celebrated in the current step');
    assert.match(flat(await celebration.innerText()), new RegExp(`Livré !\\s+Votre colis a bien été livré à La Réunion\\.\\s+Livraison confirmée le ${frenchDay('2026-10-06T15:20:00Z')}\\.`));
    const text = await regionText(f);
    assert.doesNotMatch(text, /Aucune action attendue|Dernière nouvelle/);
    assert.match(text, /Votre colis est bien arrivé\. Merci de votre confiance, et à bientôt pour votre prochain envoi !/);
    await openDetails(f);
    assert.equal(await f.page.locator(ROOT).getByText('Étape en cours', { exact: true }).count(), 0, 'no step still in progress once delivered');
  } },
  { name: 'annule-sans-echange', state: { colis: { statut: 'annule', feu_vert: 'refuse' } }, async check(f) {
    const text = await regionText(f);
    assert.match(text, /Pour toute question sur ce dossier, écrivez à notre équipe depuis « Messages »\./);
    assert.doesNotMatch(text, /Consultez les échanges|figurent dans vos échanges/);
  } },
  { name: 'annule-avec-echange', state: { colis: { statut: 'annule', feu_vert: 'refuse' }, messages: [MESSAGE] }, async check(f) {
    assert.match(await regionText(f), /Les dispositions convenues avec notre équipe figurent dans vos échanges\./);
  } },
  { name: 'refus', state: { colis: { statut: 'refuse_client', feu_vert: 'refuse', feu_vert_date: '2026-10-01T18:20:00Z' } }, async check(f) {
    assert.match(await regionText(f), /Notre équipe vous contactera pour convenir avec vous de la suite de votre dossier\./);
  } },
  { name: 'facture-sans-vendeur', state: { colis: { statut: 'en_preparation', feu_vert: 'autorise' }, factures: [{ id: ids.F, colis_id: P, vendeur: 'ticket-temu.pdf', montant: 0, valide: false, fichier_url: P + '/ticket-temu.pdf', fichier_nom: 'ticket-temu.pdf' }] }, path: '?panel=documents', async check(f) {
    const card = f.page.getByRole('article', { name: 'Facture ticket-temu.pdf', exact: true });
    const text = await card.innerText();
    assert.equal(text.split('ticket-temu.pdf').length - 1, 1, 'the file name appears once');
    assert.match(text, /^Facture d’achat/);
    const deposit = f.page.getByRole('button', { name: 'Déposer la facture', exact: true });
    assert.match(await deposit.getAttribute('class'), /brand-bg/, 'the deposit uses the navy primary');
  } },
];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, { width = 390, theme = 'light' } = {}) {
    // The filter also selects single states inside the « etats-… » passes.
    if (only && !name.includes(only) && !(name.startsWith('etats-') && STATES.some(state => state.name.includes(only)))) return;
    const f = await setup(browser, 'client');
    f.page.setDefaultTimeout(10000);
    await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* the system theme applies */ } }, theme);
    await f.page.setViewportSize({ width, height: 900 });
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await f.login();
      await run(f, { width, theme });
      assert.deepEqual(f.errors, [], 'No uncaught exception');
      assert.deepEqual(f.networkDenied, [], 'No unexpected external request');
      assert.equal(f.requests.some(request => /\/(queue_message|payplug-create|client_decision)$/.test(request.path)), false, 'Opening a dossier never sends, pays or decides');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1;
      results.push({ test: name, pass: false, error: error.stack, url: f.page.url() });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
    } finally { await f.context.close(); }
  }
  try {
    for (const [theme, width] of [['light', 390], ['dark', 390], ['light', 1440], ['dark', 1440]]) {
      await scenario(`etats-${theme}-${width}`, async (f) => {
        assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
        for (const state of STATES) {
          if (only && !`etats-${theme}-${width}`.includes(only) && !state.name.includes(only)) continue;
          reset(f, state.state);
          f.requests.length = 0;
          await f.page.goto(`${base}/colis/${P}${state.path || ''}`);
          await f.page.getByRole('region', { name: REGION, exact: true }).waitFor();
          await f.page.waitForFunction(() => !document.querySelector('[data-testid="planned-departure-loading"]'));
          if (state.path) await f.page.locator('#client-documents:not([hidden]) section').waitFor();
          try { await state.check(f, { theme, width }); } catch (error) { error.message = `${state.name}: ${error.message}`; throw error; }
          const report = await audit(f.page, theme);
          assert.deepEqual(report.h1, ['EXP-TEST-001'], `${state.name}: one h1, the dossier reference`);
          assert.deepEqual(report.forbidden, [], `${state.name}: forbidden text`);
          assert.deepEqual(report.typography, [], `${state.name}: French typography`);
          assert.deepEqual(report.apostrophes, [], `${state.name}: straight apostrophes`);
          assert.deepEqual(report.dots, [], `${state.name}: three dots`);
          assert.deepEqual(report.targets, [], `${state.name}: 44 px targets`);
          assert.deepEqual(report.icons, [], `${state.name}: icon contrast ≥ 3:1`);
          assert.equal(report.brightDividers, 0, `${state.name}: no white divider in dark mode`);
          assert.equal(report.overflow, false, `${state.name}: no horizontal scroll`);
          assert.deepEqual(await axe(f.page), [], `${state.name}: axe`);
          await f.page.screenshot({ path: path.join(output, `${state.name}-${theme}-${width}.png`), fullPage: true });
          // The timeline, opened, in each theme: icons, checks and chevrons on their surfaces.
          if (['facture-attendue-apres-accord', 'livre', 'douane-derniere-nouvelle'].includes(state.name)) {
            await openDetails(f);
            const timeline = await audit(f.page, theme);
            assert.deepEqual(timeline.icons, [], `${state.name}: timeline icon contrast`);
            assert.equal(timeline.brightDividers, 0, `${state.name}: timeline dividers`);
            assert.deepEqual(await axe(f.page), [], `${state.name}: axe with the timeline open`);
            await f.page.locator(ROOT).getByText('Suivi et détails de l’expédition', { exact: true }).scrollIntoViewIfNeeded();
            await f.page.screenshot({ path: path.join(output, `${state.name}-suivi-${theme}-${width}.png`), fullPage: true });
          }
        }
      }, { theme, width });
    }

    // ── Interactions ──
    await scenario('dialogues-accord-refus-attente', async (f) => {
      reset(f, { colis: { ...perCarton }, factures: [] });
      await f.page.goto(`${base}/colis/${P}`);
      const authorize = f.page.getByRole('button', { name: 'Autoriser la préparation', exact: true });
      const dialog = f.page.getByRole('dialog');
      await authorize.click(); await dialog.waitFor();
      const consent = flat(await dialog.innerText());
      assert.match(consent, /avec 2 cartons actuellement réceptionnés\./);
      assert.match(consent, /dossier EXP\u2011TEST\u2011001, avec/, 'the reference cannot break across lines');
      assert.match(consent, /Votre facture d’achat reste à joindre : elle nous permet d’établir votre devis\./);
      await f.page.screenshot({ path: path.join(output, 'dialogue-accord-390.png') });
      await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await authorize.click(); await dialog.waitFor();
      await f.page.getByRole('button', { name: 'Fermer la confirmation', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await authorize.click(); await dialog.waitFor();
      await f.page.mouse.click(195, 30); await dialog.waitFor({ state: 'detached' });
      await f.page.getByRole('button', { name: 'Refuser la préparation', exact: true }).click(); await dialog.waitFor();
      const refusal = flat(await dialog.innerText());
      assert.match(refusal, /vos cartons ne seront pas préparés\. Notre équipe vous contactera pour convenir avec vous de la suite\./);
      assert.match(refusal, /dossier EXP\u2011TEST\u2011001 : vos cartons/);
      assert.match(refusal, /Pour simplement attendre d’autres achats, choisissez plutôt « Attendre d’autres achats »\./);
      assert.equal(await f.page.getByRole('button', { name: 'Attendre d’autres achats', exact: true }).count(), 1, 'the named button exists exactly');
      await f.page.screenshot({ path: path.join(output, 'dialogue-refus-390.png') });
      await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await f.page.getByRole('button', { name: 'Attendre d’autres achats', exact: true }).click();
      assert.match(flat(await f.page.locator('form').filter({ hasText: 'Votre précision' }).innerText()), /Nous conservons vos cartons et suspendons nos relances\. Cette demande ne déclenche aucune préparation : vous donnerez votre accord quand vous serez prêt\(e\)\./);
    });
    for (const [theme, width] of [['light', 390], ['dark', 1440]]) await scenario(`apercu-facture-fond-${theme}-${width}`, async (f) => {
      reset(f, { colis: { statut: 'en_preparation', feu_vert: 'autorise' }, factures: [{ id: ids.F, colis_id: P, vendeur: 'Ticket Temu', montant: 0, valide: false, fichier_url: P + '/ticket-temu.jpg', fichier_nom: 'ticket-temu.jpg' }] });
      await f.page.goto(`${base}/colis/${P}?panel=documents`);
      const preview = f.page.getByRole('dialog', { name: 'Ticket Temu', exact: true });
      const open = async () => { await f.page.getByRole('button', { name: 'Voir le document', exact: true }).click(); await preview.waitFor(); };
      await open();
      await f.page.screenshot({ path: path.join(output, `apercu-facture-${theme}-${width}.png`) });
      const backdrop = await f.page.getByTestId('invoice-preview-backdrop').boundingBox();
      await f.page.mouse.click(backdrop.x + 8, backdrop.y + backdrop.height - 8); await preview.waitFor({ state: 'detached' });
      await open(); await f.page.keyboard.press('Escape'); await preview.waitFor({ state: 'detached' });
      await open(); await f.page.getByRole('button', { name: 'Fermer l’aperçu', exact: true }).click(); await preview.waitFor({ state: 'detached' });
    }, { theme, width });
    await scenario('depart-indisponible-puis-reessai', async (f) => {
      reset(f, { colis: { statut: 'paye', ...quote({ payplug_payment_url: null }), ...paid, envoi_id: PLANNED.id }, envois: [PLANNED] });
      let fail = true;
      await f.context.route('**/rest/v1/rpc/client_planned_departures', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Indisponibilité simulée"}' }) : route.fallback());
      await f.page.goto(`${base}/colis/${P}`);
      const line = f.page.getByTestId('planned-departure');
      await line.filter({ hasText: 'n’a pas pu être chargée' }).waitFor();
      assert.doesNotMatch(flat(await line.innerText()), /pas encore fixée/, 'a failure is never shown as « no date yet »');
      assert.deepEqual(await axe(f.page), []);
      await f.page.screenshot({ path: path.join(output, 'depart-indisponible-dark-1440.png') });
      fail = false;
      await line.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await line.filter({ hasText: 'Départ prévu' }).waitFor();
      assert.equal(flat(await line.innerText()), `Départ prévu : ${frenchDay(PLANNED.date_depart, true)}. Il s’agit du départ, pas de la date de livraison.`);
    }, { theme: 'dark', width: 1440 });
    await scenario('depart-passe-jamais-annonce', async (f) => {
      reset(f, { colis: { statut: 'paye', ...quote({ payplug_payment_url: null }), ...paid, envoi_id: 'e1000000-0000-4000-8000-000000000009' }, envois: [{ ...PLANNED, id: 'e1000000-0000-4000-8000-000000000009', date_depart: parisDay(-3) }] });
      await f.page.goto(`${base}/colis/${P}`);
      await f.page.getByTestId('planned-departure').filter({ hasText: 'pas encore fixée' }).waitFor();
      assert.doesNotMatch(await regionText(f), new RegExp(frenchDay(parisDay(-3), true)), 'a past departure is never announced');
    });
    for (const theme of ['light', 'dark']) await scenario(`description-longue-${theme}`, async (f) => {
      const description = 'Chaussures de randonnée, veste imperméable, sac à dos 40 L et accessoires de camping pour toute la famille, avec deux tentes légères';
      reset(f, { colis: { desc_contenu: description } });
      await f.page.goto(`${base}/colis/${P}`);
      const toggle = f.page.getByRole('button', { name: 'Lire toute la description', exact: true });
      await toggle.waitFor();
      const paragraph = f.page.locator('#client-dossier-description');
      assert.ok(await paragraph.evaluate(element => element.scrollHeight > element.clientHeight + 1), 'clamped at first');
      await toggle.click();
      await f.page.getByRole('button', { name: 'Réduire la description', exact: true }).waitFor();
      assert.equal(await paragraph.evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, 'readable in full');
      assert.equal(flat(await paragraph.innerText()), description);
      await f.page.screenshot({ path: path.join(output, `description-longue-${theme}-390.png`), clip: { x: 0, y: 0, width: 390, height: 360 } });
    }, { theme });
    await scenario('pdf-devis', async (f) => {
      reset(f, { colis: { statut: 'attente_paiement', ...quote() } });
      await f.page.goto(`${base}/colis/${P}`);
      const download = f.page.waitForEvent('download');
      await f.page.getByRole('button', { name: 'Télécharger le devis (PDF)', exact: true }).click();
      const file = await download;
      assert.equal(file.suggestedFilename(), 'devis-EXP-TEST-001-v2.pdf');
      const target = path.join(output, 'devis-EXP-TEST-001-v2.pdf');
      await file.saveAs(target);
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(target)), standardFontDataUrl, isEvalSupported: false }).promise;
      const items = (await (await pdf.getPage(1)).getTextContent()).items.map(item => flat(item.str)).filter(text => text.trim());
      assert.ok(items.includes('Expedîle — Service de réexpédition Paris – DOM-TOM'), 'readable footer');
      assert.ok(items.includes('TOTAL : 87,50 €') && items.includes('60,00 €') && items.includes('Octroi de mer régional (OMR)'));
      assert.ok(!items.some(text => /^TVA|(^|\s)0[,.]00 €/.test(text)), 'no zero tax row for a particulier');
      // Rendered page 1 for the visual check (pdf.js served locally, no network).
      const viewer = await f.context.newPage();
      const pdfjsBuild = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build');
      await viewer.route('http://pdf.local/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (name === 'view.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="c"></canvas><script type="module">import * as pdfjs from "./pdf.min.mjs"; pdfjs.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs"; const doc = await pdfjs.getDocument({ url: "./devis.pdf" }).promise; const page = await doc.getPage(1); const viewport = page.getViewport({ scale: 1.6 }); const canvas = document.getElementById("c"); canvas.width = viewport.width; canvas.height = viewport.height; await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; document.title = "done";</script></body>' });
        if (name === 'devis.pdf') return route.fulfill({ contentType: 'application/pdf', body: await fs.readFile(target) });
        return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(pdfjsBuild, name)) });
      });
      await viewer.setViewportSize({ width: 960, height: 1300 });
      await viewer.goto('http://pdf.local/view.html');
      await viewer.waitForFunction(() => document.title === 'done', null, { timeout: 20000 });
      await viewer.screenshot({ path: path.join(output, 'pdf-devis-page1.png'), fullPage: true });
      await viewer.close();
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

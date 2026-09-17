import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { calculateQuote, quoteInputFingerprint } from '../../src/expedile/domain/quote.js';

const container = process.env.PINTA_DB_CONTAINER || 'pinta-customs-quote-db';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const db = sql => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], { input: sql, encoding: 'utf8' });
const id = (kind, number) => `fe${kind}00000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const category = { id: id(4, 1), label: 'Parity legacy category', taux: { 974: { om: 10, omr: 2.5 } } };
const destination = { code: '974', nom: 'La Réunion', tva: 8.5 };
const source = { id: 'customs-parity', label: 'Parity source', url: 'https://example.test/reference.pdf', date: '2025-12-18', page: 410, status: 'reference' };
const cases = [
  { base: { om: 20, omr: 3 }, rates: { om: 20, omr: 3 }, reason: null },
  { base: { om: 20, omr: 3 }, rates: { om: 5, omr: 0 }, reason: 'Correction vérifiée du devis' },
  { base: { om: null, omr: null }, rates: { om: 0, omr: 0 }, reason: 'Exonération explicitement vérifiée' },
  { base: { om: 20, omr: 3 }, rates: { om: 3.1234, omr: 0.0125 }, reason: 'Taux à quatre décimales vérifiés' },
  { base: { om: 20, omr: 3 }, rates: { om: 20, omr: 3 }, reason: null, withoutCategory: true },
];
const sql = ['BEGIN;', 'GRANT USAGE ON SCHEMA public,auth TO authenticated;', 'GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;',
  `INSERT INTO auth.users(id,email) VALUES(${literal(id(1, 1))},'customs-parity@example.test');`,
  `INSERT INTO staff_users(auth_id,nom,email,role) VALUES(${literal(id(1, 1))},'Customs parity','customs-parity@example.test','directeur');`,
  "UPDATE tarifs SET base=12.34,par_kg=8.76 WHERE destination_code='974' AND actif;",
  "UPDATE destinations SET nom='La Réunion',tva=8.5,actif=true WHERE code='974';",
  "UPDATE app_settings SET value=jsonb_set(value,'{diviseurVolumetrique}','5000') WHERE key='business';",
  `INSERT INTO categories(id,label) VALUES(${literal(category.id)},${literal(category.label)});`,
  `INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES(${literal(category.id)},'974',10,2.5);`,
];
const expected = [];
for (const [index, choice] of cases.entries()) {
  const n = index + 1;
  const client = { id: id(2, n), nom: `Customs parity ${n}`, cp: '97400', type: 'particulier' };
  const invoiceId = id(5, n);
  const line = { id: id(6, n), factureId: invoiceId, desc: 'Original article', qte: 3, prix: 17.13, cat: choice.withoutCategory ? null : category.id };
  const rawLine = { id: line.id, colis_id: id(3, n), facture_id: invoiceId, description: line.desc, qte: line.qte, prix_unitaire: line.prix, categorie_id: line.cat };
  const fingerprint = db(`SELECT customs_line_fingerprint(jsonb_populate_record(NULL::lignes,${json(rawLine)}));`).trim();
  const duty = { tariffId: `parity-${n}`, code: n === 4 ? '8516797001' : '85167970', label: `Official designation ${n}`, destination: '974', baseRates: choice.base, rates: choice.rates, source, notes: null, conditions: n === 3 ? 'Conditional source' : null, overrideReason: choice.reason, fingerprint };
  line.customDuty = duty;
  const packages = [{ dimL: 31.2, dimW: 20.5, dimH: 15.1, poids: 2.37 }, { dimL: 12, dimW: 10, dimH: 8, poids: 0.78 }];
  const reception = [{ dimL: 40, dimW: 40, dimH: 30, poids: 4.17 }, { dimL: 20, dimW: 20, dimH: 10, poids: 2.34 }];
  const colis = { id: id(3, n), ref: `CUSTOMS-PARITY-${n}`, feuVert: 'autorise', statut: 'en_preparation', finalPackages: packages, outgoingParcelCount: 2, preparationCompositionVersion: 0, finalMeasurementsVersion: 0, dimsParColis: reception, nbColis: 2, trackings: ['FIRST', 'SECOND'], fraisDivers: [{ libelle: 'Emballage', montant: 1.23 }], factures: [{ id: invoiceId, montant: 51.39, valide: true, fichier: 'parity.pdf' }], lignes: [line] };
  const quote = calculateQuote({ colis, client, destination, tarif: { base: 12.34, parKg: 8.76 }, categories: [category], settings: { diviseurVolumetrique: 5000 } });
  assert.equal(quote.ok, true, JSON.stringify(quote.errors));
  expected.push(quote);
  sql.push('RESET ROLE;',
    `INSERT INTO clients(id,nom,cp,type) VALUES(${literal(client.id)},${literal(client.nom)},'97400','particulier');`,
    `INSERT INTO colis(id,ref,client_id,statut,feu_vert,trackings,nb_colis,dims_par_colis) VALUES(${literal(colis.id)},${literal(colis.ref)},${literal(client.id)},'en_preparation','autorise',ARRAY['FIRST','SECOND'],2,${json(reception)});`,
    `INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES(${literal(invoiceId)},${literal(colis.id)},'Parity',51.39,'parity.pdf',true);`,
    `INSERT INTO lignes(id,colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES(${literal(line.id)},${literal(colis.id)},${literal(invoiceId)},${literal(line.desc)},3,17.13,${line.cat ? literal(line.cat) : 'NULL'});`,
    `INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status,conditions) VALUES(${literal(duty.tariffId)},${literal(duty.code)},${literal(duty.label)},'974',${choice.base.om ?? 'NULL'},${choice.base.omr ?? 'NULL'},${literal(source.id)},${literal(source.label)},${literal(source.url)},${literal(source.date)},410,'reference',${duty.conditions ? literal(duty.conditions) : 'NULL'});`,
    'SET LOCAL ROLE authenticated;',
    `SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',${literal(id(1, 1))},true);`,
    `SELECT save_quote_customs(id,${json([{ lineId: line.id, tariffId: duty.tariffId, override: choice.reason ? { ...choice.rates, reason: choice.reason } : null }])},updated_at) FROM colis WHERE id=${literal(colis.id)};`,
    `SELECT save_preparation_measurements(id,${json(packages)},updated_at,preparation_composition_version) FROM colis WHERE id=${literal(colis.id)};`,
    `SELECT jsonb_build_object('parityCase',${index},'snapshot',save_quote(id,${json({ ...quote.snapshot, ...quote.patch, finalPackages: packages, fraisDivers: colis.fraisDivers })},updated_at)->'colis'->'devis_snapshot') FROM colis WHERE id=${literal(colis.id)};`,
  );
}
sql.push('RESET ROLE;', 'ROLLBACK;');
const snapshots = db(sql.join('\n')).split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(row => 'parityCase' in row);
assert.equal(snapshots.length, cases.length);
for (const row of snapshots) {
  const quote = expected[row.parityCase];
  assert.equal(quoteInputFingerprint(row.snapshot), quoteInputFingerprint(quote.snapshot), `canonical quote fingerprint case ${row.parityCase}`);
  for (const field of ['transport', 'om', 'omr', 'tva', 'total', 'fees', 'merchandiseValue']) assert.equal(row.snapshot.amounts[field], quote.amounts[field], `${field} case ${row.parityCase}`);
  for (const field of ['transport', 'om', 'omr', 'tva', 'total']) assert.equal(row.snapshot.before[field], quote.before[field], `before ${field} case ${row.parityCase}`);
}
console.log(`PASS: ${cases.length} customs JS/PostgreSQL cases; full quote fingerprints, source evidence, overrides, ambiguous exemptions, four-decimal rates, absent legacy category and before/after totals agree. Fixtures rolled back.`);

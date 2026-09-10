// Optional local PostgreSQL integration test. All fixtures are rolled back.
// Run after run-migrations.sh: node supabase/tests/quote-parity.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { calculateQuote } from '../../src/expedile/domain/quote.js';

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const id = (kind, index) => `${kind}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const staff = id(6, 1);
const categories = [
  { id: id(7, 1), label: 'Parity category A', taux: { 974: { om: 10, omr: 2.5 } } },
  { id: id(7, 2), label: 'Parity category B', taux: { 974: { om: 5, omr: 0 } } },
];
const destination = { code: '974', nom: 'La Réunion', tva: 8.5 };
const tarif = { base: 12.34, parKg: 8.76 };
const cases = [];
for (const type of ['particulier', 'pro']) {
  for (const divisor of [5000, 6000]) {
    for (const shape of [
      { finL: 10, finW: 10, finH: 10, finP: 2.37 },
      { finL: 40, finW: 30, finH: 20, finP: 1.11 },
      { finL: 31.2, finW: 20.5, finH: 15.1, finP: 5.17 },
    ]) {
      for (const fee of [0, 1.23]) cases.push({ type, divisor, shape, fee });
    }
  }
}
const sql = [
  'BEGIN;',
  'GRANT USAGE ON SCHEMA public,auth TO authenticated;',
  'GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;',
  'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;',
  `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${literal(staff)},'parity@example.test','{}');`,
  `INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES(${literal(staff)},'Parity','parity@example.test','directeur',false);`,
  `UPDATE tarifs SET base=${tarif.base},par_kg=${tarif.parKg} WHERE destination_code='974' AND actif;`,
  `UPDATE destinations SET tva=8.5,actif=true WHERE code='974';`,
];
for (const category of categories) {
  sql.push(`INSERT INTO categories(id,label) VALUES(${literal(category.id)},${literal(category.label)});`);
  sql.push(`INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES(${literal(category.id)},'974',${category.taux[974].om},${category.taux[974].omr});`);
}
for (const [index, item] of cases.entries()) {
  const client = { id: id(8, index + 1), nom: `Parity ${index + 1}`, cp: '97400', type: item.type };
  const factureId = id(4, 1000 + index);
  const originalBoxes = [
    { dimL: 40, dimW: 40, dimH: 30, poids: 4.17 },
    { dimL: 20, dimW: 20, dimH: 10, poids: 2.34 },
  ];
  const colis = {
    id: id(9, index + 1), ref: `PARITY-${index + 1}`, ...item.shape, modePaiementPro: 'virement',
    dimsParColis: originalBoxes, trackings: ['FIRST', 'SECOND'],
    fraisDivers: item.fee ? [{ libelle: "Emballage d'essai", montant: item.fee }] : [],
    factures: item.type === 'pro' ? [] : [{ id: factureId, montant: 91.31, valide: true, fichier: 'parity/document.pdf' }],
    lignes: item.type === 'pro' ? [] : [
      { id: id(3, 1000 + index * 2), factureId, desc: 'Article A', qte: 3, prix: 17.13, cat: categories[0].id },
      { id: id(3, 1001 + index * 2), factureId, desc: 'Article B', qte: 2, prix: 19.96, cat: categories[1].id },
    ],
  };
  const quote = calculateQuote({ colis, client, destination, tarif, categories, settings: { diviseurVolumetrique: item.divisor } });
  assert.equal(quote.ok, true, JSON.stringify(quote.errors));
  sql.push('RESET ROLE;');
  sql.push(`UPDATE app_settings SET value=jsonb_set(value,'{diviseurVolumetrique}',${json(String(item.divisor))}) WHERE key='business';`);
  sql.push(`INSERT INTO clients(id,nom,cp,type) VALUES(${literal(client.id)},${literal(client.nom)},'97400',${literal(client.type)});`);
  sql.push(`INSERT INTO colis(id,client_id,statut,trackings,nb_colis,dims_par_colis) VALUES(${literal(colis.id)},${literal(client.id)},'en_preparation',ARRAY['FIRST','SECOND'],2,${json(originalBoxes)});`);
  if (item.type === 'particulier') {
    sql.push(`INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES(${literal(factureId)},${literal(colis.id)},'Parity',91.31,'parity/document.pdf',true);`);
    for (const line of colis.lignes) sql.push(`INSERT INTO lignes(id,colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES(${literal(line.id)},${literal(colis.id)},${literal(factureId)},${literal(line.desc)},${line.qte},${line.prix},${literal(line.cat)});`);
  }
  sql.push('SET LOCAL ROLE authenticated;');
  sql.push(`SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',${literal(staff)},true);`);
  sql.push(`SELECT save_quote(${literal(colis.id)},${json({ ...quote.snapshot, ...quote.patch, ...item.shape, fraisDivers: colis.fraisDivers, modePaiementPro: 'virement' })});`);
  const expected = {
    devis_transport: quote.amounts.transport, devis_om: quote.amounts.om, devis_omr: quote.amounts.omr,
    devis_tva: quote.amounts.tva, devis_total: quote.amounts.total, poids_facturable: quote.patch.poidsFact,
    avant_optim_transport: quote.before.transport, avant_optim_total: quote.before.total, economie: quote.snapshot.savings,
  };
  const checks = Object.entries(expected).map(([key, value]) => `${key}=${value}`).join(' AND ');
  sql.push(`DO $$ BEGIN IF NOT (SELECT ${checks} FROM colis WHERE id=${literal(colis.id)}) THEN RAISE EXCEPTION 'JS/PostgreSQL parity failed: case ${index + 1} (${item.type}, divisor ${item.divisor})'; END IF; END $$;`);
}
sql.push('RESET ROLE;', 'ROLLBACK;');
execFileSync('docker', ['exec', '-i', process.env.PINTA_DB_CONTAINER || 'pinta-finalisation-db', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null'], { input: sql.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
console.log(`PASS: ${cases.length} JS/PostgreSQL quote cases; transport, taxes, fees, billable weight, before/after and savings match. Fixtures rolled back.`);

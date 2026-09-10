// Run after migrations 00018/00019. Local PostgreSQL only; every fixture rolls back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { calculateQuote } from '../../src/expedile/domain/quote.js';

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const staff = '61000000-0000-4000-8000-000000000099';
const client = '81000000-0000-4000-8000-000000000099';
const first = { dimL: 80, dimW: 10, dimH: 10, poids: 1 };
const second = { dimL: 10, dimW: 80, dimH: 10, poids: 1 };
const shapes = [
  { name: 'distinct axes multi', nbColis: 2, dimsParColis: [first, second] },
  { name: 'legacy singleton', nbColis: 1, dimsParColis: [] },
  { name: 'legacy multi without individual data', nbColis: 2, dimsParColis: [] },
  { name: 'legacy multi with one measured carton', nbColis: 3, dimsParColis: [first] },
  { name: 'explicit unknown singleton', nbColis: 1, dimsParColis: [null] },
  { name: 'legacy malformed measurement', nbColis: 2, dimsParColis: [first, { ...second, poids: 'inconnu' }] },
  { name: 'legacy numeric strings are canonical numbers', nbColis: 2, dimsParColis: [Object.fromEntries(Object.entries(first).map(([key, value]) => [key, String(value)])), second] },
];
const cases = shapes.flatMap(shape => [5000, 6000].map(divisor => ({ ...shape, divisor })));
const sql = ['BEGIN;',
  'GRANT USAGE ON SCHEMA public,auth TO authenticated;',
  'GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;',
  'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;',
  `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${literal(staff)},'reception-parity@example.test','{}');`,
  `INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES(${literal(staff)},'Reception parity','reception-parity@example.test','directeur',false);`,
  `INSERT INTO clients(id,nom,cp,type) VALUES(${literal(client)},'Reception parity','97400','pro');`,
  "UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974' AND actif;",
];
for (const [index, item] of cases.entries()) {
  const colis = { id: `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, ...item, ...first, trackings: [], finL: 40, finW: 20, finH: 10, finP: 2, modePaiementPro: 'virement' };
  const quote = calculateQuote({ colis, client: { id: client, type: 'pro', cp: '97400' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 }, settings: { diviseurVolumetrique: item.divisor } });
  assert.equal(quote.ok, true, item.name);
  sql.push('RESET ROLE;', `UPDATE app_settings SET value=jsonb_set(value,'{diviseurVolumetrique}',${json(String(item.divisor))}) WHERE key='business';`);
  sql.push(`INSERT INTO colis(id,client_id,statut,nb_colis,trackings,dims_par_colis,dim_l,dim_w,dim_h,poids) VALUES(${literal(colis.id)},${literal(client)},'en_preparation',${item.nbColis},ARRAY[]::text[],${json(item.dimsParColis)},80,10,10,1);`);
  sql.push('SET LOCAL ROLE authenticated;', `SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',${literal(staff)},true);`);
  sql.push(`SELECT save_quote(${literal(colis.id)},${json({ ...quote.snapshot, ...quote.patch, finL: 40, finW: 20, finH: 10, finP: 2, modePaiementPro: 'virement' })});`);
  const expectedBefore = quote.before ? `(devis_snapshot->'before'->>'transport')::numeric=${quote.before.transport}` : "devis_snapshot->'before'='null'::jsonb";
  sql.push(`DO $$ BEGIN IF NOT (SELECT devis_total=${quote.amounts.total} AND economie=${quote.patch.economie} AND avant_optim_transport=${quote.patch.avantOptimTransport} AND ${expectedBefore} AND devis_snapshot->'inputs'->'originalBoxes'=${json(quote.snapshot.inputs.originalBoxes)} AND fin_l=40 AND fin_w=20 AND fin_h=10 AND fin_p=2 FROM colis WHERE id=${literal(colis.id)}) THEN RAISE EXCEPTION 'Reception/quote parity failed: ${item.name}, divisor ${item.divisor}'; END IF; END $$;`);
}
sql.push('RESET ROLE;', 'ROLLBACK;');
execFileSync('docker', ['exec', '-i', process.env.PINTA_DB_CONTAINER || 'pinta-finalisation-db', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null'], { input: sql.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
console.log(`PASS: ${cases.length} reception/quote JS/PostgreSQL cases; reception coverage, original volumes and final measures remain separate. Fixtures rolled back.`);

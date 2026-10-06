import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';
import { exportDossierTableExcel } from '../src/expedile/utils/exportExcel.js';

XLSX.set_fs(fs);
async function workbook(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'expedile-table-export-'));
  try { await run(path.join(directory, 'dossiers.xlsx')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('downloaded workbook contains precisely current columns with genuine numeric payment cells', () => workbook(async filename => {
  const dossiers = [{ id: 'partial', ref: 'EXP-PARTIAL', clientId: 'client', devisTotal: 999 }, { id: 'initial', ref: 'EXP-INITIAL', clientId: 'client', devisTotal: 0 }];
  const clients = [{ id: 'client', nom: 'Camille Test', tel: '0600000000', email: 'private@example.test', adresse: 'Adresse masquée' }];
  const models = new Map([['partial', { payment: { requested: 100, paid: 30, remaining: 70, sentAt: '2026-10-01T22:30:00Z' } }], ['initial', { payment: { requested: null, paid: 0, remaining: null, sentAt: null, stateLabel: 'À calculer' } }]]);
  const columns = [{ key: 'ref', label: 'Référence' }, { key: 'requested', label: 'Demandé' }, { key: 'paid', label: 'Payé' }, { key: 'remaining', label: 'Reste à payer' }, { key: 'sentAt', label: 'Devis envoyé le' }, { key: 'email', label: 'Email' }];
  exportDossierTableExcel([...dossiers, dossiers[0]], clients, models, 'payments', columns, filename);
  const book = XLSX.readFile(filename, { cellNF: true });
  assert.deepEqual(book.SheetNames, ['Dossiers']);
  const sheet = book.Sheets.Dossiers;
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [
    { Référence: 'EXP-PARTIAL', Demandé: 100, Payé: 30, 'Reste à payer': 70, 'Devis envoyé le': '02/10/2026' },
    { Référence: 'EXP-INITIAL', Demandé: 'À calculer', Payé: 0, 'Reste à payer': 'À calculer', 'Devis envoyé le': 'Non renseigné' },
  ]);
  assert.equal(sheet.B2.t, 'n'); assert.match(sheet.B2.z, /€/);
  assert.equal(sheet.B3.t, 's'); assert.equal(sheet.C3.v, 0); assert.equal(sheet.C3.t, 'n');
  assert.doesNotMatch(JSON.stringify(XLSX.utils.sheet_to_json(sheet)), /private|060000|masquée|999/);
}));

test('empty selection retains only visible headers without creating a fake dossier', () => workbook(async filename => {
  exportDossierTableExcel([], [], new Map(), 'daily', [{ key: 'ref', label: 'Référence' }, { key: 'owner', label: 'Qui s’en occupe' }], filename);
  const book = XLSX.readFile(filename);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Dossiers, { header: 1 }), [['Référence', 'Qui s’en occupe']]);
}));

test('export keeps client text as text, without interpreting a formula or including other view fields', () => workbook(async filename => {
  const dossier = { id: 'one', ref: 'EXP-ONE', clientId: 'client', responsibleStaffId: 'wrong-referent' };
  exportDossierTableExcel([dossier], [{ id: 'client', nom: '=1+1' }], new Map([['one', { ownerName: 'Marie Test' }]]), 'daily', [{ key: 'client', label: 'Client' }, { key: 'owner', label: 'Qui s’en occupe' }, { key: 'paid', label: 'Payé' }], filename);
  const sheet = XLSX.readFile(filename).Sheets.Dossiers;
  assert.equal(sheet.A2.v, '=1+1'); assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.f, undefined);
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [{ Client: '=1+1', 'Qui s’en occupe': 'Marie Test' }]);
}));

test('« Accords clients » exports its visible columns as text, with the consent wording of the screen', () => workbook(async filename => {
  const dossiers = [
    { id: 'waiting', ref: 'EXP-WAIT', clientId: 'client', statut: 'attente_feu_vert', attenteClientDate: '2026-10-03T08:00:00Z', attenteClientUntil: '2026-10-25T08:00:00Z', demandeFeuVertEnvoyeeAt: '2026-10-01T22:30:00Z', casier: 'C-4', nbColis: 2,
      messages: [{ template: 'demande_feu_vert', statut: 'envoye', createdAt: '2026-10-01T22:30:00Z' }, { template: 'relance_feu_vert', statut: 'envoi', canal: 'telegram', createdAt: '2026-10-02T09:00:00Z' }] },
    { id: 'submit', ref: 'EXP-SUBMIT', clientId: 'client', statut: 'receptionne', devisTotal: 999 },
  ];
  const models = new Map([['waiting', { departure: { label: 'Prévu le 08/10/2026' } }], ['submit', { departure: { label: 'Souhaité le 19/11/2026 · à créer' } }]]);
  const columns = [{ key: 'ref', label: 'Référence' }, { key: 'consentState', label: 'Accord' }, { key: 'consentRequestedAt', label: 'Demande envoyée le' }, { key: 'lastRelanceAt', label: 'Dernière relance' }, { key: 'casier', label: 'Casier' }, { key: 'departure', label: 'Départ prévu' }, { key: 'requested', label: 'Prix du devis', priceKind: 'quote' }, { key: 'statusLabel', label: 'Statut du dossier' }];
  exportDossierTableExcel(dossiers, [{ id: 'client', nom: 'Payet Flavie', email: 'private@example.test' }], models, 'accords', columns, filename);
  const sheet = XLSX.readFile(filename).Sheets.Dossiers;
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [
    // The request of 1 October 22:30 UTC is on 2 October in Réunion; a relance still pending says so.
    { Référence: 'EXP-WAIT', Accord: 'Le client attend · jusqu’au 25/10', 'Demande envoyée le': '02/10/2026', 'Dernière relance': '02/10/2026 · En attente de livraison', Casier: 'C-4', 'Départ prévu': 'Prévu le 08/10/2026' },
    { Référence: 'EXP-SUBMIT', Accord: 'À soumettre', 'Demande envoyée le': 'Non renseigné', 'Dernière relance': 'Non renseigné', Casier: 'À renseigner', 'Départ prévu': 'Souhaité le 19/11/2026 · à créer' },
  ], 'No price or status column of another view reaches this export.');
  assert.equal(sheet.C2.t, 's');assert.doesNotMatch(JSON.stringify(XLSX.utils.sheet_to_json(sheet)), /private|999/);
}));

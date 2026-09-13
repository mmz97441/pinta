import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
XLSX.set_fs(fs);
import { exportColisExcel } from '../src/expedile/utils/exportExcel.js';
import { exportDAUData } from '../src/expedile/utils/exportDAU.js';

test('spreadsheet export contains real clients, financial columns and suppliers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'expedile-export-'));
  try {
    const filename = path.join(directory, 'colis.xlsx');
    exportColisExcel(
      [
        {
          ref: 'EXP-001',
          clientId: 'c',
          statut: 'en_preparation',
          devisTransport: 42,
          devisTotal: 55,
          trackingsDetail: [{ fournisseur: 'Boutique' }],
        },
      ],
      [{ id: 'c', nom: 'Camille Exemple' }],
      undefined,
      filename,
    );
    const book = XLSX.readFile(filename);
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Colis);
    assert.equal(rows[0].Client, 'Camille Exemple');
    assert.equal(rows[0]['Transport (€)'], 42);
    assert.equal(rows[0]['Total (€)'], 55);
    assert.equal(rows[0].Fournisseurs, 'Boutique');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('customs export never invents a plausible code for an unclassified article', () => {
  assert.throws(
    () =>
      exportDAUData(
        {},
        [{ ref: 'EXP-001', lignes: [{ desc: 'Article', cat: 'c', qte: 1, prix: 10 }] }],
        [],
        [{ id: 'c', label: 'Divers' }],
      ),
    /Codes douaniers manquants/,
  );
});

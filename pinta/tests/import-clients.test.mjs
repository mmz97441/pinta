import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseClientFile } from '../src/expedile/utils/importClients.js';

const csv = 'Nom;Prénom;Email;Téléphone;Code postal;Date naissance\nLéon;Camille;camille+colis@example.test;0262123456;97400;01/02/1990';
const makeFile = (content, name = 'clients.csv', type = 'text/csv') => new File([content], name, { type });
const verifyClient = (result) => {
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].nom, 'Léon');
  assert.equal(result.clients[0].prenom, 'Camille');
  assert.equal(result.clients[0].email, 'camille+colis@example.test');
  assert.equal(result.clients[0].tel, '0262123456');
  assert.equal(result.clients[0].cp, '97400');
  assert.equal(result.clients[0].dateNaissance, '1990-02-01');
  assert.deepEqual(result.unmapped, []);
};

test('CSV UTF-8 without BOM preserves accented headers, leading zeros and dates', async () => {
  verifyClient(await parseClientFile(makeFile(csv)));
});

test('CSV UTF-8 BOM and text/plain MIME remain importable', async () => {
  verifyClient(await parseClientFile(makeFile('\ufeff' + csv, 'clients.csv', 'text/plain')));
});

test('CSV Windows-1252 from older Excel exports preserves names and euro signs', async () => {
  const input = Buffer.from(csv + ';\n', 'latin1');
  const result = await parseClientFile(makeFile(input));
  assert.equal(result.clients[0].nom, 'Léon');
  assert.equal(result.clients[0].prenom, 'Camille');
  assert.equal(result.clients[0].tel, '0262123456');
  const withEuro = Buffer.from('Nom;Email;Notes\nL\xe9on;leon@example.test;Frais 10 \x80', 'latin1');
  assert.equal((await parseClientFile(makeFile(withEuro))).clients[0].notes, 'Frais 10 €');
});

test('CSV UTF-16 little and big endian with BOM preserve columns', async () => {
  const little = Buffer.from('\ufeff' + csv, 'utf16le');
  const big = Buffer.from(little).swap16();
  verifyClient(await parseClientFile(makeFile(little)));
  verifyClient(await parseClientFile(makeFile(big)));
});

test('XLSX and XLS workbook imports keep their binary parsing', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Nom: 'Léon', Prénom: 'Camille', Email: 'camille+colis@example.test', Téléphone: '0262123456', 'Code postal': '97400', 'Date naissance': '01/02/1990' }]), 'Clients');
  for (const format of ['xlsx', 'xls']) {
    const bytes = XLSX.write(book, { bookType: format, type: 'buffer' });
    verifyClient(await parseClientFile(makeFile(bytes, `clients.${format}`, format === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')));
  }
});

test('Importer rejects unsupported MIME and oversized files before parsing', async () => {
  await assert.rejects(parseClientFile(makeFile(csv, 'clients.pdf', 'application/pdf')), /Format non supporté/);
  await assert.rejects(parseClientFile({ size: 10 * 1024 * 1024 + 1 }), /trop volumineux/);
});

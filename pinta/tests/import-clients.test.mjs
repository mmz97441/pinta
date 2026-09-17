import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseClientFile, detectDuplicates } from '../src/expedile/utils/importClients.js';

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


test('Manual mapping restores unrecognised headers and rejects invalid email before import', async () => {
 const file=makeFile('Customer;Contact\nCamille;camille@example.test\nIncorrect;invalid');
 const parsed=await parseClientFile(file,{Customer:'nom',Contact:'email'});
 assert.equal(parsed.clients.length,1);assert.equal(parsed.clients[0]._sourceRow,2);assert.match(parsed.errors[0],/email invalide/);
});
test('Importer detects duplicate emails within the same file without creating anything',()=>{
 const result=detectDuplicates([{nom:'A',email:'same@example.test'},{nom:'B',email:'SAME@example.test'}],[]);
 assert.equal(result[0].duplicate,null);assert.equal(result[1].duplicate.nom,'A');
});

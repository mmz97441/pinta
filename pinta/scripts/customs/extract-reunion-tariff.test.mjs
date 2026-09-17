import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { classifyCode, extractPage, buildCatalogue, parsePercent, pathBounds } from './extract-reunion-tariff.mjs';

const source = { id: 'source-test', destination: '974', label: 'Source test', url: 'https://example.org/source.pdf', date: '2025-12-18' };
const item = (text, x, y, index, h = 6.004) => ({ text, x, y, h, index });
const columns = [0, 50, 300, 330, 360, 390, 420, 455, 520];
function pageFixture() {
  const items = [item('EXTERNE', 310, 790, 0), ...['OME', 'OMER', 'OMI', 'OMIR'].map((label, i) => item(label, columns[i + 2] + 3, 778, i + 1)),
    item('2008 99 49 80', 2, 756, 5), item('10,50 %', 303, 756, 6), item('2,50 %', 333, 756, 7),
    item('0,00 %', 363, 756, 8), item('0,00 %', 393, 756, 9),
    item('2008 99 51', 2, 742, 10), item('Libellé de la deuxième ligne', 52, 742, 11),
    item('4,00 %', 303, 742, 12), item('2,50 %', 333, 742, 13),
    // The PDF stream puts wrapped labels AFTER the other cells, in a contiguous run.
    item('Fruits et autres parties, pita-', 52, 758, 14), item('hayas)', 52, 751.3, 15)];
  const paths = [...columns.map(x => [x, 640, x, 800]), ...[770, 755, 735].map(y => [0, y, 520, y])];
  return { items, paths };
}

test('reads external columns, and reattaches a wrapped label overflowing its row', () => {
  const result = extractPage(...Object.values(pageFixture()), 471, 62);
  assert.equal(result.rows[0].code, '2008994980');
  assert.deepEqual([result.rows[0].om, result.rows[0].omr], [10.5, 2.5]);
  assert.equal(result.rows[0].label, 'Fruits et autres parties, pita-\nhayas)');
  assert.equal(result.rows[1].label, 'Libellé de la deuxième ligne');
  assert.equal(result.audit.relocated.length, 1);
  assert.equal(result.audit.unassignedBodyFragments, 0);
});

test('fails closed when OME/OMER headers are exchanged with internal columns', () => {
  const fixture = pageFixture();
  fixture.items.find(item => item.text === 'OME').x = 363;
  assert.throws(() => extractPage(fixture.items, fixture.paths, 1, 1), /external\/internal/);
});

test('blank percentages stay unknown; malformed or out-of-range percentages fail', () => {
  assert.equal(parsePercent(''), null);
  assert.equal(parsePercent('0,00 %'), 0);
  assert.equal(parsePercent('2,50 %'), 2.5);
  assert.throws(() => parsePercent('exonéré'), /Unrecognised/);
  assert.throws(() => parsePercent('101 %'), /Out-of-range/);
});

test('case-insensitive EX and ten-digit subcodes retain their full source identity', () => {
  assert.deepEqual(classifyCode('Ex 2710 12 45'), { kind: 'nc8', code: '27101245', nc8: '27101245', exception: true });
  assert.deepEqual(classifyCode('EX 2309 90 51 90'), { kind: 'subcode', code: '2309905190', nc8: '23099051', exception: true });
  assert.deepEqual(classifyCode('EX CHAP 84'), { kind: 'scope-rule', prefix: '84', exception: true });
});

const raw = (sourceCode, label, om, omr, row, extra = {}) => ({ sourceCode, label, om, omr,
  row, page: 410, annexPage: 1, list: '', observations: '', ...classifyCode(sourceCode), ...extra });
test('preserves variants, excludes empty labels and never assigns a common rate to ambiguous NC8', () => {
  const result = buildCatalogue([
    raw('0106 19 00', 'Mammifères vivants', 4, 2.5, 1), raw('EX 0106 19 00', 'Cervidés vivants', 0, 0, 2),
    raw('EX 1702 60 10', '', 0, 0, 3), raw('8503 00 20', 'Tôles', null, null, 4),
    raw('EX CHAP 85', 'Équipements pour les personnes handicapées', 0, 0, 5),
    raw('2007 99 97 10', 'Purée et compote de pomme', 10.5, 2.5, 6),
  ], source);
  assert.equal(result.rows.length, 4);
  assert.equal(result.excluded[0].reason, 'missing-source-label');
  assert.equal(result.rows.find(row => row.code === '85030020').om, null);
  assert.match(result.rows.find(row => row.code === '85030020').conditions, /EX CHAP 85/);
  assert.match(result.rows.find(row => row.id.endsWith('-r2')).conditions, /EX :/);
  assert.equal(result.rows.find(row => row.code === '2007999710').code.length, 10);
  assert.ok(result.index.every(entry => entry.rates === null));
});

test('rate-bearing unknown headings fail rather than disappearing from the catalogue', () => {
  assert.throws(() => buildCatalogue([raw('TYPO 0101', 'Unknown', 0, 0, 1)], source), /Unrecognised/);
  assert.throws(() => buildCatalogue([raw('0101', 'Heading', 0, 0, 1)], source), /Rate-bearing heading/);
});

test('source footnotes and explicit hybrid-vehicle definition remain attached to relevant rows', () => {
  const result = buildCatalogue([raw('0405 20 10', 'Pâte', 0, 0, 1, { list: 'A (1)' }),
    raw('8703 40 10', 'Véhicule', 4, 2.5, 2)], source,
  [{ page: 730, annexPage: 321, text: '(1) hors produits POSEI\nLes véhicules hybrides (HEV) du 870340 au 870370 sont définis comme étant équipés de deux moteurs.' }]);
  assert.match(result.rows[0].conditions, /hors produits POSEI/);
  assert.match(result.rows[1].conditions, /deux moteurs/);
});

test('path boundaries respect graphics transforms and restore', () => {
  const paths = pathBounds({ fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore, OPS.constructPath],
    argsArray: [[], [2, 0, 0, 3, 10, 20], [null, null, [1, 2, 4, 5]], [], [null, null, [1, 2, 4, 5]]] });
  assert.deepEqual(paths, [[12, 26, 18, 35], [1, 2, 4, 5]]);
});

test('published dataset keeps audited coverage, source anomalies and external-rate visual samples', async () => {
  const dataset = JSON.parse(await fs.readFile(new URL('../../data/customs/reunion-2026.json', import.meta.url), 'utf8'));
  assert.equal(dataset.source.sha256, 'd0b700238edf07a96de788f7bc03b54769a3908efaa232580bf6a6a3a459d3d6');
  assert.equal(dataset.source.id, 'reunion-2026-dcp2026-0296');
  assert.deepEqual([dataset.source.firstPage, dataset.source.lastPage], [26, 346]);
  assert.equal(dataset.records.length, 10790);
  assert.equal(dataset.records.filter(row => row.code.length === 10).length, 27);
  assert.equal(new Set(dataset.records.map(row => row.id)).size, dataset.records.length);
  assert.equal(dataset.audit.excluded.length, 1);
  assert.equal(dataset.audit.excluded[0].sourceCode, 'EX 1702 60 10');
  assert.equal(dataset.audit.labelReconstruction.fragments, 661);
  const find = (code, match = () => true) => dataset.records.find(row => row.code === code && match(row));
  assert.deepEqual([find('09012100').om, find('09012100').omr], [15.5, 2.5]);
  assert.deepEqual([find('96190050').om, find('96190050').omr], [1, 4]);
  assert.deepEqual([find('61091000').om, find('61091000').omr], [4, 2.5]);
  assert.deepEqual([find('33049900', r => r.label.startsWith('Produits')).om, find('33049900', r => r.label.startsWith('Crèmes')).om], [20.5, 3]);
  assert.equal(find('85030020').om, null);
  assert.equal(find('87039000', r => r.om === null).omr, null);
  assert.match(find('2008994980').label, /pita-\nhayas\)$/);
  assert.equal(dataset.records.filter(row => row.code === '87039000').length, 5);
  const diagnostic = dataset.records.filter(row => row.code === '30063000');
  assert.equal(diagnostic.length, 2);
  assert.deepEqual(diagnostic.map(row => [row.om, row.omr]), [[3, 2], [0, 0]]);
  assert.match(diagnostic[1].label, /Radiopharmaceutique injectable marqué au fluor-18/);
  assert.match(diagnostic[1].conditions, /EX :/);
  assert.equal(diagnostic[1].page, 136);
});

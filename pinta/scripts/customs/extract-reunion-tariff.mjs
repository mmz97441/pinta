#!/usr/bin/env node
/**
 * Extract the Reunion tariff's EXTERNAL OME/OMER columns from its vector grid.
 * This is a source transcription, not a customs classification or a legal update.
 * See README.md for the supported layout, provenance and unresolved source cells.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SCHEMA_VERSION = 1;
const EPSILON = 0.6;
const round = n => Math.round(n * 1000) / 1000;
const unique = numbers => [...numbers].sort((a, b) => a - b).filter((n, i, all) => i === 0 || n - all[i - 1] > EPSILON);
const identity = () => [1, 0, 0, 1, 0, 0];

export function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** PDF.js 6 exposes constructPath bounding boxes in the current graphics space. */
export function pathBounds(operatorList) {
  const result = [], stack = [];
  let matrix = identity();
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const operation = operatorList.fnArray[i], args = operatorList.argsArray[i];
    if (operation === OPS.save) stack.push([...matrix]);
    else if (operation === OPS.restore) matrix = stack.pop() || identity();
    else if (operation === OPS.transform) matrix = multiply(matrix, args);
    else if (operation === OPS.constructPath && args?.[2]?.length === 4) {
      const [x1, y1, x2, y2] = args[2];
      const points = [[x1, y1], [x1, y2], [x2, y1], [x2, y2]]
        .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
      result.push([Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
        Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]);
    }
  }
  return result;
}

export function linesOf(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find(l => Math.abs(l.y - item.y) < 0.5);
    if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => line.items.sort((a, b) => a.x - b.x).map(i => i.text.trim()).join(' '));
}
const cellText = items => linesOf(items).join('\n').trim();

export function parsePercent(value) {
  if (!value.trim()) return null;
  if (!/^\d+(?:[,.]\d+)?\s*%$/.test(value.trim())) throw new Error(`Unrecognised printed percentage: ${JSON.stringify(value)}`);
  const number = Number(value.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`Out-of-range percentage: ${value}`);
  return number;
}

export function classifyCode(sourceCode) {
  const compact = sourceCode.replace(/\s/g, '').toUpperCase();
  const exception = compact.startsWith('EX');
  const digits = compact.replace(/^EX/, '');
  if (/^\d{8}(?:\d{2})?$/.test(digits)) {
    return { kind: digits.length === 10 ? 'subcode' : 'nc8', code: digits, nc8: digits.slice(0, 8), exception };
  }
  const scope = /^EX(?:CHAP(?:ITRE)?)?(\d{2}|\d{4}|\d{6})$/.exec(compact);
  if (scope) return { kind: 'scope-rule', prefix: scope[1], exception: true };
  if (/^\d{2}(?:\d{2}){0,2}$/.test(digits) || /^(?:SECTION|CHAPITRE)/.test(compact)) return { kind: 'heading' };
  return { kind: 'unknown' };
}

/**
 * Some source paragraphs physically overflow the next row. PDF text order is
 * otherwise unsuitable for sorting cells, but contiguous label runs with the
 * source's line-height cadence identify these paragraphs. Start baseline chooses
 * the owner row; all relocated fragments remain in the audit. No word guessing.
 */
export function assignLabels(items, rows, columns, boundaries) {
  const groups = [];
  let group = null, previous = null;
  for (const item of items) {
    const inLabel = item.x >= columns[1] && item.x < columns[2]
      && item.y < boundaries[0] && item.y > boundaries.at(-1) - 10;
    if (!inLabel) { group = null; previous = null; continue; }
    const sameLine = previous && Math.abs(previous.y - item.y) < 0.4;
    const wrapped = previous && Math.abs((previous.y - item.y) - previous.h * 1.115) < 0.3;
    if (!group || !(sameLine || wrapped)) { group = []; groups.push(group); }
    group.push(item); previous = item;
  }
  const relocated = [], unassigned = [];
  for (const row of rows) row.cells[1] = [];
  for (const paragraph of groups) {
    const first = paragraph[0];
    const owner = rows.find(row => first.y > row.bottom + 0.1 && first.y < row.top - 0.1);
    if (!owner) { unassigned.push(...paragraph); continue; }
    for (const item of paragraph) {
      owner.cells[1].push(item);
      if (item.y < owner.bottom || item.y > owner.top) {
        relocated.push({ row: owner.row, sourceCode: cellText(owner.cells[0]), text: item.text,
          baseline: round(item.y), rowBottom: round(owner.bottom), itemIndex: item.index });
      }
    }
  }
  return { relocated, unassigned };
}

export function extractPage(items, paths, pageNumber, annexPage) {
  const columns = unique(paths.filter(b => b[2] - b[0] < 0.1 && b[3] - b[1] > 100).map(b => b[0]));
  if (columns.length !== 9) throw new Error(`Page ${pageNumber}: expected 9 table boundaries, got ${columns.length}`);
  const headerNames = ['OME', 'OMER', 'OMI', 'OMIR'];
  const headers = headerNames.map(name => items.find(i => i.text === name));
  if (headers.some((item, index) => !item || item.x < columns[index + 2] || item.x >= columns[index + 3])) {
    throw new Error(`Page ${pageNumber}: external/internal rate header positions do not match the supported layout`);
  }
  if (!items.some(i => /EXTERNE/.test(i.text) && i.x >= columns[2] && i.x < columns[4])) {
    throw new Error(`Page ${pageNumber}: no EXTERNE header above OME/OMER`);
  }
  const boundaries = unique(paths.filter(b => b[3] - b[1] < 0.1 && b[0] < columns[1]
    && b[2] > columns[2] - 0.5 && b[1] < headers[0].y).map(b => b[1])).sort((a, b) => b - a);
  if (boundaries.length < 2) throw new Error(`Page ${pageNumber}: no row grid`);
  const rows = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const top = boundaries[i], bottom = boundaries[i + 1];
    const rowItems = items.filter(t => t.y > bottom + 0.1 && t.y < top - 0.1);
    const cells = columns.slice(0, -1).map((left, j) => rowItems.filter(t => t.x >= left - 0.3 && t.x < columns[j + 1] - 0.3));
    if (cells.some(c => c.length)) rows.push({ page: pageNumber, annexPage, row: i + 1, top, bottom, cells });
  }
  const { relocated, unassigned } = assignLabels(items, rows, columns, boundaries);
  const assigned = new Set(rows.flatMap(row => row.cells.flat().map(i => i.index)));
  const bodyUnassigned = items.filter(i => i.y > boundaries.at(-1) && i.y < boundaries[0] && !assigned.has(i.index));
  // Anything in the table must be explained. Footer notes intentionally sit below it.
  if (bodyUnassigned.length || unassigned.some(i => i.y > boundaries.at(-1))) {
    throw new Error(`Page ${pageNumber}: ${bodyUnassigned.length} unexplained body fragments`);
  }
  const footerItems = items.filter(i => i.y < boundaries.at(-1) && !assigned.has(i.index)
    && !/^Page\s+\d+\s+de\s+\d+$/.test(i.text));
  return {
    rows: rows.map(row => {
      const cells = row.cells.map(cellText);
      const sourceCode = cells[0].replace(/\s+/g, ' ').trim();
      return { page: row.page, annexPage, row: row.row, sourceCode, label: cells[1],
        om: parsePercent(cells[2]), omr: parsePercent(cells[3]), rawOME: cells[2], rawOMER: cells[3],
        list: cells[6], observations: cells[7], ...classifyCode(sourceCode),
        reconstructedLabel: relocated.some(item => item.row === row.row) };
    }),
    audit: { page: pageNumber, annexPage, columns: columns.map(round), rows: rows.length,
      headerColumns: { OME: 2, OMER: 3, OMI: 4, OMIR: 5 }, relocated, unassignedBodyFragments: bodyUnassigned.length },
    notes: footerItems.length ? { page: pageNumber, annexPage, text: cellText(footerItems) } : null,
  };
}

export function buildCatalogue(extractedRows, source, pageNotes = []) {
  const rules = extractedRows.filter(row => row.kind === 'scope-rule');
  const leafRows = extractedRows.filter(row => row.kind === 'nc8' || row.kind === 'subcode');
  const unknown = extractedRows.filter(row => row.kind === 'unknown');
  if (unknown.length) throw new Error(`Unrecognised source codes: ${unknown.map(r => `${r.page}:${r.sourceCode}`).join(', ')}`);
  if (extractedRows.some(row => row.kind === 'heading' && (row.om !== null || row.omr !== null))) {
    throw new Error('Rate-bearing heading was not classified as an explicit scope rule');
  }
  const excluded = leafRows.filter(row => !row.label).map(row => ({ ...row, reason: 'missing-source-label' }));
  const footnotes = new Map(pageNotes.flatMap(note => [...note.text.matchAll(/^\((\d+)\) (.+)$/gm)]
    .map(match => [match[1], { text: match[2], page: note.page }])));
  const vehicleDefinition = pageNotes.map(note => ({ ...note,
    match: note.text.match(/Les véhicules hybrides \(HEV\) du (\d{6}) au (\d{6})[\s\S]+$/) })).find(note => note.match);
  const rows = leafRows.filter(row => row.label).map(row => {
    const applicableRules = rules.filter(rule => row.code.startsWith(rule.prefix));
    const footnoteIds = [...new Set([...`${row.list} ${row.observations}`.matchAll(/\((\d+)\)/g)].map(match => match[1]))];
    const vehiclePrefix = Number(row.code.slice(0, 6));
    const conditions = [
      row.exception ? `EX : taux limité aux marchandises décrites dans ce libellé (${row.sourceCode}).` : '',
      row.kind === 'subcode' ? `Sous-code de ${row.nc8} : conserver les 10 chiffres ${row.code}.` : '',
      ...applicableRules.map(rule => `Exception de portée ${rule.sourceCode} : ${rule.label.replace(/\n/g, ' ')} (OME ${rule.om ?? 'non renseigné'} %, OMER ${rule.omr ?? 'non renseigné'} % ; PDF p. ${rule.page}, annexe p. ${rule.annexPage}). Ne pas appliquer automatiquement cette exception.`),
      ...footnoteIds.filter(id => footnotes.has(id)).map(id => `Note de liste/observation (${id}) : ${footnotes.get(id).text} (PDF p. ${footnotes.get(id).page}).`),
      vehicleDefinition && vehiclePrefix >= Number(vehicleDefinition.match[1]) && vehiclePrefix <= Number(vehicleDefinition.match[2])
        ? `Définition de la source (PDF p. ${vehicleDefinition.page}) : ${vehicleDefinition.match[0].replace(/\n/g, ' ')}` : '',
      row.om === null || row.omr === null ? 'Taux externe absent de cette ligne source : vérification et correction explicite nécessaires.' : '',
    ].filter(Boolean).join('\n');
    const notes = [`Code imprimé : ${row.sourceCode}. Annexe p. ${row.annexPage}, ligne ${row.row}.`,
      row.observations, row.list ? `Liste indiquée dans la source : ${row.list}.` : '',
    ].filter(Boolean).join('\n');
    return { id: `${source.id}-p${row.page}-r${row.row}`, code: row.code, label: row.label,
      destination_code: source.destination, om: row.om, omr: row.omr,
      source_id: source.id, source_label: source.label, source_url: source.url, source_date: source.date,
      page: row.page, source_status: 'reference', notes, conditions };
  });
  const codes = new Map();
  for (const row of leafRows) {
    if (!codes.has(row.nc8)) codes.set(row.nc8, []);
    codes.get(row.nc8).push(row);
  }
  const index = [...codes].map(([nc8, variants]) => {
    const ruleIds = rules.filter(rule => nc8.startsWith(rule.prefix)).map(rule => `p${rule.page}-r${rule.row}`);
    const uniqueRates = new Set(variants.map(row => `${row.om}/${row.omr}`));
    // A single printed exception is still conditional, even if there is only one numeric pair.
    const unambiguous = variants.every(row => row.label && !row.exception && row.kind === 'nc8' && row.om !== null && row.omr !== null)
      && uniqueRates.size === 1 && ruleIds.length === 0;
    return { nc8, records: variants.filter(row => row.label).map(row => `p${row.page}-r${row.row}`),
      scopeRules: ruleIds, rates: unambiguous ? { om: variants[0].om, omr: variants[0].omr } : null,
      requiresClassification: !unambiguous };
  });
  return { rows, rules, excluded, index, notes: pageNotes, stats: {
    extractedRows: extractedRows.length, nc8Occurrences: leafRows.filter(row => row.kind === 'nc8').length,
    subcodeOccurrences: leafRows.filter(row => row.kind === 'subcode').length,
    explicitExceptionOccurrences: leafRows.filter(row => row.exception).length,
    distinctNC8: codes.size, duplicateNC8: [...codes.values()].filter(v => v.length > 1).length,
    NC8WithDifferentRates: [...codes.values()].filter(v => new Set(v.map(row => `${row.om}/${row.omr}`)).size > 1).length,
    scopeRules: rules.length, excludedMissingLabels: excluded.length, selectableRows: rows.length,
    missingExternalRates: rows.filter(row => row.om === null || row.omr === null).map(row => ({ id: row.id, code: row.code, page: row.page })),
  } };
}

export async function extractTariff(options) {
  const bytes = await fs.readFile(options.input);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const loadingTask = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const document = await loadingTask.promise;
  const first = Number(options.firstPage || 1), last = Number(options.lastPage || document.numPages);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > document.numPages || first > last) throw new Error('Invalid page range');
  const source = { id: options.sourceId, label: options.sourceLabel, url: options.sourceUrl || null,
    date: options.sourceDate, destination: options.destination || '974', file: path.basename(options.input),
    sha256, pdfPages: document.numPages, firstPage: first, lastPage: last, annexPages: last - first + 1,
    rateColumns: { om: 'OME — EXTERNE (à l’importation)', omr: 'OMER — EXTERNE (à l’importation)' },
    status: 'reference', applicability: 'Transcription de la source indiquée ; ne garantit pas l’absence de modifications postérieures.' };
  const all = [], pageAudits = [], notes = [];
  for (let n = first; n <= last; n++) {
    const page = await document.getPage(n);
    const [textContent, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const items = textContent.items.filter(i => i.str?.trim()).map((i, index) => ({ text: i.str,
      x: i.transform[4], y: i.transform[5], h: i.height, w: i.width, index }));
    const result = extractPage(items, pathBounds(operatorList), n, n - first + 1);
    all.push(...result.rows); pageAudits.push(result.audit); if (result.notes) notes.push(result.notes);
    page.cleanup();
  }
  await loadingTask.destroy();
  const catalogue = buildCatalogue(all, source, notes);
  const labelReconstruction = { fragments: pageAudits.reduce((total, p) => total + p.relocated.length, 0),
    rows: pageAudits.reduce((total, p) => total + new Set(p.relocated.map(r => r.row)).size, 0),
    rule: 'Contiguous PDF label text with source line-height cadence; ownership from the first baseline. Original hyphens and line breaks preserved.' };
  const output = { schemaVersion: SCHEMA_VERSION, source, stats: catalogue.stats, records: catalogue.rows,
    audit: { labelReconstruction, excluded: catalogue.excluded, unassignedBodyFragments: 0 },
    scopeRules: catalogue.rules, sourceNotes: catalogue.notes };
  const audit = { schemaVersion: SCHEMA_VERSION, source, stats: catalogue.stats,
    labelReconstruction,
    excluded: catalogue.excluded, pages: pageAudits, nc8Index: catalogue.index };
  return { output, audit };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, audit: { type: 'string' },
    'first-page': { type: 'string' }, 'last-page': { type: 'string' },
    'source-id': { type: 'string' }, 'source-label': { type: 'string' },
    'source-url': { type: 'string' }, 'source-date': { type: 'string' }, destination: { type: 'string', default: '974' },
  } });
  for (const name of ['input', 'output', 'audit', 'source-id', 'source-label', 'source-date']) {
    if (!values[name]) throw new Error(`Missing --${name}. See scripts/customs/README.md.`);
  }
  const { output, audit } = await extractTariff({ input: values.input, firstPage: values['first-page'], lastPage: values['last-page'],
    sourceId: values['source-id'], sourceLabel: values['source-label'], sourceUrl: values['source-url'],
    sourceDate: values['source-date'], destination: values.destination });
  for (const [filename, data] of [[values.output, output], [values.audit, audit]]) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(data) + '\n');
  }
  process.stdout.write(JSON.stringify({ source: output.source, stats: output.stats, labelReconstruction: audit.labelReconstruction }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}

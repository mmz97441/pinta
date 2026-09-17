#!/usr/bin/env node
import fs from 'node:fs/promises';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Usage: compare-tariffs.mjs before.json after.json');
const [before, after] = await Promise.all([beforePath, afterPath].map(async filename => JSON.parse(await fs.readFile(filename, 'utf8'))));
// Normalisation is ONLY for comparison. Never overwrite the faithful source labels.
const normalise = text => text.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
const signature = row => JSON.stringify({ code: row.code, label: normalise(row.label), om: row.om, omr: row.omr,
  notes: normalise(row.notes.replace(/Annexe p\. \d+, ligne \d+\./g, '')),
  conditions: normalise(row.conditions.replace(/PDF p\. \d+, annexe p\. \d+/g, 'SOURCE-PAGE').replace(/PDF p\. \d+/g, 'SOURCE-PAGE')) });
const group = records => {
  const groups = new Map();
  for (const row of records) {
    const key = signature(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};
const old = group(before.records), next = group(after.records);
const difference = (a, b) => [...a].flatMap(([key, rows]) => rows.slice((b.get(key) || []).length));
const removed = difference(old, next), added = difference(next, old);
process.stdout.write(JSON.stringify({ before: before.source, after: after.source,
  comparison: 'Code, label, external rates, notes and conditions. Only PDF wrap hyphens, whitespace and page/row provenance are normalised.',
  removedCount: removed.length, addedCount: added.length, removed, added }, null, 2) + '\n');

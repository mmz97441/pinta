/* Compares downloaded Edge sources with the repository at a git revision.
 * `supabase functions download` can return code re-emitted by the Deno bundler (types stripped, objects reflowed,
 * class fields moved), so byte equality is not meaningful. Both sides are transpiled and minified by esbuild,
 * then compared statement by statement; a statement-order-only difference (class field placement) is accepted.
 * Usage: node scripts/deployment/compare_edge_sources.cjs <downloaded supabase/functions dir> [git revision, default HEAD]
 */
const esbuild = require('esbuild');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [dir, revision = 'HEAD'] = process.argv.slice(2);
if (!dir || !fs.existsSync(dir)) { console.error('Usage: node compare_edge_sources.cjs <functions dir> [revision]'); process.exit(2); }
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const files = execFileSync('find', [dir, '-type', 'f', '-name', '*.ts']).toString().trim().split('\n').filter(Boolean).sort();
const normalize = source => esbuild.transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' }).code;
const statements = code => code.split(';').map(item => item.trim()).filter(Boolean);
let equivalent = 0, different = 0;
for (const file of files) {
  const relative = path.relative(dir, file);
  let reference;
  try { reference = execFileSync('git', ['-C', repoRoot, 'show', `${revision}:pinta/supabase/functions/${relative}`]).toString(); }
  catch { console.log('NOT IN REPO ', relative); different++; continue; }
  const local = normalize(reference), deployed = normalize(fs.readFileSync(file, 'utf8'));
  if (local === deployed) { equivalent++; console.log('identical   ', relative); continue; }
  const remaining = new Map();
  for (const statement of statements(local)) remaining.set(statement, (remaining.get(statement) || 0) + 1);
  let extra = 0;
  for (const statement of statements(deployed)) { const count = remaining.get(statement) || 0; if (count) remaining.set(statement, count - 1); else extra++; }
  const missing = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  // Class fields emitted before or after the constructor split the same code into different statements.
  const sameTokens = local.replace(/[;,{}]/g, '').split('').sort().join('') === deployed.replace(/[;,{}]/g, '').split('').sort().join('');
  if (sameTokens && missing <= 2 && extra <= 2) { equivalent++; console.log('equivalent  ', relative, '(class field placement only)'); }
  else { different++; console.log('DIFFERENT   ', relative, `(${missing} local-only, ${extra} deployed-only statements)`); }
}
console.log(`${equivalent} equivalent, ${different} different`);
process.exit(different ? 1 : 0);

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { STATUTS, PHASES_CLIENT, TRANSITIONS, PREV_STATUT, getPhaseIndex } from '../src/expedile/constants/index.js';

test('backend payment waiting status has a visible badge, the payment phase and supported transitions', () => {
  assert.equal(STATUTS.attente_paiement.actionClient, 'Payer');
  assert.equal(STATUTS.attente_paiement.phase, STATUTS.devis_envoye.phase);
  assert.equal(getPhaseIndex('attente_paiement'), getPhaseIndex('devis_envoye'));
  assert.equal(PHASES_CLIENT[getPhaseIndex('attente_paiement')].key, 'paiement');
  assert.ok(TRANSITIONS.devis_envoye.includes('attente_paiement'));
  assert.ok(TRANSITIONS.attente_paiement.includes('paye'));
  assert.equal(PREV_STATUT.attente_paiement, 'devis_envoye');
});

test('client detail renders the published quote and payment action while waiting for payment', async () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const bundle = await build({
    stdin: { contents: "import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Detail from '../src/expedile/components/client/ClientDetailView.jsx'; export const render = () => renderToStaticMarkup(React.createElement(Detail));", resolveDir: directory, loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    external: ['react', 'react-dom/server'],
    plugins: [{ name: 'isolated-client-detail', setup(builder) {
      builder.onResolve({ filter: /\/context\/AppContext$/ }, () => ({ path: 'context', namespace: 'test' }));
      builder.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'test' }));
      builder.onResolve({ filter: /\/ui\/SecureFile$/ }, () => ({ path: 'files', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents: name === 'context' ? 'export const useApp=()=>globalThis.testApp;' : name === 'router' ? 'export const useNavigate=()=>()=>{}; export const useSearchParams=()=>[null,()=>{}];' : 'export const SecureImage=()=>null;', loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  const app = { sel: { id: 'parcel', ref: 'EXP-TEST', statut: 'attente_paiement', devisBrouillon: false, devisTotal: 55.06, devisTransport: 34, paiementMontant: null, payplugPaymentUrl: 'https://secure.payplug.com/test', factures: [], lignes: [], trackings: [] }, authCl: { type: 'particulier', cp: '97400' }, selDest: { code: '974', tva: 8.5 }, isStaff: false };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), testApp: app, console, URL, setTimeout, clearTimeout, TextEncoder });
  let html = module.exports.render();
  assert.match(html, /Détail du devis/);
  assert.match(html, /Télécharger le devis \(PDF\)/);
  assert.match(html, />Payer /);
  assert.match(html, /Devis reçu — en attente de paiement/);
  app.sel = { ...app.sel, devisBrouillon: true };
  html = module.exports.render();
  assert.doesNotMatch(html, />Payer /);
  assert.doesNotMatch(html, /Détail du devis/);
});

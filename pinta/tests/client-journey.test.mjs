import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { STATUTS, PHASES_CLIENT, TRANSITIONS, PREV_STATUT, getPhaseIndex } from '../src/expedile/constants/index.js';


test('client active phase content matches every lifecycle state and frozen quote facts', async () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const bundle = await build({
    stdin: { contents: "import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Detail from '../src/expedile/components/client/ClientDetailView.jsx'; export const render = () => renderToStaticMarkup(React.createElement(Detail));", resolveDir: directory, loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    external: ['react', 'react-dom/server'],
    plugins: [{ name: 'isolated-client-detail', setup(builder) {
      builder.onResolve({ filter: /\/context\/AppContext$/ }, () => ({ path: 'context', namespace: 'test' }));
      builder.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'test' }));
      builder.onResolve({ filter: /\/ui\/SecureFile$/ }, () => ({ path: 'files', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents: name === 'context' ? 'export const useApp=()=>globalThis.testApp;' : name === 'router' ? 'export const useNavigate=()=>()=>{};' : 'export const SecureImage=()=>null;', loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  const app = { sel: { id: 'parcel', ref: 'EXP-TEST', statut: 'attente_paiement', devisBrouillon: false, devisTotal: 55.06, devisTransport: 34, paiementMontant: null, payplugPaymentUrl: 'https://secure.payplug.com/test', factures: [], lignes: [], trackings: [] }, authCl: { type: 'particulier', cp: '97400' }, selDest: { code: '974', tva: 8.5 }, isStaff: false };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), testApp: app, console, URL, setTimeout, clearTimeout, TextEncoder });

  for (const [statut, expected] of [['en_preparation','en cours de préparation'], ['dedouanement','en cours de dédouanement'], ['arrive','arrivé au dépôt local'], ['livraison','en cours de livraison'], ['livre','Livraison confirmée'], ['refuse_client','Préparation refusée']]) {
    app.sel = { ...app.sel, statut };
    const html = module.exports.render();
    assert.match(html, new RegExp(expected), statut);
    assert.doesNotMatch(html, /aujourd'hui|14%/);
    if (statut === 'en_preparation') assert.doesNotMatch(html, /La préparation est terminée/);
  }
  app.sel = { ...app.sel, statut: 'devis_envoye', devisSnapshot: { version: 2, inputs: { finalBox: {}, client: { type: 'pro' }, destination: { tva: 5 }, fees: [{ libelle: 'Emballage réutilisable', montant: 2 }], paymentTerms: { mode: 'fin_de_mois' } }, amounts: { transport: 30, tva: 1.5, total: 33.5 } } };
  const html = module.exports.render();
  assert.match(html, /Emballage réutilisable/);
  assert.match(html, /TVA \(5%\)/);
  assert.match(html, /Paiement en fin de mois/);
  assert.doesNotMatch(html, /TVA \(8.5%\)/);
  assert.match(html, /version 2/);
});

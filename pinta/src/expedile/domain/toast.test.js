import test from 'node:test';
import assert from 'node:assert/strict';
import { toastContent, toastPlacement } from './toast.js';

test('a plain string is an information; a rich toast keeps its tone and action', () => {
  assert.deepEqual(toastContent('Client ajouté'), { msg: 'Client ajouté', type: 'info', action: null });
  const action = { label: 'Voir', onClick() {} };
  assert.deepEqual(toastContent({ msg: 'Lien de suivi créé', type: 'success', action }), { msg: 'Lien de suivi créé', type: 'success', action });
  assert.equal(toastContent({ msg: 'Client non lié à Telegram', type: 'warning' }).type, 'warning');
  assert.equal(toastContent({ msg: 'Texte', type: 'inconnu' }).type, 'info');
});

test('a failure is always shown as an error, even when its caller chose the warning tone', () => {
  for (const msg of ['Erreur : Service indisponible (essai)', 'Erreur création : délai dépassé', 'Échec envoi Telegram : refusé', 'Impossible de copier'])
    assert.equal(toastContent({ msg, type: 'warning' }).type, 'error', msg);
  assert.equal(toastContent('Erreur : réseau').type, 'error');
  for (const msg of ['Lien envoyé ; rechargez le dossier pour actualiser les échanges.', 'Devis enregistré. Actualisation à réessayer : réseau', 'Erreurs corrigées'])
    assert.equal(toastContent({ msg, type: 'warning' }).type, 'warning', msg);
});

test('the toast sits over the navigation, never over the page', () => {
  assert.deepEqual(toastPlacement(220), { kind: 'rail', left: 12, width: 196 }, 'Desktop: inside the navigation column.');
  assert.deepEqual(toastPlacement(64), { kind: 'beside-rail', left: 76, width: 320 }, 'Collapsed column: just beside it.');
  for (const width of [0, null, undefined]) assert.deepEqual(toastPlacement(width), { kind: 'bottom-bar' }, 'Phone, tablet, client portal: over the bottom bar.');
});

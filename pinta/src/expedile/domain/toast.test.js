import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseToastPlacement, overlaps, toastCandidates, toastContent } from './toast.js';

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

// A toast 54 px high at any width, 90 px in the narrow navigation column.
const heightFor = width => width < 200 ? 90 : 54;
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

test('desktop: the free space of the navigation column first, then the free corners of the page', () => {
  const viewport = { width: 1440, top: 0, height: 900 };
  const rail = { left: 0, right: 220, width: 220, top: 0, bottom: 900 };
  // Under the last entry (436) and above « Paramètres » (693).
  const zone = { top: 436, bottom: 693 };
  const [first, ...rest] = toastCandidates({ viewport, rail, zone, heightFor });
  assert.deepEqual(first, { kind: 'rail', left: 12, top: 595, right: 208, bottom: 685, width: 196, height: 90 });
  assert.ok(first.top >= zone.top + 8 && first.bottom <= zone.bottom - 8, 'Inside the free space: no entry, no account button under it.');
  assert.deepEqual(rest.map(item => item.kind), ['bottom', 'bottom-end', 'top-end']);
  assert.deepEqual(rest[0], { kind: 'bottom', left: 236, top: 830, right: 596, bottom: 884, width: 360, height: 54 }, 'Beside the column, never over it.');
  assert.equal(rest[1].right, 1424);
  assert.equal(rest[2].top, 16);
  // A short screen leaves no room under the entries: the page corners only.
  assert.deepEqual(toastCandidates({ viewport: { ...viewport, height: 650 }, rail, zone: { top: 436, bottom: 500 }, heightFor }).map(item => item.kind), ['bottom', 'bottom-end', 'top-end']);
  // Folded column (64 px): the page, beside it.
  const folded = toastCandidates({ viewport, rail: { left: 0, right: 64, width: 64 }, zone, heightFor });
  assert.deepEqual(folded.map(item => item.kind), ['bottom', 'bottom-end', 'top-end']);
  assert.equal(folded[0].left, 80);
});

test('phone and tablet: centred, above the bottom bars, else below the top bar', () => {
  const viewport = { width: 390, top: 0, height: 844 };
  const [bottom, top] = toastCandidates({ viewport, ceiling: 48, floor: 781, heightFor });
  assert.deepEqual(bottom, { kind: 'bottom', left: 12, top: 719, right: 378, bottom: 773, width: 366, height: 54 }, 'Above the bottom navigation (781), never over it.');
  assert.deepEqual(top, { kind: 'top', left: 12, top: 56, right: 378, bottom: 110, width: 366, height: 54 }, 'Below the top bar (48).');
  // A tablet keeps a readable width, centred.
  const [tablet] = toastCandidates({ viewport: { width: 768, top: 0, height: 1024 }, ceiling: 48, floor: 961, heightFor });
  assert.deepEqual([tablet.left, tablet.width], [164, 440]);
});

test('phone and tablet: then the corners, narrower, beside a short heading or a toolbar group', () => {
  const tablet = toastCandidates({ viewport: { width: 768, top: 0, height: 1024 }, ceiling: 48, floor: 961, heightFor });
  assert.deepEqual(tablet.map(item => item.kind), ['bottom', 'top', 'bottom-end', 'bottom-start', 'top-end', 'top-start']);
  const corner = Object.fromEntries(tablet.slice(2).map(item => [item.kind, [item.left, item.top, item.width]]));
  assert.deepEqual(corner, { 'bottom-end': [456, 899, 300], 'bottom-start': [12, 899, 300], 'top-end': [456, 56, 300], 'top-start': [12, 56, 300] });
  assert.ok(tablet.every(item => item.bottom <= 961 && item.top >= 48), 'Between the top bar and the bottom navigation.');
  // A phone: the corners leave a strip free on one side.
  const phone = toastCandidates({ viewport: { width: 390, top: 0, height: 844 }, ceiling: 48, floor: 781, heightFor });
  assert.deepEqual(phone.filter(item => item.kind.endsWith('-end')).map(item => [item.left, item.right]), [[78, 378], [78, 378]]);
  // 320 px: the centred bar is already as narrow as a corner, nothing more to try.
  assert.deepEqual(toastCandidates({ viewport: { width: 320, top: 0, height: 640 }, ceiling: 48, floor: 580, heightFor }).map(item => item.kind), ['bottom', 'top']);
});

test('a toast keeps its place while that place stays clear, and moves only off a control', () => {
  const viewport = { width: 1440, top: 0, height: 900 };
  const candidates = toastCandidates({ viewport, rail: { left: 0, right: 64, width: 64 }, heightFor });
  // Held at the top-end corner: a free bottom corner does not pull it back.
  assert.equal(chooseToastPlacement(candidates, [], { current: 'top-end' }).kind, 'top-end');
  // A row scrolled under it: the first clear place.
  const topEnd = candidates.find(item => item.kind === 'top-end');
  const row = box(topEnd.left, topEnd.top + 10, 200, 40);
  assert.equal(chooseToastPlacement(candidates, [row], { current: 'top-end' }).kind, 'bottom');
  // Nothing clear: the fewest covered, said by `covered` (ui/Toast.jsx closes it at the next scroll).
  const everywhere = candidates.map(item => box(item.left + 4, item.top + 4, 20, 20));
  assert.equal(chooseToastPlacement(candidates, everywhere, { current: 'bottom' }).covered, 1);
});

test('the toast never covers a control: the first free place, else the page place hiding the least', () => {
  const viewport = { width: 1440, top: 0, height: 900 };
  const rail = { left: 0, right: 220, width: 220 };
  const candidates = toastCandidates({ viewport, rail, zone: { top: 436, bottom: 693 }, heightFor });
  assert.equal(chooseToastPlacement(candidates, [box(12, 700, 40, 40), box(167, 948, 40, 40)]).kind, 'rail', 'The account buttons are below the free space.');
  // Something clickable in the free space (an entry, a backdrop control): a free corner of the page.
  assert.equal(chooseToastPlacement(candidates, [box(20, 640, 150, 40)]).kind, 'bottom');
  assert.equal(chooseToastPlacement(candidates, [box(20, 640, 150, 40), box(300, 850, 120, 44)]).kind, 'bottom-end');
  // Covered everywhere: the page place hiding the least of the controls (by area), never the
  // navigation column. Here bottom-end hides 100 × 24 px of one control, bottom 120 × 34 px of one,
  // top-end parts of two.
  const crowded = [box(20, 640, 150, 40), box(300, 850, 120, 44), box(1300, 860, 100, 30), box(1350, 20, 60, 40), box(1200, 40, 60, 30)];
  const chosen = chooseToastPlacement(candidates, crowded);
  assert.equal(chosen.kind, 'bottom-end');
  assert.equal(chosen.covered, 1);
  assert.equal(crowded.filter(control => overlaps(chosen, control)).length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(chosen, 'area'), false, 'Only the place and what it covers.');
  assert.equal(chooseToastPlacement([], []), null);
});

test('with no clear place, the edge of a button rather than a whole clickable row', () => {
  // A tablet list: the rows fill the bottom places; the top-end corner only grazes a tab.
  const viewport = { width: 768, top: 0, height: 1024 };
  const tall = () => 54;
  const candidates = toastCandidates({ viewport, ceiling: 48, floor: 961, heightFor: tall });
  const tabs = [box(16, 104, 120, 44), box(156, 104, 90, 44), box(266, 104, 70, 44), box(350, 104, 118, 44)];
  const heading = box(16, 58, 205, 30);
  const rows = [box(0, 795, 768, 99), box(0, 894, 768, 67)];
  const chosen = chooseToastPlacement(candidates, [...tabs, heading, ...rows]);
  assert.equal(chosen.kind, 'top-end', 'Only 12 × 6 px of « Accords clients » hidden, its centre clear.');
  assert.equal(chosen.covered, 1);
});

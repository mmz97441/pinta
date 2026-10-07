import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkedByLine, checkFeedback, checkMoment, checkerName, clearedFeedback, controlTotals, countFeedback, countIssue,
  dossierControl, elsewhereFeedback, expectedParcelCount, LAYOUT_NOTICE, legacySingleParcel, loadedDossiers, mergeLoadingCheck,
  parisClockLabel, readScannedCode, refusedFeedback, severalFeedback, trailingParcelCode, unreadableFeedback,
} from './loadingControl.js';

// 14 h 32 in Paris on Wednesday 7 October 2026 (summer time: UTC+2).
const NOW = Date.parse('2026-10-07T12:32:00Z');
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const prepared = (id, ref, parcels, fields = {}) => ({
  id, ref, statut: 'paye', finalPackages: Array.from({ length: parcels }, () => box(40, 30, 30, 6)), outgoingParcelCount: parcels,
  finL: 40, finW: 30, finH: 30, finP: 6 * parcels, preparationCompositionVersion: 1, finalMeasurementsVersion: 1, ...fields,
});
const TWO = prepared('d-two', 'EXP-2YE537', 2);
const ONE = prepared('d-one', 'EXP-4KM2PQ', 1);
const LEGACY = { id: 'd-legacy', ref: 'EXP-0042', statut: 'paye', finalPackages: [], outgoingParcelCount: null, finL: 30, finW: 20, finH: 20, finP: 4 };
const UNPAID = prepared('d-unpaid', 'EXP-9XB4ZT', 1, { statut: 'devis_envoye' });
const UNPREPARED = { id: 'd-raw', ref: 'EXP-7RT5WQ', statut: 'paye', finalPackages: [], outgoingParcelCount: null };
const check = (colisId, parcelIndex, parcelCount, fields = {}) => ({ colisId, parcelIndex, parcelCount, method: 'scan', checkedBy: 'auth-madly', checkedByName: 'Madly Payet', checkedAt: '2026-10-07T12:30:00Z', ...fields });
const TEAM = [{ authId: 'auth-madly', prenom: 'Madly', nom: 'Payet' }, { authId: 'auth-paul', prenom: ' Paul ', nom: 'Hoarau' }];

test('the parcels expected are those of the preparation, one for a legacy single measure, none before', () => {
  assert.equal(expectedParcelCount(TWO), 2);
  assert.equal(expectedParcelCount(ONE), 1);
  assert.equal(expectedParcelCount(LEGACY), 1);
  assert.equal(expectedParcelCount(UNPREPARED), 0);
  assert.equal(expectedParcelCount(null), 0);
});

test('a dossier counts one check per parcel, on its current number of parcels only', () => {
  const checks = [check('d-two', 2, 2), check('d-two', 2, 2, { checkedAt: '2026-10-07T12:31:00Z' }), check('d-two', 1, 3), check('d-one', 1, 1), check('d-two', 3, 2)];
  const control = dossierControl(TWO, checks);
  assert.deepEqual({ expected: control.expected, checked: control.checked, done: control.done, complete: control.complete }, { expected: 2, checked: 1, done: [2], complete: false });
  assert.equal(control.checks.length, 1, 'A label of an older preparation (1/3) and an impossible parcel (3/2) do not count.');
  const full = dossierControl(TWO, [...checks, check('d-two', 1, 2, { checkedAt: '2026-10-07T12:32:00Z' })]);
  assert.deepEqual([full.checked, full.complete, full.latest.parcelIndex], [2, true, 1]);
  assert.equal(dossierControl(UNPREPARED, [check('d-raw', 1, 1)]).complete, false, 'Nothing is complete without parcels to expect.');
  assert.equal(dossierControl(LEGACY, [check('d-legacy', 1, 1)]).complete, true);
});

test('the departure takes the ready dossiers whose parcels are all checked, unless set aside', () => {
  const dossiers = [TWO, ONE, UNPAID, LEGACY];
  const checks = [check('d-two', 1, 2), check('d-one', 1, 1), check('d-unpaid', 1, 1), check('d-legacy', 1, 1)];
  assert.deepEqual(loadedDossiers(dossiers, checks).map(item => item.id), ['d-one', 'd-legacy'], 'Incomplete and unpaid dossiers stay off.');
  assert.deepEqual(loadedDossiers(dossiers, checks, ['d-one']).map(item => item.id), ['d-legacy']);
  assert.deepEqual(controlTotals(dossiers, checks), { checked: 4, expected: 5, ready: 2, total: 4 });
  assert.deepEqual(controlTotals([], []), { checked: 0, expected: 0, ready: 0, total: 0 });
});

test('a recorded check replaces its older copy, never duplicates a parcel', () => {
  const first = check('d-two', 1, 2);
  const merged = mergeLoadingCheck([first, check('d-one', 1, 1)], check('d-two', 1, 2, { method: 'camera' }));
  assert.deepEqual(merged.map(item => [item.colisId, item.parcelIndex, item.method]), [['d-one', 1, 'scan'], ['d-two', 1, 'camera']]);
  assert.equal(mergeLoadingCheck(merged, null), merged);
});

test('who checked and when, on Paris time whatever the device', () => {
  assert.equal(parisClockLabel('2026-10-07T12:32:00Z'), '14 h 32');
  assert.equal(parisClockLabel('2026-10-07T07:00:00Z'), '9 h');
  assert.equal(parisClockLabel('2026-12-07T13:05:00Z'), '14 h 05', 'Winter time: UTC+1.');
  assert.equal(parisClockLabel('pas une date'), null);
  assert.equal(checkMoment('2026-10-07T12:32:00Z', { now: NOW }), 'à 14 h 32');
  assert.equal(checkMoment('2026-10-06T21:45:00Z', { now: NOW }), 'le mardi 6 octobre à 23 h 45');
  assert.equal(checkerName(check('d-one', 1, 1), TEAM), 'Madly');
  assert.equal(checkerName(check('d-one', 1, 1, { checkedBy: 'auth-other', checkedByName: 'Inès Grondin' }), TEAM), 'Inès Grondin');
  assert.equal(checkerName(check('d-one', 1, 1, { checkedBy: null, checkedByName: '' }), TEAM), 'un membre de l’équipe');
  const done = dossierControl(TWO, [check('d-two', 1, 2, { checkedAt: '2026-10-07T12:20:00Z' }), check('d-two', 2, 2, { checkedBy: 'auth-paul', checkedAt: '2026-10-07T12:32:00Z' })]);
  assert.equal(checkedByLine(done, { now: NOW, team: TEAM }), 'Vérifié par Madly et Paul à 14 h 32');
  const counted = dossierControl(ONE, [check('d-one', 1, 1, { method: 'count' })]);
  assert.equal(checkedByLine(counted, { now: NOW, team: TEAM }), 'Vérifié par Madly à 14 h 30 (comptage à la main)');
  assert.equal(checkedByLine(dossierControl(TWO, [check('d-two', 1, 2)]), { now: NOW, team: TEAM }), null, 'Nothing before every parcel is checked.');
});

test('a scanned text is read against the dossiers of the departure', () => {
  const dossiers = [TWO, ONE, LEGACY, UNPREPARED];
  assert.deepEqual(readScannedCode('  ', dossiers), { kind: 'empty' });
  assert.deepEqual(readScannedCode('1Z999AA10123456784', dossiers), { kind: 'unreadable', text: '1Z999AA10123456784' });
  const parcel = readScannedCode('EXP-2YE537-1-2', dossiers);
  assert.deepEqual({ ...parcel, dossier: parcel.dossier.id }, { kind: 'parcel', dossier: 'd-two', index: 1, count: 2, bare: false, ref: 'EXP-2YE537', layoutCorrected: false });
  const typedLower = readScannedCode('exp-2ye537 · colis 2/2', dossiers);
  assert.deepEqual([typedLower.kind, typedLower.index, typedLower.ref], ['parcel', 2, 'EXP-2YE537']);
  const english = readScannedCode('EXP)éYE("è)&)é', dossiers);
  assert.deepEqual([english.kind, english.dossier.id, english.index, english.count, english.layoutCorrected], ['parcel', 'd-two', 1, 2, true]);
  const several = readScannedCode('EXP-2YE537', dossiers);
  assert.deepEqual([several.kind, several.dossier.id, several.expected], ['several', 'd-two', 2]);
  const single = readScannedCode('EXP-4KM2PQ', dossiers);
  assert.deepEqual([single.kind, single.index, single.count, single.bare], ['parcel', 1, 1, true], 'A bare reference is « colis 1/1 » for a dossier of one parcel.');
  assert.deepEqual([readScannedCode('EXP-0042', dossiers).kind, readScannedCode('EXP-0042', dossiers).count], ['parcel', 1], 'Legacy single measure: one parcel.');
  assert.equal(readScannedCode('EXP-7RT5WQ', dossiers).kind, 'parcel', 'Unprepared: the server explains it.');
  assert.deepEqual(readScannedCode('EXP-ZZZZZZ-1-1', dossiers), { kind: 'elsewhere', ref: 'EXP-ZZZZZZ', layoutCorrected: false });
});

test('the sentences of a scan say what happened and what to do', () => {
  assert.deepEqual(unreadableFeedback('1Z999AA10123456784'), { tone: 'error', title: 'Code illisible', detail: '« 1Z999AA10123456784 » n’est pas une étiquette de colis Expedîle. Scannez le code de l’étiquette (EXP-…-1-2), ou comptez les colis du dossier.' });
  assert.match(unreadableFeedback('X'.repeat(60)).detail, /^« X{39}… »/);
  const several = readScannedCode('EXP-2YE537', [TWO]);
  assert.deepEqual(severalFeedback(several), { tone: 'warning', title: 'EXP-2YE537 compte 2 colis : scannez l’étiquette de chaque colis ou comptez-les', detail: null });
  const first = readScannedCode('EXP-2YE537-1-2', [TWO]);
  assert.deepEqual(checkFeedback(first, { status: 'recorded' }, [check('d-two', 1, 2)], { now: NOW, team: TEAM }), { tone: 'success', title: 'EXP-2YE537 · colis 1/2 vérifié', detail: 'Il reste 1 colis à vérifier pour ce dossier.' });
  const second = readScannedCode('EXP-2YE537-2-2', [TWO]);
  assert.equal(checkFeedback(second, { status: 'recorded' }, [check('d-two', 1, 2), check('d-two', 2, 2)]).detail, 'Tous ses colis sont vérifiés : expédition prête à partir.');
  const unpaid = readScannedCode('EXP-9XB4ZT-1-1', [UNPAID]);
  assert.equal(checkFeedback(unpaid, { status: 'recorded' }, [check('d-unpaid', 1, 1)]).detail, 'Tous ses colis sont vérifiés ; à débloquer avant le départ : paiement non confirmé.');
  assert.deepEqual(checkFeedback(first, { status: 'already', check: check('d-two', 1, 2) }, [], { now: NOW, team: TEAM }), { tone: 'warning', title: 'EXP-2YE537 · colis 1/2 déjà vérifié', detail: 'Vérifié par Madly à 14 h 30. Scannez un autre colis.' });
  assert.deepEqual(refusedFeedback(first, 'Étiquette périmée : ce dossier compte maintenant 3 colis. Réimprimez ses étiquettes.'), { tone: 'error', title: 'EXP-2YE537 · colis 1/2 non vérifié', detail: 'Étiquette périmée : ce dossier compte maintenant 3 colis. Réimprimez ses étiquettes.' });
  assert.deepEqual(countFeedback(TWO, { status: 'recorded', expected: 2 }), { tone: 'success', title: 'EXP-2YE537 · 2 colis comptés à la main', detail: 'Tous ses colis sont vérifiés : expédition prête à partir.' });
  assert.equal(countFeedback(ONE, { status: 'recorded', expected: 1 }).title, 'EXP-4KM2PQ · 1 colis compté à la main');
  assert.equal(countFeedback(TWO, { status: 'already', expected: 2 }).title, 'EXP-2YE537 · ses 2 colis étaient déjà vérifiés');
  assert.equal(clearedFeedback(TWO).title, 'EXP-2YE537 · contrôle à refaire');
  assert.equal(LAYOUT_NOTICE, 'La douchette est réglée en clavier anglais : passez-la en français (AZERTY).');
});

test('a scan answers with the server counts when the dossier was prepared again on another device', () => {
  // The screen still holds 2 parcels; the server accepted a new label « 1/3 ».
  const scan = readScannedCode('EXP-2YE537-1-3', [TWO]);
  assert.equal(checkFeedback(scan, { status: 'recorded', checked: 1, expected: 3 }, [check('d-two', 1, 3)]).detail, 'Il reste 2 colis à vérifier pour ce dossier.');
  assert.equal(checkFeedback(scan, { status: 'recorded', checked: 3, expected: 3 }, [check('d-two', 1, 3)]).detail, 'Tous ses colis sont vérifiés : expédition prête à partir.');
  // Without counts (an older answer), the screen's own checks.
  assert.equal(checkFeedback(readScannedCode('EXP-2YE537-1-2', [TWO]), { status: 'recorded' }, [check('d-two', 1, 2)]).detail, 'Il reste 1 colis à vérifier pour ce dossier.');
});

test('a label scanned into a text field is told apart from what the person wrote', () => {
  assert.deepEqual(trailingParcelCode('Colis non remisEXP-2YE537-1-2'), { text: 'EXP-2YE537-1-2', start: 15 });
  assert.deepEqual(trailingParcelCode('EXP-2YE537-2-2'), { text: 'EXP-2YE537-2-2', start: 0 });
  assert.deepEqual(trailingParcelCode('Paiement attendu exp-1042-1-1'), { text: 'exp-1042-1-1', start: 17 });
  assert.deepEqual(trailingParcelCode('Report EXP)éYE("è)&)é'), { text: 'EXP)éYE("è)&)é', start: 7 }, 'A scanner set to an English keyboard.');
  for (const text of ['', 'Paiement attendu', 'Voir EXP-2YE537', 'EXP-2YE537 · Colis 1/2', 'EXP-2YE537-1-2 manquant', 'Colis EXP-2YE537-3-2', null])
    assert.equal(trailingParcelCode(text), null, String(text));
});

test('a dossier measured before the parcels were listed has one parcel to label, while its measures are current', () => {
  // As 20260912000005 leaves it: composition version 0, final measures version 0, no parcel list, no outgoing count.
  const legacy = { id: 'd-old', ref: 'EXP-0042', statut: 'paye', finalPackages: null, outgoingParcelCount: null, finL: 30, finW: 20, finH: 20, finP: 4, preparationCompositionVersion: 0, finalMeasurementsVersion: 0 };
  assert.equal(legacySingleParcel(legacy), true);
  assert.equal(expectedParcelCount(legacy), 1);
  for (const patch of [{ preparationCompositionVersion: 1 }, { finalMeasurementsVersion: null }, { finalPackages: [] }, { outgoingParcelCount: 1 }, { finP: null }, { finL: 0 }])
    assert.equal(legacySingleParcel({ ...legacy, ...patch }), false, JSON.stringify(patch));
  assert.equal(legacySingleParcel(TWO), false, 'A current preparation lists its parcels.');
  assert.equal(legacySingleParcel(null), false);
});

test('a parcel of another departure, of none, shipped or unknown is set aside with the reason', () => {
  const envois = [{ id: 'e-here', ref: 'ENV-2026-045', date: '2026-10-07' }, { id: 'e-other', ref: 'ENV-2026-052', date: '2026-10-22' }];
  const known = [
    { ...ONE, envoi: 'e-other' }, { ...TWO, envoi: null }, { ...UNPAID, statut: 'expedie', envoi: 'e-other', dateExpedition: '2026-10-01T06:00:00Z' },
    { ...LEGACY, envoi: 'e-here' },
  ];
  const context = { dossiers: known, envois, envoiId: 'e-here', now: NOW };
  assert.deepEqual(elsewhereFeedback('EXP-4KM2PQ', context), { tone: 'error', title: 'EXP-4KM2PQ n’est pas sur ce départ', detail: 'Il est prévu sur le départ ENV-2026-052 du jeudi 22 octobre : mettez ce colis de côté.' });
  assert.equal(elsewhereFeedback('EXP-2YE537', context).detail, 'Il n’est affecté à aucun départ : mettez ce colis de côté, ou affectez d’abord son dossier à ce départ.');
  assert.equal(elsewhereFeedback('EXP-9XB4ZT', context).title, 'EXP-9XB4ZT ne fait pas partie de ce chargement');
  assert.equal(elsewhereFeedback('EXP-0042', context).title, 'EXP-0042 n’est plus sur ce départ');
  assert.deepEqual(elsewhereFeedback('EXP-ZZZZZZ', context), { tone: 'error', title: 'EXP-ZZZZZZ introuvable', detail: 'Aucun dossier en cours ne porte cette référence : vérifiez l’étiquette et mettez ce colis de côté.' });
  assert.equal(elsewhereFeedback('EXP-4KM2PQ', { ...context, envois: [] }).detail, 'Il est prévu sur un autre départ : mettez ce colis de côté.');
});

test('a manual count must match the parcels prepared', () => {
  assert.equal(countIssue('2', 2), null);
  assert.equal(countIssue(' 2 ', 2), null);
  assert.equal(countIssue('1', 2), 'Il manque des colis : reportez ce dossier ou retrouvez-les.');
  assert.equal(countIssue('0', 2), 'Il manque des colis : reportez ce dossier ou retrouvez-les.');
  assert.equal(countIssue('3', 2), 'Plus de colis que préparés (2) : retirez ceux d’un autre dossier, puis recomptez.');
  for (const value of ['', 'deux', '2,5', '-1', '1000']) assert.equal(countIssue(value, 2), 'Indiquez le nombre de colis comptés, en chiffres.', value);
});

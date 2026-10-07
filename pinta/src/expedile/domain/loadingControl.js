// Loading control of a departure, screen side (« Vérifier le chargement »): which outgoing parcels of each dossier
// were scanned or counted, from the server's checks (services/loadingChecks.js, get_loading_checks), what a scanned
// text designates on this departure, and the sentences of the screen. The server stays authoritative
// (record_loading_check, record_loading_count, confirm_departure refuses a dossier not fully checked); nothing here
// writes or calls it.
import { departureReadiness } from './departureReadiness.js';
import { departureDayLabel, parisCalendarDay } from './departureGroups.js';
import { parseParcelCode } from './parcelCode.js';
import { parisDateTimeInput } from './parisTime.js';
import { plural } from './plural.js';

/** The camera reads the same code again and again while it stays in view: it counts once per 2 s pause. */
export const SAME_CODE_PAUSE_MS = 2000;
/** A handheld scanner set to an English (QWERTY) keyboard on a French device (parseParcelCode restores its code). */
export const LAYOUT_NOTICE = 'La douchette est réglée en clavier anglais : passez-la en français (AZERTY).';
/** A handheld scanner types a code's characters a few milliseconds apart, then Enter at once: a person never types
 * a whole code that fast. */
export const SCANNER_KEY_GAP_MS = 50;
/** A line whose first key comes less than this after the previous line's Enter is the rest of the same label: a
 * scanner turns the line breaks of a QR code into Enter (the former labels held the reference, then the recipient's
 * name, address and phone, one per line). */
export const SCANNER_LINE_GAP_MS = 100;

// Statuses of a dossier that has left or will not leave: never part of a loading.
const CLOSED = new Set(['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule']);
const upper = value => String(value ?? '').trim().toUpperCase();
const instant = value => { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; };

/** The outgoing parcels the control expects of a dossier: those of its preparation (one for a legacy single final
 * measure, as the server counts it); 0 while they are not known. */
export function expectedParcelCount(dossier) {
  return dossier ? departureReadiness(dossier).count || 0 : 0;
}

/**
 * A dossier prepared before the outgoing parcels were listed (September 2026): one final measure (fin_*), no parcel
 * list and no outgoing count, saved for its current composition (no carton added since). Its one parcel is expected
 * as « 1/1 » by the loading control, and its label carries « EXP-0042-1-1 ».
 */
export function legacySingleParcel(dossier) {
  return Boolean(dossier) && dossier.finalPackages == null && dossier.outgoingParcelCount == null
    && dossier.finalMeasurementsVersion != null && dossier.finalMeasurementsVersion === dossier.preparationCompositionVersion
    && departureReadiness(dossier).legacySingle;
}

/**
 * One dossier's control from the departure's checks: only the checks of its current number of parcels count (a
 * label printed for another preparation does not), one per parcel.
 * { expected, checked, done: [parcel numbers], complete, checks: [one per parcel], latest }
 */
export function dossierControl(dossier, checks = []) {
  const expected = expectedParcelCount(dossier);
  const byParcel = new Map();
  for (const check of checks || []) {
    if (!check || !dossier || check.colisId !== dossier.id || !expected || check.parcelCount !== expected) continue;
    if (!(check.parcelIndex >= 1 && check.parcelIndex <= expected) || byParcel.has(check.parcelIndex)) continue;
    byParcel.set(check.parcelIndex, check);
  }
  const done = [...byParcel.keys()].sort((left, right) => left - right);
  const valid = done.map(index => byParcel.get(index));
  const latest = valid.reduce((last, check) => (!last || instant(check.checkedAt) >= instant(last.checkedAt) ? check : last), null);
  return { expected, checked: done.length, done, complete: expected > 0 && done.length >= expected, checks: valid, latest };
}

/** The dossiers the departure takes when it is confirmed: ready (paid, prepared), every parcel checked, and not
 * set aside by the person who confirms. */
export function loadedDossiers(dossiers = [], checks = [], excluded = []) {
  const aside = new Set(excluded || []);
  return (dossiers || []).filter(dossier => dossier && !aside.has(dossier.id) && departureReadiness(dossier).eligible && dossierControl(dossier, checks).complete);
}

/** « Colis vérifiés 7/9 · Expéditions prêtes 3/4 »: parcels checked over those expected, dossiers ready to leave
 * (every parcel checked, nothing to unblock) over the dossiers of the loading. */
export function controlTotals(dossiers = [], checks = []) {
  const totals = { checked: 0, expected: 0, ready: 0, total: 0 };
  for (const dossier of dossiers || []) {
    if (!dossier) continue;
    const control = dossierControl(dossier, checks);
    totals.checked += control.checked; totals.expected += control.expected; totals.total += 1;
    if (control.complete && departureReadiness(dossier).eligible) totals.ready += 1;
  }
  return totals;
}

/** The checks with one more (or its newer version): one per dossier and parcel. */
export function mergeLoadingCheck(checks = [], check) {
  if (!check?.colisId) return checks || [];
  return [...(checks || []).filter(item => !(item.colisId === check.colisId && item.parcelIndex === check.parcelIndex)), check];
}

/** « 14 h 32 », « 9 h » (Paris time, as the closings of the page). */
export function parisClockLabel(value) {
  const text = parisDateTimeInput(value);
  if (!text) return null;
  const hour = Number(text.slice(11, 13)), minute = text.slice(14, 16);
  return `${hour} h${minute === '00' ? '' : ` ${minute}`}`;
}

/** « à 14 h 32 », or « le mardi 6 octobre à 14 h 32 » for another day than today (Paris). */
export function checkMoment(value, { now = Date.now() } = {}) {
  const clock = parisClockLabel(value);
  if (!clock) return '';
  const day = parisCalendarDay(value);
  return day && day !== parisCalendarDay(now) ? `le ${departureDayLabel(day, { today: now })} à ${clock}` : `à ${clock}`;
}

/** The first name of the person who checked, from the team list (staff_users.auth_id), else the server's name. */
export function checkerName(check, team = []) {
  const member = (team || []).find(person => person?.authId && person.authId === check?.checkedBy);
  return String(member?.prenom || '').trim() || String(check?.checkedByName || '').trim() || 'un membre de l’équipe';
}

const joinNames = names => names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;

/** « Vérifié par Madly à 14 h 32 » once every parcel is checked (several people named, the last check's time;
 * « (comptage à la main) » when the parcels were counted rather than scanned); null before. */
export function checkedByLine(control, { now = Date.now(), team = [] } = {}) {
  if (!control?.complete || !control.latest) return null;
  const ordered = [...control.checks].sort((left, right) => instant(left.checkedAt) - instant(right.checkedAt));
  const names = [];
  for (const check of ordered) { const name = checkerName(check, team); if (!names.includes(name)) names.push(name); }
  const counted = ordered.every(check => check.method === 'count');
  return `Vérifié par ${joinNames(names)} ${checkMoment(control.latest.checkedAt, { now })}${counted ? ' (comptage à la main)' : ''}`;
}

/**
 * What a scanned or typed text designates on this departure, before the server is asked:
 * - { kind: 'empty' } or { kind: 'unreadable', text };
 * - { kind: 'parcel', dossier, ref, index, count, bare } for a parcel of one of its dossiers (a bare reference
 *   counts as « colis 1/1 », for a dossier of one parcel: `bare`);
 * - { kind: 'several', dossier, ref, expected } for a bare reference of a dossier of several parcels;
 * - { kind: 'elsewhere', ref } for a reference that is not one of its dossiers.
 * `layoutCorrected`: the scanner typed with an English keyboard (the code was restored, see LAYOUT_NOTICE).
 * `oldLabel`: the QR code of a former label read whole by the camera (the reference on its first line, then the
 * recipient), read as its bare reference.
 */
export function readScannedCode(text, dossiers = []) {
  const lines = String(text ?? '').split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
  const first = lines.length > 1 ? parseParcelCode(lines[0]) : null;
  const oldLabel = Boolean(first?.ok && first.index === null);
  const code = oldLabel ? first : parseParcelCode(text);
  if (!code.ok) return code.reason === 'empty' ? { kind: 'empty' } : { kind: 'unreadable', text: String(text ?? '').replace(/\s+/g, ' ').trim() };
  const dossier = (dossiers || []).find(item => item && upper(item.ref) === code.ref) || null;
  const base = { ref: dossier?.ref || code.ref, layoutCorrected: code.layoutCorrected, ...(oldLabel ? { oldLabel: true } : {}) };
  if (!dossier) return { kind: 'elsewhere', ...base };
  if (code.index === null) {
    const expected = expectedParcelCount(dossier);
    if (expected > 1) return { kind: 'several', dossier, expected, ...base };
    return { kind: 'parcel', dossier, index: 1, count: 1, bare: true, ...base };
  }
  return { kind: 'parcel', dossier, index: code.index, count: code.count, bare: false, ...base };
}

/**
 * A label scanned while the focus is in a text field: the handheld scanner types its code at the caret
 * (« Colis non remisEXP-2YE537-1-2 »), then Enter. { text, start } when `before` (the text before the caret) ends
 * with a full parcel code (reference, parcel and count, as the labels hold it), null otherwise: a reference written
 * in a sentence, or « EXP-2YE537 · Colis 1/2 » copied from a label, stays text.
 */
export function trailingParcelCode(before) {
  const match = /(EXP\S*)$/i.exec(String(before ?? ''));
  if (!match) return null;
  const code = parseParcelCode(match[1]);
  return code.ok && code.index !== null ? { text: match[1], start: match.index } : null;
}

// Keys that never type anything, pressed alone: a scanner presses Shift for capitals (and for the digits of a French
// keyboard), a dead key starts an accented letter.
const SILENT_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'Fn', 'FnLock', 'Dead', 'Unidentified', 'Process']);

/** A character typed (one printable key, Shift allowed), not a shortcut or a composition in progress. */
export function typedCharacter(event) {
  return Boolean(event) && typeof event.key === 'string' && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;
}

/** A key that types nothing by itself (Shift, a dead key…): it neither types nor interrupts a code. */
export function silentKey(event) {
  return Boolean(event) && SILENT_KEYS.has(event.key);
}

/**
 * The keys of a line as they are typed, from their events' times (`timeStamp`, the time each key was pressed even
 * when the page is busy): `track(event)` on each keydown. On Enter it returns the line just ended,
 * { start, enter, fast, scanner }: `start` the time of its first character (null without one), `enter` the time of
 * its Enter, `fast` how many of its last characters came each less than SCANNER_KEY_GAP_MS after the previous one,
 * `scanner` its Enter came that fast too. Any other key returns null; a key that types nothing (Backspace, an
 * arrow, Tab) starts the line again. `reset()` forgets the line.
 */
export function keyLine() {
  let start = null, last = null, fast = 0;
  const reset = () => { start = null; last = null; fast = 0; };
  return {
    track(event) {
      const at = Number(event?.timeStamp);
      if (!event || silentKey(event) || !Number.isFinite(at)) return null;
      if (event.key === 'Enter') {
        const line = { start, enter: at, fast, scanner: last !== null && at - last < SCANNER_KEY_GAP_MS };
        reset();
        return line;
      }
      if (!typedCharacter(event)) { reset(); return null; }
      fast = last !== null && at - last < SCANNER_KEY_GAP_MS ? fast + 1 : 1;
      if (start === null) start = at;
      last = at;
      return null;
    },
    reset,
  };
}

/** `text`, at the end of the line, was typed by a scanner: each of its characters less than SCANNER_KEY_GAP_MS
 * after the previous one, and Enter at once. Typed by hand, it stays text. */
export function scannerTyped(line, text) {
  return Boolean(line?.scanner) && line.fast >= Array.from(String(text ?? '')).length;
}

/** The line continues the label of the previous one: a scanner typed it, its first key less than SCANNER_LINE_GAP_MS
 * after the previous line's Enter (`previousEnter`, from keyLine). */
export function continuesLabel(line, previousEnter) {
  return Boolean(line?.scanner) && Number.isFinite(line.start) && Number.isFinite(previousEnter)
    && line.start >= previousEnter && line.start - previousEnter < SCANNER_LINE_GAP_MS;
}

const reasonText = readiness => readiness.reasons.map(reason => reason.text.charAt(0).toLocaleLowerCase('fr') + reason.text.slice(1)).join(', ');
const remainingLine = remaining => `Il reste ${plural(remaining, 'colis', 'colis')} à vérifier pour ce dossier.`;
const completeLine = dossier => {
  const readiness = departureReadiness(dossier);
  return readiness.eligible ? 'Tous ses colis sont vérifiés : expédition prête à partir.' : `Tous ses colis sont vérifiés ; à débloquer avant le départ : ${reasonText(readiness)}.`;
};

/** « « EXP-2Y… » n’est pas une étiquette de colis » with the text read, shortened. */
export function unreadableFeedback(text) {
  const shown = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return { tone: 'error', title: 'Code illisible', detail: `« ${shown} » n’est pas une étiquette de colis Expedîle. Scannez le code de l’étiquette (EXP-…-1-2), ou comptez les colis du dossier.` };
}

/** A bare reference of a dossier of several parcels: each label is scanned, or the parcels counted. */
export function severalFeedback(scan) {
  return { tone: 'warning', title: `${scan.ref} compte ${scan.expected} colis : scannez l’étiquette de chaque colis ou comptez-les`, detail: null };
}

/** A former label (its QR code: the reference, then the recipient) of a dossier of several parcels: it names no
 * parcel, so its new labels are printed (one per parcel), or its parcels counted. */
export function oldLabelFeedback(scan) {
  return { tone: 'warning', title: `Ancienne étiquette de ${scan.ref}`, detail: `Ce dossier compte ${scan.expected} colis : imprimez ses nouvelles étiquettes, une par colis, ou comptez ses colis à la main.` };
}

/**
 * A reference that is not one of this departure's dossiers, from what the team's screens know of it: another
 * departure (named), no departure, already shipped, cancelled or archived, or unknown. Always « mettez ce colis
 * de côté »: it must not be handed to this carrier. `dossiers`: every dossier the team's screens hold.
 */
export function elsewhereFeedback(ref, { dossiers = [], envois = [], envoiId = null, now = Date.now() } = {}) {
  const dossier = (dossiers || []).find(item => item && upper(item.ref) === upper(ref));
  if (!dossier) return { tone: 'error', title: `${ref} introuvable`, detail: 'Aucun dossier en cours ne porte cette référence : vérifiez l’étiquette et mettez ce colis de côté.' };
  if (dossier.archive || dossier.dateExpedition || CLOSED.has(dossier.statut)) return { tone: 'error', title: `${dossier.ref} ne fait pas partie de ce chargement`, detail: 'Ce dossier est déjà expédié, annulé ou archivé : mettez ce colis de côté.' };
  const assigned = dossier.envoi || dossier.envoiId || null;
  if (!assigned) return { tone: 'error', title: `${dossier.ref} n’est pas sur ce départ`, detail: 'Il n’est affecté à aucun départ : mettez ce colis de côté, ou affectez d’abord son dossier à ce départ.' };
  // The team's list still places it here, the server's list of this departure no longer does.
  if (assigned === envoiId) return { tone: 'error', title: `${dossier.ref} n’est plus sur ce départ`, detail: 'Son dossier en a été retiré : mettez ce colis de côté et vérifiez son dossier.' };
  const other = (envois || []).find(item => item?.id === assigned);
  const day = other?.date ? departureDayLabel(other.date, { today: now }) : null;
  const name = other ? [other.ref || 'sans référence', day && `du ${day}`].filter(Boolean).join(' ') : null;
  return { tone: 'error', title: `${dossier.ref} n’est pas sur ce départ`, detail: name ? `Il est prévu sur le départ ${name} : mettez ce colis de côté.` : 'Il est prévu sur un autre départ : mettez ce colis de côté.' };
}

/**
 * The answer of record_loading_check for the screen: « EXP-2YE537 · colis 1/2 vérifié » with what remains, or
 * « … déjà vérifié » with who and when (a label scanned twice keeps its first check).
 */
export function checkFeedback(scan, result, checks = [], { now = Date.now(), team = [] } = {}) {
  const title = `${scan.ref} · colis ${scan.index}/${scan.count}`;
  if (result?.status === 'already') {
    const check = result.check;
    const who = check ? `Vérifié par ${checkerName(check, team)} ${checkMoment(check.checkedAt, { now })}. ` : '';
    return { tone: 'warning', title: `${title} déjà vérifié`, detail: `${who}Scannez un autre colis.` };
  }
  // The server's counts when it gives them: the dossier may have been prepared again since this screen read it
  // (a label « 1/3 » accepted while the screen still expects 2 parcels).
  const control = dossierControl(scan.dossier, checks);
  const fromServer = Number(result?.expected) > 0;
  const expected = fromServer ? Number(result.expected) : control.expected;
  const checked = fromServer ? Math.min(Number(result.checked) || 0, expected) : control.checked;
  const complete = expected > 0 && checked >= expected;
  return { tone: 'success', title: `${title} vérifié`, detail: complete ? completeLine(scan.dossier) : remainingLine(expected - checked) };
}

/** The answer of record_loading_count: « EXP-2YE537 · 2 colis comptés à la main ». */
export function countFeedback(dossier, result) {
  const expected = Number(result?.expected) || expectedParcelCount(dossier);
  if (result?.status === 'already') return { tone: 'warning', title: `${dossier.ref} · ${expected > 1 ? `ses ${expected} colis étaient déjà vérifiés` : 'son colis était déjà vérifié'}`, detail: 'Le comptage confirme le contrôle enregistré.' };
  return { tone: 'success', title: `${dossier.ref} · ${plural(expected, 'colis', 'colis')} ${expected > 1 ? 'comptés' : 'compté'} à la main`, detail: completeLine(dossier) };
}

/** A refusal of the server for one scanned parcel: its sentence as it is. */
export function refusedFeedback(scan, message) {
  return { tone: 'error', title: `${scan.ref} · colis ${scan.index}/${scan.count} non vérifié`, detail: message };
}

/** A dossier's checks cleared to redo its control. */
export function clearedFeedback(dossier) {
  return { tone: 'info', title: `${dossier.ref} · contrôle à refaire`, detail: 'Ses contrôles sont effacés sur tous les appareils : scannez ou comptez de nouveau ses colis.' };
}

/** What the person typed in « Compter à la main », against the parcels expected: null when it matches. */
export function countIssue(value, expected) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(text)) return 'Indiquez le nombre de colis comptés, en chiffres.';
  const counted = Number(text);
  if (counted < expected) return 'Il manque des colis : reportez ce dossier ou retrouvez-les.';
  if (counted > expected) return `Plus de colis que préparés (${expected}) : retirez ceux d’un autre dossier, puis recomptez.`;
  return null;
}

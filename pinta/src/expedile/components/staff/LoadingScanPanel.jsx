import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, Calculator, Camera, Check, CheckCircle, Circle, Info, Keyboard, Loader2, RotateCcw, ScanLine, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../ui/useDialog';
import CameraScanner from './CameraScanner';
import { departureReadiness } from '../../domain/departureReadiness';
import { preparedSummary } from '../../domain/departureBoard';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { plural } from '../../domain/plural';
import {
  checkedByLine, checkFeedback, clearedFeedback, continuesLabel, controlTotals, countFeedback, countIssue, dossierControl, elsewhereFeedback,
  expectedParcelCount, keyLine, LAYOUT_NOTICE, mergeLoadingCheck, oldLabelFeedback, readScannedCode, refusedFeedback, severalFeedback,
  unreadableFeedback,
} from '../../domain/loadingControl';
import { clearLoadingChecks, recordLoadingCheck, recordLoadingCount } from '../../services/loadingChecks';
import './loadingScan.css';

// The loading control of a departure (« Vérifier le chargement »): every outgoing parcel handed to the carrier is
// checked, its label scanned (handheld scanner typing into the field, or the tablet camera) or the dossier's parcels
// counted by hand. Each check is recorded by the server at once (services/loadingChecks.js) and shared with every
// device; a dossier is ready once all its parcels are checked. StaffDepartures owns the loading (its dossiers, the
// checks, their refresh every 5 s) and its confirmation.

const GROUPS = [[true, 'Prêts à charger'], [false, 'À débloquer']];
const TONE_ICONS = { success: CheckCircle, warning: AlertTriangle, error: XCircle, info: Info };
// After a reference unknown to this departure, its list is read again from the server at most every 5 s.
const RELOAD_PAUSE_MS = 5000;
// A scanned dossier stays highlighted this long.
const FLASH_MS = 2500;
// Inputs whose keys type no text (a dossier's box, a button): a key typed there belongs to the scan field.
const KEYLESS_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file']);

/** A control that takes typed text (a field, the reason, a list), or a dialog: it keeps its keys. */
function takesText(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable || target.closest('textarea, select, [role="dialog"]')) return true;
  return target.tagName === 'INPUT' && !KEYLESS_INPUTS.has(String(target.type || '').toLowerCase());
}

// ── A short beep and a vibration, where the device has them ─────────────────
let audio = null;
const TONES = { success: [[1046, 0.09]], warning: [[660, 0.08], [660, 0.08]], error: [[220, 0.3]] };
const VIBRATIONS = { success: 40, warning: [60, 60, 60], error: [200, 100, 200] };
function audioContext() {
  if (audio) return audio;
  const Context = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Context) return null;
  try { audio = new Context(); } catch { audio = null; }
  return audio;
}
/** Wakes the sound up during a gesture (a key, a click): browsers keep it asleep until then. */
function primeAudio() {
  try {
    const context = audioContext();
    if (context && context.state === 'suspended') Promise.resolve(context.resume()).catch(() => {});
  } catch { /* No sound on this device. */ }
}
function signal(tone) {
  try {
    const context = audioContext();
    if (context && context.state !== 'closed' && TONES[tone]) {
      let start = context.currentTime + 0.01;
      for (const [frequency, duration] of TONES[tone]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
        start += duration + 0.06;
      }
    }
  } catch { /* The message and its colour remain. */ }
  try {
    if (VIBRATIONS[tone] && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(VIBRATIONS[tone]);
  } catch { /* Vibration is optional. */ }
}

/** The last answer of the loading control: what was checked or refused, in words, with its colour and icon. */
export function ScanFeedback({ feedback, live = true }) {
  const Icon = feedback ? TONE_ICONS[feedback.tone] || Info : null;
  return <div className="loading-scan-feedback" data-tone={feedback?.tone || undefined} role={live ? 'status' : undefined} aria-live={live ? 'polite' : 'off'} aria-atomic="true">
    {feedback && <>
      <Icon size={22} aria-hidden="true" className="loading-scan-feedback-icon" />
      <div className="min-w-0">
        <p className="loading-scan-feedback-title">{feedback.title}</p>
        {feedback.detail && <p>{feedback.detail}</p>}
        {feedback.layout && <p className="loading-scan-layout"><Keyboard size={16} aria-hidden="true" className="shrink-0" />{LAYOUT_NOTICE}</p>}
      </div>
    </>}
  </div>;
}

/** « Compter à la main »: the number of parcels handed over, accepted only when it is the number prepared. */
function CountDialog({ dossier, expected, envoiId, onClose, onSaved, onStale }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const field = useRef(null);
  const pressedBackdrop = useRef(false);
  const close = () => { if (!saving) onClose(); };
  const dialogRef = useDialog(true, close);
  useEffect(() => { field.current?.focus(); }, []);
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const issue = countIssue(value, expected);
    if (issue) { setError(issue); field.current?.focus(); return; }
    setSaving(true); setError('');
    try {
      const result = await recordLoadingCount(envoiId, dossier.id, Number(value.trim()));
      onSaved(result);
    } catch (failure) {
      setError(failure.message);
      setSaving(false);
      // The count matched this screen's preparation before it was sent: a different count on the server means the
      // dossier was prepared again meanwhile. Its preparation is read again, the dialog then shows the new number.
      if (failure.refresh || failure.reason === 'count_mismatch') onStale();
      field.current?.focus();
    }
  };
  const id = `loading-count-${dossier.id}`;
  return createPortal(
    <div
      className="loading-dialog loading-dialog-backdrop"
      onMouseDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (event.target === event.currentTarget && pressedBackdrop.current) close(); pressedBackdrop.current = false; }}
    >
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} className="loading-dialog-panel loading-count">
        <header className="loading-dialog-header">
          <h2 id={`${id}-title`} className="loading-dialog-title"><Calculator size={20} aria-hidden="true" /><span>Compter les colis de <span className="whitespace-nowrap">{dossier.ref}</span></span></h2>
          <button type="button" aria-label="Fermer le comptage" disabled={saving} onClick={close} className="loading-icon-button"><X size={20} aria-hidden="true" /></button>
        </header>
        <form noValidate onSubmit={submit} className="loading-count-form">
          <p id={`${id}-intro`} className="loading-count-intro">Préparation : {plural(expected, 'colis', 'colis')}. Comptez les colis de ce dossier réellement remis au transporteur.</p>
          <div>
            <label htmlFor={`${id}-value`} className="loading-label">Colis remis au transporteur</label>
            <input
              ref={field} id={`${id}-value`} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={3} value={value} disabled={saving}
              onChange={(event) => { setValue(event.target.value); if (error) setError(''); }}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-help`} className="loading-field"
            />
            {error ? <p id={`${id}-error`} role="alert" className="loading-field-error">{error}</p> : <p id={`${id}-help`} className="loading-help">Le dossier est vérifié seulement si le nombre compté est exact.</p>}
          </div>
          <div className="loading-dialog-actions">
            <button type="submit" className="loading-button loading-button--primary" disabled={saving}>{saving ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Check size={16} aria-hidden="true" />}Enregistrer le comptage</button>
            <button type="button" className="loading-button" disabled={saving} onClick={close}>Annuler</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

/**
 * The scan bar (field, camera, last answer, totals) and the dossiers of the loading with their parcels checked.
 * `checks`: the departure's checks (services/loadingChecks.js mapLoadingCheck); `excluded`: dossiers the person who
 * confirms set aside; `canConfirm`: the dossiers carry the boxes of the confirmation, otherwise their state only.
 * Callbacks: `onCheck(check)` a recorded check, `onCleared(colisId)` a dossier's checks removed, `onRefreshChecks()`
 * and `onReload()` (resolves the dossiers read again) return promises, `onToggle(colisId, checked)`,
 * `onPendingChange(count)` the checks still being recorded. `scanRef` receives the function handling a code scanned
 * elsewhere on the page (a label scanned while the focus was in another field), as the scan field does:
 * `(text, line)`, `line` the timing of its keys (keyLine).
 */
export default function LoadingScanPanel({
  envoi, dossiers, checks, checksError, canConfirm, excluded = [], busy, inputRef, scanRef, returnTo, now,
  onToggle, onCheck, onCleared, onRefreshChecks, onReload, onPendingChange,
}) {
  const { clients, data, envois, teamUsers, setCfm } = useApp();
  const [feedback, setFeedback] = useState(null);
  const [flash, setFlash] = useState(null);
  const [counting, setCounting] = useState(null);
  // The camera panel, open: the number of the last answer when it opened (it shows only the answers that follow).
  const [camera, setCamera] = useState(null);
  const [pending, setPending] = useState(0);
  const barRef = useRef(null);
  const queue = useRef([]);
  const draining = useRef(false);
  const lastReload = useRef(-Infinity);
  const sequence = useRef(0);
  const focusScan = useRef(false);
  // The keys typed into the scan field (keyLine), and the line its last Enter ended, which the form sends just after.
  const fieldKeys = useRef(null);
  if (!fieldKeys.current) fieldKeys.current = keyLine();
  const fieldLine = useRef(null);
  // The Enter of the last line typed (scan field, camera, reason) and the first line of the label being read: a
  // scanner sends a former label's QR code line by line (reference, name, address, phone).
  const lastEnter = useRef(null);
  const labelHead = useRef(null);
  const latest = useRef({});
  latest.current = { envoi, dossiers, checks, data, envois, teamUsers, onCheck, onCleared, onRefreshChecks, onReload };

  const show = (next, dossierId = null, { sound = true } = {}) => {
    sequence.current += 1;
    setFeedback({ ...next, key: sequence.current });
    // Only the dossier of this answer is highlighted: an answer without a dossier of the loading highlights none.
    setFlash(dossierId ? { id: dossierId, tone: next.tone, key: sequence.current } : null);
    if (sound) signal(next.tone);
  };
  const track = async (promise) => {
    setPending((count) => count + 1);
    try { return await promise; } finally { setPending((count) => count - 1); }
  };
  const reload = () => latest.current.onReload().catch(() => null);

  // One scanned text: read it, find its dossier, then let the server record it (or say why not).
  const handle = async ({ text, method, sameLabel = false }) => {
    const { envoi: current, teamUsers: team } = latest.current;
    let scan = readScannedCode(text, latest.current.dossiers);
    if (scan.kind === 'empty') return;
    if (scan.kind === 'unreadable' && sameLabel) {
      // The rest of a former label (name, address, phone), typed by the scanner just after its reference: never
      // answered line by line, the reference's answer stays. Several parcels: the label is explained once.
      const head = labelHead.current;
      if (head && head.kind === 'several' && !head.explained) { head.explained = true; show(oldLabelFeedback(head), head.dossier.id, { sound: false }); }
      return;
    }
    labelHead.current = scan;
    if (scan.kind === 'unreadable') { show(unreadableFeedback(scan.text)); return; }
    if (scan.kind === 'elsewhere' && performance.now() - lastReload.current > RELOAD_PAUSE_MS) {
      // The departure's list on the server first: a dossier assigned to it meanwhile is found there.
      lastReload.current = performance.now();
      const fresh = await reload();
      if (fresh) { scan = readScannedCode(text, fresh); labelHead.current = scan; }
    }
    if (scan.kind === 'elsewhere') {
      show({ ...elsewhereFeedback(scan.ref, { dossiers: latest.current.data, envois: latest.current.envois, envoiId: current.id }), layout: scan.layoutCorrected });
      return;
    }
    if (scan.kind === 'several') { show({ ...(scan.oldLabel ? oldLabelFeedback(scan) : severalFeedback(scan)), layout: scan.layoutCorrected }, scan.dossier.id); return; }
    try {
      const result = await recordLoadingCheck(current.id, scan.dossier.id, scan.index, scan.count, method);
      const rows = result.check ? mergeLoadingCheck(latest.current.checks, result.check) : latest.current.checks;
      if (result.check) latest.current.onCheck(result.check);
      show({ ...checkFeedback(scan, result, rows, { team }), layout: scan.layoutCorrected }, scan.dossier.id);
      // The server counts another number of parcels than this screen: the dossier was prepared again meanwhile
      // (new labels). Its preparation is read again, so that its parcels and this check show.
      if (result.expected > 0 && result.expected !== expectedParcelCount(scan.dossier)) reload();
    } catch (failure) {
      show({ ...refusedFeedback(scan, failure.message), layout: scan.layoutCorrected }, scan.dossier.id);
      if (failure.refresh) reload();
    }
  };
  // Scans are handled one after the other, in the order they came: a fast scanner never mixes two codes.
  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current.shift();
        try { await handle(item); }
        catch (issue) { show({ tone: 'error', title: 'Code non traité', detail: issue?.message || 'Scannez-le de nouveau.' }); }
        finally { setPending((count) => count - 1); }
      }
    } finally { draining.current = false; }
    // The checks of the other devices too, once this series is recorded.
    latest.current.onRefreshChecks().catch(() => {});
  };
  const enqueue = (text, method, { sameLabel = false } = {}) => {
    queue.current.push({ text, method, sameLabel });
    setPending((count) => count + 1);
    drain();
  };
  /** A line typed by a scanner or a person (scan field, camera open, reason), `line` the timing of its keys. */
  const enqueueTyped = (text, line = null) => {
    const previous = lastEnter.current;
    lastEnter.current = line ? line.enter : null;
    enqueue(text, 'scan', { sameLabel: continuesLabel(line, previous) });
  };
  const submit = (event) => {
    event.preventDefault();
    primeAudio();
    const input = inputRef.current;
    const text = input ? input.value : '';
    // The line its Enter ended (none after a click on « Valider »).
    const line = fieldLine.current;
    fieldLine.current = null;
    fieldKeys.current.reset();
    // Emptied at once and kept focused: the next scan starts on an empty field.
    if (input) { input.value = ''; input.focus(); }
    if (text.trim()) enqueueTyped(text, line);
  };

  const counted = (dossier, result) => {
    focusScan.current = true;
    setCounting(null);
    show(countFeedback(dossier, result), dossier.id);
    track(latest.current.onRefreshChecks().catch(() => {}));
  };
  const clear = (dossier) => {
    const control = dossierControl(dossier, latest.current.checks);
    setCfm({
      title: `Recommencer le contrôle de ${dossier.ref} ?`,
      msg: `${control.checked > 1 ? `Ses ${control.checked} colis vérifiés seront` : 'Son colis vérifié sera'} à scanner ou à compter de nouveau, sur tous les appareils. L’effacement reste inscrit dans l’historique du dossier.`,
      okLabel: 'Recommencer le contrôle',
      // A refusal (a lost connection, a colleague's change) stays in the dialog, which stays open.
      inlineError: true,
      onOk: () => track((async () => {
        try { await clearLoadingChecks(latest.current.envoi.id, dossier.id); }
        catch (failure) { if (failure.refresh) reload(); throw failure; }
        latest.current.onCleared(dossier.id);
        show(clearedFeedback(dossier), dossier.id, { sound: false });
        inputRef.current?.focus({ preventScroll: true });
        await latest.current.onRefreshChecks().catch(() => {});
      })()),
    });
  };

  useEffect(() => { onPendingChange?.(pending); }, [pending]);
  useEffect(() => {
    if (!scanRef) return undefined;
    scanRef.current = (text, line) => { primeAudio(); enqueueTyped(text, line); };
    return () => { scanRef.current = null; };
  });
  // A dossier's control reached from the keyboard (Tab, Shift+Tab, a dialog giving its focus back) is never hidden
  // under the scan bar: the browser only brings it inside the scroller, whose top the bar covers. It lands just under
  // the bar's full height (near the end of the list the bar is pushed partly up, and comes back whole once the list
  // scrolls). After a press of the pointer (as for :focus-visible) nothing moves: what was pressed was in view, and
  // the list moving between the press and the release would lose the click.
  useEffect(() => {
    const bar = barRef.current;
    const root = bar && bar.parentElement;
    if (!root) return undefined;
    let pointer = false;
    const pressed = () => { pointer = true; };
    const typed = () => { pointer = false; };
    const focused = (event) => {
      const target = event.target;
      if (pointer || !(target instanceof Element) || bar.contains(target)) return;
      let scroller = target.parentElement;
      while (scroller && scroller !== document.body && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
      if (!scroller || scroller === document.body) scroller = document.scrollingElement || document.documentElement;
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const covered = top + bar.offsetHeight + 12 - target.getBoundingClientRect().top;
      if (covered > 0) scroller.scrollBy({ top: -covered });
    };
    document.addEventListener('pointerdown', pressed, true);
    document.addEventListener('keydown', typed, true);
    root.addEventListener('focusin', focused);
    return () => {
      document.removeEventListener('pointerdown', pressed, true);
      document.removeEventListener('keydown', typed, true);
      root.removeEventListener('focusin', focused);
    };
  }, []);
  // After a count, the field takes the focus back once the dialog has given it to its opener.
  useEffect(() => {
    if (counting || !focusScan.current) return;
    focusScan.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [counting]);
  // A scanned dossier comes into view (under the scan bar) and stays highlighted a moment.
  useEffect(() => {
    if (!flash) return undefined;
    const node = document.querySelector(`[data-loading-dossier="${flash.id}"]`);
    if (node) {
      const box = node.getBoundingClientRect();
      const bar = barRef.current;
      const top = Math.max(0, bar ? bar.getBoundingClientRect().bottom : 0);
      if (box.top < top || box.bottom > window.innerHeight) {
        const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Just under the bar, which stays at the top of the page: its height follows the length of the last answer.
        // The first dossier of a group keeps the group's title above it, whole. A browser that ignores scroll-margin
        // (Safari 14.0) would put the dossier under the bar: it centres it instead, as before.
        const title = node.previousElementSibling && node.previousElementSibling.classList.contains('loading-group-title') ? node.previousElementSibling : null;
        const underBar = 'scrollMarginTop' in node.style;
        if (underBar) node.style.scrollMarginTop = `${Math.ceil((bar ? bar.offsetHeight : 0) + (title ? title.offsetHeight : 0)) + 8}px`;
        node.scrollIntoView({ block: underBar ? 'start' : 'center', behavior: still ? 'auto' : 'smooth' });
      }
    }
    const timer = setTimeout(() => setFlash((current) => (current && current.key === flash.key ? null : current)), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash?.key]);
  // A scanner types wherever the focus is: a code typed outside a text field (after a click on a dossier's box or
  // button) still goes to the scan field, never into the page. Text fields and dialogs keep their keys; Space keeps
  // ticking a box or pressing a button.
  useEffect(() => {
    const keydown = (event) => {
      const field = inputRef.current;
      if (field && event.target === field) {
        // The keys of the scan field, timed: its Enter ends the line the form then sends.
        const line = fieldKeys.current.track(event);
        if (line) fieldLine.current = line;
        return;
      }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (typeof event.key !== 'string' || event.key.length !== 1 || event.key === ' ') return;
      if (takesText(event.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (!field) return;
      // The first key of a code: the field takes it, and the next ones.
      fieldKeys.current.reset();
      fieldKeys.current.track(event);
      field.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);

  const totals = controlTotals(dossiers, checks);
  const countingDossier = counting ? dossiers.find((item) => item.id === counting) || null : null;
  const fieldId = `loading-scan-${envoi.id}`;

  function renderDossier(item) {
    const readiness = departureReadiness(item);
    const control = dossierControl(item, checks);
    const aside = excluded.includes(item.id);
    const ticked = readiness.eligible && control.complete && !aside;
    const why = !readiness.eligible ? 'reasons' : !control.complete ? 'incomplete' : aside ? 'aside' : null;
    const whyId = `loading-why-${item.id}`;
    const line = checkedByLine(control, { now, team: teamUsers });
    const name = <span className="loading-dossier-name"><strong>{item.ref}</strong> · {clients.find((client) => client.id === item.clientId)?.nom}</span>;
    const locked = busy || !readiness.eligible || !control.complete;
    return <article key={item.id} data-loading-dossier={item.id} data-flash={flash && flash.id === item.id ? flash.tone : undefined} className="loading-dossier">
      {canConfirm
        ? <label className="loading-dossier-check" data-enabled={locked ? undefined : 'true'}><input type="checkbox" checked={ticked} disabled={locked} aria-describedby={why ? whyId : undefined} onChange={(event) => onToggle(item.id, event.target.checked)} />{name}</label>
        : <p className="loading-dossier-check">{name}{ticked && <span className="loading-ready"><CheckCircle size={16} aria-hidden="true" />Prête à partir</span>}</p>}
      {readiness.eligible && <p className="text-sm text-gray-600">{preparedSummary(readiness.count, readiness.weights?.realWeight)}{readiness.legacySingle ? ' · Ancien dossier : un seul colis physique attendu.' : ''}</p>}
      {control.expected > 0
        ? <div className="loading-progress">
          <p className="loading-progress-count">Colis vérifiés {control.checked}/{control.expected}</p>
          <ul className="loading-chips" aria-label={`Colis de ${item.ref}`}>
            {Array.from({ length: control.expected }, (_, position) => position + 1).map((index) => {
              const done = control.done.includes(index);
              return <li key={index} className="loading-chip" data-done={done ? 'true' : undefined}>{done ? <Check size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}Colis {index}<span className="sr-only">{done ? ' : vérifié' : ' : à vérifier'}</span></li>;
            })}
          </ul>
        </div>
        : <p className="loading-hint">Colis sortants pas encore préparés : leur contrôle commence après la préparation.</p>}
      {line && <p className="loading-checked-by"><CheckCircle size={16} aria-hidden="true" className="shrink-0" />{line}</p>}
      {canConfirm && (why === 'incomplete' || why === 'aside') && <p id={whyId} className="loading-hint">{why === 'aside' ? 'Décochée : ce dossier sera reporté.' : `Cochée automatiquement dès que ${control.expected > 1 ? `ses ${control.expected} colis sont vérifiés` : 'son colis est vérifié'}.`}</p>}
      {readiness.reasons.length > 0 && <div id={whyId}>{readiness.reasons.map((reason) => <div key={reason.task} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800"><span>{reason.text}</span><Link to={dossierTaskUrl(item.id, reason.task, new URLSearchParams({ returnTo }).toString())} className="inline-flex min-h-11 items-center underline">{reason.task === 'paiement' ? 'Vérifier le paiement' : 'Vérifier la préparation'}</Link></div>)}</div>}
      {control.expected > 0 && (!control.complete || control.checked > 0) && <div className="loading-dossier-actions">
        {!control.complete && <button type="button" className="loading-button" disabled={busy} aria-label={`Compter à la main les colis de ${item.ref}`} onClick={() => setCounting(item.id)}><Calculator size={16} aria-hidden="true" />Compter à la main</button>}
        {control.checked > 0 && <button type="button" className="loading-button" disabled={busy} aria-label={`Recommencer le contrôle de ${item.ref}`} onClick={() => clear(item)}><RotateCcw size={16} aria-hidden="true" />Recommencer</button>}
      </div>}
    </article>;
  }

  return <div className="loading-scan">
    <div ref={barRef} className="loading-scan-bar bg-white">
      <form noValidate onSubmit={submit} className="loading-scan-form">
        <label htmlFor={fieldId} className="loading-label">Scanner un colis</label>
        <div className="loading-scan-row">
          <div className="loading-scan-input">
            <ScanLine size={18} aria-hidden="true" className="loading-scan-input-icon" />
            <input
              ref={inputRef} id={fieldId} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go"
              placeholder="Code de l’étiquette" aria-describedby={`${fieldId}-help`} className="loading-field"
            />
          </div>
          <button type="submit" className="loading-button loading-button--primary">Valider</button>
          {/* On a phone the icon alone: the bar stays short, the name stays « Scanner avec la caméra ». */}
          <button type="button" className="loading-button loading-camera-button" onClick={() => { primeAudio(); setCamera(sequence.current); }}><Camera size={18} aria-hidden="true" className="shrink-0" /><span className="loading-camera-text">Scanner avec la caméra</span></button>
        </div>
        <p id={`${fieldId}-help`} className="loading-help loading-scan-help">Douchette ou saisie : le code de l’étiquette (EXP-…-1-2), puis Entrée. Chaque colis vérifié est enregistré pour toute l’équipe.</p>
      </form>
      <ScanFeedback feedback={feedback} live={camera === null} />
      {checksError && <p className="loading-warning"><AlertTriangle size={16} aria-hidden="true" className="shrink-0" /><span>Les contrôles des autres appareils n’ont pas pu être relus : ceux affichés datent de la dernière lecture. Nouvel essai toutes les 5 secondes.{checksError.reason !== 'network' && checksError.message ? ` ${checksError.message}` : ''}</span></p>}
      <p className="loading-totals"><span>Colis vérifiés {totals.checked}/{totals.expected}</span><span aria-hidden="true" className="loading-totals-dot">·</span><span>Expéditions prêtes {totals.ready}/{totals.total}</span>{pending > 0 && <span className="loading-pending"><Loader2 size={14} aria-hidden="true" className="animate-spin" />Enregistrement…</span>}</p>
    </div>
    {GROUPS.map(([ready, label]) => {
      const rows = dossiers.filter((item) => departureReadiness(item).eligible === ready);
      return <div key={label} className="loading-group">
        <h3 className="loading-group-title">{label} ({rows.length})</h3>
        {rows.map(renderDossier)}
        {!rows.length && <p className="py-2 text-sm text-gray-600">Aucun dossier dans ce groupe.</p>}
      </div>;
    })}
    {countingDossier && <CountDialog dossier={countingDossier} expected={expectedParcelCount(countingDossier)} envoiId={envoi.id} onClose={() => setCounting(null)} onSaved={(result) => counted(countingDossier, result)} onStale={reload} />}
    {/* An answer given before the camera opened is not shown in it; those that follow are, the scanner's too (a
        label scanned with the scanner while the camera is open is checked as a scan). */}
    {camera !== null && <CameraScanner onClose={() => setCamera(null)} onCode={(text) => enqueue(text, 'camera')} onTyped={(text, line) => { primeAudio(); enqueueTyped(text, line); }}>
      <ScanFeedback feedback={feedback && feedback.key > camera ? feedback : null} />
    </CameraScanner>}
  </div>;
}

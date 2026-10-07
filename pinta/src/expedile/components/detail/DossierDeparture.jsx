import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Loader2, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { departureDayLabel } from '../../domain/departureGroups';
import { closingLabel, departureDefaultClosing, departureEditable, departureFieldEditable, departureFieldText } from '../../domain/departurePlanning';
import {
  WEEKDAYS, addMonths, calendarDay, calendarMonthBounds, dayProposal, departureCalendarContext, departureShortcuts,
  initialCalendarMonth, initialFocusDay, monthLabel, monthOf, monthWeeks, moveCalendarFocus, sameDayInMonth,
} from '../../domain/departureCalendar';
import { subscriptionEndConfirmation } from '../../domain/dossierAlerts';
import './dossierActions.css';
import './dossierDeparture.css';

// « À vérifier › Choisir ou créer le départ » opens the overview field with ?modifier=depart.
const EDIT_REQUEST = 'depart';

/** « Départ » of a dossier, at every step until the parcel leaves: the overview
 * line with « Modifier » (`summary`), or the open field of the expedition task
 * (`task`, « Affecter à un départ »). The field is a calendar (lot P4b): the
 * next three departures the dossier can join (the server's rule) as one-click
 * shortcuts, then a month grid of Paris days (WAI-ARIA date grid). A departure
 * day or a shortcut assigns at once (confirmed first only after the client's
 * subscription end); a day to come without departure proposes, right below,
 * to create that departure (aérien, habitual Wednesday 17 h closing) or to keep
 * the day as the desired one; a closed day says so; a past day is not
 * selectable. With a departure assigned, both proposals say they replace it and
 * the replacement is confirmed first. Every write is a server command with the
 * dossier version; nothing is shown as saved before its answer, and a write in
 * flight keeps the field open until that answer. A version conflict reloads the
 * dossier and asks to check, then start again: a retry never reuses the
 * outdated version.
 * `can` is the permission check of the surrounding task, if any; `readOnly`
 * (with `lockedReason`) keeps the line read-only while a colleague holds the
 * task. With a function as `children`, the summary hands `{ line, editor }` to
 * its caller, which places the editor after its own actions (DOM order = visual
 * order); otherwise the line and its editor follow each other. */
export default function DossierDeparture({ variant = 'summary', can: taskCan, readOnly = false, lockedReason = '', children }) {
  const { sel: dossier, selClient: client, envois = [], can: appCan, assignDeparture, setDepartureWish, createDepartureForColis, refreshColis, ask, flash } = useApp();
  const can = taskCan || appCan;
  const summary = variant !== 'task';
  const location = useLocation();
  const navigate = useNavigate();
  const now = useMinuteNow();
  const [editing, setEditing] = useState(false);
  // The month shown (null: the opening month) and the day holding the grid's focus.
  const [month, setMonth] = useState(null);
  const [focusDay, setFocusDay] = useState(null);
  // A day without a usable departure, whose proposal shows below the calendar.
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  const pickerRef = useRef(null);
  const gridRef = useRef(null);
  const editButton = useRef(null);
  const wasEditing = useRef(false);
  const keyboardMove = useRef(false);
  // The dossier on screen: a late answer about another dossier changes nothing here.
  const shownDossier = useRef(dossier?.id);
  shownDossier.current = dossier?.id;
  const editorId = useId(), labelId = useId(), monthId = useId(), shortcutsId = useId(), proposalId = useId();

  const visible = Boolean(dossier) && departureEditable(dossier);
  const assigned = dossier?.envoi || null;
  // Same rule as the server: assigning needs perm_colis_affecter_envoi, changing
  // or removing an assigned departure perm_envois_reaffecter. Choosing needs to
  // see the planning. A colleague's task keeps it read-only.
  const permitted = visible && departureFieldEditable(dossier, can);
  const editable = permitted && !readOnly;
  const canCreate = editable && can('perm_envois_creer');
  const render = typeof children === 'function' ? children : null;
  const open = summary ? editing : true;

  const resetCalendar = () => { setMonth(null); setFocusDay(null); setChosen(null); };
  useEffect(() => {
    wasEditing.current = false;
    setEditing(false); setMonth(null); setFocusDay(null); setChosen(null); setError(''); setFeedback('');
  }, [dossier?.id]);
  useEffect(() => {
    if (!summary || !dossier) return;
    const params = new URLSearchParams(location.search);
    if (params.get('modifier') !== EDIT_REQUEST) return;
    if (editable) { setMonth(null); setFocusDay(null); setChosen(null); setError(''); setEditing(true); }
    params.delete('modifier');
    navigate(`${location.pathname}?${params}${location.hash}`, { replace: true, state: location.state });
  }, [summary, dossier, editable, location.search, location.pathname, location.hash, location.state, navigate]);
  // Opening gives the focus to the first shortcut (else the grid) and brings the
  // calendar into view; closing gives it back to « Modifier ».
  useEffect(() => {
    if (!editing) {
      if (wasEditing.current) editButton.current?.focus();
      wasEditing.current = false;
      return undefined;
    }
    wasEditing.current = true;
    const frame = requestAnimationFrame(() => {
      const picker = pickerRef.current;
      (picker?.querySelector('[data-shortcut]') || picker?.querySelector('[data-day][tabindex="0"]'))?.focus({ preventScroll: true });
      picker?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  // A keyboard move (possibly into another month) focuses its day once drawn.
  useEffect(() => {
    if (!keyboardMove.current) return;
    keyboardMove.current = false;
    gridRef.current?.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, month]);
  // The proposal of a picked day comes into view (on a phone it would sit under
  // the bottom navigation); its scroll-margin keeps room for that navigation.
  const revealProposal = useCallback(node => {
    if (node) requestAnimationFrame(() => { if (node.isConnected) node.scrollIntoView({ block: 'nearest' }); });
  }, []);

  if (!visible) return render ? render({ line: null, editor: null }) : null;

  const context = departureCalendarContext(dossier, client, envois, { now });
  const text = departureFieldText(dossier, envois, { today: now, client });
  const bounds = calendarMonthBounds(context);
  const shownMonth = month || initialCalendarMonth(context);
  const activeDay = focusDay && monthOf(focusDay) === shownMonth ? focusDay : initialFocusDay(shownMonth, context);
  const shortcuts = departureShortcuts(context);
  const proposal = chosen ? dayProposal(chosen, context, { canCreate }) : null;
  const selectedDay = chosen || context.assignedDay || context.wishDay;
  const currentName = context.assigned?.date ? `départ du ${departureDayLabel(context.assigned.date, { today: now })}` : 'départ actuel';
  const currentRef = context.assigned?.ref ? ` (${context.assigned.ref})` : '';

  const startEditing = () => { setError(''); setFeedback(''); resetCalendar(); setEditing(true); };
  const stopEditing = () => { setEditing(false); resetCalendar(); setError(''); };
  // One write at a time; the field shows the saved dossier, or the server's refusal.
  // A version conflict (40001: a colleague saved the dossier meanwhile) reloads
  // the dossier first, so the next choice starts from its saved version.
  const run = async action => {
    if (lock.current) return;
    const owner = dossier.id;
    lock.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const done = await action();
      if (owner !== shownDossier.current) return;
      setChosen(null);
      // One confirmation, announced once: the field's own line in the task, a
      // success toast once the overview's field closes.
      if (summary) { flash({ msg: done.toast, type: 'success' }); setEditing(false); }
      else setFeedback(done.feedback);
    } catch (failure) {
      if (owner !== shownDossier.current) return;
      if (failure?.code === '40001') {
        const reloaded = await refreshColis(owner).then(() => true, () => false);
        if (owner !== shownDossier.current) return;
        setError(reloaded ? 'Le dossier a changé : il a été rechargé, vérifiez puis recommencez.'
          : 'Le dossier a changé et n’a pas pu être rechargé. Actualisez la page, vérifiez puis recommencez.');
      } else setError(failure?.message || 'Le départ n’a pas pu être enregistré. Réessayez.');
    } finally {
      lock.current = false; setBusy(false);
    }
  };
  const idle = () => !busy && !lock.current;
  // After the end of the subscription the date is confirmed first, with the
  // same question as an assignment; cancelling writes nothing.
  const afterSubscription = (date, proceed) => {
    const confirmation = subscriptionEndConfirmation({ date }, client, { today: now });
    if (confirmation) ask(confirmation.title, confirmation.message, proceed, { okLabel: confirmation.okLabel });
    else proceed();
  };
  // A departure day or a shortcut: assigned at once (the user's decision).
  const assign = envoi => {
    if (!idle()) return;
    setError(''); setFeedback(''); setChosen(null);
    if (envoi.id === assigned) { if (summary) stopEditing(); return; }
    afterSubscription(envoi.date, () => run(async () => {
      await assignDeparture(dossier, envoi.id);
      return { feedback: 'Départ enregistré.', toast: 'Départ enregistré' };
    }));
  };
  // Creation on a day without departure: no extra question, except the
  // replacement of an assigned departure (and the subscription end).
  const create = day => {
    if (!idle()) return;
    const write = () => run(async () => {
      await createDepartureForColis(dossier, day);
      return { feedback: 'Départ créé et enregistré.', toast: 'Départ créé et enregistré' };
    });
    afterSubscription(day, () => assigned ? ask(`Remplacer le ${currentName} ?`,
      `Le dossier ${dossier.ref} quittera le ${currentName}${currentRef} pour un nouveau départ aérien le ${departureDayLabel(day, { today: now })}, clôture ${closingLabel(departureDefaultClosing(day), { today: now })} (heure de Paris). Aucun message n’est envoyé au client.`,
      write, { okLabel: 'Remplacer le départ' }) : write());
  };
  // Keeping a day as the desired one; with a departure assigned it leaves that departure: confirmed first.
  const keepWish = day => {
    if (!idle()) return;
    const write = () => run(async () => {
      // The server assigns the departure of that day if one exists meanwhile.
      const saved = await setDepartureWish(dossier, day);
      return saved.envoi ? { feedback: 'Départ enregistré.', toast: 'Départ enregistré' } : { feedback: 'Départ souhaité enregistré.', toast: 'Départ souhaité enregistré' };
    });
    afterSubscription(day, () => assigned ? ask(`Remplacer le ${currentName} ?`,
      `Le dossier ${dossier.ref} quittera le ${currentName}${currentRef}. Il gardera la date du ${departureDayLabel(day, { today: now })}, dont le départ reste à créer. Aucun message n’est envoyé au client.`,
      write, { okLabel: 'Remplacer le départ' }) : write());
  };
  const remove = () => {
    if (!idle()) return;
    setChosen(null);
    run(async () => {
      if (assigned) {
        await assignDeparture(dossier, null);
        return { feedback: 'Affectation retirée.', toast: 'Départ retiré' };
      }
      await setDepartureWish(dossier, null);
      return { feedback: 'Date souhaitée retirée.', toast: 'Date souhaitée retirée' };
    });
  };
  const chooseDay = info => {
    setFocusDay(info.day);
    if (!idle() || info.kind === 'past') return;
    setError(''); setFeedback('');
    if (info.kind === 'departure') assign(info.envoi);
    else setChosen(info.day);
  };
  const goMonth = delta => {
    const next = addMonths(shownMonth, delta);
    if (next < bounds.first || next > bounds.last) return;
    setMonth(next); setFocusDay(sameDayInMonth(activeDay, next));
  };
  const onGridKeyDown = event => {
    const next = moveCalendarFocus(activeDay, event.key, context, { shift: event.shiftKey });
    if (!next) return;
    event.preventDefault();
    keyboardMove.current = true;
    setFocusDay(next); setMonth(monthOf(next));
  };
  const onPickerKeyDown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    // A write in flight keeps the field open: its answer, or its refusal, shows here.
    if (!idle()) return;
    if (summary) stopEditing();
    else setChosen(null);
  };

  const line = <div className="dossier-departure-line" data-overview={summary ? 'departure' : undefined} data-departure-state={text.state} data-wish-state={text.wishState} data-envoi={assigned || ''} data-wish={context.wishDay || ''}>
    <span className="dossier-departure-text">{text.prefix} : <strong>{text.value}</strong></span>
    {summary && editable && <button ref={editButton} type="button" className="dossier-departure-edit" aria-label="Modifier le départ du dossier"
      aria-expanded={editing} aria-controls={editing ? editorId : undefined} disabled={busy} onClick={() => (editing ? stopEditing() : startEditing())}>
      <Pencil size={14} aria-hidden="true" /><span>Modifier</span>
    </button>}
    {summary && permitted && readOnly && lockedReason && <span className="dossier-departure-locked">{lockedReason}</span>}
  </div>;

  const weeks = monthWeeks(shownMonth);
  const picker = open && editable && <div id={editorId} ref={pickerRef} className="dossier-departure-picker" data-variant={variant} role="group" aria-labelledby={labelId}
    aria-busy={busy || undefined} onKeyDown={onPickerKeyDown} style={{ '--shortcut-count': shortcuts.length }}>
    {summary && <div className="dossier-departure-label-row">
      <p id={labelId} className="dossier-departure-label">Départ de cette expédition</p>
      <button type="button" className="dossier-departure-cancel" disabled={busy} onClick={stopEditing}>Annuler</button>
    </div>}
    {busy && <p role="status" className="dossier-departure-saving"><Loader2 size={16} aria-hidden="true" className="animate-spin" />Enregistrement en cours…</p>}

    {shortcuts.length > 0 ? <div className="dossier-departure-shortcuts-block">
      <p id={shortcutsId} className="dossier-departure-shortcuts-title">Prochains départs pour {context.where}</p>
      <ul className="dossier-departure-shortcuts" aria-labelledby={shortcutsId}>
        {shortcuts.map(item => <li key={item.envoi.id}>
          <button type="button" data-shortcut data-envoi={item.envoi.id} aria-current={item.current ? 'true' : undefined} aria-disabled={busy || undefined}
            className="dossier-departure-shortcut" onClick={() => assign(item.envoi)}>
            <span className="dossier-departure-shortcut-day">{item.current && <Check size={16} aria-hidden="true" />}{item.label}</span>
            {item.closing && <span className="dossier-departure-shortcut-closing">{item.closing}</span>}
            {item.current && <span className="dossier-departure-shortcut-current">Départ du dossier</span>}
          </button>
        </li>)}
      </ul>
    </div> : <p className="dossier-departure-none">{context.where ? `Aucun départ ouvert pour ${context.where} : choisissez un jour pour créer le départ ou garder une date souhaitée.` : 'Destination du client inconnue : complétez son code postal pour choisir un départ.'}</p>}

    <div className="dossier-calendar">
      <div className="dossier-calendar-nav">
        <button type="button" className="dossier-calendar-step" aria-label="Mois précédent" disabled={shownMonth <= bounds.first} onClick={() => goMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <p id={monthId} className="dossier-calendar-month" aria-live="polite">{monthLabel(shownMonth)}</p>
        <button type="button" className="dossier-calendar-step" aria-label="Mois suivant" disabled={shownMonth >= bounds.last} onClick={() => goMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <table ref={gridRef} role="grid" aria-labelledby={monthId} className="dossier-calendar-grid" data-month={shownMonth} onKeyDown={onGridKeyDown}>
        <thead><tr>{WEEKDAYS.map(day => <th key={day.short} scope="col" abbr={day.long}>{day.short}</th>)}</tr></thead>
        <tbody>{weeks.map((week, index) => <tr key={index}>{week.map((day, column) => {
          if (!day) return <td key={`empty-${column}`} role="gridcell" className="dossier-calendar-empty" />;
          const info = calendarDay(day, context);
          return <td key={day} role="gridcell" aria-selected={day === selectedDay ? 'true' : undefined}>
            <button type="button" className="dossier-calendar-day" data-day={day} data-kind={info.kind}
              data-assigned={info.assigned || undefined} data-wish={info.wish || undefined} data-chosen={day === chosen || undefined}
              tabIndex={day === activeDay ? 0 : -1} aria-label={info.label} aria-current={info.today ? 'date' : undefined}
              aria-disabled={info.kind === 'past' || busy ? 'true' : undefined} aria-describedby={day === chosen ? proposalId : undefined}
              onClick={() => chooseDay(info)} onFocus={() => { if (day !== activeDay) setFocusDay(day); }}>{info.number}</button>
          </td>;
        })}</tr>)}</tbody>
      </table>
      <ul className="dossier-calendar-legend">
        <li><span className="dossier-calendar-swatch" data-swatch="departure" aria-hidden="true" />départ prévu</li>
        <li><span className="dossier-calendar-swatch" data-swatch="chosen" aria-hidden="true" />jour choisi</li>
        <li><span className="dossier-calendar-swatch" data-swatch="closed" aria-hidden="true" />départ clôturé ou parti</li>
      </ul>
    </div>

    {/* Right below the calendar: what the chosen day offers (announced as it changes). */}
    <div className="dossier-departure-proposal-zone" aria-live="polite">
      {proposal && <div key={proposal.day} ref={revealProposal} className="dossier-departure-proposal" data-kind={proposal.kind} data-day={proposal.day}>
        <p id={proposalId} className="dossier-departure-proposal-title">{proposal.message}</p>
        {proposal.kind === 'free' && <>
          {proposal.note && <p className="dossier-departure-proposal-note">{proposal.note}</p>}
          {proposal.create && <div className="dossier-departure-proposal-action">
            <button type="button" className="dossier-primary-button" data-action="create" aria-disabled={busy || undefined} onClick={() => create(proposal.day)}>{proposal.createLabel}</button>
            <p className="dossier-departure-proposal-closing">{proposal.closingText}</p>
          </div>}
          {proposal.keep && <button type="button" className="dossier-departure-secondary" data-action="wish" aria-disabled={busy || undefined} onClick={() => keepWish(proposal.day)}>{proposal.keepLabel}</button>}
        </>}
      </div>}
    </div>

    {(assigned || context.wishDay) && <div className="dossier-departure-tertiary">
      <button type="button" className="dossier-departure-cancel" data-action="remove" aria-disabled={busy || undefined} onClick={remove}>{assigned ? 'Retirer le départ' : 'Retirer la date souhaitée'}</button>
    </div>}
    {error && <p role="alert" className="dossier-departure-error">{error}</p>}
  </div>;

  if (summary) return render ? render({ line, editor: picker || null }) : <>{line}{picker}</>;
  // The visible « Affecter à un départ » names the calendar group (its accessible name).
  return <div className="dossier-departure-task">
    <p id={picker ? labelId : undefined} className="dossier-departure-task-label">Affecter à un départ</p>
    {line}
    {picker}
    {feedback && <p role="status" className="dossier-departure-feedback">{feedback}</p>}
  </div>;
}

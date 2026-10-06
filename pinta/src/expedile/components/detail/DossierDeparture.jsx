import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarPlus, CalendarX, Check, Loader2, Pencil, Plane } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { departureDayLabel, parisCalendarDay } from '../../domain/departureGroups';
import {
  closedDepartureWording, closingLabel, departureDefaultClosing, departureEditable, departureFieldEditable, departureFieldText, departureForDate,
  departureMatchesText, departureOptionLabel, departuresOfDay, destinationName, dossierDepartureWish, dossierDestinationCode, matchTypedDate,
  plannedDeparturesFor,
} from '../../domain/departurePlanning';
import { subscriptionEndConfirmation } from '../../domain/dossierAlerts';
import './dossierDeparture.css';

// « À vérifier › Choisir ou créer le départ » opens the overview field with ?modifier=depart.
const EDIT_REQUEST = 'depart';
const OPTION_ICONS = { departure: Plane, create: CalendarPlus, wish: CalendarPlus, remove: CalendarX };

/** « Départ » of a dossier, at every step until the parcel leaves: the overview
 * line with « Modifier » (`summary`), or the open field of the expedition task
 * (`task`). The departures the dossier can join (the server's rule) come first,
 * the next one marked; a typed date without any departure can be created
 * (aérien, always confirmed) or kept as the desired day, a day whose departure
 * is closed says so. Every write is a server command with the dossier version;
 * nothing is shown as saved before its answer, and a write in flight keeps the
 * field open until that answer.
 * `can` is the permission check of the surrounding task, if any; `readOnly`
 * (with `lockedReason`) keeps the line read-only while a colleague holds the
 * task. With a function as `children`, the summary hands `{ line, editor }` to
 * its caller, which places the editor after its own actions (DOM order = visual
 * order); otherwise the line and its editor follow each other. */
export default function DossierDeparture({ variant = 'summary', can: taskCan, readOnly = false, lockedReason = '', children }) {
  const { sel: dossier, selClient: client, envois = [], can: appCan, assignDeparture, setDepartureWish, createDepartureForColis, ask, flash } = useApp();
  const can = taskCan || appCan;
  const summary = variant !== 'task';
  const location = useLocation();
  const navigate = useNavigate();
  const now = useMinuteNow();
  const [editing, setEditing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  const inputRef = useRef(null);
  const editButton = useRef(null);
  const wasEditing = useRef(false);
  const editorId = useId(), inputId = useId(), listId = useId(), hintId = useId(), missingId = useId();

  const visible = Boolean(dossier) && departureEditable(dossier);
  const assigned = dossier?.envoi || null;
  const wish = dossierDepartureWish(dossier || {});
  // Same rule as the server: assigning needs perm_colis_affecter_envoi, changing
  // or removing an assigned departure perm_envois_reaffecter. Choosing needs to
  // see the planning. A colleague's task keeps it read-only.
  const permitted = visible && departureFieldEditable(dossier, can);
  const editable = permitted && !readOnly;
  const canCreate = editable && can('perm_envois_creer');
  const render = typeof children === 'function' ? children : null;
  const open = summary ? editing : true;

  useEffect(() => {
    wasEditing.current = false;
    setEditing(false); setListOpen(false); setQuery(''); setActive(-1); setError(''); setFeedback('');
  }, [dossier?.id]);
  useEffect(() => {
    if (!summary || !dossier) return;
    const params = new URLSearchParams(location.search);
    if (params.get('modifier') !== EDIT_REQUEST) return;
    if (editable) { setEditing(true); setListOpen(true); setActive(0); }
    params.delete('modifier');
    navigate(`${location.pathname}?${params}${location.hash}`, { replace: true, state: location.state });
  }, [summary, dossier, editable, location.search, location.pathname, location.hash, location.state, navigate]);
  useEffect(() => {
    if (!editing) {
      if (wasEditing.current) editButton.current?.focus();
      wasEditing.current = false;
      return undefined;
    }
    wasEditing.current = true;
    const frame = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ block: 'nearest' }); });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  if (!visible) return render ? render({ line: null, editor: null }) : null;

  const today = parisCalendarDay(now);
  const text = departureFieldText(dossier, envois, { today: now, client });
  const where = destinationName(dossierDestinationCode(dossier, client));
  // The departures the dossier can join: the server's rule, never the habitual Wednesday closing.
  const planned = plannedDeparturesFor(dossier, client, envois, now);
  const typed = matchTypedDate(query, { today: now });
  const departures = !query.trim() ? planned : typed ? planned.filter(envoi => envoi.date === typed)
    : planned.filter(envoi => departureMatchesText(envoi, query, { today: now }));
  // A typed day is checked against every departure of that day the person can see, open or not.
  const typedPast = Boolean(typed) && typed < today;
  const typedClosed = typed && !typedPast && !departureForDate(planned, typed) ? departuresOfDay(dossier, client, envois, typed)[0] || null : null;
  // A typed day without any departure: created here when possible, otherwise kept.
  const missing = typed && !typedPast && !typedClosed && !departureForDate(planned, typed) ? typed : null;
  const closingOpen = Boolean(missing) && Date.parse(departureDefaultClosing(missing)) > now;
  const creatable = Boolean(missing) && canCreate && Boolean(where) && closingOpen;
  const typedDay = typed ? departureDayLabel(typed, { today: now }) : '';
  const missingLine = typedPast ? 'Choisissez une date à venir.'
    : typedClosed ? `Le départ du ${typedDay}${where ? ` pour ${where}` : ''} ${closedDepartureWording(typedClosed)} : choisissez un autre jour.`
      : !missing ? null : [`Aucun départ prévu le ${typedDay}${where ? ` pour ${where}` : ''}`,
        !where ? 'Destination du client inconnue : complétez son code postal.' : canCreate && !closingOpen ? 'La clôture de ce départ est déjà passée.' : null].filter(Boolean).join('. ');
  const items = [
    ...departures.map(envoi => ({ key: envoi.id, kind: 'departure', envoi, label: departureOptionLabel(envoi, { today: now }), next: envoi.id === planned[0]?.id, current: envoi.id === assigned })),
    ...(missing ? [creatable ? { key: 'create', kind: 'create', date: missing, label: 'Créer ce départ (aérien) et y affecter le dossier' }
      // With a departure assigned, keeping the day leaves that departure: the label says so, a question confirms it.
      : { key: 'wish', kind: 'wish', date: missing, label: assigned ? 'Remplacer le départ par cette date (départ à créer)' : 'Garder cette date (départ à créer)' }] : []),
    ...(assigned ? [{ key: 'remove', kind: 'remove', label: 'Retirer le départ' }] : wish ? [{ key: 'remove', kind: 'remove', label: 'Retirer la date souhaitée' }] : []),
  ];
  const listShown = open && editable && listOpen && items.length > 0;
  const activeIndex = listShown ? Math.min(active, items.length - 1) : -1;

  const openList = () => { if (busy) return; setListOpen(true); setActive(previous => previous < 0 ? 0 : previous); };
  const startEditing = () => { setError(''); setFeedback(''); setQuery(''); setEditing(true); setListOpen(true); setActive(0); };
  const stopEditing = () => { setEditing(false); setListOpen(false); setQuery(''); setActive(-1); setError(''); };
  // One write at a time; the field shows the saved dossier, or the server's refusal.
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const done = await action();
      setQuery('');
      if (!summary) setFeedback(done.feedback);
      flash(done.toast);
      if (summary) setEditing(false);
    } catch (failure) {
      setError(failure?.message || 'Le départ n’a pas pu être enregistré. Réessayez.');
    } finally {
      lock.current = false; setBusy(false);
    }
  };
  // After the end of the subscription the date is confirmed first, with the
  // same question as an assignment; cancelling writes nothing.
  const afterSubscription = (date, proceed) => {
    const confirmation = subscriptionEndConfirmation({ date }, client, { today: now });
    if (confirmation) ask(confirmation.title, confirmation.message, proceed, { okLabel: confirmation.okLabel });
    else proceed();
  };
  const choose = item => {
    if (busy || lock.current) return;
    setListOpen(false); setActive(-1);
    if (item.kind === 'departure') {
      if (item.current) { if (summary) setEditing(false); else setQuery(''); return; }
      afterSubscription(item.envoi.date, () => run(async () => {
        await assignDeparture(dossier, item.envoi.id);
        return { feedback: 'Départ enregistré.', toast: 'Départ enregistré' };
      }));
    } else if (item.kind === 'remove') {
      run(async () => {
        if (assigned) {
          await assignDeparture(dossier, null);
          return { feedback: 'Affectation retirée.', toast: 'Départ retiré' };
        }
        await setDepartureWish(dossier, null);
        return { feedback: 'Date souhaitée retirée.', toast: 'Date souhaitée retirée' };
      });
    } else if (item.kind === 'wish') {
      const keep = () => run(async () => {
        // The server assigns the departure of that day if one exists meanwhile.
        const saved = await setDepartureWish(dossier, item.date);
        return saved.envoi ? { feedback: 'Départ enregistré.', toast: 'Départ enregistré' } : { feedback: 'Départ souhaité enregistré.', toast: 'Départ souhaité enregistré' };
      });
      // Keeping a day while a departure is assigned takes the dossier off that departure: confirmed first.
      const current = assigned ? envois.find(envoi => envoi.id === assigned) : null;
      const currentName = current?.date ? `départ du ${departureDayLabel(current.date, { today: now })}` : 'départ actuel';
      afterSubscription(item.date, () => assigned ? ask(`Remplacer le ${currentName} ?`,
        `Le dossier ${dossier.ref} quittera le ${currentName}${current?.ref ? ` (${current.ref})` : ''}. Il gardera la date du ${departureDayLabel(item.date, { today: now })}, dont le départ reste à créer. Aucun message n’est envoyé au client.`,
        keep, { okLabel: 'Remplacer le départ' }) : keep());
    } else if (item.kind === 'create') {
      const day = departureDayLabel(item.date, { today: now });
      afterSubscription(item.date, () => ask(`Créer le départ du ${day} ?`,
        `Départ aérien pour ${where}, clôture ${closingLabel(departureDefaultClosing(item.date), { today: now })}. Le dossier ${dossier.ref} y sera affecté. Aucun message n’est envoyé au client.`,
        () => run(async () => {
          await createDepartureForColis(dossier, item.date);
          return { feedback: 'Départ enregistré.', toast: 'Départ enregistré' };
        }), { okLabel: 'Créer ce départ et y affecter le dossier' }));
    }
  };
  const onKeyDown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!listShown) { openList(); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(activeIndex, step > 0 ? -1 : 0) + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      if (listShown && items[activeIndex]) { event.preventDefault(); choose(items[activeIndex]); }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // A write in flight keeps the field open: its answer, or its refusal, shows here.
      if (busy || lock.current) return;
      if (summary) stopEditing();
      else if (listShown) setListOpen(false);
      else setQuery('');
    }
  };
  const closeOutside = event => { if (!event.currentTarget.contains(event.relatedTarget)) setListOpen(false); };

  const line = <div className="dossier-departure-line" data-overview={summary ? 'departure' : undefined} data-departure-state={text.state} data-wish-state={text.wishState} data-envoi={assigned || ''} data-wish={wish || ''}>
    <span className="dossier-departure-text">{text.prefix} : <strong>{text.value}</strong></span>
    {summary && editable && <button ref={editButton} type="button" className="dossier-departure-edit" aria-label="Modifier le départ du dossier"
      aria-expanded={editing} aria-controls={editing ? editorId : undefined} disabled={busy} onClick={() => (editing ? stopEditing() : startEditing())}>
      <Pencil size={14} aria-hidden="true" /><span>Modifier</span>
    </button>}
    {summary && permitted && readOnly && lockedReason && <span className="dossier-departure-locked">{lockedReason}</span>}
  </div>;
  const picker = open && editable && <div id={editorId} className="dossier-departure-picker" data-variant={variant} aria-busy={busy || undefined} onBlur={closeOutside}>
    {summary && <div className="dossier-departure-label-row">
      <label htmlFor={inputId} className="dossier-departure-label">Départ de cette expédition</label>
      <button type="button" className="dossier-departure-cancel" disabled={busy} onClick={stopEditing}>Annuler</button>
    </div>}
    <div className="dossier-departure-input-row">
      <div className="dossier-departure-input">
        <input ref={inputRef} id={inputId} type="text" role="combobox" aria-label={summary ? undefined : 'Départ de cette expédition'}
          aria-autocomplete="list" aria-expanded={listShown} aria-controls={listShown ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} aria-describedby={hintId}
          autoComplete="off" spellCheck={false} value={query} readOnly={busy} placeholder="Choisir un départ ou taper une date"
          onChange={event => { setQuery(event.target.value); setListOpen(true); setActive(0); setError(''); setFeedback(''); }}
          onClick={openList} onKeyDown={onKeyDown} />
        {busy && <Loader2 size={16} aria-hidden="true" className="dossier-departure-busy animate-spin" />}
      </div>
    </div>
    <p id={hintId} className="dossier-departure-hint">Tapez une date : 23/10 ou 23 octobre.</p>
    {missingLine && <p id={missingId} role="status" className="dossier-departure-missing">{missingLine}</p>}
    {listShown && <ul id={listId} role="listbox" aria-label={where ? `Départs prévus pour ${where}` : 'Départs prévus'} className="dossier-departure-list">
      {items.map((item, index) => {
        const Icon = OPTION_ICONS[item.kind];
        return <li key={item.key} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} aria-disabled={busy || undefined}
          aria-current={item.current ? 'true' : undefined} aria-describedby={['create', 'wish'].includes(item.kind) ? missingId : undefined}
          data-kind={item.kind} data-envoi={item.envoi?.id} className="dossier-departure-option"
          onMouseDown={event => event.preventDefault()} onMouseMove={() => { if (index !== activeIndex) setActive(index); }} onClick={() => choose(item)}>
          <Icon size={16} aria-hidden="true" className="dossier-departure-option-icon" />
          <span className="dossier-departure-option-text">{item.label}</span>
          {item.next && <span className="dossier-departure-badge">Prochain départ</span>}
          {item.current && <Check size={16} aria-hidden="true" className="dossier-departure-current" />}
        </li>;
      })}
    </ul>}
    {error && <p role="alert" className="dossier-departure-error">{error}</p>}
  </div>;

  if (summary) return render ? render({ line, editor: picker || null }) : <>{line}{picker}</>;
  return <div className="dossier-departure-task">
    <p className="dossier-departure-task-label">Affecter à un départ</p>
    {line}
    {picker}
    {feedback && <p role="status" className="dossier-departure-feedback">{feedback}</p>}
  </div>;
}

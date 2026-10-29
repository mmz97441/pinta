import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getDestByCP } from '../../constants';
import { randomId } from '../../lib/randomId';
import { fetchArrivalNotices, fetchPendingReceptions, pendingValidationItems, receptionCartonsFor, validateReception, MAX_VALIDATION_DOSSIERS } from '../../lib/receptionValidation';
import { formatDimensions, formatKg, orderValidationItems } from '../../domain/brouillon';
import { arrivalChannel, renderArrivalNotice, renderConsentNotice } from '../../services/arrivalNotice';
import { autoReminderWording } from '../../domain/consentReminders';
import { deliverMessage } from '../../services/telegramApi';
import { CONVERSATION_PERMISSIONS, FlaggedCartons, Note, SkeletonRows, TableFrame } from './ReceptionParts';
import { count, definiteRefusal, firstName, notesSayDamaged, parisMoment, readableError, withoutRefreshAdvice } from './receptionFlowModel';
import { refreshClientRecord } from './receptionData';

// « À valider », the lower half of the screen « Cartons » (docs/specification-brouillon-reception-2026-10-28.md): the
// cartons of this reception and the client's other cartons waiting for their validation (list_pending_receptions, read
// again after each carton added), then « Valider N cartons et prévenir [prénom] » in one tap: the notice is rendered
// (renderArrivalNotice), validate_reception records the validation and queues ONE message for every carton, and a
// Telegram message is delivered at once. On Telegram, for a reception of one dossier, that message also asks the
// client's agreement (renderConsentNotice, its buttons; the server decides). The request keeps its identifier until
// the server has answered: after a lost answer the same request is replayed and the server returns what it recorded
// (nothing is sent twice).
const MAX_CARTONS = 100;

/**
 * What one validation takes, in the order of the server: the dossiers that still request their purchase invoice first
 * (orderValidationItems: the notice is filed on the first one), each from its first pending carton (fromCarton, which
 * the server checks), at most 20 dossiers and 100 cartons and, with a notice (`render(items)` renders it), as many
 * cartons as its text holds (4096 characters): the largest prefix whose text fits, cut inside a dossier if need be
 * (a lower throughCarton). Returns { items, notice: { value, error } | null, rest, reason }: `rest` is the number of
 * pending cartons left for a next validation, `reason` why ('text', 'limit' or null).
 */
export function validationBatch(pending, dossiers, render) {
  const rows = new Map((pending || []).map(row => [row.colisId, row]));
  const total = (pending || []).reduce((sum, row) => sum + (row.cartons?.length || row.cartonCount || 0), 0);
  const runs = [];
  let size = 0;
  for (const item of orderValidationItems(pendingValidationItems(pending), dossiers)) {
    if (runs.length >= MAX_VALIDATION_DOSSIERS || size >= MAX_CARTONS) break;
    const numbers = (rows.get(item.colisId)?.cartons || []).map(carton => carton.carton)
      .filter(number => Number.isInteger(number) && number >= item.fromCarton && number <= item.throughCarton).sort((a, b) => a - b);
    // Its cartons as listed, from the first one pending: anything else would be refused.
    if (numbers[0] !== item.fromCarton) continue;
    const kept = numbers.slice(0, MAX_CARTONS - size);
    runs.push({ colisId: item.colisId, fromCarton: item.fromCarton, numbers: kept });
    size += kept.length;
  }
  const itemsOf = taken => {
    const items = [];
    let left = taken;
    for (const run of runs) {
      if (left <= 0) break;
      const kept = run.numbers.slice(0, left);
      items.push({ colisId: run.colisId, fromCarton: run.fromCarton, throughCarton: kept[kept.length - 1] });
      left -= kept.length;
    }
    return items;
  };
  const attempt = taken => {
    try { return { value: render(itemsOf(taken)), error: '' }; }
    catch (error) { return { value: null, error: error.message || 'Le modèle de l’avis n’a pas pu être utilisé.' }; }
  };
  let taken = size, cut = false;
  let notice = render && size ? attempt(size) : null;
  if (notice?.error && size > 1) {
    const first = attempt(1);
    // A notice of one carton fits: the text is too long for them all. It grows with each carton (binary search).
    if (!first.error) {
      let low = 1, high = size;
      notice = first;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        const tried = attempt(middle);
        if (tried.error) high = middle;
        else { low = middle; notice = tried; }
      }
      taken = low; cut = true;
    }
  }
  return { items: taken ? itemsOf(taken) : [], notice, rest: Math.max(0, total - taken), reason: cut ? 'text' : total > taken ? 'limit' : null };
}

/**
 * `version` grows with each carton added: the list is read again (kept on screen meanwhile). `focusOnOpen`: the screen
 * was opened to validate (?valider=1), the title takes the focus. `typing`: a carton is being typed and not added yet,
 * which a validation would leave out: the panel says so instead of validating (`onFinishTyping` brings back to the
 * carton, `onClearTyping` empties it).
 */
export default function ValidationPanel({ client, session, update, version = 0, focusOnOpen = false, typing = false, onFinishTyping, onClearTyping, onValidated }) {
  const { data, settings, messageTemplates, can, setClients, refreshColis, ask } = useApp();
  const [pending, setPending] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState(null);
  const busyRef = useRef(false);
  const headingRef = useRef(null);
  const name = firstName(client);
  // A validation answered after the operator left is recorded in the session, without taking them back.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // The list of the server; only the answer of the last reading is kept (a carton added meanwhile asks for another).
  const reading = useRef(0);
  const load = useCallback(async () => {
    const turn = ++reading.current;
    setLoading(true); setLoadError('');
    try {
      const rows = await fetchPendingReceptions({ clientId: client.id });
      if (mounted.current && turn === reading.current) setPending(rows);
    } catch (error) {
      if (mounted.current && turn === reading.current) setLoadError(readableError(error, 'La liste des cartons à valider n’a pas pu être lue. Vérifiez la connexion, puis touchez « Réessayer ».', 'Réception · cartons à valider'));
    } finally {
      if (mounted.current && turn === reading.current) setLoading(false);
    }
  }, [client.id]);
  useEffect(() => { load(); }, [load, version]);
  // The client's contact as the server has it now, read again with the list: it decides the channel of the notice.
  useEffect(() => { refreshClientRecord(client.id, setClients).catch(() => null); }, [client.id, setClients, version]);
  // Near the top of the screen (the form waits behind one button): focused where it is.
  useEffect(() => { if (focusOnOpen) headingRef.current?.focus({ preventScroll: true }); }, []);
  // A dossier listed but not loaded yet (a colleague's brouillon of a minute ago) is read: its invoices decide the
  // order of the validation and the variant of the notice.
  const requested = useRef(new Set());
  useEffect(() => {
    for (const row of pending || []) {
      if (!row.colisId || requested.current.has(row.colisId) || data.some(item => item.id === row.colisId)) continue;
      requested.current.add(row.colisId);
      refreshColis(row.colisId).catch(() => null);
    }
  }, [pending, data, refreshColis]);

  const channel = arrivalChannel(client);
  const permission = channel === 'telegram' ? 'perm_comm_telegram' : channel === 'email' ? 'perm_comm_email' : null;
  const allowed = permission ? can(permission) : false;
  const batch = useMemo(() => {
    if (!pending) return { items: [], notice: null, rest: 0, reason: null };
    const rows = new Map(pending.map(row => [row.colisId, row]));
    const dossierOf = item => data.find(row => row.id === item.colisId) || { id: item.colisId, ref: rows.get(item.colisId)?.ref || '', factures: [] };
    const render = channel && allowed ? items => renderArrivalNotice({ client, colisList: items.map(dossierOf), cartons: receptionCartonsFor(pending, items),
      destination: getDestByCP(client.cp), settings, bodies: messageTemplates }) : null;
    return validationBatch(pending, data, render);
  }, [pending, data, client, channel, allowed, settings, messageTemplates]);
  const cartons = useMemo(() => batch.items.length ? receptionCartonsFor(pending, batch.items) : [], [pending, batch]);
  const notice = batch.notice || { value: null, error: '' };
  const canNotify = Boolean(channel && allowed && notice.value?.canal && !notice.error);
  // The agreement asked with the notice (validate_reception's p_consent_text): Telegram, one dossier whose every pending
  // carton this validation takes, a dossier measured and not yet asked, and the right to ask it. The server checks it
  // all again; otherwise the plain notice leaves and the agreement stays to ask.
  const askConsent = can('perm_colis_demander_feuvert');
  const consent = useMemo(() => {
    if (!canNotify || channel !== 'telegram' || !askConsent || batch.items.length !== 1) return null;
    const [item] = batch.items;
    const row = (pending || []).find(entry => entry.colisId === item.colisId);
    if (!row || row.lastCarton !== item.throughCarton) return null;
    const dossier = data.find(entry => entry.id === item.colisId);
    if (dossier && (!['receptionne', 'mesure'].includes(dossier.statut) || dossier.archive || dossier.paiementDate)) return null;
    try {
      const value = renderConsentNotice({ client, colisList: [dossier || { id: item.colisId, ref: row.ref, factures: [] }], cartons,
        destination: getDestByCP(client.cp), settings, bodies: messageTemplates });
      return value ? { value, error: '' } : null;
    } catch (error) { return { value: null, error: error.message || 'Le modèle n’a pas pu être utilisé.' }; }
  }, [canNotify, channel, askConsent, batch.items, pending, data, client, cartons, settings, messageTemplates]);
  const reminders = autoReminderWording(settings);
  const savedKeys = new Set(session.saved.map(item => `${item.colisId}:${item.number}`));
  const blockedBy = session.validation ? 'validation' : session.intent ? 'intent' : null;
  const severalDossiers = new Set(cartons.map(carton => carton.colisId)).size > 1;

  // The cartons flagged at the reception (damaged or opened, forbidden product): the notice does not mention them.
  const flagged = useMemo(() => cartons.map(carton => {
    const saved = session.saved.find(item => item.colisId === carton.colisId && item.number === carton.carton);
    const dossier = data.find(row => row.id === carton.colisId);
    const damaged = Boolean(saved?.abime) || notesSayDamaged(dossier?.notesReception, carton.carton);
    const interdits = Array.isArray(saved?.interdits) ? saved.interdits : [];
    return damaged || interdits.length ? { colisId: carton.colisId, ref: carton.ref, carton: carton.carton, damaged, interdits } : null;
  }).filter(Boolean), [cartons, session.saved, data]);
  const canOpenConversation = CONVERSATION_PERMISSIONS.some(can);
  const here = `/recevoir?${new URLSearchParams({ client: client.id, valider: '1' })}`;

  /** `validation`: { args, rest, flagged }, kept in the session until the server has answered. */
  const run = async validation => {
    if (busyRef.current) return;
    const { args } = validation;
    busyRef.current = true; setBusy(true); setFailure(null);
    setStatus(args.notify ? 'Validation de la réception et préparation de l’avis…' : 'Validation de la réception…');
    let result;
    try {
      result = await validateReception(args);
    } catch (error) {
      busyRef.current = false; setBusy(false);
      if (!definiteRefusal(error)) {
        setStatus('Validation à vérifier.');
        setFailure({ uncertain: true });
        return;
      }
      // Refused: nothing was recorded nor sent. The list and the contact are read again before a new attempt (a
      // colleague's validation meanwhile changes the first carton to validate: 40001).
      update({ validation: null });
      setStatus('La réception n’est pas validée.');
      await Promise.all([load(), refreshClientRecord(client.id, setClients).catch(() => null),
        ...(args.items || []).map(item => refreshColis(item.colisId).catch(() => null))]);
      if (!mounted.current) return;
      const said = withoutRefreshAdvice(readableError(error, '', 'Réception · validation'));
      const refreshed = error.code === '40001' || /actualisez/i.test(error.message || '');
      setFailure({ message: refreshed
        ? `${said || 'La réception a changé entre-temps.'} La liste et le contact de ${name} sont actualisés : vérifiez, puis validez à nouveau.`
        : said || 'La réception n’a pas été validée. Réessayez dans un instant ; si cela continue, prévenez la direction.' });
      return;
    }
    const { validation: recorded, message } = result;
    let delivery = null;
    if (recorded.notify && recorded.canal === 'telegram' && message?.id) {
      setStatus('Envoi du message Telegram…');
      try { delivery = await deliverMessage(message.colisId || recorded.items[0]?.colisId, message.id); }
      catch (error) { delivery = { ok: false, error: readableError(error, 'réseau indisponible', 'Réception · envoi Telegram') }; }
    }
    // The dossiers as the server has them now: the agreement asked moves the dossier to « Attend son accord », the
    // notice is among its messages.
    await Promise.all(recorded.items.map(item => refreshColis(item.colisId).catch(() => null)));
    // The notice as the server has it now (Telegram confirmed, e-mail to send…); otherwise what is known.
    let listed = null;
    try { listed = (await fetchArrivalNotices({ clientId: client.id, limit: 20 })).find(item => item.id === recorded.id) || null; }
    catch { listed = null; }
    const shown = listed || { ...recorded, message, outbox: delivery?.ok && result.outbox ? { ...result.outbox, status: 'sent' } : result.outbox };
    update(previous => ({
      validation: null, saved: [], lastSaved: null, target: null, consent: {},
      done: { validationId: recorded.id, notice: shown, delivery: delivery ? { ok: Boolean(delivery.ok), error: delivery.error || '' } : null,
        consent: Object.fromEntries(recorded.items.map(item => [item.colisId, previous.consent[item.colisId]]).filter(([, value]) => value)),
        rest: validation.rest || 0, flagged: validation.flagged || [] },
    }));
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    onValidated(recorded.id);
  };

  const ready = !blockedBy && !typing && !loadError && !loading && batch.items.length > 0;
  const start = notify => {
    if (busyRef.current || !ready || (notify && !canNotify)) return;
    const args = notify
      ? { clientId: client.id, items: batch.items, notify: true, canal: notice.value.canal, template: notice.value.template, text: notice.value.text, requestId: randomId(),
        ...(consent?.value ? { consentText: consent.value.text } : {}) }
      : { clientId: client.id, items: batch.items, notify: false, requestId: randomId() };
    const validation = { args, rest: batch.rest, flagged };
    // Kept before the call: a lost answer is replayed with this very request.
    update({ validation });
    run(validation);
  };
  // « Valider sans prévenir » is confirmed: no notice will ever announce these cartons.
  const startRef = useRef(start);
  startRef.current = start;
  const confirmQuiet = () => {
    if (busyRef.current || !ready) return;
    ask(`Valider sans prévenir ${name} ?`, 'Aucun avis ne sera envoyé pour ces cartons.', () => { startRef.current(false); }, { okLabel: 'Valider sans prévenir' });
  };

  const reason = !channel
    ? <>{name} n’a ni Telegram ni e-mail : la réception sera validée sans avis. <Link className="rf-note-link" to={`/clients/${encodeURIComponent(client.id)}`}>Compléter sa fiche</Link> pour envoyer les prochains avis.</>
    : !allowed ? `Votre accès ne permet pas de prévenir ${name} par ${channel === 'telegram' ? 'Telegram' : 'e-mail'} : validez sans prévenir, ou demandez à un collègue autorisé de valider la réception.`
      : notice.error ? `L’avis d’arrivée n’a pas pu être préparé : ${String(notice.error).replace(/[.\s]+$/, '')}. Corrigez le modèle « Avis d’arrivée » dans Paramètres, ou validez sans prévenir.` : null;
  const explanation = channel === 'telegram'
    ? consent?.value
      ? `${name} recevra un seul message Telegram pour ${count(cartons.length, 'colis', 'colis')}, avec les boutons pour autoriser la préparation ou attendre ses autres colis.${reminders ? ` Sans réponse, ${reminders}.` : ''}`
      : `${name} recevra un seul message Telegram pour ${count(cartons.length, 'colis', 'colis')}.`
    : `L’e-mail pour ${name} sera préparé pour ${count(cartons.length, 'colis', 'colis')} : vous le copierez pour l’envoyer depuis votre messagerie (l’envoi automatique des e-mails n’est pas encore branché).`;
  const rest = batch.reason === 'text'
    ? `Encore ${count(batch.rest, 'carton')} à valider ensuite : un avis d’arrivée ne peut pas en annoncer davantage en un seul message. Validez-les juste après celle-ci, avec un second avis.`
    : `Encore ${count(batch.rest, 'carton')} à valider ensuite : une validation compte au plus ${MAX_VALIDATION_DOSSIERS} dossiers et ${MAX_CARTONS} cartons. Validez-les juste après celle-ci.`;
  const title = cartons.length ? `À valider : ${count(cartons.length, 'carton')}` : 'À valider';
  const label = `Valider ${count(cartons.length, 'carton')}`;

  return <section id="rf-validation" aria-labelledby="rf-validation-title" className="rf-validation space-y-4">
    <h2 id="rf-validation-title" ref={headingRef} tabIndex={-1} className="rf-strong text-[24px] font-extrabold outline-none sm:text-[26px]">{title}</h2>

    {blockedBy === 'intent' && <Note tone="warning" role="note">Vérifiez d’abord l’enregistrement du carton ci-dessus («&nbsp;Vérifier l’enregistrement&nbsp;») : la réception se valide ensuite.</Note>}
    {blockedBy === 'validation' && <Note tone="warning" role="alert" title="Validation à vérifier" action={<button type="button" className="rf-small-action inline-flex items-center gap-2" disabled={busy} onClick={() => run(session.validation)}><RefreshCw size={18} aria-hidden="true" />{busy ? 'Vérification…' : 'Vérifier la validation'}</button>}>
      La connexion a été interrompue pendant la validation : nous ne savons pas si elle est enregistrée. Touchez «&nbsp;Vérifier la validation&nbsp;» quand le réseau revient : rien ne sera validé ni envoyé deux fois.
    </Note>}

    {loadError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load} disabled={loading}>{loading ? 'Lecture…' : 'Réessayer'}</button>}>{loadError}</Note>}
    {pending === null && !loadError && <SkeletonRows label="Lecture des cartons à valider…" />}
    {pending !== null && !cartons.length && !blockedBy && (focusOnOpen
      ? <Note tone="info">Aucun carton n’attend de validation pour {client.nom}. Ajoutez un carton, ou revenez aux colis.</Note>
      : <p className="rf-muted text-[16px]">Les cartons que vous ajoutez s’affichent ici. Vous les validez ensuite tous ensemble{channel ? ` : ${name} recevra un seul message` : ''}.</p>)}

    {cartons.length > 0 && <TableFrame label="Cartons à valider">
      <table className="rf-table" aria-busy={loading ? 'true' : undefined}>
        <caption className="sr-only">Cartons à valider pour {client.nom}</caption>
        <thead><tr>
          <th scope="col">N°</th><th scope="col">Carton</th><th scope="col">Dimensions</th><th scope="col" data-align="right">Poids</th>
          {severalDossiers && <th scope="col">Dossier</th>}<th scope="col">Reçu</th>
        </tr></thead>
        <tbody>{cartons.map(carton => {
          const mine = savedKeys.has(`${carton.colisId}:${carton.carton}`);
          const moment = parisMoment(carton.receivedAt);
          return <tr key={`${carton.colisId}:${carton.carton}`}>
            <th scope="row"><span className="rf-carton-number"><span className="sr-only">Carton </span>{carton.carton}</span></th>
            <td className="rf-cell-text">
              <span className="block text-[17px] font-bold">{carton.fournisseur || <span className="rf-muted font-semibold">Vendeur non renseigné</span>}</span>
              <span className="block">{carton.number ? <span className="rf-code">{carton.number}</span> : <span className="rf-muted">Sans numéro de suivi</span>}</span>
            </td>
            <td className="whitespace-nowrap">{formatDimensions(carton)}</td>
            <td className="whitespace-nowrap font-semibold" data-align="right">{formatKg(carton.poids)}</td>
            {severalDossiers && <td className="whitespace-nowrap"><span className="rf-code font-semibold">{carton.ref}</span></td>}
            <td className="whitespace-nowrap">
              {moment ? <><span className="block">{moment.day}</span><span className="rf-muted block text-[15px]">{moment.time}{mine ? ' · cette réception' : ''}</span></>
                : <span className="rf-muted">{mine ? 'Cette réception' : 'Plus tôt'}</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </TableFrame>}
    {batch.rest > 0 && cartons.length > 0 && <Note tone="info">{rest}</Note>}
    {cartons.length > 0 && <FlaggedCartons flagged={flagged} name={name} title={`À signaler à ${name} vous-même`} returnTo={here} canOpen={canOpenConversation} notice={canNotify} />}

    {cartons.length > 0 && !blockedBy && !loadError && (typing
      ? <Note tone="warning" role="note" title="Un carton est en cours de saisie"
        action={<><button type="button" className="rf-small-action" onClick={onFinishTyping}>Terminer ce carton</button><button type="button" className="rf-small-action" onClick={onClearTyping}>Effacer la saisie</button></>}>
        Ajoutez-le avec «&nbsp;Ajouter ce carton&nbsp;», ou effacez la saisie, puis validez la réception.
      </Note>
      : <>
        {canNotify ? <Note tone="info">{explanation}</Note> : <Note tone="warning">{reason}</Note>}
        {canNotify && consent?.error && <Note tone="warning" role="note">L’avis avec la demande d’accord n’a pas pu être préparé : {String(consent.error).replace(/[.\s]+$/, '')}. L’avis d’arrivée partira seul et l’accord restera à demander. Corrigez le modèle «&nbsp;Avis d’arrivée avec demande d’accord&nbsp;» dans Paramètres.</Note>}
        {canNotify && notice.value?.text && <details className="rf-card rounded-2xl px-4">
          <summary className="rf-strong min-h-11 cursor-pointer py-3 text-[16px] font-semibold">Voir le message</summary>
          <pre className="rf-message pb-4">{consent?.value?.text || notice.value.text}</pre>
        </details>}
        <div className="flex flex-col items-stretch gap-1">
          {canNotify
            ? <button type="button" onClick={() => start(true)} disabled={busy || loading} className="rf-validate flex w-full items-center justify-center gap-2.5 px-4"><Check size={24} strokeWidth={2.6} aria-hidden="true" />{busy ? 'Validation…' : `${label} et prévenir ${name}`}</button>
            : <button type="button" onClick={confirmQuiet} disabled={busy || loading} className="rf-validate flex w-full items-center justify-center gap-2.5 px-4"><Check size={24} strokeWidth={2.6} aria-hidden="true" />{busy ? 'Validation…' : `${label} sans prévenir`}</button>}
          {canNotify && <button type="button" onClick={confirmQuiet} disabled={busy || loading} className="rf-quiet self-center">Valider sans prévenir</button>}
        </div>
      </>)}
    <p role="status" aria-live="polite" className={status && !failure ? 'rf-muted text-center text-[15px] font-semibold' : 'sr-only'}>{status}</p>
    {failure && !failure.uncertain && <Note tone="danger" role="alert" title="La réception n’est pas validée">{failure.message}</Note>}
  </section>;
}

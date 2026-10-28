import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getDestByCP } from '../../constants';
import { randomId } from '../../lib/randomId';
import { fetchArrivalNotices, fetchPendingReceptions, pendingValidationItems, receptionCartonsFor, validateReception, MAX_VALIDATION_DOSSIERS } from '../../lib/receptionValidation';
import { receptionCartonManifest } from '../../domain/reception';
import { formatDimensions, formatKg, orderValidationItems } from '../../domain/brouillon';
import { arrivalChannel, renderArrivalNotice } from '../../services/arrivalNotice';
import { deliverMessage } from '../../services/telegramApi';
import { CONVERSATION_PERMISSIONS, Casier, ClientBand, FlaggedCartons, Note, SkeletonRows } from './ReceptionParts';
import { clientPlace, count, definiteRefusal, firstName, notesSayDamaged, parisWhen, withoutRefreshAdvice } from './receptionFlowModel';
import { refreshClientRecord } from './receptionData';

// Step 3, « Validation »: the cartons of this reception and the client's other cartons waiting for their validation
// (list_pending_receptions), then « Valider la réception et prévenir [prénom] » in one tap: the notice is rendered
// (renderArrivalNotice), validate_reception records the validation and queues ONE message for every carton, and a
// Telegram message is delivered at once. The request keeps its identifier until the server has answered: after a lost
// answer the same request is replayed and the server returns what it recorded (nothing is sent twice).
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

export default function ValidationStep({ client, session, update, onAddCarton, onValidated, onResumeCarton }) {
  const { data, settings, messageTemplates, can, setClients, refreshColis, ask } = useApp();
  const [pending, setPending] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState(null);
  const busyRef = useRef(false);
  const headingRef = useRef(null);
  const name = firstName(client);
  // A validation answered after the operator left is recorded in the session, without taking them back.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try { setPending(await fetchPendingReceptions({ clientId: client.id })); }
    catch (error) { setLoadError(error.message || 'La liste des cartons à valider n’a pas pu être lue.'); }
  }, [client.id]);
  // The list of the server, and the client's contact as the server has it now (it decides the channel).
  useEffect(() => {
    load();
    refreshClientRecord(client.id, setClients).catch(() => null);
  }, [client.id, load, setClients]);
  useEffect(() => { headingRef.current?.focus(); }, []);
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
  const savedKeys = new Set(session.saved.map(item => `${item.colisId}:${item.number}`));
  const multiple = new Set(cartons.map(carton => carton.colisId)).size > 1;
  const secondaryLine = carton => ({ ref: multiple ? carton.ref : '',
    when: savedKeys.has(`${carton.colisId}:${carton.carton}`) ? '' : `enregistré ${parisWhen(carton.receivedAt) || 'plus tôt'}, pas encore validé` });
  const blockedBy = session.validation ? 'validation' : session.intent ? 'intent' : null;

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

  // What is already in stock (validated before), beside the cartons waiting for their validation.
  const known = [...new Set([...batch.items.map(item => item.colisId), session.target?.dossierId].filter(Boolean))].map(id => data.find(row => row.id === id)).filter(Boolean);
  const waiting = (pending || []).filter(row => known.some(dossier => dossier.id === row.colisId)).reduce((sum, row) => sum + (row.cartons?.length || row.cartonCount || 0), 0);
  const stock = Math.max(0, known.reduce((sum, dossier) => sum + receptionCartonManifest(dossier).nbColis, 0) - waiting);
  const casiers = [...new Set(known.map(dossier => String(dossier.casier || '').trim()).filter(Boolean))];
  const band = stock > 0 || casiers.length ? <>
    {stock > 0 && `Déjà en stock : ${count(stock, 'carton')}`}{stock > 0 && casiers.length > 0 && ' · '}
    {casiers.length === 1 && <Casier value={casiers[0]} />}
    {casiers.length > 1 && <>Casiers {casiers.map((casier, index) => <React.Fragment key={casier}>{index > 0 && ', '}<span className="rf-code whitespace-nowrap font-bold">{casier}</span></React.Fragment>)}</>}
  </> : null;

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
      const said = withoutRefreshAdvice(error.message);
      const refreshed = error.code === '40001' || /actualisez/i.test(error.message || '');
      setFailure({ message: refreshed
        ? `${said || 'La réception a changé.'} La liste et le contact de ${name} sont actualisés : vérifiez, puis validez à nouveau.`
        : said || 'La réception n’a pas été validée.' });
      return;
    }
    const { validation: recorded, message } = result;
    let delivery = null;
    if (recorded.notify && recorded.canal === 'telegram' && message?.id) {
      setStatus('Envoi du message Telegram…');
      try { delivery = await deliverMessage(message.colisId || recorded.items[0]?.colisId, message.id); }
      catch (error) { delivery = { ok: false, error: error.message }; }
    }
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

  const start = notify => {
    if (busyRef.current || blockedBy || !batch.items.length || (notify && !canNotify)) return;
    const args = notify
      ? { clientId: client.id, items: batch.items, notify: true, canal: notice.value.canal, template: notice.value.template, text: notice.value.text, requestId: randomId() }
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
    if (busyRef.current || blockedBy || !batch.items.length) return;
    ask(`Valider sans prévenir ${name} ?`, 'Aucun avis ne sera envoyé pour ces cartons.', () => { startRef.current(false); }, { okLabel: 'Valider sans prévenir' });
  };

  const lastSaved = session.lastSaved;
  const reason = !channel
    ? <>{name} n’a ni Telegram ni e-mail : la réception sera validée sans avis. <Link className="rf-note-link" to={`/clients/${encodeURIComponent(client.id)}`}>Compléter sa fiche</Link> pour envoyer les prochains avis.</>
    : !allowed ? `Votre accès ne permet pas de prévenir ${name} par ${channel === 'telegram' ? 'Telegram' : 'e-mail'} : validez sans prévenir, ou demandez à un collègue autorisé de valider la réception.`
      : notice.error ? `L’avis d’arrivée n’a pas pu être préparé : ${String(notice.error).replace(/[.\s]+$/, '')}. Corrigez le modèle « Avis d’arrivée » dans Paramètres, ou validez sans prévenir.` : null;
  const explanation = channel === 'telegram'
    ? `En validant, ${name} reçoit un seul message Telegram pour ${count(cartons.length, 'colis', 'colis')}.`
    : `En validant, l’e-mail pour ${name} est préparé pour ${count(cartons.length, 'colis', 'colis')} : vous le copierez pour l’envoyer depuis votre messagerie (l’envoi automatique des e-mails n’est pas encore branché).`;
  const rest = batch.reason === 'text'
    ? `Encore ${count(batch.rest, 'carton')} à valider ensuite : un avis d’arrivée ne peut pas en annoncer davantage en un seul message. Validez-les juste après celle-ci, avec un second avis.`
    : `Encore ${count(batch.rest, 'carton')} à valider ensuite : une validation compte au plus ${MAX_VALIDATION_DOSSIERS} dossiers et ${MAX_CARTONS} cartons. Validez-les juste après celle-ci.`;

  return <section aria-labelledby="rf-step-title" className="space-y-4">
    <ClientBand client={client} place={clientPlace(client)} detail={band} />
    {lastSaved && !blockedBy && <Note tone="success" role="status">
      Carton n° {lastSaved.number} enregistré dans <span className="rf-code whitespace-nowrap font-bold">{lastSaved.ref}</span>{lastSaved.created ? ' (nouveau brouillon)' : ''}.
      {lastSaved.changed && <span className="mt-1 block">Ce brouillon a été complété depuis par un collègue : il reste ouvert, vos prochains cartons s’y ajoutent.</span>}
      {lastSaved.photoWarning && <span className="mt-1 block">{lastSaved.photoWarning}</span>}
    </Note>}
    <h2 id="rf-step-title" ref={headingRef} tabIndex={-1} className="rf-strong text-[26px] font-extrabold outline-none">
      {pending === null && !loadError ? 'Cette réception' : `Cette réception : ${count(cartons.length, 'carton')}`}
    </h2>

    {blockedBy === 'intent' && <Note tone="warning" role="alert" title="Un carton est à vérifier" action={<button type="button" className="rf-small-action" onClick={onResumeCarton}>Vérifier l’enregistrement</button>}>
      La connexion a été interrompue pendant l’enregistrement d’un carton. Vérifiez son enregistrement avant de valider la réception.
    </Note>}
    {blockedBy === 'validation' && <Note tone="warning" role="alert" title="Validation à vérifier" action={<button type="button" className="rf-small-action inline-flex items-center gap-2" disabled={busy} onClick={() => run(session.validation)}><RefreshCw size={18} aria-hidden="true" />{busy ? 'Vérification…' : 'Vérifier la validation'}</button>}>
      La connexion a été interrompue pendant la validation : nous ne savons pas si elle est enregistrée. Touchez «&nbsp;Vérifier la validation&nbsp;» quand le réseau revient : rien ne sera validé ni envoyé deux fois.
    </Note>}

    {loadError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load}>Réessayer</button>}>{loadError}</Note>}
    {pending === null && !loadError && <SkeletonRows label="Chargement des cartons à valider…" />}
    {pending !== null && !cartons.length && !blockedBy && <Note tone="info">Aucun carton n’attend de validation pour {client.nom}. Ajoutez un carton, ou revenez au Brouillon.</Note>}

    {cartons.length > 0 && <ul aria-label="Cartons à valider" className="rf-card divide-y divide-slate-200 rounded-2xl">
      {cartons.map((carton, index) => {
        // Its dossier (when there are several) and, unless it was recorded during this reception, when it was: said
        // once for a run of cartons alike (a dossier received at once is not repeated carton by carton).
        const { ref, when } = secondaryLine(carton);
        const previous = index > 0 ? secondaryLine(cartons[index - 1]) : null;
        const shown = Boolean(ref || when) && !(previous && previous.ref === ref && previous.when === when);
        return <li key={`${carton.colisId}:${carton.carton}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className="rf-carton-number"><span className="sr-only">Carton </span>{carton.carton}</span>
          <span className="min-w-[8rem] flex-1 basis-40">
            <span className="block text-[17px] font-bold">{carton.fournisseur || 'Vendeur non renseigné'}</span>
            <span className="rf-code rf-muted block text-[15px]">{carton.number || 'Sans numéro de suivi'}</span>
          </span>
          <span className="text-[16px]">{formatDimensions(carton)}</span>
          <span className="min-w-[5rem] text-right text-[16px] font-semibold">{formatKg(carton.poids)}</span>
          {shown && <span className="rf-muted w-full text-[15px]">{ref ? <span className="rf-code whitespace-nowrap">{ref}</span> : null}{ref && when ? ' · ' : ''}{when}</span>}
        </li>;
      })}
    </ul>}
    {batch.rest > 0 && cartons.length > 0 && <Note tone="info">{rest}</Note>}
    {cartons.length > 0 && <FlaggedCartons flagged={flagged} name={name} title={`À signaler à ${name} vous-même`} returnTo={here} canOpen={canOpenConversation} notice={canNotify} />}

    <button type="button" onClick={onAddCarton} disabled={busy} className="rf-secondary flex w-full items-center justify-center gap-2 px-4"><Plus size={22} aria-hidden="true" />Ajouter un autre carton pour {name}</button>

    {cartons.length > 0 && !blockedBy && <>
      {canNotify ? <Note tone="info">{explanation}</Note> : <Note tone="warning">{reason}</Note>}
      {canNotify && notice.value?.text && <details className="rf-card rounded-2xl px-4">
        <summary className="rf-strong min-h-11 cursor-pointer py-3 text-[16px] font-semibold">Voir le message</summary>
        <pre className="rf-message pb-4">{notice.value.text}</pre>
      </details>}
      <div className="flex flex-col items-stretch gap-1">
        {canNotify
          ? <button type="button" onClick={() => start(true)} disabled={busy} className="rf-primary brand-bg flex w-full items-center justify-center gap-2.5 px-4"><Check size={24} strokeWidth={2.6} aria-hidden="true" />{busy ? 'Validation…' : `Valider la réception et prévenir ${name}`}</button>
          : <button type="button" onClick={confirmQuiet} disabled={busy} className="rf-primary brand-bg flex w-full items-center justify-center gap-2.5 px-4"><Check size={24} strokeWidth={2.6} aria-hidden="true" />{busy ? 'Validation…' : 'Valider sans prévenir'}</button>}
        {canNotify && <button type="button" onClick={confirmQuiet} disabled={busy} className="rf-quiet self-center">Valider sans prévenir</button>}
      </div>
    </>}
    <p role="status" aria-live="polite" className={status && !failure ? 'rf-muted text-center text-[15px] font-semibold' : 'sr-only'}>{status}</p>
    {failure && !failure.uncertain && <Note tone="danger" role="alert" title="La réception n’est pas validée">{failure.message}</Note>}
  </section>;
}

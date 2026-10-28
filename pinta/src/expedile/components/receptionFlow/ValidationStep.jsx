import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getDestByCP } from '../../constants';
import { randomId } from '../../lib/randomId';
import { fetchArrivalNotices, fetchPendingReceptions, pendingValidationItems, receptionCartonsFor, validateReception, MAX_VALIDATION_DOSSIERS } from '../../lib/receptionValidation';
import { receptionCartonManifest } from '../../domain/reception';
import { formatDimensions, formatKg } from '../../domain/brouillon';
import { arrivalChannel, renderArrivalNotice } from '../../services/arrivalNotice';
import { deliverMessage } from '../../services/telegramApi';
import { Casier, ClientBand, Note, SkeletonRows } from './ReceptionParts';
import { clientPlace, count, definiteRefusal, firstName, parisWhen } from './receptionFlowModel';
import { refreshClientRecord } from './receptionData';

// Step 3, « Validation »: the cartons of this reception and the client's other cartons waiting for their validation
// (list_pending_receptions), then « Valider la réception et prévenir [prénom] » in one tap: the notice is rendered
// (renderArrivalNotice), validate_reception records the validation and queues ONE message for every carton, and a
// Telegram message is delivered at once. The request keeps its identifier until the server has answered: after a lost
// answer the same request is replayed and the server returns what it recorded (nothing is sent twice).
const MAX_CARTONS = 100;

/** The dossiers validated at once (at most 20 dossiers and 100 cartons), and those left for a next validation. */
function validationBatch(pending) {
  const items = [], deferred = [];
  let cartons = 0;
  for (const item of pendingValidationItems(pending)) {
    const row = pending.find(entry => entry.colisId === item.colisId);
    const size = row?.cartons?.length || row?.cartonCount || 0;
    if (items.length >= MAX_VALIDATION_DOSSIERS || (items.length > 0 && cartons + size > MAX_CARTONS)) { deferred.push(row); continue; }
    items.push(item);
    cartons += size;
  }
  return { items, deferred };
}

export default function ValidationStep({ client, session, update, onAddCarton, onValidated, onResumeCarton }) {
  const { data, settings, messageTemplates, can, setClients } = useApp();
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

  const batch = useMemo(() => pending ? validationBatch(pending) : { items: [], deferred: [] }, [pending]);
  const cartons = useMemo(() => batch.items.length ? receptionCartonsFor(pending, batch.items) : [], [pending, batch]);
  const dossiers = useMemo(() => batch.items.map(item => data.find(row => row.id === item.colisId)
    || { id: item.colisId, ref: pending.find(row => row.colisId === item.colisId)?.ref || '', factures: [] }), [batch, data, pending]);
  const notice = useMemo(() => {
    if (!cartons.length) return { value: null, error: '' };
    try { return { value: renderArrivalNotice({ client, colisList: dossiers, cartons, destination: getDestByCP(client.cp), settings, bodies: messageTemplates }), error: '' }; }
    catch (error) { return { value: null, error: error.message || 'Le modèle de l’avis n’a pas pu être utilisé.' }; }
  }, [client, dossiers, cartons, settings, messageTemplates]);
  const channel = arrivalChannel(client);
  const permission = channel === 'telegram' ? 'perm_comm_telegram' : channel === 'email' ? 'perm_comm_email' : null;
  const allowed = permission ? can(permission) : false;
  const canNotify = Boolean(channel && allowed && notice.value?.canal && !notice.error);
  const savedKeys = new Set(session.saved.map(item => `${item.colisId}:${item.number}`));
  const multiple = new Set(cartons.map(carton => carton.colisId)).size > 1;
  const blockedBy = session.validation ? 'validation' : session.intent ? 'intent' : null;

  // What is already in stock, beside the cartons validated now.
  const known = [...new Set([...batch.items.map(item => item.colisId), session.target?.dossierId].filter(Boolean))].map(id => data.find(row => row.id === id)).filter(Boolean);
  const stock = known.reduce((sum, dossier) => sum + receptionCartonManifest(dossier).nbColis, 0) - cartons.filter(carton => known.some(dossier => dossier.id === carton.colisId)).length;
  const casiers = [...new Set(known.map(dossier => String(dossier.casier || '').trim()).filter(Boolean))];
  const band = stock > 0 || casiers.length ? <>
    {stock > 0 && `Déjà en stock : ${count(stock, 'carton')}`}{stock > 0 && casiers.length > 0 && ' · '}
    {casiers.length === 1 && <Casier value={casiers[0]} />}
    {casiers.length > 1 && <>Casiers {casiers.map((casier, index) => <React.Fragment key={casier}>{index > 0 && ', '}<span className="rf-code whitespace-nowrap font-bold">{casier}</span></React.Fragment>)}</>}
  </> : null;

  const run = async args => {
    if (busyRef.current) return;
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
      // Refused: nothing was recorded nor sent. The list and the contact are read again before a new attempt.
      update({ validation: null });
      setStatus('La réception n’est pas validée.');
      await Promise.all([load(), refreshClientRecord(client.id, setClients).catch(() => null)]);
      setFailure({ message: error.code === '40001'
        ? `${String(error.message || 'La réception a changé.').replace(/\s*Actualisez[^.]*\./, '')} La liste et le contact de ${name} sont actualisés : vérifiez, puis validez à nouveau.`
        : error.message || 'La réception n’a pas été validée.' });
      return;
    }
    const { validation, message } = result;
    let delivery = null;
    if (validation.notify && validation.canal === 'telegram' && message?.id) {
      setStatus('Envoi du message Telegram…');
      try { delivery = await deliverMessage(message.colisId || validation.items[0]?.colisId, message.id); }
      catch (error) { delivery = { ok: false, error: error.message }; }
    }
    // The notice as the server has it now (Telegram confirmed, e-mail to send…); otherwise what is known.
    let listed = null;
    try { listed = (await fetchArrivalNotices({ clientId: client.id, limit: 20 })).find(item => item.id === validation.id) || null; }
    catch { listed = null; }
    const shown = listed || { ...validation, message, outbox: delivery?.ok && result.outbox ? { ...result.outbox, status: 'sent' } : result.outbox };
    update(previous => ({
      validation: null, saved: [], lastSaved: null, target: null, consent: {},
      done: { validationId: validation.id, notice: shown, delivery: delivery ? { ok: Boolean(delivery.ok), error: delivery.error || '' } : null,
        consent: Object.fromEntries(validation.items.map(item => [item.colisId, previous.consent[item.colisId]]).filter(([, value]) => value)) },
    }));
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    onValidated(validation.id);
  };

  const start = notify => {
    if (busyRef.current || blockedBy || !batch.items.length || (notify && !canNotify)) return;
    const args = notify
      ? { clientId: client.id, items: batch.items, notify: true, canal: notice.value.canal, template: notice.value.template, text: notice.value.text, requestId: randomId() }
      : { clientId: client.id, items: batch.items, notify: false, requestId: randomId() };
    // Kept before the call: a lost answer is replayed with this very request.
    update({ validation: { args } });
    run(args);
  };

  const lastSaved = session.lastSaved;
  const reason = !channel
    ? <>{name} n’a ni Telegram ni e-mail : la réception sera validée sans avis. <Link className="rf-note-link" to={`/clients/${encodeURIComponent(client.id)}`}>Compléter sa fiche</Link> pour envoyer les prochains avis.</>
    : !allowed ? `Votre accès ne permet pas de prévenir ${name} par ${channel === 'telegram' ? 'Telegram' : 'e-mail'} : validez sans prévenir, ou demandez à un collègue autorisé de valider la réception.`
      : notice.error ? `L’avis d’arrivée n’a pas pu être préparé : ${String(notice.error).replace(/[.\s]+$/, '')}. Corrigez le modèle « Avis d’arrivée » dans Paramètres, ou validez sans prévenir.` : null;
  const explanation = channel === 'telegram'
    ? `En validant, ${name} reçoit un seul message Telegram pour ${count(cartons.length, 'colis', 'colis')}.`
    : `En validant, l’e-mail pour ${name} est préparé pour ${count(cartons.length, 'colis', 'colis')} : vous le copierez pour l’envoyer depuis votre messagerie (l’envoi automatique des e-mails n’est pas encore branché).`;

  return <section aria-labelledby="rf-step-title" className="space-y-4">
    <ClientBand client={client} place={clientPlace(client)} detail={band} />
    {lastSaved && !blockedBy && <Note tone="success" role="status">
      Carton n° {lastSaved.number} enregistré dans <span className="rf-code whitespace-nowrap font-bold">{lastSaved.ref}</span>{lastSaved.created ? ' (nouveau brouillon)' : ''}.
      {lastSaved.photoWarning && <span className="mt-1 block">{lastSaved.photoWarning}</span>}
    </Note>}
    <h2 id="rf-step-title" ref={headingRef} tabIndex={-1} className="rf-strong text-[26px] font-extrabold outline-none">
      {pending === null && !loadError ? 'Cette réception' : `Cette réception : ${count(cartons.length, 'carton')}`}
    </h2>

    {blockedBy === 'intent' && <Note tone="warning" role="alert" title="Un carton est à vérifier" action={<button type="button" className="rf-small-action" onClick={onResumeCarton}>Vérifier l’enregistrement</button>}>
      La connexion a été interrompue pendant l’enregistrement d’un carton. Vérifiez son enregistrement avant de valider la réception.
    </Note>}
    {blockedBy === 'validation' && <Note tone="warning" role="alert" title="Validation à vérifier" action={<button type="button" className="rf-small-action inline-flex items-center gap-2" disabled={busy} onClick={() => run(session.validation.args)}><RefreshCw size={18} aria-hidden="true" />{busy ? 'Vérification…' : 'Vérifier la validation'}</button>}>
      La connexion a été interrompue pendant la validation : nous ne savons pas si elle est enregistrée. Touchez «&nbsp;Vérifier la validation&nbsp;» quand le réseau revient : rien ne sera validé ni envoyé deux fois.
    </Note>}

    {loadError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load}>Réessayer</button>}>{loadError}</Note>}
    {pending === null && !loadError && <SkeletonRows label="Chargement des cartons à valider…" />}
    {pending !== null && !cartons.length && !blockedBy && <Note tone="info">Aucun carton n’attend de validation pour {client.nom}. Ajoutez un carton, ou revenez au Brouillon.</Note>}

    {cartons.length > 0 && <ul aria-label="Cartons à valider" className="rf-card divide-y divide-slate-200 rounded-2xl">
      {cartons.map(carton => {
        const mine = savedKeys.has(`${carton.colisId}:${carton.carton}`);
        return <li key={`${carton.colisId}:${carton.carton}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className="rf-carton-number"><span className="sr-only">Carton </span>{carton.carton}</span>
          <span className="min-w-[8rem] flex-1 basis-40">
            <span className="block text-[17px] font-bold">{carton.fournisseur || 'Vendeur non renseigné'}</span>
            <span className="rf-code rf-muted block text-[15px]">{carton.number || 'Sans numéro de suivi'}</span>
          </span>
          <span className="text-[16px]">{formatDimensions(carton)}</span>
          <span className="min-w-[5rem] text-right text-[16px] font-semibold">{formatKg(carton.poids)}</span>
          {(multiple || !mine) && <span className="rf-muted w-full text-[15px]">{multiple ? <span className="rf-code whitespace-nowrap">{carton.ref}</span> : null}{multiple && !mine ? ' · ' : ''}{!mine ? `enregistré ${parisWhen(carton.receivedAt) || 'plus tôt'}, pas encore validé` : ''}</span>}
        </li>;
      })}
    </ul>}
    {batch.deferred.length > 0 && <Note tone="info">Les autres cartons ({count(batch.deferred.reduce((sum, row) => sum + (row?.cartonCount || 0), 0), 'carton')}) seront à valider ensuite : une validation compte au plus {MAX_VALIDATION_DOSSIERS} dossiers et {MAX_CARTONS} cartons.</Note>}

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
          : <button type="button" onClick={() => start(false)} disabled={busy} className="rf-primary brand-bg flex w-full items-center justify-center gap-2.5 px-4"><Check size={24} strokeWidth={2.6} aria-hidden="true" />{busy ? 'Validation…' : 'Valider sans prévenir'}</button>}
        {canNotify && <button type="button" onClick={() => start(false)} disabled={busy} className="rf-quiet self-center">Valider sans prévenir</button>}
      </div>
    </>}
    <p role="status" aria-live="polite" className={status && !failure ? 'rf-muted text-center text-[15px] font-semibold' : 'sr-only'}>{status}</p>
    {failure && !failure.uncertain && <Note tone="danger" role="alert" title="La réception n’est pas validée">{failure.message}</Note>}
  </section>;
}

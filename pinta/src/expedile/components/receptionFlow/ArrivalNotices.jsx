import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { fetchArrivalNotices, fetchPendingReceptions } from '../../lib/receptionValidation';
import { arrivalNoticeState, arrivalNoticeSummary, pendingByClient } from '../../domain/brouillon';
import { arrivalChannel } from '../../services/arrivalNotice';
import { Note, SkeletonRows } from './ReceptionParts';
import { NoticeActions, NoticePill } from './NoticeStatus';
import { count, parisMoment, parisWhen } from './receptionFlowModel';
import './receptionFlow.css';

// « Avis d’arrivée » (/avis): the receptions still to validate, by client (« Valider et prévenir »), then the recent
// notices with their state: « Réessayer » for a Telegram notice not delivered, the text to copy and the e-mail to
// prepare for an e-mail to send by hand, the client's sheet when the address is at fault.
const SUMMARY = [
  { keys: ['envoye', 'remis'], label: ['envoyé', 'envoyés'], pill: 'done' },
  { keys: ['a_envoyer'], label: ['à envoyer', 'à envoyer'], pill: 'todo' },
  { keys: ['non_remis'], label: ['non remis', 'non remis'], pill: 'alert' },
  { keys: ['en_cours'], label: ['en cours d’envoi', 'en cours d’envoi'], pill: 'wait' },
  { keys: ['sans_avis', 'annule'], label: ['sans avis', 'sans avis'], pill: 'neutral' },
];

function PendingGroup({ group, client, canReceive }) {
  const refs = group.dossiers.map(dossier => dossier.ref).filter(Boolean);
  const when = parisWhen(group.receivedTo || group.receivedFrom);
  const label = arrivalChannel(client) ? 'Valider et prévenir' : 'Valider la réception';
  return <li className="rf-note rf-note--warning flex-wrap items-center">
    <p className="min-w-0 flex-1 basis-64 text-[16px]">
      <strong className="text-[17px]">{client?.nom || 'Client'}</strong> : {count(group.cartonCount, 'colis reçu', 'colis reçus')}{when ? ` ${when}` : ''}
      {refs.length > 0 && <> · <Refs refs={refs} /></>}. Le client n’est pas encore prévenu.
    </p>
    {canReceive && group.href
      ? <Link to={group.href} className="brand-bg inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-[16px] font-bold text-white">{label}</Link>
      : <span className="text-[15px]">À valider par un membre de l’équipe qui réceptionne.</span>}
  </li>;
}

/** « EXP-AB12, EXP-CD34 », each reference kept whole. */
function Refs({ refs }) {
  return refs.map((ref, index) => <React.Fragment key={ref}>{index > 0 && ', '}<span className="rf-code whitespace-nowrap">{ref}</span></React.Fragment>);
}

// On a phone, the date and the colis share the first line of the card (order); from 768 px, four aligned columns.
function NoticeRow({ notice, client, onChanged }) {
  const state = arrivalNoticeState(notice);
  const summary = arrivalNoticeSummary(notice);
  const moment = parisMoment(notice.createdAt);
  return <li className="rf-notice-row rf-notice-grid flex flex-wrap items-baseline gap-x-2 gap-y-2 px-4 py-3">
    <p className="rf-muted order-first text-[15px] md:order-none"><span className="sr-only">Validé </span>{moment ? <>{moment.day}<span className="md:block"><span className="sr-only">à</span> {moment.time}</span></> : 'Date inconnue'}</p>
    <div className="min-w-0 basis-full md:basis-auto">
      <p className="rf-strong text-[17px] font-bold">{summary.clientName || client?.nom || 'Client'}</p>
      <p className="rf-muted text-[15px]">{summary.refs.length > 0 && <Refs refs={summary.refs} />}{summary.actorName ? `${summary.refs.length ? ' · ' : ''}par ${summary.actorName}` : ''}</p>
    </div>
    <p className="rf-muted order-first text-[15px] md:order-none">
      <span className="md:hidden" aria-hidden="true">· </span>{count(summary.cartonCount, 'colis', 'colis')}{summary.canalLabel && <span className="md:block"><span className="md:hidden"> · </span>{summary.canalLabel}</span>}
    </p>
    <div className="min-w-0 basis-full space-y-1 md:basis-auto">
      <NoticePill state={state} />
      <p className="rf-muted text-[15px]">{state.key === 'non_remis' ? `Raison : ${state.reason}` : state.detail}</p>
    </div>
    <div className="rf-notice-actions min-w-0 basis-full md:basis-auto"><NoticeActions notice={notice} client={client} onChanged={onChanged} compact /></div>
  </li>;
}

export default function ArrivalNotices() {
  useDocumentTitle('Avis d’arrivée');
  const { getClient, can } = useApp();
  const [pending, setPending] = useState(null);
  const [pendingError, setPendingError] = useState('');
  const [notices, setNotices] = useState(null);
  const [noticesError, setNoticesError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [pendingRead, noticesRead] = await Promise.allSettled([fetchPendingReceptions(), fetchArrivalNotices({ limit: 100 })]);
    if (pendingRead.status === 'fulfilled') { setPending(pendingRead.value); setPendingError(''); }
    else setPendingError(pendingRead.reason?.message || 'Les réceptions à valider n’ont pas pu être lues.');
    if (noticesRead.status === 'fulfilled') { setNotices(noticesRead.value); setNoticesError(''); }
    else setNoticesError(noticesRead.reason?.message || 'Les avis d’arrivée n’ont pas pu être lus.');
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => pendingByClient(pending || []), [pending]);
  const totals = useMemo(() => {
    const byState = {};
    for (const notice of notices || []) { const key = arrivalNoticeState(notice)?.key; if (key) byState[key] = (byState[key] || 0) + 1; }
    return SUMMARY.map(item => ({ ...item, value: item.keys.reduce((sum, key) => sum + (byState[key] || 0), 0) })).filter(item => item.value > 0);
  }, [notices]);
  const cartons = (notices || []).reduce((sum, notice) => sum + (Array.isArray(notice.cartons) ? notice.cartons.length : 0), 0);

  return <div className="rf mx-auto w-full max-w-5xl space-y-6 px-4 pb-12 pt-5 sm:px-6">
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/" aria-label="Retour aux colis" className="rf-card rf-strong inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"><ChevronLeft size={24} aria-hidden="true" /></Link>
      {/* flex-auto: the title keeps its width, « Actualiser » goes to the next line on a narrow phone. */}
      <h1 className="rf-strong flex-auto whitespace-nowrap text-[26px] font-extrabold leading-tight">Avis d’arrivée</h1>
      <button type="button" onClick={load} disabled={refreshing} className="rf-small-action inline-flex items-center gap-2"><RefreshCw size={18} aria-hidden="true" />{refreshing ? 'Actualisation…' : 'Actualiser'}</button>
      <p className="rf-muted basis-full text-[15px] sm:pl-[60px]">Un avis à chaque réception validée, avec tous les colis de la réception.</p>
    </div>

    <section aria-labelledby="rf-pending-title" className="space-y-3">
      <h2 id="rf-pending-title" className="rf-strong text-[21px] font-extrabold">Réceptions à valider</h2>
      {pendingError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load}>Réessayer</button>}>{pendingError}</Note>}
      {pending === null && !pendingError && <SkeletonRows rows={1} label="Chargement des réceptions à valider…" />}
      {pending !== null && !groups.length && <p className="rf-muted text-[16px]">Aucune réception à valider : tous les cartons enregistrés ont été validés.</p>}
      {groups.length > 0 && <ul className="space-y-2">{groups.map(group => <PendingGroup key={group.clientId} group={group} client={getClient(group.clientId)} canReceive={can('perm_colis_receptionner')} />)}</ul>}
    </section>

    <section aria-labelledby="rf-notices-title" className="space-y-3">
      <h2 id="rf-notices-title" className="rf-strong text-[21px] font-extrabold">Avis récents</h2>
      {noticesError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load}>Réessayer</button>}>{noticesError}</Note>}
      {notices === null && !noticesError && <SkeletonRows rows={3} label="Chargement des avis d’arrivée…" />}
      {notices !== null && !notices.length && <p className="rf-muted text-[16px]">Aucun avis d’arrivée pour l’instant : ils apparaissent ici dès qu’une réception est validée.</p>}
      {notices !== null && notices.length > 0 && <>
        <div className="flex flex-wrap items-center gap-2">
          {totals.map(item => <span key={item.pill + item.label[0]} className={`rf-pill rf-pill--${item.pill}`}>{item.value} {item.value >= 2 ? item.label[1] : item.label[0]}</span>)}
          <span className="rf-muted text-[15px]">· {count(cartons, 'colis annoncé', 'colis annoncés')} en {count(notices.length, 'avis', 'avis')}</span>
        </div>
        <div className="rf-card overflow-hidden rounded-2xl">
          <div aria-hidden="true" className="rf-notice-grid rf-notice-head hidden px-4 py-2 text-[15px] font-bold uppercase tracking-wider md:grid">
            <span>Validé</span><span>Client</span><span>Colis</span><span>État</span>
          </div>
          <ul aria-label="Avis d’arrivée récents">{notices.map(notice => <NoticeRow key={notice.id} notice={notice} client={getClient(notice.clientId)} onChanged={load} />)}</ul>
        </div>
      </>}
    </section>
  </div>;
}

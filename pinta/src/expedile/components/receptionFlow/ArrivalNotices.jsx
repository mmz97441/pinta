import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { fetchArrivalNotices, fetchPendingReceptions } from '../../lib/receptionValidation';
import { arrivalNoticeState, arrivalNoticeSummary, pendingByClient } from '../../domain/brouillon';
import { arrivalChannel } from '../../services/arrivalNotice';
import { Note, SkeletonRows, TableFrame } from './ReceptionParts';
import { NoticeActions, NoticePill } from './NoticeStatus';
import { count, parisMoment } from './receptionFlowModel';
import './receptionFlow.css';

// « Avis d’arrivée » (/avis), two tables at every width: the receptions still to validate, by client (« Valider et
// prévenir »), then the recent notices with their state: « Réessayer » for a Telegram notice not delivered or never
// taken by the automatic sending (« Envoi à vérifier », still on its way after ten minutes), the text to copy and the
// e-mail to prepare for an e-mail to send by hand, the client's sheet when the address is at fault.
const SUMMARY = [
  { keys: ['envoye', 'remis'], label: ['envoyé', 'envoyés'], pill: 'done' },
  { keys: ['a_envoyer'], label: ['à envoyer', 'à envoyer'], pill: 'todo' },
  { keys: ['non_remis'], label: ['non remis', 'non remis'], pill: 'alert' },
  { keys: ['a_verifier'], label: ['envoi à vérifier', 'envois à vérifier'], pill: 'check' },
  { keys: ['en_cours'], label: ['en cours d’envoi', 'en cours d’envoi'], pill: 'wait' },
  { keys: ['sans_avis', 'annule'], label: ['sans avis', 'sans avis'], pill: 'neutral' },
];

/** « EXP-AB12, EXP-CD34 », each reference kept whole. */
function Refs({ refs }) {
  return refs.map((ref, index) => <React.Fragment key={ref}>{index > 0 && ', '}<span className="rf-code whitespace-nowrap">{ref}</span></React.Fragment>);
}

/** « Aujourd’hui » over « 16 h 07 ». */
function Moment({ value }) {
  const moment = parisMoment(value);
  if (!moment) return <span className="rf-muted">Date inconnue</span>;
  return <><span className="block whitespace-nowrap">{moment.day}</span><span className="rf-muted block whitespace-nowrap text-[15px]">{moment.time}</span></>;
}

/** One client whose cartons wait for their validation: the client, the cartons, their dossiers, when they arrived,
 * and « Valider et prévenir ». */
function PendingRow({ group, client, canReceive }) {
  const refs = group.dossiers.map(dossier => dossier.ref).filter(Boolean);
  const label = arrivalChannel(client) ? 'Valider et prévenir' : 'Valider la réception';
  return <tr>
    <th scope="row"><span className="rf-cell-id rf-strong text-[17px] font-bold">{client?.nom || 'Client'}</span></th>
    <td className="whitespace-nowrap font-semibold">{count(group.cartonCount, 'colis', 'colis')}</td>
    <td className="min-w-[9rem]">{refs.length ? <Refs refs={refs} /> : <span className="rf-muted">Non renseigné</span>}</td>
    <td><Moment value={group.receivedTo || group.receivedFrom} /></td>
    <td className={canReceive && group.href ? '' : 'rf-cell-text'}>{canReceive && group.href
      ? <Link to={group.href} className="brand-bg inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-4 text-[16px] font-bold text-white">{label}</Link>
      : <span className="text-[15px]">À valider par un membre de l’équipe qui réceptionne.</span>}</td>
  </tr>;
}

/** One notice: the client (its dossiers, who validated), when, the channel, the cartons, the state and its action. */
function NoticeRow({ notice, client, onChanged, now }) {
  const state = arrivalNoticeState(notice, { now });
  const summary = arrivalNoticeSummary(notice, { now });
  return <tr>
    <th scope="row"><span className="rf-cell-id">
      <span className="rf-strong block text-[17px] font-bold">{summary.clientName || client?.nom || 'Client'}</span>
      <span className="rf-muted block text-[15px]">{summary.refs.length > 0 && <Refs refs={summary.refs} />}{summary.actorName ? `${summary.refs.length ? ' · ' : ''}par ${summary.actorName}` : ''}</span>
    </span></th>
    <td><Moment value={notice.createdAt} /></td>
    <td className="whitespace-nowrap">{summary.canalLabel || <span className="rf-muted">Aucun</span>}</td>
    <td className="whitespace-nowrap">{count(summary.cartonCount, 'colis', 'colis')}</td>
    <td className="rf-cell-text space-y-1">
      <NoticePill state={state} />
      <span className="rf-muted block text-[15px]">{state.key === 'non_remis' ? `Raison : ${state.reason}` : state.detail}</span>
    </td>
    <td className="rf-cell-wide"><NoticeActions notice={notice} client={client} onChanged={onChanged} now={now} compact /></td>
  </tr>;
}

export default function ArrivalNotices() {
  useDocumentTitle('Avis d’arrivée');
  const { getClient, can } = useApp();
  const [pending, setPending] = useState(null);
  const [pendingError, setPendingError] = useState('');
  const [notices, setNotices] = useState(null);
  const [noticesError, setNoticesError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // The states are read at the moment of the last reading: the counters and the rows agree.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    const [pendingRead, noticesRead] = await Promise.allSettled([fetchPendingReceptions(), fetchArrivalNotices({ limit: 100 })]);
    if (pendingRead.status === 'fulfilled') { setPending(pendingRead.value); setPendingError(''); }
    else setPendingError(pendingRead.reason?.message || 'Les réceptions à valider n’ont pas pu être lues.');
    if (noticesRead.status === 'fulfilled') { setNotices(noticesRead.value); setNoticesError(''); }
    else setNoticesError(noticesRead.reason?.message || 'Les avis d’arrivée n’ont pas pu être lus.');
    setNow(Date.now());
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => pendingByClient(pending || []), [pending]);
  const totals = useMemo(() => {
    const byState = {};
    for (const notice of notices || []) { const key = arrivalNoticeState(notice, { now })?.key; if (key) byState[key] = (byState[key] || 0) + 1; }
    return SUMMARY.map(item => ({ ...item, value: item.keys.reduce((sum, key) => sum + (byState[key] || 0), 0) })).filter(item => item.value > 0);
  }, [notices, now]);
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
      {groups.length > 0 && <p className="rf-muted text-[15px]">Ces clients ne sont pas encore prévenus de l’arrivée de leurs colis.</p>}
      {pendingError && <Note tone="danger" role="alert" action={<button type="button" className="rf-small-action" onClick={load}>Réessayer</button>}>{pendingError}</Note>}
      {pending === null && !pendingError && <SkeletonRows rows={1} label="Chargement des réceptions à valider…" />}
      {pending !== null && !groups.length && <p className="rf-muted text-[16px]">Aucune réception à valider : tous les cartons enregistrés ont été validés.</p>}
      {groups.length > 0 && <TableFrame label="Réceptions à valider">
        <table className="rf-table">
          <caption className="sr-only">Réceptions à valider, par client</caption>
          <thead><tr>
            <th scope="col">Client</th><th scope="col">Cartons</th><th scope="col">Dossiers</th><th scope="col">Reçus</th><th scope="col">Action</th>
          </tr></thead>
          <tbody>{groups.map(group => <PendingRow key={group.clientId} group={group} client={getClient(group.clientId)} canReceive={can('perm_colis_receptionner')} />)}</tbody>
        </table>
      </TableFrame>}
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
        <TableFrame label="Avis d’arrivée récents">
          <table className="rf-table">
            <caption className="sr-only">Avis d’arrivée récents</caption>
            <thead><tr>
              <th scope="col">Client</th><th scope="col">Validé</th><th scope="col">Canal</th><th scope="col">Colis</th><th scope="col">État</th><th scope="col">Action</th>
            </tr></thead>
            <tbody>{notices.map(notice => <NoticeRow key={notice.id} notice={notice} client={getClient(notice.clientId)} onChanged={load} now={now} />)}</tbody>
          </table>
        </TableFrame>
      </>}
    </section>
  </div>;
}

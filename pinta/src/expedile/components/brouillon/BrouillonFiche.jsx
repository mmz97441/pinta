import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, Camera, Check, ChevronLeft, FolderOpen, PackagePlus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import useMediaQuery from '../../hooks/useMediaQuery';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import useShellLoadBanner from '../../hooks/useShellLoadBanner';
import { workspaceReturnPath } from '../../domain/navigation';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { PAID_TOTAL_STATE, brouillonFiche, colisTab, pendingByColis } from '../../domain/brouillon';
import { formatDossierTableDate } from '../../domain/dossierTable';
import { SecureImage } from '../ui/SecureFile';
import ColisAction from './ColisAction';
import ConsentSheet from './ConsentSheet';
import ArrivalNoticeBlock from './ArrivalNoticeBlock';
import ScrollFrame from './ScrollFrame';
import StagePill from './StagePill';
import { dossierHref as wholeDossierHref, withReturnTo } from './colisLinks';
import useConsentSheet from './useConsentSheet';
import useReceptionSignals from './useReceptionSignals';
import './colisHome.css';

// The Brouillon sheet of a dossier (/brouillon/:id): who, the cartons received and those after optimisation, the
// price from the saved quote only, the latest arrival notice, and the one action of its line in « Colis »
// (docs/specification-brouillon-reception-2026-10-28.md). Everything comes from brouillonFiche (domain/brouillon.js).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 'colis-page mx-auto w-full px-4 pb-10 pt-4 lg:px-5';
const BACK_LABELS = [[/^\/colis/, 'Dossiers'], [/^\/avis/, 'Avis d’arrivée'], [/^\/recevoir/, 'Réception'], [/^\/travail/, 'Mon travail'], [/^\/conversations/, 'Conversations'], [/^\/equipe/, 'Équipe'], [/^\/brouillon\//, 'Retour']];

function BackLink({ to }) {
  const label = (BACK_LABELS.find(([pattern]) => pattern.test(to)) || [null, 'Colis'])[1];
  return <Link to={to} className="fiche-back"><ChevronLeft size={22} aria-hidden="true" />{label}</Link>;
}

/** Not in « Colis » (never loaded, archived, cancelled, removed): what is known, and the whole dossier. */
function Elsewhere({ back, title, text, dossierHref, children }) {
  return <div className={`${PAGE} max-w-3xl space-y-4`}>
    <BackLink to={back} />
    <h1 className="fiche-title">{title}</h1>
    <p className="m-0 text-[16px] colis-muted">{text}</p>
    <div className="flex flex-wrap gap-3">
      {children}
      {dossierHref && <Link to={dossierHref} className="colis-secondary"><FolderOpen size={18} aria-hidden="true" />Ouvrir le dossier complet</Link>}
    </div>
  </div>;
}

function measuresSummary(set) {
  return [set.countLabel || set.summary, set.poidsLabel, set.volumeLabel].filter(Boolean).filter((part, index, list) => list.indexOf(part) === index).join(' · ');
}

const photoCount = count => `${count} ${count > 1 ? 'photos' : 'photo'}`;

/** The reception photos of a carton received damaged or opened: private thumbnails (SecureImage, signed on read). */
function CartonPhotos({ carton, photos }) {
  return <ul className="fiche-photos" aria-label={`Photos du carton ${carton.number}`}>
    {photos.map(photo => <li key={photo.id || photo.path}>
      <SecureImage src={photo.path} alt={`Carton ${carton.number} (${carton.supplierLabel}) à la réception`} className="fiche-photo" loading="lazy" />
      <span className="fiche-photo-caption">{[photo.createdAt ? formatDossierTableDate(photo.createdAt) : null, photo.actor?.nom].filter(Boolean).join(' · ')}</span>
    </li>)}
  </ul>;
}

const PhotoMark = ({ count }) => <span className="colis-sub fiche-photo-mark"><Camera size={16} aria-hidden="true" />{photoCount(count)}</span>;

function ReceivedCartons({ received, photos, photosError, onRetryPhotos }) {
  // The photos of each carton (1 = first), as the server lists them; none while they are unknown.
  const photosOf = number => (Array.isArray(photos) ? photos : []).filter(photo => photo.carton === number && photo.path);
  return <section className="fiche-section" aria-labelledby="fiche-recus" data-testid="fiche-recus">
    <div className="fiche-section-head"><h2 id="fiche-recus">Cartons reçus</h2><p>{measuresSummary(received)}</p></div>
    {received.pendingLabel && <p className="colis-alert m-0"><AlertTriangle size={18} aria-hidden="true" className="shrink-0" /><span className="text-[16px] font-bold">{received.pendingLabel}</span></p>}
    {photosError && photos === null && <p className="colis-quiet" data-testid="fiche-photos-erreur"><span>Les photos de réception n’ont pas pu être chargées ({photosError}).</span><button type="button" onClick={onRetryPhotos} className="colis-link-button">Réessayer</button></p>}
    {!received.count ? <p className="m-0 text-[15px] colis-muted">Aucun carton enregistré.</p>
      : <ScrollFrame className="colis-table-wrap" label="Tableau des cartons reçus">
        <table className="fiche-table">
          <thead><tr><th scope="col">N°</th><th scope="col">Vendeur</th><th scope="col">N° de suivi</th><th scope="col">Dimensions</th><th scope="col" data-align="right">Poids</th><th scope="col" data-align="right">Volume</th></tr></thead>
          <tbody>{received.cartons.map(carton => {
            const shots = photosOf(carton.number);
            return <React.Fragment key={carton.number}>
              <tr data-pending={carton.pending ? 'true' : undefined} data-photos={shots.length ? 'true' : undefined}>
                <th scope="row">{carton.number}{carton.pending && <span className="colis-sub">À valider</span>}{shots.length > 0 && <PhotoMark count={shots.length} />}</th>
                <td>{carton.supplierLabel}</td>
                <td><span className="keep-token">{carton.trackingLabel}</span></td>
                <td>{carton.dimensionsLabel}</td>
                <td data-align="right">{carton.poidsLabel}</td>
                <td data-align="right">{carton.volumeLabel}</td>
              </tr>
              {shots.length > 0 && <tr className="fiche-photo-row" data-pending={carton.pending ? 'true' : undefined}><td colSpan={6}><div className="colis-keep-in-view"><CartonPhotos carton={carton} photos={shots} /></div></td></tr>}
            </React.Fragment>;
          })}</tbody>
          <tfoot><tr><th scope="row" colSpan={4}><span className="colis-keep-in-view">Total reçu · {received.countLabel}</span></th><td data-align="right">{received.poidsLabel}</td><td data-align="right">{received.volumeLabel}</td></tr></tfoot>
        </table>
      </ScrollFrame>}
  </section>;
}

function OptimizedParcels({ optimized, received }) {
  return <section className="fiche-section" aria-labelledby="fiche-optimise" data-testid="fiche-optimise">
    <div className="fiche-section-head"><h2 id="fiche-optimise">Après optimisation</h2>{optimized.done && <p>{measuresSummary(optimized)}</p>}</div>
    {!optimized.done ? <p className="m-0 text-[15px] colis-muted">{optimized.summary}</p> : <>
      <ScrollFrame className="colis-table-wrap" label="Tableau des colis à expédier">
        <table className="fiche-table">
          <thead><tr><th scope="col">Colis</th><th scope="col">Dimensions</th><th scope="col" data-align="right">Poids</th><th scope="col" data-align="right">Volume</th></tr></thead>
          <tbody>{optimized.packages.map(parcel => <tr key={parcel.number}><th scope="row">Colis {parcel.number}</th><td>{parcel.dimensionsLabel}</td><td data-align="right">{parcel.poidsLabel}</td><td data-align="right">{parcel.volumeLabel}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={2}>Total à expédier</th><td data-align="right">{optimized.poidsLabel}</td><td data-align="right">{optimized.volumeLabel}</td></tr></tfoot>
        </table>
      </ScrollFrame>
      {optimized.volumeGain && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="colis-pill" data-tone={optimized.volumeGain.percent > 0 ? 'done' : 'neutral'}>{optimized.volumeGain.label}</span>
        <span className="text-[15px] colis-muted">{received.volumeLabel} reçus → {optimized.volumeLabel} à expédier</span>
      </div>}
    </>}
  </section>;
}

/** What the quote still needs (brouillonFiche.missing): the journey's steps, then the gaps of the calculation. */
function Missing({ missing }) {
  if (!missing?.length) return null;
  return <div className="grid gap-1" data-testid="fiche-manques">
    <p className="m-0 text-[15px]">Pour calculer le devis, il manque :</p>
    <ul className="m-0 grid gap-1 pl-5 text-[15px]" style={{ listStyle: 'disc' }}>{missing.map(item => <li key={item}>{item}</li>)}</ul>
  </div>;
}

/** « Prix à payer », from the saved quote only (brouillonFiche.price), or what the quote still needs. Paid
 * (`price.state` PAID_TOTAL_STATE): « Payé » beside the amount, never « à payer ». */
function Price({ price }) {
  const paid = price.state === PAID_TOTAL_STATE;
  if (!price.known) return <>
    <h2 id="fiche-prix" tabIndex={-1}>{paid ? 'Prix' : 'Prix à payer'}</h2>
    {paid
      ? <p className="m-0"><span className="colis-paid" data-testid="fiche-prix-etat"><Check size={18} aria-hidden="true" />{price.label}</span></p>
      : <p className="m-0 text-[19px] font-bold colis-muted" data-testid="fiche-prix-etat">{price.label}</p>}
    <Missing missing={price.missing} />
    {price.message && <p className="m-0 text-[15px]">{price.message}</p>}
  </>;
  return <>
    <h2 id="fiche-prix" tabIndex={-1}>{paid ? 'Prix' : 'Prix à payer'}</h2>
    {price.detailed && <>
      <div>
        <div className="fiche-line"><span>{price.transport.label}</span><span>{price.transport.text}</span></div>
        {price.transport.billableWeightLabel && <span className="colis-sub">{price.transport.billableWeightLabel}</span>}
      </div>
      <div className="fiche-rule" />
      <div data-testid="fiche-taxes">
        <div className="fiche-line"><span>{price.taxes.label}</span><span>{price.taxes.text}</span></div>
        {price.taxes.heading && <span className="colis-sub">{price.taxes.heading}, {price.taxes.note}.</span>}
        {price.taxes.lines.length > 0 && <ul className="fiche-detail-list">{price.taxes.lines.map(line => <li key={line.key}><span>{line.label}</span><span>{line.text}</span></li>)}</ul>}
      </div>
      {price.fees && <>
        <div className="fiche-rule" />
        <div>
          <div className="fiche-line"><span>{price.fees.label}</span><span>{price.fees.text}</span></div>
          {price.fees.lines.length > 0 && <ul className="fiche-detail-list">{price.fees.lines.map((line, index) => <li key={index}><span>{line.label}</span><span>{line.text}</span></li>)}</ul>}
        </div>
      </>}
      <div className="fiche-rule" data-strong="true" />
    </>}
    <div className="fiche-total" data-testid="fiche-total" data-paid={paid ? 'true' : undefined}>
      <span>{paid ? <span className="inline-flex items-center gap-1"><Check size={20} aria-hidden="true" />{price.total.label}</span> : 'Total à payer'}</span><span>{price.total.text}</span>
    </div>
    {price.state && !paid && <p className="m-0 text-[15px] colis-muted">État du devis : {price.state}</p>}
    {price.savings && <p className="fiche-saving m-0">{price.savings.label} : {price.savings.text}</p>}
    {price.message && <p className="m-0 text-[15px]">{price.message}</p>}
  </>;
}

export default function BrouillonFiche() {
  const { id } = useParams();
  const location = useLocation();
  const { data = [], envois = [], settings = {}, tarifs, categories, sbReady, can, getClient, refreshColis, setSelId, auth, workActions = [], teamUsers = [] } = useApp();
  const outage = useShellLoadBanner();
  const now = useMinuteNow();
  const twoColumns = useMediaQuery('(min-width: 1280px)');
  const validId = UUID.test(String(id || ''));
  const back = workspaceReturnPath(location.search, '/');
  // This sheet as it was opened (with the way back to its list): the pages it opens come back to it.
  const self = validId ? `/brouillon/${encodeURIComponent(id)}${new URLSearchParams(location.search).has('returnTo') ? `?${new URLSearchParams({ returnTo: back })}` : ''}` : '/';
  const dossier = data.find(item => item.id === id) || null;
  const client = dossier?.clientId ? getClient(dossier.clientId) || null : null;
  const inColis = Boolean(dossier) && colisTab(dossier) !== null;

  // The latest version of the dossier: the page distinguishes loading, a failed read and a dossier not found.
  const [read, setRead] = useState({ state: 'loading', reason: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!validId) { setRead({ state: 'done', reason: '' }); return undefined; }
    let active = true;
    setRead({ state: 'loading', reason: '' });
    refreshColis(id).then(() => { if (active) setRead({ state: 'done', reason: '' }); },
      error => { if (active) setRead({ state: 'failed', reason: String(error?.message || 'lecture impossible').replace(/[.\s]+$/, '') }); });
    return () => { active = false; };
  }, [id, validId, attempt, refreshColis]);

  const signals = useReceptionSignals({ clientId: dossier?.clientId || null, colisId: validId ? id : null, limit: 50, photos: true, enabled: inColis, data });
  const pendingIndex = useMemo(() => pendingByColis(signals.pending || []), [signals.pending]);
  // `actions`, `me`, `teamUsers`: who holds each task (the step's `heldBy`). `tarifs` and `categories` once loaded
  // only (empty while the data load runs or after it failed): what the quote misses is checked against them.
  const me = auth?.u || null;
  const ctx = useMemo(() => ({ client, envois, settings, pending: pendingIndex, notices: signals.notices || [], can, now, actions: workActions, me, teamUsers, ...(sbReady ? { tarifs, categories } : {}) }),
    [client, envois, settings, pendingIndex, signals.notices, can, now, workActions, me, teamUsers, sbReady, tarifs, categories]);
  const fiche = useMemo(() => inColis ? brouillonFiche(dossier, ctx) : null, [inColis, dossier, ctx]);
  const rawNotice = fiche?.notice ? (signals.notices || []).find(item => item.id === fiche.notice.id) || null : null;
  useDocumentTitle(fiche ? fiche.header.clientName : 'Fiche Brouillon');

  // « Demander l’accord » / « Relancer »: the page's message sheet, on this dossier selected for TaskMessage. It
  // belongs to the page: turning the tablet (one column or two) keeps the message as it is.
  const focusAction = useCallback(() => {
    (document.querySelector('[data-fiche-action] [data-action]:not([disabled])') || document.querySelector('[data-testid="fiche-action"] h2'))?.focus?.();
  }, []);
  const { sheet, open: openConsent, close: closeSheet, sent: sheetSent, confirmations } = useConsentSheet({ setSelId, focusAfter: focusAction });
  useEffect(() => { closeSheet(); }, [id, closeSheet]);

  const dossierHref = validId ? wholeDossierHref(id, self) : null;
  if (!dossier) {
    if (validId && read.state === 'loading') return <div className={`${PAGE} max-w-3xl space-y-4`} aria-busy="true">
      <BackLink to={back} />
      <h1 className="sr-only">Fiche Brouillon</h1>
      <p role="status" className="m-0 text-[16px] colis-muted">Chargement du dossier…</p>
      <div aria-hidden="true" className="space-y-3"><div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-gray-200" /><div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200" /><div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200" /></div>
    </div>;
    // The shell's banner already states an interrupted load, with its « Réessayer » (domain/dataLoad.js).
    if (outage) return <Elsewhere back={back} title="Dossier pas encore disponible" text="Le chargement des données a échoué : ce dossier n’a pas pu être lu. Réessayez depuis le bandeau en haut de la page. Rien n’a été modifié." dossierHref={null} />;
    if (read.state === 'failed') return <Elsewhere back={back} title="Chargement impossible" text={`Ce dossier n’a pas pu être chargé (${read.reason}). Rien n’a été modifié : réessayez dans un instant.`} dossierHref={dossierHref}>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="colis-action w-auto px-5"><RefreshCw size={18} aria-hidden="true" />Réessayer</button>
    </Elsewhere>;
    return <Elsewhere back={back} title="Dossier introuvable" text="Ce dossier n’est pas dans Colis : il a été archivé ou supprimé, ou votre compte n’y a pas accès. Le dossier complet garde son historique." dossierHref={dossierHref} />;
  }
  if (!inColis) return <Elsewhere back={back} title={dossier.statut === 'annule' ? 'Dossier annulé' : 'Dossier archivé'}
    text={`${dossier.ref || 'Ce dossier'} n’apparaît plus dans Colis : il est ${dossier.statut === 'annule' ? 'annulé' : 'archivé'}. Le dossier complet garde son historique.`} dossierHref={dossierHref} />;

  const { header, price, links } = fiche;
  const addCarton = links.addCarton;
  // The action of its line, with its own address (the conversation, the reception) or its task.
  const action = fiche.stage?.action || fiche.action || null;
  const receptionAllowed = can('perm_colis_receptionner');
  const addReason = addCarton.blockedReason || (!receptionAllowed ? 'Réservé aux personnes autorisées à réceptionner.' : '');
  const actionCard = <section key="action" className="fiche-card" aria-labelledby="fiche-prix" data-testid="fiche-action">
    {price.visible ? <Price price={price} /> : <>
      {/* Without the right to see amounts: no amount, but « Payé » and what the quote still needs. */}
      <h2 id="fiche-prix" tabIndex={-1}>Prochaine étape</h2>
      {price.state === PAID_TOTAL_STATE && <p className="m-0"><span className="colis-paid" data-testid="fiche-prix-etat"><Check size={18} aria-hidden="true" />{price.label}</span></p>}
      <Missing missing={fiche.missing} />
    </>}
    <div className="grid gap-3" data-fiche-action="">
      <ColisAction row={{ id: fiche.id, clientId: dossier.clientId, action }} action={action} returnTo={self} can={can} size="large"
        held={fiche.stage?.heldBy || null} confirmation={confirmations[id] || null}
        panelId="feuille-message" panelOpen={Boolean(sheet)} onOpenPanel={() => openConsent(id, `${action.label} · ${header.clientName}`)} />
    </div>
    <div className="flex flex-wrap items-start gap-3 border-t pt-3" style={{ borderColor: 'var(--colis-line-soft)' }}>
      {links.dossier && <Link to={wholeDossierHref(id, self)} className="colis-secondary"><FolderOpen size={18} aria-hidden="true" />{links.dossier.label}</Link>}
      {addCarton.href && !addReason
        ? <Link to={withReturnTo(addCarton.href, self)} className="colis-secondary"><PackagePlus size={18} aria-hidden="true" />{addCarton.label}</Link>
        : <div className="min-w-0 flex-1 basis-56">
          <button type="button" disabled aria-describedby="fiche-ajout-raison" className="colis-secondary"><PackagePlus size={18} aria-hidden="true" />{addCarton.label}</button>
          <p id="fiche-ajout-raison" className="colis-reason">{addReason || 'L’ajout d’un carton n’est pas possible pour ce dossier.'}</p>
        </div>}
    </div>
  </section>;
  const optimizedSection = <OptimizedParcels key="optimized" optimized={fiche.optimized} received={fiche.received} />;
  const receivedSection = <ReceivedCartons key="received" received={fiche.received} photos={signals.photos} photosError={signals.photosError} onRetryPhotos={signals.retry} />;
  const noticeSection = <ArrivalNoticeBlock key="notice" fiche={fiche} raw={rawNotice} client={client} loading={signals.notices === null}
    error={signals.noticesError} onRetry={signals.retry} onChanged={signals.retry} />;

  return <div className={`${PAGE} ${twoColumns ? 'max-w-[1200px]' : 'max-w-[900px]'} space-y-5`} data-testid="brouillon-fiche">
    <BackLink to={back} />
    <header className="grid gap-2">
      <h1 className="fiche-title">{header.clientName}</h1>
      <p className="m-0 text-[15px] colis-muted">
        {[header.destinationLabel, header.commune, header.clientTypeLabel].filter(Boolean).join(' · ')}
        {' · '}{header.casier ? <>Casier <span className="colis-code" style={{ color: 'var(--colis-text)' }}>{header.casier}</span></> : header.casierLabel}
        {header.ref && <>{' · '}<span className="keep-token">{header.ref}</span></>}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StagePill stage={header.stage} />
        {header.stage.detail && <span className="text-[15px] colis-muted">{header.stage.detail}</span>}
      </div>
    </header>
    {/* An interrupted load is stated once, by the shell's banner. */}
    {read.state === 'failed' && !outage && <p className="colis-quiet" data-testid="fiche-actualisation"><span>Ce dossier n’a pas pu être actualisé ({read.reason}) : vous voyez sa dernière version chargée.</span><button type="button" onClick={() => setAttempt(value => value + 1)} className="colis-link-button">Réessayer</button></p>}
    {signals.pendingError && <p className="colis-quiet"><span>Les cartons à valider n’ont pas pu être vérifiés ({signals.pendingError}).</span><button type="button" onClick={signals.retry} className="colis-link-button">Réessayer</button></p>}
    {twoColumns
      ? <div className="fiche-grid" data-columns="two">
        <div className="fiche-column">{receivedSection}{optimizedSection}</div>
        <div className="fiche-column">{actionCard}{noticeSection}</div>
      </div>
      // Phone and tablet: the total and the action first, then the parcels to ship, then the cartons received.
      : <div className="fiche-grid">{actionCard}{optimizedSection}{receivedSection}{noticeSection}</div>}
    {sheet && <ConsentSheet key={sheet.id} id="feuille-message" dossierId={sheet.id} title={sheet.title} action={action} held={fiche.stage?.heldBy || null}
      returnHref={dossierTaskUrl(id, 'accord', `?${new URLSearchParams({ returnTo: self })}`, { hash: 'dossier-work' })}
      clientHref={dossier.clientId && (can('perm_clients_voir') || can('perm_clients_creer')) ? `/clients/${encodeURIComponent(dossier.clientId)}` : null}
      onClose={closeSheet} onSent={sheetSent} />}
  </div>;
}

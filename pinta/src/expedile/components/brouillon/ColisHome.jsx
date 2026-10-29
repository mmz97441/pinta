import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Check, ChevronRight, MapPin, PackagePlus, Plane, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import useMediaQuery from '../../hooks/useMediaQuery';
import useParamInput from '../../hooks/useParamInput';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';
import { canSeeDossierFinances } from '../../domain/dossierOverview';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { NO_DEPARTURE_GROUP_KEY } from '../../domain/departureGroups';
import { COLIS_SORTS, COLIS_TABS, MEASURE_MISSING_LABEL, NO_DESTINATION_GROUP_KEY, PAID_TOTAL_STATE, brouillonAlerts, colisRow, colisSearchMatch, colisSortKey, colisTab, colisTabKey, colisTotals, filterColisRows, groupColisRowsByDeparture, groupColisRowsByDestination, pendingByColis, sortColisRows } from '../../domain/brouillon';
import { eur } from '../../utils/format';
import WorkLoadError from '../workspace/WorkLoadError';
import ColisAction from './ColisAction';
import ConsentSheet from './ConsentSheet';
import ScrollFrame from './ScrollFrame';
import StagePill, { ClientMeta, ZoneTag, totalsParts } from './StagePill';
import { withReturnTo } from './colisLinks';
import useConsentSheet from './useConsentSheet';
import useReceptionSignals from './useReceptionSignals';
import useScanner from './useScanner';
import './colisHome.css';

// « Colis » (/): the four tabs of the team, one line per dossier with its step and its one action
// (docs/specification-brouillon-reception-2026-10-28.md, « Écrans Colis »). Everything shown comes from
// domain/brouillon.js; this screen only lays it out, keeps its state in the address (?onglet=, ?classer=, ?q=)
// and opens the action: a page, or the client's message in the page's sheet (ConsentSheet). One table at every
// width: on a phone it scrolls sideways in its frame (ScrollFrame), the client's column kept in place.

const EMPTY_TABS = {
  brouillon: { title: 'Aucun colis en stock', text: 'Les cartons réceptionnés apparaissent ici jusqu’à l’envoi du devis.' },
  a_payer: { title: 'Aucun devis en attente de paiement', text: 'Les dossiers dont le devis est envoyé apparaissent ici jusqu’au paiement.' },
  pret: { title: 'Aucun dossier prêt à partir', text: 'Les dossiers payés apparaissent ici jusqu’à leur départ.' },
  parti: { title: 'Aucun dossier parti', text: 'Les dossiers expédiés apparaissent ici jusqu’à leur livraison.' },
};
const plural = (count, singular, several) => `${count} ${count > 1 ? several : singular}`;
// Addresses of Mon travail when it was the home page (/?section=…, ?mission=…, ?preferences=1): they open Mon travail.
const WORK_PARAMS = ['section', 'mission', 'preferences'];

/** « 2,1 kg · 0,012 m³ », or « À mesurer » once when neither is known. */
function measuresText(row) {
  return row.poidsLabel === row.volumeLabel ? row.poidsLabel : `${row.poidsLabel} · ${row.volumeLabel}`;
}

/** The total: the saved quote's price and its state (« Payé » once paid), else what it is (« À calculer »), never
 * a false zero. */
function Total({ total }) {
  if (!total?.visible) return null;
  if (total.state === PAID_TOTAL_STATE) return <>
    {total.amount !== null && <span className="colis-amount">{eur(total.amount)}</span>}
    <span className="colis-paid"><Check size={16} aria-hidden="true" />{total.label}</span>
  </>;
  if (total.amount !== null) return <><span className="colis-amount">{eur(total.amount)}</span>{total.state && <span className="colis-sub">{total.state}</span>}</>;
  return <span className="colis-muted text-[15px]">{total.label}</span>;
}
// The column of amounts: what is still to pay, then what was paid.
const TOTAL_HEADERS = { brouillon: 'Total à payer', a_payer: 'Total à payer', pret: 'Total payé', parti: 'Total' };

// The groups whose departure or destination is still to set: said in the colour of what is to check.
const toSet = group => group.key === NO_DEPARTURE_GROUP_KEY || group.key === NO_DESTINATION_GROUP_KEY;

/** The heading of a group (a departure, a destination), a line of the table: it stays in view while the table
 * scrolls sideways. */
function GroupHead({ group }) {
  const none = toSet(group);
  const Icon = none ? AlertCircle : group.key.startsWith('destination:') ? MapPin : Plane;
  return <span className="colis-group-head colis-keep-in-view">
    <span className="colis-group-title">
      <Icon size={20} aria-hidden="true" className="shrink-0" />
      <strong>{[group.label, group.destinationLabel].filter(Boolean).join(' · ')}</strong>
      {!none && group.ref && <span>{group.ref}</span>}
      {group.closingLabel && <span>{group.closingLabel}</span>}
    </span>
    <span className="colis-group-totals">{totalsParts(group.totals, { amount: true }).join(' · ')}</span>
  </span>;
}

/** The dimensions, under the cartons' weight and volume: one line per carton received (« 40 × 30 × 20 cm »), or,
 * once prepared, per parcel to ship (« Préparé : »); « + 2 autres » past three lines. */
function Dimensions({ id, dimensions }) {
  // Nothing measured yet: the line above already says « À mesurer ».
  if (!dimensions.prepared && dimensions.lines.every(line => line === MEASURE_MISSING_LABEL)) return null;
  return <span className="colis-dims" data-dimensions={id}>
    {dimensions.prepared && <span className="colis-dims-caption">Préparé{'\u00a0'}:</span>}
    {dimensions.shown.map((line, index) => <span key={index} className="colis-dim-line" data-missing={line === MEASURE_MISSING_LABEL ? 'true' : undefined}>{line}</span>)}
    {dimensions.moreLabel && <span className="colis-dims-caption">{dimensions.moreLabel}</span>}
  </span>;
}

function TableRow({ row, match, finances, link, returnTo, can, sheetId, openId, confirmation, onOpenPanel }) {
  return <tr data-colis-row={row.id} data-stage={row.stage.key}>
    <th scope="row">
      <Link to={link(row)} className="colis-row-name" data-colis-name={row.id}>{row.clientName}</Link>
      {/* La Réunion with its delivery zone: the zone stands for the island (« SUD Le Tampon »), on one line. */}
      <span className="colis-sub">{row.zone
        ? <><ZoneTag zone={row.zone} label={row.zoneLabel} region={row.destinationLabel} />{row.commune ? ` ${row.commune}` : ''}</>
        : [row.destinationLabel, row.commune].filter(Boolean).join(' · ')}</span>
      <ClientMeta clientRef={row.clientRef} forfaitLabel={row.forfaitLabel} />
      {/* Found by a number: which one, so the team sees why the line is there. */}
      {match && <span className="colis-match" data-match={row.id}><Search size={15} aria-hidden="true" className="shrink-0" /><span>{match}</span></span>}
    </th>
    <td>
      <span className="colis-strong">{row.cartonsLabel} · {row.casier ? <>casier <span className="colis-code">{row.casier}</span></> : 'casier à renseigner'}</span>
      <span className="colis-sub">{measuresText(row)}</span>
      <Dimensions id={row.id} dimensions={row.dimensions} />
    </td>
    <td>
      <StagePill stage={row.stage} />
      {row.stage.detail && <span className="colis-sub">{row.stage.detail}</span>}
    </td>
    {finances && <td data-align="right"><Total total={row.total} /></td>}
    <td><ColisAction row={row} returnTo={returnTo} can={can} held={row.stage.heldBy} confirmation={confirmation}
      panelId={sheetId} panelOpen={openId === row.id} onOpenPanel={() => onOpenPanel(row)} /></td>
  </tr>;
}

export default function ColisHome() {
  const { data = [], clients = [], envois = [], settings = {}, tarifs, categories, can, getClient, sbReady, dataLoading, dataError, retryLoad, setSelId, auth, workActions = [], teamUsers = [] } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const now = useMinuteNow();
  const wide = useMediaQuery('(min-width: 768px)');
  const searchId = useId();
  const sortId = useId();
  const searchField = useRef(null);
  useDocumentTitle('Colis');

  const finances = canSeeDossierFinances(can);
  const tabKey = colisTabKey(params.get('onglet'));
  const tab = COLIS_TABS.find(item => item.key === tabKey);
  const sorts = COLIS_SORTS.filter(sort => !sort.financial || finances);
  const requestedSort = colisSortKey(params.get('classer'));
  const sortKey = sorts.some(sort => sort.key === requestedSort) ? requestedSort : sorts[0].key;
  const sort = sorts.find(item => item.key === sortKey);
  const setParam = useCallback((key, value) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true }), [setParams]);
  // The text as typed or scanned; the address follows it (hooks/useParamInput.js).
  const [searchText, changeSearch] = useParamInput(params.get('q') || '', value => setParam('q', value));
  const searching = searchText.trim() !== '';

  const legacyWork = WORK_PARAMS.some(key => params.has(key));
  const dataLoad = staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) });
  const failed = dataLoad.state === 'failed';
  const signals = useReceptionSignals({ limit: 50, enabled: !failed && !legacyWork, data });
  const pendingIndex = useMemo(() => pendingByColis(signals.pending || []), [signals.pending]);
  const notices = signals.notices;
  // `actions`, `me`, `teamUsers`: who holds each task (the step's `heldBy`). `tarifs` and `categories` once loaded
  // only (empty while the data load runs or after it failed): « Devis à compléter » is checked against them.
  const me = auth?.u || null;
  const ctx = useMemo(() => ({ getClient, envois, settings, pending: pendingIndex, notices: notices || [], can, now, actions: workActions, me, teamUsers, ...(sbReady ? { tarifs, categories } : {}) }),
    [getClient, envois, settings, pendingIndex, notices, can, now, workActions, me, teamUsers, sbReady, tarifs, categories]);
  const dossiersByTab = useMemo(() => {
    const byTab = new Map(COLIS_TABS.map(item => [item.key, []]));
    for (const dossier of data) { const key = colisTab(dossier); if (key) byTab.get(key).push(dossier); }
    return byTab;
  }, [data]);
  // Rows of a tab, built once per state of the data: the current tab always, the others only for a search.
  const rowsOf = useMemo(() => {
    const cache = new Map();
    return key => {
      if (!cache.has(key)) cache.set(key, (dossiersByTab.get(key) || []).map(dossier => colisRow(dossier, ctx)));
      return cache.get(key);
    };
  }, [dossiersByTab, ctx]);
  const rows = rowsOf(tabKey);
  const matches = useMemo(() => filterColisRows(rows, searchText), [rows, searchText]);
  const counts = useMemo(() => Object.fromEntries(COLIS_TABS.map(item => [item.key,
    searching ? filterColisRows(rowsOf(item.key), searchText).length : (dossiersByTab.get(item.key) || []).length])), [rowsOf, dossiersByTab, searching, searchText]);
  // « Par date d’envoi » and « Par destination »: groups, each with its line of totals; the other sorts: one list.
  const groups = useMemo(() => sortKey === 'depart' ? groupColisRowsByDeparture(sortColisRows(matches, 'nom', { now }), { now })
    : sortKey === 'destination' ? groupColisRowsByDestination(matches) : null, [matches, sortKey, now]);
  const sorted = useMemo(() => groups ? null : sortColisRows(matches, sortKey, { now }), [groups, matches, sortKey, now]);
  const totals = useMemo(() => colisTotals(matches), [matches]);
  // Read at the screen's minute: a notice still on its way becomes « à vérifier » after ten minutes.
  const alerts = useMemo(() => brouillonAlerts({ pending: signals.pending || [], notices: notices || [], now }), [signals.pending, notices, now]);
  const elsewhere = useMemo(() => searching && !matches.length
    ? COLIS_TABS.filter(item => item.key !== tabKey && counts[item.key] > 0).map(item => ({ ...item, count: counts[item.key] })) : [], [searching, matches.length, tabKey, counts]);

  // The way back to this list as it is (tab, sort, search), for the sheet and the dossier tasks.
  const listUrl = useCallback((changes = {}) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    const query = next.toString(); // URLSearchParams.size needs Safari 17
    return query ? `/?${query}` : '/';
  }, [location.search]);
  const returnTo = listUrl();
  const ficheLink = useCallback((row, back = returnTo) => `${row.ficheHref}?${new URLSearchParams({ returnTo: back })}`, [returnTo]);

  // « Demander l’accord » and « Relancer »: the page's message sheet, on the selected dossier. It belongs to the
  // page, not to the line: the line may leave the search, change group or become a card, the message stays.
  const focusLine = useCallback(id => {
    const target = document.querySelector(`[data-colis-row="${id}"] [data-action]:not([disabled])`) || document.querySelector(`[data-colis-name="${id}"]`);
    target?.focus();
  }, []);
  const { sheet, open: openConsent, close: closeSheet, sent: sheetSent, confirmations } = useConsentSheet({ setSelId, focusAfter: focusLine });
  const openSheet = useCallback(row => openConsent(row.id, `${row.action.label} · ${row.clientName}`), [openConsent]);
  // Its dossier as it is now: the action and who holds the task decide what the sheet offers.
  const sheetRow = useMemo(() => {
    const dossier = sheet ? data.find(item => item.id === sheet.id) : null;
    return dossier ? colisRow(dossier, ctx) : null;
  }, [sheet, data, ctx]);
  // Another tab (the browser's back button) closes it.
  const shownTab = useRef(tabKey);
  useEffect(() => {
    if (shownTab.current === tabKey) return;
    shownTab.current = tabKey;
    closeSheet();
  }, [tabKey, closeSheet]);

  // Enter in the search, or a scan anywhere: the only dossier found opens its sheet; nothing found here but in one
  // other tab: that tab.
  const submitSearch = text => {
    const query = String(text || '').trim();
    if (!query) return;
    const here = filterColisRows(rows, query);
    const back = listUrl({ q: query });
    if (here.length === 1) { navigate(ficheLink(here[0], back)); return; }
    if (!here.length) {
      const found = COLIS_TABS.filter(item => item.key !== tabKey).map(item => ({ key: item.key, rows: filterColisRows(rowsOf(item.key), query) })).filter(item => item.rows.length);
      if (found.length === 1 && found[0].rows.length === 1) { navigate(ficheLink(found[0].rows[0], listUrl({ q: query, onglet: found[0].key }))); return; }
      if (found.length === 1) setParam('onglet', found[0].key);
    }
  };
  // The text stays selected, so the next scan replaces it.
  const onSearchKey = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitSearch(event.currentTarget.value);
    event.currentTarget.select();
  };
  // A scanner used while no field has the focus fills the search, without focusing it (no keyboard on a tablet).
  useScanner({
    enabled: !sheet && !failed && !legacyWork,
    onScan: text => { changeSearch(text.trim()); submitSearch(text); },
  });

  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await retryLoad?.(); } catch { /* The reason stays on screen. */ } finally { setRetrying(false); }
  };

  if (legacyWork) return <Navigate to={`/travail${location.search}`} replace />;
  if (failed) return <div className="colis-page mx-auto w-full max-w-[1280px] space-y-4 px-4 pb-10 pt-4 lg:px-5">
    <h1 className="sr-only">Colis</h1>
    <WorkLoadError title="Les colis n’ont pas pu être chargés" reason={dataLoad.reason} note="Les dossiers enregistrés sont conservés. Les onglets, la liste et ses totaux s’afficheront dès que le chargement aura réussi." retrying={retrying} onRetry={retry} />
  </div>;

  const sheetId = 'feuille-message';
  const rowProps = { finances, link: ficheLink, returnTo, can, sheetId, openId: sheet?.id || null, onOpenPanel: openSheet };
  const lineProps = row => ({ row, match: searching ? colisSearchMatch(row, searchText) : null, confirmation: confirmations[row.id] || null, ...rowProps });
  const signalProblem = signals.pendingError && signals.noticesError
    ? `Les réceptions à valider et les avis d’arrivée n’ont pas pu être vérifiés (${signals.pendingError}).`
    : signals.pendingError ? `Les réceptions à valider n’ont pas pu être vérifiées (${signals.pendingError}).`
      : signals.noticesError ? `Les avis d’arrivée n’ont pas pu être vérifiés (${signals.noticesError}).` : '';
  const empty = !rows.length ? EMPTY_TABS[tabKey] : null;
  const caption = `${tab.label}, classé ${sort.label.replace(/^Par/, 'par')}`;

  // The same columns everywhere; their widths: CSS (a share of the table on a tablet, fixed on a phone).
  const list = <ScrollFrame className="colis-table-wrap" testId="colis-liste">
      <table className="colis-table" data-finances={finances ? 'true' : 'false'}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="colis-col-client" /><col className="colis-col-colis" /><col className="colis-col-stage" />
          {finances && <col className="colis-col-total" />}<col className="colis-col-action" />
        </colgroup>
        <thead><tr>
          <th scope="col">Client</th><th scope="col">Colis</th><th scope="col">Où en est-on</th>
          {finances && <th scope="col" data-align="right">{TOTAL_HEADERS[tabKey] || 'Total'}</th>}
          <th scope="col"><span className="sr-only">Action</span></th>
        </tr></thead>
        {groups
          ? groups.map(group => <tbody key={group.key}>
            <tr className="colis-group-row" data-group={group.key} data-none={toSet(group) ? 'true' : undefined}><th scope="rowgroup" colSpan={finances ? 5 : 4}><GroupHead group={group} /></th></tr>
            {group.rows.map(row => <TableRow key={row.id} {...lineProps(row)} />)}
          </tbody>)
          : <tbody>{sorted.map(row => <TableRow key={row.id} {...lineProps(row)} />)}</tbody>}
      </table>
    </ScrollFrame>;

  return <div className="colis-page mx-auto w-full max-w-[1280px] space-y-4 px-4 pb-10 pt-4 lg:px-5">
    <h1 className="sr-only">Colis</h1>
    <nav aria-label="Étapes des colis" className="colis-tabs">
      {COLIS_TABS.map(item => <Link key={item.key} to={listUrl({ onglet: item.key })} replace aria-current={item.key === tabKey ? 'page' : undefined}
        aria-label={`${item.label} ${counts[item.key]} ${counts[item.key] > 1 ? 'dossiers' : 'dossier'}`} className="colis-tab">
        <span>{item.label}</span><span className="colis-tab-count">{counts[item.key]}</span>
      </Link>)}
    </nav>

    <p className="m-0 text-[16px] leading-snug colis-muted" data-testid="colis-totals">
      {searching ? `Recherche « ${searchText.trim()} »` : tab.description}{' · '}
      <strong className="font-bold" style={{ color: 'var(--colis-text)' }}>{matches.length ? totalsParts(totals).join(' · ') : 'aucun dossier'}</strong>
    </p>

    {/* Alerts only when something is to do; a failed check says so quietly, the list stays. */}
    {alerts.length > 0 && <div className="colis-alerts">
      {alerts.map(alert => {
        const reception = alert.action?.href?.startsWith('/recevoir');
        const target = alert.action?.href ? reception ? withReturnTo(alert.action.href, returnTo) : alert.action.href : null;
        const restricted = reception && !can('perm_colis_receptionner');
        const content = <><AlertTriangle size={20} aria-hidden="true" className="shrink-0" /><span>{alert.text}</span></>;
        // One alert, one click: the alert itself leads to what is to do.
        if (target && !restricted) return <Link key={alert.key} to={target} className="colis-alert" data-alert={alert.key}>
          {content}<span className="colis-alert-action">{alert.action.label}<ChevronRight size={18} aria-hidden="true" /></span>
        </Link>;
        return <p key={alert.key} className="colis-alert m-0" data-alert={alert.key}>
          {content}{restricted && <span className="colis-alert-note">Validation réservée aux personnes autorisées à réceptionner.</span>}
        </p>;
      })}
    </div>}
    {signalProblem && <p className="colis-quiet" data-testid="colis-signals-error"><span>{signalProblem}</span><button type="button" onClick={signals.retry} className="colis-link-button">Réessayer</button></p>}
    <p className="sr-only" aria-live="polite">{[...alerts.map(alert => alert.text), signalProblem].filter(Boolean).join(' · ')}</p>

    <div className="colis-toolbar">
      <div className="colis-search" data-filled={searchText ? 'true' : undefined}>
        <label htmlFor={searchId} className="sr-only">Chercher par nom, numéro de colis, numéro de suivi ou numéro d’expédition</label>
        <Search size={22} aria-hidden="true" className="colis-search-icon" />
        <input ref={searchField} id={searchId} type="search" value={searchText} onChange={event => changeSearch(event.target.value)} onKeyDown={onSearchKey}
          placeholder="Nom, n° de colis ou d’expédition" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" />
        {searchText && <button type="button" aria-label="Effacer la recherche" className="colis-search-clear" onClick={() => { changeSearch(''); searchField.current?.focus(); }}><X size={20} aria-hidden="true" /></button>}
      </div>
      {wide
        ? <div role="group" aria-label="Classer" className="colis-sorts">
          {sorts.map(item => <button key={item.key} type="button" aria-pressed={item.key === sortKey} onClick={() => setParam('classer', item.key)} className="colis-sort">{item.label}</button>)}
        </div>
        : <div className="colis-sort-select">
          <label htmlFor={sortId}>Classer</label>
          <select id={sortId} value={sortKey} onChange={event => setParam('classer', event.target.value)}>{sorts.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        </div>}
    </div>
    <p className="sr-only" aria-live="polite">{searching ? plural(matches.length, 'dossier trouvé', 'dossiers trouvés') : ''}</p>

    {matches.length > 0 ? list
      : empty ? <section className="colis-empty" aria-labelledby="colis-vide">
        <h2 id="colis-vide">{empty.title}</h2><p>{empty.text}</p>
        {tabKey === 'brouillon' && can('perm_colis_receptionner') && <div className="colis-empty-actions"><Link to={withReturnTo('/recevoir', returnTo)} className="colis-action w-auto px-5"><PackagePlus size={20} aria-hidden="true" />Réceptionner des cartons</Link></div>}
      </section>
        : <section className="colis-empty" aria-labelledby="colis-vide">
          <h2 id="colis-vide">Aucun dossier de l’onglet {tab.label} ne correspond à « {searchText.trim()} »</h2>
          <p>{elsewhere.length ? 'Ce que vous cherchez se trouve dans un autre onglet.' : 'Vérifiez l’orthographe, ou cherchez par numéro de colis, de suivi ou d’expédition.'}</p>
          <div className="colis-empty-actions">
            {elsewhere.map(item => <Link key={item.key} to={listUrl({ onglet: item.key, q: searchText })} replace className="colis-action w-auto px-5">Voir {plural(item.count, 'dossier', 'dossiers')} dans {item.label}</Link>)}
            <button type="button" onClick={() => { changeSearch(''); searchField.current?.focus(); }} className="colis-secondary">Effacer la recherche</button>
          </div>
        </section>}

    {sheet && <ConsentSheet key={sheet.id} id={sheetId} dossierId={sheet.id} title={sheet.title} action={sheetRow?.action || null} held={sheetRow?.stage?.heldBy || null}
      returnHref={dossierTaskUrl(sheet.id, 'accord', `?${new URLSearchParams({ returnTo })}`, { hash: 'dossier-work' })}
      clientHref={sheetRow?.clientId && (can('perm_clients_voir') || can('perm_clients_creer')) ? `/clients/${encodeURIComponent(sheetRow.clientId)}` : null}
      onClose={closeSheet} onSent={sheetSent} />}
  </div>;
}

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ChevronRight, PackagePlus, Plane, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import useMediaQuery from '../../hooks/useMediaQuery';
import useParamInput from '../../hooks/useParamInput';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';
import { canSeeDossierFinances } from '../../domain/dossierOverview';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { NO_DEPARTURE_GROUP_KEY } from '../../domain/departureGroups';
import { COLIS_SORTS, COLIS_TABS, brouillonAlerts, colisRow, colisSortKey, colisTab, colisTabKey, colisTotals, filterColisRows, groupColisRowsByDeparture, pendingByColis, sortColisRows } from '../../domain/brouillon';
import { eur } from '../../utils/format';
import WorkLoadError from '../workspace/WorkLoadError';
import ColisAction from './ColisAction';
import ConsentPanel from './ConsentPanel';
import StagePill, { totalsParts } from './StagePill';
import useReceptionSignals from './useReceptionSignals';
import './colisHome.css';

// « Colis » (/): the four tabs of the team, one line per dossier with its step and its one action
// (docs/specification-brouillon-reception-2026-10-28.md, « Écrans Colis »). Everything shown comes from
// domain/brouillon.js; this screen only lays it out, keeps its state in the address (?onglet=, ?classer=, ?q=)
// and opens the action: a page, or the client's message in place.

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

/** The total to pay: the saved quote's price (and its state), else what it is (« À calculer »), never a false zero. */
function Total({ total }) {
  if (!total?.visible) return null;
  if (total.amount !== null) return <><span className="colis-amount">{eur(total.amount)}</span>{total.state && <span className="colis-sub">{total.state}</span>}</>;
  return <span className="colis-muted text-[15px]">{total.label}</span>;
}

function GroupHead({ group }) {
  const none = group.key === NO_DEPARTURE_GROUP_KEY;
  const Icon = none ? AlertCircle : Plane;
  return <span className="colis-group-head">
    <span className="colis-group-title">
      <Icon size={20} aria-hidden="true" className="shrink-0" />
      <strong>{[group.label, group.destinationLabel].filter(Boolean).join(' · ')}</strong>
      {!none && group.ref && <span>{group.ref}</span>}
      {group.closingLabel && <span>{group.closingLabel}</span>}
    </span>
    <span className="colis-group-totals">{totalsParts(group.totals, { amount: true }).join(' · ')}</span>
  </span>;
}

function TableRow({ row, columns, finances, link, returnTo, can, panel, onTogglePanel, onClosePanel }) {
  const panelId = `panneau-${row.id}`;
  const open = panel?.id === row.id;
  return <>
    <tr data-colis-row={row.id} data-stage={row.stage.key}>
      <th scope="row">
        <Link to={link(row)} className="colis-row-name" data-colis-name={row.id}>{row.clientName}</Link>
        <span className="colis-sub">{[row.destinationLabel, row.commune].filter(Boolean).join(' · ')}</span>
      </th>
      <td>
        <span className="colis-strong">{row.cartonsLabel} · {row.casier ? <>casier <span className="colis-code">{row.casier}</span></> : 'casier à renseigner'}</span>
        <span className="colis-sub">{measuresText(row)}</span>
      </td>
      <td>
        <StagePill stage={row.stage} />
        {row.stage.detail && <span className="colis-sub">{row.stage.detail}</span>}
      </td>
      {finances && <td data-align="right"><Total total={row.total} /></td>}
      <td><ColisAction row={row} returnTo={returnTo} can={can} panelId={panelId} panelOpen={open} onTogglePanel={() => onTogglePanel(row)} /></td>
    </tr>
    {open && <tr className="colis-panel-row"><td colSpan={columns}>
      <ConsentPanel id={panelId} dossierId={row.id} title={panel.title} returnHref={panel.returnHref} onClose={() => onClosePanel(row.id)} />
    </td></tr>}
  </>;
}

function Card({ row, finances, link, returnTo, can, panel, onTogglePanel, onClosePanel }) {
  const panelId = `panneau-${row.id}`;
  const open = panel?.id === row.id;
  return <li className="colis-card" data-colis-row={row.id} data-stage={row.stage.key}>
    <div className="colis-card-top">
      <Link to={link(row)} className="colis-card-name" data-colis-name={row.id}>{row.clientName}</Link>
      {finances && <div className="colis-card-total"><Total total={row.total} /></div>}
    </div>
    <p className="colis-card-line">{[row.cartonsLabel, measuresText(row), [row.destinationLabel, row.commune].filter(Boolean).join(', ')].join(' · ')}</p>
    <div className="colis-card-stage">
      <StagePill stage={row.stage} />
      <span className="colis-muted text-[15px]">{row.casier ? <>Casier <span className="colis-code">{row.casier}</span></> : 'Casier à renseigner'}</span>
    </div>
    {row.stage.detail && <p className="colis-card-line colis-muted">{row.stage.detail}</p>}
    <ColisAction row={row} returnTo={returnTo} can={can} panelId={panelId} panelOpen={open} onTogglePanel={() => onTogglePanel(row)} className="mt-1" />
    {open && <ConsentPanel id={panelId} dossierId={row.id} title={panel.title} returnHref={panel.returnHref} onClose={() => onClosePanel(row.id)} />}
  </li>;
}

export default function ColisHome() {
  const { data = [], clients = [], envois = [], settings = {}, can, getClient, sbReady, dataLoading, dataError, retryLoad, setSelId } = useApp();
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
  const ctx = useMemo(() => ({ getClient, envois, settings, pending: pendingIndex, notices: notices || [], can, now }), [getClient, envois, settings, pendingIndex, notices, can, now]);
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
  const groups = useMemo(() => sortKey === 'depart' ? groupColisRowsByDeparture(sortColisRows(matches, 'nom', { now }), { now }) : null, [matches, sortKey, now]);
  const sorted = useMemo(() => sortKey === 'depart' ? null : sortColisRows(matches, sortKey, { now }), [matches, sortKey, now]);
  const totals = useMemo(() => colisTotals(matches), [matches]);
  const alerts = useMemo(() => brouillonAlerts({ pending: signals.pending || [], notices: notices || [] }), [signals.pending, notices]);
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

  // « Demander l’accord » and « Relancer »: one message panel at a time, on the selected dossier.
  const [panel, setPanel] = useState(null);
  const panelRef = useRef(null);
  panelRef.current = panel;
  const closePanel = useCallback(id => {
    setPanel(null);
    setSelId(current => current === id ? null : current);
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-colis-row="${id}"] [aria-controls], [data-colis-row="${id}"] button[data-action]`) || document.querySelector(`[data-colis-name="${id}"]`);
      target?.focus();
    });
  }, [setSelId]);
  const togglePanel = useCallback(row => {
    if (panelRef.current?.id === row.id) { closePanel(row.id); return; }
    setSelId(row.id);
    setPanel({ id: row.id, title: `${row.action.label} · ${row.clientName}`,
      returnHref: dossierTaskUrl(row.id, 'accord', `?${new URLSearchParams({ returnTo })}`, { hash: 'dossier-work' }) });
  }, [closePanel, setSelId, returnTo]);
  // Another tab closes the panel; leaving the page releases the selection it took.
  useEffect(() => {
    const open = panelRef.current;
    if (!open) return;
    setPanel(null);
    setSelId(current => current === open.id ? null : current);
  }, [tabKey, setSelId]);
  useEffect(() => () => {
    const open = panelRef.current;
    if (open) setSelId(current => current === open.id ? null : current);
  }, [setSelId]);

  // Enter (a scanner validates at once): the only dossier found opens its sheet; nothing found here but in one
  // other tab: that tab. The text stays selected, so the next scan replaces it.
  const onSearchKey = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = event.currentTarget.value;
    if (!text.trim()) return;
    const here = filterColisRows(rows, text);
    const back = listUrl({ q: text });
    if (here.length === 1) { navigate(ficheLink(here[0], back)); return; }
    if (!here.length) {
      const found = COLIS_TABS.filter(item => item.key !== tabKey).map(item => ({ key: item.key, rows: filterColisRows(rowsOf(item.key), text) })).filter(item => item.rows.length);
      if (found.length === 1 && found[0].rows.length === 1) { navigate(ficheLink(found[0].rows[0], listUrl({ q: text, onglet: found[0].key }))); return; }
      if (found.length === 1) setParam('onglet', found[0].key);
    }
    event.currentTarget.select();
  };

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

  const columns = finances ? 5 : 4;
  const rowProps = { finances, link: ficheLink, returnTo, can, panel, onTogglePanel: togglePanel, onClosePanel: closePanel };
  const signalProblem = signals.pendingError && signals.noticesError
    ? `Les réceptions à valider et les avis d’arrivée n’ont pas pu être vérifiés (${signals.pendingError}).`
    : signals.pendingError ? `Les réceptions à valider n’ont pas pu être vérifiées (${signals.pendingError}).`
      : signals.noticesError ? `Les avis d’arrivée n’ont pas pu être vérifiés (${signals.noticesError}).` : '';
  const empty = !rows.length ? EMPTY_TABS[tabKey] : null;
  const caption = `${tab.label}, classé ${sort.label.replace(/^Par/, 'par')}`;

  const list = wide
    ? <div className="colis-table-wrap">
      <table className="colis-table">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col style={{ width: finances ? '19%' : '23%' }} /><col style={{ width: finances ? '16.5%' : '19%' }} /><col style={{ width: finances ? '24.5%' : '30%' }} />
          {finances && <col style={{ width: '13%' }} />}<col style={{ width: finances ? '27%' : '28%' }} />
        </colgroup>
        <thead><tr>
          <th scope="col">Client</th><th scope="col">Colis</th><th scope="col">Où en est-on</th>
          {finances && <th scope="col" data-align="right">Total à payer</th>}
          <th scope="col"><span className="sr-only">Action</span></th>
        </tr></thead>
        {groups
          ? groups.map(group => <tbody key={group.key}>
            <tr className="colis-group-row" data-none={group.key === NO_DEPARTURE_GROUP_KEY ? 'true' : undefined}><th scope="rowgroup" colSpan={columns}><GroupHead group={group} /></th></tr>
            {group.rows.map(row => <TableRow key={row.id} row={row} columns={columns} {...rowProps} />)}
          </tbody>)
          : <tbody>{sorted.map(row => <TableRow key={row.id} row={row} columns={columns} {...rowProps} />)}</tbody>}
      </table>
    </div>
    : groups
      ? <div className="grid gap-5">{groups.map(group => <section key={group.key} className="colis-group-section" data-none={group.key === NO_DEPARTURE_GROUP_KEY ? 'true' : undefined} aria-labelledby={`groupe-${group.key}`}>
        <h2 id={`groupe-${group.key}`}><GroupHead group={group} /></h2>
        <ul className="colis-cards" aria-label={group.label}>{group.rows.map(row => <Card key={row.id} row={row} {...rowProps} />)}</ul>
      </section>)}</div>
      : <ul className="colis-cards" aria-label={caption}>{sorted.map(row => <Card key={row.id} row={row} {...rowProps} />)}</ul>;

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
        const target = alert.action?.href || null;
        const restricted = target?.startsWith('/recevoir') && !can('perm_colis_receptionner');
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
        <label htmlFor={searchId} className="sr-only">Chercher un client, une référence, un casier ou un numéro de suivi</label>
        <Search size={22} aria-hidden="true" className="colis-search-icon" />
        <input ref={searchField} id={searchId} type="search" value={searchText} onChange={event => changeSearch(event.target.value)} onKeyDown={onSearchKey}
          placeholder="Chercher un client ou un carton" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" />
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
        {tabKey === 'brouillon' && can('perm_colis_receptionner') && <div className="colis-empty-actions"><Link to="/recevoir" className="colis-action w-auto px-5"><PackagePlus size={20} aria-hidden="true" />Réceptionner des cartons</Link></div>}
      </section>
        : <section className="colis-empty" aria-labelledby="colis-vide">
          <h2 id="colis-vide">Aucun dossier de l’onglet {tab.label} ne correspond à « {searchText.trim()} »</h2>
          <p>{elsewhere.length ? 'Ce que vous cherchez se trouve dans un autre onglet.' : 'Vérifiez l’orthographe, ou cherchez par référence, casier ou numéro de suivi.'}</p>
          <div className="colis-empty-actions">
            {elsewhere.map(item => <Link key={item.key} to={listUrl({ onglet: item.key, q: searchText })} replace className="colis-action w-auto px-5">Voir {plural(item.count, 'dossier', 'dossiers')} dans {item.label}</Link>)}
            <button type="button" onClick={() => { changeSearch(''); searchField.current?.focus(); }} className="colis-secondary">Effacer la recherche</button>
          </div>
        </section>}
  </div>;
}

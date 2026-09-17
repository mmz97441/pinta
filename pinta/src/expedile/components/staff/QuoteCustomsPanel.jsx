import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { excludedInvoiceIds } from '../../domain/invoiceDocuments';

const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';
const BUTTON = 'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50';
const cachedDrafts = new Map();
const text = value => Array.isArray(value) ? value.join(' · ') : typeof value === 'string' ? value : '';
const rate = value => value == null || value === '' ? 'à renseigner' : `${Number(value).toLocaleString('fr-FR')} %`;
const finiteRate = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 && Math.abs(Number(value) * 10000 - Math.round(Number(value) * 10000)) < 0.000001;
const conditional = tariff => Boolean(text(tariff?.conditions) || /^ex\b/i.test(tariff?.code || ''));
const needsAcknowledgement = tariff => tariff?.historical || tariff?.source?.status === 'historical' || conditional(tariff);
const seed = line => ({ tariff: line.customDuty?.tariffId ? line.customDuty : null, manual: Boolean(line.customDuty?.overrideReason), om: line.customDuty?.rates?.om ?? '', omr: line.customDuty?.rates?.omr ?? '', reason: line.customDuty?.overrideReason || '', acknowledged: false });
const signature = (lines, destination) => JSON.stringify([destination, lines.map(line => [line.id, line.desc, line.qte, line.prix, line.cat, line.factureId, line.customDuty || null])]);
const suggestionKey = item => JSON.stringify([item.lineId, item.description, item.categoryCode || '', item.destination]);

function ProposedTariff({ tariff, onUse, disabled }) {
  return <li className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="break-words text-sm font-semibold text-slate-800">{tariff.code} · {tariff.label}</p>
    <p className="text-sm text-slate-700">OM externe : {rate(tariff.baseRates?.om)} · OMR externe : {rate(tariff.baseRates?.omr)}</p>
    {tariff.matchReason && <p className="text-xs text-slate-600">{tariff.matchReason}</p>}
    {conditional(tariff) && <p className="break-words text-xs font-semibold text-amber-800">Conditions à vérifier : {text(tariff.conditions) || 'classement partiel « ex » — consultez la source.'}</p>}
    {(tariff.historical || tariff.source?.status === 'historical') && <p className="text-xs font-semibold text-amber-800">Source historique à vérifier.</p>}
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1"><button type="button" className={`${BUTTON} bg-white`} disabled={disabled} onClick={onUse} aria-label={`Utiliser la proposition ${tariff.code} — ${tariff.label}`}>Utiliser cette proposition</button><details className="min-w-0 flex-1"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-slate-600">Source et détails</summary><Source tariff={tariff} /></details></div>
  </li>;
}

function Source({ tariff }) {
  const source = tariff?.source;
  if (!source) return null;
  const date = source.date && Number.isFinite(Date.parse(source.date)) ? new Date(source.date).toLocaleDateString('fr-FR') : null;
  return <div className="space-y-1 text-xs text-slate-600">
    <p>Source : {source.label || 'Référentiel douanier'}{date ? ` · ${date}` : ' · date non renseignée'}{source.page != null ? ` · page ${source.page}` : ''}.</p>
    {/^https?:\/\//i.test(source.url || '') && <a className="inline-flex min-h-11 items-center underline" href={source.url} target="_blank" rel="noopener noreferrer">Consulter la source officielle</a>}
    {(tariff.historical || source.status === 'historical') && <p className="font-semibold text-amber-800">Source historique : vérifiez qu’elle s’applique à ce devis.</p>}
    {text(tariff.conditions) && <p className="font-semibold text-amber-800">Conditions d’application : {text(tariff.conditions)}</p>}
    {conditional(tariff) && !text(tariff.conditions) && <p className="font-semibold text-amber-800">Classement partiel « ex » : vérifiez les conditions de la source.</p>}
    {text(tariff.notes) && <p>{text(tariff.notes)}</p>}
  </div>;
}

/** Classification is saved on the quote's existing articles, never by editing
 * invoice descriptions or the shared tariff catalogue. */
export default function QuoteCustomsPanel({ colis, destination, onDirtyChange, onSaved }) {
  const { auth, can, ask, flash, categories = [], searchCustomsTariffs, suggestCustomsTariffs, saveQuoteCustoms, refreshColis } = useApp();
  const excluded = excludedInvoiceIds(colis.factures);
  const lines = (colis.lignes || []).filter(line => !line.factureId || !excluded.has(line.factureId));
  const key = `${auth?.u?.id}:${colis.id}`;
  const cached = cachedDrafts.get(key);
  const [drafts, setDrafts] = useState(() => cached?.drafts || {});
  const [activeId, setActiveId] = useState(() => cached?.activeId || null);
  const baseline = useRef(cached?.signature || signature(lines, destination));
  const version = useRef(cached?.version || colis.updatedAt);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const searchSequence = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(Boolean(cached && cached.version !== colis.updatedAt));
  const [suggestions, setSuggestions] = useState({});
  const suggestionState = useRef(suggestions); suggestionState.current = suggestions;
  const suggestionSequence = useRef(0);
  const suggestionRequests = useRef(new Map());
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const retryIds = useRef(new Set());
  const draftState = useRef(drafts); draftState.current = drafts;
  const feedback = useRef(null);
  const pendingIds = Object.keys(drafts);
  const dirty = pendingIds.length > 0 || activeId != null;
  const currentSignature = signature(lines, destination);
  const editable = can('perm_colis_calculer_devis') && ['en_preparation', 'devis_envoye', 'attente_paiement'].includes(colis.statut) && !colis.archive && !colis.paiementDate && colis.paiementMontant == null && colis.feuVert === 'autorise' && !colis.produitInterdit;
  const proposalContext = useRef(null); proposalContext.current = { lines, destination, editable };
  const mounted = useRef(true);
  const active = lines.find(line => line.id === activeId);
  const draft = active ? drafts[activeId] || seed(active) : null;
  // Description/category revisions trigger new suggestions; updating an
  // unrelated date or receiving a proposal must never mark the quote dirty.
  const suggestionItems = JSON.stringify(editable && destination === '974' ? lines.filter(line => !line.customDuty?.tariffId || line.customDuty.stale).map(line => ({ lineId: line.id, description: line.desc || '', categoryCode: categories.find(category => category.id === line.cat)?.codeHs || undefined, destination })) : []);
  const eligibleSuggestions = JSON.parse(suggestionItems).filter(item => !drafts[item.lineId]);
  const currentSuggestion = item => suggestions[item.lineId]?.key === suggestionKey(item) ? suggestions[item.lineId] : null;
  const failedSuggestions = eligibleSuggestions.filter(item => currentSuggestion(item)?.state === 'error');
  const loadingSuggestions = eligibleSuggestions.some(item => !currentSuggestion(item) || currentSuggestion(item).state === 'loading');

  useEffect(() => {
    const sequence = ++suggestionSequence.current;
    if (typeof suggestCustomsTariffs !== 'function') return;
    const pending = JSON.parse(suggestionItems).filter(item => {
      if (draftState.current[item.lineId]) return false;
      const previous = suggestionState.current[item.lineId];
      return !previous || previous.key !== suggestionKey(item) || previous.state === 'loading' || retryIds.current.has(item.lineId);
    });
    retryIds.current.clear();
    if (!pending.length) return;
    setSuggestions(previous => ({ ...previous, ...Object.fromEntries(pending.map(item => [item.lineId, { key: suggestionKey(item), state: 'loading', candidates: [] }])) }));
    (async () => {
      for (let offset = 0; offset < pending.length; offset += 50) {
        if (sequence !== suggestionSequence.current) return;
        const batch = pending.slice(offset, offset + 50);
        try {
          // Share the same in-flight read if React remounts this effect or the
          // eligible list changes while an identical batch is being fetched.
          const requestKey = JSON.stringify([destination, batch]);
          let request = suggestionRequests.current.get(requestKey);
          if (!request) {
            request = Promise.resolve().then(() => suggestCustomsTariffs(batch.map(({ lineId, description, categoryCode }) => ({ lineId, description, categoryCode })), destination)).finally(() => suggestionRequests.current.delete(requestKey));
            suggestionRequests.current.set(requestKey, request);
          }
          const response = await request;
          if (sequence !== suggestionSequence.current) return;
          if (!Array.isArray(response)) throw new Error('Les propositions reçues sont incomplètes.');
          setSuggestions(previous => ({ ...previous, ...Object.fromEntries(batch.map(item => {
            const result = response.find(row => row.lineId === item.lineId);
            const candidates = Array.isArray(result?.candidates) ? result.candidates.slice(0, 5) : null;
            return [item.lineId, { key: suggestionKey(item), state: candidates == null ? 'error' : candidates.length ? 'ready' : 'empty', candidates: candidates || [], notice: result?.notice || '' }];
          })) }));
        } catch {
          if (sequence !== suggestionSequence.current) return;
          // A provider error is not a no-match. Stop this series of calls and
          // leave retry explicit instead of repeating the failure per batch.
          setSuggestions(previous => ({ ...previous, ...Object.fromEntries(pending.slice(offset).map(item => [item.lineId, { key: suggestionKey(item), state: 'error', candidates: [] }])) }));
          return;
        }
      }
    })();
    return () => { suggestionSequence.current++; };
  }, [suggestionItems, destination, suggestCustomsTariffs, suggestionRetry]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    if (dirty) cachedDrafts.set(key, { drafts, activeId, signature: baseline.current, version: version.current });
    else cachedDrafts.delete(key);
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [key, dirty, drafts, activeId, onDirtyChange]);
  useEffect(() => {
    if (version.current === colis.updatedAt) return;
    if (dirty) { setConflict(true); return; }
    version.current = colis.updatedAt; baseline.current = currentSignature; setConflict(false);
  }, [colis.updatedAt, currentSignature, dirty]);
  useEffect(() => { searchSequence.current++; setQuery(''); setResults([]); setSearched(false); setSearching(false); }, [activeId]);
  useEffect(() => { if (error) { feedback.current?.scrollIntoView({ block: 'nearest' }); feedback.current?.focus({ preventScroll: true }); } }, [error]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; searchSequence.current++; }; }, []);

  const update = changes => { onDirtyChange?.(true); setDrafts(previous => ({ ...previous, [activeId]: { ...(previous[activeId] || seed(active)), ...changes } })); setError(''); setNotice(''); };
  function selectProposal(line, tariff) {
    // Background responses and proposals must never replace an operator's draft
    // or a confirmed classification. Only this explicit action chooses a code.
    if (!editable || busy || draftState.current[line.id] || line.customDuty?.tariffId && !line.customDuty.stale) return;
    const expected = signature([line], destination);
    const choose = () => {
      if (!mounted.current) return;
      const latest = proposalContext.current;
      const currentLine = latest.lines.find(item => item.id === line.id);
      if (!latest.editable || !currentLine || draftState.current[line.id] || signature([currentLine], latest.destination) !== expected) {
        setError('L’article ou sa destination a changé. Vérifiez les nouvelles propositions avant de choisir.');
        return;
      }
      onDirtyChange?.(true);
      setDrafts(current => ({ ...current, [line.id]: { tariff, manual: false, om: tariff.baseRates?.om ?? '', omr: tariff.baseRates?.omr ?? '', reason: '', acknowledged: false } }));
      setActiveId(line.id); setError(''); setNotice('');
      requestAnimationFrame(() => { const editor = document.getElementById(`customs-editor-${line.id}`); editor?.scrollIntoView({ block: 'nearest' }); editor?.focus({ preventScroll: true }); });
    };
    if (line.customDuty?.overrideReason) ask('Revoir les taux corrigés de cet article ?', 'Ce classement est à revoir. La nouvelle proposition utilisera les taux du référentiel ; vérifiez-les et corrigez-les si nécessaire. Vos anciens taux et leur motif restent enregistrés jusqu’à « Appliquer au devis ».', choose, { okLabel: 'Vérifier la nouvelle proposition' });
    else choose();
  }
  function proposalsFor(line, index) {
    const item = eligibleSuggestions.find(entry => entry.lineId === line.id);
    if (!item) return null;
    const proposal = currentSuggestion(item);
    if (!proposal || proposal.state === 'loading') return null;
    if (proposal.state === 'error') return <p className="mt-2 text-sm text-slate-600">Propositions indisponibles. Vous pouvez rechercher un code manuellement.</p>;
    if (proposal.state === 'empty') return <p className="mt-2 text-sm text-slate-600">{proposal.notice || 'Aucune correspondance suffisamment précise. Recherchez dans le catalogue.'}</p>;
    const [first, ...alternatives] = proposal.candidates;
    const candidate = tariff => <ProposedTariff key={tariff.tariffId} tariff={tariff} disabled={busy} onUse={() => selectProposal(line, tariff)} />;
    return <div className="mt-3 space-y-2" role="group" aria-label={`Propositions pour l’article ${index + 1}`}>
      <p className="text-xs font-semibold text-slate-600">À confirmer — vérifiez matière et usage.</p>
      {proposal.notice && !proposal.notice.startsWith('Vérifiez matière, usage et conditions') && <p className="text-xs text-slate-600">{proposal.notice}</p>}
      <ul className="space-y-2">{candidate(first)}</ul>
      {alternatives.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-700">{alternatives.length} autre(s) proposition(s) à comparer</summary><ul className="space-y-2">{alternatives.map(candidate)}</ul></details>}
    </div>;
  }
  async function search(event) {
    event.preventDefault();
    if (!editable || searching || !query.trim()) return;
    const sequence = ++searchSequence.current;
    setSearching(true); setSearched(false); setError('');
    try {
      const found = await searchCustomsTariffs(query.trim(), destination);
      if (sequence !== searchSequence.current) return;
      setResults(found || []); setSearched(true);
    } catch (failure) { if (sequence === searchSequence.current) setError(failure.message || 'Recherche indisponible. Réessayez.'); }
    finally { if (sequence === searchSequence.current) setSearching(false); }
  }
  function abandon() {
    const reset = () => { setDrafts({}); setActiveId(null); setError(''); setNotice('Saisie abandonnée. Le classement enregistré est conservé.'); version.current = colis.updatedAt; baseline.current = currentSignature; setConflict(false); cachedDrafts.delete(key); setSuggestionRetry(value => value + 1); };
    if (pendingIds.length) ask('Abandonner la saisie douanière ?', 'Seules vos modifications non enregistrées seront abandonnées. Les factures et le classement déjà enregistré sont conservés.', reset, { okLabel: 'Abandonner la saisie' });
    else reset();
  }
  async function save() {
    if (busyRef.current || !editable || conflict || !pendingIds.length) return;
    const changes = [];
    for (const id of pendingIds) {
      const item = drafts[id];
      let message = '';
      if (!lines.some(line => line.id === id)) message = 'Un article a changé ou a été retiré. Actualisez et comparez le dossier.';
      else if (!item.tariff?.tariffId) message = 'Choisissez un code douanier parmi les résultats.';
      else if (item.tariff.destination !== destination) message = 'Le classement choisi ne correspond pas à la destination du devis.';
      else if (needsAcknowledgement(item.tariff) && !item.acknowledged) message = 'Confirmez que vous avez vérifié les conditions et la source de ce classement.';
      else if (item.manual && (!finiteRate(item.om) || !finiteRate(item.omr))) message = 'Renseignez les deux taux OM et OMR, entre 0 et 100 %, avec au maximum quatre décimales.';
      else if (item.manual && (item.reason.trim().length < 3 || item.reason.trim().length > 500)) message = 'Précisez le motif de la correction (3 à 500 caractères). Il figurera dans le devis.';
      else if (!item.manual && (!finiteRate(item.tariff.baseRates?.om) || !finiteRate(item.tariff.baseRates?.omr))) message = 'Les taux de cette référence doivent être vérifiés. Saisissez les deux taux et leur motif pour ce devis.';
      if (message) { setActiveId(id); setError(message); return; }
      changes.push({ lineId: id, tariffId: item.tariff.tariffId, override: item.manual ? { om: Number(item.om), omr: Number(item.omr), reason: item.reason.trim() } : null });
    }
    const commit = async () => {
      if (busyRef.current) return;
      busyRef.current = true; setBusy(true); setError(''); setNotice('');
      try {
        const saved = await saveQuoteCustoms(colis.id, changes, { expectedUpdatedAt: version.current });
        if (!saved?.id) throw new Error('La sauvegarde n’a pas été confirmée. Actualisez avant de réessayer.');
        version.current = saved.updatedAt;
        const excludedSaved = excludedInvoiceIds(saved.factures);
        baseline.current = signature((saved.lignes || []).filter(line => !line.factureId || !excludedSaved.has(line.factureId)), destination);
        setDrafts({}); setActiveId(null); setConflict(false); cachedDrafts.delete(key);
        onDirtyChange?.(false); onSaved?.(saved);
        setNotice('Classement douanier enregistré. Vérifiez puis enregistrez le nouveau devis.');
        flash('Classement douanier enregistré. Aucun message envoyé au client.');
      } catch (failure) { setError(failure.message || 'Enregistrement impossible. Votre saisie est conservée.'); if (failure.code === '40001') setConflict(true); }
      finally { busyRef.current = false; setBusy(false); }
    };
    if (['devis_envoye', 'attente_paiement'].includes(colis.statut) && !colis.devisBrouillon) ask('Revoir le classement du devis envoyé ?', 'Le devis actuel et son lien de paiement seront retirés. Les factures restent validées. Vous devrez vérifier et envoyer une nouvelle version ; aucun message n’est envoyé maintenant.', commit, { okLabel: 'Retirer le devis et appliquer' });
    else await commit();
  }

  return <section id="quote-customs" aria-label="Classement douanier du devis" tabIndex={-1} className="min-w-0 scroll-mt-32 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><h3 className="text-base font-semibold text-slate-800">Classement douanier</h3><p className="mt-1 text-sm text-slate-600">{lines.filter(line => line.customDuty?.tariffId).length} / {lines.length} article(s) avec un code choisi · destination {destination}.</p><p className="mt-1 text-xs text-slate-600">Les taux sont appliqués à ce devis. Le libellé de la facture et le catalogue restent inchangés.</p></div>
    {!editable && <p className="text-sm text-slate-600">Consultation seule : la modification exige le droit de calcul du devis et un dossier préparé, autorisé et non réglé.</p>}
    {destination !== '974' && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Le catalogue de recherche disponible concerne la Réunion (974). Aucun barème douanier n’est chargé pour cette destination ; les taux des catégories déjà enregistrées restent utilisés tant qu’aucun classement spécifique n’est choisi.</p>}
    {eligibleSuggestions.length > 0 && <p className="text-xs text-slate-600">Propositions d’après le libellé des articles, sans enregistrement automatique. Les taux appliqués restent inchangés jusqu’à votre validation.</p>}
    {loadingSuggestions && <p role="status" className="text-sm text-slate-600">Recherche de propositions douanières… Vous pouvez continuer à consulter le devis.</p>}
    {failedSuggestions.length > 0 && <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>La recherche automatique est momentanément indisponible pour {failedSuggestions.length} article(s). Votre devis et vos saisies sont conservés.</p><button className={BUTTON} disabled={busy} onClick={() => { retryIds.current = new Set(failedSuggestions.map(item => item.lineId)); setSuggestionRetry(value => value + 1); }}>Réessayer les propositions</button></div>}
    {!lines.length && <p className="text-sm text-slate-600">Les articles apparaîtront après vérification des factures.</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {conflict && <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>Le dossier a changé. Votre saisie est conservée ; comparez le classement enregistré avant de poursuivre.</p><button className={BUTTON} disabled={busy} onClick={async () => { try { await refreshColis(colis.id); setNotice('Version du dossier actualisée. Votre saisie locale est conservée.'); } catch (failure) { setError(failure.message || 'Actualisation indisponible.'); } }}>Actualiser sans perdre ma saisie</button>{baseline.current === currentSignature && version.current !== colis.updatedAt && editable && <button className={BUTTON} disabled={busy} onClick={() => { version.current = colis.updatedAt; setConflict(false); setError(''); }}>Conserver ma saisie et réessayer</button>}</div>}
    <ul className="divide-y divide-slate-200">{lines.map((line, index) => <li key={line.id} className="min-w-0 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p title={line.desc} className="line-clamp-2 break-words text-sm font-semibold text-slate-800">{index + 1}. {line.desc}</p><p title={line.customDuty?.label} className="mt-1 line-clamp-2 break-words text-sm text-slate-600">{line.customDuty?.tariffId ? `${line.customDuty.code} · ${line.customDuty.label}` : 'Catégorie enregistrée · code douanier à préciser'}</p>{line.customDuty && <p className="mt-1 text-xs text-slate-600">Enregistré : OM {rate(line.customDuty.rates?.om)} · OMR {rate(line.customDuty.rates?.omr)}{line.customDuty.overrideReason ? ' · taux corrigés pour ce devis' : ''}</p>}{line.customDuty?.tariffId && activeId !== line.id && <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-slate-600">Source et justification</summary><p className="mb-2 break-words text-sm text-slate-700">{line.customDuty.code} · {line.customDuty.label}</p><Source tariff={line.customDuty} />{line.customDuty.overrideReason && <p className="text-sm text-slate-700">Motif au devis : {line.customDuty.overrideReason}</p>}</details>}{line.customDuty?.stale && <p className="text-xs font-semibold text-amber-800">Référence modifiée : vérifiez de nouveau ce classement.</p>}{drafts[line.id] && <p className="mt-1 text-xs font-semibold text-amber-800">Modification non enregistrée</p>}</div>{editable && <button className={`${BUTTON} shrink-0`} disabled={busy} aria-label={`Classer l’article ${index + 1}`} aria-expanded={activeId === line.id} onClick={() => { onDirtyChange?.(activeId !== line.id || pendingIds.length > 0); setActiveId(activeId === line.id ? null : line.id); setError(''); }}>Modifier</button>}</div>
      {proposalsFor(line, index)}
      {activeId === line.id && draft && <div id={`customs-editor-${line.id}`} tabIndex={-1} className="mt-3 scroll-mt-32 space-y-3 rounded-xl bg-slate-50 p-3">
        <form onSubmit={search} role="search" aria-label={`Rechercher un code pour l’article ${index + 1}`} className="space-y-2"><label className="block text-sm font-semibold text-slate-700">Code ou libellé douanier<input aria-label="Rechercher un code ou un libellé douanier" className={`${INPUT} mt-1`} value={query} onChange={event => setQuery(event.target.value)} disabled={busy || !editable} placeholder="Code, meuble, vêtement…" /></label><button className={BUTTON} disabled={busy || searching || !query.trim() || !editable}>{searching ? 'Recherche…' : 'Rechercher la nomenclature'}</button></form>
        {searched && <p role="status" className="text-sm text-slate-600">{results.length ? `${results.length} résultat(s). Choisissez celui qui correspond à l’article.` : 'Aucun résultat. Essayez un autre code ou un libellé plus court.'}</p>}
        {results.length > 0 && <ul aria-label="Résultats de nomenclature" className="max-h-80 space-y-2 overflow-y-auto">{results.map(tariff => <li key={tariff.tariffId} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3"><p className="break-words text-sm font-semibold text-slate-800">{tariff.code} · {tariff.label}</p><p className="text-sm text-slate-600">OM {rate(tariff.baseRates?.om)} · OMR {rate(tariff.baseRates?.omr)} · destination {tariff.destination}</p><Source tariff={tariff} /><button aria-label={`Choisir ${tariff.code} — ${tariff.label}`} className={BUTTON} disabled={busy || !editable} onClick={() => { update({ tariff, manual: false, om: tariff.baseRates?.om ?? '', omr: tariff.baseRates?.omr ?? '', reason: '', acknowledged: false }); setResults([]); setSearched(false); }}>Choisir {tariff.code}</button></li>)}</ul>}
        {draft.tariff && <div className="space-y-3 border-t border-slate-200 pt-3"><p className="break-words text-sm font-semibold text-slate-800">Choisi : {draft.tariff.code} · {draft.tariff.label}</p><Source tariff={draft.tariff} /><p className="text-sm text-slate-600">Référentiel : OM {rate(draft.tariff.baseRates?.om)} · OMR {rate(draft.tariff.baseRates?.omr)}</p>
          {needsAcknowledgement(draft.tariff) && <label className="flex min-h-11 items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={draft.acknowledged} disabled={busy || !editable} onChange={event => update({ acknowledged: event.target.checked })} />J’ai vérifié la source et les conditions d’application pour cet article.</label>}
          {!draft.manual ? <button className={BUTTON} disabled={busy || !editable} onClick={() => update({ manual: true })}>Corriger les taux pour ce devis</button> : <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">Correction limitée à ce devis</p><div className="grid grid-cols-2 gap-3">{[['om','OM (%)'],['omr','OMR (%)']].map(([field,label]) => <label key={field} className="text-sm font-semibold text-slate-700">{label}<input aria-label={`Taux ${label}`} type="number" inputMode="decimal" min="0" max="100" step="0.0001" className={`${INPUT} mt-1`} value={draft[field]} disabled={busy || !editable} onChange={event => update({ [field]: event.target.value })} /></label>)}</div><label className="block text-sm font-semibold text-slate-700">Motif de la correction<textarea aria-label="Motif de la correction douanière" rows={2} maxLength={500} className={`${INPUT} mt-1`} value={draft.reason} disabled={busy || !editable} onChange={event => update({ reason: event.target.value })} /></label><p className="text-xs text-slate-600">Indiquez une justification factuelle : ce motif sera visible dans le devis.</p><button className={BUTTON} disabled={busy || !editable} onClick={() => update({ manual: false, om: draft.tariff.baseRates?.om ?? '', omr: draft.tariff.baseRates?.omr ?? '', reason: '' })}>Reprendre les taux du référentiel</button></div>}
          {(!finiteRate(draft.tariff.baseRates?.om) || !finiteRate(draft.tariff.baseRates?.omr)) && !draft.manual && <p className="text-sm font-semibold text-amber-800">Les taux ne sont pas déterminés par cette référence. Vérifiez la source et renseignez les deux taux avant d’appliquer.</p>}
        </div>}
      </div>}
    </li>)}</ul>
    {error && <p ref={feedback} tabIndex={-1} role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {dirty && <div className="space-y-2 border-t border-slate-200 pt-3"><p className="text-sm text-slate-700">Terminez le classement avant d’enregistrer le devis. Aucun message ne sera envoyé.</p><div className="flex flex-wrap gap-2">{pendingIds.length > 0 && <button className={`${BUTTON} bg-slate-700 text-white`} disabled={busy || conflict || !editable} onClick={save}>{busy ? 'Enregistrement…' : 'Appliquer au devis'}</button>}<button className={BUTTON} disabled={busy} onClick={abandon}>{pendingIds.length ? 'Abandonner la saisie' : 'Fermer le classement'}</button></div></div>}
  </section>;
}

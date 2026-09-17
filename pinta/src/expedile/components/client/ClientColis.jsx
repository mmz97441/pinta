import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { clientWorkState } from '../../domain/clientJourney';
import ClientShipmentCard from './ClientShipmentCard';
const TABS = [['todo', 'À faire'], ['active', 'En cours'], ['history', 'Historique']];
const MORE = [['all', 'Tout'], ['team', 'Pris en charge'], ['waiting', 'Attente demandée']];
export default function ClientColis() {
  const navigate = useNavigate();
  const { authCl, data, colisFilter, setColisFilter, archivesLoaded, loadArchives } = useApp();
  const [query, setQuery] = useState('');
  const [archivesBusy, setArchivesBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const attempted = useRef(false);
  const tab = ({ a_traiter: 'todo', a_payer: 'payment' })[colisFilter] || colisFilter || 'active';
  const needsHistory = tab === 'history' || tab === 'all' || !!query.trim();
  const retrieve = async () => {
    if (archivesBusy) return;
    attempted.current = true; setArchivesBusy(true); setArchiveError('');
    try { await loadArchives(); }
    catch { setArchiveError('L’historique n’a pas pu être chargé. La recherche reste incomplète.'); }
    finally { setArchivesBusy(false); }
  };
  useEffect(() => { if (needsHistory && !archivesLoaded && !attempted.current) retrieve(); }, [needsHistory, archivesLoaded]);
  const myColis = authCl ? data.filter(p => p.clientId === authCl.id) : [];
  const matches = (p, key) => { const state = clientWorkState(p, authCl); return key === 'all' || (key === 'active' ? state.section !== 'history' : key === 'payment' ? state.section === 'todo' && ['devis_envoye','attente_paiement'].includes(p.statut) : state.section === key); };
  // An explicit search covers all accessible expeditions, including the history
  // loaded above. A retained tab must not hide an exact archived reference.
  const displayed = myColis.filter(p => (query.trim() || matches(p, tab)) && (!query.trim() || `${p.ref} ${p.desc} ${(p.trackings || []).join(' ')}`.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')))).sort((a,b) => (Date.parse(b.updatedAt || b.dateReception) || 0) - (Date.parse(a.updatedAt || a.dateReception) || 0));
  const tabButton = ([key,label]) => <button key={key} aria-pressed={key === tab} onClick={() => setColisFilter(key)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${key === tab ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{label} <span className="ml-1">{key === 'history' && !archivesLoaded ? '…' : myColis.filter(p => matches(p,key)).length}</span></button>;
  return <div className="anim-fade space-y-4"><header><h1 className="text-xl font-bold text-slate-900">Mes expéditions</h1><p className="mt-1 text-sm text-slate-600">Une référence EXP regroupe tous les cartons de votre expédition.</p></header>
    <nav aria-label="Filtrer mes expéditions" className="flex flex-wrap gap-2">{TABS.map(tabButton)}</nav>
    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-slate-500"><Search size={17} /><input type="search" aria-label="Rechercher une expédition" value={query} onChange={event => setQuery(event.target.value)} placeholder="Référence, achat, numéro de suivi…" className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none" /></label>
    <details open={MORE.some(([key]) => key === tab) || undefined}><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Autres filtres{MORE.find(([key]) => key === tab) ? ` · ${MORE.find(([key]) => key === tab)[1]}` : ''}</summary><div className="flex flex-wrap gap-2">{MORE.map(tabButton)}</div></details>
    <p role="status" className="text-sm text-slate-500">{needsHistory && !archivesLoaded ? 'Recherche dans vos expéditions et votre historique…' : `${displayed.length} expédition${displayed.length > 1 ? 's' : ''} affichée${displayed.length > 1 ? 's' : ''}${query.trim() ? ' · Tous les dossiers' : ''}`}</p>
    {archiveError && <div role="alert" className="text-sm text-red-700"><p>{archiveError}</p><button onClick={retrieve} disabled={archivesBusy} className="min-h-11 underline">Réessayer le chargement de l’historique</button></div>}
    {displayed.length ? <div className="grid gap-3 md:grid-cols-2">{displayed.map(colis => <ClientShipmentCard key={colis.id} colis={colis} client={authCl} onOpen={() => navigate(`/colis/${colis.id}`)} />)}</div> : !(needsHistory && !archivesLoaded) && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">Aucune expédition ne correspond à cette vue.</p>}
  </div>;
}

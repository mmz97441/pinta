import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { clientWorkState } from '../../domain/clientJourney';
import ClientShipmentCard from './ClientShipmentCard';
const TABS = [['active', 'En cours'], ['todo', 'À faire par vous'], ['team', 'Pris en charge'], ['waiting', 'Attente demandée'], ['history', 'Historique'], ['all', 'Tout']];
export default function ClientColis() {
  const navigate = useNavigate();
  const { authCl, data, colisFilter, setColisFilter, archivesLoaded, loadArchives, flash } = useApp();
  const [query, setQuery] = useState('');
  const [archivesBusy, setArchivesBusy] = useState(false);
  const tab = ({ a_traiter: 'todo', a_payer: 'payment' })[colisFilter] || colisFilter || 'active';
  const myColis = authCl ? data.filter(p => p.clientId === authCl.id) : [];
  const matches = (p, key) => { const state = clientWorkState(p, authCl); return key === 'all' || (key === 'active' ? state.section !== 'history' : key === 'payment' ? state.section === 'todo' && ['devis_envoye','attente_paiement'].includes(p.statut) : state.section === key); };
  const displayed = myColis.filter(p => matches(p, tab) && (!query.trim() || `${p.ref} ${p.desc} ${(p.trackings || []).join(' ')}`.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')))).sort((a,b) => (Date.parse(b.updatedAt || b.dateReception) || 0) - (Date.parse(a.updatedAt || a.dateReception) || 0));
  return <div className="anim-fade space-y-4"><header><h1 className="text-xl font-bold text-slate-900">Mes expéditions</h1><p className="mt-1 text-sm text-slate-600">Une référence EXP regroupe tous les cartons de votre dossier.</p></header>
    <nav aria-label="Filtrer mes expéditions" className="flex flex-wrap gap-2">{TABS.map(([key,label]) => <button key={key} aria-pressed={key === tab} onClick={() => setColisFilter(key)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${key === tab ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{label} <span className="ml-1">{myColis.filter(p => matches(p,key)).length}</span></button>)}</nav>
    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-slate-500"><Search size={17} /><input type="search" aria-label="Rechercher une expédition" value={query} onChange={event => setQuery(event.target.value)} placeholder="Référence, achat, numéro de suivi…" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    <p role="status" className="text-xs text-slate-500">{displayed.length} expédition{displayed.length > 1 ? 's' : ''} affichée{displayed.length > 1 ? 's' : ''}</p>
    {displayed.length ? <div className="grid gap-3 md:grid-cols-2">{displayed.map(colis => <ClientShipmentCard key={colis.id} colis={colis} client={authCl} onOpen={() => navigate(`/colis/${colis.id}`)} />)}</div> : <p className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">Aucune expédition ne correspond à cette vue.</p>}
    {!archivesLoaded && <button disabled={archivesBusy} onClick={async () => { setArchivesBusy(true); try { await loadArchives(); } catch (error) { flash({ msg: 'Historique indisponible. ' + error.message, type: 'error' }); } finally { setArchivesBusy(false); } }} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold brand-t">{archivesBusy ? 'Chargement de l’historique…' : 'Charger mes anciens dossiers archivés'}</button>}
  </div>;
}

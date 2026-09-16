import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, Package, History } from 'lucide-react';
import { clientWorkState } from '../../domain/clientJourney';
import { useApp } from '../../context/AppContext';
import { ABONNEMENTS, getDestByCP } from '../../constants';
import { getPrenom } from '../../utils';
import ClientShipmentCard from './ClientShipmentCard';

const SECTIONS = [
  ['todo', 'À faire par vous', 'Votre accord, vos documents ou votre règlement permettent de faire avancer ces dossiers.', CheckCircle],
  ['team', 'Nous nous en occupons', 'Suivez la préparation et l’acheminement. La prochaine action est prise en charge.', Package],
  ['waiting', 'En attente à votre demande', 'Votre pause reste enregistrée. Vous pourrez autoriser la préparation lorsque vous serez prêt.', Clock],
  ['history', 'Historique', 'Retrouvez vos dernières expéditions terminées.', History],
];
export default function ClientAccueil() {
  const navigate = useNavigate();
  const { authCl, data, setColisFilter } = useApp();
  const myColis = authCl ? data.filter(p => p.clientId === authCl.id) : [];
  const grouped = Object.fromEntries(SECTIONS.map(([key]) => [key, myColis.filter(p => clientWorkState(p, authCl).section === key).sort((a,b) => (Date.parse(b.updatedAt || b.dateReception) || 0) - (Date.parse(a.updatedAt || a.dateReception) || 0))]));
  const destination = getDestByCP(authCl?.cp);
  const daysLeft = authCl?.abonnementFin ? Math.ceil((Date.parse(authCl.abonnementFin) - Date.now()) / 86400000) : null;
  return <div className="anim-fade space-y-6">
    <header className="border-b border-slate-200 pb-4"><p className="text-sm text-slate-500">Mon espace Expedîle{destination ? ` · ${destination.nom}` : ''}</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Bonjour {getPrenom(authCl) || 'Client'}</h1><p className="mt-2 text-sm text-slate-600">{grouped.todo.length ? `${grouped.todo.length} expédition${grouped.todo.length > 1 ? 's attendent' : ' attend'} une action de votre part.` : 'Aucune action attendue de votre part.'}</p></header>
    {authCl?.abonnement && authCl.abonnement !== 'freemium' && daysLeft != null && daysLeft <= 30 && <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Votre abonnement {ABONNEMENTS[authCl.abonnement]?.label} {daysLeft <= 0 ? 'a expiré' : `expire dans ${daysLeft} jours`}. Contactez l’équipe pour son renouvellement.</aside>}
    {SECTIONS.filter(([key]) => key === 'todo' || grouped[key].length > 0).map(([key, title, description, Icon]) => <section key={key} aria-labelledby={`client-home-${key}`} className="space-y-3"><div className="flex items-center gap-2"><Icon size={18} className="text-slate-600" /><h2 id={`client-home-${key}`} className="text-base font-bold text-slate-900">{title}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{grouped[key].length} expédition{grouped[key].length > 1 ? 's' : ''}</span></div><p className="sr-only">{description}</p>{grouped[key].length ? <div className="grid gap-3 md:grid-cols-2">{grouped[key].slice(0, key === 'history' ? 2 : 6).map(colis => <ClientShipmentCard key={colis.id} colis={colis} client={authCl} onOpen={() => navigate(`/colis/${colis.id}`)} />)}</div> : <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{key === 'todo' ? 'Vous êtes à jour.' : 'Aucune expédition dans cette rubrique.'}</p>}{(grouped[key].length > (key === 'history' ? 2 : 6) || key === 'history') && <button className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold brand-t" onClick={() => { setColisFilter(key); navigate('/colis'); }}>Voir {key === 'history' ? 'tout mon historique' : 'toutes ces expéditions'}</button>}</section>)}
  </div>;
}

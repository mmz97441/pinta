import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, Package, History } from 'lucide-react';
import { clientWorkState, clientShipmentPath } from '../../domain/clientJourney';
import { useApp } from '../../context/AppContext';
import { ABONNEMENTS, getDestByCP } from '../../constants';
import { getPrenom } from '../../utils';
import { plural } from '../../domain/plural';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import ClientShipmentCard from './ClientShipmentCard';
import { ClientDossiersError, useClientDossiers } from './ClientPortalStates';

const SECTIONS = [
  ['todo', 'À faire par vous', 'Votre accord, vos documents ou votre règlement permettent de faire avancer ces expéditions.', CheckCircle],
  ['team', 'Nous nous en occupons', 'Suivez la préparation et l’acheminement. La prochaine action est prise en charge.', Package],
  ['waiting', 'En attente à votre demande', 'Votre pause reste enregistrée. Vous pourrez autoriser la préparation lorsque vous serez prêt.', Clock],
  ['history', 'Historique', 'Retrouvez vos dernières expéditions terminées.', History],
];
export default function ClientAccueil() {
  const navigate = useNavigate();
  const { authCl, data, setColisFilter } = useApp();
  const { failed } = useClientDossiers();
  useDocumentTitle('Mon espace');
  const myColis = authCl ? data.filter(p => p.clientId === authCl.id) : [];
  const grouped = Object.fromEntries(SECTIONS.map(([key]) => [key, myColis.filter(p => clientWorkState(p, authCl).section === key).sort((a,b) => (Date.parse(b.updatedAt || b.dateReception) || 0) - (Date.parse(a.updatedAt || a.dateReception) || 0))]));
  const destination = getDestByCP(authCl?.cp);
  const daysLeft = authCl?.abonnementFin ? Math.ceil((Date.parse(authCl.abonnementFin) - Date.now()) / 86400000) : null;
  const todo = grouped.todo.length;
  const summary = failed ? 'Vos expéditions s’afficheront ici dès que possible.'
    : todo ? `${plural(todo, 'expédition')} ${todo > 1 ? 'attendent' : 'attend'} une action de votre part.`
    : 'Aucune action attendue de votre part.';
  return <div className="anim-fade space-y-6">
    <header className="border-b border-slate-200 pb-4"><p className="text-sm text-slate-500">Mon espace Expedîle{destination ? ` · ${destination.nom}` : ''}</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Bonjour {getPrenom(authCl) || 'et bienvenue'}</h1><p className="mt-2 text-sm text-slate-600">{summary}</p></header>
    {authCl?.abonnement && authCl.abonnement !== 'freemium' && daysLeft != null && daysLeft <= 30 && <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Votre abonnement {ABONNEMENTS[authCl.abonnement]?.label} {daysLeft <= 0 ? 'a expiré' : `expire dans ${plural(daysLeft, 'jour')}`}. Contactez l’équipe pour son renouvellement.</aside>}
    {failed ? <ClientDossiersError /> : <>
      {myColis.length === 0 && <section className="rounded-xl border border-slate-200 p-4 space-y-2"><h2 className="font-bold text-slate-800">Préparer ma première expédition</h2><p className="text-sm text-slate-600">Demandez l’adresse et les consignes de réception avant vos achats. Votre expédition apparaîtra ici quand l’équipe aura enregistré vos cartons.</p><a href="mailto:contact@expedile.fr?subject=Ma%20premi%C3%A8re%20exp%C3%A9dition" className="inline-flex min-h-11 items-center text-sm font-semibold underline">Obtenir les consignes de réception</a></section>}
      {SECTIONS.filter(([key]) => (key === 'todo' && myColis.length > 0) || grouped[key].length > 0).map(([key, title, description, Icon]) => <section key={key} aria-labelledby={`client-home-${key}`} className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Icon size={18} className="text-slate-600" aria-hidden="true" /><h2 id={`client-home-${key}`} className="text-base font-bold text-slate-900">{title}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">{plural(grouped[key].length, 'expédition')}</span></div><p className="sr-only">{description}</p>{grouped[key].length ? <div className="grid items-stretch gap-3 md:grid-cols-2">{grouped[key].slice(0, key === 'history' ? 2 : 6).map(colis => <ClientShipmentCard key={colis.id} colis={colis} client={authCl} onOpen={() => navigate(clientShipmentPath(colis, authCl))} />)}</div> : <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-600">{key === 'todo' ? 'Vous êtes à jour. Nous vous prévenons dès qu’une action vous est demandée.' : 'Aucune expédition dans cette rubrique.'}</p>}{(grouped[key].length > (key === 'history' ? 2 : 6) || key === 'history') && <button className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold brand-t transition-all duration-200 ease-out hover:bg-slate-50 active:scale-[0.98]" onClick={() => { setColisFilter(key); navigate('/colis'); }}>Voir {key === 'history' ? 'tout mon historique' : 'toutes ces expéditions'}</button>}</section>)}
    </>}
  </div>;
}

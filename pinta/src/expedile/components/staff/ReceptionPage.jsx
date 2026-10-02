import React from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { safeWorkReturn } from '../../domain/personalWork';
import ColisModal from '../ColisModal';

/** One reception workspace, reusing the same validation and save path as the dialog. */
export default function ReceptionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { isStaff, can, data, clients, dataLoading } = useApp();
  const query = new URLSearchParams(location.search);
  const dossierId = query.get('dossier') || undefined;
  const clientId = query.get('client') || undefined;
  const returnTo = safeWorkReturn(query.get('returnTo'), '/colis');
  const leave = () => navigate(returnTo === '/reception' || returnTo.startsWith('/reception?') ? '/colis' : returnTo);
  const unavailable = dossierId && !data.some(item => item.id === dossierId) || clientId && !clients.some(item => item.id === clientId);
  if (!isStaff || !can('perm_colis_receptionner')) return <section className="p-6 space-y-4"><h1 className="text-xl font-bold">Réception non autorisée</h1><p>Un responsable peut vous donner accès à la réception.</p><button type="button" className="min-h-11 underline" onClick={leave}>Retour à ma liste</button></section>;
  if (dataLoading) return <p role="status" className="p-6">Chargement de la réception…</p>;
  if (unavailable) return <section className="p-6 space-y-4"><h1 className="text-xl font-bold">Dossier ou client introuvable</h1><p>Il n’est plus disponible ou vous n’avez pas accès à ce dossier.</p><button type="button" className="min-h-11 underline" onClick={() => navigate('/reception')}>Rechercher un client</button><button type="button" className="min-h-11 px-4 underline" onClick={leave}>Retour à ma liste</button></section>;
  return <ColisModal key={dossierId || clientId || 'new'} open fullPage startAppend={Boolean(dossierId && navigationType === 'PUSH')} onClose={leave} initialColisId={dossierId} initialClientId={clientId} />;
}

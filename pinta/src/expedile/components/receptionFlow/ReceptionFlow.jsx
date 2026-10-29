import React, { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { workspaceReturnPath } from '../../domain/navigation';
import { receptionTarget } from '../../domain/brouillon';
import { receptionAppendBlockReason, receptionAppendImpact } from '../../domain/reception';
import { StepHeader, Note } from './ReceptionParts';
import ClientStep from './ClientStep';
import CartonsStep from './CartonsStep';
import RangementStep from './RangementStep';
import { useReceptionSession, useReceptionStart } from './useReceptionSession';
import './receptionFlow.css';

// « Réceptionner des cartons » (docs/specification-brouillon-reception-2026-10-28.md, « Réception »), in three steps
// whose address is the state: /recevoir (1 · client), ?client=<id> or ?dossier=<id> (2 · cartons: add them one after
// the other, then validate them together on the same screen; ?valider=1 opens it to validate), ?client=<id>&valide=
// <validation> (3 · rangement). What is typed or saved meanwhile lives in the tab's session (useReceptionSession): a
// reload, or a tablet switched off and on, finds the reception where it was.
const TITLES = { client: 'Réceptionner des cartons', carton: 'Réception · cartons', done: 'Réception validée' };

/** The address of a step, keeping the way back (returnTo) of the page that opened the reception. */
function flowHref(search, params) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
  const returnTo = new URLSearchParams(search).get('returnTo');
  if (returnTo) next.set('returnTo', returnTo);
  const query = next.toString();
  return `/recevoir${query ? `?${query}` : ''}`;
}

/** Where the carton goes: a dossier chosen by its address, the brouillon of this reception, else receptionTarget. */
function cartonTarget({ clientId, data, paramDossier, session }) {
  const explicit = dossier => ({ mode: 'append', dossier, explicit: true, label: 'Le carton rejoint ce dossier',
    blockedReason: receptionAppendBlockReason(dossier) || null, impact: receptionAppendImpact(dossier) || null });
  if (session.intent?.kind === 'create') return { mode: 'new', dossier: null, label: 'Nouveau brouillon', detail: 'Aucun dossier ouvert', blockedReason: null };
  if (session.intent?.kind === 'append') {
    const dossier = data.find(item => item.id === session.intent.dossierId);
    if (dossier) return { ...explicit(dossier), blockedReason: null };
  }
  if (paramDossier) return explicit(paramDossier);
  const current = session.saved.length && session.target?.dossierId ? data.find(item => item.id === session.target.dossierId) : null;
  if (current && !receptionAppendBlockReason(current)) return { mode: 'append', dossier: current, label: 'Le carton rejoint son brouillon', impact: receptionAppendImpact(current) || null, blockedReason: null };
  return receptionTarget(clientId, data);
}

function Unavailable({ title, children, onSearch, onClose }) {
  return <div className="rf mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
    <h1 className="rf-strong text-[26px] font-extrabold">{title}</h1>
    <Note tone="warning" role="alert">{children}</Note>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={onSearch} className="rf-secondary px-5">Rechercher un client</button>
      <button type="button" onClick={onClose} className="rf-quiet">Retour aux colis</button>
    </div>
  </div>;
}

export default function ReceptionFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, clients } = useApp();
  const params = new URLSearchParams(location.search);
  const dossierId = params.get('dossier');
  const paramDossier = dossierId ? data.find(item => item.id === dossierId) || null : null;
  const clientId = paramDossier?.clientId || params.get('client') || null;
  const client = clientId ? clients.find(item => item.id === clientId) || null : null;
  const validationId = params.get('valide');
  const step = !clientId ? 'client' : validationId ? 'done' : 'carton';
  const validating = params.get('valider') === '1';
  useDocumentTitle(TITLES[step]);

  const { session, update, clear, storageAvailable } = useReceptionSession(client ? client.id : null);
  const { start, update: updateStart, clear: clearStart } = useReceptionStart();
  const go = useCallback((next, options) => navigate(flowHref(location.search, next), options), [navigate, location.search]);
  const close = () => navigate(workspaceReturnPath(location.search, '/'));

  // Each step starts at the top of the page. (A validated reception leaves nothing behind it in the session but its
  // result: its cartons, target and consent notes are cleared when it is recorded, so the next carton starts anew.)
  useEffect(() => { document.querySelector('main.staff-main')?.scrollTo?.({ top: 0 }); }, [step, clientId]);

  if (dossierId && !paramDossier) return <Unavailable title="Dossier introuvable" onSearch={() => go({})} onClose={close}>
    Ce dossier n’est plus disponible, ou vous n’y avez pas accès. Recherchez le client pour réceptionner son carton.
  </Unavailable>;
  if (clientId && !client) return <Unavailable title="Client introuvable" onSearch={() => go({})} onClose={close}>
    Ce client n’est plus disponible, ou vous n’y avez pas accès. Recherchez-le à nouveau.
  </Unavailable>;

  const target = step === 'carton' ? cartonTarget({ clientId, data, paramDossier, session }) : null;
  const next = () => { clear(); clearStart(); go({}); };
  const brouillon = () => { clear(); navigate('/'); };

  return <div className="rf min-h-full">
    <StepHeader step={step} onClose={close} />
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:px-6">
      {client && !storageAvailable && <p role="status" className="rf-muted mb-3 text-[15px] font-semibold">Le navigateur ne conserve pas la saisie : gardez cet onglet ouvert jusqu’à la validation.</p>}
      {step === 'client' && <ClientStep start={start} updateStart={updateStart} onChoose={id => go({ client: id })} />}
      {step === 'carton' && <CartonsStep key={client.id} client={client} target={target} session={session} update={update} validating={validating}
        onValidated={id => go({ client: client.id, valide: id }, { replace: true })} onChooseTarget={() => go({ client: client.id })} onChangeClient={() => go({})} />}
      {step === 'done' && <RangementStep key={validationId} client={client} session={session} update={update} validationId={validationId} onNext={next} onBrouillon={brouillon}
        onValidateRest={() => go({ client: client.id, valider: '1' })} />}
    </div>
  </div>;
}

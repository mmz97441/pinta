import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchArrivalNotices } from '../../lib/receptionValidation';
import { receptionCartonManifest } from '../../domain/reception';
import { colisStage } from '../../domain/brouillon';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { CONVERSATION_PERMISSIONS, FlaggedCartons, Note, SkeletonRows } from './ReceptionParts';
import { NoticeCard } from './NoticeStatus';
import { count, firstName, readableError } from './receptionFlowModel';

// Step 3, « Rangement »: the locker in very large, the cartons of the brouillon, the state of the arrival notice and,
// when the client had already agreed (or been asked), the reminder that the agreement is to be asked again.

function consentReminder(kind, name, before, added, stageLabel) {
  const news = added > 1 ? `ces ${added} nouveaux cartons` : 'ce nouveau carton';
  const line = stageLabel ? ` : sa ligne passe à « ${stageLabel} » dans le Brouillon` : '';
  if (kind === 'accord') return `${name} avait donné son accord pour ${count(before, 'carton')}. Pour ${news}, son accord est à redemander${line}.`;
  if (kind === 'devis') return `Le devis de ${name} portait sur ${count(before, 'carton')}. Avec ${news}, l’accord est à redemander et le devis sera à refaire${line}.`;
  return `L’accord de ${name} avait été demandé pour ${count(before, 'carton')}. Avec ${news}, il est à redemander${line}.`;
}

export default function RangementStep({ client, session, update, validationId, onNext, onBrouillon, onValidateRest }) {
  const { data, envois, settings, can } = useApp();
  const done = session.done?.validationId === validationId ? session.done : null;
  const [notice, setNotice] = useState(done?.notice || null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const headingRef = useRef(null);
  const name = firstName(client);
  const fullName = [client.prenom, client.nomFamille].filter(Boolean).join(' ') || client.nom;
  const here = `/recevoir?${new URLSearchParams({ client: client.id, valide: validationId })}`;

  // The notice as the server has it now (an e-mail to send, a Telegram message confirmed meanwhile…). An answer
  // arriving after « Client suivant » writes nothing: that reception's session is over.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const found = (await fetchArrivalNotices({ clientId: client.id, limit: 50 })).find(item => item.id === validationId) || null;
      if (!mounted.current) return;
      if (found) {
        setNotice(found);
        update(previous => previous.done?.validationId === validationId ? { done: { ...previous.done, notice: found } } : {});
      } else setLoadError('Cette réception validée n’apparaît pas parmi les derniers avis du client. Retrouvez-la dans « Avis d’arrivée ».');
    } catch (error) {
      if (mounted.current) setLoadError(readableError(error, 'L’état de l’avis n’a pas pu être lu. Vérifiez la connexion, puis touchez « Réessayer ».', 'Réception · avis'));
    } finally { if (mounted.current) setLoading(false); }
  }, [client.id, validationId, update]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const items = notice?.items || [];
  const validated = Array.isArray(notice?.cartons) ? notice.cartons.length : 0;
  const dossiers = items.map(item => data.find(row => row.id === item.colisId)).filter(Boolean);
  const total = dossiers.reduce((sum, dossier) => sum + receptionCartonManifest(dossier).nbColis, 0);
  const lockers = dossiers.map(dossier => ({ dossier, casier: String(dossier.casier || '').trim() }));
  const casiers = [...new Set(lockers.map(item => item.casier).filter(Boolean))];
  const consent = done?.consent || {};
  const reminders = dossiers.filter(dossier => consent[dossier.id]).map(dossier => {
    const { kind, cartons: before } = consent[dossier.id];
    const stage = colisStage(dossier, { client, envois, settings, pending: [], can, now: Date.now() });
    return { id: dossier.id, text: consentReminder(kind, name, before, Math.max(1, receptionCartonManifest(dossier).nbColis - before), stage?.label) };
  });

  if (!notice) return <section aria-labelledby="rf-step-title" className="mx-auto w-full max-w-3xl space-y-4">
    <h2 id="rf-step-title" ref={headingRef} tabIndex={-1} className="rf-strong text-[26px] font-extrabold outline-none">Réception validée</h2>
    {loading && <SkeletonRows rows={2} label="Lecture de l’avis d’arrivée…" />}
    {loadError && <Note tone="warning" role="alert" action={<><button type="button" className="rf-small-action" onClick={refresh}>Réessayer</button><Link className="rf-small-action inline-flex items-center" to="/avis">Ouvrir Avis d’arrivée</Link></>}>{loadError}</Note>}
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" onClick={onNext} className="rf-primary brand-bg flex items-center justify-center gap-2.5 px-4"><Plus size={22} aria-hidden="true" />Client suivant</button>
      <button type="button" onClick={onBrouillon} className="rf-secondary px-4">Voir le Brouillon</button>
    </div>
  </section>;

  const heading = dossiers.length > 1 || items.length > 1
    ? `Réception validée : ${count(validated, 'colis', 'colis')} pour ${fullName}`
    : `Réception validée : ${count(validated, 'colis', 'colis')} ${validated > 1 ? 'ajoutés' : 'ajouté'} au brouillon de ${fullName}`;

  return <section aria-labelledby="rf-step-title" className="mx-auto w-full max-w-3xl space-y-4">
    <div className="flex items-center gap-4">
      <span className="rf-pill--done inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full" aria-hidden="true"><CheckCircle2 size={30} /></span>
      <h2 id="rf-step-title" ref={headingRef} tabIndex={-1} className="rf-strong text-[24px] font-extrabold leading-tight outline-none sm:text-[26px]">{heading}</h2>
    </div>

    <div className="rf-casier flex flex-col items-center gap-1 px-5 pb-5 pt-4 text-center">
      <p className="rf-muted text-[19px] font-bold">{casiers.length > 1 ? 'Rangez-les dans leurs casiers' : validated > 1 ? 'Rangez-les dans le casier' : 'Rangez-le dans le casier'}</p>
      {casiers.length === 1 && <p className="rf-casier-value text-[64px] sm:text-[96px]">{casiers[0]}</p>}
      {casiers.length > 1 && <ul className="w-full space-y-2">{lockers.filter(item => item.casier).map(item => <li key={item.dossier.id} className="flex flex-wrap items-baseline justify-center gap-x-4">
        <span className="rf-casier-value text-[44px] sm:text-[56px]">{item.casier}</span><span className="text-[17px]"><span className="rf-code whitespace-nowrap">{item.dossier.ref}</span> · {count(receptionCartonManifest(item.dossier).nbColis, 'carton')}</span>
      </li>)}</ul>}
      {!casiers.length && <>
        <p className="rf-casier-value text-[32px]">Casier à renseigner</p>
        {dossiers[0] && <Link className="rf-strong inline-flex min-h-11 items-center text-[16px] font-bold underline underline-offset-4" to={dossierTaskUrl(dossiers[0].id, 'reception', `?${new URLSearchParams({ returnTo: '/' })}`)}>Indiquer le casier dans le dossier</Link>}
      </>}
      {dossiers.length > 0 && <p className="text-[18px]">{dossiers.length > 1 ? `Brouillons de ${name}` : `Brouillon de ${name}`} : <strong>{count(total, 'carton')}</strong>{total > validated ? `, dont ${validated} de cette réception` : ''}</p>}
    </div>

    <NoticeCard notice={notice} client={client} delivery={done?.delivery} onChanged={refresh} onRefresh={refresh} refreshing={loading} />
    <FlaggedCartons flagged={done?.flagged} name={name} title={`Pensez à prévenir ${name}`} returnTo={here} canOpen={CONVERSATION_PERMISSIONS.some(can)} notice={notice.notify !== false} />
    {reminders.map(item => <Note key={item.id} tone="warning" role="note">{item.text}</Note>)}
    {done?.rest > 0 && <Note tone="warning" title={`Encore ${count(done.rest, 'carton')} de ${name} à valider`}
      action={<button type="button" className="rf-small-action" onClick={onValidateRest}>Valider les cartons restants</button>}>
      Ils attendent leur validation{notice.notify !== false ? ', avec leur propre avis d’arrivée' : ''}.
    </Note>}

    <div className="grid gap-3 pt-1 sm:grid-cols-2">
      <button type="button" onClick={onNext} className="rf-primary brand-bg flex items-center justify-center gap-2.5 px-4"><Plus size={22} aria-hidden="true" />Client suivant</button>
      <button type="button" onClick={onBrouillon} className="rf-secondary px-4">Voir le Brouillon</button>
    </div>
  </section>;
}

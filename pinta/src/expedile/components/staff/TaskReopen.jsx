import React, { useEffect, useRef, useState } from 'react';
import { revisionHasQuote, revisionLockedReason } from '../../domain/shipmentRevision';

/** Reopening is an explicit business action; browsing past steps never calls it. */
export default function TaskReopen({ colis, task, canEdit, onSave, onReload, autoOpen = false, onAutoOpen }) {
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const confirmation = useRef(null);
  const autoOpenHandled = useRef(null);
  const consent = task === 'accord';
  const paymentRecorded = Boolean(colis.paiementDate) || colis.paiementMontant != null || colis.statut === 'paye';
  const blocked = paymentRecorded ? consent ? 'Le paiement est enregistré. Cette étape reste consultable.'
    : 'Paiement enregistré : le devis et les taux OM / OMR sont verrouillés. Vous pouvez les consulter.'
    : revisionLockedReason(colis, 'reception');
  const stale = expectedUpdatedAt && expectedUpdatedAt !== colis.updatedAt;
  const button = 'min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40';
  useEffect(() => {
    if (!autoOpen) { autoOpenHandled.current = null; return; }
    const key = `${colis.id}:${task}`;
    if (autoOpenHandled.current === key) return;
    autoOpenHandled.current = key;
    if (canEdit && !blocked && !expectedUpdatedAt) { setExpectedUpdatedAt(colis.updatedAt); setError(''); }
    // The caller removes its URL intent after consumption. Cancelling or a
    // colleague's later update must never reopen this confirmation by itself.
    onAutoOpen?.();
  }, [autoOpen, colis.id, colis.updatedAt, task, canEdit, blocked, expectedUpdatedAt, onAutoOpen]);
  useEffect(() => {
    if (!expectedUpdatedAt) return;
    const frame = requestAnimationFrame(() => { confirmation.current?.scrollIntoView({ block: 'nearest' }); confirmation.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [expectedUpdatedAt]);
  async function save() {
    if (lock.current || stale || blocked || !canEdit) return;
    lock.current = true; setBusy(true); setError('');
    try { await onSave(task, expectedUpdatedAt); setExpectedUpdatedAt(null); }
    catch (failure) { setError(failure.message || 'La reprise n’a pas été enregistrée. Réessayez.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { const fresh = await onReload(); setExpectedUpdatedAt(fresh.updatedAt); setError(''); }
    catch { setError('Le dossier n’a pas pu être rechargé. Réessayez.'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (blocked) return <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{blocked.replace('Les mesures sont en lecture seule.', 'Cette étape reste consultable.').replace('Ses mesures restent consultables.', 'Cette étape reste consultable.')}</p>;
  if (!canEdit) return <p className="text-sm text-slate-600">Une personne autorisée à corriger ce dossier peut reprendre cette étape.</p>;
  return <section id={consent ? 'agreement-reopen' : 'quote-reopen'} aria-label={consent ? 'Nouvelle demande d’accord' : 'Reprise du devis'} className="scroll-mt-4 space-y-3">
    {!expectedUpdatedAt ? <button type="button" className={button} onClick={() => { setExpectedUpdatedAt(colis.updatedAt); setError(''); }}>{consent ? 'Demander un nouvel accord' : 'Modifier le devis'}</button> : <div ref={confirmation} tabIndex={-1} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800 outline-none">
      <h3 className="font-bold">{consent ? 'Redemander l’accord au client ?' : 'Modifier le devis avant paiement ?'}</h3>
      <p>{consent ? 'La réponse précédente restera dans l’historique. Les anciens boutons de réponse ne seront plus utilisables. Vous préparerez ensuite une nouvelle demande.' : 'Vous pourrez corriger les articles, les taux OM / OMR et les frais. Les informations déjà enregistrées seront conservées.'}</p>
      {(revisionHasQuote(colis) || !consent) && <p>Le devis actuel et son éventuel lien de paiement seront retirés. Après correction, vérifiez le montant puis choisissez d’envoyer le nouveau devis.</p>}
      {consent && <p>Les cartons, leurs mesures et les factures sont conservés. La préparation attendra le nouvel accord.</p>}
      <p className="font-semibold">Aucun message ne sera envoyé par cette action.</p>
      {stale && <p role="alert">Le dossier a été modifié depuis votre ouverture. Rechargez-le avant de confirmer.</p>}
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {(stale || error) && <button disabled={busy} onClick={reload} className={button}>Recharger le dossier</button>}
      <div className="flex flex-wrap gap-3"><button disabled={busy || stale} onClick={save} className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? 'Enregistrement…' : consent ? 'Préparer une nouvelle demande' : 'Reprendre le devis'}</button><button disabled={busy} className={button} onClick={() => { setExpectedUpdatedAt(null); setError(''); }}>Annuler</button></div>
    </div>}
  </section>;
}

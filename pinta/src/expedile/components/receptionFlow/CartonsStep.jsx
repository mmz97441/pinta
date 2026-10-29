import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { receptionCartonManifest } from '../../domain/reception';
import { Casier, ClientBand } from './ReceptionParts';
import CartonForm from './CartonForm';
import ValidationPanel from './ValidationPanel';
import { EMPTY_CARTON, clientPlace, count, firstName, formHasTyping } from './receptionFlowModel';

// Step 2, « Cartons », one screen (docs/specification-brouillon-reception-2026-10-28.md, « Réception »): the client and
// where the cartons go, « Ajouter un carton » (each carton recorded at once, the form emptied for the next scan), and
// under it « À valider » with every carton of the client waiting for its validation, validated together in one tap
// with ONE arrival notice. Opened to validate (?valider=1, the action « Valider la réception » of the Colis list), the
// form waits behind « Ajouter un carton pour [prénom] » unless a carton is being typed or checked.

/** The band above the cartons: where they go. */
function bandDetail(target) {
  if (target.mode === 'append') return <>
    Brouillon en cours : {count(receptionCartonManifest(target.dossier).nbColis, 'carton')} · <Casier value={target.dossier.casier} />
    {target.explicit && target.dossier.ref ? <> · <span className="rf-code whitespace-nowrap">{target.dossier.ref}</span></> : null}
  </>;
  if (target.blockedReason) return 'Le brouillon en cours ne peut pas recevoir de carton : le prochain carton en ouvre un nouveau.';
  if (target.detail === 'Devis déjà envoyé') return 'Devis déjà envoyé : le premier carton ouvre un nouveau brouillon.';
  return 'Aucun brouillon en cours : le premier carton en ouvre un nouveau.';
}

export default function CartonsStep({ client, target, session, update, validating = false, onValidated, onChooseTarget, onChangeClient }) {
  const name = firstName(client);
  // The list « À valider » is read again after each carton added.
  const [version, setVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(() => !validating || Boolean(session.intent) || formHasTyping(session.form));
  // The form takes the focus when it opens for a carton (not when its typing is cleared from the list below).
  const [focusForm, setFocusForm] = useState(!validating);
  const [formKey, setFormKey] = useState(0);
  const typing = formOpen && formHasTyping(session.form);
  // The carton just recorded, announced from here: the form is rebuilt when a first carton opens its brouillon.
  const saved = session.lastSaved;
  const announcement = saved && !session.intent ? `Carton n° ${saved.number} enregistré dans ${saved.ref}.${saved.photoWarning ? ` ${saved.photoWarning}` : ''}` : '';

  const openForm = () => { setFocusForm(true); setFormOpen(true); };
  const finishTyping = () => {
    const button = document.getElementById('rf-add-carton');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView?.({ block: 'center' });
  };
  // The carton being typed is emptied (its locker kept): nothing was recorded for it.
  const clearTyping = () => {
    update(previous => ({ form: { ...EMPTY_CARTON, casier: previous.form.casier } }));
    setFocusForm(false);
    setFormKey(key => key + 1);
    document.getElementById('rf-validation-title')?.focus({ preventScroll: true });
  };

  return <div className="space-y-6">
    <ClientBand client={client} place={clientPlace(client)} detail={bandDetail(target)} tone={target.mode === 'new' ? 'new' : 'join'}
      action={<button type="button" onClick={onChangeClient} className="rf-strong min-h-11 px-2 text-[17px] font-bold underline underline-offset-4">Changer de client</button>} />
    {formOpen
      ? <CartonForm key={`${client.id}:${target.dossier?.id || 'new'}:${formKey}`} client={client} target={target} session={session} update={update} autoFocus={focusForm}
        onSaved={() => { setFocusForm(true); setVersion(value => value + 1); }} onChooseTarget={onChooseTarget} />
      : <button type="button" onClick={openForm} className="rf-secondary flex w-full items-center justify-center gap-2 px-4"><Plus size={22} aria-hidden="true" />Ajouter un carton pour {name}</button>}
    <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    <ValidationPanel key={client.id} client={client} session={session} update={update} version={version} focusOnOpen={validating && !session.intent}
      typing={typing} onFinishTyping={finishTyping} onClearTyping={clearTyping} onValidated={onValidated} />
  </div>;
}

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { newClientFieldErrors, refusedClientFields } from '../../domain/clientRequirements';
import { firstNewClientField, newClientAlert } from '../../domain/receptionClient';
import { Field, Note, invalidProps } from './ReceptionParts';
import { definiteRefusal, newClientPayload, readableError } from './receptionFlowModel';
import { refreshClientRecord } from './receptionData';

// The quick creation of a client at the reception: the information the server requires for every client account
// (supabase/migrations/20261007000003_client_required_fields.sql: prénom, nom, e-mail, a phone, adresse, code postal
// of a served destination, ville), checked with the same rule as every creation path (newClientFieldErrors). The form
// has its own creation identifier (createId, kept with the typing): after a lost answer, « Vérifier l’enregistrement »
// replays the very same creation, which insertClient recognises (never a second client).
const FIELDS = [
  { key: 'raisonSociale', label: 'Raison sociale', pro: true, autoComplete: 'organization' },
  { key: 'nom', label: 'Nom', autoComplete: 'family-name' },
  { key: 'prenom', label: 'Prénom', autoComplete: 'given-name' },
  { key: 'tel', label: 'Téléphone mobile', type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  { key: 'telFixe', label: 'Téléphone fixe', type: 'tel', inputMode: 'tel', hint: 'si pas de mobile' },
  { key: 'email', label: 'E-mail', type: 'email', inputMode: 'email', autoComplete: 'email', wide: true },
  { key: 'adresseLigne1', label: 'Adresse de livraison', autoComplete: 'street-address', wide: true },
  { key: 'cp', label: 'Code postal', inputMode: 'numeric', autoComplete: 'postal-code' },
  { key: 'ville', label: 'Ville', autoComplete: 'address-level2' },
];
const inputId = key => `rf-new-client-${key}`;

/** `pending`: the payload of a creation whose answer was lost (persisted): the form is then locked, and its one action
 * replays that creation. `onPending(payload | null)` records it before the call and forgets it once answered. */
export default function NewClientForm({ values, createId, pending, onChange, onPending, onCancel, onCreated }) {
  const { addNewClient, setClients } = useApp();
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  // 'create' while the first attempt runs, 'verify' while a lost creation is replayed.
  const [saving, setSaving] = useState(null);
  const savingRef = useRef(false);
  const verifyRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const focus = key => { const input = document.getElementById(inputId(key)); input?.focus(); input?.scrollIntoView?.({ block: 'center' }); };
  // The first field to type takes the focus once, when the form opens; the check of a lost creation when there is one.
  const opening = useRef(pending ? 'verify' : values.type === 'pro' ? 'raisonSociale' : 'nom');
  useEffect(() => {
    if (opening.current === 'verify') verifyRef.current?.focus();
    else focus(opening.current);
  }, []);
  const checking = Boolean(pending) && saving !== 'create';

  const set = (key, value) => {
    onChange({ ...values, [key]: value });
    if (errors[key] || (key === 'telFixe' && errors.tel)) setErrors(previous => ({ ...previous, [key]: undefined, ...(key === 'telFixe' ? { tel: undefined } : {}) }));
    // What was refused is being corrected: the summary goes.
    if (failure) setFailure(null);
  };

  const create = async (payload, mode) => {
    if (savingRef.current || !createId) return;
    savingRef.current = true; setSaving(mode); setFailure(null);
    let created = null;
    try {
      created = await addNewClient(payload, { createId, quiet: true });
      // A client read meanwhile (a page reloaded after the lost answer) is listed once.
      setClients(previous => [...new Map(previous.map(item => [item.id, item])).values()]);
    } catch (error) {
      if (!definiteRefusal(error)) {
        // Unknown: the creation stays to check, with the same payload and identifier.
        if (mounted.current) setFailure({ uncertain: true, after: mode });
      } else if (error.code === '40001') {
        // A client is recorded under this form's identifier, and changed since: it is the one created here.
        const fresh = await refreshClientRecord(createId, setClients).catch(() => null);
        if (fresh) created = fresh.id;
        else if (mounted.current) setFailure({ uncertain: true, after: mode });
      } else {
        // Refused: nothing was recorded. The server's refusal names its fields (HINT client_required_fields:…).
        onPending(null);
        if (mounted.current) {
          const refused = refusedClientFields(error);
          if (refused.length) { setErrors(Object.fromEntries(refused.map(key => [key, 'À corriger.']))); focus(refused[0]); }
          setFailure({ message: readableError(error, 'Le client n’a pas été créé. Vérifiez ses coordonnées, puis réessayez.', 'Réception · nouveau client') });
        }
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(null);
    }
    if (created) onCreated(created);
  };

  const submit = event => {
    event.preventDefault();
    if (savingRef.current || !createId) return;
    if (pending) { create(pending, 'verify'); return; }
    const found = newClientFieldErrors(values);
    if (values.type === 'pro' && !values.raisonSociale.trim()) found.raisonSociale = 'La raison sociale est obligatoire pour un professionnel.';
    setErrors(found);
    if (Object.keys(found).length) { setFailure({ message: newClientAlert(found) }); focus(firstNewClientField(found)); return; }
    const payload = newClientPayload(values);
    // Recorded before the call: a reload while it runs finds the creation to check, never a second client.
    onPending(payload);
    create(payload, 'create');
  };

  const locked = Boolean(saving) || Boolean(pending);
  return <form noValidate onSubmit={submit} aria-labelledby="rf-new-client-title" className="rf-card space-y-5 rounded-2xl p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="rf-new-client-title" className="rf-strong flex items-center gap-2 text-[22px] font-extrabold"><UserPlus size={24} aria-hidden="true" />Nouveau client</h3>
      <button type="button" className="rf-quiet" onClick={onCancel} disabled={Boolean(saving)}>Annuler</button>
    </div>
    {checking ? <Note tone="warning" role="alert" title="Création à vérifier">
      La connexion a été interrompue pendant la création du client : nous ne savons pas s’il a été créé. Votre saisie est conservée. Touchez «&nbsp;Vérifier l’enregistrement&nbsp;» quand le réseau revient : le client ne sera pas créé deux fois.
      {failure?.after === 'verify' && <span className="mt-1 block font-semibold">La vérification n’a pas abouti : réessayez dans un instant.</span>}
    </Note> : <p className="rf-muted text-[16px]">Toutes les informations sont obligatoires pour ouvrir un compte client. Un numéro mobile ou fixe suffit.</p>}
    <fieldset className="flex flex-wrap gap-2" disabled={locked}>
      <legend className="rf-label">Type de client</legend>
      {[['particulier', 'Particulier'], ['pro', 'Professionnel']].map(([key, label]) => <button key={key} type="button" aria-pressed={values.type === key}
        onClick={() => set('type', key)} className="rf-toggle">{label}</button>)}
    </fieldset>
    <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2">
      <legend className="sr-only">Coordonnées du client</legend>
      {FIELDS.filter(field => !field.pro || values.type === 'pro').map(field => <Field key={field.key} id={inputId(field.key)} label={field.label} hint={field.hint}
        error={errors[field.key]} className={field.wide || field.pro ? 'md:col-span-2' : ''}>
        <input id={inputId(field.key)} type={field.type || 'text'} inputMode={field.inputMode} autoComplete={field.autoComplete || 'off'}
          value={values[field.key] || ''} onChange={event => set(field.key, event.target.value)} className="rf-field" {...invalidProps(inputId(field.key), errors[field.key])} />
      </Field>)}
    </fieldset>
    {failure?.message && <Note tone="danger" role="alert">{failure.message}</Note>}
    {checking
      ? <button ref={verifyRef} type="submit" disabled={Boolean(saving)} className="rf-primary brand-bg flex w-full items-center justify-center gap-2 px-4">
        <RefreshCw size={22} aria-hidden="true" />{saving === 'verify' ? 'Vérification…' : 'Vérifier l’enregistrement'}
      </button>
      : <button type="submit" disabled={Boolean(saving)} className="rf-primary brand-bg flex w-full items-center justify-center gap-2 px-4">
        <UserPlus size={22} aria-hidden="true" />{saving ? 'Création du client…' : 'Créer le client'}
      </button>}
    <p role="status" aria-live="polite" className="sr-only">{saving === 'verify' ? 'Vérification de la création du client…' : saving ? 'Création du client…' : failure?.uncertain ? 'Création du client à vérifier.' : ''}</p>
  </form>;
}

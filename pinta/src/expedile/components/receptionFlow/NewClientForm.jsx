import React, { useEffect, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { newClientFieldErrors, refusedClientFields } from '../../domain/clientRequirements';
import { firstNewClientField, newClientAlert } from '../../domain/receptionClient';
import { Field, Note, invalidProps } from './ReceptionParts';
import { definiteRefusal } from './receptionFlowModel';
import { findCreatedClient } from './receptionData';

// The quick creation of a client at the reception: the information the server requires for every client account
// (supabase/migrations/20261007000003_client_required_fields.sql: prénom, nom, e-mail, a phone, adresse, code postal
// of a served destination, ville), checked with the same rule as every creation path (newClientFieldErrors).
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

export default function NewClientForm({ values, onChange, onCancel, onCreated }) {
  const { addNewClient, setClients } = useApp();
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const focus = key => { const input = document.getElementById(inputId(key)); input?.focus(); input?.scrollIntoView?.({ block: 'center' }); };
  // The first field to type takes the focus once, when the form opens.
  const opening = useRef(values.type === 'pro' ? 'raisonSociale' : 'nom');
  useEffect(() => { focus(opening.current); }, []);

  const set = (key, value) => {
    onChange({ ...values, [key]: value });
    if (errors[key] || (key === 'telFixe' && errors.tel)) setErrors(previous => ({ ...previous, [key]: undefined, ...(key === 'telFixe' ? { tel: undefined } : {}) }));
    // What was refused is being corrected: the summary goes, a lost answer still has to be checked.
    if (failure && !failure.uncertain) setFailure(null);
  };

  const verify = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const created = await findCreatedClient(values, setClients);
      if (created) { onCreated(created.id); return; }
      setFailure({ message: 'Ce client n’a pas été créé. Vous pouvez le créer maintenant.' });
    } catch (error) {
      setFailure({ uncertain: true, message: `La vérification a échoué : ${error.message || 'réseau indisponible'}. Réessayez dans un instant.` });
    } finally { savingRef.current = false; setSaving(false); }
  };

  const submit = async event => {
    event.preventDefault();
    if (savingRef.current) return;
    const found = newClientFieldErrors(values);
    if (values.type === 'pro' && !values.raisonSociale.trim()) found.raisonSociale = 'La raison sociale est obligatoire pour un professionnel.';
    setErrors(found);
    if (Object.keys(found).length) { setFailure({ message: newClientAlert(found) }); focus(firstNewClientField(found)); return; }
    savingRef.current = true; setSaving(true); setFailure(null);
    try {
      const email = values.email.trim();
      const id = await addNewClient({
        nom: values.nom.trim(), prenom: values.prenom.trim(), tel: values.tel.trim(), telFixe: values.telFixe.trim(), email,
        adresseLigne1: values.adresseLigne1.trim(), cp: values.cp.trim(), ville: values.ville.trim(),
        type: values.type, raisonSociale: values.type === 'pro' ? values.raisonSociale.trim() : '',
        canal: email ? 'email' : 'telegram', modePaiement: 'colis', abonnement: 'freemium',
        created: new Date().toISOString().slice(0, 10), points: 0,
      });
      onCreated(id);
    } catch (error) {
      if (definiteRefusal(error)) {
        // The server's refusal names its fields (HINT client_required_fields:…): each is marked, the message says why.
        const refused = refusedClientFields(error);
        if (refused.length) { setErrors(Object.fromEntries(refused.map(key => [key, 'À corriger.']))); focus(refused[0]); }
        setFailure({ message: error.message || 'Le client n’a pas été créé.' });
      } else {
        setFailure({ uncertain: true, message: 'La connexion a été interrompue : le client a peut-être été créé. Vérifiez avant de le créer à nouveau.' });
      }
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <form noValidate onSubmit={submit} aria-labelledby="rf-new-client-title" className="rf-card space-y-5 rounded-2xl p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="rf-new-client-title" className="rf-strong flex items-center gap-2 text-[22px] font-extrabold"><UserPlus size={24} aria-hidden="true" />Nouveau client</h3>
      <button type="button" className="rf-quiet" onClick={onCancel} disabled={saving}>Annuler</button>
    </div>
    <p className="rf-muted text-[16px]">Toutes les informations sont obligatoires pour ouvrir un compte client. Un numéro mobile ou fixe suffit.</p>
    <fieldset className="flex flex-wrap gap-2" disabled={saving}>
      <legend className="rf-label">Type de client</legend>
      {[['particulier', 'Particulier'], ['pro', 'Professionnel']].map(([key, label]) => <button key={key} type="button" aria-pressed={values.type === key}
        onClick={() => set('type', key)} className="rf-toggle">{label}</button>)}
    </fieldset>
    <fieldset disabled={saving} className="grid gap-4 md:grid-cols-2">
      <legend className="sr-only">Coordonnées du client</legend>
      {FIELDS.filter(field => !field.pro || values.type === 'pro').map(field => <Field key={field.key} id={inputId(field.key)} label={field.label} hint={field.hint}
        error={errors[field.key]} className={field.wide || field.pro ? 'md:col-span-2' : ''}>
        <input id={inputId(field.key)} type={field.type || 'text'} inputMode={field.inputMode} autoComplete={field.autoComplete || 'off'}
          value={values[field.key] || ''} onChange={event => set(field.key, event.target.value)} className="rf-field" {...invalidProps(inputId(field.key), errors[field.key])} />
      </Field>)}
    </fieldset>
    {failure && <Note tone={failure.uncertain ? 'warning' : 'danger'} role="alert" action={failure.uncertain && <button type="button" className="rf-small-action" onClick={verify} disabled={saving}>Vérifier si le client existe</button>}>{failure.message}</Note>}
    <button type="submit" disabled={saving} className="rf-primary brand-bg flex w-full items-center justify-center gap-2 px-4">
      <UserPlus size={22} aria-hidden="true" />{saving ? 'Création du client…' : 'Créer le client'}
    </button>
  </form>;
}

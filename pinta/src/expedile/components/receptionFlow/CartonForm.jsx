import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, ImagePlus, PackagePlus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as sb from '../../lib/supabaseData';
import { randomId } from '../../lib/randomId';
import { addReceptionPhoto } from '../../lib/receptionValidation';
import { PRODUITS_INTERDITS } from '../../constants';
import { receptionCartonManifest } from '../../domain/reception';
import { arrivalChannel } from '../../services/arrivalNotice';
import { upperCaseInPlace } from '../detail/casierInput';
import { Field, Note, invalidProps } from './ReceptionParts';
import { EMPTY_CARTON, MEASURES, cartonFieldErrors, cartonMeasures, consentRenewal, count, damageNote, definiteRefusal, firstName, newDossierPayload, photoProblem, readableError, receptionPhotoFile, trackingOwner } from './receptionFlowModel';

// « Ajouter un carton », the form of the screen « Cartons » (docs/specification-brouillon-reception-2026-10-28.md): the
// tracking number (a scan), the four measures, the vendor if known, and « Signaler un problème » (carton abîmé, produit
// interdit). « Ajouter ce carton » records it at once through the existing commands, then the form is emptied for the
// next carton, which the operator scans without leaving the screen; the cartons of the reception gather below it, to be
// validated together. Guarantees: the first carton of a new brouillon by insertColis(…, { createId }), the next ones by
// appendReceptionCartons(id, [carton], { requestId, expectedUpdatedAt, … }); each attempt keeps its identifier, so that
// after a lost answer « Vérifier l’enregistrement » replays the very same request, which the server recognises (no
// second carton). The photo of a damaged carton is one more photo of that carton (uploadDocument, then addReceptionPhoto).
const ID = { casier: 'rf-casier', tracking: 'rf-tracking', fournisseur: 'rf-vendor', photo: 'rf-photo-camera', note: 'rf-damage-note', submit: 'rf-add-carton', interdits: 'rf-forbidden' };
const MEASURE_ID = key => `rf-measure-${key}`;
const FIELD_ORDER = ['casier', 'tracking', 'dimL', 'dimW', 'dimH', 'poids', 'fournisseur', 'photo'];
const idOf = key => ID[key] || MEASURE_ID(key);
const COMMON_VENDORS = ['Amazon', 'Shein', 'Zara', 'Cdiscount', 'Temu', 'Vinted', 'Fnac', 'Decathlon'];

function vendorSuggestions(data) {
  const seen = new Map();
  for (const dossier of data || []) for (const detail of dossier.trackingsDetail || []) {
    const vendor = String(detail?.fournisseur || '').trim();
    if (vendor) seen.set(vendor, (seen.get(vendor) || 0) + 1);
  }
  const frequent = [...seen.entries()].sort((left, right) => right[1] - left[1]).map(([vendor]) => vendor);
  return [...new Set([...frequent, ...COMMON_VENDORS])].slice(0, 12);
}

/** What the last « Ajouter ce carton » recorded, at the top of the form, the next carton ready to scan. (Screen readers
 * hear it from the announcement of CartonsStep, which outlives the form.) */
function SavedNote({ saved }) {
  if (!saved) return null;
  return <Note tone="success" className="rf-saved">
    <span className="font-bold">Carton n°{' '}{saved.number} enregistré</span> dans <span className="rf-code whitespace-nowrap font-bold">{saved.ref}</span>{saved.created ? ' (nouveau brouillon)' : ''}. Scannez le suivant, ou validez la réception plus bas.
    {saved.changed && <span className="mt-1 block">Ce brouillon a été complété depuis par un collègue : il reste ouvert, vos prochains cartons s’y ajoutent.</span>}
    {saved.photoWarning && <span className="mt-1 block">{saved.photoWarning}</span>}
  </Note>;
}

export default function CartonForm({ client, target, session, update, onSaved, onChooseTarget, autoFocus = true }) {
  const { data, setData, clients, refreshColis, produitsInterdits } = useApp();
  const form = session.form;
  const intent = session.intent;
  const newMode = target.mode === 'new';
  const dossier = newMode ? null : target.dossier;
  const needsCasier = newMode || !String(dossier?.casier || '').trim();
  const forbidden = Array.isArray(produitsInterdits) && produitsInterdits.length ? produitsInterdits : PRODUITS_INTERDITS;
  const vendors = useMemo(() => vendorSuggestions(data), [data]);
  const name = firstName(client);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const savingRef = useRef(false);
  const verifyRef = useRef(null);
  const submitRef = useRef(null);
  // A save answered after the operator left the reception is recorded in the session, without taking them back.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const focusField = (key, scroll = true) => {
    const element = key === 'submit' ? submitRef.current : document.getElementById(idOf(key));
    element?.focus({ preventScroll: !scroll });
    if (scroll) element?.scrollIntoView?.({ block: 'center' });
  };
  // The first useful field: the locker of a new brouillon, otherwise the tracking number (a scan); the check of a
  // lost save when there is one.
  const opening = useRef(intent ? 'verify' : needsCasier ? 'casier' : 'tracking');
  useEffect(() => {
    if (opening.current === 'verify') verifyRef.current?.focus();
    else if (autoFocus) focusField(opening.current, false);
  }, []);
  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return undefined; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const setForm = changes => {
    update(previous => ({ form: { ...previous.form, ...changes } }));
    const keys = Object.keys(changes);
    if (keys.some(key => errors[key] || (key === 'abime' && errors.photo))) setErrors(previous => {
      const next = { ...previous };
      for (const key of keys) delete next[key];
      if (keys.includes('abime')) delete next.photo;
      return next;
    });
    if (failure && !failure.uncertain) setFailure(null);
    if (status) setStatus('');
  };
  const choosePhoto = file => {
    if (!file) return;
    // Refused at once rather than after the carton is saved: a JPEG, PNG or WebP of 20 MB at most.
    const problem = photoProblem(file);
    if (problem) { setErrors(previous => ({ ...previous, photo: problem })); return; }
    setPhoto(file);
    setForm({ photoName: file.name || 'photo' });
    if (errors.photo) setErrors(previous => { const next = { ...previous }; delete next.photo; return next; });
  };
  const removePhoto = () => { setPhoto(null); setForm({ photoName: '' }); };
  const nextOnEnter = next => event => { if (event.key === 'Enter') { event.preventDefault(); focusField(next); } };

  // Records one attempt, as it is, then brings the saved dossier into the list (like ColisModal).
  const run = async attempt => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setFailure(null);
    setStatus('Enregistrement du carton…');
    let saved = null, changed = false, failed = null;
    try {
      saved = attempt.kind === 'create'
        ? await sb.insertColis(attempt.payload, { createId: attempt.createId })
        : await sb.appendReceptionCartons(attempt.dossierId, attempt.cartons, attempt.options);
    } catch (error) {
      failed = error;
      // The brouillon recorded under this attempt's own identifier exists, and a colleague changed it since: the carton
      // IS recorded (carton n° 1). That brouillon is opened to add the next cartons.
      if (attempt.kind === 'create' && error.code === '40001') {
        saved = (await refreshColis(attempt.createId).catch(() => null)) || null;
        changed = Boolean(saved);
      }
    }
    if (!saved) {
      const error = failed || new Error('Le carton n’a pas été enregistré.');
      savingRef.current = false; setSaving(false);
      if (attempt.kind === 'create' && error.code === '40001') {
        // Recorded, but its brouillon could not be read: the attempt stays to check, never « non enregistré ».
        setStatus('Le carton est enregistré, mais son brouillon n’a pas pu être lu : touchez « Vérifier l’enregistrement ».');
        setFailure({ uncertain: true, recorded: true });
        return;
      }
      if (!definiteRefusal(error)) {
        setStatus('Enregistrement à vérifier.');
        setFailure({ uncertain: true });
        return;
      }
      // The server refused: nothing was recorded, the attempt is forgotten and the typing kept.
      update({ intent: null });
      setStatus('Le carton n’a pas été enregistré.');
      if (error.code === '40001' && attempt.kind === 'append') {
        await refreshColis(attempt.dossierId).catch(() => null);
        setFailure({ message: 'Le brouillon vient d’être modifié par un collègue. Il est actualisé : vérifiez le carton puis touchez à nouveau « Ajouter ce carton ».' });
      } else if (/num[ée]ro de suivi/i.test(error.message || '')) {
        setErrors({ tracking: readableError(error, 'Ce numéro de suivi est refusé. Vérifiez le carton.', 'Réception · carton') });
        focusField('tracking');
      } else setFailure({ message: readableError(error, 'Le carton n’a pas été enregistré. Vérifiez la connexion, puis touchez à nouveau « Ajouter ce carton ».', 'Réception · carton') });
      return;
    }
    const { factures, lignes, messages, ...row } = saved;
    setData(previous => previous.some(item => item.id === saved.id)
      ? previous.map(item => item.id === saved.id ? { ...item, ...(attempt.kind === 'create' ? saved : row) } : item)
      : [...previous, { factures: factures || [], lignes: lignes || [], messages: messages || [], ...row }]);
    let photoWarning = '';
    if (photo) {
      setStatus('Envoi de la photo…');
      try {
        // One more photo of this carton (reception_photos); the dossier's own photo only while it has none.
        const uploaded = await sb.uploadDocument('photos-colis', saved.id, receptionPhotoFile(photo));
        await addReceptionPhoto({ colisId: saved.id, carton: attempt.number, path: uploaded.path });
        if (!saved.photoReception && !saved.photoReceptionUrl) {
          try {
            const withPhoto = await sb.updateColis(saved.id, { photoReception: true, photoReceptionUrl: uploaded.path }, saved.updatedAt);
            const { factures: _f, lignes: _l, messages: _m, ...photoRow } = withPhoto;
            setData(previous => previous.map(item => item.id === saved.id ? { ...item, ...photoRow } : item));
          } catch { /* The photo is kept with its carton: the dossier's own photo is a convenience. */ }
        }
      } catch (error) {
        photoWarning = `Le carton est enregistré, mais la photo n’a pas été jointe. Ajoutez-la depuis le dossier ${saved.ref}.`;
        console.warn('[Réception · photo]', error);
      }
    } else if (attempt.photoName) photoWarning = `Le carton est enregistré. La photo prise avant le rechargement n’a pas été jointe : ajoutez-la depuis le dossier ${saved.ref}.`;
    // What the team flagged on this carton, which the arrival notice does not say (recalled at the validation).
    const flags = { abime: Boolean(attempt.flags?.abime), interdits: Array.isArray(attempt.flags?.interdits) ? attempt.flags.interdits : [] };
    update(previous => ({
      intent: null, form: { ...EMPTY_CARTON }, target: { mode: 'append', dossierId: saved.id },
      saved: [...previous.saved.filter(item => !(item.colisId === saved.id && item.number === attempt.number)), { colisId: saved.id, ref: saved.ref, number: attempt.number, ...flags }],
      lastSaved: { colisId: saved.id, ref: saved.ref, number: attempt.number, created: attempt.kind === 'create', changed, photoWarning },
      consent: attempt.consent && !previous.consent[saved.id] ? { ...previous.consent, [saved.id]: attempt.consent } : previous.consent,
    }));
    savingRef.current = false;
    onSaved?.(saved);
    if (!mounted.current) return;
    setPhoto(null); setSaving(false); setErrors({});
    setStatus('');
    // The next carton: the tracking number is ready for the scanner (a new brouillon reopens this form on its own).
    if (attempt.kind === 'append') focusField('tracking');
  };

  const add = () => {
    if (savingRef.current || intent) return;
    const tracking = String(form.tracking || '').trim();
    const owner = trackingOwner(tracking, data);
    const duplicate = owner ? { ...owner, same: Boolean(dossier) && owner.dossier.id === dossier.id, ownerName: clients.find(item => item.id === owner.dossier.clientId)?.nom || '' } : null;
    const found = cartonFieldErrors(form, { needsCasier, hasPhoto: Boolean(photo), duplicate });
    setErrors(found);
    const first = FIELD_ORDER.find(key => found[key]);
    if (first) {
      const missing = Object.keys(found).length;
      setStatus(`Le carton n’est pas enregistré : ${count(missing, 'information', 'informations')} à corriger.`);
      focusField(first);
      return;
    }
    const box = cartonMeasures(form);
    const flags = { abime: Boolean(form.abime), interdits: [...form.interdits] };
    const attempt = newMode
      ? { kind: 'create', createId: randomId(), payload: newDossierPayload(client.id, form, box), number: 1, flags, photoName: form.abime ? form.photoName : '' }
      : (() => {
        const number = receptionCartonManifest(dossier).nbColis + 1;
        return { kind: 'append', dossierId: dossier.id, number, consent: consentRenewal(dossier), flags, photoName: form.abime ? form.photoName : '',
          cartons: [{ ...box, fournisseur: String(form.fournisseur || '').trim(), tracking }],
          options: { requestId: randomId(), expectedUpdatedAt: dossier.updatedAt, casier: needsCasier ? form.casier.trim() : null,
            notesReception: form.abime ? damageNote(form, number) : null, checkInterdits: [...form.interdits] } };
      })();
    update({ intent: attempt });
    run(attempt);
  };

  const lockedInput = saving || Boolean(intent);
  const interditsOpen = Boolean(form.interditsOpen);
  const lastSaved = !intent && session.lastSaved && session.lastSaved.colisId === (dossier?.id ?? session.lastSaved.colisId) ? session.lastSaved : null;

  if (!newMode && target.blockedReason) return <section aria-labelledby="rf-step-title" className="space-y-4">
    <h2 id="rf-step-title" className="rf-strong text-[24px] font-extrabold sm:text-[26px]">Ajouter un carton</h2>
    <Note tone="danger" role="alert" title="Ce dossier ne peut pas recevoir de carton" action={<button type="button" className="rf-small-action" onClick={onChooseTarget}>Choisir le brouillon du client</button>}>{target.blockedReason}</Note>
  </section>;

  return <section aria-labelledby="rf-step-title" className="rf-form-section space-y-4">
    <h2 id="rf-step-title" className="rf-strong text-[24px] font-extrabold sm:text-[26px]">Ajouter un carton</h2>
    <SavedNote saved={lastSaved} />
    {target.impact && <Note tone="warning">{target.impact}</Note>}
    {intent && <Note tone="warning" role="alert" title={failure?.recorded ? 'Carton enregistré, brouillon à ouvrir' : 'Enregistrement à vérifier'} action={<button ref={verifyRef} type="button" className="rf-small-action inline-flex items-center gap-2" disabled={saving} onClick={() => run(intent)}><RefreshCw size={18} aria-hidden="true" />{saving ? 'Vérification…' : 'Vérifier l’enregistrement'}</button>}>
      {failure?.recorded
        ? <>Ce carton est enregistré dans un brouillon qu’un collègue a complété depuis, mais ce brouillon n’a pas pu être lu. Touchez «&nbsp;Vérifier l’enregistrement&nbsp;» quand le réseau revient pour l’ouvrir : le carton ne sera pas enregistré deux fois.</>
        : <>La connexion a été interrompue pendant l’enregistrement du carton : nous ne savons pas s’il a été enregistré. Votre saisie est conservée. Touchez «&nbsp;Vérifier l’enregistrement&nbsp;» quand le réseau revient : le carton ne sera pas enregistré deux fois.</>}
    </Note>}

    <fieldset disabled={lockedInput} className="min-w-0 space-y-4">
      <legend className="sr-only">Le carton reçu</legend>
      {needsCasier && <Field id={ID.casier} label="Casier" hint={newMode ? 'où rangez-vous ses cartons ?' : 'ce brouillon n’en a pas encore'} error={errors.casier} className="max-w-sm">
        <input id={ID.casier} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ex. A-09" value={form.casier}
          onChange={event => setForm({ casier: upperCaseInPlace(event.target) })} onKeyDown={nextOnEnter('tracking')}
          className="rf-field rf-field--casier" {...invalidProps(ID.casier, errors.casier)} />
      </Field>}
      <div className="grid gap-x-4 gap-y-4 md:grid-cols-3">
        <Field id={ID.tracking} label="Numéro de suivi" hint="scannez ou tapez" error={errors.tracking} className="md:col-span-2">
          <input id={ID.tracking} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="next" value={form.tracking}
            onChange={event => setForm({ tracking: event.target.value })} onKeyDown={nextOnEnter('dimL')}
            className="rf-field rf-field--code" {...invalidProps(ID.tracking, errors.tracking)} />
        </Field>
        <Field id={ID.fournisseur} label="Vendu par" hint="facultatif">
          <input id={ID.fournisseur} type="text" autoComplete="off" list="rf-vendor-list" placeholder="Amazon, Shein…" enterKeyHint="next" value={form.fournisseur}
            onChange={event => setForm({ fournisseur: event.target.value })} onKeyDown={nextOnEnter('dimL')} className="rf-field" />
          <datalist id="rf-vendor-list">{vendors.map(vendor => <option key={vendor} value={vendor} />)}</datalist>
        </Field>
      </div>
      <fieldset className="min-w-0">
        <legend className="rf-label">Mesures du carton, tel qu’il est arrivé</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {MEASURES.map(({ key, label, unit }, index) => <Field key={key} id={MEASURE_ID(key)} label={`${label} (${unit})`} error={errors[key]}>
            <input id={MEASURE_ID(key)} type="text" inputMode="decimal" autoComplete="off" enterKeyHint={index < MEASURES.length - 1 ? 'next' : 'done'} value={form[key]}
              onChange={event => setForm({ [key]: event.target.value })} onKeyDown={event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // The weight, last measure: Enter records the carton (a keyboard or a scale typing its value).
                if (index < MEASURES.length - 1) focusField(MEASURES[index + 1].key); else add();
              }}
              className="rf-field rf-field--measure" {...invalidProps(MEASURE_ID(key), errors[key])} />
          </Field>)}
        </div>
      </fieldset>

      <div className="space-y-3">
        <div role="group" aria-labelledby="rf-problem-label" className="flex flex-wrap items-center gap-2">
          <span id="rf-problem-label" className="rf-problem-label">Signaler un problème</span>
          <button type="button" aria-pressed={form.abime} onClick={() => setForm({ abime: !form.abime })} className="rf-chip">
            {form.abime && <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />}Carton abîmé ou ouvert
          </button>
          <button type="button" aria-expanded={interditsOpen} aria-controls={ID.interdits} onClick={() => setForm({ interditsOpen: !interditsOpen })}
            className="rf-chip" data-flagged={form.interdits.length ? 'true' : undefined}>
            {form.interdits.length > 0 && <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />}
            Produit interdit{form.interdits.length > 0 ? ` · ${form.interdits.length}` : ''}
          </button>
        </div>
        {form.abime && <div className="rf-card space-y-3 rounded-2xl p-4">
          <p className="text-[16px] font-bold">Photo du carton abîmé <span className="rf-label-hint">· obligatoire</span></p>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`rf-small-action inline-flex cursor-pointer items-center gap-2${errors.photo ? ' rf-small-action--invalid' : ''}`}>
              <Camera size={20} aria-hidden="true" />Prendre une photo
              <input id={ID.photo} type="file" accept="image/*" capture="environment" className="sr-only" {...invalidProps(ID.photo, errors.photo)}
                onChange={event => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            <label className="rf-small-action inline-flex cursor-pointer items-center gap-2">
              <ImagePlus size={20} aria-hidden="true" />{photo ? 'Remplacer la photo' : 'Choisir une photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            {photo && <button type="button" className="rf-quiet" onClick={removePhoto}>Retirer la photo</button>}
          </div>
          {errors.photo && <p id={`${ID.photo}-error`} className="rf-error">{errors.photo}</p>}
          {photo && photoUrl && <img src={photoUrl} alt="Photo du carton abîmé" className="max-h-40 rounded-xl object-cover" />}
          {!photo && form.photoName && <p className="rf-muted text-[15px]">La photo «&nbsp;{form.photoName}&nbsp;» doit être reprise : elle n’est pas conservée quand la page se recharge.</p>}
          <Field id={ID.note} label="Ce que vous constatez" hint="facultatif">
            <textarea id={ID.note} rows={2} value={form.note} onChange={event => setForm({ note: event.target.value })} placeholder="Coin enfoncé, scotch arraché…" className="rf-field" />
          </Field>
        </div>}
        {interditsOpen && <fieldset id={ID.interdits} className="rf-card min-w-0 rounded-2xl p-4">
          <legend className="sr-only">Produits interdits en avion</legend>
          <p className="mb-2 text-[16px] font-bold">Produits interdits en avion <span className="rf-label-hint">· touchez ce que vous repérez</span></p>
          <div className="flex flex-wrap gap-2">
            {forbidden.map(item => {
              const checked = form.interdits.includes(item);
              return <button key={item} type="button" aria-pressed={checked} className="rf-chip"
                onClick={() => setForm({ interdits: checked ? form.interdits.filter(entry => entry !== item) : [...form.interdits, item] })}>
                {checked && <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />}{item}
              </button>;
            })}
          </div>
        </fieldset>}
        {form.interdits.length > 0 && <p className="rf-error">Produit interdit signalé : {form.interdits.join(', ')}. Ce carton ne pourra peut-être pas voyager en avion. Le dossier sera à régler avant sa préparation.</p>}
      </div>
    </fieldset>

    <div className="space-y-2 pt-1">
      <button ref={submitRef} id={ID.submit} type="button" onClick={add} disabled={lockedInput} className="rf-primary brand-bg flex w-full items-center justify-center gap-2.5 px-4">
        {saving ? 'Enregistrement…' : <><PackagePlus size={24} aria-hidden="true" />Ajouter ce carton</>}
      </button>
      <p className="rf-muted text-center text-[15px]">{newMode ? 'Le brouillon est créé avec ce carton.' : 'Le carton est enregistré tout de suite.'} Ajoutez les suivants, puis validez-les ensemble{arrivalChannel(client) ? ` : ${name} recevra un seul message` : ''}.</p>
    </div>
    <p role="status" aria-live="polite" className={status && !failure ? 'rf-muted text-center text-[15px] font-semibold' : 'sr-only'}>{status}</p>
    {failure && !failure.uncertain && <Note tone="danger" role="alert" title="Le carton n’est pas enregistré">{failure.message}</Note>}
  </section>;
}

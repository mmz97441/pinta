import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, ImagePlus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as sb from '../../lib/supabaseData';
import { randomId } from '../../lib/randomId';
import { PRODUITS_INTERDITS } from '../../constants';
import { receptionCartonManifest } from '../../domain/reception';
import { arrivalChannel } from '../../services/arrivalNotice';
import { upperCaseInPlace } from '../detail/casierInput';
import { Casier, ClientBand, Field, Note, invalidProps } from './ReceptionParts';
import { EMPTY_CARTON, MEASURES, cartonFieldErrors, cartonMeasures, clientPlace, consentRenewal, count, damageNote, definiteRefusal, newDossierPayload, trackingOwner } from './receptionFlowModel';

// Step 2, « Le carton »: tracking number and vendor (optional), the four measures, « Carton abîmé ou ouvert »
// (note and photo), the forbidden products, and the locker of a new brouillon. « Ajouter ce carton » records it at
// once through the existing commands, with their guarantees: the first carton of a new brouillon by
// insertColis(…, { createId }), the next ones by appendReceptionCartons(id, [carton], { requestId, expectedUpdatedAt,
// … }). Each attempt keeps its identifier: after a lost answer, « Vérifier l’enregistrement » replays the very same
// request, which the server recognises (no second carton).
const ID = { casier: 'rf-casier', tracking: 'rf-tracking', fournisseur: 'rf-vendor', photo: 'rf-photo-camera', note: 'rf-damage-note', submit: 'rf-add-carton' };
const MEASURE_ID = key => `rf-measure-${key}`;
const FIELD_ORDER = ['casier', 'tracking', 'fournisseur', 'dimL', 'dimW', 'dimH', 'poids', 'photo'];
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

/** The band above the form: the client and where the carton goes. */
function bandDetail(target) {
  if (target.mode === 'append') return <>
    Brouillon en cours : {count(receptionCartonManifest(target.dossier).nbColis, 'carton')} · <Casier value={target.dossier.casier} />
    {target.explicit && target.dossier.ref ? <> · <span className="rf-code whitespace-nowrap">{target.dossier.ref}</span></> : null}
  </>;
  if (target.blockedReason) return 'Le brouillon en cours ne peut pas recevoir de carton : ce carton en ouvre un nouveau.';
  if (target.detail === 'Devis déjà envoyé') return 'Devis déjà envoyé : ce carton ouvre un nouveau brouillon.';
  return 'Aucun brouillon en cours : ce carton en ouvre un nouveau.';
}

export default function CartonStep({ client, target, session, update, onSaved, onChangeClient, onOpenValidation, onChooseTarget }) {
  const { data, setData, clients, refreshColis, produitsInterdits } = useApp();
  const form = session.form;
  const intent = session.intent;
  const newMode = target.mode === 'new';
  const dossier = newMode ? null : target.dossier;
  const needsCasier = newMode || !String(dossier?.casier || '').trim();
  const forbidden = Array.isArray(produitsInterdits) && produitsInterdits.length ? produitsInterdits : PRODUITS_INTERDITS;
  const vendors = useMemo(() => vendorSuggestions(data), [data]);
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

  const focusField = key => {
    const element = key === 'submit' ? submitRef.current : document.getElementById(idOf(key));
    element?.focus();
    element?.scrollIntoView?.({ block: 'center' });
  };
  // The first useful field: the locker of a new brouillon, otherwise the tracking number (a scan); the check of a
  // lost save when there is one.
  const opening = useRef(intent ? 'verify' : needsCasier ? 'casier' : 'tracking');
  useEffect(() => {
    if (opening.current === 'verify') verifyRef.current?.focus();
    else focusField(opening.current);
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
    let saved;
    try {
      saved = attempt.kind === 'create'
        ? await sb.insertColis(attempt.payload, { createId: attempt.createId })
        : await sb.appendReceptionCartons(attempt.dossierId, attempt.cartons, attempt.options);
    } catch (error) {
      savingRef.current = false; setSaving(false);
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
        setFailure({ message: 'Le brouillon vient d’être modifié par un collègue. Il est actualisé : vérifiez le carton puis touchez à nouveau « Ajouter ce carton ».' });
      } else if (/num[ée]ro de suivi/i.test(error.message || '')) {
        setErrors({ tracking: error.message });
        focusField('tracking');
      } else setFailure({ message: error.message || 'Le carton n’a pas été enregistré.' });
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
        const uploaded = await sb.uploadDocument('photos-colis', saved.id, photo);
        const withPhoto = await sb.updateColis(saved.id, { photoReception: true, photoReceptionUrl: uploaded.path }, saved.updatedAt);
        const { factures: _f, lignes: _l, messages: _m, ...photoRow } = withPhoto;
        setData(previous => previous.map(item => item.id === saved.id ? { ...item, ...photoRow } : item));
      } catch (error) {
        photoWarning = `Le carton est enregistré, mais la photo n’a pas été jointe (${String(error.message || 'erreur').replace(/[.\s]+$/, '')}). Ajoutez-la depuis le dossier ${saved.ref}.`;
      }
    } else if (attempt.photoName) photoWarning = `Le carton est enregistré. La photo prise avant le rechargement n’a pas été jointe : ajoutez-la depuis le dossier ${saved.ref}.`;
    update(previous => ({
      intent: null, form: { ...EMPTY_CARTON }, target: { mode: 'append', dossierId: saved.id },
      saved: [...previous.saved.filter(item => !(item.colisId === saved.id && item.number === attempt.number)), { colisId: saved.id, ref: saved.ref, number: attempt.number }],
      lastSaved: { colisId: saved.id, ref: saved.ref, number: attempt.number, created: attempt.kind === 'create', photoWarning },
      consent: attempt.consent && !previous.consent[saved.id] ? { ...previous.consent, [saved.id]: attempt.consent } : previous.consent,
    }));
    savingRef.current = false;
    if (!mounted.current) return;
    setPhoto(null); setSaving(false);
    setStatus(`Carton n° ${attempt.number} enregistré dans ${saved.ref}.`);
    onSaved(saved);
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
    const attempt = newMode
      ? { kind: 'create', createId: randomId(), payload: newDossierPayload(client.id, form, box), number: 1, photoName: form.abime ? form.photoName : '' }
      : (() => {
        const number = receptionCartonManifest(dossier).nbColis + 1;
        return { kind: 'append', dossierId: dossier.id, number, consent: consentRenewal(dossier), photoName: form.abime ? form.photoName : '',
          cartons: [{ ...box, fournisseur: String(form.fournisseur || '').trim(), tracking }],
          options: { requestId: randomId(), expectedUpdatedAt: dossier.updatedAt, casier: needsCasier ? form.casier.trim() : null,
            notesReception: form.abime ? damageNote(form, number) : null, checkInterdits: [...form.interdits] } };
      })();
    update({ intent: attempt });
    run(attempt);
  };

  const blocked = !newMode && target.blockedReason;
  const channel = arrivalChannel(client);
  const lockedInput = saving || Boolean(intent);
  const savedHere = session.saved.length;

  return <section aria-labelledby="rf-step-title" className="space-y-4">
    <ClientBand client={client} place={clientPlace(client)} detail={bandDetail(target)} tone={newMode ? 'new' : 'join'}
      action={<button type="button" onClick={onChangeClient} disabled={saving} className="rf-strong min-h-11 px-2 text-[17px] font-bold underline underline-offset-4">Changer de client</button>} />
    <h2 id="rf-step-title" className="rf-strong text-[26px] font-extrabold sm:text-[28px]">{newMode ? 'Le premier carton' : 'Le carton'}</h2>

    {blocked ? <Note tone="danger" role="alert" title="Ce dossier ne peut pas recevoir de carton" action={<button type="button" className="rf-small-action" onClick={onChooseTarget}>Choisir le brouillon du client</button>}>{target.blockedReason}</Note> : <>
      {target.impact && <Note tone="warning">{target.impact}</Note>}
      {intent && <Note tone="warning" role="alert" title="Enregistrement à vérifier" action={<button ref={verifyRef} type="button" className="rf-small-action inline-flex items-center gap-2" disabled={saving} onClick={() => run(intent)}><RefreshCw size={18} aria-hidden="true" />{saving ? 'Vérification…' : 'Vérifier l’enregistrement'}</button>}>
        La connexion a été interrompue pendant l’enregistrement du carton : nous ne savons pas s’il a été enregistré. Votre saisie est conservée. Touchez «&nbsp;Vérifier l’enregistrement&nbsp;» quand le réseau revient : le carton ne sera pas enregistré deux fois.
      </Note>}

      <fieldset disabled={lockedInput} className="min-w-0 space-y-4">
        <legend className="sr-only">Le carton reçu</legend>
        <div className="grid gap-x-7 gap-y-4 md:grid-cols-2">
          <div className="min-w-0 space-y-4">
            {needsCasier && <Field id={ID.casier} label="Casier" hint={newMode ? 'où rangez-vous ce carton ?' : 'ce brouillon n’en a pas encore'} error={errors.casier}>
              <input id={ID.casier} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ex. A-09" value={form.casier}
                onChange={event => setForm({ casier: upperCaseInPlace(event.target) })} onKeyDown={nextOnEnter('tracking')}
                className="rf-field rf-field--casier" {...invalidProps(ID.casier, errors.casier)} />
            </Field>}
            <Field id={ID.tracking} label="Numéro de suivi" hint="facultatif, scan ou saisie" error={errors.tracking}>
              <input id={ID.tracking} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={form.tracking}
                onChange={event => setForm({ tracking: event.target.value })} onKeyDown={nextOnEnter('fournisseur')}
                className="rf-field rf-field--code" {...invalidProps(ID.tracking, errors.tracking)} />
            </Field>
            <Field id={ID.fournisseur} label="Vendu par" hint="facultatif">
              <input id={ID.fournisseur} type="text" autoComplete="off" list="rf-vendor-list" placeholder="Amazon, Shein, Zara…" value={form.fournisseur}
                onChange={event => setForm({ fournisseur: event.target.value })} onKeyDown={nextOnEnter('dimL')} className="rf-field" />
              <datalist id="rf-vendor-list">{vendors.map(vendor => <option key={vendor} value={vendor} />)}</datalist>
            </Field>
          </div>
          <fieldset className="min-w-0">
            <legend className="rf-label">Mesures du carton, tel qu’il est arrivé</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              {MEASURES.map(({ key, label, unit }, index) => <Field key={key} id={MEASURE_ID(key)} label={`${label} (${unit})`} error={errors[key]}>
                <input id={MEASURE_ID(key)} type="text" inputMode="decimal" autoComplete="off" enterKeyHint={index < MEASURES.length - 1 ? 'next' : 'done'} value={form[key]}
                  onChange={event => setForm({ [key]: event.target.value })} onKeyDown={nextOnEnter(index < MEASURES.length - 1 ? MEASURES[index + 1].key : 'submit')}
                  className="rf-field rf-field--measure" {...invalidProps(MEASURE_ID(key), errors[key])} />
              </Field>)}
            </div>
          </fieldset>
        </div>

        <div className="space-y-3">
          <label className="rf-check" htmlFor="rf-damaged">
            <input id="rf-damaged" type="checkbox" checked={form.abime} onChange={event => setForm({ abime: event.target.checked })} />
            <span className="text-[17px] font-semibold">Carton abîmé ou ouvert</span>
            <span className="rf-muted ml-auto hidden text-[15px] sm:inline">{form.abime ? 'Photo demandée' : 'Une photo sera demandée'}</span>
          </label>
          {form.abime && <div className="rf-card space-y-3 rounded-2xl p-4">
            <p className="text-[16px] font-bold">Photo du carton <span className="rf-label-hint">· obligatoire</span></p>
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
        </div>

        <fieldset className="min-w-0">
          <legend className="rf-label">Produits interdits en avion <span className="rf-label-hint">· touchez ce que vous repérez</span></legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {forbidden.map(item => {
              const checked = form.interdits.includes(item);
              return <button key={item} type="button" aria-pressed={checked} className="rf-chip"
                onClick={() => setForm({ interdits: checked ? form.interdits.filter(entry => entry !== item) : [...form.interdits, item] })}>
                {checked && <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />}{item}
              </button>;
            })}
          </div>
          {form.interdits.length > 0 && <p className="rf-error">Produit interdit signalé : {form.interdits.join(', ')}. Ce carton ne pourra peut-être pas voyager en avion. Le dossier sera à régler avant sa préparation.</p>}
        </fieldset>
      </fieldset>

      <div className="space-y-2 pt-1">
        <button ref={submitRef} id={ID.submit} type="button" onClick={add} disabled={lockedInput} className="rf-primary brand-bg flex w-full items-center justify-center gap-2.5 px-4">
          {saving ? 'Enregistrement…' : 'Ajouter ce carton'}{!saving && <ArrowRight size={22} aria-hidden="true" />}
        </button>
        <p className="rf-muted text-center text-[15px]">{newMode ? 'Le brouillon est créé avec ce carton.' : 'Le carton est enregistré tout de suite.'} {channel ? 'Le client est prévenu quand vous validez la réception.' : 'Vous validerez ensuite la réception.'}</p>
      </div>
      <p role="status" aria-live="polite" className={status && !failure ? 'rf-muted text-center text-[15px] font-semibold' : 'sr-only'}>{status}</p>
      {failure && !failure.uncertain && <Note tone="danger" role="alert" title="Le carton n’est pas enregistré">{failure.message}</Note>}
    </>}

    {savedHere > 0 && <div className="rf-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="rf-muted text-[16px]">{count(savedHere, 'carton enregistré', 'cartons enregistrés')} pendant cette réception.</p>
      <button type="button" onClick={onOpenValidation} disabled={saving} className="rf-secondary inline-flex items-center gap-2 px-5">Aller à la validation<ArrowRight size={20} aria-hidden="true" /></button>
    </div>}
  </section>;
}

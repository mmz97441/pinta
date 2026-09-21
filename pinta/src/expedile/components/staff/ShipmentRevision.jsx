import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { RECEPTION_MEASURES } from '../../domain/reception';
import { normalizedRevisionBoxes, revisionHasQuote, revisionLockedReason, revisionMeasurementIssues, sameRevisionBoxes, shipmentRevisionBoxes } from '../../domain/shipmentRevision';
import { draftKey, readDraft, removeDraft, writeDraft } from '../../lib/draftStore';
import { hasCurrentPreparation } from '../../domain/preparationReadiness';

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40';
const emptyBox = () => ({ dimL: '', dimW: '', dimH: '', poids: '' });
const display = value => value === '' || value == null ? '—' : String(value).replace('.', ',');
const copy = boxes => boxes.map(box => ({ ...box }));

/** The host supplies the server command; this component never changes status or sends a message. */
export default function ShipmentRevision(props) {
  return <RevisionEditor key={`${props.draftOwnerId || ''}:${props.colis.id}:${props.phase}`} {...props} />;
}

function RevisionEditor({ colis, phase, canEdit = false, draftOwnerId, onSave, onReload, onContinue, nextLabel = 'Voir la suite du dossier' }) {
  const key = draftKey(draftOwnerId, `shipment-revision:${colis.id}:${phase}`);
  const [cached] = useState(() => {
    const saved = readDraft(key, null);
    return Array.isArray(saved?.boxes) && Array.isArray(saved?.baseline) && saved.expectedUpdatedAt ? saved : null;
  });
  const [editing, setEditing] = useState(Boolean(cached));
  const [boxes, setBoxes] = useState(() => copy(cached?.boxes || shipmentRevisionBoxes(colis, phase)));
  const [baseline, setBaseline] = useState(() => copy(cached?.baseline || shipmentRevisionBoxes(colis, phase)));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(cached?.expectedUpdatedAt || colis.updatedAt);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState([]);
  const [notice, setNotice] = useState('');
  const [lastSaved, setLastSaved] = useState(null);
  const [focusTarget, setFocusTarget] = useState(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const pending = useRef(false);
  const mounted = useRef(false);
  const formRef = useRef(null);
  const feedbackRef = useRef(null);
  const fieldRefs = useRef({});
  const savedBoxes = shipmentRevisionBoxes(colis, phase);
  const dirty = !sameRevisionBoxes(boxes, baseline);
  const needsCertification = phase === 'preparation' && !hasCurrentPreparation(colis);
  const canSaveChanges = dirty || needsCertification;
  const stale = conflict || editing && expectedUpdatedAt !== colis.updatedAt;
  const locked = revisionLockedReason(colis, phase) || (!canEdit ? 'Votre accès permet de consulter ces mesures, sans les modifier.' : !onSave ? 'La correction des mesures est momentanément indisponible.' : '');
  const receipt = phase === 'reception';
  const title = receipt ? 'Mesures à réception — avant optimisation' : 'Mesures après optimisation';
  const unit = receipt ? 'Carton' : 'Colis préparé';
  const hasQuote = revisionHasQuote(colis);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (editing && dirty) {
      setStorageAvailable(writeDraft(key, { boxes, baseline, expectedUpdatedAt }));
    } else removeDraft(key);
    const warn = event => { if (editing && dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [key, editing, dirty, boxes, baseline, expectedUpdatedAt]);
  // A single focus owner runs once the requested field and its inline error
  // exist. A separate error effect must never take focus back from that field.
  useLayoutEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget.kind === 'field'
      ? fieldRefs.current[`${focusTarget.index}:${focusTarget.name}`]
      : focusTarget.kind === 'form' ? formRef.current : feedbackRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: focusTarget.kind === 'field' ? 'center' : 'nearest', behavior: 'auto' });
  }, [focusTarget]);

  function reset(source, message = '') {
    const next = shipmentRevisionBoxes(source, phase);
    setBoxes(copy(next)); setBaseline(copy(next)); setExpectedUpdatedAt(source.updatedAt);
    setConflict(false); setError(''); setIssues([]); setNotice(message);
    setFocusTarget(null);
    removeDraft(key);
  }
  function focusField(index, name) {
    setFocusTarget({ kind: 'field', index, name });
  }
  function showError(message) {
    setError(message);
    setFocusTarget({ kind: 'feedback' });
  }
  function start() {
    if (locked || pending.current) return;
    reset(colis); setEditing(true); setLastSaved(null);
    focusField(0, 'dimL');
  }
  function change(index, field, value) {
    setBoxes(previous => previous.map((box, position) => position === index ? { ...box, [field]: value } : box));
    setIssues([]); setError(''); setNotice('');
  }
  function cancel() {
    if (pending.current) return;
    reset(colis, 'Modification annulée. Les mesures enregistrées sont conservées.');
    setEditing(false); setLastSaved(null);
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true; setReloading(true); setError('');
    try {
      const fresh = onReload ? await onReload() : colis;
      if (!mounted.current) return;
      if (!fresh?.id || fresh.id !== colis.id || !fresh.updatedAt) throw new Error('Le rechargement n’a pas été confirmé. Votre saisie est conservée.');
      reset(fresh, 'Les mesures enregistrées ont été rechargées. Vous pouvez reprendre votre correction.');
      setFocusTarget({ kind: 'form' });
    } catch (failure) {
      if (mounted.current) showError(failure.message || 'Rechargement impossible. Votre saisie est conservée.');
    } finally { pending.current = false; if (mounted.current) setReloading(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (pending.current || locked) return;
    if (!canSaveChanges) { setNotice('Aucune modification à enregistrer. Le dossier reste inchangé.'); return; }
    if (stale) { showError('Le dossier a changé. Rechargez les mesures enregistrées avant de poursuivre. Votre saisie reste affichée.'); return; }
    const invalid = revisionMeasurementIssues(boxes, phase, savedBoxes.length);
    if (invalid.length) {
      setIssues(invalid); setError(invalid[0].message);
      focusField(invalid[0].index, invalid[0].key);
      return;
    }
    if (!expectedUpdatedAt) { showError('Rechargez le dossier avant de corriger ses mesures. Votre saisie est conservée.'); setConflict(true); return; }
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await onSave(phase, normalizedRevisionBoxes(boxes), expectedUpdatedAt);
      if (!mounted.current) return;
      if (!saved?.id || saved.id !== colis.id || !saved.updatedAt) throw new Error('L’enregistrement n’a pas été confirmé. Rechargez le dossier pour vérifier ses mesures.');
      reset(saved, `${receipt ? 'Mesures à réception' : 'Mesures après optimisation'} enregistrées.${hasQuote ? ' Le devis doit être recalculé et vérifié.' : ''} Aucun message envoyé au client.`);
      setEditing(false); setLastSaved(saved);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure.code === '40001') setConflict(true);
      showError(failure.message || 'Enregistrement impossible. Votre saisie est conservée. Réessayez.');
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  return <section aria-label={title} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid={`shipment-revision-${phase}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-800">{title}</h2><p className="mt-1 text-sm text-slate-600">{receipt ? 'Les cartons tels qu’ils ont été reçus.' : 'Les colis prêts à partir après réemballage.'}</p></div>{!editing && !locked && <button type="button" onClick={start} className={BUTTON}>Modifier</button>}</div>
    {!editing && <ol className="space-y-2">{savedBoxes.map((box, index) => <li key={index} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p className="font-semibold">{unit} {index + 1}</p><p className="mt-1">{display(box.dimL)} × {display(box.dimW)} × {display(box.dimH)} cm · {display(box.poids)} kg</p></li>)}</ol>}
    {locked && <p role={editing ? 'alert' : undefined} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{locked}{editing && ' Votre saisie reste affichée ; aucune modification ne peut être enregistrée.'}</p>}
    {error && <p ref={feedbackRef} tabIndex={-1} role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {editing && <form ref={formRef} tabIndex={-1} noValidate onSubmit={save} className="space-y-4">
      {stale && <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p>Une autre modification a été enregistrée. Votre saisie est conservée.</p><details><summary className="min-h-11 cursor-pointer py-3 font-semibold">Voir les mesures actuellement enregistrées</summary><ol className="space-y-2">{savedBoxes.map((box, index) => <li key={index}>{unit} {index + 1} : {display(box.dimL)} × {display(box.dimW)} × {display(box.dimH)} cm · {display(box.poids)} kg</li>)}</ol></details><p>Recharger remplace votre saisie par les mesures enregistrées dans le dossier.</p><button type="button" disabled={busy || reloading} onClick={reload} className={BUTTON}>{reloading ? 'Rechargement…' : 'Recharger les mesures enregistrées'}</button></div>}
      {!storageAvailable && <p role="status" className="text-sm text-slate-600">La saisie reste disponible dans cet onglet. Gardez-le ouvert jusqu’à l’enregistrement.</p>}
      {boxes.map((box, index) => <fieldset key={index} className="space-y-3 rounded-xl border border-slate-200 p-3"><legend className="px-1 font-semibold text-slate-800">{unit} {index + 1}</legend><div className="grid grid-cols-2 gap-3">{RECEPTION_MEASURES.map(({ key: field, label, unit: fieldUnit }) => {
        const id = `revision-${phase}-${colis.id}-${index}-${field}`;
        const invalid = issues.some(issue => issue.index === index && issue.key === field);
        return <label key={field} htmlFor={id} className="block text-sm font-semibold text-slate-700">{label} ({fieldUnit})<input id={id} ref={node => { fieldRefs.current[`${index}:${field}`] = node; }} aria-label={`${label} · ${unit.toLocaleLowerCase('fr')} ${index + 1} (${fieldUnit})`} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} type="text" inputMode="decimal" disabled={busy || reloading || Boolean(locked)} value={box[field]} onChange={event => change(index, field, event.target.value)} className={`mt-1 min-h-11 min-w-0 w-full rounded-xl border ${invalid ? 'border-red-500' : 'border-slate-300'} bg-white px-3 py-2 text-base font-normal disabled:opacity-50`} />{invalid && <span id={`${id}-error`} className="mt-1 block text-sm font-normal text-red-700">Valeur supérieure à zéro requise.</span>}</label>;
      })}</div>{!receipt && boxes.length > 1 && <button type="button" disabled={busy || reloading || Boolean(locked)} onClick={() => { setBoxes(previous => previous.filter((_, position) => position !== index)); setError(''); setIssues([]); }} className={BUTTON}><X size={16} />Retirer le colis préparé {index + 1}</button>}</fieldset>)}
      {!receipt && <button type="button" disabled={busy || reloading || Boolean(locked) || boxes.length >= 100} onClick={() => { const index = boxes.length; setBoxes(previous => [...previous, emptyBox()]); setNotice(''); focusField(index, 'dimL'); }} className={BUTTON}><Plus size={16} />Ajouter un colis préparé</button>}
      <div className={`rounded-xl p-3 text-sm ${hasQuote ? 'border border-amber-300 bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`} aria-label="Conséquences de la modification"><p className="font-semibold">Avant d’enregistrer</p><p className="mt-1">{hasQuote ? `${needsCertification ? 'Confirmer cette préparation retirera' : 'Si les mesures changent, la correction retirera'} le devis enregistré et son lien de paiement éventuel. Il faudra recalculer, vérifier et envoyer un nouveau devis.` : 'Ces mesures remplaceront les valeurs enregistrées et serviront au prochain calcul du devis.'}</p><p className="mt-2">{receipt ? 'Les mesures après optimisation' : 'Les mesures à réception'}, l’accord du client et les factures sont conservés. Aucun message ne sera envoyé au client.</p></div>
      {!dirty && <p className="text-sm text-slate-600">{needsCertification ? 'Vérifiez les mesures conservées, puis enregistrez-les pour confirmer les colis préparés.' : 'Aucune modification à enregistrer.'}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || reloading || !canSaveChanges || stale || Boolean(locked)} className={PRIMARY}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" disabled={busy || reloading} onClick={cancel} className={BUTTON}>Annuler</button></div>
    </form>}
    {!editing && lastSaved && onContinue && <button type="button" onClick={() => onContinue(phase, lastSaved)} className={PRIMARY}>{nextLabel}</button>}
  </section>;
}

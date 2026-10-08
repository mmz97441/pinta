import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Send, Mail, AlertTriangle, RefreshCw, ArrowRight, Check, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DESTINATIONS } from '../../constants';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { BUSINESS_FIELDS, INVOICE_IDENTITY_FIELD_ORDER, businessDraftValues, businessSettingsPayload, invoiceIdentityDraftValues, invoiceIdentitySettingsPayload, invoicePartyState, sameStoredValue, validateBusinessValues } from '../../domain/businessSettings';
import { CONSIGNEE_KEYS, PARTY_FIELDS, PARTY_LABELS, REQUIRED_PARTY_FIELDS, invoiceIdentity, normalizeParty, validateInvoiceIdentity } from '../../domain/invoiceIdentity';
import { fetchSettings } from '../../lib/supabaseData';
import { latestChannelEvent } from '../../domain/channelEvents';
import { parisDateTime } from '../../utils/format';
import TemplateEditor from './TemplateEditor';
import StaffPermissions from './StaffPermissions';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';

const DESTS = Object.values(DESTINATIONS);
const FIELD = 'min-h-11 w-full rounded-xl border border-gray-300 bg-transparent px-3 py-2 text-sm';
const BUTTON = 'min-h-11 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
// Form pattern (CLAUDE.md): uppercase label, 2px border, helper and error under the field.
// border-gray-300, not 200: brand.css forces gray-200 borders in dark mode, which would hide the error border.
const LABEL = 'text-[11px] font-bold uppercase tracking-wider text-gray-600';
const NARROW = 'min-h-11 rounded-xl border-2 border-gray-300 bg-transparent px-3 py-2 text-sm tabular-nums focus:border-blue-400 aria-[invalid=true]:border-red-400';
const PANELS = [
  ['tarifs', 'Tarifs de transport', 'Tarifs et règles', 'perm_finances_modifier_tarifs'],
  ['categories', 'Catégories et taxes', 'Tarifs et règles', 'perm_admin_categories'],
  ['metier', 'Stockage et rappels', 'Tarifs et règles', 'perm_admin_parametres'],
  ['interdits', 'Produits interdits', 'Tarifs et règles', 'perm_admin_produits_interdits'],
  ['facture', 'Facture commerciale', 'Documents', 'perm_admin_parametres'],
  ['telegram', 'Canaux de contact', 'Communication', 'perm_admin_parametres'],
  ['templates', 'Modèles de messages', 'Communication', 'perm_admin_templates'],
  ['users', 'Équipe et accès', 'Équipe', 'perm_admin_utilisateurs'],
];
function Feedback({ notice }) { return notice ? <p role={notice.error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{notice.text}</p> : null; }
function useOperation() {
  const lock = useRef(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null);
  const run = async action => { if (lock.current) return; lock.current = true; setBusy(true); setNotice(null); try { await action(); } catch (error) { setNotice({ error: true, text: `${error.message} Votre saisie est conservée.` }); } finally { lock.current = false; setBusy(false); } };
  return { run, busy, notice, setNotice };
}
function DraftHelp({ storageAvailable }) { return <p className="text-xs text-gray-600">Brouillon conservé lorsque vous changez de rubrique.{!storageAvailable && ' Le stockage du navigateur est indisponible : gardez cet onglet ouvert.'} Les changements ne s’appliquent qu’après enregistrement.</p>; }
function Tariffs() {
  const { tarifs, saveTariffs, sbReady } = useApp();
  const [draft, setDraft, { storageAvailable }] = usePersistentDraft('admin:tariffs', { baseline: tarifs, values: tarifs });
  const { run, busy, notice, setNotice } = useOperation();
  const save = () => run(async () => {
    const values = Object.fromEntries(DESTS.map(d => { const v = draft.values[d.code] || {}; if (![v.base, v.parKg].every(n => n !== '' && n != null && Number.isFinite(Number(n)) && Number(n) >= 0)) throw new Error(`Renseignez les deux tarifs de ${d.label}, positifs ou nuls.`); return [d.code, { base: Number(v.base), parKg: Number(v.parKg) }]; }));
    const saved = await saveTariffs(values, draft.baseline); setDraft({ values: saved, baseline: saved }); setNotice({ text: 'Tous les tarifs ont été enregistrés ensemble. Les devis existants conservent leurs montants.' });
  });
  return <section className="space-y-4"><h2 className="text-lg font-bold">Tarifs de transport</h2><p className="text-sm text-gray-600">Forfait + prix par kilogramme facturable. Les devis déjà enregistrés conservent leur version.</p><DraftHelp storageAvailable={storageAvailable} /><fieldset disabled={busy || !sbReady} className="space-y-4">{DESTS.map(d => <div key={d.code} className="grid gap-3 border-b pb-4 sm:grid-cols-3"><h3 className="self-center font-semibold">{d.label}</h3>{[['base', 'Forfait (€)'], ['parKg', 'Prix par kg (€)']].map(([k, label]) => <label key={k} className="text-sm">{label} · {d.label}<input className={FIELD} type="number" min="0" step="0.01" value={draft.values[d.code]?.[k] ?? ''} onChange={e => setDraft(p => ({ ...p, values: { ...p.values, [d.code]: { ...p.values[d.code], [k]: e.target.value } } }))} /></label>)}</div>)}<div className="flex flex-wrap gap-2"><button className={`${BUTTON} brand-bg text-white`} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer les tarifs'}</button><button className={BUTTON} onClick={() => { setDraft({ baseline: tarifs, values: tarifs }); setNotice({ text: 'Valeurs enregistrées rechargées. Le brouillon a été abandonné.' }); }}>Annuler et recharger</button></div></fieldset><Feedback notice={notice} /></section>;
}
const categoryValues = cat => ({ label: cat?.label || '', codeHs: cat?.codeHs || '', taux: cat?.taux || {} });
function CategoryForm({ category, onClose }) {
  const { saveCategory, sbReady } = useApp();
  const initial = categoryValues(category);
  const [draft, setDraft, { clear, storageAvailable }] = usePersistentDraft(`admin:category:${category?.id || 'new'}`, { baseline: category ? initial : null, values: initial });
  const [dest, setDest] = useState(DESTS[0].code);
  const { run, busy, notice, setNotice } = useOperation();
  const save = () => run(async () => {
    if (draft.values.label.trim().length < 2) throw new Error('Le nom doit contenir au moins deux caractères.');
    const taux = {}; for (const [code, rates] of Object.entries(draft.values.taux)) { if ([rates.om, rates.omr].every(v => v === '' || v == null)) continue; if (![rates.om, rates.omr].every(v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100)) throw new Error(`Renseignez les deux taux de ${DESTINATIONS[code]?.label || code} entre 0 et 100 %.`); taux[code] = { om: Number(rates.om), omr: Number(rates.omr) }; }
    const saved = await saveCategory(category?.id, { ...draft.values, label: draft.values.label.trim(), taux }, draft.baseline);
    if (!category) { clear(); onClose(); } else { const v = categoryValues(saved); setDraft({ baseline: v, values: v }); setNotice({ text: 'Catégorie et taux enregistrés.' }); }
  });
  return <div className="space-y-4 rounded-xl border p-4"><DraftHelp storageAvailable={storageAvailable} /><fieldset disabled={busy || !sbReady} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{[['label', 'Nom de catégorie'], ['codeHs', 'Code douanier (facultatif)']].map(([key, label]) => <label key={key} className="text-sm">{label}<input className={FIELD} value={draft.values[key]} onChange={e => setDraft(p => ({ ...p, values: { ...p.values, [key]: e.target.value } }))} /></label>)}</div><label className="block text-sm">Destination à configurer<select className={FIELD} value={dest} onChange={e => setDest(e.target.value)}>{DESTS.map(d => <option key={d.code} value={d.code}>{d.label}{draft.values.taux[d.code] ? ' · taux renseignés' : ' · à compléter'}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2">{[['om', 'Octroi de mer (%)'], ['omr', 'Octroi de mer régional (%)']].map(([key, label]) => <label key={key} className="text-sm">{label}<input type="number" min="0" max="100" step="0.01" className={FIELD} value={draft.values.taux[dest]?.[key] ?? ''} onChange={e => setDraft(p => ({ ...p, values: { ...p.values, taux: { ...p.values.taux, [dest]: { ...p.values.taux[dest], [key]: e.target.value } } } }))} /></label>)}</div><p className="text-sm text-gray-600">Deux champs vides : destination non configurée, devis bloqué. Indiquez explicitement 0 pour une exonération.</p><div className="flex flex-wrap gap-2"><button className={`${BUTTON} brand-bg text-white`} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer la catégorie'}</button><button className={BUTTON} onClick={() => { clear(); onClose(); }}>Annuler les modifications</button></div></fieldset><Feedback notice={notice} /></div>;
}
function Categories() {
  const { categories, deleteCategory, ask } = useApp(); const [search, setSearch] = useState(''); const [selected, setSelected] = useState(null); const { run, notice, setNotice, busy } = useOperation();
  return <section className="space-y-4"><h2 className="text-lg font-bold">Catégories et taxes</h2><p className="text-sm text-gray-600">Choisissez une catégorie, puis sa destination. Les taux ne changent pas lorsque vous quittez un champ.</p><label className="block text-sm">Rechercher une catégorie<input className={FIELD} type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><button className={BUTTON} onClick={() => setSelected('new')}>Ajouter une catégorie</button>{selected === 'new' && <CategoryForm key="new" onClose={() => setSelected(null)} />}<Feedback notice={notice} />{categories.filter(c => `${c.label} ${c.codeHs || ''}`.toLowerCase().includes(search.toLowerCase())).map(cat => <article key={cat.id} className="rounded-xl border p-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><button className={`${BUTTON} text-left`} aria-expanded={selected === cat.id} onClick={() => setSelected(selected === cat.id ? null : cat.id)}>{cat.label} · {Object.keys(cat.taux || {}).length}/{DESTS.length} destinations</button><button disabled={busy} className={`${BUTTON} text-red-700`} onClick={() => ask(`Supprimer « ${cat.label} » ?`, 'Cette action retire la catégorie et ses taux. Une catégorie utilisée par un article doit être conservée.', () => run(async () => { await deleteCategory(cat.id); setNotice({ text: 'Catégorie supprimée.' }); }), { danger: true })}>Supprimer</button></div>{selected === cat.id && <CategoryForm category={cat} onClose={() => setSelected(null)} />}</article>)}</section>;
}
function NumberField({ name, label, unit, help, value, error, onChange, step, min = 0, width }) {
  const id = `business-${name}`;
  const described = [`${id}-unit`, help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ');
  return <div className="space-y-1">
    <label htmlFor={id} className={LABEL}>{label}</label>
    <div className="flex items-center gap-2"><input id={id} type="number" inputMode="decimal" min={min} step={step} className={`${NARROW} ${width}`} value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={described} onChange={event => onChange(event.target.value)} /><span id={`${id}-unit`} className="text-sm text-gray-600">{unit}</span></div>
    {help && <p id={`${id}-help`} className="mt-0.5 text-[10px] text-gray-500">{help}</p>}
    {error && <p id={`${id}-error`} className="mt-1 text-[11px] text-red-500">{error}</p>}
  </div>;
}
function Business() {
  const { settings, adminSettingsBaseline, saveSettings } = useApp();
  const stored = adminSettingsBaseline.business ?? null;
  const [draft, setDraft, { storageAvailable }] = usePersistentDraft('admin:business', { baseline: stored, values: businessDraftValues(settings) });
  const [errors, setErrors] = useState({});
  const { run, busy, notice, setNotice } = useOperation();
  // An older draft may hold every stored key: only the editable values are read from it.
  const values = businessDraftValues(draft.values);
  const change = key => value => { setDraft(previous => ({ ...previous, values: { ...businessDraftValues(previous.values), [key]: value } })); setErrors(previous => ({ ...previous, [key]: undefined })); };
  const save = () => {
    // Checked before the operation locks the fields, so the first wrong one can take the focus.
    const checked = validateBusinessValues(values);
    setErrors(checked.errors);
    const invalid = BUSINESS_FIELDS.find(key => checked.errors[key]);
    if (invalid) { setNotice(null); document.getElementById(`business-${invalid}`)?.focus(); return; }
    run(async () => {
      // Every stored key is kept (reminder cadences, time zone…): only these three values change.
      const saved = await saveSettings(businessSettingsPayload(draft.baseline, checked.values), draft.baseline);
      setDraft({ baseline: saved, values: businessDraftValues(saved) });
      setNotice({ text: 'Règles enregistrées. Les devis déjà enregistrés conservent leur version.' });
    });
  };
  const reload = () => { setDraft({ baseline: stored, values: businessDraftValues(settings) }); setErrors({}); setNotice({ text: 'Valeurs enregistrées rechargées. Le brouillon a été abandonné.' }); };
  return <section className="space-y-5"><div className="space-y-1"><h2 className="text-lg font-bold">Stockage et rappels</h2><DraftHelp storageAvailable={storageAvailable} /></div>
    <fieldset disabled={busy} className="space-y-6">
      <div className="space-y-3"><h3 className="font-bold">Tarif de stockage de référence</h3><p className="text-sm text-gray-600">Indicatif : les frais de stockage s’ajoutent au devis par l’équipe, jamais automatiquement.</p>
        <div className="flex flex-wrap gap-x-10 gap-y-4"><NumberField name="fraisStockage" label="Frais de stockage" unit="€ par jour" step="0.01" width="w-28" value={values.fraisStockage} error={errors.fraisStockage} onChange={change('fraisStockage')} /><NumberField name="stockageGratuit" label="Stockage gratuit" unit="jours" step="1" width="w-24" value={values.stockageGratuit} error={errors.stockageGratuit} onChange={change('stockageGratuit')} /></div></div>
      <div className="space-y-3 border-t border-gray-200 pt-5"><h3 className="font-bold">Poids volumétrique</h3><NumberField name="diviseurVolumetrique" label="Diviseur du poids volumétrique" unit="cm³/kg" min="1" step="1" width="w-28" help="Longueur × largeur × hauteur (cm) ÷ diviseur. Le devis retient le plus élevé du poids réel et du poids volumétrique." value={values.diviseurVolumetrique} error={errors.diviseurVolumetrique} onChange={change('diviseurVolumetrique')} /></div>
      <div className="flex flex-wrap gap-2"><button className={`${BUTTON} brand-bg text-white`} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer les règles'}</button><button className={BUTTON} onClick={reload}>Annuler et recharger</button></div>
    </fieldset>
    <Feedback notice={notice} />
    <div className="space-y-2 border-t border-gray-200 pt-5"><h3 className="font-bold">Rappels</h3><p className="text-sm text-gray-600">Fonctionnement actuel, sans réglage :</p><ul className="space-y-1 text-sm text-gray-700"><li><span className="font-semibold">Accord du client :</span> quand l’accord manque, la tâche de relance apparaît 48&nbsp;h avant la clôture du départ. Après une demande ou une relance, elle attend sa livraison au client puis 24&nbsp;h ; un envoi en échec ou annulé ne la retarde pas.</li><li><span className="font-semibold">Paiement :</span> les relances se font depuis le dossier.</li></ul><p className="text-sm text-gray-600">Aucune relance n’est envoyée automatiquement au client.</p></div>
  </section>;
}
// ── Facture commerciale ────────────────────────────────────────────────────
// Who sends and who receives, printed at the top of each commercial invoice (domain/invoiceIdentity.js):
// Expedîle as exporter, the consignee of the departure's destination or else the default one. Stored in
// the business object with the storage rules: a save reads the stored object again, keeps all its keys
// and replaces factureCommerciale only.
const PARTY_INPUT = 'min-h-11 w-full rounded-xl border-2 border-gray-300 bg-transparent px-3 py-2 text-sm focus:border-blue-400 aria-[invalid=true]:border-red-400';
// Six columns from 640 px, one on a phone: name, address and its complement, postcode and town, country and contacts, identifiers.
const PARTY_SPANS = { nom: 'sm:col-span-6', adresse: 'sm:col-span-3', complement: 'sm:col-span-3', codePostal: 'sm:col-span-2', ville: 'sm:col-span-4', pays: 'sm:col-span-2', telephone: 'sm:col-span-2', email: 'sm:col-span-2', siret: 'sm:col-span-2', eori: 'sm:col-span-2', tva: 'sm:col-span-2' };
const PARTY_INPUTS = { codePostal: { inputMode: 'numeric' }, telephone: { type: 'tel' }, email: { type: 'email', spellCheck: false }, siret: { inputMode: 'numeric', spellCheck: false }, eori: { autoCapitalize: 'characters', spellCheck: false }, tva: { autoCapitalize: 'characters', spellCheck: false } };
const PARTY_STATES = {
  set: { text: 'Réglé', tone: 'text-green-700', Icon: Check },
  incomplete: { text: 'À compléter', tone: 'text-amber-700', Icon: AlertTriangle },
  default: { text: 'Destinataire par défaut utilisé', tone: 'text-gray-600', Icon: null },
  none: { text: 'Non réglé', tone: 'text-amber-700', Icon: AlertTriangle },
  // The default consignee is optional when every destination has its own: not set is no warning.
  optional: { text: 'Non réglé', tone: 'text-gray-600', Icon: null },
};
const partyFieldId = key => `invoice-${key.replace(/\./g, '-')}`;
// The default consignee, then La Réunion, Mayotte, Guadeloupe and Martinique: the order of the form's fields (and of its errors).
const CONSIGNEE_BLOCKS = CONSIGNEE_KEYS.map(key => (key === 'defaut'
  ? { key, title: 'Destinataire par défaut', group: 'Destinataire par défaut', help: 'Utilisé pour toute destination sans destinataire propre.' }
  : { key, title: DESTINATIONS[key].nom, group: `Destinataire · ${DESTINATIONS[key].nom}`, help: 'Laissez vide pour utiliser le destinataire par défaut.' }));
function PartyState({ state, className = '' }) {
  const { text, tone, Icon } = PARTY_STATES[state];
  return <span data-party-state={state} className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${tone} ${className}`}>{Icon && <Icon size={12} aria-hidden="true" />}{text}</span>;
}
/** The fields of one party; `prefix` keys them as validateInvoiceIdentity keys its errors. */
function PartyFields({ prefix, values, errors, required = false, onChange }) {
  return <div className="grid gap-4 sm:grid-cols-6">{PARTY_FIELDS.map(field => {
    const id = partyFieldId(`${prefix}.${field}`), error = errors[`${prefix}.${field}`], mandatory = REQUIRED_PARTY_FIELDS.includes(field);
    return <div key={field} className={`min-w-0 ${PARTY_SPANS[field]}`}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2"><label htmlFor={id} className={LABEL}>{PARTY_LABELS[field]}</label>{mandatory && <span className="text-[11px] font-semibold" style={{ color: 'var(--text-accent)' }}>obligatoire</span>}</div>
      <input id={id} autoComplete="off" className={PARTY_INPUT} value={values[field]} aria-required={required && mandatory ? 'true' : undefined} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(field, event.target.value)} {...PARTY_INPUTS[field]} />
      {error && <p id={`${id}-error`} className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>;
  })}</div>;
}
/** The stored object as the server holds it now: another administrator may have saved since this page loaded. */
const readStoredBusiness = async () => (await fetchSettings()).settings.business ?? null;
function InvoiceIdentitySettings() {
  const { adminSettingsBaseline, saveSettings } = useApp();
  const stored = adminSettingsBaseline.business ?? null;
  // baseline: the stored identity the form started from; a save never writes over a different one.
  const [draft, setDraft, { storageAvailable }] = usePersistentDraft('admin:invoice-identity', { baseline: stored?.factureCommerciale ?? null, values: invoiceIdentity(stored) });
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(null);
  const blocks = useRef({}), saveButton = useRef(null), reloadButton = useRef(null), focusAfter = useRef(null);
  const { run, busy, notice, setNotice } = useOperation();
  const values = invoiceIdentityDraftValues(draft.values), consignees = values.destinataires;
  useEffect(() => {
    // A save or a reload disables the fields while it runs: once it is over, keyboard focus goes back
    // to the button that started it (or to its place) rather than staying on <body> (WCAG 2.4.3).
    if (busy || !focusAfter.current) return undefined;
    const candidates = focusAfter.current; focusAfter.current = null;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target = candidates.find(element => element?.isConnected && !element.matches(':disabled') && element.getClientRects().length);
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  const change = party => (field, value) => {
    setDraft(previous => {
      const form = invoiceIdentityDraftValues(previous.values);
      return { ...previous, values: party === 'expediteur' ? { ...form, expediteur: { ...form.expediteur, [field]: value } } : { ...form, destinataires: { ...form.destinataires, [party]: { ...form.destinataires[party], [field]: value } } } };
    });
    const key = party === 'expediteur' ? `expediteur.${field}` : `destinataires.${party}.${field}`;
    setErrors(previous => (previous[key] ? { ...previous, [key]: undefined } : previous));
  };
  const save = () => {
    // Checked before the operation locks the fields: the blocks holding an error open, and the first
    // wrong field takes the focus once its message is in the page.
    const checked = validateInvoiceIdentity(values);
    const first = INVOICE_IDENTITY_FIELD_ORDER.find(key => checked.errors[key]);
    if (first) {
      flushSync(() => { setErrors(checked.errors); setConflict(false); setNotice(null); });
      for (const [code, block] of Object.entries(blocks.current)) if (block && Object.keys(checked.errors).some(key => key.startsWith(`destinataires.${code}.`))) block.open = true;
      const field = document.getElementById(partyFieldId(first));
      field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: 'center' });
      return;
    }
    setErrors({}); setConflict(false); setPending('save');
    focusAfter.current = [document.activeElement, saveButton.current];
    run(async () => {
      try {
        const latest = await readStoredBusiness();
        // Someone saved another identity since this form started from the stored one: never written over.
        if (!sameStoredValue(draft.baseline ?? null, latest?.factureCommerciale ?? null)) { setConflict(true); return; }
        const { payload, blocked } = invoiceIdentitySettingsPayload(latest, values);
        if (blocked) throw new Error(blocked);
        const saved = await saveSettings(payload, latest);
        setDraft({ baseline: saved?.factureCommerciale ?? null, values: invoiceIdentity(saved) });
        setNotice({ text: 'Réglages de la facture commerciale enregistrés. Ils s’appliquent aux prochaines factures commerciales et étiquettes imprimées.' });
      } catch (error) {
        if (error?.code === '40001') { setConflict(true); return; }
        throw error;
      } finally { setPending(null); }
    });
  };
  const reload = () => {
    setPending('reload');
    focusAfter.current = [document.activeElement, reloadButton.current];
    run(async () => {
      try {
        const latest = await readStoredBusiness();
        setDraft({ baseline: latest?.factureCommerciale ?? null, values: invoiceIdentity(latest) });
        setErrors({}); setConflict(false);
        setNotice({ text: 'Valeurs enregistrées rechargées. Le brouillon a été abandonné.' });
      } finally { setPending(null); }
    });
  };
  const preview = party => { const value = normalizeParty(party); return [value.nom, [value.codePostal, value.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '); };
  return <section className="space-y-5"><div className="space-y-1"><h2 className="text-lg font-bold">Facture commerciale</h2><DraftHelp storageAvailable={storageAvailable} /></div>
    <fieldset disabled={busy} className="min-w-0 space-y-6">
      <div role="group" aria-labelledby="invoice-expediteur-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h3 id="invoice-expediteur-title" className="font-bold">Expéditeur</h3><PartyState state={invoicePartyState(values.expediteur)} /></div>
        <p className="text-sm text-gray-600">Imprimé en haut de chaque facture commerciale et comme expéditeur sur les étiquettes des colis.</p>
        <PartyFields prefix="expediteur" values={values.expediteur} errors={errors} required onChange={change('expediteur')} />
      </div>
      <div className="space-y-3 border-t border-gray-200 pt-5">
        <div className="space-y-1"><h3 className="font-bold">Destinataire</h3><p className="text-sm text-gray-600">Imprimé en haut de la facture commerciale d’un départ : le destinataire de sa destination, sinon le destinataire par défaut.</p></div>
        <div className="divide-y divide-gray-200 border-y border-gray-200">{CONSIGNEE_BLOCKS.map(({ key, title, group, help }) => {
          const shown = preview(consignees[key]);
          const state = key === 'defaut' ? invoicePartyState(consignees.defaut).replace(/^none$/, 'optional') : invoicePartyState(consignees[key], { fallback: consignees.defaut });
          return <details key={key} ref={node => { blocks.current[key] = node; }} data-consignee={key} className="group">
            <summary className="block min-h-11 cursor-pointer list-none rounded-lg py-2.5 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)] [&::-webkit-details-marker]:hidden">
              {/* The state goes under the name when the row is too narrow for both (a phone, wider fonts). */}
              <span className="flex items-start gap-2"><ChevronRight size={16} aria-hidden="true" className="mt-1 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90" /><span className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-0.5"><span className="min-w-0"><span className="block font-semibold">{title}</span>{shown && <span className="block break-words text-xs text-gray-600">{shown}</span>}</span><PartyState state={state} className="mt-1" /></span></span>
            </summary>
            <div role="group" aria-label={group} className="space-y-3 pb-5 pt-1">
              <p className="text-sm text-gray-600">{help}</p>
              <PartyFields prefix={`destinataires.${key}`} values={consignees[key]} errors={errors} onChange={change(key)} />
            </div>
          </details>;
        })}</div>
      </div>
      <div className="flex flex-wrap gap-2"><button ref={saveButton} type="button" className={`${BUTTON} brand-bg text-white`} onClick={save}>{pending === 'save' ? 'Enregistrement…' : 'Enregistrer'}</button><button ref={reloadButton} type="button" className={BUTTON} onClick={reload}>{pending === 'reload' ? 'Rechargement…' : 'Annuler et recharger'}</button></div>
    </fieldset>
    {conflict && <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>Ces réglages ont été modifiés entre-temps, par un collègue ou dans un autre onglet. Rien n’a été enregistré : rechargez les valeurs enregistrées, puis refaites vos modifications. Votre saisie reste affichée jusque-là.</p><button type="button" disabled={busy} className={`${BUTTON} inline-flex items-center gap-2 bg-white`} onClick={reload}><RefreshCw size={16} aria-hidden="true" />Recharger les valeurs enregistrées</button></div>}
    <Feedback notice={notice} />
  </section>;
}
function Forbidden() {
  const { produitsInterdits, setProduitsInterdits, ask } = useApp(); const [search, setSearch] = useState(''); const [value, setValue] = usePersistentDraft('admin:forbidden:new', ''); const { run, busy, notice, setNotice } = useOperation();
  return <section className="space-y-4"><h2 className="text-lg font-bold">Produits interdits</h2><p className="text-sm text-gray-600">Liste de contrôle utilisée lors de la préparation. Décrivez le produit et la raison lorsque c’est utile, par exemple « Aérosols — transport aérien interdit ».</p><label className="block text-sm">Rechercher un produit<input type="search" className={FIELD} value={search} onChange={e => setSearch(e.target.value)} /></label><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); run(async () => { if (!value.trim()) throw new Error('Indiquez le produit.'); if (produitsInterdits.some(v => v.toLowerCase() === value.trim().toLowerCase())) throw new Error('Ce produit figure déjà dans la liste.'); await setProduitsInterdits([...produitsInterdits, value.trim()]); setValue(''); setNotice({ text: 'Produit ajouté à la liste de contrôle.' }); }); }}><label className="flex-1 text-sm">Produit à ajouter<input className={FIELD} value={value} onChange={e => setValue(e.target.value)} /></label><button disabled={busy} className={`${BUTTON} self-end`}>Ajouter le produit</button></form><Feedback notice={notice} /><ul className="divide-y">{produitsInterdits.filter(v => v.toLowerCase().includes(search.toLowerCase())).map(value => <li key={value} className="flex items-center justify-between gap-3 py-2"><span className="break-words text-sm">{value}</span><button disabled={busy} className={`${BUTTON} shrink-0 text-red-700`} aria-label={`Retirer ${value}`} onClick={() => ask(`Retirer « ${value} » ?`, 'Ce produit ne figurera plus dans la liste de contrôle de préparation.', () => run(async () => { await setProduitsInterdits(produitsInterdits.filter(v => v !== value)); setNotice({ text: 'Produit retiré de la liste.' }); }), { danger: true })}>Retirer</button></li>)}</ul></section>;
}
// comLog lists the messages of this browser session, newest first (AppContext.sendMsg):
// a Telegram entry exists only once Telegram confirmed the delivery, an email entry
// once the draft was opened in the mail application.
const CHANNELS = [
  { key: 'telegram', label: 'Telegram', Icon: Send, perm: 'perm_comm_telegram', allowed: 'Vous pouvez envoyer un message depuis un dossier, après prévisualisation.', denied: 'Votre compte ne dispose pas du droit d’envoi Telegram.', last: 'Dernier message livré', none: 'Aucun message envoyé' },
  { key: 'email', label: 'Email', Icon: Mail, perm: 'perm_comm_email', intro: 'Les emails sont préparés comme brouillons à envoyer depuis votre messagerie.', allowed: 'Vous pouvez préparer un brouillon depuis un dossier, après prévisualisation.', denied: 'Votre compte ne dispose pas du droit de préparer des emails.', last: 'Dernier brouillon préparé', none: 'Aucun brouillon préparé' },
];
function Channels() {
  const { comLog = [], can } = useApp();
  return <section className="space-y-4"><h2 className="text-lg font-bold">Canaux de contact</h2><p className="text-sm text-gray-600">Les messages partent des dossiers, après prévisualisation. Les derniers événements ci-dessous couvrent seulement ce qui a été fait depuis l’ouverture de cette page ; ils ne vérifient pas la disponibilité des services.</p>
    <ul className="border-y border-slate-200">{CHANNELS.map(({ key, label, Icon, perm, intro, allowed, denied, last, none }) => { const event = latestChannelEvent(comLog, key); return <li key={key} data-channel={key} className="flex gap-3 border-t border-slate-200 py-4 first:border-t-0"><Icon size={20} className="mt-0.5 shrink-0 brand-t" aria-hidden="true" /><div className="min-w-0 space-y-1"><h3 className="font-semibold">{label}</h3>{intro && <p className="text-sm text-gray-700">{intro}</p>}<p className="text-sm text-gray-700">{can(perm) ? allowed : denied}</p><p className="text-sm text-gray-600">{event ? <>{last} depuis l’ouverture de cette page : <time dateTime={event.date}>{parisDateTime(event.date)}</time></> : `${none} depuis l’ouverture de cette page.`}</p></div></li>; })}</ul>
    <Link className={`${BUTTON} inline-flex items-center`} to="/conversations">Consulter les conversations et les erreurs d’envoi</Link></section>;
}
/** The shared configuration is not loaded: a skeleton while it loads, then the failure and a retry. Nothing is editable meanwhile. */
function ConfigurationState() {
  const { dataLoading, dataError, retryLoad } = useApp();
  if (dataLoading) return <div role="status" aria-busy="true" className="space-y-5"><span className="sr-only">Chargement de la configuration…</span><div aria-hidden="true" className="space-y-5"><div className="h-6 w-56 max-w-full animate-pulse rounded-lg bg-gray-200" /><div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200" />{[0, 1, 2].map(i => <div key={i} className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-gray-200" /><div className="h-11 w-full animate-pulse rounded-xl bg-gray-200" /></div>)}</div></div>;
  const detail = String(dataError || '').replace(/^Chargement impossible\s*:\s*/, '').trim();
  return <div role="alert" className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-bold text-red-800"><AlertTriangle size={20} aria-hidden="true" />Chargement impossible</h2><p className="text-sm text-gray-700">La configuration n’a pas pu être chargée{detail ? ` (${detail})` : ''}. Aucun réglage n’est modifiable tant qu’elle n’est pas chargée ; rien n’a été enregistré.</p><button type="button" disabled={dataLoading} onClick={retryLoad} className={`${BUTTON} inline-flex items-center gap-2 brand-bg text-white active:scale-[0.98]`}><RefreshCw size={16} aria-hidden="true" />Réessayer</button></div>;
}
export default function StaffSettings() {
  const { can, sbReady, dataLoading, dataError, data = [], clients = [], envois = [] } = useApp(); const [params, setParams] = useSearchParams();
  // The shell's rule (domain/dataLoad.js): nothing read → the failure here; a configuration loaded earlier
  // whose last load failed → read only, under the shell's banner (its reason and « Réessayer »).
  const load = staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) }).state; const panels = PANELS.filter(([, , , perm]) => can(perm)); const wanted = params.get('tab'); const tab = panels.some(([key]) => key === wanted) ? wanted : panels[0]?.[0];
  return <div className="mx-auto max-w-6xl space-y-5 pb-8"><header><h1 className="text-2xl font-bold">Paramètres</h1><p className="text-sm text-gray-600">Configuration partagée · <Link className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4" to="/departs">Organiser les départs<ArrowRight size={14} aria-hidden="true" /></Link></p></header><div className="flex flex-col gap-6 md:flex-row"><nav aria-label="Paramètres" className="shrink-0 space-y-3 md:w-56"><label className="block text-sm md:hidden">Rubrique<select aria-label="Rubrique" className={FIELD} value={tab || ''} onChange={e => setParams({ tab: e.target.value })}>{panels.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="hidden space-y-4 md:block">{[...new Set(panels.map(p => p[2]))].map(group => <div key={group}><p className="px-3 text-xs font-semibold uppercase text-gray-500">{group}</p>{panels.filter(p => p[2] === group).map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={`${BUTTON} mt-1 w-full border-transparent text-left ${tab === key ? 'brand-bg text-white' : ''}`} onClick={() => setParams({ tab: key })}>{label}</button>)}</div>)}</div></nav><section data-testid="settings-panel" aria-label="Réglages de la rubrique" className="card min-w-0 flex-1 p-4 sm:p-6">{!sbReady && load !== 'stale' ? <ConfigurationState /> : !tab ? <p>Aucune rubrique de paramètres n’est autorisée pour votre compte.</p> : <fieldset disabled={!sbReady} className="min-w-0 space-y-4">{!sbReady && <p data-testid="settings-read-only" className="text-sm text-gray-600">Lecture seule : réessayez le chargement depuis le bandeau en haut de la page avant de modifier un réglage.</p>}{tab === 'tarifs' ? <Tariffs /> : tab === 'categories' ? <Categories /> : tab === 'metier' ? <Business /> : tab === 'facture' ? <InvoiceIdentitySettings /> : tab === 'interdits' ? <Forbidden /> : tab === 'telegram' ? <Channels /> : tab === 'templates' ? <TemplateEditor /> : <StaffPermissions />}</fieldset>}</section></div></div>;
}

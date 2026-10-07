import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, Mail, MapPin, Phone, Pencil, Check, X, LogOut, Lock, Download, MessageCircle, FileText, ExternalLink, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import { hasPublishedQuote } from './quoteVisibility';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { BRAND, ABONNEMENTS, DESTINATIONS, getDestByCP } from '../../constants';
import { eur, getPrenom } from '../../utils';
import { plural } from '../../domain/plural';
import { phoneOf, validPhone, missingRequiredFields, refusedClientFields, requiredFieldsPhrase } from '../../domain/clientRequirements';
import { clientDay } from '../../domain/clientJourney';
import { SecureFileLink } from '../ui/SecureFile';
import { currentInvoices } from '../../domain/invoiceDocuments';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import OnboardingOverlay from './OnboardingOverlay';
import { ClientDossiersError, useClientDossiers } from './ClientPortalStates';

const inputClass = 'w-full min-h-11 px-3 rounded-xl border-2 bg-white text-sm text-gray-800 transition-colors duration-200 ease-out';
// [key, label, type, autocomplete, whole row]
const FIELDS = [
  ['nom', 'Nom de famille', 'text', 'family-name'], ['prenom', 'Prénom', 'text', 'given-name'], ['email', 'Email de contact', 'email', 'email', true],
  ['tel', 'Téléphone mobile', 'tel', 'mobile tel'], ['telFixe', 'Téléphone fixe', 'tel', 'home tel'],
  ['adresseLigne1', 'Adresse', 'text', 'address-line1'], ['adresseLigne2', 'Complément d’adresse', 'text', 'address-line2'], ['cp', 'Code postal', 'text', 'postal-code'], ['ville', 'Ville', 'text', 'address-level2'],
];
const PHONES = ['tel', 'telFixe'];
// Mandatory for a client account (decision of 2026-10-07): the database refuses
// emptying a filled one (SQLSTATE 23514); the form says it first, under the field.
// The phone is the mobile or the landline: one number is enough.
const NEEDED = { m: '\u00a0: il est nécessaire à vos expéditions.', f: '\u00a0: elle est nécessaire à la livraison.', d: '\u00a0: il est nécessaire à la livraison.' };
const MANDATORY = {
  prenom: ['Indiquez votre prénom', 'Votre prénom ne peut pas être effacé', NEEDED.m],
  nom: ['Indiquez votre nom de famille', 'Votre nom de famille ne peut pas être effacé', NEEDED.m],
  email: ['Indiquez l’email où vous joindre', 'Votre email ne peut pas être effacé', NEEDED.m],
  tel: ['Indiquez un téléphone, mobile ou fixe', 'Votre téléphone ne peut pas être effacé', NEEDED.d],
  adresseLigne1: ['Indiquez votre adresse', 'Votre adresse ne peut pas être effacée', NEEDED.f],
  cp: ['Indiquez votre code postal', 'Votre code postal ne peut pas être effacé', NEEDED.d],
  ville: ['Indiquez votre ville', 'Votre ville ne peut pas être effacée', NEEDED.f],
};
// « … à compléter » in the read view: each missing detail opens the form on its field.
const TO_COMPLETE = {
  prenom: 'Prénom à compléter', nom: 'Nom de famille à compléter', email: 'Email à compléter',
  tel: 'Téléphone à compléter\u00a0: il est nécessaire à la livraison.', adresseLigne1: 'Adresse à compléter\u00a0: elle est nécessaire à la livraison.',
  cp: 'Code postal à compléter', ville: 'Ville à compléter',
};
const SERVED = Object.values(DESTINATIONS).map(({ code, nom }) => `${nom} (${code})`);
const SERVED_LIST = `${SERVED.slice(0, -1).join(', ')} ou ${SERVED[SERVED.length - 1]}`;
const prefix = (cp) => String(cp || '').trim().slice(0, 3);
const valueOf = (values, key) => key === 'tel' ? phoneOf(values) : values[key];
const FORMAT = {
  email: 'Vérifiez l’email\u00a0: il doit ressembler à nom@exemple.fr.',
  tel: 'Indiquez un numéro mobile d’au moins 9 chiffres, par exemple 0692 12 34 56.',
  telFixe: 'Indiquez un numéro fixe d’au moins 9 chiffres, par exemple 0262 12 34 56.',
  cp: `Indiquez un code postal à cinq chiffres d’une destination desservie\u00a0: ${SERVED_LIST}.`,
};

/** Why a filled value is refused, '' when it is valid. */
function formatError(key, value) {
  if (!value) return '';
  if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return FORMAT.email;
  if (PHONES.includes(key) && !validPhone(value)) return FORMAT[key];
  if (key === 'cp' && (!/^\d{5}$/.test(value) || !DESTINATIONS[prefix(value)])) return FORMAT.cp;
  return '';
}

/** Field errors, in the order of the form; `saved` is the profile as recorded. */
function validate(draft, saved) {
  const errors = {};
  for (const [key, [missing, erased, reason]] of Object.entries(MANDATORY)) {
    if (!valueOf(draft, key)) errors[key] = `${String(valueOf(saved, key) || '').trim() ? erased : missing}${reason}`;
  }
  for (const [key] of FIELDS) { const error = formatError(key, draft[key]); if (error) errors[key] = error; }
  return errors;
}
const TECHNICAL = /failed|fetch|network|violat|constraint|exception|unexpected|syntax|null value|duplicate key|permission denied|error/i;

/** What changing the destination does to open quotes (trigger invalidate_modern_quotes_on_client_change). */
function territoryMessage(previousCp, nextCp, affected) {
  const from = DESTINATIONS[prefix(previousCp)]?.nom;
  const to = DESTINATIONS[prefix(nextCp)]?.nom;
  const refs = affected.map(c => c.ref);
  const list = refs.length > 1 ? `${refs.slice(0, -1).join(', ')} et ${refs[refs.length - 1]}` : refs[0];
  const links = affected.some(c => c.payplugPaymentUrl);
  const change = from && to ? `Votre nouveau code postal change la destination de vos expéditions\u00a0: ${from} → ${to}.` : 'Votre nouveau code postal change la destination de vos expéditions.';
  const quotes = affected.length > 1
    ? `Les devis envoyés pour ${list} ont été calculés pour l’ancienne destination\u00a0: ils seront retirés${links ? ' avec leurs liens de paiement' : ''}, puis notre équipe vous enverra des devis mis à jour.`
    : `Le devis envoyé pour ${list} a été calculé pour l’ancienne destination\u00a0: il sera retiré${links ? ' avec son lien de paiement' : ''}, puis notre équipe vous enverra un devis mis à jour.`;
  return `${change}\n\n${quotes}\n\nAucun règlement n’est demandé d’ici là.`;
}

export default function ClientProfil() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authCl: cl, auth, data, updateClient, refreshColis, signOut, flash, ask } = useApp();
  const { failed } = useClientDossiers();
  const [helpOpen, setHelpOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [telegramError, setTelegramError] = useState('');
  const [invitation, setInvitation] = useState(null);
  const [linking, setLinking] = useState(false);
  const [documents, setDocuments] = useState('devis');
  const inputs = useRef({});
  const heading = useRef(null);
  const [focusField, setFocusField] = useState(null);
  useDocumentTitle('Mon profil');
  // A field refused by the server takes the focus once the form is enabled again.
  useLayoutEffect(() => {
    if (!focusField || saving) return;
    inputs.current[focusField]?.focus();
    setFocusField(null);
  }, [focusField, saving]);
  // A link to a section of the profile (« /profil#telegram-title ») opens on it.
  useEffect(() => {
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  if (!cl) return null;
  const mine = data.filter((c) => c.clientId === cl.id);
  const active = mine.filter((c) => !c.archive && !['livre', 'annule'].includes(c.statut));
  const destination = getDestByCP(cl.cp);
  const fullName = [cl.prenom, cl.nomFamille].filter(Boolean).join(' ') || cl.raisonSociale || cl.nom || 'Mon profil';
  const initial = (cl.prenom || getPrenom(cl) || cl.nom || '?').trim().charAt(0).toUpperCase();
  const invoices = mine.flatMap((c) => { const current = new Set(currentInvoices(c.factures).map(f => f.id)); return (c.factures || []).map(f => ({ ...f, ref: c.ref, colisId: c.id, current: current.has(f.id) })); });
  const estimates = mine.filter(hasPublishedQuote);
  const openQuotes = mine.filter((c) => !c.paiementDate && !c.archive && !['livre', 'annule'].includes(c.statut) && (hasPublishedQuote(c) || c.payplugPaymentUrl));

  // The profile as recorded, as the form shows it (an older address may still be in its former column).
  const saved = { nom: cl.nomFamille || '', prenom: cl.prenom || '', email: cl.email || '', tel: cl.tel || '', telFixe: cl.telFixe || '', cp: cl.cp || '', ville: cl.ville || '', adresseLigne1: cl.adresseLigne1 || cl.adresse || '', adresseLigne2: cl.adresseLigne2 || '' };
  // Details an older account still misses: said in the read view, before any save is refused.
  const missing = missingRequiredFields(saved);
  /** Opens the form, on `focus` when a missing detail was chosen. */
  const startEdit = (focus = null) => {
    setDraft(saved);
    setError(''); setFieldErrors({}); setEditing(true);
    if (focus) setFocusField(focus);
  };
  const cancelEdit = () => { setEditing(false); setDraft({}); setError(''); setFieldErrors({}); };
  const persist = async (values, affected) => {
    setSaving(true); setError('');
    try {
      await updateClient(cl.id, values);
      setEditing(false); setDraft({}); setFieldErrors({});
      // The server withdrew the quotes calculated for the previous destination: read them again.
      if (affected.length) await Promise.allSettled(affected.map((c) => refreshColis(c.id)));
      requestAnimationFrame(() => heading.current?.focus());
    } catch (err) {
      const detail = String(err?.message || '').trim();
      if (err?.code === '23514') {
        // A refusal of the mandatory details: never a success, each field it names says why.
        const keys = refusedClientFields(err).filter((key) => FIELDS.some(([field]) => field === key));
        setError(`Vos coordonnées n’ont pas été enregistrées. Vérifiez ${keys.length > 1 ? 'les champs signalés' : 'le champ signalé'} puis réessayez.`);
        if (keys.length) {
          setFieldErrors((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, formatError(key, values[key]) || (MANDATORY[key] ? `${MANDATORY[key][1]}${MANDATORY[key][2]}` : FORMAT[key])])) }));
          setFocusField(FIELDS.map(([key]) => key).find((key) => keys.includes(key)));
        } else setError('Vos coordonnées n’ont pas été enregistrées\u00a0: le prénom, le nom, l’email, un téléphone, l’adresse, le code postal et la ville sont obligatoires et ne peuvent pas être effacés.');
      } else setError(`Vos coordonnées n’ont pas été enregistrées.${detail && !TECHNICAL.test(detail) ? ` ${detail}` : ' Vérifiez votre connexion puis réessayez.'}`);
    }
    finally { setSaving(false); }
  };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, String(value ?? '').trim()]));
    // A number removed while the other one remains is recorded as none.
    for (const key of PHONES) if (!values[key]) values[key] = null;
    const errors = validate(values, saved);
    setFieldErrors(errors);
    const first = FIELDS.map(([key]) => key).find((key) => errors[key]);
    if (first) { inputs.current[first]?.focus(); return; }
    const affected = prefix(values.cp) !== prefix(cl.cp) ? openQuotes : [];
    if (affected.length) {
      ask(affected.length > 1 ? 'Changer la destination de vos expéditions\u00a0?' : 'Changer la destination de votre expédition\u00a0?', territoryMessage(cl.cp, values.cp, affected), () => persist(values, affected), { okLabel: 'Confirmer ma nouvelle adresse' });
      return;
    }
    await persist(values, []);
  };
  const createInvitation = async () => {
    setLinking(true); setTelegramError('');
    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_telegram_invitation', { p_client_id: cl.id });
      if (rpcError) throw rpcError;
      const link = Array.isArray(result) ? result[0] : result;
      if (!link?.url) throw new Error('Le lien de connexion Telegram est momentanément indisponible. Réessayez dans un instant.');
      setInvitation(link);
    } catch (err) { setTelegramError(err.message || 'Impossible de créer votre invitation Telegram. Réessayez dans un instant.'); }
    finally { setLinking(false); }
  };
  const exportData = () => {
    const profileKeys = ['id', 'nom', 'prenom', 'email', 'tel', 'telFixe', 'cp', 'ville', 'adresseLigne1', 'adresseLigne2', 'abonnement', 'abonnementDebut', 'abonnementFin', 'telegramUsername'];
    const parcelKeys = ['id', 'ref', 'desc', 'statut', 'dateReception', 'trackings', 'dimL', 'dimW', 'dimH', 'poids', 'finL', 'finW', 'finH', 'finP', 'devisTransport', 'devisOM', 'devisOMR', 'devisTVA', 'devisTotal', 'quoteVersion', 'paiementDate', 'paiementMontant'];
    const pick = (record, keys) => Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
    const payload = { exporteLe: new Date().toISOString(), profil: pick(cl, profileKeys), dossiers: mine.map((c) => ({ ...pick(c, hasPublishedQuote(c) ? parcelKeys : parcelKeys.filter((key) => !key.startsWith('devis') && key !== 'quoteVersion')), messages: (c.messages || []).filter((m) => ['staff', 'client'].includes(m.type) && !m.interne).map((m) => pick(m, ['createdAt', 'auteur', 'texte', 'type'])) })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `expedile-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const logout = () => ask('Se déconnecter', 'Vous pourrez retrouver vos expéditions en vous reconnectant.', async () => {
    try { await signOut(); navigate('/', { replace: true }); }
    catch (err) { flash({ msg: err.message, type: 'error' }); }
  }, { okLabel: 'Se déconnecter' });

  const invoiceRow = f => <div key={f.id} className="flex flex-wrap gap-3 items-center py-4 border-b border-gray-100"><FileText size={18} className="text-gray-500" aria-hidden="true" /><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800">{f.vendeur || 'Facture d’achat'}</p><p className="text-sm text-gray-600">{f.ref} · {f.duplicateOfId ? 'Copie retirée' : !f.current ? 'Remplacée' : f.valide ? 'Validée' : f.rejetMotif ? 'À corriger' : 'En cours de vérification'}</p><button onClick={() => navigate(`/colis/${f.colisId}?panel=documents`)} className="min-h-11 text-sm underline">Ouvrir l’expédition</button></div>{f.fichier && <SecureFileLink href={f.fichier} className="text-sm min-h-11 inline-flex gap-2 items-center brand-t font-semibold">Consulter<ExternalLink size={14} aria-hidden="true" /></SecureFileLink>}</div>;
  const field = ([key, label, type, autoComplete, wide]) => {
    const errorId = `profile-${key}-error`;
    // The two phones share one requirement, said under them while no error is shown.
    const describedBy = fieldErrors[key] ? errorId : PHONES.includes(key) ? 'profile-phone-help' : undefined;
    // The mobile is required only while no landline is given.
    const mandatory = key === 'tel' ? !String(draft.telFixe || '').trim() : Boolean(MANDATORY[key]);
    return <div key={key} className={`space-y-1${wide ? ' sm:col-span-2' : ''}`}>
      <label htmlFor={`profile-${key}`} className="block text-sm font-semibold text-gray-700">{label}{mandatory && <span className="font-normal text-gray-600"> (obligatoire)</span>}</label>
      <input id={`profile-${key}`} ref={(element) => { inputs.current[key] = element; }} type={type} autoComplete={autoComplete} inputMode={key === 'cp' ? 'numeric' : undefined} maxLength={key === 'cp' ? 5 : undefined}
        value={draft[key]} aria-invalid={fieldErrors[key] ? 'true' : undefined} aria-describedby={describedBy} disabled={saving}
        onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, [key]: value })); if (fieldErrors[key] || (PHONES.includes(key) && fieldErrors.tel)) setFieldErrors((current) => ({ ...current, [key]: undefined, ...(PHONES.includes(key) ? { tel: undefined } : {}) })); }}
        className={`${inputClass} ${fieldErrors[key] ? 'border-red-600' : 'border-gray-200 focus:border-blue-400'}`} />
      {fieldErrors[key] && <p id={errorId} className="text-sm text-red-700">{fieldErrors[key]}</p>}
    </div>;
  };
  // The mobile, then the landline marked « (fixe) ».
  const phoneText = [[cl.tel, ''], [cl.telFixe, ' (fixe)']].map(([phone, kind]) => String(phone || '').trim() ? `${String(phone).trim()}${kind}` : '').filter(Boolean).join(' · ');
  /** A « … à compléter » button: opens the form on that field. */
  const toComplete = (key) => <button key={key} type="button" onClick={() => startEdit(key)} className="min-h-11 text-left font-semibold underline brand-t">{TO_COMPLETE[key]}</button>;
  const readRows = [
    [User, [cl.prenom, cl.nomFamille].filter(Boolean).join(' ') || (!missing.includes('nom') ? cl.nom : ''), ['prenom', 'nom']],
    [Mail, cl.email, ['email']],
    [Phone, phoneText, ['tel']],
    [MapPin, [saved.adresseLigne1, cl.adresseLigne2, cl.cp, cl.ville].filter(Boolean).join(', '), ['adresseLigne1', 'cp', 'ville']],
  ];
  return <div className="space-y-7 pb-6 anim-fade">
    {helpOpen && <OnboardingOverlay replay onDone={() => setHelpOpen(false)} />}
    <header className="rounded-2xl p-5 sm:p-7 text-white" style={{ background: `linear-gradient(120deg, ${BRAND.navy}, ${BRAND.navyL})` }}>
      <div className="flex items-center gap-4"><div aria-hidden="true" className="w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-xl font-black" style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}>{initial}</div>
        <div className="min-w-0"><p className="text-sm text-white/80">Votre espace personnel</p><h1 className="text-xl font-bold break-words">{fullName}</h1><p className="text-sm text-white/90 mt-1">{destination?.flag} {destination?.nom || cl.ville}</p></div></div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 pt-4 border-t border-white/15 text-sm">{failed ? <span>Vos expéditions s’afficheront ici dès que possible.</span> : <span>{active.length ? <><b>{plural(active.length, 'expédition')}</b> en cours</> : 'Aucune expédition en cours'}</span>}<span>Formule <b>{ABONNEMENTS[cl.abonnement]?.label || cl.abonnement || 'Freemium'}</b></span>{clientDay(cl.abonnementFin) && <span>Échéance&nbsp;: {clientDay(cl.abonnementFin)}</span>}</div>
    </header>
    {failed && <ClientDossiersError compact />}
    <nav aria-label="Rubriques du profil" className="flex flex-wrap gap-2">{[['profile-contact-title', 'Coordonnées'], ['telegram-title', 'Notifications'], ['account-title', 'Compte et sécurité']].map(([id,label]) => <a key={id} href={`#${id}`} className="min-h-11 inline-flex items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold transition-all duration-200 ease-out hover:bg-slate-50">{label}</a>)}</nav>
    <div className="flex flex-wrap gap-3"><button className="min-h-11 text-sm font-semibold underline" onClick={() => setHelpOpen(true)}>Revoir le guide de démarrage</button><a className="min-h-11 inline-flex items-center text-sm font-semibold underline" href="mailto:contact@expedile.fr?subject=Aide%20sur%20mon%20compte">Contacter l’équipe</a></div>
    <section aria-labelledby="profile-contact-title">
      <div className="flex items-center justify-between mb-3"><h2 id="profile-contact-title" ref={heading} tabIndex={-1} className="scroll-mt-24 font-bold text-gray-900 outline-none">Mes coordonnées</h2>{!editing && <button onClick={() => startEdit()} className="inline-flex items-center gap-2 text-sm font-semibold brand-t min-h-11"><Pencil size={15} aria-hidden="true" />Modifier</button>}</div>
      {editing ? <form onSubmit={save} noValidate className="space-y-4" aria-label="Modifier mes coordonnées">
        <div className="grid sm:grid-cols-2 gap-4">
          {FIELDS.filter(([key]) => !PHONES.includes(key) && !['adresseLigne1', 'adresseLigne2', 'cp', 'ville'].includes(key)).map(field)}
          {FIELDS.filter(([key]) => PHONES.includes(key)).map(field)}
          <p id="profile-phone-help" className="sm:col-span-2 -mt-2 text-sm text-gray-600">Un numéro, mobile ou fixe, suffit&nbsp;: il est nécessaire à la livraison.</p>
          {FIELDS.filter(([key]) => ['adresseLigne1', 'adresseLigne2', 'cp', 'ville'].includes(key)).map(field)}
        </div>
        <p className="text-sm text-gray-600">Ces coordonnées servent à la livraison de vos expéditions et aux échanges avec notre équipe. Votre email de connexion reste inchangé.{openQuotes.length > 0 && ' Si votre code postal change de destination, vos devis en cours seront mis à jour par notre équipe.'}</p>
        {error && <p role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">{error}</p>}
        <div className="flex flex-wrap gap-3"><button disabled={saving} className="min-h-11 rounded-xl px-4 brand-bg text-white font-semibold inline-flex items-center gap-2 transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98] disabled:opacity-50"><Check size={16} aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" disabled={saving} onClick={cancelEdit} className="min-h-11 px-4 text-gray-600 inline-flex items-center gap-2"><X size={16} aria-hidden="true" />Annuler</button></div>
      </form> : <>
        {missing.length > 0 && <p data-testid="profile-incomplete" className="mb-3 flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ backgroundColor: 'var(--attention-bg)', borderColor: 'var(--attention-border)', color: 'var(--attention-text)' }}><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Complétez votre profil&nbsp;: {requiredFieldsPhrase(missing)} {missing.length > 1 ? 'sont nécessaires' : 'est nécessaire'} à vos expéditions.</span></p>}
        <div className="divide-y divide-gray-100 border-y border-gray-100">{readRows.map(([Icon, value, keys], i) => {
          const absent = keys.filter((key) => missing.includes(key));
          return <div key={i} className="flex items-center gap-3 py-3 text-sm text-gray-700"><Icon size={17} className="text-gray-500 shrink-0" aria-hidden="true" /><span className="flex min-w-0 flex-col items-start break-words">{value && <span className="max-w-full break-words">{value}</span>}{absent.map(toComplete)}</span></div>;
        })}</div>
      </>}
    </section>
    <section className="rounded-2xl border border-gray-200 p-4 sm:p-5" aria-labelledby="telegram-title"><div className="flex items-start gap-3"><MessageCircle size={22} className="brand-t shrink-0 mt-1" aria-hidden="true" /><div><h2 id="telegram-title" className="scroll-mt-24 font-bold text-gray-900">Recevoir mes nouvelles sur Telegram</h2><p className="text-sm text-gray-600 mt-1">{cl.telegramChatId ? `Votre compte Telegram${cl.telegramUsername ? ` @${cl.telegramUsername}` : ''} est connecté. Les nouvelles de vos expéditions peuvent vous y être envoyées.` : 'Connectez Telegram pour recevoir les demandes de préparation et y répondre rapidement. Vos expéditions restent aussi consultables ici.'}</p></div></div>
      {cl.telegramChatId && <a href="mailto:contact@expedile.fr?subject=Changer%20mon%20compte%20Telegram" className="mt-2 inline-flex min-h-11 items-center text-sm underline">Demander le changement de compte Telegram</a>}
      {!cl.telegramChatId && <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600"><li>Ouvrir Telegram avec le bouton ci-dessous.</li><li>Appuyer sur «&nbsp;Démarrer&nbsp;».</li><li>Revenir ici vérifier la connexion.</li></ol>}
      {telegramError && <p role="alert" className="mt-3 text-sm text-red-700">{telegramError}</p>}
      {!cl.telegramChatId && <div className="mt-4">{invitation ? <><a href={invitation.url} target="_blank" rel="noopener noreferrer" className="inline-flex gap-2 items-center min-h-11 px-4 rounded-xl brand-bg text-white text-sm font-semibold">Connecter Telegram<ExternalLink size={15} aria-hidden="true" /></a><p className="text-sm text-gray-600 mt-2">Ce lien est personnel et à usage unique. Dans Telegram, appuyez sur «&nbsp;Démarrer&nbsp;». Le compte n’est connecté qu’après cette confirmation.</p><button disabled={linking} onClick={createInvitation} className="min-h-11 mt-2 text-sm underline">{linking ? 'Création du lien…' : 'Lien expiré\u00a0? Créer un nouveau lien'}</button></> : <button disabled={linking} onClick={createInvitation} className="min-h-11 px-4 rounded-xl brand-bg text-white text-sm font-semibold disabled:opacity-50">{linking ? 'Création du lien…' : 'Connecter mon Telegram'}</button>}</div>}
    </section>
    <details><summary id="documents-title" className="min-h-11 cursor-pointer py-3 font-bold text-gray-900">Mes documents</summary>
      {failed ? <ClientDossiersError compact title="Vos documents sont momentanément indisponibles" /> : <><div className="flex gap-2 border-b border-gray-200 mb-2">{[['devis', 'Devis'], ['factures', 'Factures d’achat']].map(([key, label]) => <button key={key} onClick={() => setDocuments(key)} aria-pressed={documents === key} className={`min-h-11 px-3 text-sm font-semibold border-b-2 ${documents === key ? 'brand-t border-current' : 'text-gray-600 border-transparent'}`}>{label}</button>)}</div>
      {documents === 'devis' ? (estimates.length ? estimates.map((c) => <button key={c.id} onClick={() => navigate(`/colis/${c.id}`)} className="w-full min-h-14 flex items-center gap-3 py-4 border-b border-gray-100 text-left"><FileText size={18} className="text-gray-500" aria-hidden="true" /><span className="flex-1 font-semibold text-sm text-gray-800">{c.ref}</span><span className="text-sm font-bold brand-t">{eur(c.devisTotal)}</span><ChevronRight size={16} className="text-gray-500" aria-hidden="true" /></button>) : <p className="py-6 text-sm text-gray-600">Vos devis apparaîtront ici une fois vérifiés et envoyés par l’équipe.</p>) : (invoices.length ? <><div>{invoices.filter(f => f.current).map(invoiceRow)}</div>{invoices.some(f => !f.current) && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Anciennes versions et copies</summary>{invoices.filter(f => !f.current).map(invoiceRow)}</details>}</> : <p className="py-6 text-sm text-gray-600">Ajoutez vos factures depuis l’expédition concernée.</p>)}</>}
    </details>
    <section className="border-t border-gray-200 pt-4 space-y-1" aria-labelledby="account-title"><h2 id="account-title" className="scroll-mt-24 font-bold text-slate-800">Compte et sécurité</h2><p className="text-sm text-slate-600 break-words">Email de connexion&nbsp;: {auth?.session?.user?.email || 'Non disponible'}</p><p className="text-sm text-slate-600">Pour utiliser un autre compte, déconnectez-vous ci-dessous.</p><button onClick={() => navigate('/password', { state: { returnTo: '/profil' } })} className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Lock size={17} aria-hidden="true" />Modifier mon mot de passe</button><button onClick={exportData} className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Download size={17} aria-hidden="true" />Télécharger mes données accessibles</button><p className="text-sm text-gray-600 pl-7">Export JSON de votre profil et des expéditions affichées dans votre espace.</p><a href="mailto:contact@expedile.fr?subject=Aide%20sur%20mon%20compte%20Expedile" className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Mail size={17} aria-hidden="true" />Contacter l’équipe par email</a></section>
    <div className="space-y-2"><button onClick={logout} className="min-h-12 w-full rounded-xl border border-gray-200 brand-t font-semibold flex items-center justify-center gap-2 transition-all duration-200 ease-out hover:bg-slate-50 active:scale-[0.98]"><LogOut size={17} aria-hidden="true" />Se déconnecter</button><a href={`mailto:contact@expedile.fr?subject=${encodeURIComponent('Demande de suppression de mon compte Expedîle')}&body=${encodeURIComponent(`Bonjour, je souhaite demander la suppression de mon compte associé à ${cl.email || ''}. Merci de m’indiquer les étapes et les données qui doivent être conservées.`)}`} className="min-h-11 flex items-center justify-center gap-2 text-sm text-gray-600"><Trash2 size={14} aria-hidden="true" />Demander la suppression de mon compte</a><p className="text-sm text-gray-600 text-center">Cette demande ouvre votre messagerie. L’équipe vous confirmera sa prise en charge et les éventuelles données à conserver.</p></div>
  </div>;
}

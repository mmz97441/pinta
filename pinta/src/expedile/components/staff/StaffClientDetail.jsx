import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Crown, Download, FileSpreadsheet, Loader2, Lock, Mail, Phone, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP, DESTINATIONS } from '../../constants';
import { eur, getPrenom, countLabel, formatTelegramHandle, normalizeTelegramUsername } from '../../utils';
import { Badge } from '../ui';
import { exportRecapProExcel, clientPaymentLabel, monthlyProDossiers, proRecapDossier } from '../../utils/exportRecapPro';
import { safeWorkReturn } from '../../domain/personalWork';
import { parisMonth } from '../../domain/parisTime';
import ShareLinkPanel from './ShareLinkPanel';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import * as sb from '../../lib/supabaseData';
import { nextAction } from '../../domain/workQueues';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { receptionCartonManifest } from '../../domain/reception';
import { REQUIRED_CLIENT_FIELDS, REQUIRED_CLIENT_KEYS, COMPLETION_FIELDS, filled, newClientErrors, requiredFieldFormatError, blankingMessage, missingMessage, servedDestination, phoneOf, phoneErrors, validPhone, dialablePhone, refusedClientFields, PHONE_FORMAT_MESSAGE } from '../../domain/clientRequirements';

// ── Shared styles: brand.css tokens, readable in the light and dark themes ─────
const BORDER = 'border-[color:var(--border-subtle)]';
const LABEL = 'block text-[11px] font-bold uppercase tracking-wider text-gray-600';
const FIELD = 'min-h-11 w-full rounded-xl border-2 bg-elevated px-3 py-2 text-sm text-primary outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-75';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl brand-bg px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100';
const SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 dark:border-[color:var(--border-subtle)] bg-elevated px-4 py-2 text-sm font-semibold text-primary transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';
const DANGER = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition-transform duration-200 ease-out active:scale-[0.98]';
const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold';
const ACTIVE_EXCLUDED = ['livre', 'annule'];

const CONTACT_FIELDS = ['nom', 'prenom', 'tel', 'telFixe', 'email', 'telegramUsername', 'ville', 'cp', 'adresseLigne1', 'adresseLigne2', 'commune', 'infosLivraison', 'canal'];
const PHONE_FIELDS = ['tel', 'telFixe'];
// The phone requirement is met by the mobile or the landline (decision of 7 October 2026, as in the database).
const requiredOf = (values, key) => key === 'tel' ? phoneOf(values) : values?.[key];
const PHONE_BLANKING = 'Le téléphone est obligatoire : gardez au moins un numéro, mobile ou fixe.';
const PHONE_HINT = 'Mobile de préférence. Un fixe seul suffit.';
const ADMIN_FIELDS = ['type', 'raisonSociale', 'siret', 'interlocuteur', 'modePaiement', 'notes'];
// What the toast names once these fields are saved.
const ADMIN_PARTS = [[['type'], 'type de client'], [['raisonSociale', 'siret', 'interlocuteur', 'modePaiement'], 'facturation professionnelle'], [['notes'], 'notes internes']];
const SUBSCRIPTION_KEYS = ['abonnement', 'abonnementDebut', 'abonnementFin'];
const PAYMENT_MODES = [['colis', 'Par colis'], ['compte', 'Sur compte'], ['30j', 'À 30 jours'], ['fin_mois', 'En fin de mois'], ['virement', 'Par virement']];
const MOIS_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const omit = (object, keys) => Object.fromEntries(Object.entries(object || {}).filter(([key]) => !keys.includes(key)));
const listFr = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
// Values compared to detect a change: the Telegram username is compared without its @.
const comparable = (key, value) => key === 'telegramUsername' ? normalizeTelegramUsername(value) : String(value ?? '');

/** The editable values of a client, as the forms show them. */
function formValues(cl) {
  return {
    nom: cl.nomFamille !== undefined ? cl.nomFamille || '' : cl.nom || '', prenom: cl.prenom || '', tel: cl.tel || '', telFixe: cl.telFixe || '', email: cl.email || '',
    telegramUsername: formatTelegramHandle(cl.telegramUsername),
    ville: cl.ville || '', cp: cl.cp || '', adresseLigne1: cl.adresseLigne1 || cl.adresse || '', adresseLigne2: cl.adresseLigne2 || '',
    commune: cl.commune || cl.ville || '', infosLivraison: cl.infosLivraison || '', canal: cl.canal || 'telegram',
    type: cl.type || 'particulier', raisonSociale: cl.raisonSociale || '', siret: cl.siret || '', interlocuteur: cl.interlocuteur || '',
    modePaiement: cl.modePaiement || 'colis', notes: cl.notes || '',
  };
}
/** Reads one client again from the database and replaces it in the loaded list. A full
 * reload (retryLoad) would replace the page by the loading view and lose the open tab. */
async function rereadClient(id, setClients) {
  const [row] = await sb.fetchAllRows('clients', query => query.eq('id', id));
  if (!row) throw new Error('Cette fiche n’est plus disponible.');
  const fresh = sb.mapClient(row);
  setClients(previous => previous.map(client => client.id === id ? fresh : client));
  return fresh;
}
const subscriptionValues = cl => ({ abonnement: cl.abonnement || 'freemium', abonnementDebut: cl.abonnementDebut || null, abonnementFin: cl.abonnementFin || null });
const sameSubscription = (a, b) => SUBSCRIPTION_KEYS.every(key => (a?.[key] || null) === (b?.[key] || null));

function InviteClientAccess({ client }) {
  const { setClients, can, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const hintId = useId();
  if (client.userId) return <p className="flex items-center gap-2 text-sm text-green-800"><Check size={14} aria-hidden="true" />Espace client rattaché à cette fiche</p>;
  const reason = !client.email ? 'Enregistrez un email de contact avant d’inviter ce client.'
    : !can('perm_clients_creer') ? 'L’invitation à l’espace client est réservée aux personnes autorisées à créer des fiches clients.' : '';
  async function invite() {
    if (busy || reason) return;
    setBusy(true); setError('');
    try {
      const { data: result, error: functionError } = await supabase.functions.invoke('invite-client-user', { body: { clientId: client.id } });
      if (functionError || result?.error) throw new Error(await functionErrorMessage({ data: result, error: functionError }, 'L’invitation n’a pas pu être envoyée. Vérifiez la configuration des emails.'));
      setSent(true); flash({ msg: result.invitation_sent ? 'Invitation de connexion envoyée par email.' : 'Le compte existant du client est maintenant lié à cette fiche. Il peut utiliser ses identifiants habituels.', type: 'success' });
      // The invitation is done; reading the linked account again only refreshes the page.
      try { await rereadClient(client.id, setClients); } catch { /* the next load shows the link */ }
    } catch (err) { setError(err.message || 'L’invitation n’a pas pu être envoyée.'); }
    finally { setBusy(false); }
  }
  return <div className={`space-y-2 rounded-xl border ${BORDER} p-3`}>
    <p className="text-sm font-bold text-primary">Accès à l’espace client</p>
    <p className="text-sm text-secondary">Invitez le client à définir son mot de passe et à retrouver ses dossiers. Son accès est lié à cette fiche.</p>
    <button type="button" disabled={busy || sent || Boolean(reason)} aria-describedby={reason ? hintId : undefined} onClick={invite} className={PRIMARY}>{busy ? 'Invitation en cours…' : sent ? 'Invitation prise en charge' : 'Inviter à l’espace client'}</button>
    {reason && <p id={hintId} className="flex items-start gap-2 text-sm text-secondary"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{reason}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

function TelegramInvitation({ client }) {
  const { can, flash } = useApp();
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hintId = useId();
  const allowed = can('perm_clients_modifier');
  async function create() {
    if (busy || !allowed) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('create_telegram_invitation', { p_client_id: client.id });
      if (rpcError) throw rpcError;
      const value = Array.isArray(data) ? data[0] : data;
      if (!value?.url) throw new Error('Invitation indisponible');
      setInvitation(value);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(invitation.url); flash('Lien copié'); }
    catch { setError('Sélectionnez le lien pour le copier manuellement.'); }
  };
  const mail = client.email && invitation ? `mailto:${client.email}?subject=${encodeURIComponent('Votre connexion Telegram Expedîle')}&body=${encodeURIComponent(`Bonjour ${getPrenom(client)},\n\nLiez votre Telegram à votre dossier Expedîle avec ce lien personnel : ${invitation.url}\n\nL’équipe Expedîle`)}` : null;
  return <div className={`space-y-2 rounded-xl border ${BORDER} p-3`}>
    <p className="text-sm font-bold text-primary">{client.telegramChatId ? 'Telegram lié' : 'Lier le Telegram du client'}</p>
    <p className="text-sm text-secondary">Le client ouvre son lien personnel puis appuie sur « Démarrer ». Le lien reste valable 24 heures et ne sert qu’une fois.</p>
    {invitation ? <>
      <input readOnly aria-label="Lien personnel Telegram" value={invitation.url} onClick={(e) => e.target.select()} className={`${FIELD} border-gray-200`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={PRIMARY}>Copier le lien</button>
        {mail && <a href={mail} className={SECONDARY}><Mail size={16} aria-hidden="true" />Préparer un email</a>}
        <button type="button" onClick={create} disabled={busy || !allowed} className={SECONDARY}>Renouveler le lien</button>
      </div>
    </> : <button type="button" onClick={create} disabled={busy || !allowed} aria-describedby={!allowed ? hintId : undefined} className={PRIMARY}><Send size={16} aria-hidden="true" />{busy ? 'Création…' : 'Créer une invitation personnelle'}</button>}
    {!allowed && <p id={hintId} className="flex items-start gap-2 text-sm text-secondary"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Votre rôle ne permet pas de créer cette invitation : elle est réservée aux personnes autorisées à modifier les fiches clients. Demandez-la à un responsable.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

// ── Empty draft ──────────────────────────────────────────────────────────────
const emptyDraft = () => ({
  nom: '', prenom: '', genre: '', dateNaissance: '',
  tel: '', telFixe: '', email: '',
  ville: '', cp: '', adresseLigne1: '', adresseLigne2: '', commune: '', infosLivraison: '',
  telegramUsername: '', canal: 'telegram',
  type: 'particulier', modePaiement: 'colis',
  abonnement: 'freemium', abonnementDebut: '', abonnementFin: '',
  notes: '',
  // Pro fields
  raisonSociale: '', siret: '', interlocuteur: '',
});

// ── Toggle button pair ───────────────────────────────────────────────────────
function TogglePair({ value, onChange, options, labelledBy }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className={`flex overflow-hidden rounded-xl border ${BORDER}`}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            type="button"
            key={opt.value}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-bold transition-transform duration-200 ease-out active:scale-[0.98] ${active ? 'brand-bg text-white' : 'bg-transparent text-secondary hover:bg-surface'}`}
          >
            {active && <Check size={14} strokeWidth={3} aria-hidden="true" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Validated input field ────────────────────────────────────────────────────
// `required`: « obligatoire » beside the label (the label itself stays the accessible name).
// `toComplete`: an older record still misses this required value (non-blocking).
// `highlight`: the field a « Compléter la fiche » link opened.
function ValidatedField({ label, value, onChange, placeholder, type = 'text', mono, error, valid, hint, name, autoComplete, className = '', required = false, toComplete = false, highlight = false, multiline = false }) {
  const id = useId();
  const border = error ? 'border-red-400 dark:border-red-400'
    : toComplete ? 'border-[color:var(--attention-border)] dark:border-[color:var(--attention-border)]'
      : valid ? 'border-green-400' : 'border-gray-200';
  const describedBy = [error && `${id}-error`, !error && toComplete && `${id}-todo`, !error && hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  const Control = multiline ? 'textarea' : 'input';
  return (
    <div className={className}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <label htmlFor={id} className={LABEL}>
          {label}
          {valid && <Check size={11} className="ml-1 inline text-green-700" aria-hidden="true" />}
        </label>
        {required && <span className="text-[11px] font-semibold" style={{ color: 'var(--text-accent)' }}>obligatoire</span>}
      </div>
      <Control
        id={id}
        name={name}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...(multiline ? { rows: 2 } : { type, autoComplete })}
        className={`${FIELD} ${border} ${mono ? 'font-mono' : ''} ${multiline ? 'resize-y' : ''} ${highlight ? 'ring-2 ring-[color:var(--attention-border)]' : ''}`}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">{error}</p>}
      {!error && toComplete && <p id={`${id}-todo`} className="mt-1 text-xs font-semibold" style={{ color: 'var(--attention-text)' }}>À compléter</p>}
      {hint && !error && <div id={`${id}-hint`} className="mt-1 text-xs text-secondary">{hint}</div>}
    </div>
  );
}

// A label beside its select (not around it): the accessible name stays the label alone.
function SelectField({ label, value, onChange, children, name, className = '' }) {
  const id = useId();
  return <div className={className}>
    <label htmlFor={id} className={`${LABEL} mb-1`}>{label}</label>
    <select id={id} name={name} className={`${FIELD} border-gray-200`} value={value} onChange={onChange}>{children}</select>
  </div>;
}

/** Save and cancel of one form: they sit under the fields they save. */
function FormFooter({ dirty, saving, disabled, onCancel }) {
  return <div className={`flex flex-wrap items-center gap-2 border-t ${BORDER} pt-4`}>
    <button type="submit" disabled={!dirty || saving || disabled} className={`${PRIMARY} flex-1 sm:flex-none`}>
      {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
      {saving ? 'Enregistrement…' : 'Enregistrer'}
    </button>
    <button type="button" onClick={onCancel} disabled={saving} className={SECONDARY}><X size={16} aria-hidden="true" />Annuler</button>
    <p className="w-full text-sm text-secondary" aria-live="polite">{saving ? 'Enregistrement en cours…' : dirty ? 'Modifications non enregistrées.' : 'Aucune modification à enregistrer.'}</p>
  </div>;
}

function DetailSkeleton() {
  return <div role="status" aria-label="Chargement de la fiche client" className="mx-auto max-w-3xl space-y-4 pb-24 pt-1">
    <div className="h-11 w-44 animate-pulse rounded-xl bg-gray-100" />
    <div className={`space-y-4 rounded-2xl border ${BORDER} bg-elevated p-4`}>
      <div className="flex items-start gap-3"><div className="size-12 animate-pulse rounded-full bg-gray-100" /><div className="flex-1 space-y-2"><div className="h-6 w-2/3 animate-pulse rounded-lg bg-gray-100" /><div className="h-5 w-1/2 animate-pulse rounded-lg bg-gray-100" /></div></div>
      <div className="flex gap-2">{[0, 1, 2].map(i => <div key={i} className="h-11 w-32 animate-pulse rounded-xl bg-gray-100" />)}</div>
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
    </div>
  </div>;
}

function LoadFailure({ message, onBack }) {
  const { retryLoad, dataLoading } = useApp();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => { if (retrying) return; setRetrying(true); try { await retryLoad(); } finally { setRetrying(false); } };
  const detail = (message || '').replace(/^Chargement impossible : /, '');
  return <section role="alert" className="mx-auto max-w-xl space-y-3 p-6">
    <h1 className="flex items-center gap-2 text-xl font-bold text-primary"><AlertTriangle size={20} className="text-red-700" aria-hidden="true" />Chargement impossible</h1>
    <p className="text-secondary">La fiche client n’a pas pu être chargée{detail ? ` (${detail})` : ''}. Rien n’a été modifié : réessayez dans un instant.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={retry} disabled={retrying || dataLoading} className={PRIMARY}>{retrying || dataLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{retrying || dataLoading ? 'Nouvelle tentative…' : 'Réessayer'}</button>
      <button type="button" onClick={onBack} className={SECONDARY}><ArrowLeft size={16} aria-hidden="true" />Retour aux clients</button>
    </div>
  </section>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component — handles both /clients/new and /clients/:id
// ─────────────────────────────────────────────────────────────────────────────
export default function StaffClientDetail() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const { clients, can, dataLoading, dataError, sbReady } = useApp();
  const isNewRoute = !routeId || routeId === 'new';
  if (isNewRoute) {
    if (!can('perm_clients_creer')) return <p role="alert" className="p-6 text-sm text-secondary">Votre rôle ne permet pas de créer un client.</p>;
    return <NewClientPage onDone={() => navigate('/clients')} onCancel={() => navigate('/clients')} />;
  }
  const existing = clients.find((c) => c.id === routeId);
  if (existing) return <EditClientPage key={existing.id} cl={existing} onDone={() => navigate('/clients')} />;
  // Loading, failed load and missing client are three different situations.
  if (dataLoading) return <DetailSkeleton />;
  if (dataError || !sbReady) return <LoadFailure message={dataError} onBack={() => navigate('/clients')} />;
  return <section className="mx-auto max-w-xl space-y-3 p-6">
    <h1 className="text-xl font-bold text-primary">Client introuvable</h1>
    <p className="text-secondary">Cette fiche n’est pas disponible ou vous n’avez plus accès à ce client.</p>
    <button type="button" className={SECONDARY} onClick={() => navigate('/clients')}><ArrowLeft size={16} aria-hidden="true" />Retour aux clients</button>
  </section>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client page: summary, contact form, administration form
// ─────────────────────────────────────────────────────────────────────────────
function EditClientPage({ cl, onDone }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { clients, data: loaded, can, flash, ask, auth, updateClient, deleteClient, setClients } = useApp();
  // Opened from a dossier (« À vérifier », « Ouvrir la fiche client »): the way back is that dossier.
  const returnTo = safeWorkReturn(new URLSearchParams(location.search).get('returnTo'), '');
  const backToDossier = returnTo.startsWith('/colis/');
  // « Compléter la fiche » links (?completer=adresse…) open the contact form on that field.
  const requestedField = COMPLETION_FIELDS[new URLSearchParams(location.search).get('completer')] || null;
  const [panel, setPanel] = useState(requestedField ? 'contact' : 'overview');
  const [saving, setSaving] = useState(null);
  const [contactError, setContactError] = useState('');
  // The fields a refusal of the database names (SQLSTATE 23514): marked under the field until it changes.
  const [serverErrors, setServerErrors] = useState({});
  const [adminFailures, setAdminFailures] = useState([]);
  const [deleteError, setDeleteError] = useState('');
  const [contactAttempt, setContactAttempt] = useState(0);
  const [adminAttempt, setAdminAttempt] = useState(0);
  const [touched, setTouched] = useState({});
  const [billingOpen, setBillingOpen] = useState(false);
  // The recap opens on the current Paris month, the month its payments are counted in.
  const [billingMonth, setBillingMonth] = useState(() => parisMonth(Date.now()).month);
  const [billingYear, setBillingYear] = useState(() => parisMonth(Date.now()).year);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const contactForm = useRef(null);
  const adminForm = useRef(null);
  const typeLabelId = useId();
  const canalLabelId = useId();
  useEffect(() => {
    let active = true;
    setHistoryLoading(true); setHistoryError('');
    sb.fetchColis(null, { clientId: cl.id }).then((rows) => { if (active) setHistory(rows); })
      .catch((error) => { if (active) setHistoryError(error.message || 'Erreur inconnue'); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [cl.id, historyAttempt]);
  const dossiers = history || loaded.filter((item) => item.clientId === cl.id);
  const actifs = dossiers.filter((p) => !p.archive && !ACTIVE_EXCLUDED.includes(p.statut));
  const received = dossiers.reduce((sum, p) => sum + (Number(p.paiementMontant) || 0), 0);
  const hasColis = dossiers.length > 0;
  const dest = cl.cp ? getDestByCP(cl.cp) : null;
  const knownDestination = dest && DESTINATIONS[String(cl.cp).slice(0, 3)];
  const handle = formatTelegramHandle(cl.telegramUsername);
  // The mobile, then the landline (« fixe »); « Appeler » dials the mobile, else the landline.
  const phones = [{ kind: 'mobile', value: String(cl.tel || '').trim() }, { kind: 'fixe', value: String(cl.telFixe || '').trim() }].filter(phone => phone.value)
    .map((phone, index, list) => ({ ...phone, label: phone.kind === 'fixe' ? 'fixe' : list.length > 1 ? 'mobile' : '' }));
  const callNumber = [cl.tel, cl.telFixe].map(dialablePhone).find(Boolean) || '';
  const canEdit = can('perm_clients_modifier');
  const canEditSubscription = can('perm_clients_modifier_abonnement');

  // ── Drafts: only the changed fields are kept, per browser tab ──────────────
  const baseline = formValues(cl);
  const [changes, setChanges] = usePersistentDraft(`client:changes:${cl.id}`, {});
  const draft = { ...baseline };
  for (const key of [...CONTACT_FIELDS, ...ADMIN_FIELDS]) if (has(changes, key)) draft[key] = changes[key];
  const dirtyOf = keys => keys.filter(key => has(changes, key) && comparable(key, changes[key]) !== comparable(key, baseline[key]));
  const contactDirty = dirtyOf(CONTACT_FIELDS);
  const adminDirty = dirtyOf(ADMIN_FIELDS);
  const patch = (key, value) => {
    setChanges(prev => ({ ...(prev || {}), [key]: value })); setTouched(prev => ({ ...prev, [key]: true }));
    // A field refused by the database is checked again once it changes (both phones answer one requirement).
    setServerErrors(prev => omit(prev, PHONE_FIELDS.includes(key) ? PHONE_FIELDS : [key]));
  };
  const currentSubscription = subscriptionValues(cl);
  const [subscriptionDraft, setSubscriptionDraft, { clear: clearSubscriptionDraft }] = usePersistentDraft(`client:subscription:${cl.id}`, null);
  const subscriptionDirty = Boolean(subscriptionDraft?.values && subscriptionDraft?.baseline) && !sameSubscription(subscriptionDraft.values, subscriptionDraft.baseline);
  const subscription = subscriptionDirty ? subscriptionDraft.values : currentSubscription;
  const patchSubscription = (key, value) => setSubscriptionDraft(prev => {
    const base = prev?.values && prev?.baseline && !sameSubscription(prev.values, prev.baseline) ? prev : { baseline: currentSubscription, values: currentSubscription };
    return { baseline: base.baseline, values: { ...base.values, [key]: value || (key === 'abonnement' ? 'freemium' : null) } };
  });
  // Only a period being changed is checked: a stored period never blocks the other fields.
  const subscriptionError = subscriptionDirty && subscription.abonnementDebut && subscription.abonnementFin && subscription.abonnementFin < subscription.abonnementDebut
    ? 'La fin de l’abonnement doit suivre son début.' : '';
  const adminDirtyCount = (canEdit ? adminDirty.length : 0) + (canEditSubscription && subscriptionDirty ? 1 : 0);

  // ── Duplicate detection ───────────────────────────────────────────────────
  const duplicates = useMemo(() => {
    if (!draft.nom && !draft.tel && !draft.telFixe) return [];
    // Both phones of each client are compared (digits only, the last eight).
    const digits = values => [values.tel, values.telFixe].map(phone => String(phone || '').replace(/\D/g, '')).filter(phone => phone.length >= 6);
    const mine = digits(draft);
    return clients.filter((c) => {
      if (c.id === cl.id) return false;
      const nameLower = (draft.nom || '').toLowerCase().trim();
      const cNameLower = (c.nom || '').toLowerCase().trim();
      const nameMatch = nameLower.length >= 3 && cNameLower.length >= 3 && (cNameLower.includes(nameLower) || nameLower.includes(cNameLower));
      const telMatch = digits(c).some(other => mine.some(phone => phone.endsWith(other.slice(-8)) || other.endsWith(phone.slice(-8))));
      return nameMatch || telMatch;
    });
  }, [cl.id, draft.nom, draft.tel, draft.telFixe, clients]);

  // ── Validation: a changed required field is checked; a filled one cannot be emptied, while an
  // older record that still misses some of them is saved with what is completed (non-blocking). ──
  const contactErrors = {};
  for (const key of REQUIRED_CLIENT_KEYS) {
    if (key === 'tel' || !contactDirty.includes(key)) continue;
    if (!filled(draft[key])) { if (filled(baseline[key])) contactErrors[key] = blankingMessage(key); }
    else { const error = requiredFieldFormatError(key, draft[key]); if (error) contactErrors[key] = error; }
  }
  // The phone: a mobile or a landline. Each changed number must be valid; a record that had a phone keeps
  // one (removing one of two numbers is allowed, as in the database).
  const phonesChanged = PHONE_FIELDS.filter(key => contactDirty.includes(key));
  for (const key of phonesChanged) if (filled(draft[key]) && !validPhone(draft[key])) contactErrors[key] = PHONE_FORMAT_MESSAGE;
  if (phonesChanged.length && !filled(phoneOf(draft)) && filled(phoneOf(baseline))) contactErrors[phonesChanged[0]] = PHONE_BLANKING;
  const toComplete = key => !filled(requiredOf(baseline, key)) && !filled(requiredOf(draft, key));
  const incomplete = REQUIRED_CLIENT_FIELDS.filter(({ key }) => toComplete(key)).map(field => field.noun);
  const shownError = key => serverErrors[key] || ((touched[key] || contactAttempt > 0) ? contactErrors[key] : undefined);
  const contactProps = key => ({
    name: key, value: draft[key], onChange: (event) => patch(key, event.target.value), error: shownError(key),
    valid: touched[key] && filled(draft[key]) && !contactErrors[key] && !serverErrors[key],
  });
  const requiredProps = key => ({
    ...contactProps(key), toComplete: toComplete(key), highlight: requestedField === key && !filled(requiredOf(draft, key)),
  });
  /** Under a field the database refused: what is missing or invalid in it, in the words of the form. */
  const refusalMessage = key => {
    const value = requiredOf(draft, key);
    if (!filled(value)) return key === 'tel' || key === 'telFixe' ? (filled(phoneOf(baseline)) ? PHONE_BLANKING : missingMessage('tel')) : filled(baseline[key]) ? blankingMessage(key) : missingMessage(key);
    return requiredFieldFormatError(key, value) || 'Cette valeur a été refusée : vérifiez-la.';
  };
  // After a refused save, the first invalid field receives the focus.
  useEffect(() => { if (contactAttempt) contactForm.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [contactAttempt]);
  // The field the link asked for comes into view with the focus, once, when the page opens.
  useEffect(() => {
    if (!requestedField) return;
    const field = contactForm.current?.querySelector(`[name="${requestedField}"]`);
    if (!field) return;
    field.scrollIntoView({ block: 'center' });
    field.focus({ preventScroll: true });
  }, [requestedField]);
  useEffect(() => { if (adminAttempt) adminForm.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [adminAttempt]);

  async function saveContact(event) {
    event.preventDefault();
    if (saving) return;
    if (Object.keys(contactErrors).length) { setContactAttempt(n => n + 1); return; }
    const keys = canEdit ? contactDirty : [];
    // Required values are written trimmed (the postal code without spaces); a still-empty one is not written.
    // A phone removed while the other number remains is written empty (null).
    const value = key => PHONE_FIELDS.includes(key) ? String(draft[key] ?? '').trim() || null
      : !REQUIRED_CLIENT_KEYS.includes(key) ? draft[key] : key === 'cp' ? String(draft.cp ?? '').replace(/\s/g, '') : String(draft[key] ?? '').trim();
    const written = keys.filter(key => !REQUIRED_CLIENT_KEYS.includes(key) || filled(value(key)) || (key === 'tel' && filled(baseline.tel)));
    if (!written.length) { setChanges(prev => omit(prev, keys)); return; }
    setSaving('contact'); setContactError(''); setServerErrors({});
    try {
      const payload = Object.fromEntries(written.map(key => [key, value(key)]));
      if (written.includes('adresseLigne1')) payload.adresse = payload.adresseLigne1;
      // `true`: this form reports the outcome itself, under its fields (no toast for a refusal).
      await updateClient(cl.id, payload, true);
      setChanges(prev => omit(prev, keys)); setTouched({}); setContactAttempt(0);
      flash({ msg: 'Coordonnées enregistrées.', type: 'success' });
      setPanel('overview');
    } catch (error) {
      // A refusal of the database guard names its fields: each one is marked, the first takes the focus.
      const refused = error?.code === '23514' ? refusedClientFields(error).filter(key => CONTACT_FIELDS.includes(key)) : [];
      setServerErrors(Object.fromEntries(refused.map(key => [key, refusalMessage(key)])));
      setContactError(`Coordonnées non enregistrées : ${error?.message || 'réessayez.'} Vos saisies sont conservées.`);
      if (refused.length) setContactAttempt(n => n + 1);
    }
    finally { setSaving(null); }
  }

  async function saveAdmin(event) {
    event.preventDefault();
    if (saving) return;
    const keys = canEdit ? adminDirty : [];
    const withSubscription = canEditSubscription && subscriptionDirty;
    if (withSubscription && subscriptionError) { setAdminAttempt(n => n + 1); return; }
    if (!keys.length && !withSubscription) return;
    setSaving('admin'); setAdminFailures([]);
    const saved = []; const failures = [];
    if (keys.length) {
      try {
        await updateClient(cl.id, Object.fromEntries(keys.map(key => [key, draft[key]])), true);
        setChanges(prev => omit(prev, keys));
        saved.push(...ADMIN_PARTS.filter(([fields]) => fields.some(field => keys.includes(field))).map(([, label]) => label));
      } catch (error) { failures.push({ message: `Type, facturation et notes non enregistrés : ${error.message || 'réessayez.'}` }); }
    }
    if (withSubscription) {
      try {
        const result = await sb.saveClientSubscription(cl.id, subscriptionDraft.values, subscriptionDraft.baseline);
        // The command returns the values it wrote; without them, the client is read again.
        if (result && typeof result === 'object' && result.abonnement) {
          const stored = subscriptionValues(result);
          setClients(prev => prev.map(client => client.id === cl.id ? { ...client, ...stored } : client));
        } else await rereadClient(cl.id, setClients);
        clearSubscriptionDraft();
        saved.push('abonnement');
      } catch (error) { failures.push({ conflict: error.code === '40001', message: `Abonnement non enregistré : ${error.message || 'réessayez.'}` }); }
    }
    setSaving(null);
    if (saved.length) flash({ msg: `Modifications enregistrées : ${listFr(saved)}.`, type: 'success' });
    if (failures.length) setAdminFailures(failures);
    else setPanel('overview');
  }

  const cancelContact = () => { setChanges(prev => omit(prev, CONTACT_FIELDS)); setTouched({}); setContactError(''); setServerErrors({}); setContactAttempt(0); setPanel('overview'); };
  const cancelAdmin = () => { setChanges(prev => omit(prev, ADMIN_FIELDS)); clearSubscriptionDraft(); setAdminFailures([]); setAdminAttempt(0); setPanel('overview'); };
  const reloadSubscription = async () => {
    try { await rereadClient(cl.id, setClients); clearSubscriptionDraft(); setAdminFailures([]); flash('Fiche actualisée : vérifiez l’offre enregistrée avant de la modifier.'); }
    catch (error) { setAdminFailures([{ conflict: true, message: `Actualisation impossible : ${error.message || 'réessayez.'}` }]); }
  };

  async function handleDelete() {
    if (historyLoading || historyError) { setDeleteError('Attendez le chargement complet de l’historique avant de supprimer cette fiche.'); return; }
    if (hasColis) return;
    ask(`Supprimer définitivement ${cl.nom} ?`, 'Cette fiche client sera supprimée. Aucun dossier existant ne sera supprimé par cette action.', async () => {
      try { const deleted = await deleteClient(cl.id); if (deleted) onDone(); }
      catch (error) { setDeleteError(error.message || 'Suppression impossible.'); }
    }, { danger: true, okLabel: 'Supprimer la fiche' });
  }

  const tabs = [['overview', 'Synthèse', 0], ['contact', 'Coordonnées', canEdit ? contactDirty.length : 0], ['admin', 'Abonnement et administration', adminDirtyCount]];
  // Navy on gold: 5.6:1 in light, 7.6:1 in dark (the former white on amber read at 2.1:1).
  const typeChip = <>
    {cl.type === 'pro'
      ? <span className={`${CHIP} brand-bg-gold-l`} style={{ color: 'var(--text-accent)' }}>Professionnel</span>
      : <span className={`${CHIP} bg-blue-100 text-blue-700`}>Particulier</span>}
    {cl.abonnement === 'vip' && <span className={CHIP} style={{ background: 'var(--brand-gold)', color: BRAND.navy }}><Crown size={12} strokeWidth={2.5} aria-hidden="true" />VIP</span>}
  </>;
  const billing = (() => {
    const rows = monthlyProDossiers(cl, dossiers, billingMonth, billingYear);
    return { rows, total: rows.reduce((sum, row) => sum + (proRecapDossier(row).devisTotal || 0), 0) };
  })();
  const exportBlocked = !can('perm_export_recap_pro') ? 'L’export du récapitulatif nécessite le droit d’export des récapitulatifs professionnels.'
    : historyLoading ? 'L’export sera possible une fois l’historique complet chargé.'
      : historyError ? 'Historique indisponible : l’export attend un chargement complet.' : '';

  return (
    <div className="anim-fade mx-auto max-w-3xl pb-24">
      <div className="mb-4 pt-1">
        <button
          type="button"
          onClick={() => navigate(backToDossier ? returnTo : '/clients')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-secondary transition-transform duration-200 ease-out hover:bg-surface hover:text-primary active:scale-[0.98]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {backToDossier ? 'Retour au dossier' : 'Retour aux clients'}
        </button>
      </div>

      <div className={`overflow-hidden rounded-2xl border ${BORDER} bg-elevated shadow-sm`}>
        {/* ── Identity: stacked on phones so the name and the contact read whole ── */}
        <header className={`flex flex-col gap-3 border-b ${BORDER} p-4 sm:flex-row sm:items-start`}>
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full text-base font-black" style={{ background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`, color: BRAND.goldL }}>
              {(cl.nom || '?').trim().charAt(0).toUpperCase() || '?'}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="break-words text-xl font-black leading-tight" style={{ color: 'var(--brand-text)' }}>{cl.nom || 'Client sans nom'}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                {cl.ref && <span className={`${CHIP} bg-surface font-mono text-secondary`}>{cl.ref}</span>}
                {typeChip}
                {cl.telegramChatId
                  ? <span className={`${CHIP} bg-green-100 text-green-800`}>Telegram lié</span>
                  : <span className={CHIP} style={{ background: 'var(--attention-bg)', color: 'var(--attention-text)' }}>Telegram non lié</span>}
              </div>
              <p className="text-sm text-secondary">{knownDestination && <span aria-hidden="true">{dest.flag} </span>}{[cl.ville, knownDestination ? dest.nom : null].filter(Boolean).join(' · ') || 'Destination à compléter'}</p>
              {(phones.length > 0 || cl.email || handle) && <ul className="space-y-0.5 text-sm text-secondary">
                {phones.map(({ kind, value, label }) => <li key={kind} className="flex items-start gap-1.5"><Phone size={14} className="mt-1 shrink-0" aria-hidden="true" /><span className="font-mono">{value}</span>{label && <span>· {label}</span>}</li>)}
                {cl.email && <li className="flex items-start gap-1.5"><Mail size={14} className="mt-1 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{cl.email}</span></li>}
                {handle && <li className="flex items-start gap-1.5"><Send size={14} className="mt-1 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">Telegram {handle}</span></li>}
              </ul>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <span className="text-sm text-secondary">{historyLoading ? 'Historique en cours de chargement…' : historyError ? 'Historique indisponible' : `${countLabel(dossiers.length, 'dossier', 'dossiers')} au total`}</span>
            {actifs.length > 0 && <span className={CHIP} style={{ background: 'rgb(27 58 75 / .10)', color: 'var(--brand-text)' }}>{countLabel(actifs.length, 'actif', 'actifs')}</span>}
            {can('perm_clients_voir_finances') && history && received > 0 && <span className="text-sm font-bold text-emerald-700">{eur(received)} encaissés</span>}
          </div>
        </header>

        <nav aria-label="Sections de la fiche client" className={`flex flex-wrap gap-2 border-b ${BORDER} p-3`}>
          {tabs.map(([key, label, dirty]) => <button
            type="button" key={key} onClick={() => setPanel(key)} aria-pressed={panel === key}
            aria-describedby={dirty ? 'client-tab-unsaved' : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-transform duration-200 ease-out active:scale-[0.98] ${panel === key ? 'brand-bg text-white' : 'text-primary hover:bg-surface'}`}
          >
            {label}
            {dirty > 0 && <span aria-hidden="true" title="Modifications non enregistrées" className="inline-block size-2.5 rounded-full" style={{ background: 'var(--brand-gold)' }} />}
          </button>)}
          {/* Description of the tabs holding unsaved changes; outside the buttons, their names stay unchanged. */}
          <span id="client-tab-unsaved" hidden>Modifications non enregistrées</span>
        </nav>

        {panel === 'overview' && <div className="space-y-6 p-4">
          <section aria-label="Contact disponible" className="space-y-3">
            <h2 className="font-bold text-primary">Joindre ce client</h2>
            <p className="text-sm text-secondary">{cl.telegramChatId ? 'Telegram lié' : 'Telegram non lié'} · {cl.userId ? 'Espace client rattaché à cette fiche' : 'Accès au portail à activer'}</p>
            <div className="flex flex-wrap gap-2">
              {callNumber && <a href={`tel:${callNumber}`} className={SECONDARY}><Phone size={16} aria-hidden="true" />Appeler</a>}
              {cl.email && <a href={`mailto:${cl.email}`} className={SECONDARY}><Mail size={16} aria-hidden="true" />Préparer un email</a>}
              {can('perm_colis_receptionner') && <button type="button" onClick={() => navigate(`/reception?${new URLSearchParams({ client: cl.id, returnTo: `/clients/${cl.id}` })}`)} className={PRIMARY}>Réceptionner pour ce client</button>}
            </div>
            {!cl.userId && <InviteClientAccess client={cl} />}
            {!cl.telegramChatId && <TelegramInvitation client={cl} />}
          </section>
          <section aria-labelledby="client-open-shipments" className="space-y-3">
            <h2 id="client-open-shipments" className="font-bold text-primary">Expéditions ouvertes ({actifs.length})</h2>
            {actifs.length ? <ul className="space-y-2">{actifs.map((item) => <li key={item.id}>
              <button type="button" onClick={() => navigate(`/colis/${item.id}`)} className={`flex min-h-20 w-full flex-wrap items-center justify-between gap-3 rounded-xl border ${BORDER} p-3 text-left transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.99]`}>
                <span><strong className="brand-t">{item.ref}</strong><span className="mt-1 block text-sm text-primary">{nextAction(item, cl)}</span><span className="mt-1 block text-sm text-secondary">{countLabel(receptionCartonManifest(item).nbColis, 'carton reçu', 'cartons reçus')}{item.casier ? ` · Casier ${item.casier}` : ''}</span></span>
                <Badge statut={item.statut} />
              </button>
            </li>)}</ul> : <p className="text-sm text-secondary">Aucune expédition ouverte.</p>}
          </section>
          <details className={`rounded-xl border ${BORDER} px-3`}>
            <summary className="min-h-11 cursor-pointer py-3 font-semibold text-primary">{`Historique complet${history ? ` (${countLabel(history.length, 'dossier', 'dossiers')})` : ''}`}</summary>
            <div className="pb-3">
              {historyLoading && <p role="status" className="text-sm text-secondary">Chargement de l’historique, archives comprises…</p>}
              {historyError && !historyLoading && <div role="alert" className="space-y-2 text-sm text-red-700"><p>Historique indisponible : {historyError}</p><button type="button" onClick={() => setHistoryAttempt(n => n + 1)} className={SECONDARY}><RefreshCw size={16} aria-hidden="true" />Réessayer</button></div>}
              {history && !history.length && <p className="text-sm text-secondary">Aucun dossier pour ce client.</p>}
              {history?.length > 0 && <ul>{history.map((item) => <li key={item.id}>
                <button type="button" onClick={() => navigate(`/colis/${item.id}`)} className={`flex min-h-14 w-full items-center justify-between gap-2 border-t ${BORDER} text-left text-sm transition-transform duration-200 ease-out hover:bg-surface`}>
                  <span className="font-semibold brand-t">{item.ref}{item.archive ? ' · Archivé' : ''}</span>
                  <Badge statut={item.statut} />
                </button>
              </li>)}</ul>}
            </div>
          </details>
          <ShareLinkPanel client={cl} currentUserId={auth?.u?.id} flash={flash} ask={ask} />
        </div>}

        {panel === 'contact' && <form ref={contactForm} onSubmit={saveContact} noValidate aria-labelledby="client-contact-title" className="space-y-4 p-4">
          <h2 id="client-contact-title" className="font-bold text-primary">Coordonnées</h2>
          {duplicates.length > 0 && <div className={`anim-fade flex items-start gap-2 rounded-xl border p-3 border-[color:var(--attention-border)] bg-[color:var(--attention-bg)] text-[color:var(--attention-text)]`}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold">Doublon possible</p>
              <ul className="mt-1 space-y-1 text-sm">{duplicates.map((dup) => <li key={dup.id}><span className="font-bold">{dup.nom}</span>{filled(phoneOf(dup)) && <span className="ml-1 font-mono">{phoneOf(dup)}</span>}{dup.email && <span className="ml-1 [overflow-wrap:anywhere]">{dup.email}</span>}</li>)}</ul>
            </div>
          </div>}
          <fieldset disabled={!canEdit || Boolean(saving)} className="space-y-4">
            <legend className="sr-only">Coordonnées du client</legend>
            {incomplete.length > 0 && <p className="flex items-start gap-2 rounded-xl border border-[color:var(--attention-border)] bg-[color:var(--attention-bg)] p-3 text-sm text-[color:var(--attention-text)]"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Fiche incomplète : {listFr(incomplete)} à compléter. Vous pouvez enregistrer les informations complétées dès maintenant.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <ValidatedField label="Nom" required {...requiredProps('nom')} placeholder="NOM" autoComplete="off" />
              <ValidatedField label="Prénom" required {...requiredProps('prenom')} placeholder="Prénom" autoComplete="off" />
              <ValidatedField label="Email" required type="email" {...requiredProps('email')} placeholder="adresse@exemple.com" />
              <ValidatedField label="Identifiant Telegram" name="telegramUsername" value={draft.telegramUsername} onChange={(e) => patch('telegramUsername', e.target.value)} placeholder="@identifiant" autoComplete="off" hint="Le @ est facultatif." />
              {/* One number is required: the mobile, or the landline alone (as in the database). */}
              <ValidatedField label="Téléphone" required={!filled(draft.telFixe)} type="tel" mono {...requiredProps('tel')} placeholder="ex. +262 692 12 34 56" autoComplete="off" hint={PHONE_HINT} />
              <ValidatedField label="Téléphone fixe" type="tel" mono {...contactProps('telFixe')} placeholder="ex. 0262 41 22 33" autoComplete="off" />
            </div>
            <ValidatedField label="Adresse de livraison" required multiline {...requiredProps('adresseLigne1')} placeholder="Numéro, rue, résidence, étage…" />
            <div className="grid gap-3 sm:grid-cols-2">
              <ValidatedField label="Complément d’adresse" name="adresseLigne2" value={draft.adresseLigne2} onChange={(e) => patch('adresseLigne2', e.target.value)} className="sm:col-span-2" />
              <ValidatedField label="Code postal" required mono {...requiredProps('cp')} placeholder="ex. 97400"
                hint={servedDestination(draft.cp) ? <span className="flex items-center gap-1"><span aria-hidden="true">{servedDestination(draft.cp).flag}</span>{servedDestination(draft.cp).nom}</span> : null} />
              <ValidatedField label="Ville" required {...requiredProps('ville')} placeholder="ex. Saint-Denis" />
              <ValidatedField label="Commune de livraison" name="commune" value={draft.commune} onChange={(e) => patch('commune', e.target.value)} />
              <ValidatedField label="Instructions de livraison" name="infosLivraison" value={draft.infosLivraison} onChange={(e) => patch('infosLivraison', e.target.value)} />
            </div>
            <div>
              <p id={canalLabelId} className={`${LABEL} mb-1.5`}>Canal de contact</p>
              <TogglePair labelledBy={canalLabelId} value={draft.canal} onChange={(v) => patch('canal', v)} options={[{ value: 'telegram', label: 'Telegram' }, { value: 'email', label: 'Email' }]} />
            </div>
          </fieldset>
          {!canEdit && <p className="flex items-start gap-2 text-sm text-secondary"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Votre rôle permet de consulter cette fiche. Les modifications sont réservées aux personnes habilitées.</p>}
          {contactError && <p role="alert" className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 p-3 text-sm text-red-800">{contactError}</p>}
          <FormFooter dirty={canEdit && contactDirty.length > 0} saving={saving === 'contact'} disabled={!canEdit} onCancel={cancelContact} />
        </form>}

        {panel === 'admin' && <div className="space-y-6 p-4">
          <form ref={adminForm} onSubmit={saveAdmin} noValidate aria-labelledby="client-admin-title" className="space-y-5">
            <h2 id="client-admin-title" className="font-bold text-primary">Type, facturation et abonnement</h2>
            <fieldset disabled={!canEdit || Boolean(saving)} className="space-y-4">
              <legend className="sr-only">Type de client, facturation et notes internes</legend>
              <div>
                <p id={typeLabelId} className={`${LABEL} mb-1.5`}>Type de client</p>
                <TogglePair labelledBy={typeLabelId} value={draft.type} onChange={(v) => patch('type', v)} options={[{ value: 'particulier', label: 'Particulier' }, { value: 'pro', label: 'Pro' }]} />
              </div>
              {draft.type === 'pro' && <section aria-labelledby="client-pro-billing" className={`space-y-3 rounded-xl border ${BORDER} p-3`}>
                <h3 id="client-pro-billing" className="font-semibold text-primary">Facturation professionnelle</h3>
                {[['raisonSociale', 'Raison sociale'], ['siret', 'SIRET'], ['interlocuteur', 'Interlocuteur']].map(([key, label]) => <ValidatedField key={key} name={key} label={label} value={draft[key]} onChange={e => patch(key, e.target.value)} />)}
                <SelectField label="Modalité de paiement" name="modePaiement" value={draft.modePaiement} onChange={e => patch('modePaiement', e.target.value)}>{PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
              </section>}
              <ValidatedField label="Notes internes" name="notes" multiline value={draft.notes} onChange={(e) => patch('notes', e.target.value)} placeholder="Informations utiles pour l’équipe…" />
            </fieldset>
            {!canEdit && <p className="flex items-start gap-2 text-sm text-secondary"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Le type, la facturation et les notes sont modifiables par les personnes habilitées à modifier les fiches clients.</p>}
            <fieldset disabled={!canEditSubscription || Boolean(saving)} className={`space-y-3 rounded-xl border ${BORDER} p-3`}>
              <legend className="px-1 font-semibold text-primary">Offre et abonnement</legend>
              <SelectField label="Offre" name="abonnement" value={subscription.abonnement} onChange={e => patchSubscription('abonnement', e.target.value)}>{subscription.abonnement === 'premium' && <option value="premium">Premium (offre historique)</option>}{Object.entries(ABONNEMENTS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}</SelectField>
              <div className="grid gap-3 sm:grid-cols-2">
                {[['abonnementDebut', 'Début de l’abonnement'], ['abonnementFin', 'Fin de l’abonnement']].map(([key, label]) => <ValidatedField
                  key={key} name={key} label={label} type="date" value={subscription[key] || ''} onChange={e => patchSubscription(key, e.target.value)}
                  error={key === 'abonnementFin' && adminAttempt > 0 ? subscriptionError || undefined : undefined} />)}
              </div>
              {!canEditSubscription && <p className="flex items-start gap-2 text-sm text-secondary"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Vous pouvez consulter l’offre. Sa modification nécessite le droit Abonnement.</p>}
            </fieldset>
            {adminFailures.length > 0 && <div role="alert" className="space-y-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 p-3 text-sm text-red-800">
              {adminFailures.map(failure => <p key={failure.message}>{failure.message}</p>)}
              <p>Vos saisies non enregistrées sont conservées.</p>
              {adminFailures.some(failure => failure.conflict) && <button type="button" className={SECONDARY} onClick={reloadSubscription}><RefreshCw size={16} aria-hidden="true" />Actualiser la fiche</button>}
            </div>}
            <FormFooter dirty={adminDirtyCount > 0} saving={saving === 'admin'} disabled={!canEdit && !canEditSubscription} onCancel={cancelAdmin} />
          </form>

          {can('perm_clients_voir_finances') && cl.type === 'pro' && <section aria-label="Récapitulatif mensuel" className={`overflow-hidden rounded-xl border ${BORDER} bg-surface`}>
            <h2 className="m-0">
              <button type="button" aria-expanded={billingOpen} aria-controls="client-billing-recap" onClick={() => setBillingOpen((p) => !p)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-primary transition-transform duration-200 ease-out hover:bg-elevated">
                <FileSpreadsheet size={16} className="shrink-0" style={{ color: 'var(--text-accent)' }} aria-hidden="true" />
                <span className="flex-1">Récapitulatif mensuel · {clientPaymentLabel(cl)}</span>
                <ChevronDown size={16} className={`shrink-0 text-secondary transition-transform duration-200 ease-out ${billingOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            </h2>
            {billingOpen && <div id="client-billing-recap" className={`space-y-3 border-t ${BORDER} p-3`}>
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectField label="Mois du récapitulatif" value={billingMonth} onChange={(e) => setBillingMonth(Number(e.target.value))}>{MOIS_LABELS.map((m, i) => <option key={m} value={i}>{m}</option>)}</SelectField>
                <SelectField label="Année du récapitulatif" value={billingYear} onChange={(e) => setBillingYear(Number(e.target.value))}>{[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</SelectField>
              </div>
              <div className={`flex flex-wrap items-center gap-3 rounded-lg border ${BORDER} bg-elevated px-3 py-2`}>
                <div className="flex-1">
                  <p className="text-sm text-secondary">{countLabel(billing.rows.length, 'dossier', 'dossiers')} sur la période</p>
                  <p className="text-lg font-bold text-primary">{eur(billing.total)}</p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(exportBlocked) || !billing.rows.length}
                  aria-describedby={exportBlocked ? 'client-billing-export-reason' : undefined}
                  onClick={() => {
                    try {
                      const count = exportRecapProExcel(cl, dossiers, billingMonth, billingYear);
                      flash(count > 0 ? `Récapitulatif exporté : ${countLabel(count, 'dossier', 'dossiers')}.` : 'Aucun dossier pour cette période.');
                    } catch (error) { flash({ msg: `Export impossible : ${error.message}`, type: 'error' }); }
                  }}
                  className={SECONDARY}
                >
                  <Download size={16} aria-hidden="true" />
                  {billing.rows.length ? `Exporter ${countLabel(billing.rows.length, 'dossier', 'dossiers')}` : 'Aucun dossier à exporter'}
                </button>
              </div>
              {exportBlocked && <p id="client-billing-export-reason" className="text-sm text-secondary">{exportBlocked}</p>}
            </div>}
          </section>}

          {can('perm_clients_supprimer') && <section aria-labelledby="client-delete-title" className={`space-y-2 border-t ${BORDER} pt-4`}>
            <h2 id="client-delete-title" className="text-sm font-bold text-primary">Supprimer la fiche</h2>
            {historyLoading ? <p className="text-sm text-secondary">Vérification de l’historique avant suppression…</p>
              : historyError ? <p className="text-sm text-secondary">Suppression indisponible tant que l’historique n’est pas chargé.</p>
                : hasColis ? <p className="text-sm text-secondary">Ce client a des dossiers : sa fiche est conservée avec son historique.</p>
                  : <button type="button" onClick={handleDelete} className={DANGER}><Trash2 size={16} aria-hidden="true" />Supprimer ce client</button>}
            {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
          </section>}
        </div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New client page
// ─────────────────────────────────────────────────────────────────────────────
function NewClientPage({ onDone, onCancel }) {
  const { addNewClient, flash, can, ask, clients } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const [nd, setNd, { clear, storageAvailable }] = usePersistentDraft('client:new', { ...emptyDraft(), ...(location.state?.clientPrefill || {}) });
  const [saving, setSaving] = useState(false); const [createError, setCreateError] = useState(''); const [justCreated, setJustCreated] = useState(null); const [attempt, setAttempt] = useState(0);
  const formRef = useRef(null); const errorRef = useRef(null);
  const set = (key, value) => setNd(p => ({ ...p, [key]: value }));
  // Prénom, nom, email, téléphone and a complete address are required for a client account. The phone is
  // the mobile or the landline: each number entered is checked under its own field.
  const errors = {
    ...omit(newClientErrors(nd), ['tel']),
    ...phoneErrors(nd),
    ...(nd.type === 'pro' && !nd.raisonSociale.trim() ? { raisonSociale: 'La raison sociale est obligatoire.' } : {}),
  };
  // After a refused submit, the first invalid field (in reading order) receives the focus.
  useEffect(() => { if (attempt) formRef.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [attempt]);
  useEffect(() => { if (createError) errorRef.current?.focus(); }, [createError]);
  const blank = { ...emptyDraft() };
  const hasData = Object.keys(blank).some(key => String(nd[key] ?? '') !== String(blank[key] ?? ''));
  const field = (key, label, type = 'text', extra = {}) => <ValidatedField key={key} name={key} label={label} type={type} value={nd[key] || ''} onChange={e => set(key, e.target.value)} error={attempt ? errors[key] : undefined} required={REQUIRED_CLIENT_KEYS.includes(key) || key === 'raisonSociale'} {...extra} />;
  const destination = servedDestination(nd.cp);
  const create = async event => {
    event.preventDefault();
    if (saving) return;
    if (Object.keys(errors).length) { setAttempt(n => n + 1); return; }
    setSaving(true); setCreateError('');
    try {
      const telegram = normalizeTelegramUsername(nd.telegramUsername);
      const trimmed = Object.fromEntries([...REQUIRED_CLIENT_KEYS, 'telFixe'].map(key => [key, String(nd[key] ?? '').trim()]));
      const payload = { ...nd, ...trimmed, cp: trimmed.cp.replace(/\s/g, ''), adresse: trimmed.adresseLigne1, telegramUsername: telegram, canal: telegram ? 'telegram' : 'email', abonnement: can('perm_clients_modifier_abonnement') ? nd.abonnement : 'freemium', abonnementDebut: null, abonnementFin: null, dateNaissance: nd.dateNaissance || null, points: 0 };
      const id = await addNewClient(payload);
      if (!id) throw new Error('La création n’a pas été confirmée.');
      setJustCreated({ ...payload, id }); clear();
    } catch (error) { setCreateError(error.message || 'Création impossible. Votre brouillon est conservé.'); }
    finally { setSaving(false); }
  };
  const abandon = () => {
    if (!hasData) { clear(); onCancel(); return; }
    ask('Abandonner ce nouveau client ?', 'Les informations saisies seront effacées. Aucune fiche n’a été créée.', () => { clear(); onCancel(); }, { danger: true, okLabel: 'Abandonner le brouillon' });
  };
  if (justCreated) {
    // The record the database returned (AppContext), the submitted values only as a fallback.
    const created = clients.find(client => client.id === justCreated.id) || justCreated;
    const name = created.nomFamille !== undefined ? created.nom : [justCreated.prenom, justCreated.nom].filter(Boolean).join(' ');
    return <section className="mx-auto max-w-2xl space-y-4 pb-12">
      <h1 className="text-2xl font-bold text-primary">Client créé</h1>
      <p role="status" className="text-primary">La fiche de {name} est enregistrée. Aucune invitation n’a été envoyée automatiquement.</p>
      <InviteClientAccess client={created} />
      <details className={`rounded-xl border ${BORDER} px-3`}><summary className="min-h-11 cursor-pointer py-3 font-semibold text-primary">Lier le Telegram du client (facultatif)</summary><div className="pb-3"><TelegramInvitation client={created} /></div></details>
      <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} onClick={() => navigate(`/clients/${justCreated.id}`)}>Ouvrir la fiche client</button><button type="button" className={SECONDARY} onClick={onDone}><ArrowLeft size={16} aria-hidden="true" />Retour aux clients</button></div>
    </section>;
  }
  return <form ref={formRef} onSubmit={create} noValidate className="mx-auto max-w-2xl space-y-5 pb-20">
    <header><h1 className="text-2xl font-bold text-primary">Nouveau client</h1><p className="text-sm text-secondary">Identité, contact et adresse complète sont obligatoires pour ouvrir un compte client. Votre brouillon est conservé.{!storageAvailable && ' Gardez cet onglet ouvert : stockage du navigateur indisponible.'}</p></header>
    {/* A refusal of the server (missing information, SQLSTATE 23514) is shown here, never a success. */}
    {createError && <p ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Client non créé : {createError} Votre saisie est conservée.</span></p>}
    <fieldset disabled={saving} className="space-y-5">
      <section className="card space-y-4 p-4"><h2 className="font-semibold text-primary">Identité</h2>
        <SelectField label="Type de client" name="type" value={nd.type} onChange={e => set('type', e.target.value)}><option value="particulier">Particulier</option><option value="pro">Professionnel</option></SelectField>
        <div className="grid gap-3 sm:grid-cols-2">{field('nom', 'Nom')}{field('prenom', 'Prénom')}</div>
        {nd.type === 'pro' && field('raisonSociale', 'Raison sociale')}
      </section>
      <section className="card space-y-3 p-4"><h2 className="font-semibold text-primary">Contact</h2>
        {field('email', 'Email', 'email')}
        <div className="grid gap-3 sm:grid-cols-2">{field('tel', 'Téléphone', 'tel', { placeholder: 'ex. +262 692 12 34 56', required: !filled(nd.telFixe), hint: PHONE_HINT })}{field('telFixe', 'Téléphone fixe', 'tel', { placeholder: 'ex. 0262 41 22 33' })}</div>
        {field('telegramUsername', 'Identifiant Telegram (facultatif)', 'text', { placeholder: '@identifiant', autoComplete: 'off', hint: 'Le @ est facultatif.' })}
      </section>
      <section className="card space-y-3 p-4"><h2 className="font-semibold text-primary">Adresse de livraison</h2>
        {field('adresseLigne1', 'Adresse', 'text', { placeholder: 'Numéro, rue, résidence, étage…' })}
        {field('adresseLigne2', 'Complément d’adresse (facultatif)')}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('cp', 'Code postal', 'text', { placeholder: 'ex. 97400', hint: destination ? <span className="flex items-center gap-1"><span aria-hidden="true">{destination.flag}</span>Destination : {destination.nom}</span> : 'Réunion, Mayotte, Guadeloupe ou Martinique.' })}
          {field('ville', 'Ville')}
        </div>
      </section>
      <details className="card p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary">Informations complémentaires (facultatif)</summary>
        <div className="space-y-3 pt-3">{field('infosLivraison', 'Informations de livraison')}
          {nd.type === 'pro' && <>{field('siret', 'SIRET')}{field('interlocuteur', 'Interlocuteur')}<SelectField label="Modalité de paiement" name="modePaiement" value={nd.modePaiement} onChange={e => set('modePaiement', e.target.value)}><option value="colis">Par colis</option><option value="30j">À 30 jours</option><option value="fin_mois">En fin de mois</option><option value="virement">Par virement</option></SelectField></>}
          {can('perm_clients_modifier_abonnement') && <SelectField label="Offre" name="abonnement" value={nd.abonnement} onChange={e => set('abonnement', e.target.value)}>{Object.entries(ABONNEMENTS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}</SelectField>}
          {field('notes', 'Note interne')}
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY}>{saving ? 'Création…' : 'Créer le client'}</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Quitter et garder le brouillon</button>
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-secondary transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.98]" onClick={abandon}><X size={16} aria-hidden="true" />Abandonner</button>
      </div>
    </fieldset>
  </form>;
}

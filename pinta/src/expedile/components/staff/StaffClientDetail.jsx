import React, { useState, useMemo, useEffect, useId } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Check, X, AlertTriangle, ExternalLink, Send, Download, FileSpreadsheet, ChevronDown, Crown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { eur, getPrenom } from '../../utils';
import { Badge } from '../ui';
import { exportRecapProExcel, clientPaymentLabel, monthlyProDossiers, proRecapDossier } from '../../utils/exportRecapPro';
import ShareLinkPanel from './ShareLinkPanel';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import * as sb from '../../lib/supabaseData';
import ColisModal from '../ColisModal';
import { nextAction } from '../../domain/workQueues';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { receptionCartonManifest } from '../../domain/reception';

function InviteClientAccess({ client, flash }) {
  const { retryLoad, can } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  if (client.userId) return <p className="text-xs text-emerald-700 flex items-center gap-2"><Check size={14} />Espace client rattaché à cette fiche</p>;
  async function invite() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data: result, error: functionError } = await supabase.functions.invoke('invite-client-user', { body: { clientId: client.id } });
      if (functionError || result?.error) throw new Error(await functionErrorMessage({ data: result, error: functionError }, 'L’invitation n’a pas pu être envoyée. Vérifiez la configuration des emails.'));
      setSent(true); flash({ msg: result.invitation_sent ? 'Invitation de connexion envoyée par email.' : 'Le compte existant du client est maintenant lié à cette fiche. Il peut utiliser ses identifiants habituels.', type: 'success' });
      await retryLoad();
    } catch (err) { setError(err.message || 'L’invitation n’a pas pu être envoyée.'); }
    finally { setBusy(false); }
  }
  return <div className="border border-gray-200 rounded-xl p-3 space-y-2"><p className="text-xs font-bold text-gray-800">Accès à l’espace client</p><p className="text-xs text-gray-500">Invitez le client à définir son mot de passe et à retrouver ses dossiers. Son accès est lié à cette fiche.</p><button disabled={busy || sent || !client.email || !can('perm_clients_creer')} onClick={invite} className="min-h-11 px-3 rounded-xl brand-bg text-white text-xs font-semibold disabled:opacity-50">{busy ? 'Invitation en cours…' : sent ? 'Invitation prise en charge' : 'Inviter à l’espace client'}</button>{!client.email && <p className="text-xs text-gray-500">Enregistrez un email de contact avant d’inviter ce client.</p>}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}</div>;
}

function TelegramInvitation({ client, flash }) {
  const { can } = useApp();
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy || !can('perm_clients_modifier')) return;
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
  return <div className="p-3 rounded-xl border border-gray-200 space-y-2">
    <p className="text-xs font-bold text-gray-800">{client.telegramChatId ? 'Telegram connecté' : 'Connecter le Telegram du client'}</p>
    <p className="text-xs text-gray-500">Le client utilise son lien personnel puis appuie sur « Démarrer ». Le lien expire et ne peut servir qu’une fois.</p>
    {invitation ? <><input readOnly aria-label="Lien personnel Telegram" value={invitation.url} onClick={(e) => e.target.select()} className="min-h-11 w-full px-3 text-xs bg-white rounded-lg border border-gray-200 text-gray-800" /><div className="flex flex-wrap gap-2"><button onClick={async () => { try { await navigator.clipboard.writeText(invitation.url); flash('Lien copié'); } catch { setError('Sélectionnez le lien pour le copier manuellement.'); } }} className="min-h-11 px-3 rounded-xl brand-bg text-white text-xs font-semibold">Copier le lien</button>{client.email && <a href={`mailto:${client.email}?subject=${encodeURIComponent('Votre connexion Telegram Expedîle')}&body=${encodeURIComponent(`Bonjour ${getPrenom(client)},\n\nConnectez votre Telegram à votre dossier Expedîle avec ce lien personnel : ${invitation.url}\n\nL’équipe Expedîle`)}`} className="min-h-11 inline-flex items-center px-3 text-xs font-semibold brand-t">Préparer un email</a>}<button onClick={create} disabled={busy || !can('perm_clients_modifier')} className="min-h-11 px-3 text-xs text-gray-500">Renouveler</button></div></> : <button onClick={create} disabled={busy || !can('perm_clients_modifier')} className="min-h-11 px-3 rounded-xl brand-bg text-white text-xs font-semibold disabled:opacity-50">{busy ? 'Création…' : 'Créer une invitation personnelle'}</button>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
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
function TogglePair({ value, onChange, options }) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all"
            style={
              active
                ? { background: BRAND.navy, color: 'white' }
                : { background: 'white', color: '#6B7280' }
            }
          >
            {active && <Check size={11} strokeWidth={3} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Validated input field ────────────────────────────────────────────────────
function ValidatedField({ label, value, onChange, placeholder, type = 'text', mono, error, valid, hint, colSpan }) {
  const id = useId();
  const borderColor = error ? 'border-red-400' : valid ? 'border-green-400' : 'border-gray-200';
  const focusBorder = error ? 'focus:border-red-500' : 'focus:border-blue-300';
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <label htmlFor={id} className="text-xs font-semibold text-gray-600 block mb-1">
        {label}
        {valid && <Check size={10} className="inline ml-1 text-green-500" />}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        className={`min-h-11 w-full px-3 py-2 rounded-xl border-2 ${borderColor} text-sm outline-none ${focusBorder} transition-colors ${mono ? 'font-mono' : ''}`}
      />
      {error && <p id={`${id}-error`} className="text-xs text-red-700 font-medium mt-1">{error}</p>}
      {hint && !error && <div className="mt-0.5">{hint}</div>}
    </div>
  );
}

const MOIS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ─────────────────────────────────────────────────────────────────────────────
// Main component — handles both /clients/new and /clients/:id
// ─────────────────────────────────────────────────────────────────────────────
export default function StaffClientDetail() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const { clients, data, updateClient, addNewClient, deleteClient, flash, sendMsg, ask, auth, can, dataLoading } = useApp();

  const isNewRoute = !routeId || routeId === 'new';
  const existing = !isNewRoute ? clients.find((c) => c.id === routeId) : null;

  // If route is /clients/:id but no such client found, redirect back.
  // Wait for clients to be loaded before deciding (avoid false negatives on first render).
  if (!isNewRoute && !existing && !dataLoading) {
    return <section className="p-6 space-y-3"><h1 className="text-xl font-bold">Client introuvable</h1><p>Cette fiche n’est pas disponible ou vous n’avez plus accès à ce client.</p><button className="min-h-11 underline" onClick={() => navigate('/clients')}>Retour aux clients</button></section>;
  }

  if (isNewRoute && !can('perm_clients_creer')) return <p role="alert" className="p-6 text-sm text-gray-600">Votre rôle ne permet pas de créer un client.</p>;
  if (isNewRoute) {
    return <NewClientPage onDone={() => navigate('/clients')} onCancel={() => navigate('/clients')} />;
  }

  if (!existing) {
    return <div className="flex items-center justify-center min-h-[40vh] text-gray-400">Chargement…</div>;
  }

  return (
    <EditClientPage
      key={existing.id}
      cl={existing}
      clients={clients}
      data={data}
      updateClient={updateClient}
      deleteClient={deleteClient}
      flash={flash}
      sendMsg={sendMsg}
      ask={ask}
      auth={auth}
      onDone={() => navigate('/clients')}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit page — uses the edit form (extracted from previous inline modal)
// ─────────────────────────────────────────────────────────────────────────────
function EditClientPage({ cl, clients, data: initialData, updateClient, deleteClient, flash, sendMsg, ask, auth, onDone }) {
  const navigate = useNavigate();
  const { can } = useApp();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [panel, setPanel] = useState('overview');
  const [receiving, setReceiving] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const data = history || initialData.filter((item) => item.clientId === cl.id);
  useEffect(() => {
    let active = true;
    sb.fetchColis(null, { clientId: cl.id }).then((rows) => { if (active) { setHistory(rows); setHistoryError(''); } })
      .catch((error) => { if (active) setHistoryError(error.message); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [cl.id]);

  const initialDraft = {
    nom: cl.nomFamille || cl.nom || '',
    prenom: cl.prenom || '',
    tel: cl.tel || '',
    email: cl.email || '',
    ville: cl.ville || '',
    cp: cl.cp || '',
    adresseLigne1: cl.adresseLigne1 || cl.adresse || '',
    adresseLigne2: cl.adresseLigne2 || '',
    commune: cl.commune || cl.ville || '',
    infosLivraison: cl.infosLivraison || '',
    telegramUsername: cl.telegramUsername || '',
    canal: cl.canal || 'telegram',
    type: cl.type || 'particulier',
    abonnement: cl.abonnement || 'freemium',
    abonnementDebut: cl.abonnementDebut || '',
    abonnementFin: cl.abonnementFin || '',
    notes: cl.notes || '',
    raisonSociale: cl.raisonSociale || '', siret: cl.siret || '', interlocuteur: cl.interlocuteur || '', modePaiement: cl.modePaiement || 'colis',
  };
  const [clDraft, setClDraft, { clear: clearClientDraft }] = usePersistentDraft(`client:edit:${cl.id}`, initialDraft);
  const [touched, setTouched] = useState({});
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingMonth, setBillingMonth] = useState(new Date().getMonth());
  const [billingYear, setBillingYear] = useState(new Date().getFullYear());

  // ── Duplicate detection ───────────────────────────────────────────────────
  const duplicates = useMemo(() => {
    if (!clDraft.nom && !clDraft.tel) return [];
    return clients.filter((c) => {
      if (c.id === cl.id) return false;
      // Check name similarity (case-insensitive, at least 3 chars match)
      const nameLower = (clDraft.nom || '').toLowerCase().trim();
      const cNameLower = (c.nom || '').toLowerCase().trim();
      const nameMatch = nameLower.length >= 3 && cNameLower.length >= 3 && (
        cNameLower.includes(nameLower) || nameLower.includes(cNameLower)
      );
      // Check phone match (clean digits comparison)
      const cleanTel = (clDraft.tel || '').replace(/[\s\-+]/g, '');
      const cCleanTel = (c.tel || '').replace(/[\s\-+]/g, '');
      const telMatch = cleanTel.length >= 6 && cCleanTel.length >= 6 && (
        cleanTel.endsWith(cCleanTel.slice(-8)) || cCleanTel.endsWith(cleanTel.slice(-8))
      );
      return nameMatch || telMatch;
    });
  }, [cl.id, clDraft.nom, clDraft.tel, clients]);

  // ── Live validation ───────────────────────────────────────────────────────
  const fieldErrors = useMemo(() => {
    const errs = {};
    if (touched.nom && (!clDraft.nom || clDraft.nom.trim().length < 2)) errs.nom = 'Min. 2 caractères';
    if (touched.cp && clDraft.cp && !/^9[7-8]\d{3}$/.test(clDraft.cp.replace(/\s/g, ''))) errs.cp = 'Format 97xxx ou 98xxx';
    if (touched.tel && clDraft.tel && !/^\+?\d[\d\s\-]{6,18}$/.test(clDraft.tel.replace(/\s/g, ''))) errs.tel = 'Numéro invalide';
    if (touched.email && clDraft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clDraft.email)) errs.email = 'Email invalide';
    return errs;
  }, [clDraft, touched]);

  const canSave = clDraft.nom && clDraft.nom.trim().length >= 2 && Object.keys(fieldErrors).length === 0 && (!clDraft.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clDraft.email));

  // ── Helpers ───────────────────────────────────────────────────────────────
  const colis = data.filter((p) => p.clientId === cl.id && p.statut !== 'annule');
  const actifs = data.filter((p) => p.clientId === cl.id && !p.archive && !['livre', 'annule'].includes(p.statut));
  const ca = data.filter((p) => p.clientId === cl.id && p.paiementMontant).reduce((sum, p) => sum + (p.paiementMontant || 0), 0);
  const dest = getDestByCP(cl.cp);
  const hasColis = data.some((p) => p.clientId === cl.id);

  function getProBillingData(month, year) { return monthlyProDossiers(cl, data, month, year); }

  function patchDraft(field, value) {
    setClDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  async function handleSave() {
    if (!canSave) {
      setTouched({ nom: true, tel: true, email: true, cp: true });
      return;
    }
    setSaving(true); setSaveError('');
    try { const { abonnement, abonnementDebut, abonnementFin, ...contact } = clDraft; await updateClient(cl.id, { ...contact, adresse: clDraft.adresseLigne1 }); clearClientDraft(); setClDraft(clDraft); setPanel('overview'); }
    catch (error) { setSaveError(error.message || 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (historyLoading || historyError) { setSaveError('Attendez le chargement complet de l’historique avant de supprimer cette fiche.'); return; }
    if (hasColis) {
      flash('Ce client a des colis actifs, impossible de le supprimer');
      return;
    }
    ask(`Supprimer définitivement ${cl.nom} ?`, 'Cette fiche client sera supprimée. Aucun dossier existant ne sera supprimé par cette action.', async () => { try { const deleted = await deleteClient(cl.id); if (deleted) onDone(); } catch (error) { setSaveError(error.message || 'Suppression impossible.'); } }, { danger: true });
  }

  function handleOpenColis(colisId) {
    navigate(`/colis/${colisId}`);
  }

  return (
    <div className="anim-fade max-w-3xl mx-auto pb-24">
      {/* ── Header with back button ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 pt-1">
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft size={16} />
          Retour aux clients
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* ── Title row ─────────────────────────────────────────────────── */}
        <div className="p-4 flex items-center gap-3 border-b border-gray-100">
          <div
            className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-base font-black"
            style={{
              background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
              color: BRAND.goldL,
            }}
          >
            {(cl.nom || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {cl.ref && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{cl.ref}</span>}
              <span className="text-base font-black truncate" style={{ color: 'var(--brand-text)' }}>
                {cl.nom || <span className="italic text-gray-400">Sans nom</span>}
              </span>
              {cl.abonnement === 'vip' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: 'white' }}>
                  <Crown size={10} strokeWidth={2.5} /> VIP
                </span>
              ) : cl.type === 'pro' ? (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase"
                  style={{ background: `${BRAND.gold}30`, color: BRAND.goldD }}>
                  PRO
                </span>
              ) : (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                  Particulier
                </span>
              )}
              {cl.telegramChatId ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Telegram lié</span>
              ) : (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Telegram non lié</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs">{dest.flag}</span>
              {cl.ville && <span className="text-xs text-gray-500">{cl.ville}</span>}
              {cl.tel && <span className="text-xs text-gray-400 font-mono">{cl.tel}</span>}
              {cl.email && <span className="text-xs text-gray-400 truncate max-w-[160px]">{cl.email}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600">{historyLoading ? 'Historique…' : historyError ? 'Historique indisponible' : `${data.length} dossiers au total`}</span>
              {actifs.length > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${BRAND.navy}12`, color: 'var(--brand-text)' }}
                >
                  {actifs.length} actifs
                </span>
              )}
            </div>
            {can('perm_clients_voir_finances') && ca > 0 && <span className="text-xs font-bold text-emerald-600">{ca.toFixed(2)} €</span>}
          </div>
        </div>

        <nav aria-label="Sections de la fiche client" className="flex flex-wrap gap-2 border-b border-gray-200 p-3">{[['overview', 'Synthèse'], ['contact', 'Coordonnées'], ['admin', 'Abonnement et administration']].map(([key, label]) => <button key={key} onClick={() => setPanel(key)} aria-pressed={panel === key} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${panel === key ? 'brand-bg text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{label}</button>)}</nav>
        {panel === 'overview' && <div className="space-y-5 p-4">
          <section aria-label="Contact disponible" className="space-y-3"><h2 className="font-bold text-gray-800">Joindre ce client</h2><p className="text-sm text-gray-600">{cl.telegramChatId ? 'Telegram connecté' : 'Telegram non connecté'} · {cl.userId ? 'Espace client rattaché à cette fiche' : 'Accès au portail à activer'}</p><div className="flex flex-wrap gap-2">{cl.tel && <a href={`tel:${cl.tel}`} className="min-h-11 inline-flex items-center rounded-xl border border-gray-300 px-3 text-sm font-semibold">Appeler</a>}{cl.email && <a href={`mailto:${cl.email}`} className="min-h-11 inline-flex items-center rounded-xl border border-gray-300 px-3 text-sm font-semibold">Préparer un email</a>}{can('perm_colis_receptionner') && <button onClick={() => setReceiving(true)} className="min-h-11 rounded-xl brand-bg px-4 text-sm font-semibold text-white">Réceptionner pour ce client</button>}</div>{!cl.userId && <InviteClientAccess client={cl} flash={flash} />}{!cl.telegramChatId && <TelegramInvitation client={cl} flash={flash} />}</section>
          <section aria-label="Expéditions ouvertes" className="space-y-3"><h2 className="font-bold text-gray-800">Expéditions ouvertes ({actifs.length})</h2>{actifs.length ? actifs.map((item) => <button key={item.id} onClick={() => handleOpenColis(item.id)} className="flex min-h-20 w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 text-left"><span><strong className="brand-t">{item.ref}</strong><span className="mt-1 block text-sm text-gray-700">{nextAction(item, cl)}</span><span className="mt-1 block text-xs text-gray-600">{receptionCartonManifest(item).nbColis} carton(s) reçus{item.casier ? ` · Casier ${item.casier}` : ''}</span></span><Badge statut={item.statut} /></button>) : <p className="text-sm text-gray-600">Aucune expédition ouverte.</p>}</section>
          <details className="rounded-xl border border-gray-200 p-3"><summary className="min-h-11 cursor-pointer font-semibold text-gray-800">Historique complet {history ? `(${history.length} dossiers)` : ''}</summary>{historyLoading && <p role="status" className="text-sm text-gray-600">Chargement de l’historique, archives comprises…</p>}{historyError && <p role="alert" className="text-sm text-red-700">Historique indisponible : {historyError}<button onClick={() => window.location.reload()} className="min-h-11 block underline">Réessayer</button></p>}{history?.map((item) => <button key={item.id} onClick={() => handleOpenColis(item.id)} className="flex min-h-14 w-full items-center justify-between gap-2 border-t border-gray-100 text-left text-sm"><span className="font-semibold brand-t">{item.ref}{item.archive ? ' · Archivé' : ''}</span><Badge statut={item.statut} /></button>)}</details>
        </div>}
        <ColisModal open={receiving} onClose={() => setReceiving(false)} initialClientId={cl.id} />
        {/* ── Edit form ─────────────────────────────────────────────────── */}
        <div hidden={panel === 'overview'} className="px-4 pb-5 pt-4 space-y-4">

          {/* Duplicate warning */}
          {duplicates.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 anim-fade">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-800">Doublon possible</p>
                <div className="mt-1 space-y-1">
                  {duplicates.map((dup) => (
                    <p key={dup.id} className="text-[11px] text-amber-700">
                      <span className="font-bold">{dup.nom}</span>
                      {dup.tel && <span className="font-mono ml-1">{dup.tel}</span>}
                      {dup.email && <span className="ml-1">{dup.email}</span>}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          <fieldset hidden={panel !== 'contact'} disabled={!can('perm_clients_modifier')} className="space-y-4">
          {/* Field grid */}
          <div className="grid grid-cols-2 gap-3">
            <ValidatedField
              label="Nom *"
              value={clDraft.nom}
              onChange={(e) => patchDraft('nom', e.target.value)}
              placeholder="NOM"
              error={fieldErrors.nom}
              valid={touched.nom && clDraft.nom && clDraft.nom.trim().length >= 2 && !fieldErrors.nom}
            />
            <ValidatedField
              label="Prénom"
              value={clDraft.prenom}
              onChange={(e) => patchDraft('prenom', e.target.value)}
              placeholder="Prénom"
            />

            <ValidatedField
              label="Téléphone"
              value={clDraft.tel}
              onChange={(e) => patchDraft('tel', e.target.value)}
              placeholder="+262 692 …"
              mono
              error={fieldErrors.tel}
              valid={touched.tel && clDraft.tel && !fieldErrors.tel}
            />

            <ValidatedField
              label="Email"
              value={clDraft.email}
              onChange={(e) => patchDraft('email', e.target.value)}
              placeholder="adresse@exemple.com"
              type="email"
              error={fieldErrors.email}
              valid={touched.email && clDraft.email && !fieldErrors.email}
            />

            <ValidatedField
              label="Telegram @username"
              value={clDraft.telegramUsername}
              onChange={(e) => patchDraft('telegramUsername', e.target.value)}
              placeholder="@username"
            />

            <ValidatedField
              label="Ville"
              value={clDraft.ville}
              onChange={(e) => patchDraft('ville', e.target.value)}
              placeholder="Saint-Denis"
            />

            <ValidatedField
              label="Code postal"
              value={clDraft.cp}
              onChange={(e) => patchDraft('cp', e.target.value)}
              placeholder="97400"
              mono
              error={fieldErrors.cp}
              valid={touched.cp && clDraft.cp && /^9[7-8]\d{3}$/.test(clDraft.cp.replace(/\s/g, '')) && !fieldErrors.cp}
              hint={clDraft.cp && clDraft.cp.length >= 3 && !fieldErrors.cp ? (
                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                  {(() => {
                    const d = getDestByCP(clDraft.cp);
                    return <><span className="text-sm">{d.flag}</span><span className="font-medium">{d.nom}</span></>;
                  })()}
                </p>
              ) : null}
            />

            {/* Adresse de livraison */}
            <div className="col-span-2">
              <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                Adresse de livraison
              </label>
              <textarea
                aria-label="Adresse de livraison" value={clDraft.adresseLigne1}
                onChange={(e) => patchDraft('adresseLigne1', e.target.value)}
                placeholder="N° rue, résidence, étage…"
                rows={2}
                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors resize-none"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2"><ValidatedField label="Complément d’adresse" value={clDraft.adresseLigne2} onChange={(event) => patchDraft('adresseLigne2', event.target.value)} /><ValidatedField label="Commune de livraison" value={clDraft.commune} onChange={(event) => patchDraft('commune', event.target.value)} /><ValidatedField label="Instructions de livraison" value={clDraft.infosLivraison} onChange={(event) => patchDraft('infosLivraison', event.target.value)} /></div>
          {/* Canal */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1.5 uppercase tracking-wide">
              Canal de contact
            </label>
            <TogglePair
              value={clDraft.canal}
              onChange={(v) => patchDraft('canal', v)}
              options={[
                { value: 'telegram', label: 'Telegram' },
                { value: 'email', label: 'Email' },
              ]}
            />
          </div>

          </fieldset>
          <fieldset hidden={panel !== 'admin'} disabled={!can('perm_clients_modifier')} className="space-y-4">
          {/* Type */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1.5 uppercase tracking-wide">
              Type de client
            </label>
            <TogglePair
              value={clDraft.type}
              onChange={(v) => patchDraft('type', v)}
              options={[
                { value: 'particulier', label: 'Particulier' },
                { value: 'pro', label: 'Pro' },
              ]}
            />
          </div>

          {clDraft.type === 'pro' && <section className="rounded-xl border p-3 space-y-3"><h3 className="font-semibold">Facturation professionnelle</h3>{[['raisonSociale', 'Raison sociale'], ['siret', 'SIRET'], ['interlocuteur', 'Interlocuteur']].map(([key, label]) => <ValidatedField key={key} label={label} value={clDraft[key]} onChange={e => patchDraft(key, e.target.value)} />)}<label className="block text-sm">Modalité de paiement<select className="min-h-11 w-full rounded-xl border px-3" value={clDraft.modePaiement} onChange={e => patchDraft('modePaiement', e.target.value)}>{[['colis','Par colis'],['compte','Sur compte'],['30j','À 30 jours'],['fin_mois','En fin de mois'],['virement','Par virement']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label></section>}
          {/* Notes internes */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
              Notes internes
            </label>
            <textarea
              aria-label="Notes internes" value={clDraft.notes}
              onChange={(e) => patchDraft('notes', e.target.value)}
              placeholder="Informations utiles pour l'équipe…"
              rows={2}
              className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors resize-none"
            />
          </div>

          </fieldset>
          {panel === 'admin' && <SubscriptionEditor client={cl} />}
          {panel === 'contact' && cl.id && <><InviteClientAccess client={cl} flash={flash} /><TelegramInvitation client={cl} flash={flash} /></>}

          {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
          {!can('perm_clients_modifier') && <p className="text-xs text-gray-500">Votre rôle permet de consulter cette fiche. Les modifications sont réservées aux personnes habilitées.</p>}
          {/* Save / Cancel */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!canSave || saving || !can('perm_clients_modifier')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{ background: BRAND.navy, color: 'white' }}
            >
              <Check size={14} strokeWidth={2.5} />
              Enregistrer
            </button>
            <button
              onClick={() => { clearClientDraft(); setTouched({}); setSaveError(''); setPanel('overview'); }}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 transition-all active:scale-95 hover:bg-gray-200"
            >
              <X size={14} />
              Annuler
            </button>
          </div>

          {/* Quick action links */}
          {(cl.tel || cl.email) && (
            <div className="flex gap-2 flex-wrap">
              {cl.email && (
                <a
                  href={`mailto:${cl.email}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  Email
                </a>
              )}
              {cl.tel && (
                <a
                  href={`tel:${cl.tel}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Appeler
                </a>
              )}
            </div>
          )}

          {/* Colis summary */}
          {colis.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p
                className="text-[11px] font-bold uppercase tracking-wide mb-2"
                style={{ color: 'var(--brand-text)' }}
              >
                Colis ({colis.length})
              </p>
              <div className="space-y-1.5">
                {colis.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleOpenColis(p.id)}
                    className="w-full flex items-center gap-2 text-left p-2 rounded-lg hover:bg-white transition-colors group"
                  >
                    <span className="text-xs font-black" style={{ color: 'var(--brand-text)' }}>
                      {p.ref}
                    </span>
                    <Badge statut={p.statut} />
                    {p.desc && (
                      <span className="text-xs text-gray-400 truncate flex-1 min-w-0">{p.desc}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pro billing section */}
          {panel === 'admin' && can('perm_clients_voir_finances') && cl.type === 'pro' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#A5B4FC', background: '#EEF2FF' }}>
              <button
                onClick={() => setBillingOpen((p) => !p)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              >
                <FileSpreadsheet size={13} className="text-indigo-600 flex-shrink-0" />
                <span className="text-xs font-bold text-indigo-800 flex-1">
                  Facturation
                  {` — ${clientPaymentLabel(cl)}`}
                </span>
                <ChevronDown
                  size={13}
                  className={`text-indigo-400 transition-transform ${billingOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {billingOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t" style={{ borderColor: '#C7D2FE' }}>
                  {/* Month/year selector */}
                  <div className="flex gap-2">
                    <select
                      aria-label="Mois du récapitulatif" value={billingMonth}
                      onChange={(e) => setBillingMonth(Number(e.target.value))}
                      className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-800 outline-none"
                    >
                      {MOIS_LABELS.map((m, i) => (
                        <option key={i} value={i}>{m}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Année du récapitulatif" value={billingYear}
                      onChange={(e) => setBillingYear(Number(e.target.value))}
                      className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-800 outline-none"
                    >
                      {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  {/* Summary */}
                  {(() => {
                    const billingColis = getProBillingData(billingMonth, billingYear);
                    const total = billingColis.reduce((s, c) => s + (proRecapDossier(c).devisTotal || 0), 0);
                    return (
                      <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg" style={{ background: '#F5F3FF' }}>
                        <div className="flex-1">
                          <p className="text-[11px] font-bold text-indigo-700">
                            {billingColis.length} colis
                          </p>
                          <p className="text-sm font-black text-indigo-900">
                            {total.toFixed(2)} €
                          </p>
                        </div>
                        <button
                          disabled={!can('perm_export_recap_pro') || !billingColis.length || historyLoading || Boolean(historyError)}
                          onClick={() => {
                            try { const count = exportRecapProExcel(cl, data, billingMonth, billingYear);
                            if (count > 0) flash(`Récap exporté : ${count} colis`);
                            else flash('Aucun colis pour cette période'); } catch (error) { setSaveError(`Export impossible : ${error.message}`); }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 hover:bg-indigo-200"
                          style={{ background: '#E0E7FF', color: '#3730A3', border: '1px solid #A5B4FC' }}
                        >
                          <Download size={11} />
                          Exporter {billingColis.length} dossiers
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Lien de suivi partagé */}
          {cl.id && (
            <ShareLinkPanel
              client={cl}
              currentUserId={auth?.u?.id}
              flash={flash}
              ask={ask}
            />
          )}

          {/* Delete button — only if no colis */}
          {!hasColis && !historyLoading && !historyError && can('perm_clients_supprimer') && (
            <button
              onClick={handleDelete}
              className="w-full py-2.5 rounded-xl text-xs font-bold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
            >
              Supprimer ce client
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New client page — preserves the richer creation form
// (extracted from previous showNewModal block)
// ─────────────────────────────────────────────────────────────────────────────
const FORM_FIELD = 'min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2';
function SubscriptionEditor({ client }) {
  const { can, retryLoad } = useApp();
  const values = { abonnement: client.abonnement || 'freemium', abonnementDebut: client.abonnementDebut || null, abonnementFin: client.abonnementFin || null };
  const [draft, setDraft] = usePersistentDraft(`client:subscription:${client.id}`, { baseline: values, values });
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null);
  return <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">Offre et abonnement</h3><fieldset disabled={busy || !can('perm_clients_modifier_abonnement')} className="space-y-3"><label className="block text-sm">Offre<select className={FORM_FIELD} value={draft.values.abonnement} onChange={e => setDraft(p => ({ ...p, values: { ...p.values, abonnement: e.target.value } }))}>{draft.values.abonnement === 'premium' && <option value="premium">Premium (offre historique)</option>}{Object.entries(ABONNEMENTS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2">{[['abonnementDebut', 'Début abonnement'], ['abonnementFin', 'Fin abonnement']].map(([key, label]) => <label key={key} className="text-sm">{label}<input className={FORM_FIELD} type="date" value={draft.values[key] || ''} onChange={e => setDraft(p => ({ ...p, values: { ...p.values, [key]: e.target.value || null } }))} /></label>)}</div><button className="min-h-11 rounded-xl brand-bg text-white px-4" onClick={async () => { if (busy) return; setBusy(true); setNotice(null); try { const saved = await sb.saveClientSubscription(client.id, draft.values, draft.baseline); setDraft({ baseline: saved, values: saved }); setNotice({ text: 'Abonnement enregistré.' }); try { await retryLoad(); } catch { setNotice({ text: 'Abonnement enregistré. Actualisation de la fiche à réessayer.' }); } } catch (error) { setNotice({ error: true, text: error.message }); } finally { setBusy(false); } }}>Enregistrer l’abonnement</button></fieldset>{!can('perm_clients_modifier_abonnement') && <p className="text-sm text-gray-600">Vous pouvez consulter l’offre. Sa modification nécessite le droit Abonnement.</p>}{notice && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}</section>;
}
function NewClientPage({ onDone, onCancel }) {
  const { addNewClient, flash, can } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const [nd, setNd, { clear, storageAvailable }] = usePersistentDraft('client:new', { ...emptyDraft(), ...(location.state?.clientPrefill || {}) });
  const [saving, setSaving] = useState(false); const [createError, setCreateError] = useState(''); const [justCreated, setJustCreated] = useState(null); const [submitted, setSubmitted] = useState(false);
  const set = (key, value) => setNd(p => ({ ...p, [key]: value }));
  const errors = { ...(!nd.nom.trim() ? { nom: 'Le nom est requis.' } : {}), ...(!/^9[7-8]\d{3}$/.test(nd.cp.trim()) ? { cp: 'Indiquez un code postal DOM-TOM à cinq chiffres.' } : {}), ...(nd.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nd.email.trim()) ? { email: 'Indiquez un email valide.' } : {}), ...(!nd.email.trim() && !nd.telegramUsername.trim() ? { email: 'Un email ou un identifiant Telegram est nécessaire.' } : {}), ...(nd.tel && !/^[+()\d\s.-]{6,25}$/.test(nd.tel) ? { tel: 'Vérifiez le numéro de téléphone.' } : {}), ...(nd.type === 'pro' && !nd.raisonSociale.trim() ? { raisonSociale: 'La raison sociale est requise.' } : {}) };
  const field = (key, label, type = 'text') => <ValidatedField key={key} label={label} type={type} value={nd[key] || ''} onChange={e => set(key, e.target.value)} error={submitted ? errors[key] : undefined} />;
  const create = async event => { event.preventDefault(); setSubmitted(true); if (saving || Object.keys(errors).length) return; setSaving(true); setCreateError(''); try { const payload = { ...nd, nom: nd.nom.trim(), prenom: nd.prenom.trim(), email: nd.email.trim(), cp: nd.cp.trim(), canal: nd.telegramUsername.trim() ? 'telegram' : 'email', abonnement: can('perm_clients_modifier_abonnement') ? nd.abonnement : 'freemium', abonnementDebut: null, abonnementFin: null, dateNaissance: nd.dateNaissance || null, points: 0 }; const id = await addNewClient(payload); if (!id) throw new Error('La création n’a pas été confirmée.'); setJustCreated({ ...payload, id }); clear(); } catch (error) { setCreateError(error.message || 'Création impossible. Votre brouillon est conservé.'); } finally { setSaving(false); } };
  if (justCreated) return <section className="mx-auto max-w-2xl space-y-4 pb-12"><h1 className="text-2xl font-bold">Client créé</h1><p role="status">La fiche de {justCreated.prenom} {justCreated.nom} est enregistrée. Aucune invitation n’a été envoyée automatiquement.</p><InviteClientAccess client={justCreated} flash={flash} /><details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Connecter Telegram (facultatif)</summary><TelegramInvitation client={justCreated} flash={flash} /></details><div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-xl brand-bg text-white px-4" onClick={() => navigate(`/clients/${justCreated.id}`)}>Ouvrir la fiche client</button><button className="min-h-11 px-4 underline" onClick={onDone}>Retour aux clients</button></div></section>;
  return <form onSubmit={create} noValidate className="mx-auto max-w-2xl space-y-5 pb-20"><header><h1 className="text-2xl font-bold">Nouveau client</h1><p className="text-sm text-gray-600">Identité, destination et un moyen de contact suffisent pour commencer. Votre brouillon est conservé.{!storageAvailable && ' Gardez cet onglet ouvert : stockage du navigateur indisponible.'}</p></header><fieldset disabled={saving} className="space-y-5"><section className="card p-4 space-y-4"><h2 className="font-semibold">Identité et destination</h2><label className="block text-sm">Type de client<select className={FORM_FIELD} value={nd.type} onChange={e => set('type', e.target.value)}><option value="particulier">Particulier</option><option value="pro">Professionnel</option></select></label><div className="grid gap-3 sm:grid-cols-2">{field('nom', 'Nom *')}{field('prenom', 'Prénom')}{field('cp', 'Code postal de destination *')}{field('ville', 'Ville')}</div>{nd.type === 'pro' && field('raisonSociale', 'Raison sociale *')}</section><section className="card p-4 space-y-3"><h2 className="font-semibold">Contact</h2><p className="text-sm text-gray-600">Email ou Telegram requis. Le téléphone est facultatif.</p>{field('email', 'Email', 'email')}{field('telegramUsername', 'Identifiant Telegram (sans @)')}{field('tel', 'Téléphone (facultatif)', 'tel')}</section><details className="card p-4"><summary className="min-h-11 cursor-pointer font-semibold">Adresse et informations complémentaires (facultatif)</summary><div className="space-y-3 pt-3">{field('adresseLigne1', 'Adresse')}{field('adresseLigne2', 'Complément d’adresse')}{field('infosLivraison', 'Informations de livraison')}{nd.type === 'pro' && <>{field('siret', 'SIRET')}{field('interlocuteur', 'Interlocuteur')}<label className="block text-sm">Modalité de paiement<select className={FORM_FIELD} value={nd.modePaiement} onChange={e => set('modePaiement', e.target.value)}><option value="colis">Par colis</option><option value="30j">À 30 jours</option><option value="fin_mois">En fin de mois</option><option value="virement">Par virement</option></select></label></>}{can('perm_clients_modifier_abonnement') && <label className="block text-sm">Offre<select className={FORM_FIELD} value={nd.abonnement} onChange={e => set('abonnement', e.target.value)}>{Object.entries(ABONNEMENTS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}</select></label>}{field('notes', 'Note interne')}</div></details><div className="flex flex-wrap gap-2"><button type="submit" className="min-h-11 rounded-xl brand-bg px-5 text-white font-semibold">{saving ? 'Création…' : 'Créer le client'}</button><button type="button" className="min-h-11 px-4 underline" onClick={onCancel}>Quitter et garder le brouillon</button><button type="button" className="min-h-11 px-4 text-gray-600" onClick={() => { clear(); onCancel(); }}>Abandonner</button></div></fieldset>{createError && <p role="alert" className="rounded-xl border border-red-200 p-3 text-red-800">{createError}</p>}</form>;
}

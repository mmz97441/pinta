import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Mail, MapPin, Phone, Pencil, Check, X, LogOut, Lock, Download, MessageCircle, FileText, ExternalLink, Trash2 } from 'lucide-react';
import { hasPublishedQuote } from './quoteVisibility';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { eur, getPrenom } from '../../utils';
import { SecureFileLink } from '../ui/SecureFile';
import { currentInvoices } from '../../domain/invoiceDocuments';
import OnboardingOverlay from './OnboardingOverlay';

const inputClass = 'w-full min-h-11 px-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-800';

export default function ClientProfil() {
  const navigate = useNavigate();
  const { authCl: cl, auth, data, updateClient, signOut, flash, ask } = useApp();
  const [helpOpen, setHelpOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invitation, setInvitation] = useState(null);
  const [linking, setLinking] = useState(false);
  const [documents, setDocuments] = useState('devis');
  if (!cl) return null;
  const mine = data.filter((c) => c.clientId === cl.id);
  const active = mine.filter((c) => !['livre', 'annule'].includes(c.statut));
  const destination = getDestByCP(cl.cp);
  const invoices = mine.flatMap((c) => { const current = new Set(currentInvoices(c.factures).map(f => f.id)); return (c.factures || []).map(f => ({ ...f, ref: c.ref, colisId: c.id, current: current.has(f.id) })); });
  const estimates = mine.filter(hasPublishedQuote);

  const startEdit = () => {
    setDraft({ nom: cl.nomFamille || '', prenom: cl.prenom || '', email: cl.email || '', tel: cl.tel || '', cp: cl.cp || '', ville: cl.ville || '', adresseLigne1: cl.adresseLigne1 || '', adresseLigne2: cl.adresseLigne2 || '' });
    setError(''); setSaved(false); setEditing(true);
  };
  const save = async (event) => {
    event.preventDefault();
    if (!draft.nom.trim() || !/^\d{5}$/.test(draft.cp)) { setError('Renseignez votre nom et un code postal à cinq chiffres.'); return; }
    setSaving(true); setError('');
    try { await updateClient(cl.id, draft); setEditing(false); setSaved(true); }
    catch (err) { setError(err.message || 'Vos coordonnées n’ont pas été enregistrées. Réessayez.'); }
    finally { setSaving(false); }
  };
  const createInvitation = async () => {
    setLinking(true); setError('');
    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_telegram_invitation', { p_client_id: cl.id });
      if (rpcError) throw rpcError;
      const link = Array.isArray(result) ? result[0] : result;
      if (!link?.url) throw new Error('Le lien de connexion Telegram est indisponible.');
      setInvitation(link);
    } catch (err) { setError(err.message || 'Impossible de créer votre invitation Telegram.'); }
    finally { setLinking(false); }
  };
  const exportData = () => {
    const profileKeys = ['id', 'nom', 'prenom', 'email', 'tel', 'cp', 'ville', 'adresseLigne1', 'adresseLigne2', 'abonnement', 'abonnementDebut', 'abonnementFin', 'telegramUsername'];
    const parcelKeys = ['id', 'ref', 'desc', 'statut', 'dateReception', 'trackings', 'dimL', 'dimW', 'dimH', 'poids', 'finL', 'finW', 'finH', 'finP', 'devisTransport', 'devisOM', 'devisOMR', 'devisTVA', 'devisTotal', 'quoteVersion', 'paiementDate', 'paiementMontant'];
    const pick = (record, keys) => Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
    const payload = { exporteLe: new Date().toISOString(), profil: pick(cl, profileKeys), dossiers: mine.map((c) => ({ ...pick(c, hasPublishedQuote(c) ? parcelKeys : parcelKeys.filter((key) => !key.startsWith('devis') && key !== 'quoteVersion')), messages: (c.messages || []).filter((m) => ['staff', 'client'].includes(m.type) && !m.interne).map((m) => pick(m, ['createdAt', 'auteur', 'texte', 'type'])) })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `expedile-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const logout = () => ask('Se déconnecter', 'Vous pourrez retrouver vos dossiers en vous reconnectant.', async () => {
    try { await signOut(); navigate('/', { replace: true }); }
    catch (err) { flash({ msg: err.message, type: 'error' }); }
  }, { okLabel: 'Se déconnecter' });

  const invoiceRow = f => <div key={f.id} className="flex flex-wrap gap-3 items-center py-4 border-b border-gray-100"><FileText size={18} className="text-gray-400" /><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800">{f.vendeur || 'Facture d’achat'}</p><p className="text-sm text-gray-500">{f.ref} · {f.duplicateOfId ? 'Copie retirée' : !f.current ? 'Remplacée' : f.valide ? 'Validée' : f.rejetMotif ? 'À corriger' : 'En cours de vérification'}</p><button onClick={() => navigate(`/colis/${f.colisId}?panel=documents`)} className="min-h-11 text-sm underline">Ouvrir l’expédition</button></div>{f.fichier && <SecureFileLink href={f.fichier} className="text-sm min-h-11 inline-flex gap-2 items-center brand-t font-semibold">Consulter<ExternalLink size={14} /></SecureFileLink>}</div>;
  return <div className="space-y-7 pb-6 anim-fade">
    {helpOpen && <OnboardingOverlay onDone={() => setHelpOpen(false)} />}
    <header className="rounded-2xl p-5 sm:p-7 text-white" style={{ background: `linear-gradient(120deg, ${BRAND.navy}, ${BRAND.navyL})` }}>
      <div className="flex items-center gap-4"><div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black brand-bg-gold" style={{ color: 'var(--brand-text)' }}>{(cl.nom || '?').slice(0, 1).toUpperCase()}</div>
        <div><p className="text-sm text-white/60">Votre espace personnel</p><h1 className="text-xl font-bold">{getPrenom(cl) || cl.nom}</h1><p className="text-sm text-white/80 mt-1">{destination?.flag} {destination?.nom || cl.ville}</p></div></div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 pt-4 border-t border-white/15 text-sm"><span><b>{active.length}</b> dossier{active.length > 1 ? 's' : ''} en cours</span><span>Formule <b>{ABONNEMENTS[cl.abonnement]?.label || cl.abonnement || 'Freemium'}</b></span>{cl.abonnementFin && <span>Échéance : {new Date(cl.abonnementFin).toLocaleDateString('fr-FR')}</span>}</div>
    </header>
    <nav aria-label="Rubriques du profil" className="flex flex-wrap gap-2">{[['profile-contact-title', 'Coordonnées'], ['telegram-title', 'Notifications'], ['account-title', 'Compte et sécurité']].map(([id,label]) => <a key={id} href={`#${id}`} className="min-h-11 inline-flex items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold">{label}</a>)}</nav>
    <div className="flex flex-wrap gap-3"><button className="min-h-11 text-sm font-semibold underline" onClick={() => setHelpOpen(true)}>Revoir le guide de démarrage</button><a className="min-h-11 inline-flex items-center text-sm font-semibold underline" href="mailto:contact@expedile.fr?subject=Aide%20sur%20mon%20compte">Contacter l’équipe</a></div>
    {saved && <p role="status" className="text-sm text-emerald-700">Vos coordonnées sont enregistrées.</p>}
    {error && <p role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">{error}</p>}
    <section aria-labelledby="profile-contact-title">
      <div className="flex items-center justify-between mb-3"><h2 id="profile-contact-title" className="font-bold text-gray-900">Mes coordonnées</h2>{!editing && <button onClick={startEdit} className="inline-flex items-center gap-2 text-sm font-semibold brand-t min-h-11"><Pencil size={15} />Modifier</button>}</div>
      {editing ? <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">{[
          ['nom', 'Nom de famille', 'text', true], ['prenom', 'Prénom', 'text', false], ['email', 'Email de contact', 'email', true], ['tel', 'Téléphone', 'tel', false], ['adresseLigne1', 'Adresse', 'text', false], ['adresseLigne2', 'Complément d’adresse', 'text', false], ['cp', 'Code postal', 'text', true], ['ville', 'Ville', 'text', false],
        ].map(([key, label, type, required]) => <label key={key} className="space-y-1 block text-sm font-semibold text-gray-600">{label}<input type={type} required={required} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} className={inputClass} /></label>)}</div>
        <p className="text-sm text-gray-500">L’email de contact sert aux échanges sur vos colis. Votre adresse de connexion reste inchangée.</p>
        <div className="flex gap-3"><button disabled={saving} className="min-h-11 rounded-xl px-4 brand-bg text-white font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Check size={16} />{saving ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" disabled={saving} onClick={() => { setEditing(false); setDraft({}); setError(''); }} className="min-h-11 px-4 text-gray-600 inline-flex items-center gap-2"><X size={16} />Annuler</button></div>
      </form> : <div className="divide-y divide-gray-100 border-y border-gray-100">{[[User, cl.nom], [Mail, cl.email], [Phone, cl.tel], [MapPin, [cl.adresseLigne1, cl.adresseLigne2, cl.cp, cl.ville].filter(Boolean).join(', ')]].map(([Icon, value], i) => <div key={i} className="flex items-center gap-3 py-3 text-sm text-gray-700"><Icon size={17} className="text-gray-400 shrink-0" /><span className="break-words">{value || 'Non renseigné'}</span></div>)}</div>}
    </section>
    <section className="rounded-2xl border border-gray-200 p-4 sm:p-5" aria-labelledby="telegram-title"><div className="flex items-start gap-3"><MessageCircle size={22} className="brand-t shrink-0 mt-1" /><div><h2 id="telegram-title" className="font-bold text-gray-900">Recevoir mes nouvelles sur Telegram</h2><p className="text-sm text-gray-600 mt-1">{cl.telegramChatId ? `Votre compte Telegram${cl.telegramUsername ? ` @${cl.telegramUsername}` : ''} est connecté. Les nouvelles de vos expéditions peuvent vous y être envoyées.` : 'Connectez Telegram pour recevoir les demandes de préparation et y répondre rapidement. Vos dossiers restent aussi accessibles ici.'}</p></div></div>
      {cl.telegramChatId && <a href="mailto:contact@expedile.fr?subject=Changer%20mon%20compte%20Telegram" className="mt-2 inline-flex min-h-11 items-center text-sm underline">Demander le changement de compte Telegram</a>}
      {!cl.telegramChatId && <p className="mt-3 text-sm text-slate-600">1. Ouvrir Telegram · 2. Appuyer sur Démarrer · 3. Revenir vérifier la connexion ici.</p>}
      {!cl.telegramChatId && <div className="mt-4">{invitation ? <><a href={invitation.url} target="_blank" rel="noopener noreferrer" className="inline-flex gap-2 items-center min-h-11 px-4 rounded-xl brand-bg text-white text-sm font-semibold">Connecter Telegram<ExternalLink size={15} /></a><p className="text-sm text-gray-500 mt-2">Ce lien est personnel et à usage unique. Dans Telegram, appuyez sur « Démarrer ». Le compte n’est connecté qu’après cette confirmation.</p><button disabled={linking} onClick={createInvitation} className="min-h-11 mt-2 text-sm underline">{linking ? 'Création du lien…' : 'Lien expiré ? Créer un nouveau lien'}</button></> : <button disabled={linking} onClick={createInvitation} className="min-h-11 px-4 rounded-xl brand-bg text-white text-sm font-semibold disabled:opacity-50">{linking ? 'Création du lien…' : 'Connecter mon Telegram'}</button>}</div>}
    </section>
    <details><summary id="documents-title" className="min-h-11 cursor-pointer py-3 font-bold text-gray-900">Mes documents</summary><div className="flex gap-2 border-b border-gray-200 mb-2">{[['devis', 'Devis'], ['factures', 'Factures d’achat']].map(([key, label]) => <button key={key} onClick={() => setDocuments(key)} aria-pressed={documents === key} className={`min-h-11 px-3 text-sm font-semibold border-b-2 ${documents === key ? 'brand-t border-current' : 'text-gray-500 border-transparent'}`}>{label}</button>)}</div>
      {documents === 'devis' ? (estimates.length ? estimates.map((c) => <button key={c.id} onClick={() => navigate(`/colis/${c.id}`)} className="w-full min-h-14 flex items-center gap-3 py-4 border-b border-gray-100 text-left"><FileText size={18} className="text-gray-400" /><span className="flex-1 font-semibold text-sm text-gray-800">{c.ref}</span><span className="text-sm font-bold brand-t">{eur(c.devisTotal)}</span><ExternalLink size={15} className="text-gray-400" /></button>) : <p className="py-6 text-sm text-gray-500">Vos devis apparaîtront ici une fois vérifiés et envoyés par l’équipe.</p>) : (invoices.length ? <><div>{invoices.filter(f => f.current).map(invoiceRow)}</div>{invoices.some(f => !f.current) && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Anciennes versions et copies</summary>{invoices.filter(f => !f.current).map(invoiceRow)}</details>}</> : <p className="py-6 text-sm text-gray-500">Ajoutez vos factures depuis l’expédition concernée.</p>)}
    </details>
    <section className="border-t border-gray-200 pt-4 space-y-1" aria-labelledby="account-title"><h2 id="account-title" className="font-bold text-slate-800">Compte et sécurité</h2><p className="text-sm text-slate-600 break-all">Email de connexion : {auth?.session?.user?.email || 'Non disponible'}</p><p className="text-sm text-slate-600">Pour utiliser un autre compte, déconnectez-vous ci-dessous.</p><button onClick={() => navigate('/password')} className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Lock size={17} />Modifier mon mot de passe</button><button onClick={exportData} className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Download size={17} />Télécharger mes données accessibles</button><p className="text-sm text-gray-500 pl-7">Export JSON de votre profil et des dossiers chargés dans votre espace.</p><a href="mailto:contact@expedile.fr?subject=Aide%20sur%20mon%20compte%20Expedile" className="w-full min-h-12 flex items-center gap-3 text-sm text-gray-700"><Mail size={17} />Contacter l’équipe par email</a></section>
    <div className="space-y-2"><button onClick={logout} className="min-h-12 w-full rounded-xl border border-gray-200 brand-t font-semibold flex items-center justify-center gap-2"><LogOut size={17} />Se déconnecter</button><a href={`mailto:contact@expedile.fr?subject=${encodeURIComponent('Demande de suppression de mon compte Expedîle')}&body=${encodeURIComponent(`Bonjour, je souhaite demander la suppression de mon compte associé à ${cl.email || ''}. Merci de m’indiquer les étapes et les données qui doivent être conservées.`)}`} className="min-h-11 flex items-center justify-center gap-2 text-sm text-gray-500"><Trash2 size={14} />Demander la suppression de mon compte</a><p className="text-sm text-gray-500 text-center">Cette demande ouvre votre messagerie. L’équipe vous confirmera sa prise en charge et les éventuelles données à conserver.</p></div>
  </div>;
}

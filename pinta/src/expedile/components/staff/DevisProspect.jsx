import React, { useState } from 'react';
import { Copy, Download, Mail, Calculator } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, DESTINATIONS } from '../../constants';
import { eur } from '../../utils';
import { useNavigate } from 'react-router-dom';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { calculateQuote } from '../../domain/quote';

const INPUT = 'min-h-11 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300';
function Field({ label, children }) { return <label className="block text-xs font-semibold text-gray-500">{label}<div className="mt-1">{children}</div></label>; }

export default function DevisProspect() {
  const { tarifs, categories, settings = {}, can } = useApp();
  const navigate = useNavigate();
  const [form, setForm, { storageAvailable }] = usePersistentDraft('estimate:prospect', { nom: '', prenom: '', email: '', type: 'particulier', dimL: '', dimW: '', dimH: '', poids: '', valeurMarchandise: '', categorie: '', destination: '974' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key, value) => { setForm((previous) => ({ ...previous, [key]: value })); setNotice(''); };
  const isPro = form.type === 'pro';
  const destination = DESTINATIONS[form.destination];
  const client = { type: form.type, nom: `${form.prenom} ${form.nom}`.trim(), email: form.email };
  const colis = { ref: 'ESTIMATION', finL: form.dimL, finW: form.dimW, finH: form.dimH, finP: form.poids, lignes: [{ desc: 'Marchandise déclarée', qte: 1, prix: form.valeurMarchandise, cat: form.categorie }] };
  const quote = calculateQuote({ colis, client, destination, tarif: tarifs[form.destination], categories, settings, mode: 'estimate' });
  const text = quote.ok ? `Bonjour ${form.prenom || form.nom || ''},\n\nVoici votre estimation pour une expédition vers ${destination.nom}.\n\nDimensions : ${form.dimL} × ${form.dimW} × ${form.dimH} cm\nPoids réel : ${form.poids} kg\nPoids facturable : ${quote.amounts.billableWeight.toFixed(2)} kg\n\nTransport : ${eur(quote.amounts.transport)}${isPro ? '' : `\nOctroi de mer : ${eur(quote.amounts.om)}\nOctroi de mer régional : ${eur(quote.amounts.omr)}\nTVA : ${eur(quote.amounts.tva)}`}\nTotal estimatif : ${eur(quote.amounts.total)}\n\nLe montant définitif sera établi après réception, vérification des documents et mesure du colis. Les frais de services supplémentaires éventuellement convenus seront indiqués séparément.\n\nL’équipe Expedîle` : '';
  const prepareEmail = () => {
    window.location.href = `mailto:${encodeURIComponent(form.email)}?subject=${encodeURIComponent(`Estimation Expedîle — ${destination.nom}`)}&body=${encodeURIComponent(text)}`;
    setNotice('L’email est préparé dans votre messagerie. Vérifiez-le puis envoyez-le ; son envoi n’est pas suivi dans Expedîle.');
  };
  const download = async () => {
    setBusy(true); setNotice('');
    try { const { exportDevisPDF } = await import('../../utils/exportDevisPDF'); exportDevisPDF({ ...colis, ...quote.patch, quoteSnapshot: quote.snapshot }, client, destination); }
    catch (error) { setNotice(`Le PDF n’a pas pu être créé : ${error.message}`); }
    finally { setBusy(false); }
  };
  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
    <div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">Avant réception</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold" style={{ color: BRAND.navy }}><Calculator size={23} />Estimation rapide</h1><p className="mt-2 text-sm text-gray-500">Estimation pour un carton et une catégorie de marchandise. Les mesures après optimisation serviront au devis définitif.</p></div>
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">{!storageAvailable && <p role="status">Stockage indisponible : gardez cet onglet ouvert pour conserver votre estimation.</p>}
        <div className="flex rounded-xl bg-slate-100 p-1">{[['particulier', 'Particulier'], ['pro', 'Professionnel']].map(([value, label]) => <button key={value} aria-pressed={form.type === value} onClick={() => set('type', value)} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${form.type === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}</div>
        <Field label="Destination"><select value={form.destination} onChange={(event) => set('destination', event.target.value)} className={INPUT}>{Object.entries(DESTINATIONS).map(([code, item]) => <option key={code} value={code}>{item.flag} {item.nom}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">{[['dimL', 'Longueur (cm)'], ['dimW', 'Largeur (cm)'], ['dimH', 'Hauteur (cm)'], ['poids', 'Poids (kg)']].map(([key, label]) => <Field key={key} label={label}><input aria-label={label} type="number" min="0.01" step="0.01" value={form[key]} onChange={(event) => set(key, event.target.value)} className={INPUT} /></Field>)}</div>
        {!isPro && <div className="space-y-3 border-t border-gray-200 pt-4"><Field label="Valeur de la marchandise (€)"><input aria-label="Valeur de la marchandise" type="number" min="0.01" step="0.01" value={form.valeurMarchandise} onChange={(event) => set('valeurMarchandise', event.target.value)} className={INPUT} /></Field><Field label="Catégorie de marchandise"><select value={form.categorie} onChange={(event) => set('categorie', event.target.value)} className={INPUT}><option value="">Choisir une catégorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></Field><p className="text-xs text-gray-400">Pour des achats de plusieurs catégories, établissez le devis détaillé dans un dossier client.</p></div>}

      </div>
      <aside className="min-w-0 space-y-4 self-start rounded-2xl bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-slate-800">Votre estimation</h2>
        {quote.ok ? <><p className="text-3xl font-bold" style={{ color: BRAND.navy }}>{eur(quote.amounts.total)}</p><dl className="space-y-2 text-sm">{[['Transport', quote.amounts.transport], ...(!isPro ? [['Octroi de mer', quote.amounts.om], ['Octroi de mer régional', quote.amounts.omr], [`TVA (${destination.tva} %)`, quote.amounts.tva]] : [])].map(([label, amount]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-500">{label}</dt><dd className="font-semibold text-slate-700">{eur(amount)}</dd></div>)}</dl><p className="border-t border-gray-200 pt-3 text-xs text-gray-500">Poids facturable : {quote.amounts.billableWeight.toFixed(2)} kg. {isPro ? 'Transport professionnel, hors taxes gérées séparément.' : 'Taxes calculées sur la catégorie sélectionnée.'}</p></> : form.dimL || form.dimW || form.dimH || form.poids ? <ul className="list-disc space-y-2 pl-4 text-xs text-gray-500">{quote.errors.map((error, index) => <li key={index}>{error.message}</li>)}</ul> : <p className="text-sm text-gray-600">Renseignez les mesures et le poids pour obtenir une estimation.</p>}
        <p className="text-xs text-gray-500">Estimation indicative, à confirmer après réception et vérification. Les frais supplémentaires ne sont ajoutés que s’ils sont convenus et renseignés.</p>
        <div className="space-y-3 border-t border-gray-200 pt-4"><p className="text-xs font-semibold text-slate-600">Destinataire (pour partager)</p><div className="grid grid-cols-2 gap-3"><Field label="Nom"><input value={form.nom} onChange={(event) => set('nom', event.target.value)} className={INPUT} /></Field><Field label="Prénom"><input value={form.prenom} onChange={(event) => set('prenom', event.target.value)} className={INPUT} /></Field></div><Field label="Email"><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} className={INPUT} /></Field></div>
        <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Aperçu du texte à partager</summary><pre className="whitespace-pre-wrap break-words text-sm">{text || 'Complétez les informations pour préparer le texte.'}</pre></details>
        <button disabled={!quote.ok || busy} onClick={download} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Download size={15} />Télécharger l’estimation</button>
        <button disabled={!quote.ok} onClick={async () => { try { await navigator.clipboard.writeText(text); setNotice('Estimation copiée.'); } catch { setNotice('La copie est indisponible. Utilisez le PDF ou préparez l’email.'); } }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"><Copy size={15} />Copier le texte</button>
        <button disabled={!quote.ok || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)} onClick={prepareEmail} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"><Mail size={15} />Préparer l’email</button>
        {quote.ok && can('perm_clients_creer') && <button className="min-h-11 w-full rounded-xl border px-3" onClick={() => navigate('/clients/new', { state: { clientPrefill: { nom: form.nom, prenom: form.prenom, email: form.email, type: form.type } } })}>Créer la fiche client avec ces coordonnées</button>}
        {notice && <p role="status" className="text-xs text-blue-800">{notice}</p>}
      </aside>
    </div>
  </div></div>;
}

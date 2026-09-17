import React, { useState, useRef } from 'react';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useApp } from '../../context/AppContext';
import { DEFAULT_BODIES } from '../../services/messageDefaults';

// ── Variables disponibles par groupe ──
const VAR_GROUPS = [
  {
    label: 'Client',
    vars: [
      { key: 'prenom', label: 'Prénom', ex: 'Flavie' },
      { key: 'nom_complet', label: 'Nom complet', ex: 'FONTAINE Flavie' },
      { key: 'destination_flag', label: 'Drapeau', ex: '🇷🇪' },
      { key: 'destination', label: 'Destination', ex: 'La Réunion' },
    ],
  },
  {
    label: 'Colis',
    vars: [
      { key: 'ref', label: 'Référence', ex: 'EXP-0011' },
      { key: 'desc', label: 'Description', ex: 'Amazon - Casque Sony' },
      { key: 'casier', label: 'Casier', ex: 'A-03' },
      { key: 'nb_cartons', label: 'Nb cartons', ex: '3' },
      { key: 'liste_cartons', label: 'Liste cartons', ex: '1. Amazon (LP123)\n2. SHEIN (SH789)' },
    ],
  },
  {
    label: 'Dimensions',
    vars: [
      { key: 'dims_brutes', label: 'Dims réception', ex: '35×28×18 cm' },
      { key: 'poids_brut', label: 'Poids réception', ex: '2.5 kg' },
      { key: 'poids_vol_avant', label: 'Poids vol. avant', ex: '3.53 kg' },
      { key: 'dims_finales', label: 'Dims optimisées', ex: '30×25×15 cm' },
      { key: 'poids_vol_apres', label: 'Poids vol. après', ex: '2.25 kg' },
      { key: 'poids_facturable', label: 'Poids facturable', ex: '3.53 kg' },
    ],
  },
  {
    label: 'Devis',
    vars: [
      { key: 'transport', label: 'Transport', ex: '36.25 €' },
      { key: 'om', label: 'OM', ex: '30.20 €' },
      { key: 'omr', label: 'OMR', ex: '15.40 €' },
      { key: 'taxes', label: 'Taxes (OM+OMR)', ex: '45.60 €' },
      { key: 'tva', label: 'TVA', ex: '6.96 €' },
      { key: 'taux_tva', label: 'Taux TVA', ex: '8.5%' },
      { key: 'total', label: 'Total', ex: '93.81 €' },
      { key: 'lien_paiement', label: 'Lien de paiement', ex: 'https://paiement.exemple.test/devis' },
      { key: 'modalite_paiement', label: 'Modalités pro', ex: 'par virement bancaire' },
      { key: 'lien_espace', label: 'Dossier en ligne', ex: 'https://exemple.test/colis/dossier' },
      { key: 'documents_attendus', label: 'Documents attendus', ex: 'Merci de joindre la facture d’achat.' },
      { key: 'economie', label: 'Économie', ex: '12.50 €' },
      { key: 'frais_divers', label: 'Frais divers', ex: 'Enlèvement : 5.00 €' },
      { key: 'contenu_declare', label: 'Contenu déclaré', ex: '• Casque Sony × 1 — 350 €' },
    ],
  },
  {
    label: 'Divers',
    vars: [
      { key: 'date_expedition', label: 'Date expédition', ex: '29/03/2026' },
      { key: 'motif_rejet', label: 'Motif rejet', ex: 'Document illisible' },
    ],
  },
];

const ALL_EXAMPLES = {};
VAR_GROUPS.forEach((g) => g.vars.forEach((v) => { ALL_EXAMPLES[v.key] = v.ex; }));

// ── Templates par défaut ──
const TEMPLATES = [
  { key: 'reception', label: 'Réception seule (ancien modèle)' , emoji: '📦' },
  { key: 'facture_manquante', label: '📄 Facture manquante', emoji: '📄' },
  { key: 'demande_feu_vert', label: 'Réception et demande d’accord', emoji: '🟢' },
  { key: 'feu_vert_recu', label: '✅ Feu vert confirmé', emoji: '✅' },
  { key: 'devis_final', label: 'Devis particulier', emoji: '' },
  { key: 'devis_final_pro', label: 'Devis professionnel', emoji: '' },
  { key: 'relance_feu_vert', label: '⏰ Relance feu vert', emoji: '⏰' },
  { key: 'relance_paiement', label: '⏰ Relance paiement', emoji: '⏰' },
  { key: 'expedie', label: '✈️ Expédié', emoji: '✈️' },
  { key: 'arrive', label: '📍 Arrivé', emoji: '📍' },
  { key: 'en_livraison', label: '🚚 En livraison', emoji: '🚚' },
  { key: 'facture_rejetee', label: '❌ Facture rejetée', emoji: '❌' },
  { key: 'invitation_telegram', label: '📲 Invitation Telegram', emoji: '📲' },
];

// ── Preview: replace {{var}} with examples ──
function renderPreview(text) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => ALL_EXAMPLES[key] || `{{${key}}}`);
}

// ════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════
const FIELD = 'min-h-11 w-full rounded-xl border border-gray-300 bg-transparent px-3 py-2 text-sm';
const BUTTON = 'min-h-11 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
export default function TemplateEditor() {
  const { messageTemplates, saveMessageTemplate } = useApp();
  const [selKey, setSelKey] = useState('demande_feu_vert');
  const [canal, setCanal] = useState('telegram');
  const [drafts, setDrafts, { storageAvailable }] = usePersistentDraft('admin:message-templates', {});
  const [notice, setNotice] = useState(null); const [saving, setSaving] = useState(false); const lock = useRef(false); const textarea = useRef(null);
  const bodyKey = `${selKey}_${canal}`;
  const draft = drafts[bodyKey]; const stored = messageTemplates[bodyKey] ?? null;
  const body = draft?.value ?? stored ?? DEFAULT_BODIES[bodyKey] ?? '';
  const dirty = Boolean(draft && draft.value !== (draft.expected ?? DEFAULT_BODIES[bodyKey] ?? ''));
  const change = value => setDrafts(previous => ({ ...previous, [bodyKey]: { expected: previous[bodyKey]?.expected ?? stored, value } }));
  const forget = () => { setDrafts(previous => { const next = { ...previous }; delete next[bodyKey]; return next; }); setNotice(null); };
  const save = async () => {
    if (lock.current) return; const target = bodyKey; const expected = draft ? draft.expected : stored;
    lock.current = true; setSaving(true); setNotice(null);
    try {
      if (!body.trim()) throw new Error('Le message ne peut pas être vide.');
      const unknown = [...body.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).filter(key => !(key in ALL_EXAMPLES));
      if (unknown.length) throw new Error(`Variables inconnues : ${[...new Set(unknown)].join(', ')}.`);
      await saveMessageTemplate(selKey, canal, body, expected);
      setDrafts(previous => { const next = { ...previous }; delete next[target]; return next; });
      setNotice({ key: target, text: 'Modèle enregistré. Aucun message n’a été envoyé.' });
    } catch (error) { setNotice({ key: target, error: true, text: `${error.message} Votre brouillon est conservé.` }); }
    finally { lock.current = false; setSaving(false); }
  };
  const insert = key => { const field = textarea.current; const start = field?.selectionStart ?? body.length; const end = field?.selectionEnd ?? start; change(body.slice(0, start) + `{{${key}}}` + body.slice(end)); field?.focus(); };
  return <section className="min-w-0 space-y-4"><header><h2 className="text-lg font-bold">Modèles de messages</h2><p className="mt-1 text-sm text-gray-600">Le message principal confirme la réception, demande l’accord et indique les factures manquantes. L’équipe garde la main sur chaque envoi.</p></header>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Message à modifier<select className={FIELD} value={selKey} disabled={saving} onChange={e => setSelKey(e.target.value)}>{[...TEMPLATES].sort((a, b) => (a.key === 'demande_feu_vert' ? -1 : b.key === 'demande_feu_vert' ? 1 : 0)).map(t => <option key={t.key} value={t.key}>{t.label}{Object.keys(drafts).some(k => k.startsWith(`${t.key}_`)) ? ' · brouillon' : ''}</option>)}</select></label><label className="text-sm">Canal<select className={FIELD} disabled={saving} value={canal} onChange={e => setCanal(e.target.value)}><option value="telegram">Telegram</option><option value="email">Email</option></select></label></div>
    <p className="text-sm text-gray-600">{dirty ? 'Modifications non enregistrées. ' : ''}Vos brouillons restent disponibles lorsque vous changez de modèle ou de rubrique.{!storageAvailable && ' Stockage du navigateur indisponible : gardez cet onglet ouvert.'}</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2"><label className="min-w-0 text-sm">Texte du message<textarea ref={textarea} disabled={saving} rows={12} className={`${FIELD} mt-1 resize-y font-mono`} value={body} onChange={e => change(e.target.value)} /></label><section className="min-w-0 rounded-xl border bg-gray-50 p-4" aria-label="Aperçu du message"><h3 className="font-semibold">Aperçu avec des données fictives</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm">{renderPreview(body)}</p></section></div>
    <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Insérer une information du dossier</summary><div className="space-y-3">{VAR_GROUPS.map(group => <section key={group.label}><h3 className="text-sm font-semibold">{group.label}</h3><div className="mt-1 flex flex-wrap gap-2">{group.vars.map(v => <button key={v.key} disabled={saving} className={BUTTON} onClick={() => insert(v.key)}>{v.label}</button>)}</div></section>)}</div></details>
    <div className="flex flex-wrap gap-2"><button disabled={saving || !dirty} className={`${BUTTON} brand-bg text-white`} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer le modèle'}</button><button disabled={saving || !draft} className={BUTTON} onClick={forget}>Annuler et recharger</button><button disabled={saving} className={BUTTON} onClick={() => change(DEFAULT_BODIES[bodyKey] || '')}>Préparer le modèle par défaut</button></div>
    {notice?.key === bodyKey && <p role={notice.error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.error ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>{notice.text}</p>}
    <p className="text-xs text-gray-600">Les versions enregistrées sont consignées dans le journal serveur. Cet écran ne présente pas d’historique de restauration.</p>
  </section>;
}

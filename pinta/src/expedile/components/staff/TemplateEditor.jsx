import React, { useState, useRef, useLayoutEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useApp } from '../../context/AppContext';
import { DEFAULT_BODIES } from '../../services/messageDefaults';
import { importTaxMessage, legacyTaxLines, savedTemplatesWithLegacyTaxes } from '../../domain/importTaxes';
import { messageEur } from '../../utils/format';

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
      // The quote's taxes as the client reads them since 10 October 2026: an estimate of the import taxes,
      // paid on arrival and included in the price (domain/importTaxes.js), with its two other versions.
      { key: 'estimation_taxes', label: 'Estimation des taxes à l’importation', ex: importTaxMessage({ om: 30.2, omr: 15.4, tva: 6.96, total: 93.81 }, { code: '974' }, { money: messageEur }) },
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

// The former tax variables: still rendered for the templates saved with them (never rewritten), no longer
// offered for insertion. They present the amounts as taxes of the price (« TVA (8,5 %) »).
const LEGACY_VARS = [
  { key: 'om', ex: '30.20 €' }, { key: 'omr', ex: '15.40 €' }, { key: 'taxes', ex: '45.60 €' },
  { key: 'tva', ex: '6.96 €' }, { key: 'taux_tva', ex: '8.5%' },
];

const ALL_EXAMPLES = {};
VAR_GROUPS.forEach((g) => g.vars.forEach((v) => { ALL_EXAMPLES[v.key] = v.ex; }));
LEGACY_VARS.forEach((v) => { ALL_EXAMPLES[v.key] = v.ex; });

// ── Templates par défaut ── (labels only: plain text, no emoji; keys unchanged)
const TEMPLATES = [
  { key: 'reception', label: 'Réception seule (ancien modèle)' },
  { key: 'facture_manquante', label: 'Facture manquante' },
  { key: 'demande_feu_vert', label: 'Réception et demande d’accord' },
  // Confirmations sent by the server after a Telegram button of the request (lot 3b).
  { key: 'feu_vert_recu', label: 'Accord enregistré (confirmation au client)', hint: 'Envoyé automatiquement sur Telegram quand le client autorise la préparation avec le bouton de la demande, si sa facture d’achat n’est plus attendue ou s’il est professionnel.' },
  { key: 'feu_vert_recu_facture', label: 'Accord enregistré, facture encore attendue', hint: 'Envoyé automatiquement sur Telegram quand le client autorise la préparation alors que sa facture d’achat manque encore. Un document envoyé en réponse est ajouté comme facture à vérifier.' },
  { key: 'choix_attente_recu', label: 'Choix « attendre d’autres colis » enregistré', hint: 'Envoyé automatiquement sur Telegram quand le client choisit d’attendre d’autres colis avec le bouton de la demande.' },
  { key: 'refus_recu', label: 'Refus de préparation enregistré', hint: 'Envoyé automatiquement sur Telegram quand le client refuse la préparation avec le bouton de la demande.' },
  { key: 'devis_final', label: 'Devis particulier' },
  { key: 'devis_final_pro', label: 'Devis professionnel' },
  { key: 'relance_feu_vert', label: 'Relance de la demande d’accord' },
  { key: 'relance_paiement', label: 'Relance du paiement' },
  { key: 'expedie', label: 'Colis expédié' },
  { key: 'arrive', label: 'Colis arrivé à destination' },
  { key: 'en_livraison', label: 'Colis en livraison' },
  { key: 'facture_rejetee', label: 'Facture rejetée' },
  { key: 'facture_apres_devis', label: 'Facture reçue après le devis (ancien lien annulé)', hint: 'Envoyé automatiquement, sur Telegram ou sinon dans l’espace client, quand une facture du client arrive après l’envoi du devis : le devis est retiré et son ancien lien de paiement annulé.' },
  { key: 'facture_apres_devis_sans_lien', label: 'Facture reçue après le devis (sans lien de paiement)', hint: 'Envoyé automatiquement, sur Telegram ou sinon dans l’espace client, quand une facture du client arrive après l’envoi d’un devis sans lien de paiement : le devis est retiré.' },
  { key: 'invitation_telegram', label: 'Invitation Telegram' },
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
  const hint = TEMPLATES.find(template => template.key === selKey)?.hint;
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
  // Saved templates (and the text shown) that still present the quote's taxes as taxes of the price:
  // named here, never rewritten (decision of 10 October 2026, domain/importTaxes.js).
  const legacy = savedTemplatesWithLegacyTaxes(messageTemplates, TEMPLATES.map(template => template.key));
  const legacyLines = legacyTaxLines(body);
  const insert = key => { const field = textarea.current; const start = field?.selectionStart ?? body.length; const end = field?.selectionEnd ?? start; change(body.slice(0, start) + `{{${key}}}` + body.slice(end)); field?.focus(); };
  // The whole template stays readable without an inner scroll bar: the field follows its text (12 lines at least),
  // up to 85 % of the window, then it scrolls. Measured again when the text, the model, the channel or the width change.
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return undefined;
    const fit = () => {
      field.style.height = 'auto';
      const borders = field.offsetHeight - field.clientHeight;
      field.style.height = `${Math.min(field.scrollHeight + borders, Math.max(320, Math.round(window.innerHeight * 0.85)))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [body]);
  return <section className="min-w-0 space-y-4"><header><h2 className="text-lg font-bold">Modèles de messages</h2><p className="mt-1 text-sm text-gray-600">Le message principal confirme la réception, demande l’accord et indique les factures manquantes. Les modèles signalés « Envoyé automatiquement » partent sans action de l’équipe ; l’équipe envoie elle-même tous les autres.</p></header>
    {legacy.length > 0 && <section aria-labelledby="legacy-taxes-title" data-testid="legacy-tax-templates" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <h3 id="legacy-taxes-title" className="flex items-start gap-2 font-semibold"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{legacy.length === 1 ? 'Un modèle enregistré présente encore les taxes de l’ancienne façon' : `${legacy.length} modèles enregistrés présentent encore les taxes de l’ancienne façon`}</h3>
      <p>Depuis le 10 octobre 2026, le devis présente l’octroi de mer, l’OMR et la TVA comme une estimation des taxes à l’importation, payées à l’arrivée et comprises dans le prix, jamais comme des taxes facturées par Expedîle. Ces modèles partent tels qu’ils ont été enregistrés : rien n’est modifié automatiquement. Ouvrez-les, remplacez les lignes signalées par l’information « Estimation des taxes à l’importation », puis enregistrez.</p>
      <ul className="flex flex-wrap gap-2">{legacy.map(item => <li key={item.bodyKey}><button type="button" disabled={saving} aria-pressed={item.bodyKey === bodyKey} className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 py-2 text-left font-semibold transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50" onClick={() => { setSelKey(item.key); setCanal(item.canal); }}>{TEMPLATES.find(template => template.key === item.key)?.label || item.key} · {item.canal === 'email' ? 'Email' : 'Telegram'}</button></li>)}</ul>
    </section>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Message à modifier<select className={FIELD} value={selKey} disabled={saving} onChange={e => setSelKey(e.target.value)}>{[...TEMPLATES].sort((a, b) => (a.key === 'demande_feu_vert' ? -1 : b.key === 'demande_feu_vert' ? 1 : 0)).map(t => <option key={t.key} value={t.key}>{t.label}{['telegram', 'email'].some(c => drafts[`${t.key}_${c}`]) ? ' · brouillon' : ''}</option>)}</select></label><label className="text-sm">Canal<select className={FIELD} disabled={saving} value={canal} onChange={e => setCanal(e.target.value)}><option value="telegram">Telegram</option><option value="email">Email</option></select></label></div>
    {hint && <p className="text-sm text-gray-600">{hint}{canal === 'email' ? ' La version email reste un brouillon : aucun email n’est envoyé automatiquement.' : ''}</p>}
    {legacyLines.length > 0 && <div role="note" aria-labelledby="legacy-tax-lines-title" data-testid="legacy-tax-lines" className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p id="legacy-tax-lines-title" className="font-semibold">Ce texte présente encore ces montants comme des taxes du prix. Lignes à remplacer par l’information « Estimation des taxes à l’importation » :</p><ul className="list-disc space-y-0.5 pl-5">{legacyLines.map((line, index) => <li key={index} className="break-words font-mono">{line}</li>)}</ul></div>}
    <p className="text-sm text-gray-600">{dirty ? 'Modifications non enregistrées. ' : ''}Vos brouillons restent disponibles lorsque vous changez de modèle ou de rubrique.{!storageAvailable && ' Stockage du navigateur indisponible : gardez cet onglet ouvert.'}</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2"><label className="min-w-0 text-sm">Texte du message<textarea ref={textarea} disabled={saving} rows={12} className={`${FIELD} mt-1 resize-y font-mono`} value={body} onChange={e => change(e.target.value)} /></label><section className="min-w-0 rounded-xl border bg-gray-50 p-4" aria-label="Aperçu du message"><h3 className="font-semibold">Aperçu avec des données fictives</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm">{renderPreview(body)}</p></section></div>
    <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Insérer une information du dossier</summary><div className="space-y-3">{VAR_GROUPS.map(group => <section key={group.label}><h3 className="text-sm font-semibold">{group.label}</h3><div className="mt-1 flex flex-wrap gap-2">{group.vars.map(v => <button key={v.key} disabled={saving} className={BUTTON} onClick={() => insert(v.key)}>{v.label}</button>)}</div></section>)}</div></details>
    <div className="flex flex-wrap gap-2"><button disabled={saving || !dirty} className={`${BUTTON} brand-bg text-white`} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer le modèle'}</button><button disabled={saving || !draft} className={BUTTON} onClick={forget}>Annuler et recharger</button><button disabled={saving} className={BUTTON} onClick={() => change(DEFAULT_BODIES[bodyKey] || '')}>Préparer le modèle par défaut</button></div>
    {notice?.key === bodyKey && <p role={notice.error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.error ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>{notice.text}</p>}
    <p className="text-xs text-gray-600">Les versions enregistrées sont consignées dans le journal serveur. Cet écran ne présente pas d’historique de restauration.</p>
  </section>;
}

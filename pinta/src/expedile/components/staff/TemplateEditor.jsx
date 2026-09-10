import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Save, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { BRAND } from '../../constants';
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
  { key: 'reception', label: '📦 Réception', emoji: '📦' },
  { key: 'facture_manquante', label: '📄 Facture manquante', emoji: '📄' },
  { key: 'demande_feu_vert', label: '🟢 Demande feu vert', emoji: '🟢' },
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
export default function TemplateEditor() {
  const {messageTemplates,saveMessageTemplate,flash}=useApp();
  const [saving,setSaving]=useState(false);
  const [selKey, setSelKey] = useState('reception');
  const [canal, setCanal] = useState('telegram');
  const [bodies, setBodies] = useState(()=>({...DEFAULT_BODIES,...messageTemplates}));
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState({});
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef(null);
  useEffect(()=>setBodies(prev=>({...prev,...messageTemplates})),[messageTemplates]);

  const bodyKey = `${selKey}_${canal}`;
  const corps = bodies[bodyKey] || '';

  const setCorps = (val) => setBodies((prev) => ({ ...prev, [bodyKey]: val }));

  const insertVariable = (varName) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const insertion = `{{${varName}}}`;
    const newText = corps.substring(0, start) + insertion + corps.substring(end);
    setCorps(newText);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + insertion.length;
    }, 0);
  };

  const handleSave = async () => {
    if(saving)return;
    if(!corps.trim()){flash({msg:'Le modèle ne peut pas être vide.',type:'error'});return;}
    const unknown=[...corps.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]).filter(key=>!(key in ALL_EXAMPLES));
    if(unknown.length){flash({msg:`Variables inconnues : ${unknown.join(', ')}`,type:'error'});return;}
    setSaving(true);
    try { await saveMessageTemplate(selKey,canal,corps); }
    catch(error){flash({msg:`Modèle non enregistré : ${error.message}`,type:'error'});setSaving(false);return;}
    setSaving(false);
    const vKey = bodyKey;
    const prev = versions[vKey] || [];
    setVersions((v) => ({
      ...v,
      [vKey]: [{ corps, date: new Date().toISOString() }, ...prev].slice(0, 10),
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRestore = (version) => {
    setCorps(version.corps);
  };

  const handleReset = () => {
    setCorps(DEFAULT_BODIES[bodyKey] || '');
  };

  const historyItems = versions[bodyKey] || [];

  return (
    <div className="flex flex-col sm:flex-row gap-4 min-h-[500px]">
      {/* ── Left: Template list ── */}
      <div className="sm:w-48 flex-shrink-0 flex sm:block overflow-x-auto space-y-0.5">
        {TEMPLATES.map((tpl) => {
          const isActive = selKey === tpl.key;
          return (
            <button
              key={tpl.key}
              onClick={() => { setSelKey(tpl.key); setShowPreview(false); }}
              className={`w-full min-h-[44px] whitespace-nowrap text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                isActive ? 'bg-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
              }`}
              style={isActive ? { color: BRAND.navy, borderLeft: `3px solid ${BRAND.navy}` } : {}}
            >
              {tpl.label}
            </button>
          );
        })}
      </div>

      {/* ── Right: Editor ── */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Canal toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: BRAND.navy }}>
            {TEMPLATES.find((t) => t.key === selKey)?.label}
          </span>
          <div className="ml-auto flex rounded-lg overflow-hidden border" style={{ borderColor: '#E5E7EB' }}>
            {['telegram', 'email'].map((c) => (
              <button
                key={c}
                onClick={() => setCanal(c)}
                className="px-3 py-1.5 text-xs font-bold transition-all"
                style={canal === c ? { background: BRAND.navy, color: 'white' } : { color: '#6B7280' }}
              >
                {c === 'telegram' ? 'Telegram' : 'Email'}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          rows={12}
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 text-sm leading-relaxed outline-none resize-y transition-all focus:border-blue-400"
          style={{ color: BRAND.navy, fontFamily: canal === 'telegram' ? 'monospace' : 'inherit' }}
        />

        {/* Variable pills */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliquez pour insérer une variable</p>
          {VAR_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-wrap items-center gap-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase w-16 flex-shrink-0">{group.label}</span>
              {group.vars.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVariable(v.key)}
                  title={`${v.label} — ex: ${v.ex}`}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all"
            style={{ background: showPreview ? BRAND.navy + '15' : '#F3F4F6', color: showPreview ? BRAND.navy : '#6B7280' }}
          >
            {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
            {showPreview ? 'Masquer aperçu' : 'Aperçu'}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw size={11} />
            Réinitialiser
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: saved ? '#10B981' : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
          >
            <Save size={13} />
            {saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
          </button>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 anim-fade">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Aperçu avec données d'exemple</p>
            <pre className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: canal === 'telegram' ? 'monospace' : 'inherit' }}>
              {renderPreview(corps)}
            </pre>
          </div>
        )}

        {/* History */}
        {historyItems.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory((p) => !p)}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 font-medium transition-colors"
            >
              Historique ({historyItems.length} version{historyItems.length > 1 ? 's' : ''})
              {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1.5 anim-fade">
                {historyItems.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="text-[10px] text-gray-400 flex-1">
                      {new Date(v.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={() => handleRestore(v)}
                      className="text-[10px] font-bold text-orange-600 hover:text-orange-800"
                    >
                      Restaurer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

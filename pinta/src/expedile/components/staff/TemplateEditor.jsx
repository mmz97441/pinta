import React, { useState, useRef } from 'react';
import { Eye, EyeOff, Save, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { BRAND } from '../../constants';

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
  { key: 'devis_final', label: '💳 Devis final', emoji: '💳' },
  { key: 'relance_feu_vert', label: '⏰ Relance feu vert', emoji: '⏰' },
  { key: 'relance_paiement', label: '⏰ Relance paiement', emoji: '⏰' },
  { key: 'expedie', label: '✈️ Expédié', emoji: '✈️' },
  { key: 'arrive', label: '📍 Arrivé', emoji: '📍' },
  { key: 'en_livraison', label: '🚚 En livraison', emoji: '🚚' },
  { key: 'facture_rejetee', label: '❌ Facture rejetée', emoji: '❌' },
];

const DEFAULT_BODIES = {
  reception_whatsapp: `Bonjour {{prenom}} 👋\n\nBonne nouvelle ! Votre colis *{{ref}}* est bien arrivé à notre entrepôt de Paris 🎉\n\n📦 *Contenu :* {{desc}}\n{{liste_cartons}}\n🎯 *Destination :* {{destination_flag}} {{destination}}\n\n📐 *Prochaine étape :* Nous allons mesurer et peser votre colis.\n\n💡 Pensez à nous envoyer la *facture d'achat* si ce n'est pas déjà fait.\n\nÀ très vite !\n_L'équipe Expedîle — Paris → {{destination}}_`,
  reception_email: `Bonjour {{nom_complet}},\n\nNous confirmons la réception de votre colis {{ref}} ({{desc}}) à notre entrepôt de Paris.\n\nDestination : {{destination_flag}} {{destination}}\n\nProchaines étapes :\n1. Mesure et pesage\n2. Demande de votre accord\n3. Optimisation emballage\n4. Envoi du devis final\n\n💡 Pensez à nous transmettre la facture d'achat.\n\nCordialement,\nL'équipe Expedîle`,
  demande_feu_vert_whatsapp: `Bonjour {{prenom}} 👋\n\nVotre colis *{{ref}}* a été mesuré ✅\n\n📦 *{{desc}}*\n📐 *Dimensions :* {{dims_brutes}} — {{poids_brut}}\n⚖️ *Poids vol. :* {{poids_vol_avant}}\n🎯 *Destination :* {{destination_flag}} {{destination}}\n\n🔔 *Votre accord est nécessaire :*\n✅ *OUI* → On prépare et optimise\n❌ *NON* → On annule\n\n💡 Le devis final après optimisation.\n\n_Expedîle_`,
  demande_feu_vert_email: `Bonjour {{nom_complet}},\n\nVotre colis {{ref}} ({{desc}}) a été mesuré.\n\nDimensions : {{dims_brutes}} — Poids : {{poids_brut}}\nPoids volumétrique : {{poids_vol_avant}}\nDestination : {{destination_flag}} {{destination}}\n\nNous avons besoin de votre accord pour préparer votre colis.\n\nCordialement,\nL'équipe Expedîle`,
  devis_final_whatsapp: `Bonjour {{prenom}} 👋\n\nLe devis pour *{{ref}}* est prêt ! 📋\n\n🎯 {{destination_flag}} {{destination}}\n{{liste_cartons}}\n\n📐 Poids vol. avant : {{poids_vol_avant}}\n📐 Après optim. : {{dims_finales}} — {{poids_vol_apres}}\n⚖️ Poids facturable : {{poids_facturable}}\n{{contenu_declare}}\n\n━━━━━━━━━━━━━━\n🚀 Transport : *{{transport}}*\n🏛️ Taxes : *{{taxes}}*\n📊 TVA ({{taux_tva}}) : *{{tva}}*\n{{frais_divers}}\n━━━━━━━━━━━━━━\n💰 *TOTAL : {{total}}*\n━━━━━━━━━━━━━━\n\n👉 Payez pour déclencher l'expédition.\n\n_Expedîle_`,
  devis_final_email: `Bonjour {{nom_complet}},\n\nLe devis final pour {{ref}} est prêt.\n\nRéférence : {{ref}}\nDestination : {{destination_flag}} {{destination}}\n{{liste_cartons}}\n\nPoids facturable : {{poids_facturable}}\n\nTransport : {{transport}}\nOM : {{om}}\nOMR : {{omr}}\nTVA ({{taux_tva}}) : {{tva}}\n{{frais_divers}}\n\nTOTAL : {{total}}\n\nCordialement,\nL'équipe Expedîle`,
  facture_manquante_whatsapp: `Bonjour {{prenom}} 👋\n\nPour votre colis *{{ref}}* ({{desc}}), nous avons besoin de la *facture d'achat*.\n\n📄 *Pourquoi ?* Calcul des taxes, déclaration douane, devis final.\n\n👉 Envoyez-nous une *photo* ou *PDF* en réponse.\n\n_Expedîle_`,
  facture_manquante_email: `Bonjour {{nom_complet}},\n\nPour traiter votre colis {{ref}} ({{desc}}), nous avons besoin de la facture d'achat.\n\nMerci de nous la transmettre.\n\nCordialement,\nL'équipe Expedîle`,
  feu_vert_recu_whatsapp: `Bonjour {{prenom}} 👋\n\nMerci pour votre accord ! ✅\n\nVotre colis *{{ref}}* est en cours de préparation.\n\nVous recevrez le devis final dès que c'est prêt.\n\n_Expedîle_`,
  feu_vert_recu_email: `Bonjour {{nom_complet}},\n\nAccord reçu pour {{ref}}. Notre équipe prépare votre colis.\n\nCordialement,\nL'équipe Expedîle`,
  relance_feu_vert_whatsapp: `Bonjour {{prenom}} 👋\n\nRappel : *{{ref}}* ({{desc}}) attend votre accord.\n\n✅ *OUI* pour préparer\n❌ *NON* pour annuler\n\n⚠️ Frais de stockage après 14 jours.\n\n_Expedîle_`,
  relance_feu_vert_email: `Bonjour {{nom_complet}},\n\nVotre colis {{ref}} est toujours en attente de votre accord.\n\nNote : frais de stockage possibles après 14 jours.\n\nCordialement,\nL'équipe Expedîle`,
  relance_paiement_whatsapp: `Bonjour {{prenom}} 👋\n\nVotre colis *{{ref}}* est prêt ! ✈️\n\n💰 *Montant : {{total}}*\n🎯 {{destination_flag}} {{destination}}\n\n👉 Payez pour déclencher l'expédition.\n\n_Expedîle_`,
  relance_paiement_email: `Bonjour {{nom_complet}},\n\nLe paiement de {{total}} pour {{ref}} est en attente.\n\nCordialement,\nL'équipe Expedîle`,
  expedie_whatsapp: `Bonjour {{prenom}} 👋\n\n✈️ *{{ref}}* est en route !\n\n📦 {{desc}}\n🎯 {{destination_flag}} {{destination}}\n📅 Expédié le {{date_expedition}}\n\nSuivi : Transit → Dédouanement → Arrivée → Livraison\n\n_Expedîle_`,
  expedie_email: `Bonjour {{nom_complet}},\n\nVotre colis {{ref}} a été expédié vers {{destination_flag}} {{destination}} le {{date_expedition}}.\n\nCordialement,\nL'équipe Expedîle`,
  arrive_whatsapp: `Bonjour {{prenom}} 👋\n\n📍 *{{ref}}* est arrivé à {{destination}} !\n\n🚚 Livraison en cours d'organisation.\n\n_Expedîle_`,
  arrive_email: `Bonjour {{nom_complet}},\n\nVotre colis {{ref}} est arrivé à {{destination}}. Livraison prochainement.\n\nCordialement,\nL'équipe Expedîle`,
  en_livraison_whatsapp: `Bonjour {{prenom}} 👋\n\n🚚 *{{ref}}* est en livraison aujourd'hui !\n\nRestez disponible.\n\n_Expedîle_`,
  en_livraison_email: `Bonjour {{nom_complet}},\n\nVotre colis {{ref}} est en cours de livraison.\n\nCordialement,\nL'équipe Expedîle`,
  facture_rejetee_whatsapp: `Bonjour {{prenom}} 👋\n\n⚠️ La facture pour *{{ref}}* n'a pas pu être validée.\n\n📄 *Motif :* {{motif_rejet}}\n\n👉 Renvoyez une facture conforme (photo/PDF lisible).\n\n_Expedîle_`,
  facture_rejetee_email: `Bonjour {{nom_complet}},\n\nLa facture pour {{ref}} n'a pas pu être validée.\nMotif : {{motif_rejet}}\n\nMerci de renvoyer une facture conforme.\n\nCordialement,\nL'équipe Expedîle`,
};

// ── Preview: replace {{var}} with examples ──
function renderPreview(text) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => ALL_EXAMPLES[key] || `{{${key}}}`);
}

// ════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════
export default function TemplateEditor() {
  const [selKey, setSelKey] = useState('reception');
  const [canal, setCanal] = useState('whatsapp');
  const [bodies, setBodies] = useState(DEFAULT_BODIES);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState({});
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef(null);

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

  const handleSave = () => {
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
    <div className="flex gap-4 min-h-[500px]">
      {/* ── Left: Template list ── */}
      <div className="w-48 flex-shrink-0 space-y-0.5">
        {TEMPLATES.map((tpl) => {
          const isActive = selKey === tpl.key;
          return (
            <button
              key={tpl.key}
              onClick={() => { setSelKey(tpl.key); setShowPreview(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
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
            {['whatsapp', 'email'].map((c) => (
              <button
                key={c}
                onClick={() => setCanal(c)}
                className="px-3 py-1.5 text-xs font-bold transition-all"
                style={canal === c ? { background: BRAND.navy, color: 'white' } : { color: '#6B7280' }}
              >
                {c === 'whatsapp' ? 'WhatsApp' : 'Email'}
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
          style={{ color: BRAND.navy, fontFamily: canal === 'whatsapp' ? 'monospace' : 'inherit' }}
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
            onClick={handleSave}
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
            <pre className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: canal === 'whatsapp' ? 'monospace' : 'inherit' }}>
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

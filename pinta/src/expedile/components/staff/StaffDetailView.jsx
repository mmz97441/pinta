import React, { useState } from 'react';
import {
  Ruler, Check, Clock, Camera, AlertTriangle, AlertCircle, Eye, X, RotateCcw, Send, Mail, Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, TRANSITIONS, PRODUITS_INTERDITS, TAGS_PREPARATION, getDestByCP } from '../../constants';
import { eur, calcTransport, getCatTaux } from '../../utils';
import { Ligne } from '../ui';
import * as sb from '../../lib/supabaseData';

// ── Status border color helper ───────────────────────────────────────────────
function statusBorderColor(statut) {
  const map = {
    receptionne: '#F59E0B',
    mesure: '#EAB308',
    attente_feu_vert: '#F97316',
    autorise: '#22C55E',
    refuse_client: '#EF4444',
    en_preparation: '#3B82F6',
    devis_envoye: '#D97706',
    attente_paiement: '#D97706',
    paye: '#10B981',
    expedie: '#06B6D4',
    transit: '#0EA5E9',
    dedouanement: '#8B5CF6',
    arrive: '#14B8A6',
    livraison: '#84CC16',
    livre: '#16A34A',
    annule: '#9CA3AF',
  };
  return map[statut] || BRAND.navy;
}

// ── Status template keys for quick messages ──────────────────────────────────
function templatesForStatut(statut) {
  const map = {
    receptionne: ['reception', 'facture_manquante', 'libre'],
    mesure: ['demande_feu_vert', 'facture_manquante', 'libre'],
    attente_feu_vert: ['relance_feu_vert', 'demande_feu_vert', 'libre'],
    autorise: ['feu_vert_recu', 'libre'],
    en_preparation: ['libre'],
    devis_envoye: ['devis_final', 'relance_paiement', 'libre'],
    attente_paiement: ['relance_paiement', 'libre'],
    paye: ['expedie', 'libre'],
    expedie: ['expedie', 'libre'],
    transit: ['libre'],
    arrive: ['arrive', 'libre'],
    livraison: ['en_livraison', 'libre'],
    livre: ['libre'],
  };
  return map[statut] || ['libre'];
}

// ── Template labels (short) ──────────────────────────────────────────────────
const TEMPLATE_LABELS = {
  reception: 'Réceptionné',
  facture_manquante: 'Facture manquante',
  demande_feu_vert: 'Feu vert',
  relance_feu_vert: 'Relancer feu vert',
  feu_vert_recu: 'Feu vert reçu',
  devis_final: 'Devis final',
  relance_paiement: 'Relancer paiement',
  expedie: 'Expédié',
  arrive: 'Arrivé',
  en_livraison: 'En livraison',
  libre: 'Message libre',
};

// ── Section block wrapper ────────────────────────────────────────────────────
function Section({ title, icon: Icon, color, children }) {
  return (
    <div className="rounded-2xl border bg-white" style={{ borderLeft: `4px solid ${color || BRAND.navy}` }}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} style={{ color: color || BRAND.navy }} />}
          <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{title}</span>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Input field ──────────────────────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, min, step, unit }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
      <div className="relative flex items-center">
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          min={min}
          step={step}
          className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-medium outline-none transition-all focus:border-blue-400"
          style={{ color: BRAND.navy, paddingRight: unit ? '2.5rem' : undefined }}
        />
        {unit && (
          <span className="absolute right-3 text-xs text-gray-400 font-bold pointer-events-none">{unit}</span>
        )}
      </div>
    </div>
  );
}

// ── Action button primary ────────────────────────────────────────────────────
function BtnPrimary({ onClick, children, disabled, color }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{
        background: color
          ? color
          : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`,
        color: 'white',
        boxShadow: `0 2px 10px ${color || BRAND.navy}30`,
      }}
    >
      {children}
    </button>
  );
}

// ── Telegram button ──────────────────────────────────────────────────────────
function BtnTelegram({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{ background: '#0088cc', color: 'white', boxShadow: '0 2px 8px #0088cc40' }}
    >
      <Send size={14} />
      {children}
    </button>
  );
}

// ── Email button ────────────────────────────────────────────────────────────
function BtnEmail({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`, color: 'white', boxShadow: '0 2px 8px rgba(27,58,75,0.25)' }}
    >
      <Mail size={14} />
      {children}
    </button>
  );
}

// ── Dimension display row ────────────────────────────────────────────────────
function DimsDisplay({ c }) {
  const hasDims = c.dimL && c.dimW && c.dimH && c.poids;
  if (!hasDims) return <p className="text-sm text-gray-400 italic">Dimensions non renseignées</p>;

  // Multi-colis display
  if (c.dimsParColis && c.dimsParColis.length > 1) {
    const trackings = c.trackings?.filter((t) => t) || [];
    let totalPoids = 0, totalPv = 0;
    c.dimsParColis.forEach((d) => {
      totalPoids += d.poids;
      totalPv += (d.dimL * d.dimW * d.dimH) / 5000;
    });
    const totalPf = Math.max(totalPoids, totalPv);
    return (
      <div className="space-y-3">
        {c.dimsParColis.map((d, i) => {
          const pv = ((d.dimL * d.dimW * d.dimH) / 5000).toFixed(2);
          return (
            <div key={i} className="rounded-lg bg-gray-50 p-2.5 space-y-0.5 text-sm">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">
                Colis {i + 1}{trackings[i] ? ` — ${trackings[i]}` : ''}
              </p>
              <Ligne label="Dimensions" value={`${d.dimL} × ${d.dimW} × ${d.dimH} cm`} />
              <Ligne label="Poids" value={`${d.poids} kg`} />
              <Ligne label="Vol." value={`${pv} kg`} />
            </div>
          );
        })}
        <div className="border-t border-gray-200 pt-2 space-y-0.5 text-sm">
          <Ligne label="Poids total" value={`${totalPoids.toFixed(2)} kg`} />
          <Ligne label="Poids vol. total" value={`${totalPv.toFixed(2)} kg`} />
          <Ligne label="Poids facturable" value={`${totalPf.toFixed(2)} kg`} />
        </div>
      </div>
    );
  }

  // Single colis display
  const pv = ((c.dimL * c.dimW * c.dimH) / 5000).toFixed(2);
  const pf = Math.max(c.poids, parseFloat(pv)).toFixed(2);
  return (
    <div className="space-y-0.5 text-sm">
      <Ligne label="Dimensions" value={`${c.dimL} × ${c.dimW} × ${c.dimH} cm`} />
      <Ligne label="Poids réel" value={`${c.poids} kg`} />
      <Ligne label="Poids volumétrique" value={`${pv} kg`} />
      <Ligne label="Poids facturable" value={`${pf} kg`} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function StaffDetailView() {
  const {
    sel,
    selClient: cl,
    selDest,
    isStaff,
    upd,
    ask,
    flash,
    changerStatut,
    revertStatut,
    annulerColis,
    demanderFeuVert,
    envoyerDevis,
    sendMsg,
    getPreview,
    comLog,
    categories,
    getTarif,
    envois,
    payer,
    setSelId,
    setData,
  } = useApp();

  // ── Local state ──────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);
  const [casierTmp, setCasierTmp] = useState('');
  const [editCasier, setEditCasier] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [msgPanel, setMsgPanel] = useState(false);
  const [selTemplate, setSelTemplate] = useState('libre');
  const [msgPreview, setMsgPreview] = useState('');
  const [sendCanal, setSendCanal] = useState(cl?.canal || 'telegram');

  // Local measure form
  const [dims, setDims] = useState({ dimL: '', dimW: '', dimH: '', poids: '' });
  // Multi-colis measure form (one set per tracking)
  const [multiDims, setMultiDims] = useState({});
  // Local fin dims form
  const [finDims, setFinDims] = useState({ finL: '', finW: '', finH: '', finP: '' });
  // Photo simulation
  const [photoTaken, setPhotoTaken] = useState(false);
  // Produits interdits checklist
  const [interdits, setInterdits] = useState([]);
  // Devis preview mode
  const [devisPrev, setDevisPrev] = useState(false);
  // Envoi assignment
  const [selEnvoi, setSelEnvoi] = useState(sel?.envoi || '');
  // Add tracking
  const [newTracking, setNewTracking] = useState('');
  const [newFournisseur, setNewFournisseur] = useState('');
  // Tags préparation
  const [selTags, setSelTags] = useState(sel?.tagsPreparation || []);
  // Frais divers
  const [fraisDivers, setFraisDivers] = useState(sel?.fraisDivers || []);
  const [newFraisLibelle, setNewFraisLibelle] = useState('');
  const [newFraisMontant, setNewFraisMontant] = useState('');
  // Pro payment method
  const [proPayMethod, setProPayMethod] = useState(cl?.modePaiement || 'virement');

  if (!sel || !isStaff) return null;

  const dest = selDest || getDestByCP(cl?.cp);
  const tarif = getTarif(dest?.code);
  const borderColor = statusBorderColor(sel.statut);
  const thisComLog = comLog.filter((l) => l.colisId === sel.id);

  // ── Missing invoice? ──────────────────────────────────────────────────────
  // missingFacture = true si AUCUNE facture n'est validée
  const hasAnyValidFacture = sel.factures && sel.factures.length > 0 && sel.factures.some((f) => f.valide);
  const missingFacture = !hasAnyValidFacture;

  // ── Computed dimensions ───────────────────────────────────────────────────
  function calcDims(l, w, h, p) {
    const L = parseFloat(l) || 0;
    const W = parseFloat(w) || 0;
    const H = parseFloat(h) || 0;
    const P = parseFloat(p) || 0;
    const pv = L && W && H ? (L * W * H) / 5000 : 0;
    const pf = Math.max(P, pv);
    const tr = pf > 0 ? calcTransport(pf, tarif) : 0;
    return { pv: pv.toFixed(2), pf: pf.toFixed(2), tr: tr.toFixed(2) };
  }

  // ── Compute taxes from lignes + categories ────────────────────────────────
  function calcTaxes(pf) {
    let om = 0;
    let omr = 0;
    (sel.lignes || []).forEach((l) => {
      const cat = categories.find((c) => c.id === l.cat);
      if (cat) {
        const ct = getCatTaux(cat, dest.code);
        om += l.qte * l.prix * (ct.om / 100);
        omr += l.qte * l.prix * (ct.omr / 100);
      }
    });
    const tr = calcTransport(parseFloat(pf) || 0, tarif);
    const ht = tr + om + omr;
    const tva = ht * ((dest?.tva || 0) / 100);
    const total = Math.round((ht + tva) * 100) / 100;
    return { om, omr, tr, ht, tva, total };
  }

  // ── Handle template select ────────────────────────────────────────────────
  function handleSelectTemplate(tpl) {
    setSelTemplate(tpl);
    const preview = getPreview(tpl, cl?.id, sel.id, sendCanal);
    setMsgPreview(preview);
  }

  function handleSendMsg() {
    if (!msgPreview.trim()) { flash('Le message est vide'); return; }
    sendMsg(sel.id, cl?.id, sendCanal, selTemplate, msgPreview);
    setMsgPanel(false);
    setMsgPreview('');
  }

  // ── Revert / Cancel helpers ───────────────────────────────────────────────
  function handleRevert() {
    ask(
      'Retour à l\'étape précédente',
      'Cette action remet le colis à l\'étape précédente et efface les données associées. Continuer ?',
      () => revertStatut(sel.id),
      { danger: true, okLabel: 'Oui, revenir en arrière' },
    );
  }

  function handleCancel() {
    ask(
      'Annuler ce colis',
      `Voulez-vous vraiment annuler le colis ${sel.ref} ? Cette action est irréversible.`,
      () => annulerColis(sel.id),
      { danger: true, okLabel: 'Oui, annuler' },
    );
  }

  // ── Add tracking (new carton to existing EXP) ────────────────────────────
  const canAddTracking = sel.statut === 'receptionne' || sel.statut === 'mesure';

  function handleAddTracking() {
    const t = newTracking.trim().toUpperCase();
    if (!t) { setFormErr('Saisissez un numéro de tracking'); return; }
    const existing = sel.trackings?.filter((x) => x) || [];
    if (existing.includes(t)) { setFormErr('Ce tracking est déjà rattaché'); return; }
    setFormErr('');
    const updated = [...existing, t];
    const existingDetail = sel.trackingsDetail || [];
    const updatedDetail = [...existingDetail, { number: t, fournisseur: newFournisseur.trim() }];
    // Reset to receptionne since we have a new unmeasured carton
    upd(sel.id, {
      trackings: updated,
      trackingsDetail: updatedDetail,
      nbColis: updated.length,
      // Reset dims since they need to be re-measured with the new carton
      statut: 'receptionne',
      dimL: null, dimW: null, dimH: null, poids: null,
      dimsParColis: [],
    });
    setNewTracking('');
    setNewFournisseur('');
    flash(`Carton ajouté — ${sel.ref} a maintenant ${updated.length} colis`);
  }

  // ── Measure validation ────────────────────────────────────────────────────
  function handleValiderMesures() {
    const trackingsActive = sel.trackings?.filter((t) => t) || [];
    const isMulti = trackingsActive.length > 1;

    if (isMulti) {
      for (let i = 0; i < trackingsActive.length; i++) {
        const d = multiDims[i] || {};
        if (!d.dimL || !d.dimW || !d.dimH || !d.poids) {
          setFormErr(`Remplissez toutes les dimensions du colis ${i + 1} (${trackingsActive[i]}).`);
          return;
        }
      }
      setFormErr('');
      const dimsParColis = trackingsActive.map((_, i) => {
        const d = multiDims[i];
        return { dimL: parseFloat(d.dimL), dimW: parseFloat(d.dimW), dimH: parseFloat(d.dimH), poids: parseFloat(d.poids) };
      });
      const totalPoids = dimsParColis.reduce((s, d) => s + d.poids, 0);
      const maxL = Math.max(...dimsParColis.map((d) => d.dimL));
      const maxW = Math.max(...dimsParColis.map((d) => d.dimW));
      const maxH = Math.max(...dimsParColis.map((d) => d.dimH));
      upd(sel.id, {
        dimsParColis,
        dimL: maxL, dimW: maxW, dimH: maxH,
        poids: Math.round(totalPoids * 100) / 100,
        statut: 'mesure',
      });
      flash(`Mesures enregistrées (${dimsParColis.length} colis)`);
    } else {
      const { dimL, dimW, dimH, poids } = dims;
      if (!dimL || !dimW || !dimH || !poids) {
        setFormErr('Veuillez remplir toutes les dimensions et le poids.');
        return;
      }
      setFormErr('');
      upd(sel.id, {
        dimL: parseFloat(dimL),
        dimW: parseFloat(dimW),
        dimH: parseFloat(dimH),
        poids: parseFloat(poids),
        statut: 'mesure',
      });
      flash('Mesures enregistrées');
    }
  }

  // ── Reception handler ─────────────────────────────────────────────────────
  function handleReceptionner(withTelegram) {
    if (!casierTmp.trim()) {
      setFormErr('Le numéro de casier est obligatoire.');
      return;
    }
    setFormErr('');

    const trackingsActive = sel.trackings?.filter((t) => t) || [];
    const isMulti = trackingsActive.length > 1;

    let hasDims = false;
    const changes = {
      casier: casierTmp.trim(),
      photoReception: photoTaken,
      checkInterdits: interdits,
      dateReception: new Date().toISOString(),
    };

    if (isMulti) {
      // Check if all multi-tracking dims are filled
      const allFilled = trackingsActive.every((_, i) => {
        const d = multiDims[i] || {};
        return d.dimL && d.dimW && d.dimH && d.poids;
      });
      if (allFilled) {
        hasDims = true;
        const dimsParColis = trackingsActive.map((_, i) => {
          const d = multiDims[i];
          return { dimL: parseFloat(d.dimL), dimW: parseFloat(d.dimW), dimH: parseFloat(d.dimH), poids: parseFloat(d.poids) };
        });
        const totalPoids = dimsParColis.reduce((s, d) => s + d.poids, 0);
        changes.dimsParColis = dimsParColis;
        changes.dimL = Math.max(...dimsParColis.map((d) => d.dimL));
        changes.dimW = Math.max(...dimsParColis.map((d) => d.dimW));
        changes.dimH = Math.max(...dimsParColis.map((d) => d.dimH));
        changes.poids = Math.round(totalPoids * 100) / 100;
      }
    } else if (dims.dimL && dims.dimW && dims.dimH && dims.poids) {
      hasDims = true;
      changes.dimL = parseFloat(dims.dimL);
      changes.dimW = parseFloat(dims.dimW);
      changes.dimH = parseFloat(dims.dimH);
      changes.poids = parseFloat(dims.poids);
    }

    changes.statut = hasDims ? 'mesure' : 'receptionne';

    upd(sel.id, changes);
    flash(hasDims ? 'Réceptionné + mesuré' : 'Colis réceptionné');
    if (withTelegram) {
      sendMsg(sel.id, cl?.id, 'telegram', 'reception', null);
    }
  }

  // ── Devis preview ─────────────────────────────────────────────────────────
  const finPoids = parseFloat(finDims.finP) || sel.finP || 0;
  const finL = parseFloat(finDims.finL) || sel.finL || 0;
  const finW = parseFloat(finDims.finW) || sel.finW || 0;
  const finH = parseFloat(finDims.finH) || sel.finH || 0;
  const finPv = finL && finW && finH ? ((finL * finW * finH) / 5000).toFixed(2) : '0.00';
  const finPf = Math.max(finPoids, parseFloat(finPv)).toFixed(2);
  const devisCalc = calcTaxes(finPf);

  function handleEnvoyerDevis() {
    // Persist fin dims first if filled locally
    const changes = {};
    if (finDims.finL) changes.finL = parseFloat(finDims.finL);
    if (finDims.finW) changes.finW = parseFloat(finDims.finW);
    if (finDims.finH) changes.finH = parseFloat(finDims.finH);
    if (finDims.finP) changes.finP = parseFloat(finDims.finP);
    if (Object.keys(changes).length) upd(sel.id, changes);

    setTimeout(() => {
      envoyerDevis(sel.id);
      setDevisPrev(true);
    }, 50);
  }

  function handleConfirmDevisEnvoye() {
    // Vérifier que le devis a bien été calculé
    if (!sel.devisTotal || sel.devisTotal <= 0) {
      flash({ msg: 'Le devis n\'a pas été calculé. Vérifiez la facture et les articles.', type: 'warning', duration: 5000 });
      return;
    }
    changerStatut(sel.id, 'devis_envoye');
    setTimeout(() => {
      sendMsg(sel.id, cl?.id, cl?.canal || 'telegram', 'devis_final', null);
    }, 300);
    setDevisPrev(false);
  }

  // ── Correction bar availability ───────────────────────────────────────────
  const canRevert = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre';
  const canCancel = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre';

  // ════════════════════════════════════════════════════════════════════════
  // RENDER STATUS BLOCKS
  // ════════════════════════════════════════════════════════════════════════

  function renderActionBlock() {
    switch (sel.statut) {

      // ── 1. RECEPTIONNE ─────────────────────────────────────────────────
      case 'receptionne': {
        const trackingsActive = sel.trackings?.filter((t) => t) || [];
        const isMulti = trackingsActive.length > 1;

        if (isMulti) {
          // Compute multi-colis summary
          const allFilled = trackingsActive.every((_, i) => {
            const d = multiDims[i] || {};
            return d.dimL && d.dimW && d.dimH && d.poids;
          });
          let totalPoids = 0, totalPv = 0;
          if (allFilled) {
            trackingsActive.forEach((_, i) => {
              const d = multiDims[i];
              const L = parseFloat(d.dimL) || 0;
              const W = parseFloat(d.dimW) || 0;
              const H = parseFloat(d.dimH) || 0;
              const P = parseFloat(d.poids) || 0;
              totalPoids += P;
              totalPv += (L * W * H) / 5000;
            });
          }
          const totalPf = Math.max(totalPoids, totalPv);
          const totalTr = totalPf > 0 ? calcTransport(totalPf, tarif) : 0;

          return (
            <Section title={`Mesurer les ${trackingsActive.length} colis`} icon={Ruler} color={borderColor}>
              <div className="space-y-4">
                {trackingsActive.map((tracking, idx) => {
                  const d = multiDims[idx] || { dimL: '', dimW: '', dimH: '', poids: '' };
                  const updateDim = (field, val) => setMultiDims((prev) => ({
                    ...prev, [idx]: { ...prev[idx], dimL: '', dimW: '', dimH: '', poids: '', ...prev[idx], [field]: val },
                  }));
                  return (
                    <div key={idx} className="rounded-xl border border-gray-200 p-3 space-y-3">
                      <p className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.navy }}>
                        Colis {idx + 1} — <span className="font-mono">{tracking}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Longueur (cm)" type="number" min="0" step="0.5"
                          value={d.dimL} onChange={(e) => updateDim('dimL', e.target.value)}
                          placeholder="40" unit="cm" />
                        <Field label="Largeur (cm)" type="number" min="0" step="0.5"
                          value={d.dimW} onChange={(e) => updateDim('dimW', e.target.value)}
                          placeholder="30" unit="cm" />
                        <Field label="Hauteur (cm)" type="number" min="0" step="0.5"
                          value={d.dimH} onChange={(e) => updateDim('dimH', e.target.value)}
                          placeholder="20" unit="cm" />
                        <Field label="Poids réel (kg)" type="number" min="0" step="0.1"
                          value={d.poids} onChange={(e) => updateDim('poids', e.target.value)}
                          placeholder="2.5" unit="kg" />
                      </div>
                    </div>
                  );
                })}

                {allFilled && (
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-0.5 text-sm">
                    <Ligne label="Poids total" value={`${totalPoids.toFixed(2)} kg`} />
                    <Ligne label="Poids vol. total" value={`${totalPv.toFixed(2)} kg`} />
                    <Ligne label="Poids facturable" value={`${totalPf.toFixed(2)} kg`} />
                    <Ligne label="Transport estimé" value={eur(totalTr)} />
                  </div>
                )}

                {/* Ajouter un carton */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ajouter un carton</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newFournisseur}
                      onChange={(e) => setNewFournisseur(e.target.value)}
                      placeholder="Fournisseur"
                      className="w-1/3 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 focus:bg-white transition-colors"
                    />
                    <input
                      type="text"
                      value={newTracking}
                      onChange={(e) => setNewTracking(e.target.value)}
                      placeholder="N° tracking"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 focus:bg-white transition-colors"
                    />
                    <button
                      onClick={handleAddTracking}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all active:scale-95"
                      style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                    >
                      <Plus size={13} />
                      Ajouter
                    </button>
                  </div>
                </div>

                {formErr && <p className="text-xs text-red-500 font-medium">{formErr}</p>}

                <BtnPrimary onClick={() => { if (actionLoading) return; setActionLoading(true); try { handleValiderMesures(); } finally { setTimeout(() => setActionLoading(false), 1000); } }} disabled={actionLoading}>
                  <Check size={15} />
                  {actionLoading ? 'Validation...' : `Valider les mesures (${trackingsActive.length} colis)`}
                </BtnPrimary>
              </div>
            </Section>
          );
        }

        // Single tracking — existing form
        const { pv, pf, tr } = calcDims(dims.dimL, dims.dimW, dims.dimH, dims.poids);
        return (
          <Section title="Mesurer ce colis" icon={Ruler} color={borderColor}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Longueur (cm)" type="number" min="0" step="0.5"
                  value={dims.dimL} onChange={(e) => setDims({ ...dims, dimL: e.target.value })}
                  placeholder="40" unit="cm" />
                <Field label="Largeur (cm)" type="number" min="0" step="0.5"
                  value={dims.dimW} onChange={(e) => setDims({ ...dims, dimW: e.target.value })}
                  placeholder="30" unit="cm" />
                <Field label="Hauteur (cm)" type="number" min="0" step="0.5"
                  value={dims.dimH} onChange={(e) => setDims({ ...dims, dimH: e.target.value })}
                  placeholder="20" unit="cm" />
                <Field label="Poids réel (kg)" type="number" min="0" step="0.1"
                  value={dims.poids} onChange={(e) => setDims({ ...dims, poids: e.target.value })}
                  placeholder="2.5" unit="kg" />
              </div>

              {(dims.dimL || dims.dimW || dims.dimH || dims.poids) && (
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-0.5 text-sm">
                  <Ligne label="Poids volumétrique" value={`${pv} kg`} />
                  <Ligne label="Poids facturable" value={`${pf} kg`} />
                  <Ligne label="Transport estimé" value={eur(parseFloat(tr))} />
                </div>
              )}

              {/* Ajouter un carton */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ajouter un carton à ce colis</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTracking}
                    onChange={(e) => setNewTracking(e.target.value)}
                    placeholder="N° tracking du nouveau carton"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 focus:bg-white transition-colors"
                  />
                  <button
                    onClick={handleAddTracking}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all active:scale-95"
                    style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                  >
                    <Plus size={13} />
                    Ajouter
                  </button>
                </div>
              </div>

              {formErr && <p className="text-xs text-red-500 font-medium">{formErr}</p>}

              <BtnPrimary onClick={() => { if (actionLoading) return; setActionLoading(true); try { handleValiderMesures(); } finally { setTimeout(() => setActionLoading(false), 1000); } }} disabled={actionLoading}>
                <Check size={15} />
                {actionLoading ? 'Validation...' : 'Valider les mesures'}
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 3. MESURE ──────────────────────────────────────────────────────
      case 'mesure': {
        return (
          <Section title="Demander le feu vert" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              {missingFacture && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-bold text-amber-800">
                      ⚠️ Facture d'achat manquante — Sans cette facture, le calcul des taxes (OM/OMR) sera impossible.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'telegram', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                      style={{ background: '#0088cc', color: 'white' }}
                    >
                      <Send size={11} />
                      Demander par Telegram
                    </button>
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'email', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                      style={{ background: BRAND.navy, color: 'white' }}
                    >
                      <Mail size={11} />
                      Demander par email
                    </button>
                  </div>
                </div>
              )}

              {/* Ajouter un carton (remet en receptionne pour re-mesurer) */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Ajouter un carton</p>
                <p className="text-[10px] text-gray-400 mb-2">Les mesures seront à refaire avec le nouveau carton.</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTracking}
                    onChange={(e) => setNewTracking(e.target.value)}
                    placeholder="N° tracking du nouveau carton"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 focus:bg-white transition-colors"
                  />
                  <button
                    onClick={handleAddTracking}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all active:scale-95"
                    style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                  >
                    <Plus size={13} />
                    Ajouter
                  </button>
                </div>
              </div>

              <BtnTelegram
                disabled={actionLoading}
                onClick={() => {
                  if (actionLoading) return;
                  setActionLoading(true);
                  try {
                    demanderFeuVert(sel.id);
                    setTimeout(() => {
                      sendMsg(sel.id, cl?.id, 'telegram', 'demande_feu_vert', null);
                    }, 200);
                  } finally { setTimeout(() => setActionLoading(false), 1000); }
                }}
              >
                {actionLoading ? 'Envoi en cours...' : 'Envoyer via Telegram — demander le feu vert'}
              </BtnTelegram>

              <BtnEmail
                disabled={actionLoading}
                onClick={() => {
                  if (actionLoading) return;
                  setActionLoading(true);
                  try {
                    demanderFeuVert(sel.id);
                    setTimeout(() => {
                      sendMsg(sel.id, cl?.id, 'email', 'demande_feu_vert', null);
                    }, 200);
                  } finally { setTimeout(() => setActionLoading(false), 1000); }
                }}
              >
                {actionLoading ? 'Envoi en cours...' : 'Envoyer par email — demander le feu vert'}
              </BtnEmail>
            </div>
          </Section>
        );
      }

      // ── 4. ATTENTE_FEU_VERT ────────────────────────────────────────────
      case 'attente_feu_vert': {
        return (
          <Section title="En attente de l'accord" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-50 border border-orange-200">
                <Clock size={14} className="text-orange-500 flex-shrink-0" />
                <p className="text-xs font-medium text-orange-700">
                  En attente de la réponse du client ({cl?.nom ?? '—'})
                </p>
              </div>

              {missingFacture && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-bold text-amber-800">
                      ⚠️ Facture d'achat manquante — Sans cette facture, le calcul des taxes (OM/OMR) sera impossible.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'telegram', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                      style={{ background: '#0088cc', color: 'white' }}
                    >
                      <Send size={11} />
                      Demander par Telegram
                    </button>
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'email', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                      style={{ background: BRAND.navy, color: 'white' }}
                    >
                      <Mail size={11} />
                      Demander par email
                    </button>
                  </div>
                </div>
              )}

              <BtnTelegram
                disabled={actionLoading}
                onClick={() => { if (actionLoading) return; setActionLoading(true); try { sendMsg(sel.id, cl?.id, 'telegram', 'relance_feu_vert', null); } finally { setTimeout(() => setActionLoading(false), 1000); } }}
              >
                {actionLoading ? 'Envoi en cours...' : 'Relancer via Telegram'}
              </BtnTelegram>

              <BtnEmail
                disabled={actionLoading}
                onClick={() => { if (actionLoading) return; setActionLoading(true); try { sendMsg(sel.id, cl?.id, 'email', 'relance_feu_vert', null); } finally { setTimeout(() => setActionLoading(false), 1000); } }}
              >
                {actionLoading ? 'Envoi en cours...' : 'Relancer par email'}
              </BtnEmail>
            </div>
          </Section>
        );
      }

      // ── 5. AUTORISE ────────────────────────────────────────────────────
      case 'autorise': {
        return (
          <Section title="Client OK — Préparer le colis" icon={Check} color={borderColor}>
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
                <Check size={14} className="text-green-500 flex-shrink-0" />
                <p className="text-xs font-bold text-green-700">
                  Le client a donné son accord pour la préparation.
                </p>
              </div>

              {missingFacture && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300">
                  <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-amber-800">
                    Attention : la facture d'achat n'est pas encore validée. Sans elle, le devis final ne pourra pas être calculé après la préparation.
                  </p>
                </div>
              )}

              <BtnPrimary
                onClick={() => { if (actionLoading) return; setActionLoading(true); try { changerStatut(sel.id, 'en_preparation'); } finally { setTimeout(() => setActionLoading(false), 1000); } }}
                disabled={actionLoading}
                color="#2563EB"
              >
                <Check size={15} />
                {actionLoading ? 'En cours...' : 'Commencer la préparation'}
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 6. EN_PREPARATION ─────────────────────────────────────────────
      case 'en_preparation': {
        const usedFinL = parseFloat(finDims.finL) || sel.finL || 0;
        const usedFinW = parseFloat(finDims.finW) || sel.finW || 0;
        const usedFinH = parseFloat(finDims.finH) || sel.finH || 0;
        const usedFinP = parseFloat(finDims.finP) || sel.finP || 0;

        const fPv = usedFinL && usedFinW && usedFinH ? ((usedFinL * usedFinW * usedFinH) / 5000) : 0;
        const fPf = Math.max(usedFinP, fPv);

        // Avant optim (supporte multi-colis)
        const avPv = sel.dimsParColis && sel.dimsParColis.length > 1
          ? sel.dimsParColis.reduce((s, d) => s + (d.dimL * d.dimW * d.dimH) / 5000, 0)
          : sel.dimL && sel.dimW && sel.dimH ? ((sel.dimL * sel.dimW * sel.dimH) / 5000) : 0;
        const avPf = Math.max(sel.poids || 0, avPv);
        const avTr = avPf > 0 ? calcTransport(avPf, tarif) : 0;
        const apTr = fPf > 0 ? calcTransport(fPf, tarif) : 0;

        const canPreview = usedFinL > 0 && usedFinW > 0 && usedFinH > 0 && usedFinP > 0;
        const hasValidFacture = sel.factures && sel.factures.length > 0 && sel.factures.some((f) => f.valide);
        const hasLignes = sel.lignes && sel.lignes.length > 0;
        const canSendDevis = canPreview && hasValidFacture && hasLignes;

        return (
          <div className="space-y-4">
            {sel.devisTotal > 0 && sel.statut === 'en_preparation' && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-amber-800">
                  Devis calculé mais non envoyé au client.
                </p>
              </div>
            )}
            {missingFacture && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-300 space-y-2.5">
                <div className="flex items-start gap-2">
                  <X size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-800">
                      Facture d'achat non validée
                    </p>
                    <p className="text-[10px] text-red-600 mt-0.5">
                      Le devis ne peut pas être envoyé sans facture validée. Les taxes (OM/OMR) sont calculées sur la valeur des articles.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {cl?.telegramChatId ? (
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'telegram', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold text-white transition-all active:scale-95"
                      style={{ background: '#0088cc' }}
                    >
                      <Send size={11} />
                      Demander par Telegram
                    </button>
                  ) : (
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'email', 'facture_manquante', null)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold text-white transition-all active:scale-95"
                      style={{ background: BRAND.navy }}
                    >
                      <Mail size={11} />
                      Demander par email
                    </button>
                  )}
                  {cl?.telegramChatId && (
                    <button
                      onClick={() => sendMsg(sel.id, cl?.id, 'email', 'facture_manquante', null)}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                      style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                    >
                      <Mail size={11} />
                      Email
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Tags de préparation */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tags de préparation</p>
              <div className="flex flex-wrap gap-1.5">
                {TAGS_PREPARATION.map((tag) => {
                  const active = selTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => {
                        const next = active ? selTags.filter(t => t !== tag) : [...selTags, tag];
                        setSelTags(next);
                        upd(sel.id, { tagsPreparation: next });
                      }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                        active ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={active ? { background: BRAND.navy } : {}}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Commentaire de préparation */}
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Commentaire de préparation</p>
              <textarea
                value={sel.commentairePreparation || ''}
                onChange={(e) => upd(sel.id, { commentairePreparation: e.target.value })}
                placeholder="Spécificités pour ce colis (visible sur le bon de préparation)..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs outline-none resize-none focus:border-blue-400 focus:bg-white transition-colors"
              />
            </div>

            {/* Dimensions finales */}
            <Section title="Dimensions après optimisation" icon={Ruler} color={borderColor}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Long. finale (cm)" type="number" min="0" step="0.5"
                    value={finDims.finL}
                    onChange={(e) => setFinDims({ ...finDims, finL: e.target.value })}
                    placeholder={sel.finL || '38'} unit="cm" />
                  <Field label="Larg. finale (cm)" type="number" min="0" step="0.5"
                    value={finDims.finW}
                    onChange={(e) => setFinDims({ ...finDims, finW: e.target.value })}
                    placeholder={sel.finW || '28'} unit="cm" />
                  <Field label="Haut. finale (cm)" type="number" min="0" step="0.5"
                    value={finDims.finH}
                    onChange={(e) => setFinDims({ ...finDims, finH: e.target.value })}
                    placeholder={sel.finH || '18'} unit="cm" />
                  <Field label="Poids final (kg)" type="number" min="0" step="0.1"
                    value={finDims.finP}
                    onChange={(e) => setFinDims({ ...finDims, finP: e.target.value })}
                    placeholder={sel.finP || '2.0'} unit="kg" />
                </div>

                {fPf > 0 && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-0.5 text-sm">
                    <Ligne label="Poids volumétrique" value={`${fPv.toFixed(2)} kg`} />
                    <Ligne label="Poids facturable" value={`${fPf.toFixed(2)} kg`} />
                  </div>
                )}

                {/* Comparaison avant/après */}
                {avTr > 0 && apTr > 0 && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <p className="text-xs font-bold text-emerald-700 mb-2">Comparaison optimisation</p>
                    <div className="space-y-0.5 text-sm">
                      <Ligne label="Transport avant" value={eur(avTr)} />
                      <Ligne label="Transport après" value={eur(apTr)} />
                      {avTr > apTr && (
                        <Ligne
                          label="Économie client"
                          value={<span className="text-emerald-600 font-black">{eur(avTr - apTr)}</span>}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* Catégorisation produits + ajout articles */}
            <Section title="Articles pour calcul taxes" icon={Check} color={borderColor}>
              <div className="space-y-3">
                {/* Existing lignes */}
                {(sel.lignes || []).map((ligne) => (
                  <div key={ligne.id} className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{ligne.desc}</p>
                        <p className="text-xs text-gray-500">{ligne.qte} × {eur(ligne.prix)}</p>
                      </div>
                      <button
                        onClick={() => {
                          setData((prev) => prev.map((c) => c.id === sel.id ? { ...c, lignes: c.lignes.filter((l) => l.id !== ligne.id) } : c));
                          sb.deleteLigne(ligne.id).catch((err) => flash({ msg: 'Erreur suppression article', type: 'warning' }));
                        }}
                        className="text-gray-300 hover:text-red-500 flex-shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <select
                      value={ligne.cat || ''}
                      onChange={(e) => {
                        const newCat = e.target.value;
                        setData((prev) => prev.map((c) => c.id === sel.id ? { ...c, lignes: c.lignes.map((l) => l.id === ligne.id ? { ...l, cat: newCat } : l) } : c));
                        sb.updateLigne(ligne.id, { cat: newCat }).catch(() => flash({ msg: 'Erreur sauvegarde catégorie', type: 'warning' }));
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border-2 border-gray-200 text-sm outline-none"
                      style={{ color: BRAND.navy }}
                    >
                      <option value="">— Choisir une catégorie —</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                ))}

                {/* Quick-add from factures */}
                {sel.factures?.length > 0 && (!sel.lignes || sel.lignes.length === 0) && (
                  <div className="p-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50">
                    <p className="text-xs font-bold text-amber-800 mb-2">Importer depuis les factures</p>
                    <div className="space-y-1.5">
                      {sel.factures.filter((f) => f.valide).map((f) => (
                        <button
                          key={f.id}
                          onClick={async () => {
                            try {
                              const saved = await sb.insertLigne(sel.id, { desc: f.vendeur || 'Article', qte: 1, prix: f.montant || 0, cat: '' });
                              setData((prev) => prev.map((c) => c.id === sel.id ? { ...c, lignes: [...(c.lignes || []), saved] } : c));
                              flash(`Article "${f.vendeur}" ajouté — sélectionnez sa catégorie`);
                            } catch (err) {
                              flash({ msg: 'Erreur ajout article', type: 'warning' });
                            }
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 transition-colors text-left active:scale-[0.98]"
                        >
                          <span className="text-xs font-semibold text-gray-700">{f.vendeur} — {eur(f.montant)}</span>
                          <span className="text-[10px] font-bold text-amber-700">+ Importer</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add article manually */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Description article"
                    id="new-ligne-desc"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400"
                  />
                  <input
                    type="number"
                    placeholder="Qté"
                    id="new-ligne-qte"
                    defaultValue="1"
                    className="w-14 px-2 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 text-center"
                  />
                  <input
                    type="number"
                    placeholder="Prix €"
                    id="new-ligne-prix"
                    className="w-20 px-2 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 text-right"
                  />
                  <button
                    onClick={async () => {
                      const desc = document.getElementById('new-ligne-desc')?.value?.trim();
                      const qte = parseInt(document.getElementById('new-ligne-qte')?.value) || 1;
                      const prix = parseFloat(document.getElementById('new-ligne-prix')?.value) || 0;
                      if (!desc) return;
                      try {
                        const saved = await sb.insertLigne(sel.id, { desc, qte, prix, cat: '' });
                        setData((prev) => prev.map((c) => c.id === sel.id ? { ...c, lignes: [...(c.lignes || []), saved] } : c));
                      } catch { flash({ msg: 'Erreur ajout article', type: 'warning' }); return; }
                      document.getElementById('new-ligne-desc').value = '';
                      document.getElementById('new-ligne-prix').value = '';
                      document.getElementById('new-ligne-qte').value = '1';
                      flash('Article ajouté — sélectionnez sa catégorie');
                    }}
                    className="px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                  >
                    + Ajouter
                  </button>
                </div>

                {(!sel.lignes || sel.lignes.length === 0) && (
                  <p className="text-[10px] text-orange-500 text-center">
                    Ajoutez les articles et leur catégorie pour calculer les taxes (OM/OMR)
                  </p>
                )}
              </div>
            </Section>

            {/* Frais divers */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Frais divers</p>

              {/* Existing frais */}
              {fraisDivers.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-gray-700">{f.libelle}</span>
                  <span className="font-bold" style={{ color: BRAND.navy }}>{f.montant.toFixed(2)} &euro;</span>
                  <button
                    onClick={() => {
                      const next = fraisDivers.filter((_, j) => j !== i);
                      setFraisDivers(next);
                      upd(sel.id, { fraisDivers: next });
                    }}
                    className="text-gray-300 hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              {/* Add new */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFraisLibelle}
                  onChange={(e) => setNewFraisLibelle(e.target.value)}
                  placeholder="Libellé (enlèvement, douane...)"
                  className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400"
                />
                <input
                  type="number"
                  value={newFraisMontant}
                  onChange={(e) => setNewFraisMontant(e.target.value)}
                  placeholder="€"
                  className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none focus:border-blue-400 text-right"
                />
                <button
                  onClick={() => {
                    if (!newFraisLibelle.trim() || !newFraisMontant) return;
                    const next = [...fraisDivers, { libelle: newFraisLibelle.trim(), montant: parseFloat(newFraisMontant) || 0 }];
                    setFraisDivers(next);
                    upd(sel.id, { fraisDivers: next });
                    setNewFraisLibelle('');
                    setNewFraisMontant('');
                  }}
                  className="px-2 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                >
                  + Ajouter
                </button>
              </div>
            </div>

            {/* Devis preview / send */}
            {!devisPrev ? (
              <div className="space-y-2">
                <BtnPrimary
                  onClick={() => { if (actionLoading) return; setActionLoading(true); try { handleEnvoyerDevis(); } finally { setTimeout(() => setActionLoading(false), 1000); } }}
                  disabled={!canSendDevis || actionLoading}
                  color="#2563EB"
                >
                  <Eye size={15} />
                  {actionLoading ? 'Calcul en cours...' : 'Prévisualiser le devis'}
                </BtnPrimary>
                {!hasValidFacture && canPreview && (
                  <p className="text-[10px] text-red-500 text-center font-semibold">Facture validée requise pour envoyer le devis</p>
                )}
                {hasValidFacture && !hasLignes && canPreview && (
                  <p className="text-[10px] text-orange-500 text-center font-semibold">Ajoutez les articles (catégories) pour calculer les taxes</p>
                )}
              </div>
            ) : (
              <Section title="Brouillon du devis" icon={Eye} color="#2563EB">
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-0.5 text-sm">
                    <Ligne label="Transport" value={eur(sel.devisTransport || devisCalc.tr)} />
                    {(() => {
                      // Calculer le taux effectif OM/OMR à partir de la valeur des articles
                      const valeurArticles = (sel.lignes || []).reduce((s, l) => s + (l.qte || 1) * (l.prix || 0), 0);
                      const omVal = sel.devisOM || devisCalc.om;
                      const omrVal = sel.devisOMR || devisCalc.omr;
                      const tauxOM = valeurArticles > 0 ? ((omVal / valeurArticles) * 100).toFixed(1) : '0';
                      const tauxOMR = valeurArticles > 0 ? ((omrVal / valeurArticles) * 100).toFixed(1) : '0';
                      return (
                        <>
                          <Ligne label={`Octroi de Mer (${tauxOM}%)`} value={eur(omVal)} />
                          <Ligne label={`OMR (${tauxOMR}%)`} value={eur(omrVal)} />
                        </>
                      );
                    })()}
                    <Ligne label={`TVA (${dest?.tva || 0}%)`} value={eur(sel.devisTVA || devisCalc.tva)} />
                    {fraisDivers.length > 0 && (
                      <Ligne label="Frais divers" value={eur(fraisDivers.reduce((s, f) => s + f.montant, 0))} />
                    )}
                    <div className="border-t border-blue-200 pt-1 mt-1">
                      <Ligne
                        label="TOTAL"
                        value={
                          <span className="font-black text-blue-700 text-base">
                            {eur((sel.devisTotal || devisCalc.total) + fraisDivers.reduce((s, f) => s + f.montant, 0))}
                          </span>
                        }
                      />
                    </div>
                    {sel.economie > 0 && (
                      <div className="mt-1 pt-1 border-t border-blue-200">
                        <Ligne
                          label="Économie réalisée"
                          value={<span className="text-emerald-600 font-bold">{eur(sel.economie)}</span>}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <BtnPrimary onClick={() => { if (actionLoading) return; setActionLoading(true); try { handleConfirmDevisEnvoye(); } finally { setTimeout(() => setActionLoading(false), 1000); } }} disabled={actionLoading} color="#16A34A">
                      <Check size={15} />
                      {actionLoading ? 'Envoi en cours...' : 'Envoyer le devis au client'}
                    </BtnPrimary>
                    <button
                      onClick={() => setDevisPrev(false)}
                      className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Modifier
                    </button>
                  </div>
                </div>
              </Section>
            )}
          </div>
        );
      }

      // ── 7. DEVIS_ENVOYE ────────────────────────────────────────────────
      case 'devis_envoye': {
        return (
          <Section title="Devis envoyé — en attente client" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-700 mb-1">Montant du devis</p>
                <p className="text-2xl font-black" style={{ color: BRAND.navyD }}>
                  {eur(sel.devisTotal)}
                </p>
              </div>
              <BtnTelegram disabled={actionLoading} onClick={() => { if (actionLoading) return; setActionLoading(true); try { sendMsg(sel.id, cl?.id, 'telegram', 'devis_final', null); } finally { setTimeout(() => setActionLoading(false), 1000); } }}>
                {actionLoading ? 'Envoi en cours...' : 'Relancer via Telegram'}
              </BtnTelegram>
            </div>
          </Section>
        );
      }

      // ── 8. ATTENTE_PAIEMENT ────────────────────────────────────────────
      case 'attente_paiement': {
        const isPro = cl?.type === 'pro';
        const PAY_METHODS = {
          virement: 'Virement bancaire',
          especes: 'Espèces',
          '30_jours': 'Paiement à 30 jours',
          fin_de_mois: 'Paiement fin de mois',
        };
        return (
          <Section title="En attente de paiement" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-700 mb-1">Montant à payer</p>
                <p className="text-2xl font-black" style={{ color: BRAND.navyD }}>
                  {eur(sel.devisTotal)}
                </p>
              </div>
              {isPro ? (
                <>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-xs font-bold text-blue-800 mb-1">
                      Client professionnel — paiement par {PAY_METHODS[proPayMethod] || proPayMethod}
                    </p>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                      Mode de paiement
                    </label>
                    <select
                      value={proPayMethod}
                      onChange={(e) => setProPayMethod(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none"
                      style={{ color: BRAND.navy }}
                    >
                      {Object.entries(PAY_METHODS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <BtnPrimary
                    onClick={() => {
                      upd(sel.id, { modePaiementPro: proPayMethod });
                      payer(sel.id, sel.devisTotal);
                    }}
                    color="#059669"
                  >
                    <Check size={15} />
                    Confirmer réception du paiement
                  </BtnPrimary>
                </>
              ) : (
                <BtnTelegram disabled={actionLoading} onClick={() => {
                  if (actionLoading) return;
                  if (!sel.devisTotal || sel.devisTotal <= 0) {
                    flash('Le devis n\'a pas été calculé — impossible de relancer le paiement');
                    return;
                  }
                  setActionLoading(true);
                  try { sendMsg(sel.id, cl?.id, 'telegram', 'relance_paiement', null); } finally { setTimeout(() => setActionLoading(false), 1000); }
                }}>
                  {actionLoading ? 'Envoi en cours...' : 'Relancer via Telegram'}
                </BtnTelegram>
              )}
            </div>
          </Section>
        );
      }

      // ── 9. PAYE ────────────────────────────────────────────────────────
      case 'paye': {
        const availableEnvois = envois.filter((e) => e.statut !== 'parti');
        return (
          <Section title="Paiement reçu — Expédier" icon={Check} color={borderColor}>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-xs font-bold text-emerald-700 mb-1">Paiement reçu</p>
                <p className="text-2xl font-black text-emerald-700">
                  {eur(sel.paiementMontant || sel.devisTotal)}
                </p>
              </div>

              {/* Envoi assignment */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Affecter à un envoi
                </label>
                <select
                  value={selEnvoi}
                  onChange={(e) => {
                    setSelEnvoi(e.target.value);
                    upd(sel.id, { envoi: e.target.value || null });
                    flash(e.target.value ? 'Envoi affecté' : 'Envoi retiré');
                  }}
                  className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none"
                  style={{ color: BRAND.navy }}
                >
                  <option value="">— Choisir un envoi —</option>
                  {availableEnvois.map((e) => {
                    const d = new Date(e.date + 'T00:00:00');
                    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <option key={e.id} value={e.id}>
                        {label} — {e.statut}
                      </option>
                    );
                  })}
                </select>
              </div>

              <BtnPrimary
                onClick={() => changerStatut(sel.id, 'expedie')}
                disabled={!sel.envoi && !selEnvoi}
                color="#0891B2"
              >
                <Check size={15} />
                Expédier ce colis
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 10a. DEDOUANEMENT ─────────────────────────────────────────────
      case 'dedouanement': {
        return (
          <Section title="En dédouanement" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-violet-50 border border-violet-200">
                <Clock size={14} className="text-violet-500 flex-shrink-0" />
                <p className="text-xs font-medium text-violet-700">
                  Le colis est en cours de dédouanement à destination.
                </p>
              </div>
              <BtnPrimary
                onClick={() => changerStatut(sel.id, 'arrive')}
                color="#14B8A6"
              >
                <Check size={15} />
                Confirmer l'arrivée à destination
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 10b. EXPEDIE / TRANSIT / ARRIVE / LIVRAISON ────────────────────
      case 'expedie':
      case 'transit':
      case 'arrive':
      case 'livraison': {
        const nextStatuts = TRANSITIONS[sel.statut] || [];
        const trackingSteps = [
          { key: 'expedie', label: 'Expédié', tpl: 'expedie' },
          { key: 'transit', label: 'En vol' },
          { key: 'dedouanement', label: 'Dédouanement' },
          { key: 'arrive', label: 'Arrivé', tpl: 'arrive' },
          { key: 'livraison', label: 'En livraison', tpl: 'en_livraison' },
          { key: 'livre', label: 'Livré' },
        ];
        const currentIdx = trackingSteps.findIndex((s) => s.key === sel.statut);

        return (
          <Section title="Suivi d'expédition" icon={Check} color={borderColor}>
            <div className="space-y-4">
              {/* Timeline */}
              <div className="space-y-2">
                {trackingSteps.map((step, idx) => {
                  const done = idx < currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl"
                      style={{
                        background: active ? `${borderColor}15` : done ? '#F0FDF4' : '#F9FAFB',
                        border: active ? `1.5px solid ${borderColor}` : done ? '1.5px solid #BBF7D0' : '1.5px solid #F3F4F6',
                      }}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px]"
                        style={{
                          background: active ? borderColor : done ? '#22C55E' : '#E5E7EB',
                          color: 'white',
                        }}
                      >
                        {done ? <Check size={10} /> : idx + 1}
                      </div>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: active ? borderColor : done ? '#16A34A' : '#9CA3AF' }}
                      >
                        {step.label}
                      </span>
                      {active && (
                        <span
                          className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full"
                          style={{ background: borderColor, color: 'white' }}
                        >
                          EN COURS
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Next step buttons */}
              <div className="flex flex-col gap-2">
                {sel.statut === 'transit' ? (
                  <>
                    <BtnPrimary
                      onClick={() => changerStatut(sel.id, 'dedouanement')}
                      color="#8B5CF6"
                    >
                      <Clock size={15} />
                      Passer en dédouanement
                    </BtnPrimary>
                    <BtnPrimary
                      onClick={() => {
                        changerStatut(sel.id, 'arrive');
                        sendMsg(sel.id, cl?.id, cl?.canal || 'telegram', 'arrive', null);
                      }}
                      color="#14B8A6"
                    >
                      <Check size={15} />
                      Arrivé directement (sans dédouanement)
                    </BtnPrimary>
                  </>
                ) : (
                  nextStatuts.map((ns) => {
                    const step = trackingSteps.find((s) => s.key === ns);
                    const tpl = step?.tpl;
                    return (
                      <BtnPrimary
                        key={ns}
                        onClick={() => {
                          changerStatut(sel.id, ns);
                          if (tpl) sendMsg(sel.id, cl?.id, cl?.canal || 'telegram', tpl, null);
                        }}
                        color={borderColor}
                      >
                        <Check size={15} />
                        {STATUTS[ns]?.actionStaff || STATUTS[ns]?.label}
                      </BtnPrimary>
                    );
                  })
                )}
              </div>
            </div>
          </Section>
        );
      }

      default:
        return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMMUNICATION PANEL
  // ════════════════════════════════════════════════════════════════════════
  const templates = templatesForStatut(sel.statut);

  // ════════════════════════════════════════════════════════════════════════
  // FULL RENDER
  // ════════════════════════════════════════════════════════════════════════
  const [showCorrections, setShowCorrections] = useState(false);

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-4">

      {/* ── Action block ───────────────────────────────────────────────── */}
      {renderActionBlock()}

      {/* ── Corrections (collapsible, discreet) ──────────────────────── */}
      {(canRevert || canCancel) && (
        <div>
          <button
            onClick={() => setShowCorrections((p) => !p)}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RotateCcw size={11} />
            {showCorrections ? 'Masquer les corrections' : 'Corrections'}
          </button>
          {showCorrections && (
            <div className="flex gap-2 flex-wrap mt-2 anim-fade">
              {canRevert && (
                <button
                  onClick={handleRevert}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
                >
                  <RotateCcw size={11} />
                  Étape précédente
                </button>
              )}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <X size={11} />
                  Annuler le colis
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

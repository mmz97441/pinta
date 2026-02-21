import React, { useState, useRef } from 'react';
import { Check, X, RotateCcw, Eye, Upload, FileText, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, getDestByCP } from '../../constants';
import { eur } from '../../utils';

const MOTIFS_REJET = [
  { key: 'non_conforme', label: 'Non conforme' },
  { key: 'illisible', label: 'Illisible / mauvaise qualité' },
  { key: 'montant', label: 'Montant incorrect' },
  { key: 'date', label: 'Date invalide' },
  { key: 'nom', label: 'Nom/adresse erroné(e)' },
];

// ── Lightbox overlay ─────────────────────────────────────────────────────
function Lightbox({ src, onClose, title }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
      >
        <X size={20} />
      </button>
      {title && (
        <div className="absolute top-4 left-4 text-white text-sm font-bold bg-black/40 px-3 py-1.5 rounded-lg">
          {title}
        </div>
      )}
      <div className="max-w-[90vw] max-h-[85vh] overflow-auto rounded-xl" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Facture" className="max-w-full max-h-[85vh] object-contain rounded-xl" />
      </div>
    </div>
  );
}

export default function FacturesPanel() {
  const { sel, isStaff, setData, flash, sendMsg, getClient } = useApp();
  const [rejectingId, setRejectingId] = useState(null);
  const [motifLibre, setMotifLibre] = useState('');
  const [previewSrc, setPreviewSrc] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const fileInputRef = useRef(null);
  const [uploadTargetId, setUploadTargetId] = useState(null);

  if (!sel || sel.factures.length === 0) return null;

  const cl = getClient(sel.clientId);
  const canal = cl?.canal || 'whatsapp';

  // ── Validate ───────────────────────────────────────────────────────────
  const validateFacture = (factureId) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: true, rejetMotif: null } : f)) };
    }));
    flash('Facture validée');
    setRejectingId(null);
  };

  // ── Undo validation ────────────────────────────────────────────────────
  const unvalidateFacture = (factureId) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: false } : f)) };
    }));
    flash('Validation annulée');
  };

  // ── Reject with motif ──────────────────────────────────────────────────
  const rejectFacture = (facture, motifLabel) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === facture.id ? { ...f, valide: false, rejetMotif: motifLabel } : f)) };
    }));

    const dest = getDestByCP(cl?.cp);
    const nom = cl?.nom?.split(' ')[0] || '';

    const msg = canal === 'whatsapp'
      ? `Bonjour ${nom} 👋\n\n⚠️ La facture *${facture.vendeur}* (${eur(facture.montant)}) pour votre colis *${sel.ref}* n'a pas pu être validée.\n\n📄 *Motif : ${motifLabel}*\n\n👉 Merci de nous renvoyer une facture conforme dès que possible (photo ou PDF lisible).\n\nSans facture validée, nous ne pouvons pas avancer sur la préparation de votre colis.\n\n_Expedîle${dest ? ` — Paris → ${dest.nom}` : ''}_`
      : `Objet : Facture rejetée — ${sel.ref}\n\nBonjour ${cl?.nom || ''},\n\nLa facture ${facture.vendeur} (${eur(facture.montant)}) pour votre colis ${sel.ref} n'a pas pu être validée.\nMotif : ${motifLabel}.\n\nMerci de nous renvoyer une facture conforme (photo ou PDF lisible).\n\nCordialement,\nL'équipe Expedîle`;

    sendMsg(sel.id, sel.clientId, canal, null, msg);
    flash('Facture refusée — client notifié');
    setRejectingId(null);
    setMotifLibre('');
  };

  // ── Upload file ────────────────────────────────────────────────────────
  const handleFileUpload = (factureId) => {
    setUploadTargetId(factureId);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;

    const reader = new FileReader();
    reader.onload = () => {
      setData((prev) => prev.map((c) => {
        if (c.id !== sel.id) return c;
        return {
          ...c,
          factures: c.factures.map((f) =>
            f.id === uploadTargetId ? { ...f, fichier: reader.result, fichierNom: file.name } : f,
          ),
        };
      }));
      flash('Fichier joint à la facture');
      setUploadTargetId(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Open preview ───────────────────────────────────────────────────────
  const openPreview = (f) => {
    if (f.fichier) {
      setPreviewSrc(f.fichier);
      setPreviewTitle(`${f.vendeur} — ${eur(f.montant)}`);
    }
  };

  // ── Hidden file input ──────────────────────────────────────────────────
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,.pdf"
      className="hidden"
      onChange={handleFileChange}
    />
  );

  // ══════════════════════════════════════════════════════════════════════
  // Client: compact inline view
  // ══════════════════════════════════════════════════════════════════════
  if (!isStaff) {
    return (
      <div className="card px-4 py-3 anim-fade">
        {hiddenInput}
        {previewSrc && <Lightbox src={previewSrc} title={previewTitle} onClose={() => setPreviewSrc(null)} />}
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Factures d'origine</p>
        {sel.factures.map((f) => (
          <div key={f.id} className="flex items-center gap-2 py-1.5 text-xs">
            {/* Thumbnail / voir */}
            {f.fichier ? (
              <button
                onClick={() => openPreview(f)}
                className="flex-shrink-0 w-8 h-8 rounded-lg border border-gray-200 overflow-hidden hover:ring-2 hover:ring-blue-300 transition-all"
              >
                <img src={f.fichier} alt="" className="w-full h-full object-cover" />
              </button>
            ) : (
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                <FileText size={13} className="text-gray-400" />
              </div>
            )}
            <span className="flex-1 text-gray-700 truncate">{f.vendeur} — {eur(f.montant)}</span>
            {f.valide ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold flex-shrink-0">
                <Check size={11} />Validée
              </span>
            ) : f.rejetMotif ? (
              <span className="inline-flex items-center gap-0.5 text-red-500 font-bold flex-shrink-0">
                <X size={11} />Refusée
              </span>
            ) : (
              <span className="text-amber-500 font-medium flex-shrink-0">En vérification</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Staff: full panel with validation/rejection + preview
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="card p-4 anim-fade">
      {hiddenInput}
      {previewSrc && <Lightbox src={previewSrc} title={previewTitle} onClose={() => setPreviewSrc(null)} />}

      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Factures d'origine</p>

      <div className="space-y-3">
        {sel.factures.map((f) => (
          <div
            key={f.id}
            className="rounded-xl border-2 overflow-hidden transition-all"
            style={{
              borderColor: f.valide ? '#BBF7D0' : f.rejetMotif ? '#FECACA' : '#E5E7EB',
              background: f.valide ? '#F0FDF4' : f.rejetMotif ? '#FEF2F2' : 'white',
            }}
          >
            {/* Header row with thumbnail */}
            <div className="px-3 py-2.5 flex items-center gap-3">
              {/* Thumbnail or upload */}
              {f.fichier ? (
                <button
                  onClick={() => openPreview(f)}
                  className="relative flex-shrink-0 w-14 h-14 rounded-xl border-2 border-gray-200 overflow-hidden group hover:border-blue-400 transition-all"
                >
                  <img src={f.fichier} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                    <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ) : (
                <button
                  onClick={() => handleFileUpload(f.id)}
                  className="flex-shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-0.5 hover:border-blue-400 hover:bg-blue-50 transition-all"
                >
                  <Upload size={14} className="text-gray-400" />
                  <span className="text-[8px] font-bold text-gray-400 uppercase">Joindre</span>
                </button>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: BRAND.navy }}>{f.vendeur}</p>
                <p className="text-xs text-gray-500">{eur(f.montant)}</p>
                {f.fichier && (
                  <p className="text-[10px] text-gray-400 truncate">{f.fichierNom || 'Fichier joint'}</p>
                )}
              </div>

              {/* Status badge */}
              {f.valide && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg flex-shrink-0">
                  <Check size={12} /> Validée
                </span>
              )}
              {!f.valide && f.rejetMotif && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg flex-shrink-0">
                  <X size={12} /> Refusée
                </span>
              )}
            </div>

            {/* Preview button when file exists */}
            {f.fichier && (
              <div className="px-3 pb-2 flex gap-2">
                <button
                  onClick={() => openPreview(f)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                  style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                >
                  <Eye size={12} />
                  Voir la facture
                </button>
                <button
                  onClick={() => handleFileUpload(f.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
                >
                  <Upload size={12} />
                  Remplacer
                </button>
              </div>
            )}

            {/* Rejected motif display */}
            {!f.valide && f.rejetMotif && (
              <div className="px-3 pb-2">
                <p className="text-[11px] text-red-600 italic">Motif : {f.rejetMotif}</p>
              </div>
            )}

            {/* No file warning */}
            {!f.fichier && !f.valide && (
              <div className="px-3 pb-2">
                <p className="text-[10px] text-amber-600 italic flex items-center gap-1">
                  <ImageIcon size={10} /> Aucun fichier joint — cliquez sur "Joindre" pour ajouter
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="px-3 pb-3">
              {f.valide ? (
                <button
                  onClick={() => unvalidateFacture(f.id)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-bold border-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-all active:scale-[0.98]"
                >
                  <RotateCcw size={12} />
                  Annuler la validation
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => validateFacture(f.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                    style={{ background: '#16A34A', color: 'white', boxShadow: '0 2px 8px #16A34A30' }}
                  >
                    <Check size={13} />
                    Valider
                  </button>
                  <button
                    onClick={() => {
                      setRejectingId(rejectingId === f.id ? null : f.id);
                      setMotifLibre('');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                    style={{
                      background: rejectingId === f.id ? '#DC2626' : '#FEF2F2',
                      color: rejectingId === f.id ? 'white' : '#DC2626',
                      border: rejectingId === f.id ? 'none' : '2px solid #FECACA',
                    }}
                  >
                    <X size={13} />
                    Refuser
                  </button>
                </div>
              )}
            </div>

            {/* Rejection motif picker */}
            {rejectingId === f.id && !f.valide && (
              <div className="px-3 pb-3 space-y-2.5 border-t border-red-100 pt-3 anim-slide-down">
                <p className="text-[11px] font-bold text-red-700">
                  Motif du refus <span className="font-normal text-red-400">(le client sera notifié par {canal === 'whatsapp' ? 'WhatsApp' : 'email'})</span>
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {MOTIFS_REJET.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => rejectFacture(f, m.label)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border-2 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 transition-all active:scale-95"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={motifLibre}
                    onChange={(e) => setMotifLibre(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && motifLibre.trim()) {
                        rejectFacture(f, motifLibre.trim());
                      }
                    }}
                    placeholder="Autre motif..."
                    className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 text-xs outline-none transition-all focus:border-red-300"
                    style={{ color: BRAND.navy }}
                  />
                  <button
                    onClick={() => motifLibre.trim() && rejectFacture(f, motifLibre.trim())}
                    disabled={!motifLibre.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30"
                    style={{ background: '#DC2626', color: 'white' }}
                  >
                    Envoyer
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

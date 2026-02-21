import React, { useState } from 'react';
import { Check, X, AlertTriangle, RotateCcw } from 'lucide-react';
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

export default function FacturesPanel() {
  const { sel, isStaff, setData, flash, sendMsg, getClient } = useApp();
  const [rejectingId, setRejectingId] = useState(null);
  const [motifLibre, setMotifLibre] = useState('');

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

  // Client: compact inline view
  if (!isStaff) {
    return (
      <div className="card px-4 py-3 anim-fade">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Factures d'origine</p>
        {sel.factures.map((f) => (
          <div key={f.id} className="flex justify-between items-center py-1.5 text-xs">
            <span className="text-gray-700">{f.vendeur} — {eur(f.montant)}</span>
            {f.valide ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold">
                <Check size={11} />Validée
              </span>
            ) : f.rejetMotif ? (
              <span className="inline-flex items-center gap-0.5 text-red-500 font-bold">
                <X size={11} />Refusée
              </span>
            ) : (
              <span className="text-amber-500 font-medium">En vérification</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Staff: full panel with validation/rejection
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="card p-4 anim-fade">
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
            {/* Header row */}
            <div className="px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: BRAND.navy }}>{f.vendeur}</p>
                <p className="text-xs text-gray-500">{eur(f.montant)}</p>
              </div>

              {/* Status badge */}
              {f.valide && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg">
                  <Check size={12} /> Validée
                </span>
              )}
              {!f.valide && f.rejetMotif && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg">
                  <X size={12} /> Refusée
                </span>
              )}
            </div>

            {/* Rejected motif display */}
            {!f.valide && f.rejetMotif && (
              <div className="px-3 pb-2">
                <p className="text-[11px] text-red-600 italic">Motif : {f.rejetMotif}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="px-3 pb-3">
              {f.valide ? (
                /* Validated state: show "Annuler la validation" */
                <button
                  onClick={() => unvalidateFacture(f.id)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-bold border-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-all active:scale-[0.98]"
                >
                  <RotateCcw size={12} />
                  Annuler la validation
                </button>
              ) : (
                /* Pending / Rejected state: show Valider + Refuser buttons */
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

                {/* Pre-filled motifs */}
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

                {/* Free-text motif */}
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

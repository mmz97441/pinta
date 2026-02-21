import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getDestByCP } from '../../constants';
import { eur } from '../../utils';

const MOTIFS_REJET = [
  { key: 'non_conforme', label: 'Non conforme' },
  { key: 'illisible', label: 'Illisible / mauvaise qualité' },
  { key: 'montant', label: 'Montant incorrect' },
  { key: 'autre', label: 'Autre raison' },
];

export default function FacturesPanel() {
  const { sel, isStaff, setData, flash, sendMsg, getClient } = useApp();
  const [rejectingId, setRejectingId] = useState(null);

  if (!sel || sel.factures.length === 0) return null;

  const cl = getClient(sel.clientId);
  const canal = cl?.canal || 'whatsapp';

  const validateFacture = (factureId) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: true } : f)) };
    }));
    flash('Facture validée');
  };

  const rejectFacture = (facture, motif) => {
    // 1. Invalidate
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === facture.id ? { ...f, valide: false } : f)) };
    }));

    // 2. Notify client via preferred canal
    const dest = getDestByCP(cl?.cp);
    const nom = cl?.nom?.split(' ')[0] || '';

    const msg = canal === 'whatsapp'
      ? `Bonjour ${nom} 👋\n\n⚠️ La facture *${facture.vendeur}* (${eur(facture.montant)}) pour votre colis *${sel.ref}* n'a pas pu être validée.\n\n📄 *Motif : ${motif.label}*\n\n👉 Merci de nous renvoyer une facture conforme dès que possible (photo ou PDF lisible).\n\nSans facture validée, nous ne pouvons pas avancer sur la préparation de votre colis.\n\n_Expedîle${dest ? ` — Paris → ${dest.nom}` : ''}_`
      : `Objet : Facture rejetée — ${sel.ref}\n\nBonjour ${cl?.nom || ''},\n\nLa facture ${facture.vendeur} (${eur(facture.montant)}) pour votre colis ${sel.ref} n'a pas pu être validée.\nMotif : ${motif.label}.\n\nMerci de nous renvoyer une facture conforme (photo ou PDF lisible).\n\nCordialement,\nL'équipe Expedîle`;

    sendMsg(sel.id, sel.clientId, canal, null, msg);
    setRejectingId(null);
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
            ) : (
              <span className="text-amber-500 font-medium">En vérification</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Staff: full panel with validation/rejection
  return (
    <div className="card p-4 anim-fade">
      <p className="font-bold mb-2 text-sm">Factures d'origine</p>
      {sel.factures.map((f) => (
        <div key={f.id}>
          <div className="flex justify-between items-center py-1 text-sm">
            <span>{f.vendeur} — {eur(f.montant)}</span>
            {f.valide ? (
              <button
                onClick={() => setRejectingId(rejectingId === f.id ? null : f.id)}
                className="text-green-600 text-xs font-bold hover:text-red-500 transition-colors group"
              >
                <Check size={12} className="inline mr-0.5" />
                <span className="group-hover:hidden">Validée</span>
                <span className="hidden group-hover:inline">Annuler</span>
              </button>
            ) : (
              <button onClick={() => validateFacture(f.id)} className="text-slate-800 text-xs font-bold hover:underline">
                Valider
              </button>
            )}
          </div>

          {/* Reason picker for rejection */}
          {rejectingId === f.id && (
            <div className="mt-1 mb-2 p-2.5 rounded-lg bg-red-50 border border-red-100 anim-slide-down">
              <p className="text-xs font-bold text-red-700 mb-2">
                Motif du rejet (le client sera notifié par {canal === 'whatsapp' ? 'WhatsApp' : 'email'}) :
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MOTIFS_REJET.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => rejectFacture(f, m)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-700 hover:bg-red-100 transition-all active:scale-95"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setRejectingId(null)}
                className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
              >
                <X size={10} /> Fermer
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

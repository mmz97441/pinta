import React from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { eur } from '../../utils';

export default function FacturesPanel() {
  const { sel, isStaff, setData, flash } = useApp();
  if (!sel || sel.factures.length === 0) return null;

  const toggleFacture = (factureId, newValide) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: newValide } : f)) };
    }));
    flash(newValide ? 'Facture validée' : 'Validation annulée');
  };

  return (
    <div className="card p-4 anim-fade">
      <p className="font-bold mb-2 text-sm">Factures d'origine</p>
      {sel.factures.map((f) => (
        <div key={f.id} className="flex justify-between items-center py-1 text-sm">
          <span>{f.vendeur} — {eur(f.montant)}</span>
          {f.valide ? (
            isStaff ? (
              <button
                onClick={() => toggleFacture(f.id, false)}
                className="text-green-600 text-xs font-bold hover:text-red-500 transition-colors group"
              >
                <Check size={12} className="inline mr-0.5" />
                <span className="group-hover:hidden">Validée</span>
                <span className="hidden group-hover:inline">Annuler</span>
              </button>
            ) : (
              <span className="text-green-600 text-xs font-bold">
                <Check size={12} className="inline mr-0.5" />Validée
              </span>
            )
          ) : isStaff ? (
            <button onClick={() => toggleFacture(f.id, true)} className="text-slate-800 text-xs font-bold hover:underline">
              Valider
            </button>
          ) : (
            <span className="text-orange-500 text-xs">En vérification</span>
          )}
        </div>
      ))}
    </div>
  );
}

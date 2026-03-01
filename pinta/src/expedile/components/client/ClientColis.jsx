import React, { useState, useEffect } from 'react';
import { Package, Plus, ChevronRight, AlertCircle, CreditCard, CheckCircle, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, PHASES_CLIENT, getPhaseIndex } from '../../constants';
import { Badge } from '../ui';

function ProgressBar({ statut }) {
  const idx = getPhaseIndex(statut);
  const total = PHASES_CLIENT.length - 1;
  const pct = Math.round((idx / total) * 100);
  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-400 font-medium">
          {PHASES_CLIENT[idx]?.label}
        </span>
        <span className="text-xs font-bold" style={{ color: BRAND.navy }}>
          {pct}%
        </span>
      </div>
      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: BRAND.navy,
          }}
        />
      </div>
    </div>
  );
}

const TABS = [
  { key: 'actifs', label: 'En cours' },
  { key: 'livres', label: 'Livrés' },
  { key: 'tous', label: 'Tous' },
];

const FILTER_LABELS = {
  a_traiter: 'À traiter',
  a_payer: 'À payer',
};

export default function ClientColis({ onNewColis }) {
  const { authCl, data, setSelId, colisFilter, setColisFilter, ask, payer } = useApp();
  const [colisTab, setColisTab] = useState('actifs');

  // When arriving from a stat card with a filter, force the "actifs" tab
  useEffect(() => {
    if (colisFilter) setColisTab('actifs');
  }, [colisFilter]);

  const myColis = authCl ? data.filter((p) => p.clientId === authCl.id) : [];

  const actifs = myColis.filter((p) => p.statut !== 'livre' && p.statut !== 'annule');
  const livres = myColis.filter((p) => p.statut === 'livre');

  // Apply sub-filter within actifs
  const filteredActifs = colisFilter === 'a_traiter'
    ? actifs.filter((p) => p.statut === 'attente_feu_vert' || p.statut === 'devis_envoye')
    : colisFilter === 'a_payer'
    ? actifs.filter((p) => p.statut === 'attente_paiement')
    : actifs;

  const counts = {
    actifs: filteredActifs.length,
    livres: livres.length,
    tous: myColis.length,
  };

  const displayed =
    colisTab === 'actifs' ? filteredActifs :
    colisTab === 'livres' ? livres :
    myColis;

  const needsAction = (p) =>
    p.statut === 'attente_feu_vert' || p.statut === 'attente_paiement';

  return (
    <div className="anim-fade space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-gray-900">Mes colis</h2>
        <button
          onClick={onNewColis}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-[13px] text-white active:scale-95 transition-all"
          style={{ background: BRAND.navy }}
        >
          <Plus size={13} strokeWidth={2.5} />
          Nouveau colis
        </button>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        {TABS.map((tab) => {
          const active = colisTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setColisTab(tab.key); setColisFilter(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-bold transition-all ${
                active ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
              style={active ? { color: BRAND.navy } : {}}
            >
              {tab.label}
              {counts[tab.key] > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-xs font-bold leading-none ${
                    active ? 'text-white' : 'bg-gray-200 text-gray-500'
                  }`}
                  style={active ? { backgroundColor: BRAND.navy } : {}}
                >
                  {counts[tab.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active filter chip ── */}
      {colisFilter && FILTER_LABELS[colisFilter] && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filtre :</span>
          <button
            onClick={() => setColisFilter(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white active:scale-95 transition-all"
            style={{ backgroundColor: BRAND.navy }}
          >
            {FILTER_LABELS[colisFilter]}
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* ── Colis list ── */}
      {displayed.length === 0 ? (
        <div className="anim-fade flex flex-col items-center justify-center py-14 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: BRAND.navy + '10' }}
          >
            <Package size={28} style={{ color: BRAND.navy }} strokeWidth={1.5} />
          </div>
          <p className="font-bold text-gray-700 mb-1">
            {colisFilter === 'a_traiter'
              ? 'Aucun colis à traiter'
              : colisFilter === 'a_payer'
              ? 'Aucun colis à payer'
              : colisTab === 'actifs'
              ? 'Aucun colis en cours'
              : colisTab === 'livres'
              ? 'Aucune livraison'
              : 'Aucun colis'}
          </p>
          <p className="text-xs text-gray-400 max-w-[220px]">
            {colisFilter
              ? 'Aucun colis ne correspond à ce filtre.'
              : colisTab === 'actifs'
              ? 'Ajoutez votre prochain colis pour démarrer !'
              : 'Vos colis livrés apparaîtront ici.'}
          </p>
          {colisTab === 'actifs' && (
            <button
              onClick={onNewColis}
              className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
            >
              <Plus size={15} strokeWidth={2.5} />
              Ajouter un colis
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((p, i) => {
            const action = needsAction(p);
            const isLivre = p.statut === 'livre';
            const isFV = p.statut === 'attente_feu_vert';
            const isPay = p.statut === 'attente_paiement';

            return (
              <button
                key={p.id}
                onClick={() => setSelId(p.id)}
                className="anim-fade w-full text-left rounded-xl p-3.5"
                style={{
                  background: 'white',
                  border: '1px solid #E5E7EB',
                  ...(isFV ? { borderLeft: `3px solid ${BRAND.gold}` } : {}),
                  ...(isPay ? { borderLeft: `3px solid #F59E0B` } : {}),
                  ...(isLivre ? { borderLeft: `3px solid #10B981` } : {}),
                  boxShadow: action ? '0 1px 4px rgba(0,0,0,0.06)' : '0 1px 2px rgba(0,0,0,0.03)',
                  animationDelay: `${i * 0.04}s`,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-sm text-gray-900">{p.ref}</p>
                      {action && (
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-md"
                          style={{
                            background: isFV ? `${BRAND.gold}20` : '#FEF3C7',
                            color: isFV ? BRAND.goldD : '#92400E',
                          }}
                        >
                          À faire
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{p.desc}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Badge statut={p.statut} />
                    <ChevronRight size={14} className="text-gray-300" />
                  </div>
                </div>

                {/* Action indicators */}
                {isFV && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                    <AlertCircle size={13} />
                    On attend votre réponse
                  </div>
                )}
                {isPay && p.devisTotal != null && (
                  <div
                    className="mt-2.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      ask(
                        'Confirmer le paiement',
                        `Valider le paiement de ${p.devisTotal.toFixed(2)} € pour ${p.ref} ?`,
                        () => payer(p.id, p.devisTotal),
                        { okLabel: 'Payer' }
                      );
                    }}
                  >
                    <div
                      className="flex items-center justify-center gap-1.5 text-xs font-black py-2 rounded-xl active:scale-95 transition-all"
                      style={{
                        background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                        color: BRAND.navyD,
                        boxShadow: `0 2px 8px rgba(232,184,75,0.25)`,
                      }}
                    >
                      <CreditCard size={13} />
                      Payer {p.devisTotal.toFixed(2)} €
                    </div>
                  </div>
                )}
                {isPay && p.devisTotal == null && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                    <CreditCard size={13} />
                    À payer
                  </div>
                )}

                {/* Progress bar — visible in all tabs for active colis */}
                {!isLivre && p.statut !== 'annule' && !action && (
                  <ProgressBar statut={p.statut} />
                )}

                {/* Livré */}
                {isLivre && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                    <CheckCircle size={11} />
                    Livré
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

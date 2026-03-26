import React, { useState, useEffect } from 'react';
import { Package, ChevronRight, AlertCircle, CreditCard, CheckCircle, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { eur } from '../../utils';
import { Badge, Etapes, ProgressBar, ViewToggle } from '../ui';

const TABS = [
  { key: 'actifs', label: 'En cours' },
  { key: 'livres', label: 'Livrés' },
  { key: 'tous', label: 'Tous' },
];

const FILTER_LABELS = {
  a_traiter: 'À traiter',
  a_payer: 'À payer',
};

export default function ClientColis() {
  const { authCl, data, setSelId, colisFilter, setColisFilter, ask, payer } = useApp();
  const [colisTab, setColisTab] = useState('actifs');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'columns'

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
        <h2 className="text-xl font-black text-gray-900">Mes colis</h2>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
        {TABS.map((tab) => {
          const active = colisTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setColisTab(tab.key); setColisFilter(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                active ? 'bg-white shadow-sm' : 'text-gray-500'
              }`}
              style={active ? { color: BRAND.navy } : {}}
            >
              {tab.label}
              {counts[tab.key] > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${
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
              ? 'Aucun colis en cours pour le moment.'
              : 'Vos colis livrés apparaîtront ici.'}
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        /* ── Vue Cartes ── */
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
                className={`anim-fade w-full text-left ${action ? 'card-elevated' : 'card'} p-4 rounded-2xl`}
                style={{
                  ...(isFV ? { borderLeft: `4px solid ${BRAND.gold}` } : {}),
                  ...(isPay ? { borderLeft: `4px solid #f59e0b` } : {}),
                  ...(isLivre ? { borderLeft: `4px solid #10b981` } : {}),
                  animationDelay: `${i * 0.04}s`,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-sm text-gray-900">{p.ref}</p>
                      {action && (
                        <span
                          className="text-[9px] font-black px-1.5 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: isFV ? BRAND.goldD : '#d97706' }}
                        >
                          ACTION
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
                    Votre accord est attendu
                  </div>
                )}
                {isPay && p.devisTotal != null && (
                  <div className="mt-3 pt-2.5 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Montant dû</span>
                      <span className="text-sm font-black" style={{ color: BRAND.navy }}>
                        {p.devisTotal.toFixed(2)} €
                      </span>
                    </div>
                    <div
                      className="mt-2"
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
                        className="flex items-center justify-center gap-1.5 text-xs font-black py-2.5 rounded-xl active:scale-95 transition-all"
                        style={{
                          background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                          color: BRAND.navyD,
                          boxShadow: `0 2px 8px rgba(232,184,75,0.25)`,
                        }}
                      >
                        <CreditCard size={13} />
                        Payer
                      </div>
                    </div>
                  </div>
                )}
                {isPay && p.devisTotal == null && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                    <CreditCard size={13} />
                    Paiement requis
                  </div>
                )}

                {/* Progress bar for non-terminal statuts */}
                {!isLivre && p.statut !== 'annule' && !action && (
                  <ProgressBar statut={p.statut} />
                )}

                {/* Livré celebration */}
                {isLivre && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle size={12} />
                    Livré avec succès 🎉
                  </div>
                )}

                {/* Etapes for non-action colis in "En cours" */}
                {!action && !isLivre && p.statut !== 'annule' && colisTab === 'tous' && (
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    <Etapes statut={p.statut} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* ── Vue Colonnes (tableau) ── */
        <div className="anim-fade card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100" style={{ backgroundColor: BRAND.navy + '08' }}>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Référence</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Description</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Statut</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Dimensions</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Transport</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Taxes</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Total</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-center">Action</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((p, i) => {
                  const action = needsAction(p);
                  const isLivre = p.statut === 'livre';
                  const isFV = p.statut === 'attente_feu_vert';
                  const isPay = p.statut === 'attente_paiement';
                  const taxes = (p.devisOM != null || p.devisOMR != null || p.devisTVA != null)
                    ? ((p.devisOM || 0) + (p.devisOMR || 0) + (p.devisTVA || 0))
                    : null;

                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelId(p.id)}
                      className="anim-fade border-b border-gray-50 last:border-b-0 cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100"
                      style={{
                        animationDelay: `${i * 0.03}s`,
                        ...(isFV ? { borderLeft: `3px solid ${BRAND.gold}` } : {}),
                        ...(isPay ? { borderLeft: `3px solid #f59e0b` } : {}),
                        ...(isLivre ? { borderLeft: `3px solid #10b981` } : {}),
                      }}
                    >
                      {/* Référence */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-xs text-gray-900">{p.ref}</span>
                          {action && (
                            <span
                              className="text-[9px] font-black px-1 py-0.5 rounded-full text-white"
                              style={{ backgroundColor: isFV ? BRAND.goldD : '#d97706' }}
                            >
                              ACTION
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Description */}
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-gray-600 truncate block max-w-[160px]">{p.desc}</span>
                      </td>

                      {/* Statut */}
                      <td className="px-3 py-2.5">
                        <Badge statut={p.statut} />
                      </td>

                      {/* Dimensions */}
                      <td className="px-3 py-2.5">
                        {p.dimL != null ? (
                          <span className="text-[11px] text-gray-500 font-mono whitespace-nowrap">{p.dimL}×{p.dimW}×{p.dimH} cm · {p.poids} kg</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>

                      {/* Transport */}
                      <td className="px-3 py-2.5 text-right">
                        {p.devisTransport != null ? (
                          <span className="text-xs font-semibold text-gray-700">{eur(p.devisTransport)}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>

                      {/* Taxes (OM + OMR + TVA) */}
                      <td className="px-3 py-2.5 text-right">
                        {taxes != null ? (
                          <span className="text-xs text-gray-600">{eur(taxes)}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>

                      {/* Total */}
                      <td className="px-3 py-2.5 text-right">
                        {p.devisTotal != null ? (
                          <span className="text-sm font-bold" style={{ color: BRAND.navy }}>
                            {eur(p.devisTotal)}
                          </span>
                        ) : p.estMin != null && p.estMax != null ? (
                          <span className="text-[11px] text-gray-400">
                            ~{p.estMin}–{p.estMax} €
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>

                      {/* Action rapide */}
                      <td className="px-3 py-2.5 text-center">
                        {isFV && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <AlertCircle size={12} />
                            Accord
                          </span>
                        )}
                        {isPay && p.devisTotal != null && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              ask(
                                'Confirmer le paiement',
                                `Valider le paiement de ${p.devisTotal.toFixed(2)} € pour ${p.ref} ?`,
                                () => payer(p.id, p.devisTotal),
                                { okLabel: 'Payer' }
                              );
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg active:scale-95 transition-all"
                            style={{
                              background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                              color: BRAND.navyD,
                            }}
                          >
                            <CreditCard size={11} />
                            Payer
                          </button>
                        )}
                        {isPay && p.devisTotal == null && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                            <CreditCard size={12} />
                            Paiement
                          </span>
                        )}
                        {isLivre && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle size={12} />
                            Livré
                          </span>
                        )}
                      </td>

                      {/* Chevron */}
                      <td className="pr-2 py-2.5">
                        <ChevronRight size={14} className="text-gray-300" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, AlertCircle, CreditCard, CheckCircle, Clock, TrendingUp, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP } from '../../constants';
import { eur } from '../../utils';
import { Badge, ProgressBar, ViewToggle } from '../ui';

export default function ClientAccueil() {
  const navigate = useNavigate();
  const { authCl, data, clients, ask, feuVertBulk, payer, setColisFilter } = useApp();
  const [viewMode, setViewMode] = useState('cards');

  const cl = authCl;
  const dest = cl ? getDestByCP(cl.cp) : null;
  const firstName = cl ? cl.nom.split(' ')[0] : 'Client';

  const myColis = cl ? data.filter((p) => p.clientId === cl.id) : [];

  const enCours = myColis.filter((p) =>
    p.statut !== 'livre' && p.statut !== 'annule'
  );
  const aTraiter = myColis.filter((p) =>
    p.statut === 'attente_feu_vert' || p.statut === 'devis_envoye'
  );
  const aPayer = myColis.filter((p) => p.statut === 'attente_paiement');
  const livres = myColis.filter((p) => p.statut === 'livre');

  const colisAttenteFV = myColis.filter((p) => p.statut === 'attente_feu_vert');
  const colisPaiement = myColis.filter((p) => p.statut === 'attente_paiement');
  const actionsRequises = [...colisAttenteFV, ...colisPaiement];

  const colisCours = enCours.filter(
    (p) => p.statut !== 'attente_feu_vert' && p.statut !== 'attente_paiement'
  );

  const derniereLivraison = livres.length > 0 ? livres[livres.length - 1] : null;

  return (
    <div className="anim-fade space-y-4">
      {/* ── Welcome card ── */}
      <div
        className="rounded-2xl p-5 text-white relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyL} 60%, ${BRAND.navyD} 100%)`,
          boxShadow: `0 4px 24px rgba(27,58,75,0.25)`,
        }}
      >
        {/* Decorative circle */}
        <div
          className="absolute -top-6 -right-6 w-32 h-32 rounded-full opacity-10"
          style={{ background: BRAND.gold }}
        />
        <div
          className="absolute -bottom-8 -right-8 w-24 h-24 rounded-full opacity-5"
          style={{ background: BRAND.goldL }}
        />

        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: BRAND.goldL }}>
          Bienvenue
        </p>
        <h2 className="text-2xl font-black leading-tight mb-1">
          Bonjour {firstName} 👋
        </h2>
        {dest && (
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {dest.flag} {dest.nom}
          </p>
        )}
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => { setColisFilter(null); navigate('/colis'); }} className="card p-3 text-center hover:shadow-md active:scale-95 transition-all cursor-pointer">
          <div className="text-2xl font-black" style={{ color: BRAND.navy }}>
            {enCours.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">En cours</div>
        </button>
        <button
          onClick={() => { setColisFilter('a_traiter'); navigate('/colis'); }}
          className="card p-3 text-center hover:shadow-md active:scale-95 transition-all cursor-pointer"
          style={aTraiter.length > 0 ? { borderLeft: `3px solid ${BRAND.gold}` } : {}}
        >
          <div
            className="text-2xl font-black"
            style={{ color: aTraiter.length > 0 ? BRAND.goldD : BRAND.navy }}
          >
            {aTraiter.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">À traiter</div>
        </button>
        <button
          onClick={() => { setColisFilter('a_payer'); navigate('/colis'); }}
          className="card p-3 text-center hover:shadow-md active:scale-95 transition-all cursor-pointer"
          style={aPayer.length > 0 ? { borderLeft: `3px solid #f59e0b` } : {}}
        >
          <div
            className="text-2xl font-black"
            style={{ color: aPayer.length > 0 ? '#b45309' : BRAND.navy }}
          >
            {aPayer.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">À payer</div>
        </button>
      </div>

      {/* ── Actions requises ── */}
      {actionsRequises.length > 0 && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={15} style={{ color: '#d97706' }} />
            <h3 className="font-bold text-sm text-gray-800">Actions requises</h3>
            <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              {actionsRequises.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {/* ── Carte groupée feu vert ── */}
            {colisAttenteFV.length > 0 && (
              <div
                className="card-elevated p-4 rounded-2xl"
                style={{ borderLeft: `4px solid ${BRAND.gold}` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle size={15} className="text-amber-600" />
                  <p className="font-bold text-sm text-gray-900">
                    {colisAttenteFV.length} colis en attente de votre accord
                  </p>
                </div>
                <div className="space-y-2 mb-3">
                  {colisAttenteFV.map((p) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center gap-2 text-left bg-amber-50/60 rounded-xl px-3 py-2 active:bg-amber-100 transition-colors"
                      onClick={() => navigate(`/colis/${p.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-xs text-gray-800">{p.ref}</span>
                        <span className="text-xs text-gray-500 ml-1.5 truncate">{p.desc}</span>
                        {p.dimL != null && (
                          <span className="text-[10px] text-gray-400 ml-1.5">
                            {p.dimL}×{p.dimW}×{p.dimH} cm
                          </span>
                        )}
                        {(() => {
                          const created = p.createdAt ? new Date(p.createdAt) : null;
                          const days = created ? Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                          return days > 5 ? (
                            <span className="ml-1.5 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                              urgent
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
                <button
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white text-sm active:scale-95 transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`,
                    boxShadow: `0 2px 12px rgba(27,58,75,0.2)`,
                  }}
                  onClick={() => {
                    const refs = colisAttenteFV.map((p) => p.ref).join(', ');
                    ask(
                      'Autoriser tous les colis',
                      `Vous confirmez autoriser la préparation de ${colisAttenteFV.length} colis ?\n\n${refs}`,
                      () => feuVertBulk(colisAttenteFV.map((p) => p.id)),
                      { okLabel: 'Oui, tout autoriser' }
                    );
                  }}
                >
                  <CheckCircle size={16} strokeWidth={2.5} />
                  Tout autoriser ({colisAttenteFV.length})
                </button>
              </div>
            )}

            {/* ── Cartes individuelles paiement ── */}
            {colisPaiement.map((p) => (
              <div
                key={p.id}
                className="card-elevated rounded-2xl overflow-hidden"
                style={{ borderLeft: `4px solid #f59e0b` }}
              >
                <button
                  onClick={() => navigate(`/colis/${p.id}`)}
                  className="w-full text-left p-4 active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{p.ref}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{p.desc}</p>
                    </div>
                    <Badge statut={p.statut} />
                  </div>
                </button>
                {p.devisTotal != null && cl?.type !== 'pro' && (
                  <div className="px-4 pb-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        ask(
                          'Confirmer le paiement',
                          `Valider le paiement de ${eur(p.devisTotal)} pour ${p.ref} ?`,
                          () => payer(p.id, p.devisTotal),
                          { okLabel: 'Payer' }
                        );
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-sm active:scale-95 transition-all"
                      style={{
                        background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                        color: BRAND.navyD,
                        boxShadow: `0 2px 10px rgba(232,184,75,0.3)`,
                      }}
                    >
                      <CreditCard size={14} />
                      Payer {eur(p.devisTotal)}
                    </button>
                  </div>
                )}
                {p.devisTotal != null && cl?.type === 'pro' && (
                  <div className="px-4 pb-4">
                    <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200">
                      <CreditCard size={14} />
                      Paiement géré par votre entreprise
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Colis en cours ── */}
      {colisCours.length > 0 && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <Package size={15} style={{ color: BRAND.navy }} />
            <h3 className="font-bold text-sm text-gray-800">Colis en cours</h3>
            <div className="ml-auto">
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          </div>

          {viewMode === 'cards' ? (
            <div className="space-y-2.5">
              {colisCours.slice(0, 3).map((p) => (
                <button key={p.id} onClick={() => navigate(`/colis/${p.id}`)} className="card p-4 w-full text-left hover:shadow-md active:scale-[0.98] transition-all cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900">{p.ref}</p>
                      <p className="text-xs text-gray-500 truncate">{p.desc}</p>
                    </div>
                    <Badge statut={p.statut} />
                  </div>
                  <ProgressBar statut={p.statut} />
                </button>
              ))}
              {colisCours.length > 3 && (
                <button
                  onClick={() => { setColisFilter(null); navigate('/colis'); }}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl active:scale-95 transition-all"
                  style={{ color: BRAND.navy, backgroundColor: BRAND.navy + '08' }}
                >
                  Voir les {colisCours.length} colis en cours
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          ) : (
            <div className="card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100" style={{ backgroundColor: BRAND.navy + '08' }}>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">N° Colis</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Description</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Statut</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Dimensions</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Transport</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Taxes</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {colisCours.map((p, i) => {
                      const taxes = (p.devisOM != null || p.devisOMR != null || p.devisTVA != null)
                        ? ((p.devisOM || 0) + (p.devisOMR || 0) + (p.devisTVA || 0))
                        : null;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => navigate(`/colis/${p.id}`)}
                          className="anim-fade border-b border-gray-50 last:border-b-0 cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100"
                          style={{ animationDelay: `${i * 0.03}s` }}
                        >
                          <td className="px-3 py-2.5">
                            <span className="font-black text-xs text-gray-900">{p.ref}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-gray-600 truncate block max-w-[150px]">{p.desc}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge statut={p.statut} />
                          </td>
                          <td className="px-3 py-2.5">
                            {p.dimL != null ? (
                              <span className="text-[11px] text-gray-500 font-mono whitespace-nowrap">{p.dimL}×{p.dimW}×{p.dimH} cm · {p.poids} kg</span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {p.devisTransport != null ? (
                              <span className="text-xs font-semibold text-gray-700">{eur(p.devisTransport)}</span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {taxes != null ? (
                              <span className="text-xs text-gray-600">{eur(taxes)}</span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {p.devisTotal != null ? (
                              <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{eur(p.devisTotal)}</span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
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
      )}

      {/* ── Dernière livraison ── */}
      {derniereLivraison && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={15} className="text-emerald-500" />
            <h3 className="font-bold text-sm text-gray-800">Dernière livraison</h3>
          </div>
          <button
            onClick={() => navigate(`/colis/${derniereLivraison.id}`)}
            className="card p-4 rounded-2xl w-full text-left hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            style={{ borderLeft: `4px solid #10b981` }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-gray-900">{derniereLivraison.ref}</p>
                <p className="text-xs text-gray-500 mt-0.5">{derniereLivraison.desc}</p>
              </div>
              <span className="text-2xl">🎉</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-700 font-semibold">
              <CheckCircle size={12} />
              Livré avec succès
            </div>
          </button>
        </div>
      )}

    </div>
  );
}

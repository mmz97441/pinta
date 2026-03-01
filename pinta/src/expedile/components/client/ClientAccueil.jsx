import React from 'react';
import { Package, AlertCircle, CreditCard, Plus, CheckCircle, Clock, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP, PHASES_CLIENT, getPhaseIndex } from '../../constants';
import { eur } from '../../utils';
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

export default function ClientAccueil({ onNewColis }) {
  const { authCl, data, clients, ask, feuVertBulk, payer, setSelId, setClientTab, setColisFilter } = useApp();

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
        className="rounded-xl p-4 text-white relative overflow-hidden"
        style={{
          background: BRAND.navy,
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: BRAND.goldL, opacity: 0.8 }}>
              Bonjour
            </p>
            <h2 className="text-lg font-black leading-tight">
              {firstName}
            </h2>
            {dest && (
              <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {dest.flag} {dest.nom}
              </p>
            )}
          </div>
          <button
            onClick={onNewColis}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold transition-all active:scale-95"
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <Plus size={13} strokeWidth={2.5} />
            Nouveau colis
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'white', border: '1px solid #E5E7EB', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
      >
        <div className="grid grid-cols-3">
          <button
            onClick={() => { setColisFilter(null); setClientTab('colis'); }}
            className="text-center py-3 px-2 transition-all active:bg-gray-50"
            style={{ borderRight: '1px solid #F3F4F6' }}
          >
            <p className="text-xl font-black leading-none" style={{ color: BRAND.navy }}>
              {enCours.length}
            </p>
            <p className="text-xs text-gray-400 font-semibold mt-1 uppercase tracking-wider">En cours</p>
          </button>
          <button
            onClick={() => { setColisFilter('a_traiter'); setClientTab('colis'); }}
            className="text-center py-3 px-2 transition-all active:bg-gray-50"
            style={{ borderRight: '1px solid #F3F4F6' }}
          >
            <p
              className="text-xl font-black leading-none"
              style={{ color: aTraiter.length > 0 ? BRAND.goldD : '#D1D5DB' }}
            >
              {aTraiter.length}
            </p>
            <p className="text-xs text-gray-400 font-semibold mt-1 uppercase tracking-wider">
              {aTraiter.length > 0 ? 'À traiter' : 'À traiter'}
            </p>
          </button>
          <button
            onClick={() => { setColisFilter('a_payer'); setClientTab('colis'); }}
            className="text-center py-3 px-2 transition-all active:bg-gray-50"
          >
            <p
              className="text-xl font-black leading-none"
              style={{ color: aPayer.length > 0 ? '#D97706' : '#D1D5DB' }}
            >
              {aPayer.length}
            </p>
            <p className="text-xs text-gray-400 font-semibold mt-1 uppercase tracking-wider">À payer</p>
          </button>
        </div>
      </div>

      {/* ── Actions requises ── */}
      {actionsRequises.length > 0 && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} style={{ color: '#D97706' }} />
            <h3 className="font-bold text-[13px] text-gray-800">À faire</h3>
            <span className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">
              {actionsRequises.length}
            </span>
          </div>
          <div className="space-y-2">
            {/* ── Feu vert groupé ── */}
            {colisAttenteFV.length > 0 && (
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: 'white', border: '1px solid #E5E7EB', borderLeft: `3px solid ${BRAND.gold}` }}
              >
                <div className="px-3.5 py-2.5">
                  <p className="font-bold text-[13px] text-gray-800">
                    {colisAttenteFV.length} colis en attente de votre réponse
                  </p>
                </div>
                <div className="px-3.5 space-y-1 pb-2">
                  {colisAttenteFV.map((p) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-2 active:bg-gray-50 transition-colors"
                      style={{ background: '#FAFAFA' }}
                      onClick={() => { setSelId(p.id); setClientTab('colis'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-[12px] text-gray-800">{p.ref}</span>
                        <span className="text-[11px] text-gray-500 ml-1.5 truncate">{p.desc}</span>
                        {p.dimL != null && (
                          <span className="text-xs text-gray-400 ml-1.5">
                            {p.dimL}x{p.dimW}x{p.dimH} cm
                          </span>
                        )}
                      </div>
                      <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
                <div className="px-3.5 pb-3.5">
                  <button
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-white text-[13px] active:scale-95 transition-all"
                    style={{ background: BRAND.navy }}
                    onClick={() => {
                      const refs = colisAttenteFV.map((p) => p.ref).join(', ');
                      ask(
                        'Confirmer',
                        `On prépare vos ${colisAttenteFV.length} colis, d'accord ?\n\n${refs}`,
                        () => feuVertBulk(colisAttenteFV.map((p) => p.id)),
                        { okLabel: 'Oui pour tous' }
                      );
                    }}
                  >
                    <CheckCircle size={14} strokeWidth={2.5} />
                    Oui pour tous ({colisAttenteFV.length})
                  </button>
                </div>
              </div>
            )}

            {/* ── Paiement ── */}
            {colisPaiement.map((p) => (
              <div
                key={p.id}
                className="rounded-xl overflow-hidden"
                style={{ background: 'white', border: '1px solid #E5E7EB', borderLeft: '3px solid #F59E0B' }}
              >
                <button
                  onClick={() => setSelId(p.id)}
                  className="w-full text-left px-3.5 py-2.5 active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[13px] text-gray-800 truncate">{p.ref}</p>
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">{p.desc}</p>
                    </div>
                    <Badge statut={p.statut} />
                  </div>
                </button>
                {p.devisTotal != null && (
                  <div className="px-3.5 pb-3.5">
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
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-[13px] active:scale-95 transition-all"
                      style={{
                        background: BRAND.gold,
                        color: BRAND.navyD,
                      }}
                    >
                      <CreditCard size={14} />
                      Payer {eur(p.devisTotal)}
                    </button>
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
            <Package size={14} style={{ color: BRAND.navy }} />
            <h3 className="font-bold text-[13px] text-gray-800">Colis en cours</h3>
          </div>
          <div className="space-y-2">
            {colisCours.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelId(p.id)}
                className="w-full text-left rounded-xl p-3.5 active:scale-[0.98] transition-all"
                style={{ background: 'white', border: '1px solid #E5E7EB', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[13px] text-gray-800">{p.ref}</p>
                    <p className="text-[11px] text-gray-500 truncate">{p.desc}</p>
                  </div>
                  <Badge statut={p.statut} />
                </div>
                <ProgressBar statut={p.statut} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Dernière livraison ── */}
      {derniereLivraison && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={14} className="text-emerald-500" />
            <h3 className="font-bold text-[13px] text-gray-800">Dernière livraison</h3>
          </div>
          <button
            onClick={() => setSelId(derniereLivraison.id)}
            className="w-full text-left rounded-xl p-3.5 active:scale-[0.98] transition-all"
            style={{ background: 'white', border: '1px solid #E5E7EB', borderLeft: '3px solid #10B981' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-[13px] text-gray-800">{derniereLivraison.ref}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{derniereLivraison.desc}</p>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold">
                <CheckCircle size={12} />
                Livré
              </div>
            </div>
          </button>
        </div>
      )}

      {/* ── Pré-annoncer (if no active colis) ── */}
      {enCours.length === 0 && (
        <div className="anim-fade-up">
          <div
            className="rounded-xl py-10 flex flex-col items-center text-center"
            style={{ background: '#F9FAFB', border: '1px dashed #E5E7EB' }}
          >
            <Package size={24} style={{ color: '#D1D5DB' }} className="mb-2" />
            <p className="text-[13px] font-semibold text-gray-500 mb-1">Aucun colis en cours</p>
            <p className="text-[11px] text-gray-400 mb-4 max-w-[240px]">
              Informez-nous de votre commande avant qu'elle n'arrive à Paris
            </p>
            <button
              onClick={onNewColis}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-[13px] text-white active:scale-95 transition-all"
              style={{ background: BRAND.navy }}
            >
              <Plus size={14} strokeWidth={2.5} />
              Ajouter un colis
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

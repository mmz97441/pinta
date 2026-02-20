import React from 'react';
import { Package, AlertCircle, CreditCard, Plus, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP, PHASES_CLIENT, getPhaseIndex } from '../../constants';
import { eur } from '../../utils';
import { Badge, Etapes } from '../ui';

function ProgressBar({ statut }) {
  const idx = getPhaseIndex(statut);
  const total = PHASES_CLIENT.length - 1;
  const pct = Math.round((idx / total) * 100);
  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-gray-400 font-medium">
          {PHASES_CLIENT[idx]?.label}
        </span>
        <span className="text-[10px] font-bold" style={{ color: BRAND.navy }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${BRAND.navy}, ${BRAND.navyL})`,
          }}
        />
      </div>
    </div>
  );
}

export default function ClientAccueil({ onNewColis }) {
  const { authCl, data, clients } = useApp();

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

  const actionsRequises = myColis.filter(
    (p) => p.statut === 'attente_feu_vert' || p.statut === 'attente_paiement'
  );

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
        <div className="card p-3 text-center">
          <div className="text-2xl font-black" style={{ color: BRAND.navy }}>
            {enCours.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">En cours</div>
        </div>
        <div
          className="card p-3 text-center"
          style={aTraiter.length > 0 ? { borderLeft: `3px solid ${BRAND.gold}` } : {}}
        >
          <div
            className="text-2xl font-black"
            style={{ color: aTraiter.length > 0 ? BRAND.goldD : BRAND.navy }}
          >
            {aTraiter.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">À traiter</div>
        </div>
        <div
          className="card p-3 text-center"
          style={aPayer.length > 0 ? { borderLeft: `3px solid #f59e0b` } : {}}
        >
          <div
            className="text-2xl font-black"
            style={{ color: aPayer.length > 0 ? '#b45309' : BRAND.navy }}
          >
            {aPayer.length}
          </div>
          <div className="text-[11px] text-gray-500 font-medium mt-0.5">À payer</div>
        </div>
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
            {actionsRequises.map((p) => {
              const isFV = p.statut === 'attente_feu_vert';
              const isPay = p.statut === 'attente_paiement';
              return (
                <div
                  key={p.id}
                  className="card-elevated p-4 rounded-2xl"
                  style={{
                    borderLeft: `4px solid ${isFV ? BRAND.gold : '#f59e0b'}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{p.ref}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{p.desc}</p>
                    </div>
                    <Badge statut={p.statut} />
                  </div>
                  {isFV && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                      <CheckCircle size={13} />
                      Votre accord est attendu pour préparer ce colis
                    </div>
                  )}
                  {isPay && p.devisTotal != null && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                      <CreditCard size={13} />
                      Paiement requis : {eur(p.devisTotal)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Colis en cours ── */}
      {colisCours.length > 0 && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <Package size={15} style={{ color: BRAND.navy }} />
            <h3 className="font-bold text-sm text-gray-800">Colis en cours</h3>
          </div>
          <div className="space-y-2.5">
            {colisCours.map((p) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-gray-900">{p.ref}</p>
                    <p className="text-xs text-gray-500 truncate">{p.desc}</p>
                  </div>
                  <Badge statut={p.statut} />
                </div>
                <ProgressBar statut={p.statut} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dernière livraison ── */}
      {derniereLivraison && (
        <div className="anim-fade">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={15} className="text-emerald-500" />
            <h3 className="font-bold text-sm text-gray-800">Dernière livraison</h3>
          </div>
          <div
            className="card p-4 rounded-2xl"
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
          </div>
        </div>
      )}

      {/* ── Pré-annoncer (if no active colis) ── */}
      {enCours.length === 0 && (
        <div className="anim-fade-up">
          <button
            onClick={onNewColis}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-white text-sm active:scale-95 transition-all"
            style={{
              background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`,
              boxShadow: `0 4px 16px rgba(27,58,75,0.25)`,
            }}
          >
            <Plus size={18} strokeWidth={2.5} />
            Pré-annoncer un colis
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">
            Informez-nous de votre commande avant qu'elle n'arrive à Paris
          </p>
        </div>
      )}
    </div>
  );
}

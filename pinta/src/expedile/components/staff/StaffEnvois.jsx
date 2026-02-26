import React, { useState, useMemo } from 'react';
import {
  ArrowLeft, Plane, Printer, Package, User, Plus, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUT_ENVOI, getDestByCP, JOURS_SEMAINE } from '../../constants';
import { labelEnvoi, eur, uid } from '../../utils';
import { Badge } from '../ui';
import LabelPrint from './LabelPrint';

function EnvoiCard({ envoi, colisList, clients, onPrintAll, onPrintOne, onOpenColis, expanded, onToggle }) {
  const totalPoids = colisList.reduce((s, c) => {
    const p = c.finP || c.poids || 0;
    return s + p;
  }, 0);

  const byDest = {};
  colisList.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const d = getDestByCP(cl?.cp);
    byDest[d.code] = (byDest[d.code] || 0) + 1;
  });

  const statColor = {
    parti: '#16A34A',
    en_cours: '#0891B2',
    prochain: BRAND.navy,
    planifie: '#6B7280',
  }[envoi.statut] || BRAND.navy;

  return (
    <div className="card anim-fade" style={{ borderLeft: `4px solid ${statColor}` }}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${statColor}15` }}
          >
            <Plane size={17} style={{ color: statColor }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm" style={{ color: BRAND.navy }}>
                {labelEnvoi(envoi)}
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${statColor}15`, color: statColor }}
              >
                {STATUT_ENVOI[envoi.statut]}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-gray-500">
                {colisList.length} colis
              </span>
              <span className="text-xs text-gray-400">
                {totalPoids.toFixed(1)} kg
              </span>
              {Object.entries(byDest).map(([code, cnt]) => {
                const d = getDestByCP(code + '00');
                return (
                  <span key={code} className="text-xs text-gray-400">
                    {d.flag} {cnt}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {colisList.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onPrintAll(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: BRAND.navy }}
            >
              <Printer size={13} />
              Imprimer tout
            </button>
          )}
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* Colis list */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-2 space-y-2">
          {colisList.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-3 text-center">Aucun colis affecté</p>
          ) : (
            colisList.map((c) => {
              const cl = clients.find((x) => x.id === c.clientId);
              const dest = getDestByCP(cl?.cp);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group"
                >
                  <button
                    onClick={() => onOpenColis(c.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <Package size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: BRAND.navy }}>
                          {c.ref}
                        </span>
                        {c.casier && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}
                          >
                            {c.casier}
                          </span>
                        )}
                        <Badge statut={c.statut} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <User size={10} className="text-gray-400" />
                        <span className="text-xs text-gray-500 truncate">{cl?.nom || '—'}</span>
                        <span className="text-xs text-gray-400">{dest?.flag}</span>
                        {c.desc && <span className="text-xs text-gray-400 truncate">· {c.desc}</span>}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => onPrintOne(c)}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                    title="Imprimer l'étiquette"
                  >
                    <Printer size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function StaffEnvois() {
  const { setPage, setSelId, data, clients, envois, setEnvois, cutoff, flash } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const [printItems, setPrintItems] = useState(null);
  const [newEnvoiDate, setNewEnvoiDate] = useState('');

  // Group colis by envoi
  const envoiGroups = useMemo(() => {
    const sorted = [...envois].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((e) => ({
      envoi: e,
      colis: data.filter((c) => c.envoi === e.id && c.statut !== 'annule'),
    }));
  }, [envois, data]);

  // Colis not assigned to any envoi (payés or autorisés without envoi)
  const unassigned = useMemo(() => {
    return data.filter(
      (c) => !c.envoi && c.statut !== 'annule' && c.statut !== 'livre' &&
        ['autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye'].includes(c.statut)
    );
  }, [data]);

  // Auto-expand the "prochain" or "en_cours" envoi on mount
  useState(() => {
    const active = envois.find((e) => e.statut === 'prochain' || e.statut === 'en_cours');
    if (active) setExpandedId(active.id);
  });

  const buildPrintItems = (colisList) => {
    return colisList.map((c) => {
      const cl = clients.find((x) => x.id === c.clientId);
      const dest = getDestByCP(cl?.cp);
      const envoi = envois.find((e) => e.id === c.envoi);
      return { colis: c, client: cl, dest, envoi };
    });
  };

  const handlePrintAll = (envoiId) => {
    const colis = data.filter((c) => c.envoi === envoiId && c.statut !== 'annule');
    if (colis.length === 0) { flash('Aucun colis à imprimer'); return; }
    setPrintItems(buildPrintItems(colis));
  };

  const handlePrintOne = (colis) => {
    setPrintItems(buildPrintItems([colis]));
  };

  const cutoffLabel = `${JOURS_SEMAINE[cutoff.day]} ${cutoff.hour}h00`;

  // Next departure info
  const nextDep = envois.find((e) => e.statut === 'prochain' || e.statut === 'en_cours');
  const nextDepColis = nextDep ? data.filter((c) => c.envoi === nextDep.id && c.statut !== 'annule') : [];

  if (printItems) {
    return <LabelPrint items={printItems} onClose={() => setPrintItems(null)} />;
  }

  return (
    <div className="anim-fade space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl" style={{ backgroundColor: BRAND.navy + '10' }}>
            <Plane size={20} style={{ color: BRAND.navy }} />
          </div>
          <div>
            <p className="font-bold text-xl" style={{ color: BRAND.navy }}>Envois</p>
            <p className="text-xs text-gray-400">Cutoff : {cutoffLabel}</p>
          </div>
        </div>
        <button
          onClick={() => setPage('home')}
          className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
          style={{ color: BRAND.navy }}
        >
          <ArrowLeft size={16} />Retour
        </button>
      </div>

      {/* Next departure summary */}
      {nextDep && (
        <div
          className="card p-4"
          style={{ background: `linear-gradient(135deg, ${BRAND.navy}08, ${BRAND.gold}10)`, borderColor: `${BRAND.gold}30` }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Prochain vol</p>
              <p className="font-bold text-lg" style={{ color: BRAND.navy }}>
                {labelEnvoi(nextDep)}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {nextDepColis.length} colis · {nextDepColis.reduce((s, c) => s + (c.finP || c.poids || 0), 0).toFixed(1)} kg
              </p>
            </div>
            {nextDepColis.length > 0 && (
              <button
                onClick={() => handlePrintAll(nextDep.id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: BRAND.navy }}
              >
                <Printer size={15} />
                Imprimer les étiquettes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Unassigned colis warning */}
      {unassigned.length > 0 && (
        <div className="card p-4 border-l-4" style={{ borderLeftColor: '#F59E0B' }}>
          <p className="text-sm font-bold text-amber-700 mb-1">
            {unassigned.length} colis sans envoi affecté
          </p>
          <p className="text-xs text-gray-500">
            Ces colis sont en cours de traitement mais pas encore affectés à un vol.
          </p>
          <div className="mt-2 space-y-1">
            {unassigned.slice(0, 5).map((c) => {
              const cl = clients.find((x) => x.id === c.clientId);
              return (
                <button
                  key={c.id}
                  onClick={() => setSelId(c.id)}
                  className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900"
                >
                  <span className="font-bold">{c.ref}</span>
                  <span>{cl?.nom}</span>
                  <Badge statut={c.statut} />
                </button>
              );
            })}
            {unassigned.length > 5 && (
              <p className="text-xs text-gray-400">+ {unassigned.length - 5} autres</p>
            )}
          </div>
        </div>
      )}

      {/* Envoi cards */}
      {envoiGroups.filter((g) => g.envoi.statut !== 'parti').map((g) => (
        <EnvoiCard
          key={g.envoi.id}
          envoi={g.envoi}
          colisList={g.colis}
          clients={clients}
          expanded={expandedId === g.envoi.id}
          onToggle={() => setExpandedId(expandedId === g.envoi.id ? null : g.envoi.id)}
          onPrintAll={() => handlePrintAll(g.envoi.id)}
          onPrintOne={handlePrintOne}
          onOpenColis={(id) => setSelId(id)}
        />
      ))}

      {/* Past departures (collapsed) */}
      {envoiGroups.some((g) => g.envoi.statut === 'parti') && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors py-2">
            Vols passés ({envoiGroups.filter((g) => g.envoi.statut === 'parti').length})
          </summary>
          <div className="space-y-3 mt-2">
            {envoiGroups.filter((g) => g.envoi.statut === 'parti').map((g) => (
              <EnvoiCard
                key={g.envoi.id}
                envoi={g.envoi}
                colisList={g.colis}
                clients={clients}
                expanded={expandedId === g.envoi.id}
                onToggle={() => setExpandedId(expandedId === g.envoi.id ? null : g.envoi.id)}
                onPrintAll={() => handlePrintAll(g.envoi.id)}
                onPrintOne={handlePrintOne}
                onOpenColis={(id) => setSelId(id)}
              />
            ))}
          </div>
        </details>
      )}

      {/* Add new departure */}
      <div className="card p-4">
        <p className="text-sm font-bold text-gray-700 mb-2">Ajouter un départ</p>
        <div className="flex gap-2">
          <input
            type="date"
            value={newEnvoiDate}
            onChange={(e) => setNewEnvoiDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 text-sm"
          />
          <button
            onClick={() => {
              if (!newEnvoiDate) { flash('Choisissez une date'); return; }
              const d = new Date(newEnvoiDate + 'T00:00:00');
              if (d.getDay() !== 5) flash('Les départs sont normalement le vendredi. Ajouté quand même.');
              if (envois.find((e) => e.date === newEnvoiDate)) { flash('Ce départ existe déjà'); return; }
              setEnvois((p) => [...p, { id: uid(), date: newEnvoiDate, statut: 'planifie' }].sort((a, b) => a.date.localeCompare(b.date)));
              setNewEnvoiDate('');
              flash('Départ ajouté');
            }}
            style={{ backgroundColor: BRAND.navy }}
            className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all"
          >
            <Plus size={14} />
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

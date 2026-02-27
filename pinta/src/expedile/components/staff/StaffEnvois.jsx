import React, { useState, useMemo } from 'react';
import {
  ArrowLeft, Plane, Printer, Package, User, Plus, ChevronDown, ChevronUp,
  FileText, CheckCircle, AlertTriangle, Eye, Download, Compass,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUT_ENVOI, getDestByCP, JOURS_SEMAINE, getSecteur, SECTEURS } from '../../constants';
import { labelEnvoi, eur, uid } from '../../utils';
import { Badge } from '../ui';
import LabelPrint from './LabelPrint';

// ── Invoice viewer overlay ──────────────────────────────────────────────────
function InvoiceViewer({ facture, onClose }) {
  if (!facture) return null;
  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[80vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-bold text-sm" style={{ color: BRAND.navy }}>{facture.vendeur}</p>
            <p className="text-xs text-gray-500">{eur(facture.montant)}</p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Fermer
          </button>
        </div>
        {facture.fichier ? (
          <img
            src={facture.fichier}
            alt={facture.fichierNom || 'Facture'}
            className="w-full rounded-lg border"
          />
        ) : (
          <div className="py-8 text-center text-gray-400 text-sm">Aucun fichier joint</div>
        )}
      </div>
    </div>
  );
}

// ── Preparation view for a single envoi ──────────────────────────────────────
function EnvoiPreparation({ colisList, clients, onOpenColis, onViewInvoice }) {
  // Group by destination
  const byDest = {};
  colisList.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const d = getDestByCP(cl?.cp);
    const key = d.code;
    if (!byDest[key]) byDest[key] = { dest: d, items: [] };
    byDest[key].items.push({ colis: c, client: cl });
  });

  const totalFactures = colisList.reduce((s, c) => s + (c.factures?.length || 0), 0);
  const facturesValides = colisList.reduce((s, c) => s + (c.factures?.filter((f) => f.valide).length || 0), 0);
  const totalMontant = colisList.reduce((s, c) => s + (c.factures?.reduce((fs, f) => fs + (f.montant || 0), 0) || 0), 0);
  const totalPoids = colisList.reduce((s, c) => s + (c.finP || c.poids || 0), 0);

  return (
    <div className="border-t px-4 pb-4 pt-3 space-y-3">
      {/* Summary bar */}
      <div
        className="grid grid-cols-4 gap-2 rounded-lg overflow-hidden text-center py-2"
        style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}
      >
        <div>
          <p className="text-lg font-black" style={{ color: BRAND.navy }}>{colisList.length}</p>
          <p className="text-[10px] text-gray-400 font-semibold">Colis</p>
        </div>
        <div>
          <p className="text-lg font-black" style={{ color: BRAND.navy }}>{totalPoids.toFixed(1)}</p>
          <p className="text-[10px] text-gray-400 font-semibold">kg</p>
        </div>
        <div>
          <p className="text-lg font-black" style={{ color: facturesValides === totalFactures ? '#059669' : '#D97706' }}>
            {facturesValides}/{totalFactures}
          </p>
          <p className="text-[10px] text-gray-400 font-semibold">Factures OK</p>
        </div>
        <div>
          <p className="text-lg font-black" style={{ color: BRAND.navy }}>{eur(totalMontant)}</p>
          <p className="text-[10px] text-gray-400 font-semibold">Valeur</p>
        </div>
      </div>

      {/* Alert if some invoices not validated */}
      {facturesValides < totalFactures && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
          <span className="text-[12px] font-semibold text-amber-700">
            {totalFactures - facturesValides} facture{totalFactures - facturesValides > 1 ? 's' : ''} non validée{totalFactures - facturesValides > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Colis table with invoices */}
      <div className="space-y-2">
        {Object.values(byDest).map(({ dest, items }) => (
          <div key={dest.code}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-sm">{dest.flag}</span>
              <span className="text-[12px] font-bold text-gray-700">{dest.nom}</span>
              <span className="text-[10px] text-gray-400 font-semibold ml-1">{items.length} colis</span>
            </div>
            {items.map(({ colis: c, client: cl }) => {
              const secteur = getSecteur(cl?.cp);
              const facturesOk = c.factures?.every((f) => f.valide) ?? true;
              return (
                <div
                  key={c.id}
                  className="rounded-lg mb-1.5 overflow-hidden"
                  style={{ background: 'white', border: '1px solid #E5E7EB' }}
                >
                  {/* Colis row */}
                  <button
                    onClick={() => onOpenColis(c.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    {secteur && (
                      <span
                        className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[11px] font-black text-white"
                        style={{ background: secteur.color }}
                      >
                        {secteur.lettre}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold" style={{ color: BRAND.navy }}>{c.ref}</span>
                        {c.casier && (
                          <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: `${BRAND.gold}20`, color: BRAND.goldD }}>
                            {c.casier}
                          </span>
                        )}
                        <Badge statut={c.statut} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-600 font-medium truncate">{cl?.nom || '—'}</span>
                        <span className="text-[11px] text-gray-400 truncate">{cl?.ville}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{(c.finP || c.poids || 0).toFixed(1)} kg</span>
                      </div>
                    </div>
                    {!facturesOk && <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />}
                  </button>

                  {/* Invoices for this colis */}
                  {c.factures && c.factures.length > 0 && (
                    <div className="border-t px-3 py-2 space-y-1" style={{ background: '#FAFAFA' }}>
                      {c.factures.map((f) => (
                        <div key={f.id} className="flex items-center gap-2">
                          <FileText size={11} className={f.valide ? 'text-emerald-500' : 'text-amber-500'} />
                          <span className="text-[11px] font-medium text-gray-700 flex-1 truncate">
                            {f.vendeur}
                          </span>
                          <span className="text-[11px] font-bold text-gray-600">
                            {eur(f.montant)}
                          </span>
                          {f.valide ? (
                            <CheckCircle size={11} className="text-emerald-500 flex-shrink-0" />
                          ) : (
                            <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
                          )}
                          {f.fichier && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onViewInvoice(f); }}
                              className="p-1 rounded hover:bg-gray-200 transition-colors"
                              title="Voir la facture"
                            >
                              <Eye size={11} className="text-gray-400" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(!c.factures || c.factures.length === 0) && (
                    <div className="border-t px-3 py-2" style={{ background: '#FAFAFA' }}>
                      <span className="text-[11px] text-gray-400 italic">Aucune facture</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Envoi card (enhanced with preparation view) ──────────────────────────────
function EnvoiCard({ envoi, colisList, clients, onPrintAll, onPrintOne, onOpenColis, expanded, onToggle, onViewInvoice }) {
  const [viewMode, setViewMode] = useState('preparation'); // 'list' | 'preparation'

  const totalPoids = colisList.reduce((s, c) => s + (c.finP || c.poids || 0), 0);

  const byDest = {};
  colisList.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const d = getDestByCP(cl?.cp);
    byDest[d.code] = (byDest[d.code] || 0) + 1;
  });

  // Count sectors
  const bySecteur = {};
  colisList.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const s = getSecteur(cl?.cp);
    if (s) {
      bySecteur[s.lettre] = (bySecteur[s.lettre] || 0) + 1;
    }
  });

  const statColor = {
    parti: '#16A34A',
    en_cours: '#0891B2',
    prochain: BRAND.navy,
    planifie: '#6B7280',
  }[envoi.statut] || BRAND.navy;

  return (
    <div
      className="rounded-xl overflow-hidden anim-fade"
      style={{ background: 'white', border: '1px solid #E5E7EB', borderLeft: `3px solid ${statColor}` }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${statColor}12` }}
          >
            <Plane size={15} style={{ color: statColor }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[13px]" style={{ color: BRAND.navy }}>
                {labelEnvoi(envoi)}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                style={{ background: `${statColor}12`, color: statColor }}
              >
                {STATUT_ENVOI[envoi.statut]}
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-0.5">
              <span className="text-[11px] text-gray-500">{colisList.length} colis</span>
              <span className="text-[11px] text-gray-400">{totalPoids.toFixed(1)} kg</span>
              {Object.entries(byDest).map(([code, cnt]) => {
                const d = getDestByCP(code + '00');
                return (
                  <span key={code} className="text-[11px] text-gray-400">{d.flag} {cnt}</span>
                );
              })}
              {/* Sector badges */}
              {Object.entries(bySecteur).map(([lettre, cnt]) => {
                const s = SECTEURS[lettre];
                return (
                  <span
                    key={lettre}
                    className="text-[9px] font-bold px-1 py-0.5 rounded"
                    style={{ background: s.bg, color: s.color }}
                  >
                    {lettre} {cnt}
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: BRAND.navy }}
            >
              <Printer size={12} />
              Étiquettes
            </button>
          )}
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <>
          {/* View mode tabs */}
          <div className="flex gap-1 mx-3.5 mb-0 bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setViewMode('preparation')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-bold transition-all ${
                viewMode === 'preparation' ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
              style={viewMode === 'preparation' ? { color: BRAND.navy } : {}}
            >
              <FileText size={11} />
              Préparation & Factures
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-bold transition-all ${
                viewMode === 'list' ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
              style={viewMode === 'list' ? { color: BRAND.navy } : {}}
            >
              <Package size={11} />
              Liste colis
            </button>
          </div>

          {viewMode === 'preparation' ? (
            <EnvoiPreparation
              colisList={colisList}
              clients={clients}
              onOpenColis={onOpenColis}
              onViewInvoice={onViewInvoice}
            />
          ) : (
            /* Simple colis list */
            <div className="border-t mx-0 px-3.5 pb-3.5 pt-2 space-y-1.5">
              {colisList.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic py-3 text-center">Aucun colis affecté</p>
              ) : (
                colisList.map((c) => {
                  const cl = clients.find((x) => x.id === c.clientId);
                  const dest = getDestByCP(cl?.cp);
                  const secteur = getSecteur(cl?.cp);
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg group transition-colors"
                      style={{ background: '#FAFAFA' }}
                    >
                      <button
                        onClick={() => onOpenColis(c.id)}
                        className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                      >
                        {secteur && (
                          <span
                            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-black text-white"
                            style={{ background: secteur.color }}
                          >
                            {secteur.lettre}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold" style={{ color: BRAND.navy }}>{c.ref}</span>
                            {c.casier && (
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: `${BRAND.gold}20`, color: BRAND.goldD }}>
                                {c.casier}
                              </span>
                            )}
                            <Badge statut={c.statut} />
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-gray-500 truncate">{cl?.nom || '—'}</span>
                            <span className="text-[10px] text-gray-400">{dest?.flag}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => onPrintOne(c)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                        title="Imprimer l'étiquette"
                      >
                        <Printer size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function StaffEnvois() {
  const { setPage, setSelId, data, clients, envois, setEnvois, cutoff, flash } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const [printItems, setPrintItems] = useState(null);
  const [newEnvoiDate, setNewEnvoiDate] = useState('');
  const [viewingInvoice, setViewingInvoice] = useState(null);

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
      {viewingInvoice && (
        <InvoiceViewer facture={viewingInvoice} onClose={() => setViewingInvoice(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plane size={18} style={{ color: BRAND.navy }} />
          <div>
            <p className="font-bold text-lg" style={{ color: BRAND.navy }}>Envois</p>
            <p className="text-[11px] text-gray-400">Cutoff : {cutoffLabel}</p>
          </div>
        </div>
        <button
          onClick={() => setPage('home')}
          className="flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          style={{ color: BRAND.navy }}
        >
          <ArrowLeft size={14} />Retour
        </button>
      </div>

      {/* Next departure summary */}
      {nextDep && (
        <div
          className="rounded-xl p-3.5"
          style={{ background: 'white', border: '1px solid #E5E7EB' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Prochain vol</p>
              <p className="font-bold text-base" style={{ color: BRAND.navy }}>
                {labelEnvoi(nextDep)}
              </p>
              <p className="text-[12px] text-gray-500 mt-0.5">
                {nextDepColis.length} colis · {nextDepColis.reduce((s, c) => s + (c.finP || c.poids || 0), 0).toFixed(1)} kg
              </p>
            </div>
            {nextDepColis.length > 0 && (
              <button
                onClick={() => handlePrintAll(nextDep.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: BRAND.navy }}
              >
                <Printer size={13} />
                Imprimer les étiquettes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Unassigned colis warning */}
      {unassigned.length > 0 && (
        <div
          className="rounded-xl p-3.5"
          style={{ background: 'white', border: '1px solid #E5E7EB', borderLeft: '3px solid #F59E0B' }}
        >
          <p className="text-[13px] font-bold text-amber-700 mb-1">
            {unassigned.length} colis sans envoi affecté
          </p>
          <p className="text-[11px] text-gray-500 mb-2">
            En cours de traitement mais pas encore affectés à un vol.
          </p>
          <div className="space-y-1">
            {unassigned.slice(0, 5).map((c) => {
              const cl = clients.find((x) => x.id === c.clientId);
              return (
                <button
                  key={c.id}
                  onClick={() => setSelId(c.id)}
                  className="flex items-center gap-2 text-[11px] text-gray-600 hover:text-gray-900"
                >
                  <span className="font-bold">{c.ref}</span>
                  <span>{cl?.nom}</span>
                  <Badge statut={c.statut} />
                </button>
              );
            })}
            {unassigned.length > 5 && (
              <p className="text-[11px] text-gray-400">+ {unassigned.length - 5} autres</p>
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
          onViewInvoice={setViewingInvoice}
        />
      ))}

      {/* Past departures (collapsed) */}
      {envoiGroups.some((g) => g.envoi.statut === 'parti') && (
        <details className="group">
          <summary className="cursor-pointer text-[12px] font-bold text-gray-400 hover:text-gray-600 transition-colors py-2">
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
                onViewInvoice={setViewingInvoice}
              />
            ))}
          </div>
        </details>
      )}

      {/* Add new departure */}
      <div
        className="rounded-xl p-3.5"
        style={{ background: 'white', border: '1px solid #E5E7EB' }}
      >
        <p className="text-[13px] font-bold text-gray-700 mb-2">Ajouter un départ</p>
        <div className="flex gap-2">
          <input
            type="date"
            value={newEnvoiDate}
            onChange={(e) => setNewEnvoiDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-[13px] outline-none"
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
            className="flex items-center gap-1.5 px-3.5 py-2 text-white rounded-lg text-[13px] font-bold hover:opacity-90 active:scale-95 transition-all"
          >
            <Plus size={13} />
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

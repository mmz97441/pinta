import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Plus, Search, ChevronDown, Check, X, AlertTriangle, FileSpreadsheet, Upload, Loader2, Crown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { searchClients, eur } from '../../utils';
import { parseClientFile, detectDuplicates } from '../../utils/importClients';

// ── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ nom, size = 10 }) {
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex-shrink-0 flex items-center justify-center text-sm font-black`}
      style={{
        background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
        color: BRAND.goldL,
      }}
    >
      {(nom || '?').charAt(0).toUpperCase()}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffClients() {
  const navigate = useNavigate();
  const { clients, data, addNewClient, flash, can } = useApp();

  const [clPageSearch, setClPageSearch] = useState('');
  const [clViewMode, setClViewMode] = useState('list'); // 'cards' | 'list'
  const [clSortCol, setClSortCol] = useState('nom');
  const [clSortDir, setClSortDir] = useState('asc');

  // ── Import state ──
  const [importModal, setImportModal] = useState(false);
  const [importData, setImportData] = useState(null); // { clients, headers, unmapped, errors, total, duplicates }
  const [importStep, setImportStep] = useState('upload'); // 'upload' | 'preview' | 'importing' | 'done'
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, created: 0, skipped: 0, errors: [] });
  const [importSkipDuplicates, setImportSkipDuplicates] = useState(true);
  const importFileRef = useRef(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = searchClients(clients, clPageSearch);
  const tgCount = clients.filter((c) => c.canal === 'telegram').length;
  const proCount = clients.filter((c) => c.type === 'pro').length;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function clientColis(clientId) {
    return data.filter((p) => p.clientId === clientId && p.statut !== 'annule');
  }

  function clientActifs(clientId) {
    return data.filter(
      (p) =>
        p.clientId === clientId &&
        !['livre', 'annule'].includes(p.statut),
    );
  }

  function clientCA(clientId) {
    return data
      .filter((p) => p.clientId === clientId && p.paiementMontant)
      .reduce((sum, p) => sum + (p.paiementMontant || 0), 0);
  }

  // ── Import handlers ──────────────────────────────────────────────────────
  async function handleImportFile(file) {
    if (!file) return;
    setImportStep('preview');
    try {
      const result = await parseClientFile(file);
      const withDups = detectDuplicates(result.clients, clients);
      setImportData({
        ...result,
        duplicates: withDups,
      });
    } catch (err) {
      flash({ msg: 'Erreur de lecture du fichier : ' + err.message, type: 'warning' });
      setImportStep('upload');
    }
  }

  async function handleImportConfirm() {
    if (!importData) return;
    const toImport = importData.duplicates.filter((d) => !(importSkipDuplicates && d.duplicate));
    setImportStep('importing');
    setImportProgress({ done: 0, total: toImport.length, created: 0, skipped: 0, errors: [] });

    let created = 0;
    let errors = [];
    for (let i = 0; i < toImport.length; i++) {
      const { client: cl } = toImport[i];
      try {
        await addNewClient({
          nom: cl.nom, prenom: cl.prenom, genre: cl.genre,
          dateNaissance: cl.dateNaissance || null,
          tel: cl.tel, telFixe: cl.telFixe, email: cl.email,
          ville: cl.ville, cp: cl.cp,
          adresseLigne1: cl.adresseLigne1, adresseLigne2: cl.adresseLigne2,
          commune: cl.commune, infosLivraison: cl.infosLivraison,
          telegramUsername: cl.telegramUsername, canal: cl.canal || 'telegram',
          type: cl.type, modePaiement: cl.modePaiement,
          abonnement: cl.abonnement,
          abonnementDebut: cl.abonnementDebut || null,
          abonnementFin: cl.abonnementFin || null,
          raisonSociale: cl.raisonSociale, siret: cl.siret, interlocuteur: cl.interlocuteur,
          notes: cl.notes,
          points: 0,
        });
        created++;
      } catch (err) {
        errors.push(`${cl.nom} ${cl.prenom} : ${err.message}`);
      }
      setImportProgress({ done: i + 1, total: toImport.length, created, skipped: importData.duplicates.length - toImport.length, errors });
    }

    setImportStep('done');
    setImportProgress((p) => ({ ...p, done: toImport.length, created, errors }));
  }

  function handleImportClose() {
    setImportModal(false);
    setImportData(null);
    setImportStep('upload');
    setImportProgress({ done: 0, total: 0, created: 0, skipped: 0, errors: [] });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="anim-fade flex flex-col gap-4 pb-24">

      {/* ── Modal Import Clients ────────────────────────────────────────── */}
      {importModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleImportClose}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col" onClick={(ev) => ev.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: BRAND.navy + '10' }}>
                  <Upload size={20} style={{ color: BRAND.navy }} />
                </div>
                <div>
                  <h2 className="font-bold text-base" style={{ color: BRAND.navy }}>Importer des clients</h2>
                  <p className="text-xs text-gray-400">CSV, Excel (.xlsx, .xls)</p>
                </div>
              </div>
              <button onClick={handleImportClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Step 1: Upload */}
              {importStep === 'upload' && (
                <div className="space-y-4">
                  <label
                    className="flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 hover:border-blue-400 transition-all"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                  >
                    <FileSpreadsheet size={40} className="text-gray-300" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-gray-600">Glissez un fichier ici ou cliquez pour sélectionner</p>
                      <p className="text-xs text-gray-400 mt-1">Formats acceptés : .xlsx, .xls, .csv</p>
                    </div>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
                    />
                  </label>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-bold text-blue-800">Colonnes reconnues automatiquement :</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['Référence', 'Type de client', 'Raison Sociale', 'Civilité', 'Nom de famille', 'Prénom', 'Forfait', 'Date Fin Abonnement', 'Paiements', 'Téléphone Mobile', 'Email', 'Commune', 'Code postal', 'Ville', 'Adresse', 'SIRET', 'Telegram', 'Notes'].map((c) => (
                        <span key={c} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{c}</span>
                      ))}
                    </div>
                    <p className="text-[10px] text-blue-600 mt-1">Les noms de colonnes sont reconnus même avec des variations (accents, majuscules, tirets).</p>
                  </div>
                </div>
              )}

              {/* Step 2: Preview */}
              {importStep === 'preview' && importData && (
                <div className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-green-700">{importData.clients.length}</p>
                      <p className="text-[10px] font-bold text-green-600">Clients trouvés</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-amber-700">{importData.duplicates.filter((d) => d.duplicate).length}</p>
                      <p className="text-[10px] font-bold text-amber-600">Doublons détectés</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-blue-700">{importData.headers.filter((h) => h.mapped).length}</p>
                      <p className="text-[10px] font-bold text-blue-600">Colonnes mappées</p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-red-600">{importData.errors.length}</p>
                      <p className="text-[10px] font-bold text-red-500">Erreurs</p>
                    </div>
                  </div>

                  {/* Mapping */}
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Mapping des colonnes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {importData.headers.map((h) => (
                        <span key={h.raw} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${h.mapped ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
                          {h.raw} {h.mapped ? `→ ${h.mapped}` : '(ignoré)'}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Errors */}
                  {importData.errors.length > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-bold text-red-700 mb-1">Lignes ignorées :</p>
                      <ul className="text-[10px] text-red-600 space-y-0.5 max-h-20 overflow-y-auto">
                        {importData.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Duplicate handling */}
                  {importData.duplicates.some((d) => d.duplicate) && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-amber-700">Doublons (email, téléphone ou nom+CP identique)</p>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={importSkipDuplicates} onChange={() => setImportSkipDuplicates((p) => !p)} className="accent-amber-600" />
                          <span className="text-xs font-bold text-amber-700">Ignorer les doublons</span>
                        </label>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {importData.duplicates.filter((d) => d.duplicate).map((d, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1">
                            <AlertTriangle size={10} />
                            <span className="font-bold">{d.client.prenom} {d.client.nom}</span>
                            <span className="text-amber-600">= {d.duplicate.prenom || ''} {d.duplicate.nomFamille || d.duplicate.nom || ''} (existant)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preview table */}
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider p-3 bg-gray-50 border-b">
                      Aperçu ({Math.min(importData.clients.length, 10)} sur {importData.clients.length})
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Nom</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Prénom</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Type</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Forfait</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Tél</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Email</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">CP</th>
                            <th className="px-2 py-1.5 text-left font-bold text-gray-500">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importData.duplicates.slice(0, 10).map((d, i) => {
                            const c = d.client;
                            const isDup = !!d.duplicate;
                            return (
                              <tr key={i} className={`border-b ${isDup ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                                <td className="px-2 py-1.5 font-bold">{c.nom}</td>
                                <td className="px-2 py-1.5">{c.prenom}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${c.type === 'pro' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {c.type === 'pro' ? 'PRO' : 'Particulier'}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5">{ABONNEMENTS[c.abonnement]?.label || c.abonnement}</td>
                                <td className="px-2 py-1.5 font-mono">{c.tel}</td>
                                <td className="px-2 py-1.5 truncate max-w-[120px]">{c.email}</td>
                                <td className="px-2 py-1.5 font-mono">{c.cp}</td>
                                <td className="px-2 py-1.5">
                                  {isDup ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">Doublon</span>
                                  ) : (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Nouveau</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {importData.clients.length > 10 && (
                      <p className="text-[10px] text-gray-400 text-center py-2 border-t">
                        ... et {importData.clients.length - 10} autres
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Importing */}
              {importStep === 'importing' && (
                <div className="flex flex-col items-center justify-center py-10 space-y-4">
                  <Loader2 size={40} className="animate-spin text-blue-500" />
                  <div className="text-center">
                    <p className="text-lg font-bold" style={{ color: BRAND.navy }}>Import en cours...</p>
                    <p className="text-sm text-gray-500">{importProgress.done} / {importProgress.total} clients</p>
                  </div>
                  <div className="w-64 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%`, background: BRAND.navy }}
                    />
                  </div>
                </div>
              )}

              {/* Step 4: Done */}
              {importStep === 'done' && (
                <div className="flex flex-col items-center justify-center py-10 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <Check size={32} className="text-green-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold" style={{ color: BRAND.navy }}>Import terminé</p>
                    <p className="text-sm text-gray-500 mt-1">{importProgress.created} client{importProgress.created > 1 ? 's' : ''} créé{importProgress.created > 1 ? 's' : ''}</p>
                    {importProgress.skipped > 0 && (
                      <p className="text-xs text-amber-600">{importProgress.skipped} doublon{importProgress.skipped > 1 ? 's' : ''} ignoré{importProgress.skipped > 1 ? 's' : ''}</p>
                    )}
                  </div>
                  {importProgress.errors.length > 0 && (
                    <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-bold text-red-700 mb-1">Erreurs :</p>
                      <ul className="text-[10px] text-red-600 space-y-0.5">
                        {importProgress.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-5 border-t bg-gray-50 rounded-b-2xl">
              {importStep === 'preview' && (
                <button
                  onClick={() => { setImportStep('upload'); setImportData(null); if (importFileRef.current) importFileRef.current.value = ''; }}
                  className="text-sm font-bold text-gray-500 hover:text-gray-700"
                >
                  Changer de fichier
                </button>
              )}
              {importStep !== 'preview' && <div />}

              <div className="flex gap-2">
                <button
                  onClick={handleImportClose}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  {importStep === 'done' ? 'Fermer' : 'Annuler'}
                </button>
                {importStep === 'preview' && importData && (
                  <button
                    onClick={handleImportConfirm}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                    style={{ background: BRAND.navy }}
                  >
                    Importer {importData.duplicates.filter((d) => !(importSkipDuplicates && d.duplicate)).length} client{importData.duplicates.filter((d) => !(importSkipDuplicates && d.duplicate)).length > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
            style={{ color: BRAND.navy }}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <h1
              className="text-xl font-black tracking-tight leading-none"
              style={{ color: BRAND.navy, letterSpacing: '-0.025em' }}
            >
              Clients
            </h1>
            <span
              className="text-xs font-black px-2 py-0.5 rounded-full"
              style={{ background: `${BRAND.navy}15`, color: BRAND.navy }}
            >
              {clients.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {can('perm_clients_creer') && (
            <>
              <button
                onClick={() => { setImportModal(true); setImportStep('upload'); setImportData(null); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 hover:bg-gray-50"
                style={{ borderColor: BRAND.navy + '30', color: BRAND.navy }}
              >
                <Upload size={14} />
                Importer
              </button>
              <button
                onClick={() => navigate('/clients/new')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                  color: BRAND.navyD,
                  boxShadow: `0 2px 12px ${BRAND.gold}40`,
                }}
              >
                <Plus size={14} strokeWidth={2.5} />
                Nouveau client
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          value={clPageSearch}
          onChange={(e) => setClPageSearch(e.target.value)}
          placeholder="Rechercher par nom, ville, email, tél…"
          className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-gray-200 bg-white outline-none transition-all"
          style={{ color: BRAND.navy }}
        />
        {clPageSearch && (
          <button
            onClick={() => setClPageSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 flex flex-col items-center">
          <span className="text-2xl font-black leading-none" style={{ color: BRAND.navy }}>
            {clients.length}
          </span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Total</span>
        </div>
        <div className="card p-3 flex flex-col items-center">
          <span className="text-2xl font-black leading-none text-blue-600">{tgCount}</span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Telegram</span>
        </div>
        <div className="card p-3 flex flex-col items-center">
          <span className="text-2xl font-black leading-none" style={{ color: BRAND.goldD }}>
            {proCount}
          </span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Pro</span>
        </div>
      </div>

      {/* ── View toggle ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{filtered.length} clients</span>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setClViewMode('list')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${clViewMode === 'list' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>
            Liste
          </button>
          <button onClick={() => setClViewMode('cards')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${clViewMode === 'cards' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>
            Cartes
          </button>
        </div>
      </div>

      {/* ── Client list ─────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="card p-8 flex flex-col items-center text-center">
          <Users size={28} className="text-gray-200 mb-2" />
          <p className="text-sm font-semibold text-gray-500">Aucun client trouvé</p>
          <p className="text-xs text-gray-400 mt-0.5">Modifiez votre recherche ou ajoutez un nouveau client</p>
        </div>
      )}

      {/* ── Table view ─────────────────────────────────────────────────── */}
      {clViewMode === 'list' && filtered.length > 0 && (() => {
        const sortedClients = [...filtered].sort((a, b) => {
          const dir = clSortDir === 'asc' ? 1 : -1;
          switch (clSortCol) {
            case 'nom': return dir * (a.nom || '').localeCompare(b.nom || '', 'fr');
            case 'prenom': return dir * (a.prenom || '').localeCompare(b.prenom || '', 'fr');
            case 'ville': return dir * (a.ville || '').localeCompare(b.ville || '', 'fr');
            case 'type': return dir * (a.type || '').localeCompare(b.type || '', 'fr');
            case 'abonnement': return dir * (a.abonnement || '').localeCompare(b.abonnement || '', 'fr');
            case 'colis': return dir * (clientColis(a.id).length - clientColis(b.id).length);
            case 'ca': return dir * (clientCA(a.id) - clientCA(b.id));
            default: return 0;
          }
        });
        const handleClSort = (col) => {
          if (clSortCol === col) setClSortDir((d) => d === 'asc' ? 'desc' : 'asc');
          else { setClSortCol(col); setClSortDir('asc'); }
        };
        const si = (col) => clSortCol === col ? (clSortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
        const TH = 'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap';
        return (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200" style={{ background: `${BRAND.navy}06` }}>
                    <th className={TH} onClick={() => handleClSort('nom')}>Nom{si('nom')}</th>
                    <th className={TH} onClick={() => handleClSort('prenom')}>Prénom{si('prenom')}</th>
                    <th className={TH} onClick={() => handleClSort('type')}>Type{si('type')}</th>
                    <th className={TH} onClick={() => handleClSort('abonnement')}>Forfait{si('abonnement')}</th>
                    <th className={TH} onClick={() => handleClSort('ville')}>Ville{si('ville')}</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Tél.</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Email</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Telegram</th>
                    <th className={TH} onClick={() => handleClSort('colis')}>Colis{si('colis')}</th>
                    <th className={`${TH} text-right`} onClick={() => handleClSort('ca')}>CA{si('ca')}</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClients.map((cl) => {
                    const dest = getDestByCP(cl.cp);
                    const colis = clientColis(cl.id);
                    const ca = clientCA(cl.id);
                    const abo = ABONNEMENTS[cl.abonnement];
                    return (
                      <tr key={cl.id} onClick={() => navigate('/clients/' + cl.id)}
                        className="border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-bold text-gray-800">{cl.nomFamille || cl.nom}</span>
                          {dest && <span className="ml-1 text-xs">{dest.flag}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600">{cl.prenom || '—'}</td>
                        <td className="px-3 py-2.5">
                          {cl.type === 'pro' ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${BRAND.gold}30`, color: BRAND.goldD }}>PRO</span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">Part.</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${abo?.couleur || 'bg-gray-100 text-gray-500'}`}>
                            {abo?.label || cl.abonnement}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">{cl.ville || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] text-gray-500 font-mono">{cl.tel || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] text-gray-500 truncate max-w-[140px]">{cl.email || '—'}</td>
                        <td className="px-3 py-2.5">
                          {cl.telegramChatId ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Lié</span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-500">Non lié</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-gray-700">{colis.length}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold" style={{ color: ca > 0 ? BRAND.navy : '#9CA3AF' }}>{ca > 0 ? eur(ca) : '—'}</td>
                        <td className="pr-2 py-2.5"><ChevronDown size={12} className="text-gray-300" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Cards view ─────────────────────────────────────────────────── */}
      {clViewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((cl) => {
            const colis = clientColis(cl.id);
            const actifs = clientActifs(cl.id);
            const ca = clientCA(cl.id);
            const dest = getDestByCP(cl.cp);

            return (
              <div key={cl.id} className="card overflow-hidden">
                <button
                  onClick={() => navigate('/clients/' + cl.id)}
                  className="w-full text-left p-4 flex items-center gap-3"
                >
                  <Avatar nom={cl.nom} size={10} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {cl.ref && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{cl.ref}</span>}
                      <span className="text-sm font-black truncate" style={{ color: BRAND.navy }}>
                        {cl.nom || <span className="italic text-gray-400">Sans nom</span>}
                      </span>
                      {cl.abonnement === 'vip' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
                          style={{ background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: 'white' }}>
                          <Crown size={10} strokeWidth={2.5} /> VIP
                        </span>
                      ) : cl.type === 'pro' ? (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase"
                          style={{ background: `${BRAND.gold}30`, color: BRAND.goldD }}>
                          PRO
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                          Particulier
                        </span>
                      )}
                      {cl.abonnement && cl.abonnement !== 'freemium' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ABONNEMENTS[cl.abonnement]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                          {ABONNEMENTS[cl.abonnement]?.label || cl.abonnement}
                        </span>
                      )}
                      {cl.type === 'pro' && cl.modePaiement && cl.modePaiement !== 'colis' && (
                        <span className="text-[9px] font-semibold text-indigo-500">
                          {cl.modePaiement === '30j' ? '30 jours' : cl.modePaiement === 'fin_mois' ? 'Fin de mois' : cl.modePaiement === 'compte' ? 'En compte' : ''}
                        </span>
                      )}
                      {cl.canal === 'telegram' && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Telegram" />
                      )}
                      {cl.telegramChatId ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Telegram lie</span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Telegram non lie</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs">{dest.flag}</span>
                      {cl.ville && <span className="text-xs text-gray-500">{cl.ville}</span>}
                      {cl.tel && <span className="text-xs text-gray-400 font-mono">{cl.tel}</span>}
                      {cl.email && <span className="text-xs text-gray-400 truncate max-w-[140px]">{cl.email}</span>}
                    </div>
                    {cl.abonnement && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ABONNEMENTS[cl.abonnement]?.couleur || 'bg-gray-200 text-gray-600'}`}>
                          {ABONNEMENTS[cl.abonnement]?.label || cl.abonnement}
                        </span>
                        {cl.abonnementFin && (
                          <span className={`text-[10px] font-semibold ${
                            new Date(cl.abonnementFin) < new Date() ? 'text-red-600' :
                            new Date(cl.abonnementFin) < new Date(Date.now() + 30*86400000) ? 'text-orange-600' :
                            'text-green-600'
                          }`}>
                            {new Date(cl.abonnementFin) < new Date() ? 'Expiré' : `Fin: ${new Date(cl.abonnementFin).toLocaleDateString('fr-FR')}`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">{colis.length} colis</span>
                      {actifs.length > 0 && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${BRAND.navy}12`, color: BRAND.navy }}
                        >
                          {actifs.length} actifs
                        </span>
                      )}
                    </div>
                    {ca > 0 && (
                      <span className="text-xs font-bold text-emerald-600">{ca.toFixed(2)} €</span>
                    )}
                  </div>

                  <ChevronDown
                    size={15}
                    className="flex-shrink-0 text-gray-400"
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

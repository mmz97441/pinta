import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Users, Plus, Search, ChevronDown, Check, X, AlertTriangle, ExternalLink, Send, Download, FileSpreadsheet, Upload, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { uid, telegramLink, searchClients, eur } from '../../utils';
import { Badge } from '../ui';
import { exportRecapProExcel } from '../../utils/exportRecapPro';
import { parseClientFile, detectDuplicates } from '../../utils/importClients';
import ShareLinkPanel from './ShareLinkPanel';

// ── Empty draft ──────────────────────────────────────────────────────────────
const emptyDraft = () => ({
  nom: '', prenom: '', genre: '', dateNaissance: '',
  tel: '', telFixe: '', email: '',
  ville: '', cp: '', adresseLigne1: '', adresseLigne2: '', commune: '', infosLivraison: '',
  telegramUsername: '', canal: 'telegram',
  type: 'particulier', modePaiement: 'colis',
  abonnement: 'freemium', abonnementDebut: '', abonnementFin: '',
  notes: '',
  // Pro fields
  raisonSociale: '', siret: '', interlocuteur: '',
});

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

// ── Toggle button pair ───────────────────────────────────────────────────────
function TogglePair({ value, onChange, options }) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all"
            style={
              active
                ? { background: BRAND.navy, color: 'white' }
                : { background: 'white', color: '#6B7280' }
            }
          >
            {active && <Check size={11} strokeWidth={3} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Validated input field ────────────────────────────────────────────────────
function ValidatedField({ label, value, onChange, placeholder, type = 'text', mono, error, valid, hint, colSpan }) {
  const borderColor = error ? 'border-red-400' : valid ? 'border-green-400' : 'border-gray-200';
  const focusBorder = error ? 'focus:border-red-500' : 'focus:border-blue-300';
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
        {label}
        {valid && <Check size={10} className="inline ml-1 text-green-500" />}
      </label>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        className={`w-full px-3 py-2 rounded-xl border-2 ${borderColor} text-sm outline-none ${focusBorder} transition-colors ${mono ? 'font-mono' : ''}`}
      />
      {error && <p className="text-[10px] text-red-500 font-medium mt-0.5">{error}</p>}
      {hint && !error && <div className="mt-0.5">{hint}</div>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffClients() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clients, data, updateClient, addNewClient, deleteClient, flash, sendMsg, can, ask, auth } = useApp();

  const [clPageSearch, setClPageSearch] = useState('');
  const [clEditId, setClEditId] = useState(null);

  // Open specific client if navigated with state
  useEffect(() => {
    if (location.state?.openClientId) {
      const cl = clients.find((c) => c.id === location.state.openClientId);
      if (cl) {
        setClEditId(cl.id);
        setClDraft({ ...cl });
      }
      // Clear the state to avoid re-opening on re-render
      navigate('/clients', { replace: true, state: {} });
    }
  }, [location.state?.openClientId]);
  const [clDraft, setClDraft] = useState(emptyDraft());
  const [isNewClient, setIsNewClient] = useState(false);
  const [justSavedId, setJustSavedId] = useState(null);
  const [touched, setTouched] = useState({});
  const [billingOpenId, setBillingOpenId] = useState(null);
  const [billingMonth, setBillingMonth] = useState(new Date().getMonth());
  const [billingYear, setBillingYear] = useState(new Date().getFullYear());
  const newClientRef = useRef(null);

  const MOIS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

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

  // ── Duplicate detection ────────────────────────────────────────────────────
  const duplicates = useMemo(() => {
    if (!clEditId || (!clDraft.nom && !clDraft.tel)) return [];
    return clients.filter((c) => {
      if (c.id === clEditId) return false;
      // Check name similarity (case-insensitive, at least 3 chars match)
      const nameLower = (clDraft.nom || '').toLowerCase().trim();
      const cNameLower = (c.nom || '').toLowerCase().trim();
      const nameMatch = nameLower.length >= 3 && cNameLower.length >= 3 && (
        cNameLower.includes(nameLower) || nameLower.includes(cNameLower)
      );
      // Check phone match (clean digits comparison)
      const cleanTel = (clDraft.tel || '').replace(/[\s\-+]/g, '');
      const cCleanTel = (c.tel || '').replace(/[\s\-+]/g, '');
      const telMatch = cleanTel.length >= 6 && cCleanTel.length >= 6 && (
        cleanTel.endsWith(cCleanTel.slice(-8)) || cCleanTel.endsWith(cleanTel.slice(-8))
      );
      return nameMatch || telMatch;
    });
  }, [clEditId, clDraft.nom, clDraft.tel, clients]);

  // ── Live validation ────────────────────────────────────────────────────────
  const fieldErrors = useMemo(() => {
    const errs = {};
    if (touched.nom && (!clDraft.nom || clDraft.nom.trim().length < 2)) errs.nom = 'Min. 2 caractères';
    if (touched.cp && clDraft.cp && !/^9[7-8]\d{3}$/.test(clDraft.cp.replace(/\s/g, ''))) errs.cp = 'Format 97xxx ou 98xxx';
    if (touched.tel && clDraft.tel && !/^\+?\d[\d\s\-]{6,18}$/.test(clDraft.tel.replace(/\s/g, ''))) errs.tel = 'Numéro invalide';
    if (touched.email && clDraft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clDraft.email)) errs.email = 'Email invalide';
    return errs;
  }, [clDraft, touched]);

  const canSave = clDraft.nom && clDraft.nom.trim().length >= 2 && Object.keys(fieldErrors).length === 0;

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

  function getProBillingData(clientId, month, year) {
    return data.filter((c) => {
      if (c.clientId !== clientId) return false;
      if (!['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(c.statut)) return false;
      const date = c.paiementDate || c.dateReception;
      if (!date) return false;
      const d = new Date(date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }

  function patchDraft(field, value) {
    setClDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [clViewMode, setClViewMode] = useState('list'); // 'cards' | 'list'
  const [clSortCol, setClSortCol] = useState('nom');
  const [clSortDir, setClSortDir] = useState('asc');
  const [newDraft, setNewDraft] = useState(emptyDraft());

  function handleNewClient() {
    setNewDraft(emptyDraft());
    setShowNewModal(true);
  }

  async function handleCreateClient() {
    const nd = newDraft;
    const isPro = nd.type === 'pro';
    if (!nd.nom.trim()) { flash({ msg: 'Le nom est requis', type: 'warning' }); return; }
    if (!nd.cp.trim() || !/^9[7-8]\d{3}$/.test(nd.cp.replace(/\s/g, ''))) { flash({ msg: 'Code postal DOM-TOM requis (97xxx)', type: 'warning' }); return; }
    if (!nd.email.trim() && !nd.telegramUsername.trim()) { flash({ msg: 'Email ou Telegram requis — au moins un moyen de contact', type: 'warning' }); return; }
    if (isPro && !nd.raisonSociale.trim()) { flash({ msg: 'La raison sociale est requise pour un pro', type: 'warning' }); return; }

    const id = await addNewClient({
      ...nd,
      nom: nd.nom.trim(),
      prenom: nd.prenom.trim(),
      cp: nd.cp.trim(),
      canal: nd.telegramUsername?.trim() ? 'telegram' : (nd.email?.trim() ? 'email' : 'telegram'),
      modePaiement: isPro ? nd.modePaiement : 'colis', // Particuliers = toujours paiement par colis
      abonnementDebut: nd.abonnementDebut || null,
      abonnementFin: nd.abonnementFin || null,
      dateNaissance: nd.dateNaissance || null,
      points: 0,
    });
    setShowNewModal(false);
    flash({ msg: isPro ? 'Client pro créé avec succès' : 'Client créé avec succès', type: 'success' });
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

  function handleEdit(cl) {
    setClEditId(cl.id);
    setClDraft({
      nom: cl.nomFamille || cl.nom || '',
      prenom: cl.prenom || '',
      tel: cl.tel || '',
      email: cl.email || '',
      ville: cl.ville || '',
      cp: cl.cp || '',
      adresse: cl.adresse || '',
      telegramUsername: cl.telegramUsername || '',
      canal: cl.canal || 'telegram',
      type: cl.type || 'particulier',
      abonnement: cl.abonnement || 'freemium',
      abonnementDebut: cl.abonnementDebut || '',
      abonnementFin: cl.abonnementFin || '',
      notes: cl.notes || '',
    });
    setIsNewClient(false);
    setJustSavedId(null);
    setTouched({});
  }

  function handleSave(id) {
    if (!canSave) {
      // Touch all fields to show errors
      setTouched({ nom: true, tel: true, email: true, cp: true });
      return;
    }
    updateClient(id, clDraft);
    if (isNewClient) {
      setJustSavedId(id);
      setIsNewClient(false);
    } else {
      setClEditId(null);
    }
  }

  function handleCancel() {
    if (isNewClient) {
      // Delete the empty client if it was just created
      const cl = clients.find((c) => c.id === clEditId);
      if (cl && !cl.nom) deleteClient(clEditId);
    }
    setClEditId(null);
    setIsNewClient(false);
    setJustSavedId(null);
    setTouched({});
  }

  function handleDelete(id) {
    const hasColis = data.some((p) => p.clientId === id && p.statut !== 'annule');
    if (hasColis) {
      flash('Ce client a des colis actifs, impossible de le supprimer');
      return;
    }
    deleteClient(id);
    setClEditId(null);
  }

  function handleOpenColis(colisId) {
    navigate(`/colis/${colisId}`);
  }

  // ── Generate invitation Telegram link ──────────────────────────────────────
  function getInvitationTelegramLink(cl) {
    return telegramLink(cl.id);
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

      {/* ── Page création client (plein écran) ─────────────────────────── */}
      {showNewModal && (() => {
        const nd = newDraft;
        const set = (k, v) => setNewDraft((p) => ({ ...p, [k]: v }));
        const isPro = nd.type === 'pro';
        const LBL = 'text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide';
        const INP = 'w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors';
        return (
        <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black" style={{ color: BRAND.navy }}>Nouveau client</h2>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => set('type', 'particulier')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${!isPro ? 'bg-blue-500 text-white shadow' : 'text-gray-500'}`}>
                    Particulier
                  </button>
                  <button onClick={() => set('type', 'pro')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${isPro ? 'text-white shadow' : 'text-gray-500'}`}
                    style={isPro ? { background: BRAND.goldD } : {}}>
                    Professionnel
                  </button>
                </div>
              </div>
              <button onClick={() => setShowNewModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">

              {/* ── Section : Abonnement ── */}
              <div className="space-y-3">
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.navy }}>Abonnement</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={LBL}>Forfait *</label>
                    <select value={nd.abonnement} onChange={(e) => set('abonnement', e.target.value)} className={INP}>
                      <option value="freemium">Freemium</option>
                      <option value="premium_mensuel">Premium Mensuel</option>
                      <option value="premium_annuel">Premium Annuel</option>
                      <option value="vip">VIP Annuel</option>
                    </select>
                  </div>
                  {nd.abonnement !== 'freemium' && <>
                    <div>
                      <label className={LBL}>Date fin abonnement *</label>
                      <input type="date" value={nd.abonnementFin} onChange={(e) => set('abonnementFin', e.target.value)} className={INP} />
                    </div>
                  </>}
                  <div>
                    <label className={LBL}>Paiements *</label>
                    {isPro ? (
                      <select value={nd.modePaiement} onChange={(e) => set('modePaiement', e.target.value)} className={INP}>
                        <option value="colis">Paiement à chaque colis</option>
                        <option value="compte">Paiement en compte</option>
                        <option value="30j">Paiement à 30 jours</option>
                        <option value="fin_mois">Fin de mois</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-600">
                        <Check size={14} className="text-green-500" />
                        Paiement à chaque colis
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section : Pro fields ── */}
              {isPro && (
                <div className="space-y-3 p-4 rounded-xl border-2" style={{ borderColor: `${BRAND.gold}40`, background: `${BRAND.gold}06` }}>
                  <p className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.goldD }}>Personne morale</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LBL}>Raison sociale *</label>
                      <input value={nd.raisonSociale} onChange={(e) => set('raisonSociale', e.target.value)} placeholder="Nom de l'entreprise" className={INP} autoFocus />
                    </div>
                    <div>
                      <label className={LBL}>SIRET</label>
                      <input value={nd.siret} onChange={(e) => set('siret', e.target.value)} placeholder="123 456 789 00012" className={`${INP} font-mono`} />
                    </div>
                    <div className="col-span-2">
                      <label className={LBL}>Interlocuteur</label>
                      <input value={nd.interlocuteur} onChange={(e) => set('interlocuteur', e.target.value)} placeholder="Nom du contact principal" className={INP} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section : Identité ── */}
              <div className="space-y-3">
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.navy }}>{isPro ? 'Contact' : 'Personne physique'}</p>
                <div className="grid grid-cols-2 gap-3">
                  {!isPro && (
                    <div className="col-span-2">
                      <label className={LBL}>Genre</label>
                      <div className="flex gap-3">
                        {['Homme', 'Femme'].map((g) => (
                          <label key={g} className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="genre" value={g.toLowerCase()} checked={nd.genre === g.toLowerCase()}
                              onChange={(e) => set('genre', e.target.value)} className="accent-blue-500" />
                            <span className="text-sm">{g}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className={LBL}>{isPro ? 'Nom contact *' : 'Nom *'}</label>
                    <input value={nd.nom} onChange={(e) => set('nom', e.target.value)} placeholder="NOM" className={INP} autoFocus={!isPro} />
                  </div>
                  <div>
                    <label className={LBL}>Prénom</label>
                    <input value={nd.prenom} onChange={(e) => set('prenom', e.target.value)} placeholder="Prénom" className={INP} />
                  </div>
                  {!isPro && (
                    <div>
                      <label className={LBL}>Date de naissance</label>
                      <input type="date" value={nd.dateNaissance} onChange={(e) => set('dateNaissance', e.target.value)} className={INP} />
                    </div>
                  )}
                  <div>
                    <label className={LBL}>Téléphone mobile *</label>
                    <input value={nd.tel} onChange={(e) => set('tel', e.target.value)} placeholder="+262 692 12 34 56" className={`${INP} font-mono`} />
                  </div>
                  <div>
                    <label className={LBL}>Téléphone fixe</label>
                    <input value={nd.telFixe} onChange={(e) => set('telFixe', e.target.value)} placeholder="+262 262 12 34 56" className={`${INP} font-mono`} />
                  </div>
                  <div>
                    <label className={LBL}>Email *</label>
                    <input type="email" value={nd.email} onChange={(e) => set('email', e.target.value)} placeholder="adresse@exemple.com" className={INP} />
                  </div>
                  <div>
                    <label className={LBL}>Telegram @</label>
                    <input value={nd.telegramUsername} onChange={(e) => set('telegramUsername', e.target.value)} placeholder="@username" className={INP} />
                  </div>
                </div>
              </div>

              {/* ── Section : Adresse livraison ── */}
              <div className="space-y-3">
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.navy }}>Adresse livraison</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LBL}>Département *</label>
                    <select value={nd.cp ? nd.cp.slice(0, 3) : ''} onChange={(e) => set('cp', e.target.value + '00')} className={INP}>
                      <option value="">— Sélectionner —</option>
                      <option value="974">🇷🇪 La Réunion (974)</option>
                      <option value="976">🇾🇹 Mayotte (976)</option>
                      <option value="971">🇬🇵 Guadeloupe (971)</option>
                      <option value="972">🇲🇶 Martinique (972)</option>
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Commune</label>
                    <input value={nd.commune} onChange={(e) => set('commune', e.target.value)} placeholder="Saint-Denis" className={INP} />
                  </div>
                  <div>
                    <label className={LBL}>Code postal *</label>
                    <input value={nd.cp} onChange={(e) => set('cp', e.target.value)} placeholder="97400" className={`${INP} font-mono`} />
                  </div>
                  <div>
                    <label className={LBL}>Ville</label>
                    <input value={nd.ville} onChange={(e) => set('ville', e.target.value)} placeholder="Saint-Denis" className={INP} />
                  </div>
                  <div className="col-span-2">
                    <label className={LBL}>Adresse ligne 1 *</label>
                    <input value={nd.adresseLigne1} onChange={(e) => set('adresseLigne1', e.target.value)} placeholder="N° et nom de rue" className={INP} />
                  </div>
                  <div className="col-span-2">
                    <label className={LBL}>Adresse ligne 2</label>
                    <input value={nd.adresseLigne2} onChange={(e) => set('adresseLigne2', e.target.value)} placeholder="Résidence, bâtiment, étage…" className={INP} />
                  </div>
                  <div className="col-span-2">
                    <label className={LBL}>Informations pour la livraison</label>
                    <textarea value={nd.infosLivraison} onChange={(e) => set('infosLivraison', e.target.value)}
                      placeholder="Digicode, interphone, horaires…" rows={2} className={`${INP} resize-none`} />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={LBL}>Notes internes</label>
                <textarea value={nd.notes} onChange={(e) => set('notes', e.target.value)}
                  placeholder="Informations utiles pour l'équipe…" rows={2} className={`${INP} resize-none`} />
              </div>
            </div>

            {/* Footer — sticky bottom */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 mt-6 rounded-b-2xl flex gap-3">
              <button onClick={() => setShowNewModal(false)}
                className="px-6 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">
                Annuler
              </button>
              <button onClick={handleCreateClient}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95 transition-all"
                style={{ background: isPro ? `linear-gradient(135deg, ${BRAND.goldD}, ${BRAND.gold})` : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}>
                {isPro ? 'Créer le client pro' : 'Créer le client'}
              </button>
            </div>

          </div>
        </div>
        );
      })()}

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
                onClick={handleNewClient}
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
                      <tr key={cl.id} onClick={() => { handleEdit(cl); setClViewMode('cards'); }}
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
        <>
          {/* Backdrop plein écran si un client est en édition */}
          {clEditId && (
            <div
              className="fixed inset-0 z-40 bg-black/50 anim-fade"
              onClick={handleCancel}
            />
          )}
          <div className={clEditId
            ? "fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center pointer-events-none"
            : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
          }>
        {filtered.filter((cl) => !clEditId || cl.id === clEditId).map((cl) => {
          const isOpen = clEditId === cl.id;
          const colis = clientColis(cl.id);
          const actifs = clientActifs(cl.id);
          const ca = clientCA(cl.id);
          const dest = getDestByCP(cl.cp);
          const hasColis = data.some((p) => p.clientId === cl.id && p.statut !== 'annule');
          const isJustSaved = justSavedId === cl.id;

          return (
            <div key={cl.id} ref={isOpen && isNewClient ? newClientRef : undefined}
              className={isOpen
                ? "card pointer-events-auto w-full max-w-3xl my-4 shadow-2xl animate-in bg-white rounded-2xl"
                : "card overflow-hidden"
              }
              onClick={(e) => isOpen && e.stopPropagation()}>

              {/* ── Collapsed row ─────────────────────────────────────────── */}
              <button
                onClick={() => (isOpen ? handleCancel() : handleEdit(cl))}
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
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: 'white' }}>
                        👑 VIP
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
                  className={`flex-shrink-0 text-gray-400 transition-transform ${isOpen || isJustSaved ? 'rotate-180' : ''}`}
                />
              </button>

              {/* ── Invitation success after save ────────────────────────── */}
              {isJustSaved && !isOpen && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3 anim-slide-down">
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
                    <Check size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-green-800">Client créé avec succès</p>
                      <p className="text-[11px] text-green-600 mt-0.5">Envoyez-lui une invitation pour accéder à son espace.</p>
                    </div>
                  </div>

                  {cl.tel && cl.canal === 'telegram' && (
                    <a
                      href={getInvitationTelegramLink(cl)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{ background: '#0088cc', color: 'white', boxShadow: '0 2px 10px #0088cc40' }}
                      onClick={() => setTimeout(() => setJustSavedId(null), 500)}
                    >
                      <Send size={14} />
                      Inviter via Telegram
                    </a>
                  )}

                  {cl.email && (
                    <a
                      href={`mailto:${cl.email}?subject=${encodeURIComponent('Bienvenue chez Expedîle !')}&body=${encodeURIComponent(`Bonjour ${cl.nom ? cl.nom.split(' ')[0] : ''},\n\nVotre espace client Expedîle est prêt !\n\nConnectez-vous ici : https://expedile.re/app\n\nÀ très vite !\nL'équipe Expedîle`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold bg-blue-50 text-blue-700 border-2 border-blue-200 hover:bg-blue-100 transition-all active:scale-95"
                      onClick={() => setTimeout(() => setJustSavedId(null), 500)}
                    >
                      <ExternalLink size={14} />
                      Inviter par email
                    </a>
                  )}

                  <button
                    onClick={() => setJustSavedId(null)}
                    className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1"
                  >
                    Fermer
                  </button>
                </div>
              )}

              {/* ── Edit form (expanded) ───────────────────────────────────── */}
              {isOpen && (
                <div className="border-t border-gray-100 px-4 pb-5 pt-4 space-y-4">

                  {/* Duplicate warning */}
                  {duplicates.length > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 anim-fade">
                      <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-amber-800">Doublon possible</p>
                        <div className="mt-1 space-y-1">
                          {duplicates.map((dup) => (
                            <p key={dup.id} className="text-[11px] text-amber-700">
                              <span className="font-bold">{dup.nom}</span>
                              {dup.tel && <span className="font-mono ml-1">{dup.tel}</span>}
                              {dup.email && <span className="ml-1">{dup.email}</span>}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Field grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <ValidatedField
                      label="Nom *"
                      value={clDraft.nom}
                      onChange={(e) => patchDraft('nom', e.target.value)}
                      placeholder="NOM"
                      error={fieldErrors.nom}
                      valid={touched.nom && clDraft.nom && clDraft.nom.trim().length >= 2 && !fieldErrors.nom}
                    />
                    <ValidatedField
                      label="Prénom"
                      value={clDraft.prenom}
                      onChange={(e) => patchDraft('prenom', e.target.value)}
                      placeholder="Prénom"
                    />

                    <ValidatedField
                      label="Téléphone"
                      value={clDraft.tel}
                      onChange={(e) => patchDraft('tel', e.target.value)}
                      placeholder="+262 692 …"
                      mono
                      error={fieldErrors.tel}
                      valid={touched.tel && clDraft.tel && !fieldErrors.tel}
                    />

                    <ValidatedField
                      label="Email"
                      value={clDraft.email}
                      onChange={(e) => patchDraft('email', e.target.value)}
                      placeholder="adresse@exemple.com"
                      type="email"
                      error={fieldErrors.email}
                      valid={touched.email && clDraft.email && !fieldErrors.email}
                    />

                    <ValidatedField
                      label="Telegram @username"
                      value={clDraft.telegramUsername}
                      onChange={(e) => patchDraft('telegramUsername', e.target.value)}
                      placeholder="@username"
                    />

                    <ValidatedField
                      label="Ville"
                      value={clDraft.ville}
                      onChange={(e) => patchDraft('ville', e.target.value)}
                      placeholder="Saint-Denis"
                    />

                    <ValidatedField
                      label="Code postal"
                      value={clDraft.cp}
                      onChange={(e) => patchDraft('cp', e.target.value)}
                      placeholder="97400"
                      mono
                      error={fieldErrors.cp}
                      valid={touched.cp && clDraft.cp && /^9[7-8]\d{3}$/.test(clDraft.cp.replace(/\s/g, '')) && !fieldErrors.cp}
                      hint={clDraft.cp && clDraft.cp.length >= 3 && !fieldErrors.cp ? (
                        <p className="text-[10px] text-gray-400 flex items-center gap-1">
                          {(() => {
                            const d = getDestByCP(clDraft.cp);
                            return <><span className="text-sm">{d.flag}</span><span className="font-medium">{d.nom}</span></>;
                          })()}
                        </p>
                      ) : null}
                    />

                    {/* Adresse de livraison */}
                    <div className="col-span-2">
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Adresse de livraison
                      </label>
                      <textarea
                        value={clDraft.adresse}
                        onChange={(e) => patchDraft('adresse', e.target.value)}
                        placeholder="N° rue, résidence, étage…"
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors resize-none"
                      />
                    </div>
                  </div>

                  {/* Canal */}
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1.5 uppercase tracking-wide">
                      Canal de contact
                    </label>
                    <TogglePair
                      value={clDraft.canal}
                      onChange={(v) => patchDraft('canal', v)}
                      options={[
                        { value: 'telegram', label: 'Telegram' },
                        { value: 'email', label: 'Email' },
                      ]}
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1.5 uppercase tracking-wide">
                      Type de client
                    </label>
                    <TogglePair
                      value={clDraft.type}
                      onChange={(v) => patchDraft('type', v)}
                      options={[
                        { value: 'particulier', label: 'Particulier' },
                        { value: 'pro', label: 'Pro' },
                      ]}
                    />
                  </div>

                  {/* Forfait */}
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1.5 uppercase tracking-wide">
                      Forfait
                    </label>
                    <select
                      value={clDraft.abonnement}
                      onChange={(e) => patchDraft('abonnement', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                      style={{ color: BRAND.navy }}
                    >
                      <option value="freemium">Freemium</option>
                      <option value="premium_mensuel">Premium Mensuel (13€/mois)</option>
                      <option value="premium_annuel">Premium Annuel (69€/an)</option>
                      <option value="vip">VIP Annuel (149€/an)</option>
                    </select>
                  </div>

                  {clDraft.abonnement !== 'freemium' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                          Début abonnement
                        </label>
                        <input
                          type="date"
                          value={clDraft.abonnementDebut || ''}
                          onChange={(e) => patchDraft('abonnementDebut', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                          Fin abonnement
                        </label>
                        <input
                          type="date"
                          value={clDraft.abonnementFin || ''}
                          onChange={(e) => patchDraft('abonnementFin', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  {/* Notes internes */}
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                      Notes internes
                    </label>
                    <textarea
                      value={clDraft.notes}
                      onChange={(e) => patchDraft('notes', e.target.value)}
                      placeholder="Informations utiles pour l'équipe…"
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors resize-none"
                    />
                  </div>

                  {/* Telegram invitation link */}
                  {cl.id && (
                    <div className="mt-2 p-3 rounded-xl bg-blue-50 border border-blue-200">
                      <p className="text-xs font-bold text-blue-800 mb-1">Lien d'invitation Telegram</p>
                      <p className="text-[10px] text-blue-600 mb-2">Envoyez ce lien au client pour qu'il lie son compte Telegram :</p>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={`https://t.me/Expedilebot?start=${cl.id}`}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-blue-200 bg-white text-xs font-mono text-blue-700"
                          onClick={(e) => e.target.select()}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`https://t.me/Expedilebot?start=${cl.id}`);
                            flash('Lien copie !');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white active:scale-95 transition-all"
                        >
                          Copier
                        </button>
                        <button
                          onClick={() => {
                            if (cl.email) {
                              sendMsg(null, cl.id, 'email', 'invitation_telegram', null);
                              flash('Invitation Telegram envoyee par email');
                            } else {
                              flash('Pas d\'email pour ce client');
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-300 text-blue-700 active:scale-95 transition-all"
                        >
                          Envoyer par email
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Save / Cancel */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(cl.id)}
                      disabled={!canSave}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: BRAND.navy, color: 'white' }}
                    >
                      <Check size={14} strokeWidth={2.5} />
                      {isNewClient ? 'Créer le client' : 'Enregistrer'}
                    </button>
                    <button
                      onClick={handleCancel}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 transition-all active:scale-95 hover:bg-gray-200"
                    >
                      <X size={14} />
                      Annuler
                    </button>
                  </div>

                  {/* Quick action links */}
                  {!isNewClient && (cl.tel || cl.email) && (
                    <div className="flex gap-2 flex-wrap">
                      {cl.tel && cl.canal === 'telegram' && (
                        <a
                          href={telegramLink(cl.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          Telegram
                        </a>
                      )}
                      {cl.email && (
                        <a
                          href={`mailto:${cl.email}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          Email
                        </a>
                      )}
                      {cl.tel && (
                        <a
                          href={`tel:${cl.tel}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        >
                          Appeler
                        </a>
                      )}
                    </div>
                  )}

                  {/* Colis summary */}
                  {colis.length > 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <p
                        className="text-[11px] font-bold uppercase tracking-wide mb-2"
                        style={{ color: BRAND.navy }}
                      >
                        Colis ({colis.length})
                      </p>
                      <div className="space-y-1.5">
                        {colis.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleOpenColis(p.id)}
                            className="w-full flex items-center gap-2 text-left p-2 rounded-lg hover:bg-white transition-colors group"
                          >
                            <span className="text-xs font-black" style={{ color: BRAND.navy }}>
                              {p.ref}
                            </span>
                            <Badge statut={p.statut} />
                            {p.desc && (
                              <span className="text-xs text-gray-400 truncate flex-1 min-w-0">{p.desc}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pro billing section */}
                  {cl.type === 'pro' && !isNewClient && (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#A5B4FC', background: '#EEF2FF' }}>
                      <button
                        onClick={() => setBillingOpenId(billingOpenId === cl.id ? null : cl.id)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                      >
                        <FileSpreadsheet size={13} className="text-indigo-600 flex-shrink-0" />
                        <span className="text-xs font-bold text-indigo-800 flex-1">
                          Facturation
                          {cl.methodePaiement === '30_jours' ? ' — Paiement 30 jours' : ' — Fin de mois'}
                        </span>
                        <ChevronDown
                          size={13}
                          className={`text-indigo-400 transition-transform ${billingOpenId === cl.id ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {billingOpenId === cl.id && (
                        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t" style={{ borderColor: '#C7D2FE' }}>
                          {/* Month/year selector */}
                          <div className="flex gap-2">
                            <select
                              value={billingMonth}
                              onChange={(e) => setBillingMonth(Number(e.target.value))}
                              className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-800 outline-none"
                            >
                              {MOIS_LABELS.map((m, i) => (
                                <option key={i} value={i}>{m}</option>
                              ))}
                            </select>
                            <select
                              value={billingYear}
                              onChange={(e) => setBillingYear(Number(e.target.value))}
                              className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-800 outline-none"
                            >
                              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                                <option key={y} value={y}>{y}</option>
                              ))}
                            </select>
                          </div>
                          {/* Summary */}
                          {(() => {
                            const billingColis = getProBillingData(cl.id, billingMonth, billingYear);
                            const total = billingColis.reduce((s, c) => s + (c.devisTotal || 0), 0);
                            return (
                              <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg" style={{ background: '#F5F3FF' }}>
                                <div className="flex-1">
                                  <p className="text-[11px] font-bold text-indigo-700">
                                    {billingColis.length} colis
                                  </p>
                                  <p className="text-sm font-black text-indigo-900">
                                    {total.toFixed(2)} €
                                  </p>
                                </div>
                                <button
                                  onClick={() => {
                                    const count = exportRecapProExcel(cl, data, billingMonth, billingYear);
                                    if (count > 0) flash(`Récap exporté : ${count} colis`);
                                    else flash('Aucun colis pour cette période');
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 hover:bg-indigo-200"
                                  style={{ background: '#E0E7FF', color: '#3730A3', border: '1px solid #A5B4FC' }}
                                >
                                  <Download size={11} />
                                  Excel
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lien de suivi partagé — uniquement pour les clients existants */}
                  {!isNewClient && cl.id && (
                    <ShareLinkPanel
                      client={cl}
                      currentUserId={auth?.u?.id}
                      flash={flash}
                      ask={ask}
                    />
                  )}

                  {/* Delete button — only if no colis */}
                  {!hasColis && !isNewClient && (
                    <button
                      onClick={() => handleDelete(cl.id)}
                      className="w-full py-2.5 rounded-xl text-xs font-bold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                    >
                      Supprimer ce client
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </>
      )}
    </div>
  );
}

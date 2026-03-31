import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Users, Plus, Search, ChevronDown, Check, X, AlertTriangle, ExternalLink, Send, Download, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { uid, telegramLink, searchClients } from '../../utils';
import { Badge } from '../ui';
import { exportRecapProExcel } from '../../utils/exportRecapPro';

// ── Empty draft ──────────────────────────────────────────────────────────────
const emptyDraft = () => ({
  nom: '',
  prenom: '',
  tel: '',
  email: '',
  ville: '',
  cp: '',
  adresse: '',
  telegramUsername: '',
  canal: 'telegram',
  type: 'particulier',
  abonnement: 'freemium',
  abonnementDebut: '',
  abonnementFin: '',
  notes: '',
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
  const { clients, data, updateClient, addNewClient, deleteClient, flash, sendMsg } = useApp();

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
  const [newDraft, setNewDraft] = useState(emptyDraft());

  function handleNewClient() {
    setNewDraft(emptyDraft());
    setShowNewModal(true);
  }

  async function handleCreateClient() {
    if (!newDraft.nom.trim()) { flash({ msg: 'Le nom est requis', type: 'warning' }); return; }
    if (!newDraft.cp.trim() || !/^9[7-8]\d{3}$/.test(newDraft.cp.replace(/\s/g, ''))) { flash({ msg: 'Code postal DOM-TOM requis (97xxx)', type: 'warning' }); return; }

    const id = await addNewClient({
      nom: newDraft.nom.trim(),
      prenom: newDraft.prenom.trim(),
      tel: newDraft.tel.trim(),
      email: newDraft.email.trim(),
      ville: newDraft.ville.trim(),
      cp: newDraft.cp.trim(),
      adresse: newDraft.adresse.trim(),
      telegramUsername: newDraft.telegramUsername.trim(),
      canal: newDraft.canal,
      type: newDraft.type,
      abonnement: newDraft.abonnement,
      abonnementDebut: newDraft.abonnementDebut || null,
      abonnementFin: newDraft.abonnementFin || null,
      points: 0,
    });
    setShowNewModal(false);
    flash({ msg: 'Client créé avec succès', type: 'success' });
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

      {/* ── Modal création client ────────────────────────────────────────── */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <h2 className="text-lg font-black" style={{ color: BRAND.navy }}>Nouveau client</h2>
              <button onClick={() => setShowNewModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Nom *</label>
                  <input value={newDraft.nom} onChange={(e) => setNewDraft((p) => ({ ...p, nom: e.target.value }))}
                    placeholder="NOM" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" autoFocus />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Prénom</label>
                  <input value={newDraft.prenom} onChange={(e) => setNewDraft((p) => ({ ...p, prenom: e.target.value }))}
                    placeholder="Prénom" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Téléphone</label>
                  <input value={newDraft.tel} onChange={(e) => setNewDraft((p) => ({ ...p, tel: e.target.value }))}
                    placeholder="+262 692 …" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 font-mono" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Email</label>
                  <input value={newDraft.email} onChange={(e) => setNewDraft((p) => ({ ...p, email: e.target.value }))}
                    placeholder="adresse@exemple.com" type="email" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Ville</label>
                  <input value={newDraft.ville} onChange={(e) => setNewDraft((p) => ({ ...p, ville: e.target.value }))}
                    placeholder="Saint-Denis" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Code postal *</label>
                  <input value={newDraft.cp} onChange={(e) => setNewDraft((p) => ({ ...p, cp: e.target.value }))}
                    placeholder="97400" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Adresse</label>
                  <input value={newDraft.adresse} onChange={(e) => setNewDraft((p) => ({ ...p, adresse: e.target.value }))}
                    placeholder="N° rue, résidence, étage…" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Telegram @</label>
                  <input value={newDraft.telegramUsername} onChange={(e) => setNewDraft((p) => ({ ...p, telegramUsername: e.target.value }))}
                    placeholder="@username" className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Type</label>
                  <select value={newDraft.type} onChange={(e) => setNewDraft((p) => ({ ...p, type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300">
                    <option value="particulier">Particulier</option>
                    <option value="pro">Professionnel</option>
                  </select>
                </div>
              </div>

              {/* Forfait */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Forfait</label>
                <select value={newDraft.abonnement} onChange={(e) => setNewDraft((p) => ({ ...p, abonnement: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300">
                  <option value="freemium">Freemium</option>
                  <option value="premium_mensuel">Premium Mensuel (13€/mois)</option>
                  <option value="premium_annuel">Premium Annuel (69€/an)</option>
                  <option value="vip">VIP Annuel (149€/an)</option>
                </select>
              </div>
              {newDraft.abonnement !== 'freemium' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Début</label>
                    <input type="date" value={newDraft.abonnementDebut}
                      onChange={(e) => setNewDraft((p) => ({ ...p, abonnementDebut: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Fin</label>
                    <input type="date" value={newDraft.abonnementFin}
                      onChange={(e) => setNewDraft((p) => ({ ...p, abonnementFin: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">Notes</label>
                <textarea value={newDraft.notes} onChange={(e) => setNewDraft((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Informations utiles…" rows={2}
                  className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 flex gap-3">
              <button onClick={() => setShowNewModal(false)}
                className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                Annuler
              </button>
              <button onClick={handleCreateClient}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}>
                Créer le client
              </button>
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

      {/* ── Client list ─────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="card p-8 flex flex-col items-center text-center">
          <Users size={28} className="text-gray-200 mb-2" />
          <p className="text-sm font-semibold text-gray-500">Aucun client trouvé</p>
          <p className="text-xs text-gray-400 mt-0.5">Modifiez votre recherche ou ajoutez un nouveau client</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((cl) => {
          const isOpen = clEditId === cl.id;
          const colis = clientColis(cl.id);
          const actifs = clientActifs(cl.id);
          const ca = clientCA(cl.id);
          const dest = getDestByCP(cl.cp);
          const hasColis = data.some((p) => p.clientId === cl.id && p.statut !== 'annule');
          const isJustSaved = justSavedId === cl.id;

          return (
            <div key={cl.id} ref={isOpen && isNewClient ? newClientRef : undefined} className="card overflow-hidden">

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
                    {cl.type === 'pro' && (
                      <span
                        className="text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase"
                        style={{ background: `${BRAND.gold}30`, color: BRAND.goldD }}
                      >
                        PRO
                      </span>
                    )}
                    {cl.type === 'pro' && (
                      <span className="text-[10px] font-semibold text-indigo-500">
                        {cl.methodePaiement === '30_jours' ? '30j' : 'Fin de mois'}
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
    </div>
  );
}

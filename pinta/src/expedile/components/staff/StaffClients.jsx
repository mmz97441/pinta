import React, { useState, useMemo } from 'react';
import { ArrowLeft, Users, Plus, Search, ChevronDown, Check, X, AlertTriangle, ExternalLink, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, getDestByCP } from '../../constants';
import { uid, waLink, searchClients } from '../../utils';
import { Badge } from '../ui';

// ── Empty draft ──────────────────────────────────────────────────────────────
const emptyDraft = () => ({
  nom: '',
  tel: '',
  email: '',
  ville: '',
  cp: '',
  adresse: '',
  canal: 'whatsapp',
  type: 'particulier',
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
  const { clients, data, setPage, setSelId, updateClient, addNewClient, deleteClient, flash } = useApp();

  const [clPageSearch, setClPageSearch] = useState('');
  const [clEditId, setClEditId] = useState(null);
  const [clDraft, setClDraft] = useState(emptyDraft());
  const [isNewClient, setIsNewClient] = useState(false);
  const [justSavedId, setJustSavedId] = useState(null);
  const [touched, setTouched] = useState({});

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = searchClients(clients, clPageSearch);
  const waCount = clients.filter((c) => c.canal === 'whatsapp').length;
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

  function patchDraft(field, value) {
    setClDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleNewClient() {
    const draft = emptyDraft();
    const id = addNewClient({
      ...draft,
      created: new Date().toISOString().slice(0, 10),
      points: 0,
    });
    setClEditId(id);
    setClDraft(draft);
    setIsNewClient(true);
    setJustSavedId(null);
    setTouched({});
  }

  function handleEdit(cl) {
    setClEditId(cl.id);
    setClDraft({
      nom: cl.nom || '',
      tel: cl.tel || '',
      email: cl.email || '',
      ville: cl.ville || '',
      cp: cl.cp || '',
      adresse: cl.adresse || '',
      canal: cl.canal || 'whatsapp',
      type: cl.type || 'particulier',
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
    setSelId(colisId);
  }

  // ── Generate invitation WhatsApp link ──────────────────────────────────────
  function getInvitationWALink(cl) {
    const prenom = cl.nom ? cl.nom.split(' ')[0] : '';
    const dest = getDestByCP(cl.cp);
    const msg = `Bonjour ${prenom} !\n\nBienvenue chez Expedîle ! Votre espace client est prêt.\n\nVous pouvez dès maintenant suivre vos colis depuis la métropole vers ${dest.flag} ${dest.nom}.\n\nConnectez-vous ici :\nhttps://expedile.re/app\n\nÀ très vite !`;
    return waLink(cl.tel, msg);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="anim-fade flex flex-col gap-4 pb-24">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setPage('home')}
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
          <span className="text-2xl font-black leading-none text-green-600">{waCount}</span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">WhatsApp</span>
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
            <div key={cl.id} className="card overflow-hidden">

              {/* ── Collapsed row ─────────────────────────────────────────── */}
              <button
                onClick={() => (isOpen ? handleCancel() : handleEdit(cl))}
                className="w-full text-left p-4 flex items-center gap-3"
              >
                <Avatar nom={cl.nom} size={10} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
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
                    {cl.canal === 'whatsapp' && (
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="WhatsApp" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs">{dest.flag}</span>
                    {cl.ville && <span className="text-xs text-gray-500">{cl.ville}</span>}
                    {cl.tel && <span className="text-xs text-gray-400 font-mono">{cl.tel}</span>}
                    {cl.email && <span className="text-xs text-gray-400 truncate max-w-[140px]">{cl.email}</span>}
                  </div>
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

                  {cl.tel && cl.canal === 'whatsapp' && (
                    <a
                      href={getInvitationWALink(cl)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{ background: '#25D366', color: 'white', boxShadow: '0 2px 10px #25D36640' }}
                      onClick={() => setTimeout(() => setJustSavedId(null), 500)}
                    >
                      <Send size={14} />
                      Inviter via WhatsApp
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
                      label="Nom complet *"
                      value={clDraft.nom}
                      onChange={(e) => patchDraft('nom', e.target.value)}
                      placeholder="Prénom NOM"
                      error={fieldErrors.nom}
                      valid={touched.nom && clDraft.nom && clDraft.nom.trim().length >= 2 && !fieldErrors.nom}
                      colSpan={2}
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
                        { value: 'whatsapp', label: 'WhatsApp' },
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
                      {cl.tel && cl.canal === 'whatsapp' && (
                        <a
                          href={waLink(cl.tel, `Bonjour ${cl.nom ? cl.nom.split(' ')[0] : ''} !`)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                        >
                          WhatsApp
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

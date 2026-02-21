import React, { useState, useMemo } from 'react';
import { X, FileText, Search, Package, ChevronRight, UserPlus, Link2, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BRAND, getDestByCP } from '../constants';
import { uid, searchClients, waLink, trackStr } from '../utils';
import { Badge } from './ui';

const EMPTY_FORM = {
  trackings: [''],
  d: '',
  v: '',
  c: '',
  casier: '',
  facUploaded: false,
  facVendeur: '',
  facMontant: '',
};

const EMPTY_NEW_CLIENT = {
  nom: '',
  ville: '',
  cp: '',
  tel: '',
  email: '',
  canal: 'whatsapp',
  type: 'particulier',
};

function nextRef(data) {
  const nums = data
    .map((p) => {
      const m = p.ref && p.ref.match(/^EXP-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(Boolean);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return 'EXP-' + String(max + 1).padStart(4, '0');
}

export default function ColisModal({ open, onClose }) {
  const { isStaff, authCl, clients, data, setData, flash, addNewClient, receptionner, upd, log } = useApp();

  const [nf, setNf] = useState(EMPTY_FORM);
  const [formErr, setFormErr] = useState({});
  const [clientSearchQ, setClientSearchQ] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);

  // ── Hybrid system state ──
  const [matchedAnnonce, setMatchedAnnonce] = useState(null);
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClientForm, setNewClientForm] = useState(EMPTY_NEW_CLIENT);
  const [newClientErr, setNewClientErr] = useState({});

  // ── Pre-announcements for selected client (hook must be before early return) ──
  const pendingAnnonces = useMemo(() => {
    if (!selectedClient) return [];
    return data.filter((p) => p.clientId === selectedClient.id && p.statut === 'annonce');
  }, [selectedClient, data]);

  if (!open) return null;

  // ── helpers ──────────────────────────────────────────────
  const setField = (key, val) => setNf((prev) => ({ ...prev, [key]: val }));

  const setTracking = (idx, val) => {
    setNf((prev) => {
      const trackings = [...prev.trackings];
      trackings[idx] = val;
      return { ...prev, trackings };
    });
  };

  const addTracking = () => {
    setNf((prev) => ({ ...prev, trackings: [...prev.trackings, ''] }));
  };

  const removeTracking = (idx) => {
    setNf((prev) => {
      const trackings = prev.trackings.filter((_, i) => i !== idx);
      return { ...prev, trackings: trackings.length > 0 ? trackings : [''] };
    });
  };

  const resetAndClose = () => {
    setNf(EMPTY_FORM);
    setFormErr({});
    setClientSearchQ('');
    setClientSearchOpen(false);
    setSelectedClient(null);
    setMatchedAnnonce(null);
    setNewClientMode(false);
    setNewClientForm(EMPTY_NEW_CLIENT);
    setNewClientErr({});
    onClose();
  };

  // ── client search ─────────────────────────────────────────
  const filteredClients = clientSearchQ.trim()
    ? searchClients(clients, clientSearchQ)
    : clients.slice(0, 8);

  const handleSelectClient = (cl) => {
    setSelectedClient(cl);
    setClientSearchQ(cl.nom);
    setClientSearchOpen(false);
    setMatchedAnnonce(null);
    setNewClientMode(false);
    setFormErr((prev) => ({ ...prev, client: undefined }));
  };

  // ── Match a pre-announcement ────────────────────────────
  const handleSelectAnnonce = (annonce) => {
    if (matchedAnnonce?.id === annonce.id) {
      setMatchedAnnonce(null);
    } else {
      setMatchedAnnonce(annonce);
      setNf((prev) => ({
        ...prev,
        d: annonce.desc,
        v: annonce.valeur ? String(annonce.valeur) : '',
        trackings: annonce.trackings && annonce.trackings.length > 0 ? annonce.trackings : [''],
      }));
    }
  };

  // ── New client inline ─────────────────────────────────────
  const setNCField = (key, val) => setNewClientForm((prev) => ({ ...prev, [key]: val }));

  const validateNewClient = () => {
    const errs = {};
    if (!newClientForm.nom.trim() || newClientForm.nom.trim().length < 2) errs.nom = 'Nom requis (min. 2 car.)';
    if (!newClientForm.cp.trim() || !/^9[7-8]\d{3}$/.test(newClientForm.cp.replace(/\s/g, ''))) errs.cp = 'Code postal DOM-TOM requis (97xxx)';
    if (newClientForm.tel && !/^\+?\d[\d\s\-]{6,18}$/.test(newClientForm.tel.replace(/\s/g, ''))) errs.tel = 'Numéro invalide';
    setNewClientErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── validation ────────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (isStaff) {
      if (!selectedClient && !newClientMode) errs.client = 'Sélectionnez un client';
      if (!matchedAnnonce && !nf.d.trim()) errs.d = 'Description requise';
      if (!nf.casier.trim()) errs.casier = 'Numéro de casier requis';
    } else {
      if (!nf.d.trim()) errs.d = 'Description requise';
    }
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── submit: staff matches a pre-announcement ──────────────
  const handleMatchReception = (sendWA) => {
    if (!nf.casier.trim()) {
      setFormErr({ casier: 'Numéro de casier requis' });
      return;
    }
    const annonce = matchedAnnonce;
    const cl = selectedClient;

    log(annonce.id, annonce.statut, 'receptionne');
    upd(annonce.id, { statut: 'receptionne', casier: nf.casier.trim() });

    if (sendWA && cl?.tel) {
      const msg =
        `Bonjour ${cl.nom.split(' ')[0]} 👋\n\nVotre colis pré-annoncé *${annonce.ref}* est bien arrivé à notre entrepôt de Paris !\n\n` +
        `📦 Contenu : ${annonce.desc}\n` +
        (annonce.trackings?.some((t) => t)
          ? `🔍 Tracking : ${annonce.trackings.filter((t) => t).join(', ')}\n`
          : '') +
        `\nVotre pré-annonce a bien été rattachée. Nous allons le mesurer et peser. On revient vers vous rapidement !\n\n_Expedîle_`;
      window.open(waLink(cl.tel, msg), '_blank');
    }

    flash(`${annonce.ref} rattaché et réceptionné — casier ${nf.casier.trim()}`);
    resetAndClose();
  };

  // ── submit: staff new colis (blind reception) ──────────────
  const handleReceptionner = (sendWA) => {
    // If in new client mode, create client first
    let clientId;
    let cl;
    if (newClientMode) {
      if (!validateNewClient()) return;
      if (!nf.d.trim()) { setFormErr({ d: 'Description requise' }); return; }
      if (!nf.casier.trim()) { setFormErr({ casier: 'Numéro de casier requis' }); return; }
      clientId = addNewClient({
        nom: newClientForm.nom.trim(),
        ville: newClientForm.ville.trim(),
        cp: newClientForm.cp.trim(),
        tel: newClientForm.tel.trim(),
        email: newClientForm.email.trim(),
        canal: newClientForm.canal,
        type: newClientForm.type,
        created: new Date().toISOString().slice(0, 10),
        points: 0,
      });
      cl = { ...newClientForm, id: clientId, nom: newClientForm.nom.trim(), tel: newClientForm.tel.trim() };
    } else {
      if (!validate()) return;
      clientId = selectedClient.id;
      cl = selectedClient;
    }

    const newColis = buildColis(clientId, 'receptionne');
    setData((prev) => [...prev, newColis]);

    if (sendWA && cl?.tel) {
      const msg =
        `Bonjour ${cl.nom.split(' ')[0]} 👋\n\nVotre colis *${newColis.ref}* est bien arrivé à notre entrepôt de Paris !\n\n` +
        `📦 Contenu : ${newColis.desc}\n` +
        (newColis.trackings.some((t) => t)
          ? `🔍 Tracking : ${newColis.trackings.filter((t) => t).join(', ')}\n`
          : '') +
        `\nNous allons le mesurer et peser. On revient vers vous rapidement pour la suite.\n\n_Expedîle_`;
      window.open(waLink(cl.tel, msg), '_blank');
    }

    const label = sendWA ? 'réceptionné + WhatsApp envoyé' : 'réceptionné';
    flash(`Colis ${newColis.ref} ${label} — casier ${nf.casier.trim()}`);
    resetAndClose();
  };

  // ── submit (client) ───────────────────────────────────────
  const handleAnnonce = () => {
    if (!validate()) return;
    const clientId = authCl?.id;
    const newColis = buildColis(clientId, 'annonce');
    setData((prev) => [...prev, newColis]);
    flash(`Pré-annonce ${newColis.ref} enregistrée`);
    resetAndClose();
  };

  // ── build colis object ────────────────────────────────────
  const buildColis = (clientId, statut) => {
    const ref = nextRef(data);
    const trackings = nf.trackings.map((t) => t.trim()).filter((t) => t);
    const factures =
      !isStaff && nf.facUploaded && nf.facVendeur.trim()
        ? [
            {
              id: 'f_' + uid(),
              vendeur: nf.facVendeur.trim(),
              montant: parseFloat(nf.facMontant) || 0,
              valide: false,
            },
          ]
        : [];

    return {
      id: 'p_' + uid(),
      clientId,
      ref,
      statut,
      trackings,
      desc: nf.d.trim(),
      valeur: parseFloat(nf.v) || 0,
      dimL: null,
      dimW: null,
      dimH: null,
      poids: null,
      finL: null,
      finW: null,
      finH: null,
      finP: null,
      estMin: null,
      estMax: null,
      feuVert: null,
      devisTransport: null,
      devisOM: null,
      devisOMR: null,
      devisTVA: null,
      devisTotal: null,
      paiementMontant: null,
      factures,
      lignes: [],
      messages: [],
      envoi: null,
      casier: isStaff ? nf.casier.trim() : null,
    };
  };

  // ── shared field styles ───────────────────────────────────
  const inputCls = (err) =>
    `w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors ${
      err
        ? 'border-red-400 bg-red-50 focus:border-red-500'
        : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
    }`;

  const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

  const isMatchMode = isStaff && matchedAnnonce;

  // ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-black text-gray-900">
              {isStaff
                ? isMatchMode
                  ? 'Rattacher une pré-annonce'
                  : 'Réceptionner un colis'
                : 'Pré-annoncer un colis'}
            </h2>
            {isStaff && isMatchMode && (
              <p className="text-xs text-gray-400 mt-0.5">
                Le colis physique sera rattaché à la pré-annonce {matchedAnnonce.ref}
              </p>
            )}
          </div>
          <button
            onClick={resetAndClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── CLIENT (staff only) ── */}
          {isStaff && !newClientMode && (
            <div>
              <label className={labelCls}>Client</label>
              <div className="relative">
                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    placeholder="Rechercher un client…"
                    value={clientSearchQ}
                    onChange={(e) => {
                      setClientSearchQ(e.target.value);
                      setSelectedClient(null);
                      setMatchedAnnonce(null);
                      setClientSearchOpen(true);
                    }}
                    onFocus={() => setClientSearchOpen(true)}
                    className={`w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm outline-none transition-colors ${
                      formErr.client
                        ? 'border-red-400 bg-red-50 focus:border-red-500'
                        : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
                    }`}
                    autoComplete="off"
                  />
                </div>

                {/* Dropdown */}
                {clientSearchOpen && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                    {filteredClients.length === 0 && clientSearchQ.trim() ? (
                      <div className="px-4 py-3 text-center">
                        <p className="text-sm text-gray-400 mb-2">Aucun client trouvé</p>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setNewClientMode(true);
                            setNewClientForm((prev) => ({ ...prev, nom: clientSearchQ.trim() }));
                            setClientSearchOpen(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
                          style={{ background: BRAND.navy }}
                        >
                          <UserPlus size={13} />
                          Créer « {clientSearchQ.trim()} »
                        </button>
                      </div>
                    ) : (
                      <>
                        {filteredClients.map((cl) => {
                          const dest = getDestByCP(cl.cp);
                          const annonces = data.filter((p) => p.clientId === cl.id && p.statut === 'annonce');
                          return (
                            <button
                              key={cl.id}
                              type="button"
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 text-left transition-colors"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSelectClient(cl)}
                            >
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-xs font-black text-white">
                                {cl.nom.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-gray-900 truncate">
                                  {cl.nom}
                                </div>
                                <div className="text-xs text-gray-500 flex items-center gap-1 truncate">
                                  <span>{dest.flag}</span>
                                  <span>{dest.label}</span>
                                  <span className="opacity-40">·</span>
                                  <span>{cl.ville}</span>
                                </div>
                              </div>
                              {annonces.length > 0 && (
                                <span
                                  className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{ background: `${BRAND.gold}25`, color: BRAND.goldD }}
                                >
                                  {annonces.length} annonce{annonces.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {/* Create new client option at bottom */}
                        <div className="border-t border-gray-100">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setNewClientMode(true);
                              setNewClientForm((prev) => ({ ...prev, nom: clientSearchQ.trim() }));
                              setClientSearchOpen(false);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-emerald-50 text-left transition-colors"
                          >
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                              <UserPlus size={14} className="text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-emerald-700">
                                Nouveau client
                              </div>
                              <div className="text-xs text-gray-400">
                                Créer une fiche client rapidement
                              </div>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {formErr.client && (
                <p className="mt-1 text-xs text-red-500">{formErr.client}</p>
              )}
            </div>
          )}

          {/* ── INLINE NEW CLIENT FORM ── */}
          {isStaff && newClientMode && (
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: '#10B981', background: '#F0FDF4' }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <UserPlus size={15} className="text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-800">Nouveau client</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewClientMode(false);
                    setNewClientForm(EMPTY_NEW_CLIENT);
                    setNewClientErr({});
                  }}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600"
                >
                  Annuler
                </button>
              </div>
              <div>
                <label className={labelCls}>Nom complet</label>
                <input
                  type="text"
                  placeholder="Ex: Jean DUPONT"
                  value={newClientForm.nom}
                  onChange={(e) => setNCField('nom', e.target.value)}
                  className={inputCls(newClientErr.nom)}
                />
                {newClientErr.nom && <p className="mt-1 text-xs text-red-500">{newClientErr.nom}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Ville</label>
                  <input
                    type="text"
                    placeholder="Saint-Denis"
                    value={newClientForm.ville}
                    onChange={(e) => setNCField('ville', e.target.value)}
                    className={inputCls(false)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Code postal</label>
                  <input
                    type="text"
                    placeholder="97400"
                    value={newClientForm.cp}
                    onChange={(e) => setNCField('cp', e.target.value)}
                    className={inputCls(newClientErr.cp)}
                  />
                  {newClientErr.cp && <p className="mt-1 text-xs text-red-500">{newClientErr.cp}</p>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Téléphone <span className="normal-case text-gray-400 font-normal">(pour WhatsApp)</span></label>
                <input
                  type="tel"
                  placeholder="+262 692 12 34 56"
                  value={newClientForm.tel}
                  onChange={(e) => setNCField('tel', e.target.value)}
                  className={inputCls(newClientErr.tel)}
                />
                {newClientErr.tel && <p className="mt-1 text-xs text-red-500">{newClientErr.tel}</p>}
              </div>
              <div>
                <label className={labelCls}>Email <span className="normal-case text-gray-400 font-normal">(facultatif)</span></label>
                <input
                  type="email"
                  placeholder="jean.dupont@gmail.com"
                  value={newClientForm.email}
                  onChange={(e) => setNCField('email', e.target.value)}
                  className={inputCls(false)}
                />
              </div>
            </div>
          )}

          {/* ── PRE-ANNOUNCEMENTS FOR SELECTED CLIENT (staff only) ── */}
          {isStaff && selectedClient && pendingAnnonces.length > 0 && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: `${BRAND.gold}60` }}
            >
              <div
                className="px-4 py-2.5 flex items-center gap-2"
                style={{ background: `${BRAND.gold}15` }}
              >
                <Link2 size={13} style={{ color: BRAND.goldD }} />
                <span className="text-xs font-bold" style={{ color: BRAND.goldD }}>
                  {pendingAnnonces.length} pré-annonce{pendingAnnonces.length > 1 ? 's' : ''} en attente
                </span>
                <span className="ml-auto text-[10px] text-gray-400">
                  Cliquez pour rattacher
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingAnnonces.map((a) => {
                  const isSelected = matchedAnnonce?.id === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
                        isSelected
                          ? 'bg-blue-50 ring-2 ring-inset ring-blue-400'
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => handleSelectAnnonce(a)}
                    >
                      <div
                        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{
                          background: isSelected ? BRAND.navy : `${BRAND.navy}10`,
                        }}
                      >
                        <Package size={14} style={{ color: isSelected ? 'white' : BRAND.navy }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black" style={{ color: BRAND.navy }}>
                            {a.ref}
                          </span>
                          <Badge statut={a.statut} />
                        </div>
                        <p className="text-xs text-gray-600 truncate mt-0.5">{a.desc}</p>
                        {a.trackings?.some((t) => t) && (
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                            {trackStr(a)}
                          </p>
                        )}
                      </div>
                      <ChevronRight
                        size={14}
                        className={`flex-shrink-0 transition-colors ${
                          isSelected ? 'text-blue-500' : 'text-gray-300'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              {!matchedAnnonce && (
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                  <p className="text-[10px] text-gray-400 text-center">
                    Ou remplissez le formulaire ci-dessous pour une réception à l'aveugle
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Match mode: just need casier ── */}
          {isMatchMode && (
            <div>
              <label className={labelCls}>Numéro de casier</label>
              <input
                type="text"
                placeholder="Ex: A-03"
                value={nf.casier}
                onChange={(e) => {
                  setField('casier', e.target.value);
                  if (formErr.casier) setFormErr((prev) => ({ ...prev, casier: undefined }));
                }}
                className={inputCls(formErr.casier)}
                autoFocus
              />
              {formErr.casier && (
                <p className="mt-1 text-xs text-red-500">{formErr.casier}</p>
              )}
            </div>
          )}

          {/* ── Standard form fields (hidden in match mode) ── */}
          {!isMatchMode && (
            <>
              {/* ── TRACKINGS ── */}
              <div>
                <label className={labelCls}>
                  Numéros de tracking
                  <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                </label>
                <div className="space-y-2">
                  {nf.trackings.map((t, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Ex: AMZ-882939`}
                        value={t}
                        onChange={(e) => setTracking(idx, e.target.value)}
                        className="flex-1 rounded-xl border border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors font-mono"
                      />
                      {nf.trackings.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTracking(idx)}
                          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          aria-label="Supprimer"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addTracking}
                  className="mt-2 text-xs font-semibold text-blue-500 hover:text-blue-700 transition-colors"
                >
                  + Ajouter un tracking
                </button>
              </div>

              {/* ── DESCRIPTION ── */}
              <div>
                <label className={labelCls}>Description du contenu</label>
                <input
                  type="text"
                  placeholder="Ex: Casque Sony + Coque iPhone"
                  value={nf.d}
                  onChange={(e) => {
                    setField('d', e.target.value);
                    if (formErr.d) setFormErr((prev) => ({ ...prev, d: undefined }));
                  }}
                  className={inputCls(formErr.d)}
                />
                {formErr.d && (
                  <p className="mt-1 text-xs text-red-500">{formErr.d}</p>
                )}
              </div>

              {/* ── VALEUR ── */}
              <div>
                <label className={labelCls}>
                  Valeur déclarée
                  <span className="ml-1 normal-case text-gray-400 font-normal">(€, facultatif)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex: 89.99"
                  value={nf.v}
                  onChange={(e) => setField('v', e.target.value)}
                  className={inputCls(false)}
                />
              </div>

              {/* ── CASIER (staff only) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>Numéro de casier</label>
                  <input
                    type="text"
                    placeholder="Ex: A-03"
                    value={nf.casier}
                    onChange={(e) => {
                      setField('casier', e.target.value);
                      if (formErr.casier) setFormErr((prev) => ({ ...prev, casier: undefined }));
                    }}
                    className={inputCls(formErr.casier)}
                  />
                  {formErr.casier && (
                    <p className="mt-1 text-xs text-red-500">{formErr.casier}</p>
                  )}
                </div>
              )}

              {/* ── FACTURE (client only) ── */}
              {!isStaff && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <FileText size={15} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Facture d'origine</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Joindre la facture permet de calculer les taxes (Octroi de Mer) plus rapidement.
                      </p>
                    </div>
                  </div>

                  {/* Toggle uploaded */}
                  <label className="flex items-center gap-2 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={nf.facUploaded}
                      onChange={(e) => setField('facUploaded', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">J'ai une facture à transmettre</span>
                  </label>

                  {nf.facUploaded && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className={labelCls}>Vendeur / Boutique</label>
                        <input
                          type="text"
                          placeholder="Ex: Amazon, Fnac, Nike…"
                          value={nf.facVendeur}
                          onChange={(e) => setField('facVendeur', e.target.value)}
                          className={inputCls(false)}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Montant de la facture (€)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Ex: 89.99"
                          value={nf.facMontant}
                          onChange={(e) => setField('facMontant', e.target.value)}
                          className={inputCls(false)}
                        />
                      </div>
                      <p className="text-xs text-gray-400">
                        Envoyez la photo ou le PDF par WhatsApp ou email après avoir soumis la pré-annonce.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer / Actions ── */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white">
          {isStaff ? (
            isMatchMode ? (
              /* ── Match mode footer ── */
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMatchedAnnonce(null)}
                  className="flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
                >
                  Retour
                </button>
                <button
                  type="button"
                  onClick={() => handleMatchReception(false)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all flex items-center justify-center gap-1.5"
                  style={{ background: BRAND.navy }}
                >
                  <Link2 size={14} />
                  Rattacher
                </button>
                <button
                  type="button"
                  onClick={() => handleMatchReception(true)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-green-600 hover:bg-green-700 active:scale-95 transition-all"
                >
                  + WhatsApp
                </button>
              </div>
            ) : (
              /* ── Normal / blind reception footer ── */
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => handleReceptionner(false)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all"
                >
                  Réceptionner
                </button>
                <button
                  type="button"
                  onClick={() => handleReceptionner(true)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-green-600 hover:bg-green-700 active:scale-95 transition-all"
                >
                  + WhatsApp
                </button>
              </div>
            )
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={resetAndClose}
                className="flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleAnnonce}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all"
              >
                Envoyer ma pré-annonce
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

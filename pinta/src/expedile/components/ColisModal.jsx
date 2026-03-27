import React, { useState, useMemo } from 'react';
import { X, FileText, Search, UserPlus, Ruler, Package, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BRAND, STATUTS, getDestByCP } from '../constants';
import { uid, searchClients, waLink } from '../utils';
import { Badge } from './ui';

const EMPTY_FORM = {
  trackingLines: [{ fournisseur: '', tracking: '' }],
  d: '',
  v: '',
  c: '',
  casier: '',
  notesReception: '',
  facUploaded: false,
  facVendeur: '',
  facMontant: '',
  facFichier: null,
  facFichierNom: '',
  // Dimensions (optional at reception) — single colis
  dimL: '',
  dimW: '',
  dimH: '',
  poids: '',
  // Multi-colis dims keyed by index: { 0: { dimL, dimW, dimH, poids }, 1: ... }
  multiDims: {},
  showDims: false,
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

  // ── Mode: null = choix (ou auto-nouveau si pas de regroupables), 'rattacher', 'nouveau' ──
  const [mode, setMode] = useState(null);
  const [rattacherTarget, setRattacherTarget] = useState(null);

  // ── State ──
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClientForm, setNewClientForm] = useState(EMPTY_NEW_CLIENT);
  const [newClientErr, setNewClientErr] = useState({});

  if (!open) return null;

  // ── helpers ──────────────────────────────────────────────
  const setField = (key, val) => setNf((prev) => ({ ...prev, [key]: val }));

  const setTracking = (idx, field, val) => {
    setNf((prev) => {
      const trackingLines = prev.trackingLines.map((line, i) =>
        i === idx ? { ...line, [field]: val } : line
      );
      return { ...prev, trackingLines };
    });
  };

  const addTracking = () => {
    setNf((prev) => ({ ...prev, trackingLines: [...prev.trackingLines, { fournisseur: '', tracking: '' }] }));
  };

  const removeTracking = (idx) => {
    setNf((prev) => {
      const trackingLines = prev.trackingLines.filter((_, i) => i !== idx);
      return { ...prev, trackingLines: trackingLines.length > 0 ? trackingLines : [{ fournisseur: '', tracking: '' }] };
    });
  };

  const resetAndClose = () => {
    setNf(EMPTY_FORM);
    setFormErr({});
    setClientSearchQ('');
    setClientSearchOpen(false);
    setSelectedClient(null);
    setMode(null);
    setRattacherTarget(null);
    setNewClientMode(false);
    setNewClientForm(EMPTY_NEW_CLIENT);
    setNewClientErr({});
    onClose();
  };

  // ── client search ─────────────────────────────────────────
  const filteredClients = clientSearchQ.trim()
    ? searchClients(clients, clientSearchQ)
    : clients.slice(0, 8);

  const STATUTS_REGROUPABLES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise'];

  const regroupables = selectedClient
    ? data.filter((c) => c.clientId === selectedClient.id && STATUTS_REGROUPABLES.includes(c.statut))
    : [];

  const handleSelectClient = (cl) => {
    setSelectedClient(cl);
    setClientSearchQ(cl.nom);
    setClientSearchOpen(false);
    setNewClientMode(false);
    setFormErr((prev) => ({ ...prev, client: undefined }));
    // Reset mode — will show choice if regroupables, else auto-nouveau
    setMode(null);
    setRattacherTarget(null);
    // Check regroupables for this client immediately
    const hasRegroupables = data.some(
      (c) => c.clientId === cl.id && STATUTS_REGROUPABLES.includes(c.statut)
    );
    if (!hasRegroupables) {
      setMode('nouveau');
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
      if (!nf.d.trim()) errs.d = 'Description requise';
      if (!nf.casier.trim()) errs.casier = 'Numéro de casier requis';
    } else {
      if (!nf.d.trim()) errs.d = 'Description requise';
    }
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── submit: rattacher à un EXP existant ──────────────
  const handleRattacher = () => {
    if (!rattacherTarget) return;
    const lines = nf.trackingLines || [{ fournisseur: '', tracking: '' }];
    const newTrackings = lines.filter((l) => l.tracking.trim());

    if (newTrackings.length === 0 && !nf.casier.trim()) {
      setFormErr({ tracking: 'Saisissez au moins un tracking ou un casier' });
      return;
    }

    const existing = rattacherTarget;
    const existingTrackings = existing.trackings?.filter((t) => t) || [];
    const existingDetail = existing.trackingsDetail || [];

    const updatedTrackings = [
      ...existingTrackings,
      ...newTrackings.map((l) => l.tracking.trim()),
    ];
    const updatedDetail = [
      ...existingDetail,
      ...newTrackings.map((l) => ({ number: l.tracking.trim(), fournisseur: l.fournisseur.trim() })),
    ];

    const changes = {
      trackings: updatedTrackings,
      trackingsDetail: updatedDetail,
      nbColis: updatedTrackings.length,
    };

    // Remettre en receptionne si mesuré (il faut re-mesurer)
    if (existing.statut === 'mesure') {
      changes.statut = 'receptionne';
      changes.dimL = null;
      changes.dimW = null;
      changes.dimH = null;
      changes.poids = null;
      changes.dimsParColis = [];
    }

    if (nf.casier?.trim()) changes.casier = nf.casier.trim();
    if (nf.notesReception?.trim()) changes.notesReception = (existing.notesReception ? existing.notesReception + '\n' : '') + nf.notesReception.trim();

    upd(existing.id, changes);
    flash(`Carton rattaché à ${existing.ref} — ${updatedTrackings.length} colis au total`);
    resetAndClose();
  };

  // ── submit: staff new colis (reception) ──────────────
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

    // ── Subscription expiry check ──
    if (cl && cl.abonnement && cl.abonnement !== 'freemium' && cl.abonnementFin) {
      const fin = new Date(cl.abonnementFin);
      if (fin < new Date()) {
        setFormErr({ client: "L'abonnement de ce client a expiré. Renouvellement nécessaire avant de réceptionner un colis." });
        return;
      }
    }

    const newColis = buildColis(clientId, 'receptionne');
    setData((prev) => [...prev, newColis]);

    // Auto-group: move all other active colis of this client to the same casier
    if (nf.casier.trim()) {
      const newCasier = nf.casier.trim();
      data.forEach((c) => {
        if (c.clientId === clientId && c.id !== newColis.id
            && c.statut !== 'livre' && c.statut !== 'annule'
            && c.casier !== newCasier) {
          const oldCasier = c.casier;
          const historique = c.casierHistorique || [];
          if (oldCasier) {
            historique.push({ casier: oldCasier, date: new Date().toISOString() });
          }
          upd(c.id, { casier: newCasier, casierHistorique: historique });
        }
      });
    }

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

    const hasDims = nf.trackingLines.every((_, i) => {
      const d = nf.multiDims[i] || {};
      return d.dimL && d.dimW && d.dimH && d.poids;
    });
    const label = sendWA ? 'réceptionné + WhatsApp envoyé' : 'réceptionné';
    flash(`Colis ${newColis.ref} ${label}${hasDims ? ' + mesuré' : ''} — casier ${nf.casier.trim()}`);
    resetAndClose();
  };

  // ── build colis object ────────────────────────────────────
  const buildColis = (clientId, statut) => {
    const ref = nextRef(data);
    const trackings = nf.trackingLines.map((t) => t.tracking.trim()).filter((t) => t);
    const trackingsDetail = nf.trackingLines
      .filter((t) => t.tracking.trim())
      .map((t) => ({ number: t.tracking.trim(), fournisseur: t.fournisseur.trim() }));
    const factures =
      !isStaff && nf.facUploaded && nf.facVendeur.trim()
        ? [
            {
              id: 'f_' + uid(),
              vendeur: nf.facVendeur.trim(),
              montant: parseFloat(nf.facMontant) || 0,
              valide: false,
              fichier: nf.facFichier || null,
              fichierNom: nf.facFichierNom || null,
            },
          ]
        : [];

    // Detect per-carton dims (always use multiDims keyed by trackingLine index)
    let hasDims = false;
    let dimL = null, dimW = null, dimH = null, poids = null;
    let dimsParColis = [];

    if (isStaff) {
      const lineCount = nf.trackingLines.length;
      const allFilled = Array.from({ length: lineCount }, (_, i) => i).every((i) => {
        const d = nf.multiDims[i] || {};
        return d.dimL && d.dimW && d.dimH && d.poids;
      });
      if (allFilled) {
        hasDims = true;
        dimsParColis = Array.from({ length: lineCount }, (_, i) => {
          const d = nf.multiDims[i];
          return { dimL: parseFloat(d.dimL), dimW: parseFloat(d.dimW), dimH: parseFloat(d.dimH), poids: parseFloat(d.poids) };
        });
        const totalPoids = dimsParColis.reduce((s, d) => s + d.poids, 0);
        dimL = Math.max(...dimsParColis.map((d) => d.dimL));
        dimW = Math.max(...dimsParColis.map((d) => d.dimW));
        dimH = Math.max(...dimsParColis.map((d) => d.dimH));
        poids = Math.round(totalPoids * 100) / 100;
      }
    }

    const finalStatut = hasDims ? 'mesure' : statut;

    return {
      id: 'p_' + uid(),
      clientId,
      ref,
      statut: finalStatut,
      trackings,
      trackingsDetail,
      desc: nf.d.trim() || (nf.trackingLines[0]?.fournisseur?.trim() || ''),
      notesReception: nf.notesReception.trim() || null,
      valeur: null,
      dimL,
      dimW,
      dimH,
      poids,
      dimsParColis,
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
      dateReception: isStaff ? new Date().toISOString() : null,
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

  const isMatchMode = false;

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
              Réceptionner un colis
            </h2>
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

              {/* ── CHOIX : RATTACHER OU NOUVEAU ── */}
              {selectedClient && !mode && regroupables.length > 0 && (
                  <div className="mt-2 space-y-3">
                    <div
                      className="rounded-xl border p-3 space-y-3"
                      style={{ borderColor: BRAND.gold + '60', background: BRAND.gold + '08' }}
                    >
                      <div className="flex items-center gap-2">
                        <Package size={14} style={{ color: BRAND.goldD }} />
                        <span className="text-xs font-bold" style={{ color: BRAND.goldD }}>
                          Ce client a {regroupables.length} colis en entrepôt
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Ce carton fait partie d'une expédition existante ?
                      </p>
                      <div className="space-y-2">
                        {regroupables.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setMode('rattacher'); setRattacherTarget(c); }}
                            className="w-full flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-left active:scale-[0.98]"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-black text-sm" style={{ color: BRAND.navy }}>{c.ref}</span>
                                {c.casier && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}>
                                    {c.casier}
                                  </span>
                                )}
                                <Badge statut={c.statut} />
                              </div>
                              <p className="text-xs text-gray-500 truncate mt-0.5">{c.desc}</p>
                              {c.trackings?.filter((t) => t).length > 0 && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  {c.trackings.filter((t) => t).length} carton{c.trackings.filter((t) => t).length > 1 ? 's' : ''} déjà rattaché{c.trackings.filter((t) => t).length > 1 ? 's' : ''}
                                </p>
                              )}
                            </div>
                            <span className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: BRAND.navy, color: 'white' }}>
                              Ajouter ici
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="relative flex items-center gap-3">
                      <div className="flex-1 border-t border-gray-200" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase">ou</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>

                    <button
                      type="button"
                      onClick={() => setMode('nouveau')}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all active:scale-[0.98]"
                    >
                      Créer une nouvelle expédition (nouveau EXP)
                    </button>
                  </div>
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

          {/* ── RATTACHER MODE: formulaire simplifié ── */}
          {mode === 'rattacher' && rattacherTarget && (
            <>
              <div className="rounded-xl border p-3" style={{ borderColor: BRAND.navy + '30', background: BRAND.navy + '06' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Package size={14} style={{ color: BRAND.navy }} />
                  <span className="text-xs font-bold" style={{ color: BRAND.navy }}>
                    Ajouter un carton à {rattacherTarget.ref}
                  </span>
                  <button type="button" onClick={() => { setMode(null); setRattacherTarget(null); }} className="ml-auto text-[10px] text-gray-400 hover:text-gray-600">
                    Changer
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">{rattacherTarget.desc} · Casier {rattacherTarget.casier || '—'}</p>
              </div>

              {/* Tracking + fournisseur */}
              <div>
                <label className={labelCls}>Nouveau carton</label>
                {nf.trackingLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Fournisseur (Amazon, Zara...)"
                      value={line.fournisseur}
                      onChange={(e) => setTracking(idx, 'fournisseur', e.target.value)}
                      className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                    />
                    <input
                      type="text"
                      placeholder="N° tracking"
                      value={line.tracking}
                      onChange={(e) => setTracking(idx, 'tracking', e.target.value)}
                      className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                    />
                    {nf.trackingLines.length > 1 && (
                      <button type="button" onClick={() => removeTracking(idx)} className="text-gray-300 hover:text-red-500 px-1"><X size={14} /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addTracking} className="text-xs font-bold" style={{ color: BRAND.navy }}>+ Ajouter un tracking</button>
              </div>

              {/* Casier optionnel (si on veut changer) */}
              <div>
                <label className={labelCls}>Casier (laisser vide pour garder {rattacherTarget.casier || 'l\'actuel'})</label>
                <input
                  type="text"
                  placeholder={rattacherTarget.casier || 'Ex: A-03'}
                  value={nf.casier}
                  onChange={(e) => setField('casier', e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>

              {formErr.tracking && <p className="text-xs text-red-500">{formErr.tracking}</p>}
            </>
          )}

          {/* ── NOUVEAU MODE: formulaire complet ── */}
          {mode === 'nouveau' && (
            <>
              {/* ── CASIER (staff only, MANDATORY — first field for speed) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>
                    Casier <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: A-03"
                    value={nf.casier}
                    onChange={(e) => {
                      setField('casier', e.target.value);
                      if (formErr.casier) setFormErr((prev) => ({ ...prev, casier: undefined }));
                    }}
                    className={inputCls(formErr.casier)}
                    autoFocus={isStaff && !!selectedClient}
                  />
                  {formErr.casier && (
                    <p className="mt-1 text-xs text-red-500">{formErr.casier}</p>
                  )}
                </div>
              )}

              {/* ── DESCRIPTION (origin/supplier) ── */}
              <div>
                <label className={labelCls}>
                  {isStaff ? 'Origine / Fournisseur' : 'Origine du colis'}
                  {isStaff && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type="text"
                  placeholder="Ex: Amazon, Temu, Shein, Nike…"
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

              {/* ── TRACKINGS ── */}
              <div>
                <label className={labelCls}>
                  Numéros de tracking
                  <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                </label>
                <div className="space-y-2">
                  {nf.trackingLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Amazon, Zara..."
                        value={line.fournisseur}
                        onChange={(e) => setTracking(idx, 'fournisseur', e.target.value)}
                        className="w-2/5 rounded-xl border border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors"
                      />
                      <input
                        type="text"
                        placeholder="LP123456FR"
                        value={line.tracking}
                        onChange={(e) => setTracking(idx, 'tracking', e.target.value)}
                        className="flex-1 rounded-xl border border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors font-mono"
                      />
                      {nf.trackingLines.length > 1 && (
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

              {/* ── NOTES DE RECEPTION (staff) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>
                    Notes de réception
                    <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                  </label>
                  <textarea
                    placeholder="Ex: Carton abimé, scotch arraché, colis ouvert..."
                    value={nf.notesReception}
                    onChange={(e) => setField('notesReception', e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 focus:border-amber-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors"
                  />
                </div>
              )}

              {/* ── DIMENSIONS (staff only, optional — saves a step if filled) ── */}
              {isStaff && (() => {
                const dimInputCls = "w-full px-2.5 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:border-blue-400";
                const updateMultiDim = (idx, field, val) => setNf((prev) => ({
                  ...prev,
                  multiDims: {
                    ...prev.multiDims,
                    [idx]: { ...(prev.multiDims[idx] || { dimL: '', dimW: '', dimH: '', poids: '' }), [field]: val },
                  },
                }));

                if (!nf.showDims) {
                  return (
                    <div>
                      <button
                        type="button"
                        onClick={() => setField('showDims', true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm font-bold text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-all"
                      >
                        <Ruler size={15} />
                        Mesurer maintenant
                        <span className="text-[10px] font-normal text-gray-400 ml-1">(sinon plus tard)</span>
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Ruler size={13} className="text-blue-600" />
                        <span className="text-xs font-bold text-blue-800">
                          Dimensions ({nf.trackingLines.length} colis)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setField('showDims', false);
                          setField('dimL', '');
                          setField('dimW', '');
                          setField('dimH', '');
                          setField('poids', '');
                          setField('multiDims', {});
                        }}
                        className="text-[10px] font-medium text-gray-400 hover:text-gray-600"
                      >
                        Mesurer plus tard
                      </button>
                    </div>

                    {/* ── Per-carton dims (always one block per tracking line) ── */}
                    <div className="space-y-3">
                      {nf.trackingLines.map((line, idx) => {
                        const d = nf.multiDims[idx] || { dimL: '', dimW: '', dimH: '', poids: '' };
                        const label = line.fournisseur.trim() || ('Tracking ' + (idx + 1));
                        return (
                          <div key={idx} className="rounded-lg border border-blue-100 bg-white p-2.5 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                              Colis {idx + 1} — {label}
                            </p>
                            <div className="grid grid-cols-4 gap-1.5">
                              <div>
                                <label className="text-[9px] font-bold text-gray-400 block mb-0.5">L</label>
                                <input type="number" min="0" step="0.5" placeholder="40"
                                  value={d.dimL} onChange={(e) => updateMultiDim(idx, 'dimL', e.target.value)}
                                  className={dimInputCls} />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-gray-400 block mb-0.5">l</label>
                                <input type="number" min="0" step="0.5" placeholder="30"
                                  value={d.dimW} onChange={(e) => updateMultiDim(idx, 'dimW', e.target.value)}
                                  className={dimInputCls} />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-gray-400 block mb-0.5">H</label>
                                <input type="number" min="0" step="0.5" placeholder="20"
                                  value={d.dimH} onChange={(e) => updateMultiDim(idx, 'dimH', e.target.value)}
                                  className={dimInputCls} />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-gray-400 block mb-0.5">kg</label>
                                <input type="number" min="0" step="0.1" placeholder="2.5"
                                  value={d.poids} onChange={(e) => updateMultiDim(idx, 'poids', e.target.value)}
                                  className={dimInputCls} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

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
                      {/* File upload */}
                      <div>
                        <label className={labelCls}>Photo / PDF de la facture</label>
                        {nf.facFichier ? (
                          <div className="flex items-center gap-2 p-2 rounded-xl bg-green-50 border border-green-200">
                            <img src={nf.facFichier} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-green-800 truncate">{nf.facFichierNom}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setField('facFichier', null); setField('facFichierNom', ''); }}
                              className="text-red-400 hover:text-red-600 p-1"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 font-medium cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                            <FileText size={16} />
                            Choisir un fichier
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setField('facFichier', reader.result);
                                  setField('facFichierNom', file.name);
                                };
                                reader.readAsDataURL(file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer / Actions ── */}
        {mode && (
          <div className="px-5 py-4 border-t border-gray-100 bg-white">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={mode === 'rattacher' ? () => { setMode(null); setRattacherTarget(null); } : resetAndClose}
                className="flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
              >
                {mode === 'rattacher' ? 'Retour' : 'Annuler'}
              </button>

              {mode === 'rattacher' ? (
                <button
                  type="button"
                  onClick={handleRattacher}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                  style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                >
                  Rattacher à {rattacherTarget?.ref}
                </button>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

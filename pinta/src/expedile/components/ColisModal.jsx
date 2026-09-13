import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Search, UserPlus, Package, MapPin, Camera } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { BRAND, STATUTS, getDestByCP, PRODUITS_INTERDITS, ABONNEMENTS } from '../constants';
import { MSG_TEMPLATES } from '../constants/templates';
import { uid, searchClients, telegramLink, getPrenom } from '../utils';
import { Badge } from './ui';
import * as sb from '../lib/supabaseData';
import { deliverMessage } from '../services/telegramApi';
import { supabase } from '../lib/supabase';
import { renderTemplate } from '../services/messageTemplates';
import { DEFAULT_BODIES } from '../services/messageDefaults';
import { useDialog } from './ui/useDialog';
import { receptionCartons, receptionMeasurements, receptionMeasurementIssues, receptionCartonManifest, mergeReceptionCartons, hasCompleteReceptionMeasurements, RECEPTION_MEASURES, removeReceptionCarton } from '../domain/reception';

function ReceptionInput({ label, ...props }) {
  return <label className="block min-w-0"><span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span><input {...props} /></label>;
}

function CartonFields({ lines, dimensions, setTracking, setDimension, addTracking, removeTracking, inputRefs, dimensionRefs, onScan, issues = [], cartonOffset = 0 }) {
  return <div className="space-y-3">
    <p className="text-sm font-semibold text-gray-800">Cartons reçus</p>
    <p className="text-xs text-gray-600">Mesurez et pesez chaque carton reçu ; fournisseur et suivi peuvent être ajoutés si connus. Entrée après un scan ajoute le suivant ; Tab parcourt les mesures.</p>
    {lines.map((line, idx) => <section key={idx} aria-label={`Carton ${cartonOffset + idx + 1}`} className="rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex justify-between items-center"><h3 className="text-sm font-bold text-gray-800">Carton {cartonOffset + idx + 1}</h3>{lines.length > 1 && <button type="button" onClick={() => removeTracking(idx)} aria-label={`Supprimer le carton ${cartonOffset + idx + 1}`} className="w-11 h-11 -my-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-700 flex items-center justify-center"><X size={16} /></button>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ReceptionInput label={`Fournisseur · carton ${cartonOffset + idx + 1}`} placeholder="Amazon, Zara…" value={line.fournisseur} onChange={event => setTracking(idx, 'fournisseur', event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm" />
        <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Numéro de suivi · carton {cartonOffset + idx + 1}</span><input ref={element => { inputRefs.current[idx] = element; }} value={line.tracking} onChange={event => setTracking(idx, 'tracking', event.target.value)} onKeyDown={event => onScan(event, idx)} placeholder="Scanner ou saisir le numéro" autoComplete="off" aria-invalid={issues.some(issue => issue.index === idx && issue.key === 'tracking')} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-mono" /></label>
      </div>
      <fieldset className="rounded-lg bg-gray-50 border border-gray-200 p-3">
        <legend className="px-1 text-xs font-bold text-gray-800">Mesures à réception — avant optimisation</legend>
        <div className="grid grid-cols-2 gap-3">
          {RECEPTION_MEASURES.map(({ key, label, unit }) => {
            const error = issues.find(issue => issue.index === idx && issue.key === key);
            return <label key={key} className="block min-w-0"><span className="block text-xs font-semibold text-gray-700 mb-1">{label} ({unit}) <span aria-hidden="true">*</span></span>
              <input ref={element => { dimensionRefs.current[`${idx}:${key}`] = element; }} aria-label={`${label} à réception (${unit}) · carton ${cartonOffset + idx + 1}`} aria-required="true" aria-invalid={!!error} aria-describedby={error ? `reception-${idx}-${key}-error` : undefined} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={key === 'poids' ? '2,5' : '40'} value={dimensions[idx]?.[key] ?? ''} onChange={event => setDimension(idx, key, event.target.value)} onFocus={event => event.currentTarget.scrollIntoView({ block: 'center' })} className={`w-full min-h-11 rounded-lg border px-2.5 py-2 text-sm bg-white ${error ? 'border-red-500' : 'border-gray-300'}`} />
              {error && <span id={`reception-${idx}-${key}-error`} className="block mt-1 text-xs text-red-700">Valeur supérieure à zéro requise.</span>}
            </label>;
          })}
        </div>
      </fieldset>
    </section>)}
    <button type="button" onClick={addTracking} className="w-full rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-sm font-semibold brand-t">+ Ajouter un carton</button>
  </div>;
}

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
  // Mandatory original measurements, one entry per physical carton. Never final packing dimensions.
  multiDims: {},
  photoFile: null,
};

const EMPTY_NEW_CLIENT = {
  nom: '', prenom: '', genre: '', dateNaissance: '',
  tel: '', telFixe: '', email: '',
  ville: '', cp: '', adresseLigne1: '', adresseLigne2: '', commune: '', infosLivraison: '',
  telegramUsername: '', canal: 'telegram',
  type: 'particulier', modePaiement: 'colis',
  abonnement: 'freemium', abonnementDebut: '', abonnementFin: '',
  notes: '',
  raisonSociale: '', siret: '', interlocuteur: '',
};

// Ref provisoire locale — sera remplacée par la ref unique Supabase dans insertColis
function nextRef() {
  return 'EXP-TMP-' + Date.now().toString(36).toUpperCase();
}

export default function ColisModal({ open, onClose, initialColisId, initialClientId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const appCtx = useApp();
  const { isStaff, authCl, clients, data, setData, flash, addNewClient, receptionner, upd, log } = appCtx;
  const produitsInterdits = appCtx.produitsInterdits || PRODUITS_INTERDITS;

  const [nf, setNf] = useState(EMPTY_FORM);
  const [formErr, setFormErr] = useState({});
  const [clientSearchQ, setClientSearchQ] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);

  // ── Mode: null = choix (ou auto-nouveau si pas de regroupables), 'rattacher', 'nouveau' ──
  const [mode, setMode] = useState(null);
  const [rattacherTarget, setRattacherTarget] = useState(null);

  const [checkedInterdits, setCheckedInterdits] = useState([]);

  // ── State ──
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClientForm, setNewClientForm] = useState(EMPTY_NEW_CLIENT);
  const [newClientErr, setNewClientErr] = useState({});

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const trackingRefs = useRef([]);
  const dimensionRefs = useRef({});
  const [pendingMeasureFocus, setPendingMeasureFocus] = useState(null);
  const initialisedRef = useRef(false);
  const [pendingFocus, setPendingFocus] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  useEffect(() => {
    if (!open || !initialClientId || initialColisId || initialisedRef.current) return;
    const client = clients.find((item) => item.id === initialClientId);
    if (!client) return;
    initialisedRef.current = true;
    setSelectedClient(client); setClientSearchQ(client.nom);
    setMode(data.some((item) => !item.archive && item.clientId === client.id && ['receptionne', 'mesure', 'attente_feu_vert', 'autorise'].includes(item.statut)) ? null : 'nouveau');
  }, [open, initialClientId, initialColisId, clients, data]);
  useEffect(() => {
    if (!open) { initialisedRef.current = false; return; }
    if (!initialColisId || initialisedRef.current) return;
    const target = data.find(colis => colis.id === initialColisId);
    const client = target && clients.find(item => item.id === target.clientId);
    if (!target || !client) return;
    initialisedRef.current = true;
    setSelectedClient(client); setClientSearchQ(client.nom); setMode('rattacher'); setRattacherTarget(target);
  }, [open, initialColisId, data, clients]);
  useEffect(() => {
    if (!open || saving || !pendingMeasureFocus) return;
    const { index, key } = pendingMeasureFocus;
    const input = key === 'tracking' ? trackingRefs.current[index] : dimensionRefs.current[`${index}:${key}`];
    input?.focus(); input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setPendingMeasureFocus(null);
  }, [open, saving, pendingMeasureFocus]);
  useEffect(() => {
    if (pendingFocus !== null && open) { trackingRefs.current[pendingFocus]?.focus(); setPendingFocus(null); }
  }, [nf.trackingLines.length, open, pendingFocus]);
  useEffect(() => {
    if (!nf.photoFile) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(nf.photoFile); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [nf.photoFile]);
  // Validation from a previous expedition must not name its old carton numbers.
  useEffect(() => {
    setFormErr({});
    setSaveError('');
    setPendingMeasureFocus(null);
  }, [mode, rattacherTarget?.id]);
  const dialogRef=useDialog(open,()=>{if(!savingRef.current)resetAndClose();});
  const runSave = async action => {
    if(savingRef.current)return;
    savingRef.current=true;setSaving(true);setSaveError('');
    try {await action();} catch(error) {setSaveError(error.message);flash({msg:error.message,type:'error'});}
    finally {savingRef.current=false;setSaving(false);}
  };
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
    setPendingFocus(nf.trackingLines.length);
    setNf((prev) => ({ ...prev, trackingLines: [...prev.trackingLines, { fournisseur: '', tracking: '' }] }));
  };

  const removeTracking = (idx) => {
    setNf((prev) => removeReceptionCarton(prev, idx));
    setFormErr(prev => ({ ...prev, measurements: undefined, dimensions: undefined }));
  };
  const onScan = (event, idx) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!nf.trackingLines[idx].tracking.trim()) return;
    if (nf.trackingLines[idx + 1]) trackingRefs.current[idx + 1]?.focus();
    else addTracking();
  };
  const setDimension = (index, key, value) => {
    setNf(prev => ({ ...prev, multiDims: { ...prev.multiDims, [index]: { ...prev.multiDims[index], [key]: value } } }));
    setFormErr(prev => ({ ...prev, measurements: (prev.measurements || []).filter(issue => issue.index !== index || issue.key !== key), dimensions: undefined }));
  };
  // Continue the selected expedition's physical carton numbering, independent of tracking coverage.
  const cartonOffset = mode === 'rattacher' && rattacherTarget ? receptionCartonManifest(rattacherTarget).nbColis : 0;
  const cartonFields = <CartonFields cartonOffset={cartonOffset} lines={nf.trackingLines} dimensions={nf.multiDims} setDimension={setDimension} setTracking={setTracking} addTracking={addTracking} removeTracking={removeTracking} inputRefs={trackingRefs} dimensionRefs={dimensionRefs} onScan={onScan} issues={formErr.measurements} />;

  const resetAndClose = () => {
    setNf(EMPTY_FORM);
    setSaveError('');
    setPendingFocus(null);
    setPendingMeasureFocus(null);
    setFormErr({});
    setClientSearchQ('');
    setClientSearchOpen(false);
    setSelectedClient(null);
    setMode(null);
    setRattacherTarget(null);
    setNewClientMode(false);
    setNewClientForm(EMPTY_NEW_CLIENT);
    setNewClientErr({});
    setCheckedInterdits([]);
    onClose();
  };

  // ── client search ─────────────────────────────────────────
  const filteredClients = clientSearchQ.trim()
    ? searchClients(clients, clientSearchQ)
    : clients.slice(0, 8);

  const STATUTS_REGROUPABLES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise'];

  const regroupables = selectedClient
    ? data.filter((c) => !c.archive && c.clientId === selectedClient.id && STATUTS_REGROUPABLES.includes(c.statut))
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
      (c) => !c.archive && c.clientId === cl.id && STATUTS_REGROUPABLES.includes(c.statut)
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
    if (newClientForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newClientForm.email.trim())) errs.contact = 'Adresse email invalide';
    if (!newClientForm.email.trim() && !newClientForm.telegramUsername.trim()) errs.contact = 'Email ou Telegram requis (au moins un moyen de contact)';
    if (newClientForm.type === 'pro' && !newClientForm.raisonSociale.trim()) errs.raisonSociale = 'Raison sociale requise pour un pro';
    setNewClientErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── validation ────────────────────────────────────────────
  const validate = (rattacher = false) => {
    const errs = {};
    if (isStaff) {
      if (!selectedClient && !newClientMode) errs.client = 'Sélectionnez un client';
      if (!receptionCartons(nf.trackingLines, nf.multiDims).length) errs.d = 'Ajoutez au moins un carton et ses mesures à réception.';
      if (!rattacher && !nf.casier.trim()) errs.casier = 'Numéro de casier requis';
      const measurements = receptionMeasurementIssues(nf.trackingLines, nf.multiDims, cartonOffset);
      if (measurements.length) {
        errs.measurements = measurements;
        errs.dimensions = measurements[0].message;
        setPendingMeasureFocus(measurements[0]);
      }
    } else {
      if (!nf.d.trim()) errs.d = 'Description requise';
    }
    const numbers=nf.trackingLines.map(l=>l.tracking.trim()).filter(Boolean);
    const duplicates=numbers.find((number,index)=>numbers.indexOf(number)!==index);
    if(duplicates)errs.d=`Numéro saisi plusieurs fois : ${duplicates}`;
    const existing=data.find(c=>!c.archive&&!['livre','annule'].includes(c.statut)&&(c.trackings||[]).some(number=>numbers.includes(number)));
    if(existing)errs.d=`Ce numéro est déjà rattaché au dossier ${existing.ref}. Ouvrez ce dossier pour compléter la réception.`;
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── submit: rattacher à un EXP existant ──────────────
  const handleRattacher = async () => {
    if (!rattacherTarget) return;
    if (!validate(true)) return;
    const lines = nf.trackingLines || [{ fournisseur: '', tracking: '' }];
    const newCartons = receptionCartons(lines, nf.multiDims);
    const newTrackings = newCartons.filter(l=>l.tracking.trim());

    if (newCartons.length === 0 && !nf.casier.trim()) {
      setFormErr({ tracking: 'Saisissez au moins un tracking ou un casier' });
      return;
    }

    const numbers = newTrackings.map((line) => line.tracking.trim());
    const duplicate = numbers.find((number, index) => numbers.indexOf(number) !== index);
    const other = data.find((colis) => !colis.archive && !['livre', 'annule'].includes(colis.statut) && (colis.trackings || []).some((number) => numbers.includes(number)));
    if (duplicate || other) { setFormErr({ tracking: duplicate ? `Numéro saisi plusieurs fois : ${duplicate}` : `Numéro déjà présent dans ${other.ref}. Vérifiez le carton avant rattachement.` }); return; }

    const existing = rattacherTarget;
    const changes = mergeReceptionCartons(existing, lines, nf.multiDims);
    if (!changes) throw new Error('Mesures à réception incomplètes : vérifiez chaque nouveau carton.');
    if (checkedInterdits.length) {
      changes.checkInterdits = [...new Set([...(existing.checkInterdits || []), ...checkedInterdits])];
      changes.produitInterdit = true;
    }
    changes.statut = hasCompleteReceptionMeasurements(changes) ? 'mesure' : 'receptionne';

    // Un nouvel accord doit porter sur tous les cartons ; les mesures originales restent conservées.
    if (newCartons.length && ['mesure','autorise','attente_feu_vert'].includes(existing.statut)) {
      changes.feuVert = 'en_attente';
      changes.feuVertDate = null;
      changes.attenteClientUntil = null;
      changes.attenteClientDate = null;
      changes.attenteClientMotif = null;
      changes.demandeFeuVertEnvoyeeAt = null;
    }

    if (nf.casier?.trim()) changes.casier = nf.casier.trim();
    if (nf.notesReception?.trim()) changes.notesReception = (existing.notesReception ? existing.notesReception + '\n' : '') + nf.notesReception.trim();

    await upd(existing.id, changes, { expectedUpdatedAt: existing.updatedAt });
    flash(`${newCartons.length} carton${newCartons.length > 1 ? 's' : ''} rattaché${newCartons.length > 1 ? 's' : ''} à ${existing.ref} — ${changes.nbColis} cartons au total`);
    resetAndClose();
    // Open the dossier that actually received the cartons, keeping the current queue context.
    const sameDetail = location.pathname === `/colis/${existing.id}`;
    const query = new URLSearchParams(/^\/colis\/?$/.test(location.pathname) ? location.search : '');
    query.set('dossier', existing.id);
    navigate(sameDetail ? { pathname: location.pathname, search: location.search } : { pathname: '/colis', search: `?${query}` }, {
      state: { receivedCarton: { colisId: existing.id, index: receptionCartonManifest(existing).nbColis } },
    });
  };

  // ── submit: staff new colis (reception) ──────────────
  const handleReceptionner = async (sendTG) => {
    // If in new client mode, create client first
    let clientId;
    let cl;
    if (newClientMode) {
      if (!validateNewClient()) return;
      if (!validate()) return;
      clientId = await addNewClient({
        nom: newClientForm.nom.trim(),
        prenom: newClientForm.prenom.trim(),
        genre: newClientForm.genre || '',
        dateNaissance: newClientForm.dateNaissance || null,
        ville: newClientForm.ville.trim(),
        cp: newClientForm.cp.trim(),
        adresseLigne1: newClientForm.adresseLigne1.trim(),
        adresseLigne2: newClientForm.adresseLigne2.trim(),
        commune: newClientForm.commune.trim(),
        infosLivraison: newClientForm.infosLivraison.trim(),
        tel: newClientForm.tel.trim(),
        telFixe: newClientForm.telFixe.trim(),
        email: newClientForm.email.trim(),
        telegramUsername: newClientForm.telegramUsername.trim(),
        canal: newClientForm.telegramUsername.trim() ? 'telegram' : (newClientForm.email.trim() ? 'email' : 'telegram'),
        type: newClientForm.type,
        modePaiement: newClientForm.modePaiement,
        abonnement: newClientForm.abonnement,
        abonnementDebut: newClientForm.abonnementDebut || null,
        abonnementFin: newClientForm.abonnementFin || null,
        raisonSociale: newClientForm.raisonSociale.trim(),
        siret: newClientForm.siret.trim(),
        interlocuteur: newClientForm.interlocuteur.trim(),
        notes: newClientForm.notes.trim(),
        created: new Date().toISOString().slice(0, 10),
        points: 0,
      });
      cl = { ...newClientForm, id: clientId, nom: newClientForm.nom.trim(), tel: newClientForm.tel.trim() };
      setSelectedClient(cl); setNewClientMode(false); setClientSearchQ(cl.nom);
    } else {
      if (!validate()) return;
      clientId = selectedClient.id;
      cl = selectedClient;
    }

    // ── Subscription expiry check — réception autorisée mais avertissement ──
    const isSubExpired = cl && cl.abonnement && cl.abonnement !== 'freemium' && cl.abonnementFin && new Date(cl.abonnementFin) < new Date();
    const isAnnuelSub = cl && (cl.abonnement === 'premium_annuel' || cl.abonnement === 'vip');

    const colisTemplate = buildColis(clientId, 'receptionne');

    // Insert into Supabase, fallback to local
    let newColis = colisTemplate;
    try {
      const inserted = await sb.insertColis({
        clientId,
        desc: colisTemplate.desc,
        trackings: colisTemplate.trackings,
        trackingsDetail: colisTemplate.trackingsDetail,
        casier: colisTemplate.casier,
        dateReception: colisTemplate.dateReception,
        valeur: colisTemplate.valeur,
        notesReception: colisTemplate.notesReception,
        dimL: colisTemplate.dimL,
        dimW: colisTemplate.dimW,
        dimH: colisTemplate.dimH,
        poids: colisTemplate.poids,
        nbColis: colisTemplate.nbColis,
        dimsParColis: colisTemplate.dimsParColis,
        statut: colisTemplate.statut,
        checkInterdits: colisTemplate.checkInterdits,
        produitInterdit: colisTemplate.produitInterdit,
      });
      newColis = { ...colisTemplate, ...inserted };
    } catch (err) {
      throw new Error(`Réception non enregistrée : ${err.message}`);
    }
    setData((prev) => [...prev, newColis]);

    if (nf.photoFile) {
      try {
        const uploaded = await sb.uploadDocument('photos-colis',newColis.id,nf.photoFile);
        await sb.updateColis(newColis.id,{photoReception:true,photoReceptionUrl:uploaded.path});
      } catch(error) { flash({msg:`Colis enregistré, photo à ajouter : ${error.message}`,type:'warning'}); }
    }
    if (sendTG && cl && !cl.telegramChatId && !cl.userId) {
      flash({ msg: `Expédition ${newColis.ref} enregistrée. Accès client à activer : ouvrez sa fiche pour l’inviter ou préparez un email.`, type: 'warning', duration: 12000 });
    } else if (sendTG && cl) {
      try {
        const {data:queued,error}=await supabase.rpc('queue_message',{
          p_colis_id:newColis.id,p_text:renderTemplate(appCtx.messageTemplates.reception_telegram || DEFAULT_BODIES.reception_telegram,{client:cl,colis:newColis,destination:getDestByCP(cl.cp),settings:appCtx.settings}),
          p_template:'reception',p_idempotency_key:`receipt:${newColis.id}`,
          p_canal:cl.telegramChatId?'telegram':'portal',
        });
        if(error)throw error;
        if(cl.telegramChatId){
          const result=await deliverMessage(newColis.id,queued.message?.id || queued.message_id);
          if(!result.ok)throw new Error(result.error);
        }
        flash(`Colis ${newColis.ref} enregistré — notification ${cl.telegramChatId?'Telegram envoyée':'disponible dans l’espace client'}`);
      }catch(error){flash({msg:`Colis ${newColis.ref} enregistré. Notification à réessayer : ${error.message}`,type:'warning'});}
    }else flash(`Colis ${newColis.ref} réceptionné — casier ${nf.casier.trim()}`);

    const newId = newColis.id;
    resetAndClose();
    if (isStaff && newId) {
      navigate(`/colis/${newId}`);
    }
  };

  // ── build colis object ────────────────────────────────────
  const buildColis = (clientId, statut) => {
    const ref = nextRef();
    const cartons = receptionCartons(nf.trackingLines, nf.multiDims);
    const trackings = cartons.map((t) => t.tracking).filter(Boolean);
    const trackingsDetail = cartons.map((t) => ({ number: t.tracking, fournisseur: t.fournisseur }));
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

    const measurements = isStaff ? receptionMeasurements(nf.trackingLines, nf.multiDims) : null;
    const hasDims = Boolean(measurements);
    const { dimL = null, dimW = null, dimH = null, poids = null, dimsParColis = [] } = measurements || {};

    const finalStatut = hasDims ? 'mesure' : statut;

    return {
      id: 'p_' + uid(),
      clientId,
      ref,
      statut: finalStatut,
      trackings,
      trackingsDetail,
      nbColis: Math.max(1, cartons.length),
      desc: nf.d.trim() || [...new Set(nf.trackingLines.map((l) => l.fournisseur.trim()).filter(Boolean))].join(' + ') || 'Carton reçu',
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
      checkInterdits: checkedInterdits,
      produitInterdit: checkedInterdits.length > 0,
      photoReception: !!nf.photoFile,
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
  const notificationAccessible = !!(selectedClient?.telegramChatId || selectedClient?.userId);

  // ─────────────────────────────────────────────────────────
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-0 sm:px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) resetAndClose();
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Réceptionner des cartons" tabIndex={-1} className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]">
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-black text-gray-900">
              Réceptionner des cartons
            </h2>
          </div>
          <button
            onClick={resetAndClose}
            disabled={saving} className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">

          <fieldset disabled={saving} className="min-w-0 space-y-4">
          {/* ── CLIENT (staff only) ── */}
          {isStaff && !newClientMode && (
            <div>
              <label htmlFor="reception-client" className={labelCls}>Client</label>
              <div>
                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    id="reception-client" aria-invalid={!!formErr.client} placeholder="Rechercher un client…"
                    value={clientSearchQ}
                    onChange={(e) => {
                      setClientSearchQ(e.target.value);
                      setSelectedClient(null);
                      setMode(null);
                      setClientSearchOpen(true);
                    }}
                    onFocus={() => { if (!selectedClient) setClientSearchOpen(true); }}
                    className={`w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm outline-none transition-colors ${
                      formErr.client
                        ? 'border-red-400 bg-red-50 focus:border-red-500'
                        : selectedClient
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
                    }`}
                    autoComplete="off"
                  />
                </div>

                {/* Client list — inline (not absolute dropdown) */}
                {clientSearchOpen && !selectedClient && (
                  <div className="mt-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-h-52 overflow-y-auto">
                    {filteredClients.length === 0 && clientSearchQ.trim() ? (
                      <div className="px-4 py-3 text-center">
                        <p className="text-sm text-gray-400 mb-2">Aucun client trouvé</p>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setNewClientMode(true); setMode('nouveau');
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
                              setNewClientMode(true); setMode('nouveau');
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
                        <Package size={14} style={{ color: 'var(--text-accent)' }} />
                        <span className="text-xs font-bold" style={{ color: 'var(--text-accent)' }}>
                          Ce client a {regroupables.length} expédition(s) ouverte(s)
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
                                <span className="font-black text-sm" style={{ color: 'var(--brand-text)' }}>{c.ref}</span>
                                {c.casier && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${BRAND.gold}22`, color: 'var(--text-accent)' }}>
                                    {c.casier}
                                  </span>
                                )}
                                <Badge statut={c.statut} />
                              </div>
                              <p className="text-xs text-gray-500 truncate mt-0.5">{c.desc}</p>
                              {(c.nbColis || c.trackings?.length || 1) > 0 && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  {c.nbColis || c.trackings?.length || 1} carton(s) déjà rattaché(s)
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

          {/* ── INLINE NEW CLIENT FORM (complet) ── */}
          {isStaff && newClientMode && (
            <div
              className="rounded-xl border p-4 space-y-4"
              style={{ borderColor: '#10B981', background: 'var(--bg-surface)' }}
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
                    setMode(null);
                  }}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600"
                >
                  Annuler
                </button>
              </div>

              {/* ── Type client + Forfait ── */}
              <div className="flex gap-2 flex-wrap">
                <div className="flex rounded-lg overflow-hidden border border-gray-200">
                  {[{ v: 'particulier', l: 'Particulier' }, { v: 'pro', l: 'Professionnel' }].map((t) => (
                    <button
                      key={t.v} type="button"
                      onClick={() => setNCField('type', t.v)}
                      className={`px-3 py-1.5 text-xs font-bold transition-colors ${newClientForm.type === t.v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Abonnement" value={newClientForm.abonnement}
                  onChange={(e) => setNCField('abonnement', e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold bg-white"
                >
                  {Object.entries(ABONNEMENTS).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label} {v.prix > 0 ? `(${v.prix}€/${v.periode})` : ''}</option>
                  ))}
                </select>
                {newClientForm.abonnement !== 'freemium' && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Début :</span>
                      <ReceptionInput label="Début d’abonnement"
                        type="date"
                        value={newClientForm.abonnementDebut}
                        onChange={(e) => setNCField('abonnementDebut', e.target.value)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Fin :</span>
                      <ReceptionInput label="Fin d’abonnement"
                        type="date"
                        value={newClientForm.abonnementFin}
                        onChange={(e) => setNCField('abonnementFin', e.target.value)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* ── Champs Pro (conditionnels) ── */}
              {newClientForm.type === 'pro' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Entreprise</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <ReceptionInput label="Raison sociale *"
                        type="text"
                        placeholder="Raison sociale *"
                        value={newClientForm.raisonSociale}
                        onChange={(e) => setNCField('raisonSociale', e.target.value)}
                        className={inputCls(newClientErr.raisonSociale)}
                      />
                      {newClientErr.raisonSociale && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.raisonSociale}</p>}
                    </div>
                    <ReceptionInput label="SIRET"
                      type="text"
                      placeholder="SIRET"
                      value={newClientForm.siret}
                      onChange={(e) => setNCField('siret', e.target.value)}
                      className={inputCls(false)}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                  <ReceptionInput label="Interlocuteur"
                    type="text"
                    placeholder="Interlocuteur"
                    value={newClientForm.interlocuteur}
                    onChange={(e) => setNCField('interlocuteur', e.target.value)}
                    className={inputCls(false)}
                  />
                  <div>
                    <label className="text-[10px] text-gray-500 font-semibold mb-0.5 block">Mode de paiement</label>
                    <select
                      aria-label="Mode de paiement" value={newClientForm.modePaiement}
                      onChange={(e) => setNCField('modePaiement', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                    >
                      <option value="colis">Paiement par colis</option>
                      <option value="virement">Virement</option>
                      <option value="30j">Paiement à 30 jours</option>
                      <option value="fin_mois">Fin de mois</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ── Identité ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Identité</p>
                {newClientForm.type === 'particulier' && (
                  <div className="flex gap-3">
                    {['Homme', 'Femme'].map((g) => (
                      <label key={g} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="nc-genre"
                          checked={newClientForm.genre === g}
                          onChange={() => setNCField('genre', g)}
                          className="accent-emerald-500"
                        />
                        <span className="text-xs text-gray-600">{g}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className={`grid gap-2 ${newClientForm.type === 'particulier' ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  <div>
                    <ReceptionInput label="Nom *"
                      type="text"
                      placeholder={newClientForm.type === 'pro' ? 'Nom contact *' : 'Nom *'}
                      value={newClientForm.nom}
                      onChange={(e) => setNCField('nom', e.target.value)}
                      className={inputCls(newClientErr.nom)}
                    />
                    {newClientErr.nom && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.nom}</p>}
                  </div>
                  <ReceptionInput label="Prénom"
                    type="text"
                    placeholder="Prénom"
                    value={newClientForm.prenom}
                    onChange={(e) => setNCField('prenom', e.target.value)}
                    className={inputCls(false)}
                  />
                  {newClientForm.type === 'particulier' && (
                    <ReceptionInput label="Date de naissance"
                      type="date"
                      title="Date de naissance"
                      placeholder="Date naissance"
                      value={newClientForm.dateNaissance}
                      onChange={(e) => setNCField('dateNaissance', e.target.value)}
                      className={inputCls(false)}
                    />
                  )}
                </div>
              </div>

              {/* ── Contact ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                {newClientErr.contact && <p className="text-[10px] text-red-500 font-bold bg-red-50 border border-red-200 rounded-lg px-2 py-1">{newClientErr.contact}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <ReceptionInput label="Téléphone mobile"
                      type="tel"
                      placeholder="Tél. mobile *"
                      value={newClientForm.tel}
                      onChange={(e) => setNCField('tel', e.target.value)}
                      className={inputCls(newClientErr.tel)}
                      style={{ fontFamily: 'monospace' }}
                    />
                    {newClientErr.tel && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.tel}</p>}
                  </div>
                  <ReceptionInput label="Téléphone fixe"
                    type="tel"
                    placeholder="Tél. fixe"
                    value={newClientForm.telFixe}
                    onChange={(e) => setNCField('telFixe', e.target.value)}
                    className={inputCls(false)}
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ReceptionInput label="Email"
                    type="email"
                    placeholder="Email *"
                    value={newClientForm.email}
                    onChange={(e) => setNCField('email', e.target.value)}
                    className={inputCls(false)}
                  />
                  <ReceptionInput label="Identifiant Telegram"
                    type="text"
                    placeholder="Telegram @username"
                    value={newClientForm.telegramUsername}
                    onChange={(e) => setNCField('telegramUsername', e.target.value)}
                    className={inputCls(false)}
                  />
                </div>
              </div>

              {/* ── Adresse livraison ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Adresse de livraison</p>
                <ReceptionInput label="Adresse"
                  type="text"
                  placeholder="Adresse ligne 1 *"
                  value={newClientForm.adresseLigne1}
                  onChange={(e) => setNCField('adresseLigne1', e.target.value)}
                  className={inputCls(false)}
                />
                <ReceptionInput label="Complément d’adresse"
                  type="text"
                  placeholder="Adresse ligne 2 (complément)"
                  value={newClientForm.adresseLigne2}
                  onChange={(e) => setNCField('adresseLigne2', e.target.value)}
                  className={inputCls(false)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <ReceptionInput label="Code postal *"
                      type="text"
                      placeholder="Code postal *"
                      value={newClientForm.cp}
                      onChange={(e) => setNCField('cp', e.target.value)}
                      className={inputCls(newClientErr.cp)}
                      style={{ fontFamily: 'monospace' }}
                    />
                    {newClientErr.cp && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.cp}</p>}
                  </div>
                  <ReceptionInput label="Ville"
                    type="text"
                    placeholder="Ville"
                    value={newClientForm.ville}
                    onChange={(e) => setNCField('ville', e.target.value)}
                    className={inputCls(false)}
                  />
                  <ReceptionInput label="Commune"
                    type="text"
                    placeholder="Commune"
                    value={newClientForm.commune}
                    onChange={(e) => setNCField('commune', e.target.value)}
                    className={inputCls(false)}
                  />
                </div>
                <textarea
                  aria-label="Informations de livraison" placeholder="Infos livraison (digicode, étage, horaires...)"
                  value={newClientForm.infosLivraison}
                  onChange={(e) => setNCField('infosLivraison', e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white resize-none"
                />
              </div>

              {/* ── Notes ── */}
              <textarea
                aria-label="Notes internes" placeholder="Notes internes (optionnel)"
                value={newClientForm.notes}
                onChange={(e) => setNCField('notes', e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white resize-none"
              />
            </div>
          )}

          {/* ── RATTACHER MODE: formulaire simplifié ── */}
          {mode === 'rattacher' && rattacherTarget && (
            <>
              <div className="rounded-xl border p-3" style={{ borderColor: BRAND.navy + '30', background: BRAND.navy + '06' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Package size={14} style={{ color: 'var(--brand-text)' }} />
                  <span className="text-xs font-bold" style={{ color: 'var(--brand-text)' }}>
                    Ajouter un carton à {rattacherTarget.ref}
                  </span>
                  <button type="button" onClick={() => { setMode(null); setRattacherTarget(null); }} className="ml-auto text-[10px] text-gray-400 hover:text-gray-600">
                    Changer
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">{rattacherTarget.desc} · Casier {rattacherTarget.casier || '—'}</p>
              </div>

              {cartonFields}
              <p className="text-xs text-gray-600">{receptionCartonManifest(rattacherTarget).nbColis} carton(s) déjà reçu(s) : leurs mesures sont conservées. {!hasCompleteReceptionMeasurements(rattacherTarget) && 'Certaines mesures anciennes restent à compléter dans le dossier avant de demander un accord.'}</p>

              {/* Casier optionnel (si on veut changer) */}
              <div>
                <label htmlFor="reception-casier-existing" className={labelCls}>Casier (laisser vide pour garder {rattacherTarget.casier || 'l\'actuel'})</label>
                <input
                  type="text"
                  id="reception-casier-existing" placeholder={rattacherTarget.casier || 'Ex: A-03'}
                  value={nf.casier}
                  onChange={(e) => setField('casier', e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>

              {formErr.d && <p role="alert" className="text-sm font-semibold text-red-700">{formErr.d}</p>}
              {formErr.tracking && <p role="alert" className="text-xs text-red-500">{formErr.tracking}</p>}
            </>
          )}

          {/* ── NOUVEAU MODE: formulaire complet ── */}
          {mode === 'nouveau' && (
            <>
              {/* ── CASIER (staff only, MANDATORY — first field for speed) ── */}
              {isStaff && (
                <div>
                  <label htmlFor="reception-casier" className={labelCls}>
                    Casier <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    id="reception-casier" aria-invalid={!!formErr.casier} placeholder="Ex: A-03"
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

              {cartonFields}
              {formErr.d && <p role="alert" className="text-sm font-semibold text-red-700">{formErr.d}</p>}
              <details className="rounded-xl border border-gray-200 p-3">
                <summary className="min-h-11 flex items-center cursor-pointer text-sm font-semibold text-gray-700">Compléments de réception{checkedInterdits.length > 0 ? ` · ${checkedInterdits.length} alerte(s)` : nf.notesReception || nf.photoFile ? ' · renseignés' : ' · observations, contrôles, photo'}</summary>
                <div className="space-y-4 pt-3">
              {/* ── NOTES DE RECEPTION (staff) ── */}
              {isStaff && (
                <div>
                  <label htmlFor="reception-notes" className={labelCls}>
                    Notes de réception
                    <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                  </label>
                  <textarea
                    id="reception-notes" placeholder="Ex: Carton abimé, scotch arraché, colis ouvert..."
                    value={nf.notesReception}
                    onChange={(e) => setField('notesReception', e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 focus:border-amber-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors"
                  />
                </div>
              )}

              {/* ── CONTROLE PRODUITS INTERDITS (staff) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>Contrôle produits interdits</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {produitsInterdits.map((item) => {
                      const checked = checkedInterdits.includes(item);
                      return (
                        <button
                          key={item}
                          aria-pressed={checked}
                          type="button"
                          onClick={() => setCheckedInterdits(prev =>
                            checked ? prev.filter(i => i !== item) : [...prev, item]
                          )}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                            checked ? 'bg-red-100 text-red-700 ring-2 ring-red-400' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {checked ? '\u26A0\uFE0F ' : ''}{item}
                        </button>
                      );
                    })}
                  </div>
                  {checkedInterdits.length > 0 && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200">
                      <p className="text-xs font-bold text-red-700">{'\u26A0\uFE0F'} Attention : {checkedInterdits.length} produit(s) interdit(s) détecté(s)</p>
                      <p className="text-[10px] text-red-600 mt-0.5">Ce colis ne pourra peut-être pas être expédié par voie aérienne.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── PHOTO DE RECEPTION (staff, optional) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>
                    Photo de réception
                    <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed focus-within:ring-2 focus-within:ring-blue-600 border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
                      <Camera size={16} className="text-gray-400" />
                      <span className="text-xs font-semibold text-gray-500">
                        {nf.photoFile ? nf.photoFile.name : 'Prendre une photo / Choisir un fichier'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setField('photoFile', file);
                        }}
                      />
                    </label>
                    {nf.photoFile && (
                      <button
                        type="button"
                        onClick={() => setField('photoFile', null)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                  {nf.photoFile && (
                    <img
                      src={photoPreview}
                      alt="Photo réception"
                      className="mt-2 rounded-xl max-h-32 object-cover"
                    />
                  )}
                </div>
              )}

                </div>
              </details>

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
                              className="sr-only"
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
          </fieldset>
        </div>

        {/* ── Footer / Actions ── */}
        {mode && (
          <div className="shrink-0 px-5 py-3 border-t border-gray-200 bg-white" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <div className="mb-3 text-xs text-gray-600" aria-live="polite">
              <p className="font-bold text-sm text-gray-800">{selectedClient?.nom || newClientForm.nom || authCl?.nom} · {mode === 'rattacher' ? rattacherTarget?.ref : 'Nouveau dossier'}</p>
              <p>{receptionCartons(nf.trackingLines, nf.multiDims).filter(({ index }) => receptionMeasurements([nf.trackingLines[index]], { 0: nf.multiDims[index] })).length} / {receptionCartons(nf.trackingLines, nf.multiDims).length} carton(s) mesuré(s) à réception · Casier {nf.casier || rattacherTarget?.casier || 'à renseigner'}</p>
              {mode === 'nouveau' && <p>{notificationAccessible ? `Notification proposée : ${selectedClient?.telegramChatId ? 'Telegram' : 'message dans l’espace client'}` : 'Accès client à activer : une action de contact sera créée pour l’équipe.'}</p>}
              {checkedInterdits.length > 0 && <p className="text-red-700 font-bold">{checkedInterdits.length} produit(s) interdit(s) signalé(s)</p>}
            </div>
            {formErr.dimensions && <p role="alert" className="mb-3 text-sm font-semibold text-red-700">{formErr.dimensions}</p>}
            {saveError && <p role="alert" className="mb-3 text-sm font-semibold text-red-700">{saveError}</p>}
            <div className="flex flex-wrap sm:flex-nowrap gap-3">
              <button
                type="button"
                disabled={saving} onClick={mode === 'rattacher' ? () => { setMode(null); setRattacherTarget(null); } : resetAndClose}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
              >
                {mode === 'rattacher' ? 'Retour' : 'Annuler'}
              </button>

              {mode === 'rattacher' ? (
                <button
                  type="button"
                  disabled={saving} onClick={() => runSave(handleRattacher)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                  style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                >
                  Rattacher à {rattacherTarget?.ref}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={saving} onClick={() => runSave(() => handleReceptionner(true))}
                    className="order-first w-full sm:order-none sm:w-auto sm:flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                    style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                  >
                    {notificationAccessible ? 'Réceptionner et notifier le client' : 'Réceptionner les cartons'}
                  </button>
                  {notificationAccessible && <button
                    type="button"
                    disabled={saving} onClick={() => runSave(() => handleReceptionner(false))}
                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    Sans notification
                  </button>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>, document.body
  );
}

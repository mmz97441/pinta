import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { ArrowLeft, Check, X, AlertTriangle, ExternalLink, Send, Download, FileSpreadsheet, ChevronDown, Crown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP } from '../../constants';
import { telegramLink, eur, getPrenom } from '../../utils';
import { Badge } from '../ui';
import { exportRecapProExcel } from '../../utils/exportRecapPro';
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

const MOIS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ─────────────────────────────────────────────────────────────────────────────
// Main component — handles both /clients/new and /clients/:id
// ─────────────────────────────────────────────────────────────────────────────
export default function StaffClientDetail() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const { clients, data, updateClient, addNewClient, deleteClient, flash, sendMsg, ask, auth } = useApp();

  const isNewRoute = !routeId || routeId === 'new';
  const existing = !isNewRoute ? clients.find((c) => c.id === routeId) : null;

  // If route is /clients/:id but no such client found, redirect back.
  // Wait for clients to be loaded before deciding (avoid false negatives on first render).
  if (!isNewRoute && !existing && clients.length > 0) {
    return <Navigate to="/clients" replace />;
  }

  if (isNewRoute) {
    return <NewClientPage onDone={() => navigate('/clients')} onCancel={() => navigate('/clients')} />;
  }

  if (!existing) {
    return <div className="flex items-center justify-center min-h-[40vh] text-gray-400">Chargement…</div>;
  }

  return (
    <EditClientPage
      cl={existing}
      clients={clients}
      data={data}
      updateClient={updateClient}
      deleteClient={deleteClient}
      flash={flash}
      sendMsg={sendMsg}
      ask={ask}
      auth={auth}
      onDone={() => navigate('/clients')}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit page — uses the edit form (extracted from previous inline modal)
// ─────────────────────────────────────────────────────────────────────────────
function EditClientPage({ cl, clients, data, updateClient, deleteClient, flash, sendMsg, ask, auth, onDone }) {
  const navigate = useNavigate();

  const [clDraft, setClDraft] = useState({
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
  const [touched, setTouched] = useState({});
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingMonth, setBillingMonth] = useState(new Date().getMonth());
  const [billingYear, setBillingYear] = useState(new Date().getFullYear());

  // ── Duplicate detection ───────────────────────────────────────────────────
  const duplicates = useMemo(() => {
    if (!clDraft.nom && !clDraft.tel) return [];
    return clients.filter((c) => {
      if (c.id === cl.id) return false;
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
  }, [cl.id, clDraft.nom, clDraft.tel, clients]);

  // ── Live validation ───────────────────────────────────────────────────────
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
  const colis = data.filter((p) => p.clientId === cl.id && p.statut !== 'annule');
  const actifs = data.filter((p) => p.clientId === cl.id && !['livre', 'annule'].includes(p.statut));
  const ca = data.filter((p) => p.clientId === cl.id && p.paiementMontant).reduce((sum, p) => sum + (p.paiementMontant || 0), 0);
  const dest = getDestByCP(cl.cp);
  const hasColis = data.some((p) => p.clientId === cl.id && p.statut !== 'annule');

  function getProBillingData(month, year) {
    return data.filter((c) => {
      if (c.clientId !== cl.id) return false;
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

  function handleSave() {
    if (!canSave) {
      setTouched({ nom: true, tel: true, email: true, cp: true });
      return;
    }
    updateClient(cl.id, clDraft);
    onDone();
  }

  function handleDelete() {
    if (hasColis) {
      flash('Ce client a des colis actifs, impossible de le supprimer');
      return;
    }
    deleteClient(cl.id);
    onDone();
  }

  function handleOpenColis(colisId) {
    navigate(`/colis/${colisId}`);
  }

  return (
    <div className="anim-fade max-w-3xl mx-auto pb-24">
      {/* ── Header with back button ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 pt-1">
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft size={16} />
          Retour aux clients
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* ── Title row ─────────────────────────────────────────────────── */}
        <div className="p-4 flex items-center gap-3 border-b border-gray-100">
          <div
            className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-base font-black"
            style={{
              background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
              color: BRAND.goldL,
            }}
          >
            {(cl.nom || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {cl.ref && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{cl.ref}</span>}
              <span className="text-base font-black truncate" style={{ color: BRAND.navy }}>
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
              {cl.telegramChatId ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Telegram lié</span>
              ) : (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Telegram non lié</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs">{dest.flag}</span>
              {cl.ville && <span className="text-xs text-gray-500">{cl.ville}</span>}
              {cl.tel && <span className="text-xs text-gray-400 font-mono">{cl.tel}</span>}
              {cl.email && <span className="text-xs text-gray-400 truncate max-w-[160px]">{cl.email}</span>}
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
            {ca > 0 && <span className="text-xs font-bold text-emerald-600">{ca.toFixed(2)} €</span>}
          </div>
        </div>

        {/* ── Edit form ─────────────────────────────────────────────────── */}
        <div className="px-4 pb-5 pt-4 space-y-4">

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
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{ background: BRAND.navy, color: 'white' }}
            >
              <Check size={14} strokeWidth={2.5} />
              Enregistrer
            </button>
            <button
              onClick={() => navigate('/clients')}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 transition-all active:scale-95 hover:bg-gray-200"
            >
              <X size={14} />
              Annuler
            </button>
          </div>

          {/* Quick action links */}
          {(cl.tel || cl.email) && (
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
          {cl.type === 'pro' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#A5B4FC', background: '#EEF2FF' }}>
              <button
                onClick={() => setBillingOpen((p) => !p)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              >
                <FileSpreadsheet size={13} className="text-indigo-600 flex-shrink-0" />
                <span className="text-xs font-bold text-indigo-800 flex-1">
                  Facturation
                  {cl.methodePaiement === '30_jours' ? ' — Paiement 30 jours' : ' — Fin de mois'}
                </span>
                <ChevronDown
                  size={13}
                  className={`text-indigo-400 transition-transform ${billingOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {billingOpen && (
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
                    const billingColis = getProBillingData(billingMonth, billingYear);
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

          {/* Lien de suivi partagé */}
          {cl.id && (
            <ShareLinkPanel
              client={cl}
              currentUserId={auth?.u?.id}
              flash={flash}
              ask={ask}
            />
          )}

          {/* Delete button — only if no colis */}
          {!hasColis && (
            <button
              onClick={handleDelete}
              className="w-full py-2.5 rounded-xl text-xs font-bold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
            >
              Supprimer ce client
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New client page — preserves the richer creation form
// (extracted from previous showNewModal block)
// ─────────────────────────────────────────────────────────────────────────────
function NewClientPage({ onDone, onCancel }) {
  const { addNewClient, flash } = useApp();
  const [nd, setNd] = useState(emptyDraft());
  const [justCreated, setJustCreated] = useState(null); // { id, cl } after save

  const set = (k, v) => setNd((p) => ({ ...p, [k]: v }));
  const isPro = nd.type === 'pro';

  const LBL = 'text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide';
  const INP = 'w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors';

  async function handleCreate() {
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
    flash({ msg: isPro ? 'Client pro créé avec succès' : 'Client créé avec succès', type: 'success' });
    setJustCreated({ id, cl: { ...nd, id } });
  }

  // After creation: show invitation block, then return to list when dismissed
  if (justCreated) {
    const cl = justCreated.cl;
    return (
      <div className="anim-fade max-w-3xl mx-auto pb-24">
        <div className="flex items-center justify-between mb-4 pt-1">
          <button
            onClick={onDone}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft size={16} />
            Retour aux clients
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
            <Check size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-green-800">Client créé avec succès</p>
              <p className="text-[11px] text-green-600 mt-0.5">Envoyez-lui une invitation pour accéder à son espace.</p>
            </div>
          </div>

          {cl.tel && cl.canal === 'telegram' && (
            <a
              href={telegramLink(cl.id)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
              style={{ background: '#0088cc', color: 'white', boxShadow: '0 2px 10px #0088cc40' }}
            >
              <Send size={14} />
              Inviter via Telegram
            </a>
          )}

          {cl.email && (
            <a
              href={`mailto:${cl.email}?subject=${encodeURIComponent('Bienvenue chez Expedîle !')}&body=${encodeURIComponent(`Bonjour ${getPrenom(cl)},\n\nVotre espace client Expedîle est prêt !\n\nConnectez-vous ici : https://expedile.re/app\n\nÀ très vite !\nL'équipe Expedîle`)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold bg-blue-50 text-blue-700 border-2 border-blue-200 hover:bg-blue-100 transition-all active:scale-95"
            >
              <ExternalLink size={14} />
              Inviter par email
            </a>
          )}

          <button
            onClick={onDone}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Terminer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-fade max-w-3xl mx-auto pb-24">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft size={16} />
            Retour aux clients
          </button>
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
        <button onClick={onCancel}
          className="px-6 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">
          Annuler
        </button>
        <button onClick={handleCreate}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95 transition-all"
          style={{ background: isPro ? `linear-gradient(135deg, ${BRAND.goldD}, ${BRAND.gold})` : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}>
          {isPro ? 'Créer le client pro' : 'Créer le client'}
        </button>
      </div>
    </div>
  );
}

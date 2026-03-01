import React, { useState } from 'react';
import {
  User, Package, CheckCircle, CreditCard, TrendingUp, Star, Bell,
  Lock, Download, HelpCircle, LogOut, Trash2, Edit3, X, ChevronRight,
  FileText, Receipt, Save,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, getDestByCP } from '../../constants';
import { eur, fmtMembreDep, validateProfile } from '../../utils';

// ── Tier config ────────────────────────────────────────────────────────────────
const TIERS = [
  {
    key: 'freemium',
    label: 'Gratuit',
    minPts: 0,
    maxPts: 200,
    color: '#64748b',
    bg: '#f1f5f9',
    avantages: ['Suivi de colis en temps réel', 'Notifications WhatsApp', 'Support par email'],
  },
  {
    key: 'premium',
    label: 'Premium',
    minPts: 200,
    maxPts: 500,
    color: BRAND.goldD,
    bg: '#fef9ec',
    avantages: ['Priorité de traitement', 'Réduction 5% sur transport', 'Support prioritaire WhatsApp', 'Accès aux offres groupées'],
  },
  {
    key: 'vip',
    label: 'VIP',
    minPts: 500,
    maxPts: 1000,
    color: BRAND.navy,
    bg: BRAND.navy + '0f',
    avantages: ['Traitement express', 'Réduction 10% sur transport', 'Conseiller dédié', 'Livraison à domicile offerte', 'Accès aux ventes privées'],
  },
];

function getTier(pts) {
  if (pts >= 500) return TIERS[2];
  if (pts >= 200) return TIERS[1];
  return TIERS[0];
}

function getNextTier(pts) {
  if (pts >= 500) return null;
  if (pts >= 200) return TIERS[2];
  return TIERS[1];
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="card rounded-2xl overflow-hidden">
      {title && (
        <div
          className="px-4 py-3 border-b border-gray-50"
          style={{ borderBottomColor: 'rgba(0,0,0,0.04)' }}
        >
          <h3 className="text-xs font-black uppercase tracking-widest" style={{ color: BRAND.navy }}>
            {title}
          </h3>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────────
function SettingRow({ icon: Icon, label, sub, children, danger, onClick }) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 ${
        danger ? 'text-red-600' : 'text-gray-800'
      }`}
      onClick={onClick}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: danger ? '#fee2e2' : BRAND.navy + '10' }}
      >
        <Icon size={16} style={{ color: danger ? '#dc2626' : BRAND.navy }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${danger ? 'text-red-600' : 'text-gray-800'}`}>
          {label}
        </p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {children || <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
    </button>
  );
}

const DOC_TABS = [
  { key: 'devis', label: 'Prix' },
  { key: 'factures', label: 'Factures' },
];

const INPUT_CLS = (err) =>
  `w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors ${
    err
      ? 'border-red-400 bg-red-50 focus:border-red-500'
      : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
  }`;

const LABEL_CLS = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

export default function ClientProfil() {
  const { authCl, data, clients, updateClient, setAuth, flash, ask, setSelId } = useApp();

  const cl = authCl;
  const dest = cl ? getDestByCP(cl.cp) : null;
  const firstName = cl ? cl.nom.split(' ')[0] : 'Client';
  const initials = cl
    ? cl.nom.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  // ── Profile edit state ──────────────────────────────────────────────────────
  const [profEdit, setProfEdit] = useState(false);
  const [profDraft, setProfDraft] = useState({});
  const [profErr, setProfErr] = useState({});

  // ── Document filter ─────────────────────────────────────────────────────────
  const [docFilter, setDocFilter] = useState('devis');

  // ── Notif toggle ────────────────────────────────────────────────────────────
  const [notifsOn, setNotifsOn] = useState(true);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const myColis = cl ? data.filter((p) => p.clientId === cl.id) : [];
  const enCours = myColis.filter((p) => p.statut !== 'livre' && p.statut !== 'annule').length;
  const livres = myColis.filter((p) => p.statut === 'livre').length;
  const totalPaye = myColis
    .filter((p) => p.paiementMontant != null)
    .reduce((s, p) => s + p.paiementMontant, 0);
  const totalEco = myColis
    .filter((p) => p.economie != null)
    .reduce((s, p) => s + p.economie, 0);

  // ── Subscription ────────────────────────────────────────────────────────────
  const pts = cl?.points || 0;
  const tier = getTier(pts);
  const nextTier = getNextTier(pts);
  const pctToNext = nextTier
    ? Math.min(100, Math.round(((pts - tier.minPts) / (nextTier.minPts - tier.minPts)) * 100))
    : 100;

  // ── Documents ───────────────────────────────────────────────────────────────
  const allDevis = myColis.filter((p) => p.devisTotal != null);
  const allFactures = myColis.flatMap((p) =>
    (p.factures || []).map((f) => ({ ...f, colisRef: p.ref, colisId: p.id }))
  );

  // ── Edit handlers ────────────────────────────────────────────────────────────
  const startEdit = () => {
    if (!cl) return;
    setProfDraft({ nom: cl.nom, email: cl.email || '', tel: cl.tel || '', cp: cl.cp || '', ville: cl.ville || '' });
    setProfErr({});
    setProfEdit(true);
  };

  const cancelEdit = () => {
    setProfEdit(false);
    setProfErr({});
  };

  const saveEdit = () => {
    const errs = validateProfile(profDraft);
    if (Object.keys(errs).length > 0) { setProfErr(errs); return; }
    updateClient(cl.id, profDraft);
    setProfEdit(false);
    setProfErr({});
  };

  const setDraft = (k, v) => {
    setProfDraft((prev) => ({ ...prev, [k]: v }));
    if (profErr[k]) setProfErr((prev) => ({ ...prev, [k]: undefined }));
  };

  // ── Logout / delete ──────────────────────────────────────────────────────────
  const handleLogout = () => {
    ask('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', () => setAuth(null), { okLabel: 'Déconnexion' });
  };

  const handleDeleteAccount = () => {
    ask(
      'Supprimer le compte',
      'Cette action est irréversible. Toutes vos données seront supprimées.',
      () => { flash('Compte supprimé'); setAuth(null); },
      { danger: true, okLabel: 'Supprimer' }
    );
  };

  if (!cl) return null;

  return (
    <div className="anim-fade space-y-4">

      {/* ── 1. Profile header ── */}
      <div
        className="rounded-2xl p-5 text-white relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyL} 60%, ${BRAND.navyD} 100%)`,
          boxShadow: `0 4px 24px rgba(27,58,75,0.25)`,
        }}
      >
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full opacity-10" style={{ background: BRAND.gold }} />
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black shadow-lg flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-black leading-tight truncate">{cl.nom}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide"
                style={{ backgroundColor: tier.color + '30', color: tier.color === BRAND.navy ? BRAND.goldL : 'white' }}
              >
                {tier.label}
              </span>
              <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {cl.type === 'pro' ? 'Professionnel' : 'Particulier'}
              </span>
            </div>
            {dest && (
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {dest.flag} {dest.nom}
              </p>
            )}
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {fmtMembreDep(cl.created)}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2. Stats ── */}
      <Section title="Statistiques">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 divide-x divide-y lg:divide-y-0 divide-gray-50">
          {[
            { label: 'Colis total', value: myColis.length, icon: Package },
            { label: 'En cours', value: enCours, icon: TrendingUp },
            { label: 'Livrés', value: livres, icon: CheckCircle },
            { label: 'Total payé', value: eur(totalPaye), icon: CreditCard },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="p-4 text-center">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: BRAND.navy + '10' }}
              >
                <Icon size={15} style={{ color: BRAND.navy }} />
              </div>
              <div className="text-xl font-black" style={{ color: BRAND.navy }}>{value}</div>
              <div className="text-xs text-gray-400 font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        {totalEco > 0 && (
          <div
            className="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center gap-2"
            style={{ backgroundColor: '#ecfdf5' }}
          >
            <span className="text-emerald-600 font-black text-sm">{eur(totalEco)}</span>
            <span className="text-xs text-emerald-700">économisés grâce à Expedîle</span>
          </div>
        )}
      </Section>

      {/* ── 3. Subscription ── */}
      <Section title="Mon abonnement">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star size={16} style={{ color: tier.color }} />
              <span className="font-black text-sm" style={{ color: tier.color }}>{tier.label}</span>
            </div>
            <span className="text-sm font-bold text-gray-600">{pts} pts</span>
          </div>

          {nextTier && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>{pts} / {nextTier.minPts} pts pour {nextTier.label}</span>
                <span className="font-bold">{pctToNext}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pctToNext}%`,
                    background: `linear-gradient(90deg, ${tier.color}, ${nextTier.color})`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Encore {nextTier.minPts - pts} pts pour atteindre {nextTier.label}
              </p>
            </div>
          )}
          {!nextTier && (
            <div
              className="rounded-xl px-3 py-2 text-xs font-semibold text-center"
              style={{ backgroundColor: BRAND.navy + '0f', color: BRAND.navy }}
            >
              Niveau maximum atteint !
            </div>
          )}

          <div>
            <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Vos avantages</p>
            <ul className="space-y-1.5">
              {tier.avantages.map((av) => (
                <li key={av} className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: tier.color + '20' }}>
                    <CheckCircle size={10} style={{ color: tier.color }} />
                  </div>
                  {av}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ── 4. My information ── */}
      <Section title="Mes informations">
        {profEdit ? (
          <div className="p-4 space-y-3">
            {[
              { key: 'nom', label: 'Nom complet', type: 'text', placeholder: 'Votre nom' },
              { key: 'email', label: 'Email', type: 'email', placeholder: 'votre@email.com' },
              { key: 'tel', label: 'Téléphone', type: 'tel', placeholder: '+262 692 12 34 56' },
              { key: 'cp', label: 'Code postal', type: 'text', placeholder: '97400' },
              { key: 'ville', label: 'Ville', type: 'text', placeholder: 'Saint-Denis' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className={LABEL_CLS}>{label}</label>
                <input
                  type={type}
                  value={profDraft[key] || ''}
                  placeholder={placeholder}
                  onChange={(e) => setDraft(key, e.target.value)}
                  className={INPUT_CLS(profErr[key])}
                />
                {profErr[key] && (
                  <p className="mt-1 text-xs text-red-500">{profErr[key]}</p>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={cancelEdit}
                className="flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all flex items-center gap-1.5"
              >
                <X size={14} />
                Annuler
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all flex items-center justify-center gap-1.5"
                style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
              >
                <Save size={14} />
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <div>
            {[
              { label: 'Nom', value: cl.nom },
              { label: 'Email', value: cl.email || '—' },
              { label: 'Téléphone', value: cl.tel || '—' },
              { label: 'Code postal', value: cl.cp },
              { label: 'Ville', value: cl.ville },
              { label: 'Destination', value: dest ? `${dest.flag} ${dest.nom}` : '—' },
            ].map(({ label, value }, i, arr) => (
              <div
                key={label}
                className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <span className="text-xs text-gray-400 font-medium">{label}</span>
                <span className="text-sm font-semibold text-gray-800 truncate max-w-[180px] text-right">{value}</span>
              </div>
            ))}
            <div className="p-4 pt-2">
              <button
                onClick={startEdit}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-all"
                style={{ color: BRAND.navy, backgroundColor: BRAND.navy + '10' }}
              >
                <Edit3 size={14} />
                Modifier mes informations
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* ── 5. Documents ── */}
      <Section title="Mes documents">
        {/* Filter tabs */}
        <div className="flex gap-1.5 p-3 bg-gray-50 border-b border-gray-100">
          {DOC_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDocFilter(tab.key)}
              className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                docFilter === tab.key ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
              style={docFilter === tab.key ? { color: BRAND.navy } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Document list */}
        <div className="divide-y divide-gray-50">
          {docFilter === 'devis' && (
            allDevis.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">Aucun prix disponible</p>
            ) : (
              allDevis.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelId(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left active:scale-[0.98]"
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: BRAND.navy + '10' }}
                  >
                    <FileText size={15} style={{ color: BRAND.navy }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{p.ref}</p>
                    <p className="text-xs text-gray-400 truncate">{p.desc}</p>
                  </div>
                  <span className="font-black text-sm" style={{ color: BRAND.navy }}>
                    {eur(p.devisTotal)}
                  </span>
                  <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
                </button>
              ))
            )
          )}
          {docFilter === 'factures' && (
            allFactures.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">Aucune facture disponible</p>
            ) : (
              allFactures.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelId(f.colisId)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left active:scale-[0.98]"
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: f.valide ? '#ecfdf5' : '#fef9ec' }}
                  >
                    <Receipt size={15} style={{ color: f.valide ? '#059669' : '#d97706' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{f.vendeur}</p>
                    <p className="text-xs text-gray-400">{f.colisRef}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-sm text-gray-800">{eur(f.montant)}</p>
                    <p
                      className="text-xs font-bold"
                      style={{ color: f.valide ? '#059669' : '#d97706' }}
                    >
                      {f.valide ? 'Validée' : 'En attente'}
                    </p>
                  </div>
                  <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
                </button>
              ))
            )
          )}
        </div>
      </Section>

      {/* ── 6. Settings ── */}
      <Section title="Paramètres">
        <div className="divide-y divide-gray-50">
          {/* Notifications toggle */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: BRAND.navy + '10' }}
            >
              <Bell size={16} style={{ color: BRAND.navy }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800">Notifications</p>
              <p className="text-xs text-gray-400 mt-0.5">Alertes WhatsApp et email</p>
            </div>
            <button
              onClick={() => setNotifsOn((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${
                notifsOn ? '' : 'bg-gray-200'
              }`}
              style={notifsOn ? { backgroundColor: BRAND.navy } : {}}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${
                  notifsOn ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          <SettingRow
            icon={Lock}
            label="Changer le mot de passe"
            sub="Sécurisez votre compte"
            onClick={() => flash('Fonctionnalité bientôt disponible')}
          />
          <SettingRow
            icon={Download}
            label="Télécharger mes infos"
            sub="Télécharger en fichier"
            onClick={() => flash('Téléchargement en cours de préparation…')}
          />
          <SettingRow
            icon={HelpCircle}
            label="Aide & Support"
            sub="FAQ, contact WhatsApp"
            onClick={() => flash('Ouverture du support…')}
          />
        </div>
      </Section>

      {/* ── 7. Logout + delete ── */}
      <div className="space-y-2 pb-2">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm active:scale-95 transition-all"
          style={{ color: BRAND.navy, backgroundColor: BRAND.navy + '10', border: `1.5px solid ${BRAND.navy}20` }}
        >
          <LogOut size={16} />
          Se déconnecter
        </button>

        <button
          onClick={handleDeleteAccount}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-red-400 hover:text-red-600 transition-colors active:scale-95"
        >
          <Trash2 size={12} />
          Supprimer mon compte
        </button>
      </div>
    </div>
  );
}

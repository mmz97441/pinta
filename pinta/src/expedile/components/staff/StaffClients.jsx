import React, { useState } from 'react';
import { ArrowLeft, Users, Plus, Search, ChevronDown, Check, X } from 'lucide-react';
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

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffClients() {
  const { clients, data, setPage, setSelId, updateClient, addNewClient, deleteClient, flash } = useApp();

  const [clPageSearch, setClPageSearch] = useState('');
  const [clEditId, setClEditId] = useState(null);
  const [clDraft, setClDraft] = useState(emptyDraft());

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = searchClients(clients, clPageSearch);

  const waCount = clients.filter((c) => c.canal === 'whatsapp').length;
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

  function patchDraft(field, value) {
    setClDraft((prev) => ({ ...prev, [field]: value }));
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleNewClient() {
    const draft = emptyDraft();
    const id = addNewClient({
      nom: '',
      tel: '',
      email: '',
      ville: '',
      cp: '',
      adresse: '',
      canal: 'whatsapp',
      type: 'particulier',
      notes: '',
      created: new Date().toISOString().slice(0, 10),
      points: 0,
    });
    setClEditId(id);
    setClDraft(draft);
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
  }

  function handleSave(id) {
    updateClient(id, clDraft);
    setClEditId(null);
  }

  function handleCancel() {
    setClEditId(null);
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
          Nouveau
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
          <span
            className="text-2xl font-black leading-none"
            style={{ color: BRAND.navy }}
          >
            {clients.length}
          </span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Total</span>
        </div>
        <div className="card p-3 flex flex-col items-center">
          <span className="text-2xl font-black leading-none text-green-600">
            {waCount}
          </span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">WhatsApp</span>
        </div>
        <div className="card p-3 flex flex-col items-center">
          <span
            className="text-2xl font-black leading-none"
            style={{ color: BRAND.goldD }}
          >
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

      <div className="flex flex-col gap-3">
        {filtered.map((cl) => {
          const isOpen = clEditId === cl.id;
          const colis = clientColis(cl.id);
          const actifs = clientActifs(cl.id);
          const ca = clientCA(cl.id);
          const dest = getDestByCP(cl.cp);
          const hasColis = data.some((p) => p.clientId === cl.id && p.statut !== 'annule');

          return (
            <div key={cl.id} className="card overflow-hidden">

              {/* ── Collapsed row ─────────────────────────────────────────── */}
              <button
                onClick={() => (isOpen ? handleCancel() : handleEdit(cl))}
                className="w-full text-left p-4 flex items-center gap-3"
              >
                {/* Avatar */}
                <Avatar nom={cl.nom} size={10} />

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-sm font-black truncate"
                      style={{ color: BRAND.navy }}
                    >
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

                  {/* Destination + contact */}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs">{dest.flag}</span>
                    {cl.ville && (
                      <span className="text-xs text-gray-500">{cl.ville}</span>
                    )}
                    {cl.tel && (
                      <span className="text-xs text-gray-400 font-mono">{cl.tel}</span>
                    )}
                    {cl.email && (
                      <span className="text-xs text-gray-400 truncate max-w-[140px]">{cl.email}</span>
                    )}
                  </div>
                </div>

                {/* Right: colis counts + CA */}
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
                    <span className="text-xs font-bold text-emerald-600">
                      {ca.toFixed(2)} €
                    </span>
                  )}
                </div>

                {/* Chevron */}
                <ChevronDown
                  size={15}
                  className={`flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* ── Edit form (expanded) ───────────────────────────────────── */}
              {isOpen && (
                <div className="border-t border-gray-100 px-4 pb-5 pt-4 space-y-4">

                  {/* Field grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Nom */}
                    <div className="col-span-2">
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Nom complet
                      </label>
                      <input
                        value={clDraft.nom}
                        onChange={(e) => patchDraft('nom', e.target.value)}
                        placeholder="Prénom NOM"
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                      />
                    </div>

                    {/* Téléphone */}
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Téléphone
                      </label>
                      <input
                        value={clDraft.tel}
                        onChange={(e) => patchDraft('tel', e.target.value)}
                        placeholder="+262 692 …"
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors font-mono"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Email
                      </label>
                      <input
                        value={clDraft.email}
                        onChange={(e) => patchDraft('email', e.target.value)}
                        placeholder="adresse@exemple.com"
                        type="email"
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                      />
                    </div>

                    {/* Ville */}
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Ville
                      </label>
                      <input
                        value={clDraft.ville}
                        onChange={(e) => patchDraft('ville', e.target.value)}
                        placeholder="Saint-Denis"
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors"
                      />
                    </div>

                    {/* Code postal */}
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide">
                        Code postal
                      </label>
                      <input
                        value={clDraft.cp}
                        onChange={(e) => patchDraft('cp', e.target.value)}
                        placeholder="97400"
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors font-mono"
                      />
                      {clDraft.cp && (
                        <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                          {(() => {
                            const d = getDestByCP(clDraft.cp);
                            return (
                              <>
                                <span>{d.flag}</span>
                                <span>{d.nom}</span>
                              </>
                            );
                          })()}
                        </p>
                      )}
                    </div>

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
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{ background: BRAND.navy, color: 'white' }}
                    >
                      <Check size={14} strokeWidth={2.5} />
                      Enregistrer
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
                  {(cl.tel || cl.email) && (
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
                            <span
                              className="text-xs font-black"
                              style={{ color: BRAND.navy }}
                            >
                              {p.ref}
                            </span>
                            <Badge statut={p.statut} />
                            {p.desc && (
                              <span className="text-xs text-gray-400 truncate flex-1 min-w-0">
                                {p.desc}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Delete button — only if no colis */}
                  {!hasColis && (
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

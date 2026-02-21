import React, { useState } from 'react';
import { ArrowLeft, Plane, CreditCard, FileText, ChevronDown, Trash2, Lock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, DESTINATIONS } from '../../constants';
import { eur, labelEnvoi, uid, getCatTaux } from '../../utils';
import { Ligne } from '../ui';

export default function StaffSettings() {
  const { setPage, envois, setEnvois, data, tarifs, setTarifs, categories, addCategory, updateCatTaux, updateCatLabel, deleteCategory, flash } = useApp();
  const [newEnvoiDate, setNewEnvoiDate] = useState('');
  const [catEditId, setCatEditId] = useState(null);
  const [newCat, setNewCat] = useState({ label: '', taux: {} });

  return (
    <div className="anim-fade space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl" style={{ backgroundColor: BRAND.navy + '10' }}>
            <CreditCard size={20} style={{ color: BRAND.navy }} />
          </div>
          <p className="font-bold text-xl" style={{ color: BRAND.navy }}>Paramètres</p>
        </div>
        <button onClick={() => setPage('home')} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors" style={{ color: BRAND.navy }}>
          <ArrowLeft size={16} />Retour
        </button>
      </div>

      {/* ── Départs ── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Plane size={18} style={{ color: BRAND.navy }} />
          <p className="font-bold text-lg">Départs (vols du vendredi soir)</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Gérez les départs hebdomadaires. Par défaut, un départ chaque vendredi soir.</p>

        <div className="space-y-2 mb-4">
          {envois.map((e) => {
            const count = data.filter((c) => c.envoi === e.id).length;
            return (
              <div key={e.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
                <div className="flex-1">
                  <p className="font-bold text-sm">{labelEnvoi(e)}</p>
                  <p className="text-xs text-gray-500">{`${e.statut} · ${count} colis affectés`}</p>
                </div>
                <select value={e.statut} onChange={(ev) => setEnvois((p) => p.map((x) => (x.id === e.id ? { ...x, statut: ev.target.value } : x)))} className="px-2 py-1 rounded-lg border text-xs">
                  <option value="planifie">○ Planifié</option>
                  <option value="prochain">● Prochain</option>
                  <option value="en_cours">● En cours</option>
                  <option value="parti">✈ Parti</option>
                </select>
                {count === 0 ? (
                  <button onClick={() => { setEnvois((p) => p.filter((x) => x.id !== e.id)); flash('Départ supprimé'); }} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={15} />
                  </button>
                ) : (
                  <span className="text-gray-300 p-1.5" title="Impossible de supprimer un départ avec des colis affectés"><Lock size={14} /></span>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t pt-4">
          <p className="text-sm font-bold text-gray-700 mb-2">Ajouter un départ</p>
          <div className="flex gap-2">
            <input type="date" value={newEnvoiDate} onChange={(e) => setNewEnvoiDate(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 text-sm" />
            <button onClick={() => {
              if (!newEnvoiDate) { flash('Choisissez une date'); return; }
              const d = new Date(newEnvoiDate + 'T00:00:00');
              if (d.getDay() !== 5) flash('Les départs sont normalement le vendredi. Ajouté quand même.');
              if (envois.find((e) => e.date === newEnvoiDate)) { flash('Ce départ existe déjà'); return; }
              setEnvois((p) => [...p, { id: uid(), date: newEnvoiDate, statut: 'planifie' }].sort((a, b) => a.date.localeCompare(b.date)));
              setNewEnvoiDate('');
              flash('Départ ajouté');
            }} style={{ backgroundColor: BRAND.navy }} className="px-4 py-2 text-white rounded-xl text-sm font-bold hover:opacity-90">
              + Ajouter
            </button>
          </div>
        </div>
      </div>

      {/* ── Tarifs transport ── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <CreditCard size={18} style={{ color: BRAND.navy }} />
          <p className="font-bold text-lg">Tarifs transport par destination</p>
        </div>
        <p className="text-sm text-gray-500 mb-3">Forfait de base + prix au kg — modifiable</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.values(DESTINATIONS).map((d) => {
            const t = tarifs[d.code] || { base: 0, parKg: 0 };
            return (
              <div key={d.code} className="p-4 rounded-xl border-2 border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold">{`${d.flag} ${d.nom} (${d.code})`}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{`TVA : ${d.tva}% · ${d.hasOM ? 'OM + OMR' : `Taxe conso ${d.taxeConso || 0}%`}`}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Forfait de base (€)</label>
                    <input type="number" step="0.5" value={t.base} onChange={(e) => setTarifs((prev) => ({ ...prev, [d.code]: { ...t, base: Number(e.target.value) || 0 } }))} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-center" style={{ outline: 'none' }} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Prix par kg (€)</label>
                    <input type="number" step="0.5" value={t.parKg} onChange={(e) => setTarifs((prev) => ({ ...prev, [d.code]: { ...t, parKg: Number(e.target.value) || 0 } }))} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-center" style={{ outline: 'none' }} />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">{`Exemple : colis 3 kg → ${eur(t.base + 3 * t.parKg)} (${eur(t.base)} + 3 × ${eur(t.parKg)})`}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Catégories taxes ── */}
      <div className="card p-5 anim-fade">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={18} style={{ color: BRAND.navy }} />
          <p className="font-bold text-lg">Taxes par catégorie de produit</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Chaque catégorie a ses propres taux par destination.</p>

        <div className="space-y-2">
          {categories.map((cat) => {
            const isEditing = catEditId === cat.id;
            return (
              <div key={cat.id} className={`rounded-xl border transition-all ${isEditing ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                <button onClick={() => setCatEditId(isEditing ? null : cat.id)} className="w-full flex items-center justify-between p-3 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{cat.label}</span>
                    {cat.custom && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">★ Libre</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {Object.keys(DESTINATIONS).map((dc) => { const t = getCatTaux(cat, dc); return `${DESTINATIONS[dc].flag}${t.om}%`; }).join(' · ')}
                    </span>
                    <ChevronDown size={16} className={`text-gray-400 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isEditing && (
                  <div className="px-3 pb-3 space-y-3">
                    {cat.custom && (
                      <div>
                        <label className="text-xs font-bold text-gray-500 block mb-1">Nom de la catégorie</label>
                        <input value={cat.label} onChange={(e) => updateCatLabel(cat.id, e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" />
                      </div>
                    )}
                    <div className="space-y-2">
                      {Object.values(DESTINATIONS).map((dest) => {
                        const t = getCatTaux(cat, dest.code);
                        return (
                          <div key={dest.code} className="bg-white rounded-lg p-3 border">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm">{dest.flag}</span>
                              <span className="text-xs font-bold text-gray-700">{dest.nom}</span>
                              <span className="text-xs text-gray-400">{dest.hasOM ? '(OM + OMR)' : '(Taxe conso)'}</span>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-[10px] text-gray-500 block">{dest.hasOM ? 'Taux OM %' : 'Taxe conso %'}</label>
                                <input type="number" step="0.1" min="0" max="100" value={t.om} onChange={(e) => updateCatTaux(cat.id, dest.code, 'om', e.target.value)} className="w-full px-2 py-1.5 rounded-lg border text-sm text-center font-bold" />
                              </div>
                              {dest.hasOM && (
                                <div className="flex-1">
                                  <label className="text-[10px] text-gray-500 block">Taux OMR %</label>
                                  <input type="number" step="0.1" min="0" max="100" value={t.omr} onChange={(e) => updateCatTaux(cat.id, dest.code, 'omr', e.target.value)} className="w-full px-2 py-1.5 rounded-lg border text-sm text-center font-bold" />
                                </div>
                              )}
                              <div className="flex-1">
                                <label className="text-[10px] text-gray-500 block">Sur 100€</label>
                                <div className="px-2 py-1.5 bg-gray-50 rounded-lg text-sm text-center text-gray-500">{eur(t.om + (dest.hasOM ? t.omr : 0))}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {cat.custom && (
                      <button onClick={() => { deleteCategory(cat.id); setCatEditId(null); }} className="w-full py-2 text-red-500 text-xs font-bold border border-red-200 rounded-lg hover:bg-red-50">
                        Supprimer cette catégorie
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add new category */}
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-4">
            <p className="text-sm font-bold text-gray-700 mb-2">Ajouter une catégorie libre</p>
            <div className="flex gap-2 mb-2">
              <input value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} placeholder="Nom de la catégorie (ex: Pièces moto)" className="flex-1 px-3 py-2 rounded-lg border text-sm" />
            </div>
            <button onClick={() => {
              if (!newCat.label.trim()) { flash('Donnez un nom à la catégorie'); return; }
              const taux = {};
              Object.keys(DESTINATIONS).forEach((dc) => { taux[dc] = { om: 0, omr: 0 }; });
              const newId = addCategory(newCat.label.trim(), taux);
              setNewCat({ label: '', taux: {} });
              setCatEditId(newId);
            }} disabled={!newCat.label.trim()} style={{ backgroundColor: BRAND.navy }} className="w-full py-2 text-white rounded-lg text-sm font-bold disabled:opacity-40 hover:opacity-90 active:scale-95 transition-transform">
              Ajouter et configurer les taux
            </button>
          </div>
        </div>
      </div>

      {/* ── Infos système ── */}
      <div className="card p-5 anim-fade">
        <p className="font-bold text-lg mb-3">Informations</p>
        <div className="space-y-1 text-sm">
          <Ligne label="Formule transport" value="Forfait + Poids facturable × Prix/kg" />
          <Ligne label="Poids volumétrique" value="L × l × H ÷ 5000" />
          <Ligne label="Poids facturable" value="Max(réel, volumétrique)" />
          <Ligne label="Frais de stockage" value="1,50 € / jour après J+14" />
          <Ligne label="Relances feu vert" value="J+2, J+5, J+7" />
          <Ligne label="Relances paiement" value="J+3, J+7, J+14" />
        </div>
      </div>
    </div>
  );
}

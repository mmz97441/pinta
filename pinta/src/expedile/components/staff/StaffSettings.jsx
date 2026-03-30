import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plane, CreditCard, FileText, ChevronDown, Trash2, Lock, MessageCircle, Send, CheckCircle, XCircle, Loader2, ShieldAlert, Plus, X, Paperclip, ChevronUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, DESTINATIONS } from '../../constants';
import { eur, labelEnvoi, uid, getCatTaux } from '../../utils';
import { Ligne } from '../ui';
import TemplateEditor from './TemplateEditor';
import { isTelegramConfigured, sendTelegram } from '../../services/telegramApi';

export default function StaffSettings() {
  const { setPage, envois, setEnvois, data, tarifs, setTarifs, categories, addCategory, updateCatTaux, updateCatLabel, deleteCategory, flash, produitsInterdits, setProduitsInterdits, authRole } = useApp();
  const [newEnvoiDate, setNewEnvoiDate] = useState('');
  const [jourEnvoi, setJourEnvoi] = useState(5); // 0=Dim, 1=Lun, ... 5=Ven, 6=Sam
  const [nbSemaines, setNbSemaines] = useState(8);
  const [expandedEnvoi, setExpandedEnvoi] = useState(null);
  const [businessParams, setBusinessParams] = useState({
    fraisStockage: '1.50',
    stockageGratuit: '14',
    relancesFeuVert: 'J+2, J+5, J+7',
    relancesPaiement: 'J+3, J+7, J+14',
    diviseurVolumetrique: '5000',
  });
  const [editingParam, setEditingParam] = useState(null);
  const [paramTmp, setParamTmp] = useState('');
  const [catEditId, setCatEditId] = useState(null);
  const [newCat, setNewCat] = useState({ label: '', taux: {} });

  // ── Auto-generate departures on mount ──
  useEffect(() => {
    const today = new Date();
    const diff = (jourEnvoi - today.getDay() + 7) % 7;
    const next = new Date(today);
    next.setDate(today.getDate() + (diff === 0 ? 7 : diff));

    let added = 0;
    const newEnvois = [...envois];
    for (let w = 0; w < 8; w++) {
      const d = new Date(next);
      d.setDate(next.getDate() + w * 7);
      const dateStr = d.toISOString().slice(0, 10);
      if (!newEnvois.find((e) => e.date === dateStr)) {
        newEnvois.push({ id: uid(), date: dateStr, statut: 'planifie', documents: [] });
        added++;
      }
    }
    if (added > 0) {
      newEnvois.sort((a, b) => a.date.localeCompare(b.date));
      setEnvois(newEnvois);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [newInterdit, setNewInterdit] = useState('');

  // ── Telegram test ──
  const [tgTestChatId, setTgTestChatId] = useState('');
  const [tgTestMsg, setTgTestMsg] = useState('');
  const [tgTestStatus, setTgTestStatus] = useState(null); // null | 'sending' | 'ok' | 'error'
  const [tgTestResult, setTgTestResult] = useState('');

  const handleTgTest = async () => {
    if (!tgTestChatId.trim()) { flash('Entrez un Chat ID'); return; }
    if (!tgTestMsg.trim()) { flash('Entrez un message'); setTgTestStatus(null); return; }
    setTgTestStatus('sending');
    setTgTestResult('');

    const result = await sendTelegram(tgTestChatId.trim(), tgTestMsg.trim());

    if (result.ok) {
      setTgTestStatus('ok');
      setTgTestResult(`Message envoyé ! ID: ${result.messageId || '—'}`);
      flash('Telegram envoyé avec succès !');
    } else {
      setTgTestStatus('error');
      setTgTestResult(result.error || 'Erreur inconnue');
    }
  };

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
          <p className="font-bold text-lg">Planning des départs</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Pré-générez les prochains départs automatiquement.</p>

        {/* Auto-generate */}
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 mb-4 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Génération automatique</p>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 block mb-1">Jour de départ</label>
              <select
                value={jourEnvoi}
                onChange={(e) => setJourEnvoi(parseInt(e.target.value))}
                className="px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-semibold"
                style={{ color: BRAND.navy }}
              >
                <option value={1}>Lundi</option>
                <option value={2}>Mardi</option>
                <option value={3}>Mercredi</option>
                <option value={4}>Jeudi</option>
                <option value={5}>Vendredi</option>
                <option value={6}>Samedi</option>
                <option value={0}>Dimanche</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 block mb-1">Semaines à planifier</label>
              <select
                value={nbSemaines}
                onChange={(e) => setNbSemaines(parseInt(e.target.value))}
                className="px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-semibold"
                style={{ color: BRAND.navy }}
              >
                <option value={2}>2 semaines</option>
                <option value={3}>3 semaines</option>
                <option value={4}>4 semaines</option>
                <option value={6}>6 semaines</option>
                <option value={8}>8 semaines</option>
              </select>
            </div>
            <button
              onClick={() => {
                // Find next occurrence of the chosen day
                const today = new Date();
                let next = new Date(today);
                const diff = (jourEnvoi - today.getDay() + 7) % 7;
                next.setDate(today.getDate() + (diff === 0 ? 7 : diff));

                let added = 0;
                for (let w = 0; w < nbSemaines; w++) {
                  const d = new Date(next);
                  d.setDate(next.getDate() + w * 7);
                  const dateStr = d.toISOString().slice(0, 10);
                  if (!envois.find((e) => e.date === dateStr)) {
                    setEnvois((p) => [...p, { id: uid(), date: dateStr, statut: 'planifie' }]);
                    added++;
                  }
                }
                setEnvois((p) => [...p].sort((a, b) => a.date.localeCompare(b.date)));
                flash(added > 0 ? `${added} départ${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}` : 'Tous les départs existent déjà');
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white active:scale-95 transition-all"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
            >
              Générer les {nbSemaines} prochains départs
            </button>
          </div>
        </div>

        {/* Existing envois */}
        <div className="space-y-2 mb-4">
          {envois.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Aucun départ planifié</p>
          )}
          {envois.map((e) => {
            const count = data.filter((c) => c.envoi === e.id).length;
            const isExpanded = expandedEnvoi === e.id;
            const docs = e.documents || [];
            return (
              <div key={e.id} className="bg-gray-50 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => setExpandedEnvoi(isExpanded ? null : e.id)}
                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{labelEnvoi(e)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{count} colis</span>
                      {docs.length > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          {docs.length} doc{docs.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <select value={e.statut} onChange={(ev) => setEnvois((p) => p.map((x) => (x.id === e.id ? { ...x, statut: ev.target.value } : x)))} className="px-2 py-1 rounded-lg border text-xs">
                    <option value="planifie">○ Planifié</option>
                    <option value="prochain">● Prochain</option>
                    <option value="en_cours">● En cours</option>
                    <option value="parti">✈ Parti</option>
                    <option value="arrive">✓ Arrivé</option>
                  </select>
                  {count === 0 ? (
                    <button onClick={() => { setEnvois((p) => p.filter((x) => x.id !== e.id)); flash('Départ supprimé'); }} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  ) : (
                    <span className="text-gray-300 p-1.5" title="Impossible de supprimer un départ avec des colis affectés"><Lock size={14} /></span>
                  )}
                </div>

                {/* Expanded: documents section */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-200 space-y-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Documents rattachés</p>

                    {/* Existing docs */}
                    {docs.map((doc, di) => (
                      <div key={di} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-100">
                        <Paperclip size={12} className="text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 truncate">{doc.nom}</p>
                          <p className="text-[10px] text-gray-400">{doc.type} — {new Date(doc.date).toLocaleDateString('fr-FR')}</p>
                        </div>
                        <button
                          onClick={() => {
                            const updated = docs.filter((_, j) => j !== di);
                            setEnvois((p) => p.map((x) => x.id === e.id ? { ...x, documents: updated } : x));
                          }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    {/* Add document */}
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <select
                          id={`doc-type-${e.id}`}
                          className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs mb-1"
                          defaultValue="facture_transitaire"
                        >
                          <option value="facture_transitaire">Facture transitaire</option>
                          <option value="dau">DAU (Déclaration douane)</option>
                          <option value="bon_livraison">Bon de livraison</option>
                          <option value="certificat_origine">Certificat d'origine</option>
                          <option value="autre">Autre document</option>
                        </select>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
                          <Paperclip size={13} className="text-gray-400" />
                          <span className="text-xs text-gray-500">Choisir un fichier...</span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                            className="hidden"
                            onChange={(ev) => {
                              const file = ev.target.files?.[0];
                              if (!file) return;
                              const typeSelect = document.getElementById(`doc-type-${e.id}`);
                              const typeLabels = {
                                facture_transitaire: 'Facture transitaire',
                                dau: 'DAU',
                                bon_livraison: 'Bon de livraison',
                                certificat_origine: 'Certificat d\'origine',
                                autre: 'Document',
                              };
                              const newDoc = {
                                nom: file.name,
                                type: typeLabels[typeSelect?.value] || 'Document',
                                typeKey: typeSelect?.value || 'autre',
                                date: new Date().toISOString(),
                                size: file.size,
                              };
                              setEnvois((p) => p.map((x) => x.id === e.id ? { ...x, documents: [...(x.documents || []), newDoc] } : x));
                              flash(`Document "${file.name}" ajouté à ${labelEnvoi(e)}`);
                              ev.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {docs.length === 0 && (
                      <p className="text-[10px] text-gray-400 text-center py-1">Aucun document — ajoutez facture transitaire, DAU, etc.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Manual add */}
        <div className="border-t pt-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Ou ajouter un départ manuellement</p>
          <div className="flex gap-2">
            <input type="date" value={newEnvoiDate} onChange={(e) => setNewEnvoiDate(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <button onClick={() => {
              if (!newEnvoiDate) { flash('Choisissez une date'); return; }
              if (envois.find((e) => e.date === newEnvoiDate)) { flash('Ce départ existe déjà'); return; }
              setEnvois((p) => [...p, { id: uid(), date: newEnvoiDate, statut: 'planifie' }].sort((a, b) => a.date.localeCompare(b.date)));
              setNewEnvoiDate('');
              flash('Départ ajouté');
            }} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 border border-gray-200 hover:bg-gray-50">
              + Ajouter
            </button>
          </div>
        </div>
      </div>

      {/* ── Tarifs transport ── */}
      {['directeur', 'vice_directeur', 'logisticien'].includes(authRole) && (
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
      )}

      {/* ── Catégories taxes ── */}
      {['directeur', 'vice_directeur', 'logisticien'].includes(authRole) && (<>
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

      {/* ── Produits interdits ── */}
      <div className="card p-5 anim-fade">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert size={18} className="text-red-600" />
          <p className="font-bold text-lg">Produits interdits</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Liste des produits interdits au transport aérien. Modifiable selon la réglementation.</p>

        <div className="flex flex-wrap gap-2 mb-4">
          {produitsInterdits.map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200">
              {item}
              <button
                type="button"
                onClick={() => {
                  setProduitsInterdits((prev) => prev.filter((i) => i !== item));
                  flash(`"${item}" retiré de la liste`);
                }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-red-200 transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {produitsInterdits.length === 0 && (
            <p className="text-sm text-gray-400 italic">Aucun produit interdit configuré</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newInterdit}
            onChange={(e) => setNewInterdit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newInterdit.trim()) {
                if (produitsInterdits.includes(newInterdit.trim())) {
                  flash('Ce produit est déjà dans la liste');
                  return;
                }
                setProduitsInterdits((prev) => [...prev, newInterdit.trim()]);
                flash(`"${newInterdit.trim()}" ajouté`);
                setNewInterdit('');
              }
            }}
            placeholder="Ajouter un produit interdit..."
            className="flex-1 px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-red-300"
            style={{ color: BRAND.navy }}
          />
          <button
            onClick={() => {
              if (!newInterdit.trim()) return;
              if (produitsInterdits.includes(newInterdit.trim())) {
                flash('Ce produit est déjà dans la liste');
                return;
              }
              setProduitsInterdits((prev) => [...prev, newInterdit.trim()]);
              flash(`"${newInterdit.trim()}" ajouté`);
              setNewInterdit('');
            }}
            disabled={!newInterdit.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
            style={{ background: BRAND.navy }}
          >
            <Plus size={14} />
            Ajouter
          </button>
        </div>
      </div>
      </>)}

      {/* ── Telegram Bot ── */}
      <div className="card p-5 anim-fade">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle size={18} style={{ color: '#0088cc' }} />
          <p className="font-bold text-lg">Telegram Bot</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Envoyez des messages Telegram automatiquement aux clients via le Bot API.
        </p>

        {/* Statut de la config */}
        <div
          className="flex items-center gap-2.5 p-3 rounded-xl mb-4"
          style={{
            background: isTelegramConfigured() ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${isTelegramConfigured() ? '#BBF7D0' : '#FECACA'}`,
          }}
        >
          {isTelegramConfigured() ? (
            <>
              <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-green-800">Bot configuré</p>
                <p className="text-xs text-green-600">
                  Bot : @expedile_bot
                </p>
              </div>
            </>
          ) : (
            <>
              <XCircle size={16} className="text-red-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-800">Bot non configuré</p>
                <p className="text-xs text-red-600">
                  Créez un fichier <code className="bg-red-100 px-1 rounded">.env</code> avec la variable VITE_TELEGRAM_BOT_TOKEN
                </p>
              </div>
            </>
          )}
        </div>

        {isTelegramConfigured() && (
          <div className="space-y-3">
            {/* Chat ID */}
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">Chat ID destinataire</label>
              <input
                type="text"
                value={tgTestChatId}
                onChange={(e) => setTgTestChatId(e.target.value)}
                placeholder="123456789"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-mono outline-none focus:border-blue-400"
              />
            </div>

            {/* Message */}
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">Message</label>
              <textarea
                value={tgTestMsg}
                onChange={(e) => setTgTestMsg(e.target.value)}
                placeholder="Bonjour, ceci est un test Expedîle !"
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-400 resize-none"
              />
            </div>

            {/* Bouton envoyer */}
            <button
              onClick={handleTgTest}
              disabled={tgTestStatus === 'sending'}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: '#0088cc' }}
            >
              {tgTestStatus === 'sending' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Envoi en cours…
                </>
              ) : (
                <>
                  <Send size={14} />
                  Envoyer le test
                </>
              )}
            </button>

            {/* Résultat */}
            {tgTestStatus === 'ok' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
                <p className="text-xs text-green-700 font-medium">{tgTestResult}</p>
              </div>
            )}
            {tgTestStatus === 'error' && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle size={16} className="text-red-600 flex-shrink-0" />
                  <p className="text-xs text-red-700 font-bold">Erreur</p>
                </div>
                <p className="text-xs text-red-600 font-mono break-all">{tgTestResult}</p>
              </div>
            )}

            {/* Guide rapide */}
            <div className="border-t pt-3 mt-3">
              <p className="text-xs font-bold text-gray-700 mb-2">Guide rapide</p>
              <div className="space-y-1.5 text-xs text-gray-500">
                <p>1. Créez un bot via <span className="font-mono">@BotFather</span> sur Telegram et récupérez le token.</p>
                <p>2. Les clients doivent démarrer une conversation avec le bot pour obtenir un Chat ID.</p>
                <p>3. Les messages supportent le formatage *Markdown* (gras, italique, etc.).</p>
                <p>4. Pas de fenêtre de 24h comme WhatsApp — les messages peuvent être envoyés à tout moment.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Paramètres métier (direction only) ── */}
      {['directeur', 'vice_directeur'].includes(authRole) && (
      <div className="card p-5 anim-fade">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={18} style={{ color: BRAND.navy }} />
          <p className="font-bold text-lg">Paramètres métier</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Règles de calcul, frais et relances — modifiables par la direction.</p>

        <div className="space-y-3">
          {[
            { key: 'fraisStockage', label: 'Frais de stockage (€/jour)', defaultVal: '1.50', suffix: '€ / jour' },
            { key: 'stockageGratuit', label: 'Jours de stockage gratuit', defaultVal: '14', suffix: 'jours' },
            { key: 'relancesFeuVert', label: 'Relances feu vert (jours)', defaultVal: 'J+2, J+5, J+7', suffix: '' },
            { key: 'relancesPaiement', label: 'Relances paiement (jours)', defaultVal: 'J+3, J+7, J+14', suffix: '' },
            { key: 'diviseurVolumetrique', label: 'Diviseur volumétrique', defaultVal: '5000', suffix: '(L×l×H ÷ X)' },
          ].map(({ key, label, defaultVal, suffix }) => {
            const currentVal = businessParams[key] ?? defaultVal;
            const isEditing = editingParam === key;
            return (
              <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs font-semibold text-gray-600">{label}</span>
                {isEditing ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={paramTmp}
                      onChange={(e) => setParamTmp(e.target.value)}
                      className="px-2 py-1 rounded-lg border-2 border-blue-400 text-sm font-mono w-32 text-right outline-none"
                    />
                    {suffix && <span className="text-[10px] text-gray-400">{suffix}</span>}
                    <button onClick={() => {
                      setBusinessParams((p) => ({ ...p, [key]: paramTmp }));
                      setEditingParam(null);
                      flash('Paramètre mis à jour');
                    }} className="p-1 text-green-600 hover:bg-green-50 rounded"><CheckCircle size={14} /></button>
                    <button onClick={() => setEditingParam(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingParam(key); setParamTmp(currentVal); }}
                    className="text-sm font-mono font-bold text-right hover:text-blue-600 transition-colors"
                    style={{ color: BRAND.navy }}
                  >
                    {currentVal} {suffix && <span className="text-[10px] text-gray-400 font-sans">{suffix}</span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1 text-xs text-gray-400">
          <p><span className="font-semibold">Formule transport :</span> Forfait + Poids facturable × Prix/kg</p>
          <p><span className="font-semibold">Poids facturable :</span> Max(poids réel, poids volumétrique)</p>
        </div>
      </div>
      )}

      {/* ── Templates de messages ── */}
      {['directeur', 'vice_directeur'].includes(authRole) && (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle size={18} style={{ color: BRAND.navy }} />
          <p className="font-bold text-lg">Templates de messages</p>
        </div>
        <p className="text-sm text-gray-500 mb-4">Personnalisez les messages envoyés aux clients (Telegram et email). Cliquez sur une variable pour l'insérer.</p>
        <TemplateEditor />
      </div>
      )}
    </div>
  );
}

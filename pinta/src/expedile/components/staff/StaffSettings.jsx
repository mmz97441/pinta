import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plane, CreditCard, FileText, ChevronDown, Trash2, Lock, MessageCircle, Send, CheckCircle, XCircle, Loader2, ShieldAlert, Plus, X, Paperclip, ChevronUp, Archive, AlertTriangle, RotateCcw, Square, CheckSquare } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, DESTINATIONS } from '../../constants';
import { eur, labelEnvoi, uid, getCatTaux } from '../../utils';
import { Ligne } from '../ui';
import TemplateEditor from './TemplateEditor';
import StaffPermissions from './StaffPermissions';
import { isTelegramConfigured, sendTelegram } from '../../services/telegramApi';
import * as sb from '../../lib/supabaseData';

export default function StaffSettings() {
  const navigate = useNavigate();
  const { envois, setEnvois, data, tarifs, setTarifs, categories, addCategory, updateCatTaux, updateCatLabel, deleteCategory, flash, produitsInterdits, setProduitsInterdits, authRole, sbReady } = useApp();
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
  const [settingsTab, setSettingsTab] = useState('planning');
  const [catEditId, setCatEditId] = useState(null);
  const [newCat, setNewCat] = useState({ label: '', taux: {} });

  // ── Multi-selection envois ──
  const [selectedEnvois, setSelectedEnvois] = useState(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'archive'|'delete'|'delete_with_colis', ids: [], colisCount: 0 }

  // ── Auto-generate departures on mount ──
  useEffect(() => {
    const today = new Date();
    const diff = (jourEnvoi - today.getDay() + 7) % 7;
    const next = new Date(today);
    next.setDate(today.getDate() + (diff === 0 ? 7 : diff));

    let added = 0;
    const newEnvois = [...envois];
    const toInsert = [];
    for (let w = 0; w < 8; w++) {
      const d = new Date(next);
      d.setDate(next.getDate() + w * 7);
      const dateStr = d.toISOString().slice(0, 10);
      if (!newEnvois.find((e) => e.date === dateStr)) {
        const newEnvoi = { id: uid(), date: dateStr, statut: 'planifie', documents: [] };
        newEnvois.push(newEnvoi);
        toInsert.push(newEnvoi);
        added++;
      }
    }
    if (added > 0) {
      newEnvois.sort((a, b) => a.date.localeCompare(b.date));
      setEnvois(newEnvois);
      // Persist new envois to Supabase
      if (sbReady) {
        toInsert.forEach((e) => {
          sb.insertEnvoi({ date: e.date, statut: e.statut }).then((saved) => {
            // Replace temp ID with real Supabase ID
            setEnvois((prev) => prev.map((x) => x.id === e.id ? { ...x, id: saved.id } : x));
          }).catch(console.error);
        });
      }
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
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors" style={{ color: BRAND.navy }}>
          <ArrowLeft size={16} />Retour
        </button>
      </div>

      {/* ── Onglets ── */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-0">
        {[
          { key: 'planning', label: 'Planning' },
          { key: 'tarifs', label: 'Tarifs' },
          { key: 'categories', label: 'Catégories' },
          { key: 'users', label: 'Utilisateurs' },
          { key: 'telegram', label: 'Telegram' },
          { key: 'templates', label: 'Templates' },
          { key: 'metier', label: 'Métier' },
          { key: 'interdits', label: 'Interdits' },
        ].map((tab) => (
          <button key={tab.key} onClick={() => setSettingsTab(tab.key)}
            className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all ${
              settingsTab === tab.key ? 'border-current' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
            style={settingsTab === tab.key ? { color: BRAND.navy, borderColor: BRAND.navy } : {}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Utilisateurs & Permissions ── */}
      {settingsTab === 'users' && (
        <div className="card p-5">
          <StaffPermissions />
        </div>
      )}

      {/* ── Départs ── */}
      {settingsTab === 'planning' && (
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
                const toInsert = [];
                const newItems = [];
                for (let w = 0; w < nbSemaines; w++) {
                  const d = new Date(next);
                  d.setDate(next.getDate() + w * 7);
                  const dateStr = d.toISOString().slice(0, 10);
                  if (!envois.find((e) => e.date === dateStr)) {
                    const newEnvoi = { id: uid(), date: dateStr, statut: 'planifie' };
                    newItems.push(newEnvoi);
                    toInsert.push(newEnvoi);
                    added++;
                  }
                }
                if (newItems.length > 0) {
                  setEnvois((p) => [...p, ...newItems].sort((a, b) => a.date.localeCompare(b.date)));
                  // Persist to Supabase
                  if (sbReady) {
                    toInsert.forEach((e) => {
                      sb.insertEnvoi({ date: e.date, statut: e.statut }).then((saved) => {
                        setEnvois((prev) => prev.map((x) => x.id === e.id ? { ...x, id: saved.id } : x));
                      }).catch(console.error);
                    });
                  }
                }
                flash(added > 0 ? `${added} départ${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}` : 'Tous les départs existent déjà');
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white active:scale-95 transition-all"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
            >
              Générer les {nbSemaines} prochains départs
            </button>
          </div>
        </div>

        {/* ── Confirmation Modal ── */}
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4" onClick={(ev) => ev.stopPropagation()}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${confirmModal.type === 'archive' ? 'bg-amber-100' : 'bg-red-100'}`}>
                  {confirmModal.type === 'archive' ? (
                    <Archive size={20} className="text-amber-600" />
                  ) : (
                    <AlertTriangle size={20} className="text-red-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base" style={{ color: BRAND.navy }}>
                    {confirmModal.type === 'archive' ? 'Archiver les envois' : 'Supprimer les envois'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {confirmModal.ids.length} envoi{confirmModal.ids.length > 1 ? 's' : ''} sélectionné{confirmModal.ids.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {confirmModal.type === 'archive' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
                  <p className="text-sm font-semibold text-amber-800">Que se passe-t-il en archivant ?</p>
                  <ul className="text-xs text-amber-700 space-y-1 list-disc pl-4">
                    <li>Les envois seront masqués de la vue principale</li>
                    <li>Les colis rattachés restent liés à l'envoi (historique conservé)</li>
                    <li>Aucune donnée n'est supprimée</li>
                    <li>Vous pouvez retrouver les envois archivés via le bouton "Voir archivés"</li>
                  </ul>
                  {confirmModal.colisCount > 0 && (
                    <p className="text-xs font-bold text-amber-800 pt-1">
                      {confirmModal.colisCount} colis rattaché{confirmModal.colisCount > 1 ? 's' : ''} — leur historique sera préservé.
                    </p>
                  )}
                </div>
              )}

              {confirmModal.type === 'delete' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1.5">
                  <p className="text-sm font-semibold text-red-800">Attention — action irréversible</p>
                  <ul className="text-xs text-red-700 space-y-1 list-disc pl-4">
                    <li>Les envois seront définitivement supprimés</li>
                    <li>Les documents rattachés seront perdus</li>
                    {confirmModal.colisCount > 0 && (
                      <li className="font-bold">
                        {confirmModal.colisCount} colis sont rattachés — ils seront détachés de l'envoi (remis sans affectation)
                      </li>
                    )}
                  </ul>
                  {confirmModal.colisCount > 0 && (
                    <p className="text-xs text-red-800 pt-1 font-semibold">
                      Nous recommandons d'archiver plutôt que de supprimer quand des colis sont rattachés.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                {confirmModal.type === 'delete' && confirmModal.colisCount > 0 && (
                  <button
                    onClick={() => {
                      // Archive instead of delete
                      confirmModal.ids.forEach((eid) => {
                        setEnvois((p) => p.map((x) => x.id === eid ? { ...x, statut: 'archive' } : x));
                        if (sbReady) sb.updateEnvoi(eid, { statut: 'archive' }).catch(console.error);
                      });
                      setSelectedEnvois(new Set());
                      setConfirmModal(null);
                      flash({ msg: `${confirmModal.ids.length} envoi${confirmModal.ids.length > 1 ? 's' : ''} archivé${confirmModal.ids.length > 1 ? 's' : ''} (recommandé)`, type: 'success' });
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors"
                  >
                    <span className="flex items-center gap-1.5"><Archive size={14} /> Archiver plutôt</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirmModal.type === 'archive') {
                      confirmModal.ids.forEach((eid) => {
                        setEnvois((p) => p.map((x) => x.id === eid ? { ...x, statut: 'archive' } : x));
                        if (sbReady) sb.updateEnvoi(eid, { statut: 'archive' }).catch(console.error);
                      });
                      flash({ msg: `${confirmModal.ids.length} envoi${confirmModal.ids.length > 1 ? 's' : ''} archivé${confirmModal.ids.length > 1 ? 's' : ''}`, type: 'success' });
                    } else {
                      // Delete: detach colis first, then delete envois
                      confirmModal.ids.forEach((eid) => {
                        // Detach colis linked to this envoi
                        data.filter((c) => c.envoi === eid).forEach((c) => {
                          if (sbReady) sb.updateColis(c.id, { envoi: null }).catch(console.error);
                        });
                        setEnvois((p) => p.filter((x) => x.id !== eid));
                        if (sbReady) sb.deleteEnvoi(eid).catch(console.error);
                      });
                      flash({ msg: `${confirmModal.ids.length} envoi${confirmModal.ids.length > 1 ? 's' : ''} supprimé${confirmModal.ids.length > 1 ? 's' : ''}`, type: 'success' });
                    }
                    setSelectedEnvois(new Set());
                    setConfirmModal(null);
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors ${
                    confirmModal.type === 'archive'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {confirmModal.type === 'archive' ? (
                    <span className="flex items-center gap-1.5"><Archive size={14} /> Archiver</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><Trash2 size={14} /> Supprimer définitivement</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bulk action bar + filter ── */}
        {(() => {
          const visibleEnvois = showArchived ? envois.filter((e) => e.statut === 'archive') : envois.filter((e) => e.statut !== 'archive');
          const archivedCount = envois.filter((e) => e.statut === 'archive').length;
          const allVisibleIds = visibleEnvois.map((e) => e.id);
          const allSelected = visibleEnvois.length > 0 && visibleEnvois.every((e) => selectedEnvois.has(e.id));

          return (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* Select all checkbox */}
                  <button
                    onClick={() => {
                      if (allSelected) {
                        setSelectedEnvois(new Set());
                      } else {
                        setSelectedEnvois(new Set(allVisibleIds));
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                    title={allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  >
                    {allSelected ? <CheckSquare size={16} className="text-blue-500" /> : <Square size={16} />}
                    <span>{allSelected ? 'Désélectionner tout' : 'Tout sélectionner'}</span>
                  </button>

                  {selectedEnvois.size > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {selectedEnvois.size} sélectionné{selectedEnvois.size > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Bulk actions */}
                  {selectedEnvois.size > 0 && !showArchived && (
                    <>
                      <button
                        onClick={() => {
                          const ids = [...selectedEnvois];
                          const totalColis = ids.reduce((sum, eid) => sum + data.filter((c) => c.envoi === eid).length, 0);
                          setConfirmModal({ type: 'archive', ids, colisCount: totalColis });
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors"
                      >
                        <Archive size={13} /> Archiver
                      </button>
                      <button
                        onClick={() => {
                          const ids = [...selectedEnvois];
                          const totalColis = ids.reduce((sum, eid) => sum + data.filter((c) => c.envoi === eid).length, 0);
                          setConfirmModal({ type: 'delete', ids, colisCount: totalColis });
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-100 hover:bg-red-200 transition-colors"
                      >
                        <Trash2 size={13} /> Supprimer
                      </button>
                    </>
                  )}

                  {/* Restore selected archived */}
                  {selectedEnvois.size > 0 && showArchived && (
                    <button
                      onClick={() => {
                        const ids = [...selectedEnvois];
                        ids.forEach((eid) => {
                          setEnvois((p) => p.map((x) => x.id === eid ? { ...x, statut: 'arrive' } : x));
                          if (sbReady) sb.updateEnvoi(eid, { statut: 'arrive' }).catch(console.error);
                        });
                        setSelectedEnvois(new Set());
                        flash({ msg: `${ids.length} envoi${ids.length > 1 ? 's' : ''} restauré${ids.length > 1 ? 's' : ''}`, type: 'success' });
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors"
                    >
                      <RotateCcw size={13} /> Restaurer
                    </button>
                  )}

                  {/* Toggle archived view */}
                  {archivedCount > 0 && (
                    <button
                      onClick={() => { setShowArchived((p) => !p); setSelectedEnvois(new Set()); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        showArchived ? 'text-white bg-gray-600 hover:bg-gray-700' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      <Archive size={13} />
                      {showArchived ? 'Voir actifs' : `Voir archivés (${archivedCount})`}
                    </button>
                  )}
                </div>
              </div>

              {/* Envois list */}
              <div className="space-y-2 mb-4">
                {visibleEnvois.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    {showArchived ? 'Aucun envoi archivé' : 'Aucun départ planifié'}
                  </p>
                )}
                {visibleEnvois.map((e) => {
                  const count = data.filter((c) => c.envoi === e.id).length;
                  const isExpanded = expandedEnvoi === e.id;
                  const docs = e.documents || [];
                  const isChecked = selectedEnvois.has(e.id);
                  return (
                    <div key={e.id} className={`rounded-xl overflow-hidden transition-all ${isChecked ? 'bg-blue-50 ring-2 ring-blue-300' : 'bg-gray-50'} ${showArchived ? 'opacity-75' : ''}`}>
                      <div className="flex items-center gap-2 p-3">
                        {/* Checkbox */}
                        <button
                          onClick={() => {
                            setSelectedEnvois((prev) => {
                              const next = new Set(prev);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              return next;
                            });
                          }}
                          className="flex-shrink-0"
                        >
                          {isChecked
                            ? <CheckSquare size={16} className="text-blue-500" />
                            : <Square size={16} className="text-gray-300 hover:text-gray-500" />
                          }
                        </button>

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

                        {!showArchived ? (
                          <>
                            <select
                              value={e.statut}
                              onChange={(ev) => {
                                const newStatut = ev.target.value;
                                if (newStatut === 'archive') {
                                  const totalColis = data.filter((c) => c.envoi === e.id).length;
                                  setConfirmModal({ type: 'archive', ids: [e.id], colisCount: totalColis });
                                  return;
                                }
                                setEnvois((p) => p.map((x) => (x.id === e.id ? { ...x, statut: newStatut } : x)));
                                if (sbReady) sb.updateEnvoi(e.id, { statut: newStatut }).catch(console.error);
                              }}
                              className="px-2 py-1 rounded-lg border text-xs"
                            >
                              <option value="planifie">○ Planifié</option>
                              <option value="prochain">● Prochain</option>
                              <option value="en_cours">● En cours</option>
                              <option value="parti">✈ Parti</option>
                              <option value="arrive">✓ Arrivé</option>
                              <option value="archive">📦 Archiver</option>
                            </select>

                            {/* Individual delete */}
                            <button
                              onClick={() => {
                                const totalColis = data.filter((c) => c.envoi === e.id).length;
                                setConfirmModal({ type: 'delete', ids: [e.id], colisCount: totalColis });
                              }}
                              className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Supprimer cet envoi"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              setEnvois((p) => p.map((x) => x.id === e.id ? { ...x, statut: 'arrive' } : x));
                              if (sbReady) sb.updateEnvoi(e.id, { statut: 'arrive' }).catch(console.error);
                              flash({ msg: 'Envoi restauré', type: 'success' });
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-blue-600 bg-blue-100 hover:bg-blue-200 transition-colors"
                          >
                            <RotateCcw size={12} /> Restaurer
                          </button>
                        )}
                      </div>

                      {/* Expanded: documents section */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-gray-200 space-y-2">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Documents rattachés</p>

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

                          {!showArchived && (
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
                          )}

                          {docs.length === 0 && (
                            <p className="text-[10px] text-gray-400 text-center py-1">Aucun document — ajoutez facture transitaire, DAU, etc.</p>
                          )}

                          {/* Show linked colis */}
                          {count > 0 && (
                            <div className="pt-1">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Colis rattachés</p>
                              <div className="flex flex-wrap gap-1">
                                {data.filter((c) => c.envoi === e.id).map((c) => (
                                  <span key={c.id} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                                    {c.ref}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

        {/* Manual add */}
        {!showArchived && (
        <div className="border-t pt-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Ou ajouter un départ manuellement</p>
          <div className="flex gap-2">
            <input type="date" value={newEnvoiDate} onChange={(e) => setNewEnvoiDate(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <button onClick={() => {
              if (!newEnvoiDate) { flash('Choisissez une date'); return; }
              if (envois.find((e) => e.date === newEnvoiDate)) { flash('Ce départ existe déjà'); return; }
              const tempId = uid();
              setEnvois((p) => [...p, { id: tempId, date: newEnvoiDate, statut: 'planifie' }].sort((a, b) => a.date.localeCompare(b.date)));
              if (sbReady) {
                sb.insertEnvoi({ date: newEnvoiDate, statut: 'planifie' }).then((saved) => {
                  setEnvois((prev) => prev.map((x) => x.id === tempId ? { ...x, id: saved.id } : x));
                }).catch(console.error);
              }
              setNewEnvoiDate('');
              flash('Départ ajouté');
            }} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 border border-gray-200 hover:bg-gray-50">
              + Ajouter
            </button>
          </div>
        </div>
        )}
      </div>

      )}

      {/* ── Tarifs transport ── */}
      {settingsTab === 'tarifs' && ['directeur', 'vice_directeur', 'logisticien'].includes(authRole) && (
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
                    <input type="text" inputMode="decimal" value={t.base || ''} onFocus={(e) => { if (e.target.value === '0') e.target.value = ''; }} onChange={(e) => { const raw = e.target.value.replace(',', '.'); if (raw === '' || /^\d*\.?\d*$/.test(raw)) { const newBase = raw === '' ? 0 : Number(raw) || 0; setTarifs((prev) => ({ ...prev, [d.code]: { ...t, base: newBase } })); if (sbReady) sb.updateTarif(d.code, newBase, t.parKg).catch(console.error); } }} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-center" style={{ outline: 'none' }} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Prix par kg (€)</label>
                    <input type="text" inputMode="decimal" value={t.parKg || ''} onFocus={(e) => { if (e.target.value === '0') e.target.value = ''; }} onChange={(e) => { const raw = e.target.value.replace(',', '.'); if (raw === '' || /^\d*\.?\d*$/.test(raw)) { const newParKg = raw === '' ? 0 : Number(raw) || 0; setTarifs((prev) => ({ ...prev, [d.code]: { ...t, parKg: newParKg } })); if (sbReady) sb.updateTarif(d.code, t.base, newParKg).catch(console.error); } }} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-center" style={{ outline: 'none' }} />
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
      {settingsTab === 'categories' && ['directeur', 'vice_directeur', 'logisticien'].includes(authRole) && (
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
                                <input type="text" inputMode="decimal" value={t.om || ''} onFocus={(e) => { if (e.target.value === '0') e.target.value = ''; }} onChange={(e) => { const raw = e.target.value.replace(',', '.'); if (raw === '' || /^\d*\.?\d*$/.test(raw)) updateCatTaux(cat.id, dest.code, 'om', raw === '' ? '0' : raw); }} className="w-full px-2 py-1.5 rounded-lg border text-sm text-center font-bold" />
                              </div>
                              {dest.hasOM && (
                                <div className="flex-1">
                                  <label className="text-[10px] text-gray-500 block">Taux OMR %</label>
                                  <input type="text" inputMode="decimal" value={t.omr || ''} onFocus={(e) => { if (e.target.value === '0') e.target.value = ''; }} onChange={(e) => { const raw = e.target.value.replace(',', '.'); if (raw === '' || /^\d*\.?\d*$/.test(raw)) updateCatTaux(cat.id, dest.code, 'omr', raw === '' ? '0' : raw); }} className="w-full px-2 py-1.5 rounded-lg border text-sm text-center font-bold" />
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
      )}

      {/* ── Produits interdits ── */}
      {settingsTab === 'interdits' && (
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
      )}

      {/* ── Telegram Bot ── */}
      {settingsTab === 'telegram' && (
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
                  Bot : @Expedilebot
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

      )}

      {/* ── Paramètres métier (direction only) ── */}
      {settingsTab === 'metier' && ['directeur', 'vice_directeur'].includes(authRole) && (
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
      {settingsTab === 'templates' && ['directeur', 'vice_directeur'].includes(authRole) && (
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

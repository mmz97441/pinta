import React, { useState, useRef } from 'react';
import { Check, X, RotateCcw, Eye, Upload, FileText, Image as ImageIcon, ZoomIn, Plus, Send, Scan } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, getDestByCP } from '../../constants';
import { eur, uid, getPrenom } from '../../utils';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { sendTelegramReply } from '../../services/telegramApi';

const MOTIFS_REJET = [
  { key: 'non_conforme', label: 'Non conforme' },
  { key: 'illisible', label: 'Illisible / mauvaise qualité' },
  { key: 'montant', label: 'Montant incorrect' },
  { key: 'date', label: 'Date invalide' },
  { key: 'nom', label: 'Nom/adresse erroné(e)' },
];

// ── Lightbox overlay ─────────────────────────────────────────────────────
function Lightbox({ src, onClose, title }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
      >
        <X size={20} />
      </button>
      {title && (
        <div className="absolute top-4 left-4 text-white text-sm font-bold bg-black/40 px-3 py-1.5 rounded-lg">
          {title}
        </div>
      )}
      <div className="max-w-[90vw] max-h-[85vh] overflow-auto rounded-xl" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Facture" className="max-w-full max-h-[85vh] object-contain rounded-xl" />
      </div>
    </div>
  );
}

export default function FacturesPanel() {
  const { sel, isStaff, setData, flash, sendMsg, getClient } = useApp();
  const [rejectingId, setRejectingId] = useState(null);
  const [motifLibre, setMotifLibre] = useState('');
  const [previewSrc, setPreviewSrc] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const fileInputRef = useRef(null);
  const [uploadTargetId, setUploadTargetId] = useState(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newVendeur, setNewVendeur] = useState('');
  const [newMontant, setNewMontant] = useState('');
  const [ocrLoading, setOcrLoading] = useState(null);
  const [collapsed, setCollapsed] = useState(true); // factureId being analyzed

  if (!sel) return null;

  const cl = getClient(sel.clientId);
  const canal = cl?.telegramChatId ? 'telegram' : 'email';
  const hasFactures = sel.factures && sel.factures.length > 0;

  // ── Add new facture ─────────────────────────────────────────────────
  const handleAddFacture = async () => {
    if (!newVendeur.trim()) return;
    const factureData = {
      vendeur: newVendeur.trim(),
      montant: parseFloat(newMontant) || 0,
      valide: false,
    };
    let newFacture;
    try {
      newFacture = await sb.insertFacture(sel.id, factureData);
    } catch (err) {
      console.warn('[Supabase] insertFacture fallback:', err.message);
      newFacture = { id: 'f_' + uid(), ...factureData, fichier: null, fichierNom: null };
    }
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: [...(c.factures || []), newFacture] };
    }));
    setNewVendeur('');
    setNewMontant('');
    setShowAddForm(false);
    flash('Facture ajoutée');
    sb.insertAuditAction(sel.id, 'Staff', 'Facture ajoutée', `${newVendeur.trim()} — ${parseFloat(newMontant) || 0} €`).catch(() => {});
  };

  // ── Request facture from client (uses same template as StaffDetailView) ──
  const handleDemanderFacture = (sendCanal) => {
    sendMsg(sel.id, sel.clientId, sendCanal, 'facture_manquante', null);
    flash(`Demande de facture envoyée par ${sendCanal === 'telegram' ? 'Telegram' : 'email'}`);
  };

  // ── Validate ───────────────────────────────────────────────────────────
  const validateFacture = (factureId) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: true, rejetMotif: null } : f)) };
    }));
    sb.updateFacture(factureId, { valide: true }).catch(console.error);
    flash('Facture validée');
    sb.insertAuditAction(sel.id, 'Staff', 'Facture validée', `ID: ${factureId}`).catch(() => {});
    setRejectingId(null);
  };

  // ── Undo validation ────────────────────────────────────────────────────
  const unvalidateFacture = (factureId) => {
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === factureId ? { ...f, valide: false } : f)) };
    }));
    sb.updateFacture(factureId, { valide: false }).catch(console.error);
    flash('Validation annulée');
  };

  // ── Reject with motif ──────────────────────────────────────────────────
  const rejectFacture = async (facture, motifLabel) => {
    // Persist to Supabase
    sb.updateFacture(facture.id, { valide: false, rejetMotif: motifLabel }).catch(console.error);
    // Update local state
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return { ...c, factures: c.factures.map((f) => (f.id === facture.id ? { ...f, valide: false, rejetMotif: motifLabel } : f)) };
    }));

    const dest = getDestByCP(cl?.cp);
    const nom = getPrenom(cl) || '';
    const chatId = cl?.telegramChatId;

    // Reply to the SPECIFIC Telegram message (if the facture was sent via Telegram)
    if (chatId && facture.telegramMsgId) {
      const replyMsg = `⚠️ *Facture "${facture.vendeur}" refusée*\n\n📄 *Motif : ${motifLabel}*\n\n👉 Merci de nous renvoyer une facture conforme (photo ou PDF lisible) pour votre colis *${sel.ref}*.\n\nSans facture validée, nous ne pouvons pas avancer.\n\n_Expedîle${dest ? ` — Paris → ${dest.nom}` : ''}_`;
      sendTelegramReply(chatId, replyMsg, facture.telegramMsgId);
      // Also persist the message in chat
      sb.insertMessage(sel.id, {
        type: 'staff',
        auteur: 'Système',
        texte: `❌ Facture "${facture.vendeur}" refusée — Motif : ${motifLabel}`,
        statut: 'envoye',
      }).catch(console.error);
    } else {
      // Fallback: send via sendMsg (generic, not reply)
      const msg = canal === 'telegram'
        ? `Bonjour ${nom} 👋\n\n⚠️ La facture *${facture.vendeur}* (${eur(facture.montant)}) pour votre colis *${sel.ref}* n'a pas pu être validée.\n\n📄 *Motif : ${motifLabel}*\n\n👉 Merci de nous renvoyer une facture conforme dès que possible.\n\n_Expedîle${dest ? ` — Paris → ${dest.nom}` : ''}_`
        : `Objet : Facture rejetée — ${sel.ref}\n\nBonjour ${cl?.nom || ''},\n\nLa facture ${facture.vendeur} (${eur(facture.montant)}) pour votre colis ${sel.ref} n'a pas pu être validée.\nMotif : ${motifLabel}.\n\nMerci de nous renvoyer une facture conforme.\n\nCordialement,\nL'équipe Expedîle`;
      sendMsg(sel.id, sel.clientId, canal, null, msg);
    }

    flash('Facture refusée — client notifié');
    sb.insertAuditAction(sel.id, 'Staff', 'Facture refusée', `"${facture.vendeur}" — Motif : ${motifLabel}`).catch(() => {});
    setRejectingId(null);
    setMotifLibre('');
  };

  // ── Upload file ────────────────────────────────────────────────────────
  const handleFileUpload = (factureId) => {
    setUploadTargetId(factureId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;

    // Upload to Supabase Storage
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${sel.id}/${uploadTargetId}.${ext}`;

    flash({ msg: 'Upload en cours...', type: 'info' });

    const { error: uploadErr } = await supabase.storage
      .from('factures')
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      flash({ msg: 'Erreur upload : ' + uploadErr.message, type: 'warning' });
      e.target.value = '';
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('factures')
      .getPublicUrl(path);

    const publicUrl = urlData?.publicUrl || '';
    console.log('[FacturesPanel] Upload complete, publicUrl:', publicUrl, 'for facture:', uploadTargetId);

    // Update local state + Supabase
    setData((prev) => prev.map((c) => {
      if (c.id !== sel.id) return c;
      return {
        ...c,
        factures: c.factures.map((f) =>
          f.id === uploadTargetId ? { ...f, fichier: publicUrl, fichierNom: file.name } : f,
        ),
      };
    }));

    // Persist URL to Supabase factures table
    sb.updateFacture(uploadTargetId, { fichierUrl: publicUrl, fichierNom: file.name }).catch(console.error);

    flash({ msg: 'Fichier joint à la facture', type: 'success' });
    setUploadTargetId(null);
    e.target.value = '';
  };

  // ── Open preview ───────────────────────────────────────────────────────
  // ── OCR Analysis ────────────────────────────────────────────────────
  const handleOCR = async (facture) => {
    if (!facture.fichier) {
      flash({ msg: 'Aucun fichier joint — joignez la facture d\'abord', type: 'warning' });
      return;
    }
    setOcrLoading(facture.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bqprktzehuhplpqjgjaz.supabase.co';
      // TODO: Remplacer par JWT Supabase Auth quand verify_jwt sera activé
      const edgeSecret = import.meta.env.VITE_EDGE_API_SECRET || '';
      const res = await fetch(`${supabaseUrl}/functions/v1/ocr-facture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': edgeSecret },
        body: JSON.stringify({
          imageUrl: facture.fichier,
          colisId: sel.id,
          factureId: facture.id,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.error) {
        flash({
          msg: `OCR échoué (${data.error}). Saisissez les articles manuellement dans la section « Articles déclarés » en dessous.`,
          type: 'warning',
          duration: 8000,
        });
        return;
      }

      if (data.success) {
        // Update local state with extracted articles
        if (data.insertedLignes?.length > 0) {
          setData((prev) => prev.map((c) => {
            if (c.id !== sel.id) return c;
            return { ...c, lignes: [...(c.lignes || []), ...data.insertedLignes] };
          }));
        }

        // Update facture montant + vendeur locally
        if (data.total || data.vendeur) {
          setData((prev) => prev.map((c) => {
            if (c.id !== sel.id) return c;
            return {
              ...c,
              factures: c.factures.map((f) =>
                f.id === facture.id ? {
                  ...f,
                  montant: data.total || f.montant,
                  vendeur: data.vendeur || f.vendeur,
                } : f
              ),
            };
          }));
        }

        const nbTotal = data.nb_articles_total || data.nbArticles || 0;
        const nbLignes = data.nbLignes || data.insertedLignes?.length || 0;
        const total = data.total_ht || data.total || 0;

        if (nbLignes === 0) {
          flash({
            msg: 'OCR terminé mais aucun article n\'a pu être extrait. Saisissez les articles manuellement dans la section « Articles déclarés » en dessous.',
            type: 'warning',
            duration: 8000,
          });
        } else {
          flash({
            msg: `OCR : ${nbTotal} article${nbTotal > 1 ? 's' : ''} → regroupés en ${nbLignes} catégorie${nbLignes > 1 ? 's' : ''} — Total HT: ${eur(total)}`,
            type: 'success',
            duration: 6000,
          });
        }
        return;
      }

      // Réponse sans error ni success → cas non nominal
      flash({
        msg: 'OCR indisponible. Saisissez les articles manuellement dans la section « Articles déclarés » en dessous.',
        type: 'warning',
        duration: 8000,
      });
    } catch (err) {
      console.error('OCR error:', err);
      flash({
        msg: `OCR indisponible (${err.message}). Saisissez les articles manuellement dans la section « Articles déclarés » en dessous.`,
        type: 'warning',
        duration: 8000,
      });
    } finally {
      setOcrLoading(null);
    }
  };

  const openPreview = (f) => {
    if (f.fichier) {
      setPreviewSrc(f.fichier);
      setPreviewTitle(`${f.vendeur} — ${eur(f.montant)}`);
    }
  };

  // ── Hidden file input ──────────────────────────────────────────────────
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,.pdf"
      className="hidden"
      onChange={handleFileChange}
    />
  );

  // ══════════════════════════════════════════════════════════════════════
  // Client: compact inline view
  // ══════════════════════════════════════════════════════════════════════
  if (!isStaff) {
    if (!hasFactures) return null;
    return (
      <div className="card px-4 py-3 anim-fade">
        {hiddenInput}
        {previewSrc && <Lightbox src={previewSrc} title={previewTitle} onClose={() => setPreviewSrc(null)} />}
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Factures d'origine</p>
        {sel.factures.map((f) => (
          <div key={f.id} className="flex items-center gap-2 py-1.5 text-xs">
            {/* Thumbnail / voir */}
            {f.fichier ? (
              (f.fichierNom || f.fichier || '').toLowerCase().endsWith('.pdf') ? (
                <a
                  href={f.fichier}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 w-8 h-8 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center hover:ring-2 hover:ring-red-300 transition-all"
                >
                  <FileText size={13} className="text-red-500" />
                </a>
              ) : (
                <button
                  onClick={() => openPreview(f)}
                  className="flex-shrink-0 w-8 h-8 rounded-lg border border-gray-200 overflow-hidden hover:ring-2 hover:ring-blue-300 transition-all"
                >
                  <img src={f.fichier} alt="" className="w-full h-full object-cover" />
                </button>
              )
            ) : (
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                <FileText size={13} className="text-gray-400" />
              </div>
            )}
            <span className="flex-1 text-gray-700 truncate">{f.vendeur} — {eur(f.montant)}</span>
            {f.valide ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold flex-shrink-0">
                <Check size={11} />Validée
              </span>
            ) : f.rejetMotif ? (
              <span className="inline-flex items-center gap-0.5 text-red-500 font-bold flex-shrink-0">
                <X size={11} />Refusée
              </span>
            ) : (
              <span className="text-amber-500 font-medium flex-shrink-0">En vérification</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Staff: full panel with validation/rejection + preview
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="card p-4 anim-fade">
      {hiddenInput}
      {previewSrc && <Lightbox src={previewSrc} title={previewTitle} onClose={() => setPreviewSrc(null)} />}

      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors"
        >
          <span>{collapsed ? '▶' : '▼'}</span>
          Factures d'origine {hasFactures ? `(${sel.factures.length})` : ''}
          {hasFactures && collapsed && (
            <span className="normal-case font-semibold text-gray-500 ml-1">
              — {sel.factures.filter(f => f.valide).length} validée{sel.factures.filter(f => f.valide).length > 1 ? 's' : ''}, {sel.factures.filter(f => f.rejetMotif).length} refusée{sel.factures.filter(f => f.rejetMotif).length > 1 ? 's' : ''}
            </span>
          )}
        </button>
        <div className="flex gap-1.5">
          {cl?.telegramChatId ? (
            <button
              onClick={() => handleDemanderFacture('telegram')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
              style={{ background: '#0088cc15', color: '#0088cc' }}
            >
              <Send size={10} />
              Telegram
            </button>
          ) : (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-gray-300 bg-gray-50" title="Client n'a pas lié Telegram">
              <Send size={10} />
              Telegram
            </span>
          )}
          <button
            onClick={() => handleDemanderFacture('email')}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
            style={{ background: `${BRAND.navy}08`, color: BRAND.navy }}
          >
            <Send size={10} />
            Email
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
            style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
          >
            <Plus size={10} />
            Ajouter
          </button>
        </div>
      </div>

      {!collapsed && <>
      {/* Add facture form */}
      {showAddForm && (
        <div className="mb-3 p-3 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 space-y-2">
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={newVendeur}
              onChange={(e) => setNewVendeur(e.target.value)}
              placeholder="Vendeur (Amazon, Zara...)"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs outline-none focus:border-blue-400"
            />
            <input
              type="number"
              value={newMontant}
              onChange={(e) => setNewMontant(e.target.value)}
              placeholder="Montant €"
              className="w-24 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs outline-none focus:border-blue-400 text-right"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddFacture}
              disabled={!newVendeur.trim()}
              className="flex-1 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-30 transition-all active:scale-95"
              style={{ background: BRAND.navy }}
            >
              Ajouter la facture
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewVendeur(''); setNewMontant(''); }}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 bg-gray-100"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* No factures message */}
      {!hasFactures && !showAddForm && (
        <div className="py-6 text-center">
          <FileText size={24} className="mx-auto text-gray-300 mb-2" />
          <p className="text-xs text-gray-400 mb-1">Aucune facture rattachée</p>
          <p className="text-[10px] text-gray-400">Ajoutez une facture ou demandez-la au client.</p>
        </div>
      )}

      {/* Existing factures */}
      <div className="space-y-3">
        {(sel.factures || []).map((f) => (
          <div
            key={f.id}
            className="rounded-xl border-2 overflow-hidden transition-all"
            style={{
              borderColor: f.valide ? '#BBF7D0' : f.rejetMotif ? '#FECACA' : '#E5E7EB',
              background: f.valide ? '#F0FDF4' : f.rejetMotif ? '#FEF2F2' : 'white',
            }}
          >
            {/* Header row with thumbnail */}
            <div className="px-3 py-2.5 flex items-center gap-3">
              {/* Thumbnail or upload */}
              {f.fichier ? (
                (() => {
                  const isPdf = (f.fichierNom || f.fichier || '').toLowerCase().endsWith('.pdf');
                  return isPdf ? (
                    <a
                      href={f.fichier}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative flex-shrink-0 w-14 h-14 rounded-xl border-2 border-red-200 bg-red-50 flex flex-col items-center justify-center gap-0.5 group hover:border-red-400 transition-all"
                    >
                      <FileText size={18} className="text-red-500" />
                      <span className="text-[7px] font-black text-red-400 uppercase">PDF</span>
                    </a>
                  ) : (
                    <button
                      onClick={() => openPreview(f)}
                      className="relative flex-shrink-0 w-14 h-14 rounded-xl border-2 border-gray-200 overflow-hidden group hover:border-blue-400 transition-all"
                    >
                      <img src={f.fichier} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                        <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  );
                })()
              ) : (
                <button
                  onClick={() => handleFileUpload(f.id)}
                  className="flex-shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-0.5 hover:border-blue-400 hover:bg-blue-50 transition-all"
                >
                  <Upload size={14} className="text-gray-400" />
                  <span className="text-[8px] font-bold text-gray-400 uppercase">Joindre</span>
                </button>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: BRAND.navy }}>{f.vendeur}</p>
                <p className="text-xs text-gray-500">{eur(f.montant)}</p>
                {f.fichier && (
                  <p className="text-[10px] text-gray-400 truncate">{f.fichierNom || 'Fichier joint'}</p>
                )}
              </div>

              {/* Status badge */}
              {f.valide && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg flex-shrink-0">
                  <Check size={12} /> Validée
                </span>
              )}
              {!f.valide && f.rejetMotif && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg flex-shrink-0">
                  <X size={12} /> Refusée
                </span>
              )}
            </div>

            {/* Preview button when file exists */}
            {f.fichier && (() => {
              const isPdf = (f.fichierNom || f.fichier || '').toLowerCase().endsWith('.pdf');
              return (
              <div className="px-3 pb-2 flex gap-2">
                {isPdf ? (
                  <a
                    href={f.fichier}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                    style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                  >
                    <Eye size={12} />
                    Ouvrir PDF
                  </a>
                ) : (
                  <button
                    onClick={() => openPreview(f)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                    style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
                  >
                    <Eye size={12} />
                    Voir
                  </button>
                )}
                <button
                  onClick={() => handleOCR(f)}
                  disabled={ocrLoading === f.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: '#7C3AED15', color: '#7C3AED' }}
                >
                  <Scan size={12} />
                  {ocrLoading === f.id ? 'Analyse...' : 'Analyser (OCR)'}
                </button>
                <button
                  onClick={() => handleFileUpload(f.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
                >
                  <Upload size={12} />
                  Remplacer
                </button>
              </div>
              );
            })()}

            {/* Rejected motif display */}
            {!f.valide && f.rejetMotif && (
              <div className="px-3 pb-2">
                <p className="text-[11px] text-red-600 italic">Motif : {f.rejetMotif}</p>
              </div>
            )}

            {/* No file warning */}
            {!f.fichier && !f.valide && (
              <div className="px-3 pb-2">
                <p className="text-[10px] text-amber-600 italic flex items-center gap-1">
                  <ImageIcon size={10} /> Aucun fichier joint — cliquez sur "Joindre" pour ajouter
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="px-3 pb-3">
              {f.valide ? (
                <button
                  onClick={() => unvalidateFacture(f.id)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-bold border-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-all active:scale-[0.98]"
                >
                  <RotateCcw size={12} />
                  Annuler la validation
                </button>
              ) : f.rejetMotif ? (
                /* Facture refusée — proposer de re-valider ou demander une nouvelle */
                <div className="flex gap-2">
                  <button
                    onClick={() => validateFacture(f.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border-2 border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-all active:scale-[0.98]"
                  >
                    <Check size={12} />
                    Re-valider
                  </button>
                  <button
                    onClick={() => handleFileUpload(f.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border-2 border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100 transition-all active:scale-[0.98]"
                  >
                    <Upload size={12} />
                    Remplacer le fichier
                  </button>
                </div>
              ) : (
                /* Facture en attente — valider ou refuser */
                <div className="flex gap-2">
                  <button
                    onClick={() => validateFacture(f.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                    style={{ background: '#16A34A', color: 'white', boxShadow: '0 2px 8px #16A34A30' }}
                  >
                    <Check size={13} />
                    Valider
                  </button>
                  <button
                    onClick={() => {
                      setRejectingId(rejectingId === f.id ? null : f.id);
                      setMotifLibre('');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                    style={{
                      background: rejectingId === f.id ? '#DC2626' : '#FEF2F2',
                      color: rejectingId === f.id ? 'white' : '#DC2626',
                      border: rejectingId === f.id ? 'none' : '2px solid #FECACA',
                    }}
                  >
                    <X size={13} />
                    Refuser
                  </button>
                </div>
              )}
            </div>

            {/* Rejection motif picker */}
            {rejectingId === f.id && !f.valide && (
              <div className="px-3 pb-3 space-y-2.5 border-t border-red-100 pt-3 anim-slide-down">
                <p className="text-[11px] font-bold text-red-700">
                  Motif du refus <span className="font-normal text-red-400">(le client sera notifié par {canal === 'telegram' ? 'Telegram' : 'email'})</span>
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {MOTIFS_REJET.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => rejectFacture(f, m.label)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border-2 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 transition-all active:scale-95"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={motifLibre}
                    onChange={(e) => setMotifLibre(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && motifLibre.trim()) {
                        rejectFacture(f, motifLibre.trim());
                      }
                    }}
                    placeholder="Autre motif..."
                    className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 text-xs outline-none transition-all focus:border-red-300"
                    style={{ color: BRAND.navy }}
                  />
                  <button
                    onClick={() => motifLibre.trim() && rejectFacture(f, motifLibre.trim())}
                    disabled={!motifLibre.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30"
                    style={{ background: '#DC2626', color: 'white' }}
                  >
                    Envoyer
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </>}
    </div>
  );
}

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { STATUTS, PREV_STATUT, CATEGORIES_INIT, CLIENTS_INIT, TARIFS_DEFAUT, initEnvois, getDestByCP, PRODUITS_INTERDITS } from '../constants';
import { MSG_TEMPLATES } from '../constants/templates';
import { uid, makeData, calcTransport, getCatTaux, eur, mailtoLink, getClientDest } from '../utils';
import { isTelegramConfigured, sendTelegram, sendNotification, sendTelegramWithButtons, telegramMeLink, normalizeTel } from '../services/telegramApi';
import { connectWebhook } from '../services/webhookListener';
import * as sb from '../lib/supabaseData';
import { supabase } from '../lib/supabase';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  // ── Auth ──
  const [auth, setAuth] = useState(null);

  // ── Core data (initialized with mock, replaced by Supabase on load) ──
  const [data, setData] = useState(makeData);
  const [clients, setClients] = useState(CLIENTS_INIT);
  const [categories, setCategories] = useState(CATEGORIES_INIT);
  const [tarifs, setTarifs] = useState(TARIFS_DEFAUT);
  const [envois, setEnvois] = useState(initEnvois);
  const [logs, setLogs] = useState([]);
  const [sbReady, setSbReady] = useState(false);
  const [produitsInterdits, setProduitsInterdits] = useState(() => {
    try {
      const saved = localStorage.getItem('expedile_produits_interdits');
      return saved ? JSON.parse(saved) : PRODUITS_INTERDITS;
    } catch { return PRODUITS_INTERDITS; }
  });

  // ── Communication ──
  const [comLog, setComLog] = useState([]);

  // ── Notifications (client) ──
  const [notifs, setNotifs] = useState([]);

  // ── Load data from Supabase on mount ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [colisData, clientsData, envoisData, catsData, tarifsData] = await Promise.all([
          sb.fetchColis(),
          sb.fetchClients(),
          sb.fetchEnvois(),
          sb.fetchCategories(),
          sb.fetchTarifs(),
        ]);
        if (cancelled) return;
        if (colisData.length > 0 || clientsData.length > 0) {
          setData(colisData);
          setClients(clientsData);
          setEnvois(envoisData);
          setCategories(catsData);
          setTarifs(tarifsData);
          setSbReady(true);
          console.log('[Supabase] ✅ Données chargées :', colisData.length, 'colis,', clientsData.length, 'clients');
        } else {
          // Base vide mais connexion OK
          setData([]);
          setClients([]);
          setEnvois([]);
          setSbReady(true);
          console.log('[Supabase] ✅ Connecté — base vide');
        }
      } catch (err) {
        console.error('[Supabase] ❌ Connexion impossible — FALLBACK MOCK', err.message);
        setSbReady(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Realtime subscriptions ──
  useEffect(() => {
    if (!sbReady) return;

    const colisSub = sb.subscribeColis((payload) => {
      if (payload.eventType === 'UPDATE') {
        // Refetch the updated colis to get full data with relations
        sb.fetchColis().then(setData).catch(console.error);
      } else if (payload.eventType === 'INSERT') {
        sb.fetchColis().then(setData).catch(console.error);
      }
    });

    const facturesSub = sb.subscribeFactures((payload) => {
      if (payload.eventType === 'INSERT') {
        const f = payload.new;
        setData((prev) => prev.map((c) => {
          if (c.id !== f.colis_id) return c;
          const newFacture = {
            id: f.id,
            vendeur: f.vendeur || 'Facture',
            montant: f.montant ? +f.montant : 0,
            valide: f.valide || false,
            fichier: f.fichier_url || null,
            fichierNom: f.fichier_nom || null,
            rejetMotif: f.rejet_motif || null,
            telegramMsgId: f.telegram_msg_id || null,
          };
          // Avoid duplicates
          if (c.factures.some((x) => x.id === f.id)) return c;
          return { ...c, factures: [...c.factures, newFacture] };
        }));
      } else if (payload.eventType === 'UPDATE') {
        const f = payload.new;
        setData((prev) => prev.map((c) => {
          if (c.id !== f.colis_id) return c;
          return {
            ...c,
            factures: c.factures.map((x) => x.id === f.id ? {
              ...x,
              vendeur: f.vendeur || x.vendeur,
              montant: f.montant ? +f.montant : x.montant,
              valide: f.valide ?? x.valide,
              fichier: f.fichier_url || x.fichier,
              fichierNom: f.fichier_nom || x.fichierNom,
              rejetMotif: f.rejet_motif ?? x.rejetMotif,
            } : x),
          };
        }));
      } else if (payload.eventType === 'DELETE') {
        const f = payload.old;
        setData((prev) => prev.map((c) => ({
          ...c,
          factures: c.factures.filter((x) => x.id !== f.id),
        })));
      }
    });

    const msgSub = sb.subscribeMessages((payload) => {
      if (payload.eventType === 'INSERT') {
        const newMsg = payload.new;
        setData((prev) => prev.map((c) => {
          if (c.id !== newMsg.colis_id) return c;
          return {
            ...c,
            messages: [...c.messages, {
              id: newMsg.id,
              type: newMsg.type,
              auteur: newMsg.auteur_nom || 'Système',
              texte: newMsg.texte,
              heure: new Date(newMsg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
              statut: newMsg.statut,
              msgId: newMsg.msg_id || newMsg.wa_id,
            }],
          };
        }));
      }
    });

    return () => {
      supabase.removeChannel(colisSub);
      supabase.removeChannel(facturesSub);
      supabase.removeChannel(msgSub);
    };
  }, [sbReady]);

  // ── Persist produitsInterdits to localStorage (TODO: migrate to Supabase parametres table) ──
  useEffect(() => {
    try {
      localStorage.setItem('expedile_produits_interdits', JSON.stringify(produitsInterdits));
    } catch { /* ignore storage errors */ }
  }, [produitsInterdits]);

  // ── UI state ──
  const [selId, setSelId] = useState(null);
  const [toast, setToast] = useState('');
  const [page, setPage] = useState('home');
  const [clientTab, setClientTab] = useState('accueil');
  const [colisFilter, setColisFilter] = useState(null);
  const [cfm, setCfm] = useState(null);

  // ── Computed ──
  const isStaff = auth?.type === 'staff';
  const authCl = useMemo(() => {
    if (isStaff || !auth?.cl) return auth?.cl;
    return clients.find((c) => c.id === auth.cl.id) || auth.cl;
  }, [isStaff, auth, clients]);

  const sel = useMemo(() => (selId ? data.find((x) => x.id === selId) : null), [selId, data]);
  const selClient = useMemo(() => (sel ? clients.find((c) => c.id === sel.clientId) : null), [sel, clients]);
  const selDest = useMemo(() => (sel ? getClientDest(sel.clientId, clients) : null), [sel, clients]);

  const authRole = auth?.u?.role || (isStaff ? 'preparateur' : 'client');

  const unreadNotifs = useMemo(() => notifs.filter((n) => !n.lu).length, [notifs]);

  // ── Flash messages ──
  // Accepts string OR rich object { msg, type, action: { label, onClick }, duration }
  const flash = useCallback((m) => {
    setToast(m);
    const dur = (typeof m === 'object' && m.action) ? 6000 : (typeof m === 'object' && m.duration) ? m.duration : 2200;
    setTimeout(() => setToast(''), dur);
  }, []);

  // ── Confirm dialog ──
  const ask = useCallback((title, msg, onOk, opts) => {
    setCfm({ title, msg, onOk, danger: opts?.danger, okLabel: opts?.okLabel || 'Confirmer' });
  }, []);

  const closeConfirm = useCallback(() => setCfm(null), []);

  // ── Data helpers ──
  // Labels lisibles pour l'audit
  const FIELD_LABELS = {
    dimL: 'Longueur brute', dimW: 'Largeur brute', dimH: 'Hauteur brute', poids: 'Poids brut',
    finL: 'Longueur finale', finW: 'Largeur finale', finH: 'Hauteur finale', finP: 'Poids final',
    casier: 'Casier', feuVert: 'Feu vert', statut: 'Statut',
    devisTransport: 'Transport', devisOM: 'Octroi de Mer', devisOMR: 'OMR', devisTVA: 'TVA', devisTotal: 'Total devis',
    paiementMontant: 'Montant paiement', urgence: 'Urgence',
    tagsPreparation: 'Tags préparation', commentairePreparation: 'Commentaire préparation',
    notesInternes: 'Notes internes',
  };

  const upd = useCallback((id, changes) => {
    // Detect what changed for audit
    const oldColis = data.find((c) => c.id === id);
    const userName = auth?.u?.nom || '?';

    // Optimistic local update
    setData((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));

    // Persist to Supabase
    if (sbReady) {
      sb.updateColis(id, changes).catch((err) => {
        console.error('[Supabase] upd error:', err.message);
        flash({ msg: 'Erreur de sauvegarde — vérifiez votre connexion', type: 'warning' });
      });

      // Auto-log significant changes (not statut — that's in log())
      if (oldColis) {
        const details = [];
        for (const [key, newVal] of Object.entries(changes)) {
          if (key === 'statut') continue; // statut logged separately
          if (key === 'casierHistorique' || key === 'dimsParColis') continue; // skip arrays
          const label = FIELD_LABELS[key];
          if (!label) continue;
          const oldVal = oldColis[key];
          if (oldVal !== newVal && newVal !== undefined) {
            if (typeof newVal === 'number' || typeof newVal === 'string' || typeof newVal === 'boolean') {
              details.push(`${label} : ${oldVal ?? '—'} → ${newVal}`);
            }
          }
        }
        // Log casier change specifically
        if (changes.casier && changes.casier !== oldColis.casier) {
          details.push(`Casier : ${oldColis.casier || '—'} → ${changes.casier}`);
        }
        if (details.length > 0) {
          sb.insertAuditAction(id, userName, 'Modification', details.join('\n')).catch(() => {});
        }
      }
    }
  }, [sbReady, flash, data, auth]);

  const log = useCallback((id, oldStatut, newStatut) => {
    setLogs((prev) => [...prev, { id: uid(), cid: id, o: oldStatut, n: newStatut, w: auth?.u?.nom || '?' }]);
    // Persist to Supabase
    if (sbReady) {
      sb.insertLog(id, oldStatut, newStatut, auth?.u?.nom || '?');
    }
  }, [auth, sbReady]);

  const getClient = useCallback((id) => clients.find((c) => c.id === id), [clients]);
  const getTarif = useCallback((destCode) => tarifs[destCode || '974'] || tarifs['974'], [tarifs]);

  // ── Client CRUD ──
  const updateClient = useCallback((id, changes, silent) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    if (sbReady) sb.updateClient(id, changes).catch(console.error);
    if (!silent) flash('Client mis à jour');
  }, [flash, sbReady]);

  const addNewClient = useCallback(async (cl) => {
    try {
      if (sbReady) {
        const newCl = await sb.insertClient(cl);
        setClients((prev) => [...prev, newCl]);
        flash('Client ajouté');
        return newCl.id;
      }
    } catch (err) {
      console.error('[Supabase] insertClient error:', err.message);
    }
    // Fallback local
    const id = 'cl_' + uid();
    setClients((prev) => [...prev, { id, ...cl }]);
    flash('Client ajouté');
    return id;
  }, [flash, sbReady]);

  const deleteClient = useCallback((id) => {
    if (data.some((p) => p.clientId === id)) {
      flash('Ce client a des colis, impossible de le supprimer');
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== id));
    if (sbReady) sb.deleteClient(id).catch(console.error);
    flash('Client supprimé');
  }, [data, flash, sbReady]);

  // ── Category CRUD ──
  const addCategory = useCallback((label, taux) => {
    const id = 'c_' + uid();
    setCategories((prev) => [...prev, { id, label, custom: true, taux }]);
    // Persist to Supabase
    if (sbReady) {
      sb.insertCategorie(label).then((saved) => {
        // Replace temp ID with real Supabase ID
        setCategories((prev) => prev.map(c => c.id === id ? { ...c, id: saved.id } : c));
        // Also persist initial taux for each destination
        if (taux) {
          Object.entries(taux).forEach(([destCode, t]) => {
            sb.upsertTauxCategorie(saved.id, destCode, t.om || 0, t.omr || 0).catch(console.error);
          });
        }
      }).catch(err => {
        console.error('[Supabase] insertCategorie error:', err.message);
        flash({ msg: 'Erreur sauvegarde catégorie', type: 'warning' });
      });
    }
    flash(`Catégorie "${label}" ajoutée`);
    return id;
  }, [flash, sbReady]);

  const updateCatTaux = useCallback((catId, destCode, field, val) => {
    setCategories((prev) => prev.map((c) => {
      if (c.id !== catId) return c;
      const newTaux = { ...c.taux };
      newTaux[destCode] = { ...(newTaux[destCode] || { om: 0, omr: 0 }), [field]: Number(val) || 0 };
      return { ...c, taux: newTaux };
    }));
    // Persist to Supabase
    if (sbReady) {
      // Read the current taux to get both om and omr values
      const cat = categories.find(c => c.id === catId);
      const existing = cat?.taux?.[destCode] || { om: 0, omr: 0 };
      const updated = { ...existing, [field]: Number(val) || 0 };
      sb.upsertTauxCategorie(catId, destCode, updated.om, updated.omr).catch(err => {
        console.error('[Supabase] upsertTauxCategorie error:', err.message);
      });
    }
  }, [sbReady, categories]);

  const updateCatLabel = useCallback((catId, label) => {
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, label } : c)));
    // Persist to Supabase
    if (sbReady) {
      sb.updateCategorie(catId, { label }).catch(err => {
        console.error('[Supabase] updateCategorie error:', err.message);
      });
    }
  }, [sbReady]);

  const deleteCategory = useCallback((catId) => {
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    // Persist to Supabase (deletes taux_categories rows too)
    if (sbReady) {
      sb.deleteCategorie(catId).catch(err => {
        console.error('[Supabase] deleteCategorie error:', err.message);
      });
    }
    flash('Catégorie supprimée');
  }, [flash, sbReady]);

  // ── Notifications ──
  const markNotifRead = useCallback((nid) => {
    setNotifs((prev) => prev.map((n) => (n.id === nid ? { ...n, lu: true } : n)));
    if (sbReady) sb.markNotifRead(nid).catch(console.error);
  }, [sbReady]);

  const markAllNotifsRead = useCallback(() => {
    setNotifs((prev) => prev.map((n) => ({ ...n, lu: true })));
    if (sbReady && auth?.u?.id) sb.markAllNotifsRead(auth.u.id).catch(console.error);
  }, [sbReady, auth]);

  // ── Communication ──
  const sendMsg = useCallback(async (colisId, clientId, canal, templateKey, customMsg) => {
    const c = clients.find((x) => x.id === clientId);
    const colis = data.find((x) => x.id === colisId);
    if (!c) return;

    const tpl = MSG_TEMPLATES[templateKey];
    const msg = customMsg || (tpl ? tpl.label : 'Message');

    setComLog((prev) => [{
      id: uid(), colisId, clientId, canal, template: templateKey, msg,
      date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      user: auth?.u?.nom || '?',
    }, ...prev]);

    const fullMsg = tpl ? (canal === 'telegram' ? tpl.telegram(c, colis) : tpl.email(c, colis)) : customMsg || '';

    // ── Persist message to Supabase (ALL channels) ──
    const persistMessage = async (statut, telegramMsgId) => {
      if (!colisId) return;
      try {
        const saved = await sb.insertMessage(colisId, {
          type: 'staff',
          auteur: auth?.u?.nom || 'Système',
          texte: fullMsg,
          statut,
          telegramMsgId: telegramMsgId || null,
        });
        if (saved) {
          setData((prev) => prev.map((p) => {
            if (p.id !== colisId) return p;
            return { ...p, messages: [...p.messages, saved] };
          }));
        }
      } catch (err) {
        console.warn('[Supabase] insertMessage in sendMsg:', err.message);
        // Fallback local
        setData((prev) => prev.map((p) => {
          if (p.id !== colisId) return p;
          return {
            ...p,
            messages: [...p.messages, {
              id: uid(), type: 'staff', auteur: auth?.u?.nom || 'Système',
              texte: fullMsg, statut,
              heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            }],
          };
        }));
      }
    };

    if (canal === 'telegram') {
      const chatId = c.telegramChatId;
      if (isTelegramConfigured() && chatId) {
        const prenom = c.nom.split(' ')[0];
        flash({ msg: `Envoi Telegram → ${prenom}…`, type: 'info' });

        // Si c'est un feu vert, envoyer avec boutons OUI/NON
        const isFeuVert = templateKey === 'demande_feu_vert' || templateKey === 'relance_feu_vert';
        let res;
        if (isFeuVert && colisId) {
          res = await sendTelegramWithButtons(chatId, fullMsg, [
            [
              { text: '✅ OUI — Autoriser', callback_data: `fv_oui_${colisId}` },
              { text: '❌ NON — Refuser', callback_data: `fv_non_${colisId}` },
            ],
          ]);
        } else {
          res = await sendNotification(chatId, fullMsg);
        }
        if (res.ok) {
          await persistMessage('envoye', res.messageId);
          flash({ msg: `Telegram envoyé → ${prenom}`, type: 'success' });
        } else {
          await persistMessage('echec', null);
          flash({
            msg: `Envoi impossible → ${prenom}\n(${res.error || 'erreur'})`,
            type: 'warning',
          });
        }
      } else if (isTelegramConfigured() && !chatId) {
        // Client pas lié → persister en attente
        await persistMessage('en_attente');
        flash({
          msg: `${c.nom.split(' ')[0]} n'a pas encore lié Telegram. Message en attente.`,
          type: 'warning',
          duration: 5000,
        });
      } else {
        flash({ msg: 'Bot Telegram non configuré', type: 'warning' });
      }
    } else if (canal === 'email' && c.email) {
      window.open(mailtoLink(c.email, fullMsg), '_blank');
      await persistMessage('envoye');
      flash(`Email → ${c.nom.split(' ')[0]}`);
    }
  }, [clients, data, auth, flash]);

  const getPreview = useCallback((templateKey, clientId, colisId, canal) => {
    const c = clients.find((x) => x.id === clientId);
    const colis = data.find((x) => x.id === colisId);
    if (!c || !MSG_TEMPLATES[templateKey]) return '';
    return canal === 'telegram' ? MSG_TEMPLATES[templateKey].telegram(c, colis || {}) : MSG_TEMPLATES[templateKey].email(c, colis || {});
  }, [clients, data]);

  // ── Colis actions ──
  const receptionner = useCallback((id, casierVal, notifier) => {
    if (!casierVal?.trim()) { flash('Numéro de casier obligatoire'); return; }
    const c = data.find((x) => x.id === id);
    if (!c) return;
    log(id, c.statut, 'receptionne');
    upd(id, { statut: 'receptionne', casier: casierVal.trim(), dateReception: new Date().toISOString() });
    const cl = clients.find((x) => x.id === c.clientId);
    if (notifier && cl) {
      flash(`Réceptionné — email envoyé à ${cl.nom} pour le colis ${c.ref}`);
    } else {
      flash('Réceptionné (sans notification client)');
    }
  }, [data, clients, log, upd, flash]);

  const changerStatut = useCallback((id, ns) => {
    const c = data.find((x) => x.id === id);
    if (!c) return;
    if (ns === 'en_preparation' && c.feuVert !== 'autorise') { flash("Le client n'a pas encore donné son accord"); return; }
    if (ns === 'devis_envoye' && c.factures.length === 0) { flash("Il manque la facture d'origine"); return; }
    if (ns === 'expedie' && !c.paiementMontant) { flash("Le client n'a pas encore payé"); return; }
    if (ns === 'expedie' && !c.envoi) { flash("Affectez le colis à un envoi d'abord"); return; }
    log(id, c.statut, ns);
    upd(id, { statut: ns });
    flash(STATUTS[ns].label);
  }, [data, log, upd, flash]);

  const revertStatut = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c) return;
    const prev = PREV_STATUT[c.statut];
    if (!prev) { flash('Impossible de revenir en arrière depuis ce statut'); return; }

    // Retour en arrière = changement de statut UNIQUEMENT, pas de suppression de données
    log(id, c.statut, prev);
    upd(id, { statut: prev });
    flash(`Retour à : ${STATUTS[prev].label} — les données sont conservées`);
  }, [data, log, upd, flash]);

  const annulerColis = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c) return;
    log(id, c.statut, 'annule');
    upd(id, { statut: 'annule' });
    flash('Colis annulé');
  }, [data, log, upd, flash]);

  const archiverColis = useCallback((id) => {
    upd(id, { archive: true });
    flash('Colis archivé');
  }, [upd, flash]);

  const desarchiverColis = useCallback((id) => {
    upd(id, { archive: false });
    flash('Colis désarchivé');
  }, [upd, flash]);

  const demanderFeuVert = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c || !c.dimL || !c.dimW || !c.dimH || !c.poids) {
      flash('Renseignez toutes les dimensions et le poids');
      return;
    }
    log(id, c.statut, 'attente_feu_vert');
    upd(id, { statut: 'attente_feu_vert', feuVert: 'en_attente' });
    // Avertissement facture (non bloquant)
    const hasValidFacture = c.factures && c.factures.length > 0 && c.factures.some((f) => f.valide);
    if (!hasValidFacture) {
      flash({ msg: 'Feu vert envoyé — ⚠️ Pensez à demander la facture au client pour le calcul des taxes.', type: 'warning', duration: 5000 });
    } else {
      flash('Demande de feu vert envoyée au client');
    }
  }, [data, log, upd, flash]);

  // ── Auto-assign envoi based on feu vert date ──────────────────────────────
  // Règle : feu vert avant mercredi 17h → vendredi de la semaine, sinon vendredi suivant
  const autoAssignEnvoi = useCallback(async (colisId) => {
    const now = new Date();
    const day = now.getDay(); // 0=dim, 1=lun, ..., 3=mer, 5=ven
    const hour = now.getHours();
    const isBeforeDeadline = day < 3 || (day === 3 && hour < 17); // avant mercredi 17h

    // Calcul du vendredi cible
    const target = new Date(now);
    const daysUntilFriday = (5 - day + 7) % 7 || 7; // jours jusqu'au prochain vendredi
    if (isBeforeDeadline) {
      // Ce vendredi (si on est déjà vendredi/samedi/dimanche, prendre le prochain)
      const daysToThisFri = (5 - day + 7) % 7;
      target.setDate(now.getDate() + (daysToThisFri === 0 && day === 5 ? 0 : daysToThisFri));
    } else {
      // Vendredi de la semaine prochaine
      target.setDate(now.getDate() + daysUntilFriday + (day <= 5 ? 0 : 0));
      if (day > 3 && day < 5) target.setDate(now.getDate() + daysUntilFriday);
      else if (day === 3) target.setDate(now.getDate() + 2); // mercredi → vendredi prochain = +9 jours? non
    }
    // Simplification: calculer proprement
    const friday = new Date(now);
    if (isBeforeDeadline) {
      // Ce vendredi
      const diff = (5 - day + 7) % 7;
      friday.setDate(now.getDate() + (diff === 0 ? 0 : diff));
    } else {
      // Vendredi prochain (semaine suivante)
      const diff = (5 - day + 7) % 7;
      friday.setDate(now.getDate() + (diff === 0 ? 7 : diff));
    }
    const dateStr = friday.toISOString().slice(0, 10); // YYYY-MM-DD

    // Chercher un envoi existant pour cette date
    let existingEnvoi = envois.find((e) => e.date === dateStr && e.statut !== 'parti');

    if (!existingEnvoi) {
      // Créer l'envoi automatiquement
      try {
        const newEnvoi = await sb.insertEnvoi({ date: dateStr, statut: 'planifie' });
        setEnvois((prev) => [...prev, newEnvoi]);
        existingEnvoi = newEnvoi;
      } catch (err) {
        console.warn('[autoAssignEnvoi] Erreur création envoi:', err.message);
        return;
      }
    }

    // Affecter le colis
    upd(colisId, { envoi: existingEnvoi.id });
    flash({ msg: `Envoi auto-affecté : départ prévu le ${friday.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`, type: 'success', duration: 4000 });
  }, [envois, setEnvois, upd, flash]);

  const feuVert = useCallback((id, ok) => {
    const ns = ok ? 'autorise' : 'refuse_client';
    log(id, 'attente_feu_vert', ns);
    upd(id, { statut: ns, feuVert: ok ? 'autorise' : 'refuse', feuVertDate: new Date().toISOString() });
    if (ok) {
      autoAssignEnvoi(id);
      flash({ msg: 'Feu vert reçu — envoi auto-affecté', type: 'success', duration: 4000 });
    } else {
      flash({ msg: 'Refusé — le colis ne sera pas préparé', type: 'warning', duration: 4000 });
    }
  }, [log, upd, flash, autoAssignEnvoi]);

  const feuVertBulk = useCallback((ids) => {
    let successCount = 0;
    ids.forEach((id) => {
      try {
        log(id, 'attente_feu_vert', 'autorise');
        upd(id, { statut: 'autorise', feuVert: 'autorise', feuVertDate: new Date().toISOString() });
        autoAssignEnvoi(id);
        successCount++;
      } catch (err) {
        console.error(`[feuVertBulk] Erreur sur colis ${id}:`, err.message);
      }
    });
    if (successCount === ids.length) {
      flash({ msg: `${ids.length} colis autorisés — envois auto-affectés`, type: 'success', duration: 4000 });
    } else {
      flash({ msg: `${successCount}/${ids.length} colis autorisés — certains ont échoué`, type: 'warning', duration: 5000 });
    }
  }, [log, upd, flash, autoAssignEnvoi]);

  const envoyerDevis = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c || !c.finL || !c.finW || !c.finH || !c.finP) {
      flash('Renseignez les dimensions et poids après optimisation');
      return;
    }

    const cl = clients.find((x) => x.id === c.clientId);
    const isPro = cl?.type === 'pro';

    // PRO: pas besoin de facture ni d'articles pour les taxes (pas d'OM/OMR/TVA)
    if (!isPro) {
      const hasValidFacture = c.factures && c.factures.length > 0 && c.factures.some((f) => f.valide);
      if (!hasValidFacture) {
        flash({ msg: 'Impossible d\'envoyer le devis : aucune facture validée. Les taxes (OM/OMR) ne peuvent pas être calculées sans la facture d\'achat.', type: 'warning', duration: 6000 });
        return;
      }
      if (!c.lignes || c.lignes.length === 0) {
        flash({ msg: 'Aucun article renseigné. Ajoutez les articles du colis (depuis la facture) pour calculer les taxes.', type: 'warning', duration: 5000 });
        return;
      }
    }

    const dest = getClientDest(c.clientId, clients);
    const t = tarifs[dest.code] || tarifs['974'];

    // Calcul APRÈS optimisation
    const pv = (c.finL * c.finW * c.finH) / 5000;
    const pf = Math.max(c.finP, pv);
    const tr = calcTransport(pf, t);

    let om = 0, omr = 0, tva = 0;

    if (!isPro) {
      // Particulier: calcul CIF OM/OMR/TVA
      const totalValeurArticles = (c.lignes || []).reduce((s, l) => s + (l.qte || 1) * (l.prix || 0), 0);
      (c.lignes || []).forEach((l) => {
        const cat = categories.find((x) => x.id === l.cat);
        if (cat) {
          const ct = getCatTaux(cat, dest.code);
          const valeurArticle = (l.qte || 1) * (l.prix || 0);
          const transportShare = totalValeurArticles > 0 ? tr * (valeurArticle / totalValeurArticles) : 0;
          const cif = valeurArticle + transportShare;
          om += cif * ct.om / 100;
          omr += cif * ct.omr / 100;
        }
      });
      const ht = tr + om + omr;
      tva = ht * (dest.tva / 100);
    }
    // PRO: devis = transport uniquement (pas d'OM, OMR, TVA)

    const ht = tr + om + omr;
    const tot = Math.round((ht + tva) * 100) / 100;

    // Calcul AVANT optimisation (supporte multi-colis)
    let avantTr = 0, avantTot = 0;
    if (c.dimL && c.dimW && c.dimH && c.poids) {
      let pvBrut;
      if (c.dimsParColis && c.dimsParColis.length > 1) {
        pvBrut = c.dimsParColis.reduce((s, d) => s + (d.dimL * d.dimW * d.dimH) / 5000, 0);
      } else {
        pvBrut = (c.dimL * c.dimW * c.dimH) / 5000;
      }
      const pfBrut = Math.max(c.poids, pvBrut);
      avantTr = calcTransport(pfBrut, t);
      const avantHt = avantTr + om + omr;
      const avantTva = avantHt * (dest.tva / 100);
      avantTot = Math.round((avantHt + avantTva) * 100) / 100;
    }
    const economie = avantTot > 0 ? Math.round((avantTot - tot) * 100) / 100 : 0;

    upd(id, {
      devisTransport: +tr.toFixed(2), devisOM: +om.toFixed(2), devisOMR: +omr.toFixed(2),
      devisTVA: +tva.toFixed(2), devisTotal: tot, poidsFact: +pf.toFixed(2),
      avantOptimTransport: +avantTr.toFixed(2), avantOptimTotal: avantTot,
      economie: economie > 0 ? economie : 0,
    });
    flash(`Brouillon : ${eur(tot)}${economie > 0 ? ` (économie ${eur(economie)})` : ''} — Vérifiez puis envoyez`);
    return true; // devis calculé avec succès
  }, [data, clients, tarifs, categories, upd, flash]);

  const payer = useCallback((id, mt) => {
    log(id, 'devis_envoye', 'paye');
    upd(id, { statut: 'paye', paiementMontant: mt, paiementDate: new Date().toISOString() });

    // Programme fidélité : 10€ de transport = 1 point (particuliers uniquement)
    const colis = data.find((c) => c.id === id);
    if (colis) {
      const cl = clients.find((c) => c.id === colis.clientId);
      if (cl && cl.type === 'particulier') {
        const transport = colis.devisTransport || 0;
        const points = Math.floor(transport / 10);
        if (points > 0) {
          const newPoints = (cl.points || 0) + points;
          updateClient(cl.id, { points: newPoints }, true);
          flash({ msg: `Paiement confirmé ! +${points} point${points > 1 ? 's' : ''} fidélité`, type: 'success', duration: 5000 });
          return;
        }
      }
    }

    flash({ msg: 'Paiement confirmé !', type: 'success', duration: 5000 });
  }, [log, upd, flash, data, clients, updateClient]);

  const envMsg = useCallback(async (colisId, msgTxt, authInfo, tel) => {
    if (!msgTxt.trim()) return;
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const isStaffSender = authInfo.type === 'staff';

    // Persist to Supabase FIRST, get real ID
    let savedMsg = null;
    try {
      savedMsg = await sb.insertMessage(colisId, {
        type: isStaffSender ? 'staff' : 'client',
        auteur: authInfo.u.nom,
        texte: msgTxt.trim(),
        statut: isStaffSender ? 'envoi' : null,
      });
    } catch (err) {
      console.warn('[Supabase] insertMessage error:', err.message);
    }

    const msgId = savedMsg?.id || uid();

    // Add to local state
    setData((prev) => prev.map((c) => {
      if (c.id !== colisId) return c;
      return {
        ...c,
        messages: [...c.messages, savedMsg || {
          id: msgId,
          type: isStaffSender ? 'staff' : 'client',
          auteur: authInfo.u.nom,
          texte: msgTxt.trim(),
          heure,
          statut: isStaffSender ? 'envoi' : null,
        }],
      };
    }));

    // Send via Telegram if staff + client has a Telegram Chat ID
    const colis = data.find((x) => x.id === colisId);
    const client = colis ? clientsRef.current?.find((x) => x.id === colis.clientId) : null;
    const chatId = client?.telegramChatId;

    if (isStaffSender && isTelegramConfigured() && chatId) {
      const res = await sendTelegram(chatId, msgTxt.trim());
      setData((prev) => prev.map((c) => {
        if (c.id !== colisId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, statut: res.ok ? 'envoye' : 'echec', msgId: res.ok ? res.messageId : null } : m,
          ),
        };
      }));
    } else if (isStaffSender && isTelegramConfigured() && !chatId) {
      // Client hasn't linked Telegram yet — mark as pending
      setData((prev) => prev.map((c) => {
        if (c.id !== colisId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, statut: 'en_attente' } : m,
          ),
        };
      }));
    }
  }, []);

  // ── Webhook SSE — réception messages entrants + statuts ──
  const clientsRef = useRef(clients);
  clientsRef.current = clients;

  useEffect(() => {
    const cleanup = connectWebhook((event) => {
      if (event.type === 'message') {
        // ── Message entrant du client ──
        const fromNorm = event.from; // déjà normalisé (ex: "262692595378")
        // Trouver le client par téléphone
        const cl = clientsRef.current.find((c) => c.tel && normalizeTel(c.tel) === fromNorm);
        if (!cl) {
          console.warn('[Webhook] Aucun client trouvé pour', fromNorm);
          return;
        }
        // Trouver le colis actif le plus récent de ce client
        setData((prev) => {
          const activeColis = prev.filter(
            (p) => p.clientId === cl.id && p.statut !== 'annule' && p.statut !== 'livre',
          );
          if (activeColis.length === 0) return prev;
          const targetId = activeColis[activeColis.length - 1].id;
          return prev.map((p) => {
            if (p.id !== targetId) return p;
            return {
              ...p,
              messages: [...p.messages, {
                id: uid(),
                type: 'client',
                auteur: event.name || cl.nom,
                texte: event.text,
                heure: new Date(parseInt(event.timestamp, 10) * 1000)
                  .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                msgId: event.msgId || event.waId,
              }],
            };
          });
        });
        // Notification flash
        flash({ msg: `💬 ${event.name || cl.nom} : ${event.text.slice(0, 60)}`, type: 'info', duration: 4000 });
      } else if (event.type === 'status') {
        // ── Mise à jour statut (sent → delivered → read) ──
        const statusMap = { sent: 'envoye', delivered: 'distribue', read: 'lu', failed: 'echec' };
        const newStatut = statusMap[event.status];
        if (!newStatut) return;
        setData((prev) => prev.map((p) => ({
          ...p,
          messages: p.messages.map((m) =>
            (m.msgId === event.msgId || m.waId === event.waId) ? { ...m, statut: newStatut } : m,
          ),
        })));
      }
    });
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({
    // Auth
    auth, setAuth, isStaff, authCl, authRole, sbReady,
    // Data
    data, setData, clients, setClients, categories, setCategories, tarifs, setTarifs, envois, setEnvois, logs, produitsInterdits, setProduitsInterdits,
    // Communication
    comLog, sendMsg, getPreview,
    // Notifications
    notifs, unreadNotifs, markNotifRead, markAllNotifsRead,
    // UI
    selId, setSelId, sel, selClient, selDest, toast, setToast, page, setPage, clientTab, setClientTab, colisFilter, setColisFilter, cfm, setCfm,
    // Actions
    flash, ask, closeConfirm, upd, log: log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, archiverColis, desarchiverColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  }), [
    auth, isStaff, authCl, authRole, data, clients, categories, tarifs, envois, logs, produitsInterdits,
    comLog, sendMsg, getPreview, notifs, unreadNotifs, markNotifRead, markAllNotifsRead,
    selId, sel, selClient, selDest, toast, setToast, page, clientTab, colisFilter, cfm,
    flash, ask, closeConfirm, upd, log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, archiverColis, desarchiverColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

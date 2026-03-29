import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { STATUTS, PREV_STATUT, CATEGORIES_INIT, CLIENTS_INIT, TARIFS_DEFAUT, initEnvois, getDestByCP, PRODUITS_INTERDITS } from '../constants';
import { MSG_TEMPLATES } from '../constants/templates';
import { uid, makeData, calcTransport, getCatTaux, eur, mailtoLink, getClientDest } from '../utils';
import { isWaConfigured, sendWhatsApp, sendNotification, waMeLink, normalizeTel } from '../services/whatsappApi';
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
  const [produitsInterdits, setProduitsInterdits] = useState(PRODUITS_INTERDITS);

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
              waId: newMsg.wa_id,
            }],
          };
        }));
      }
    });

    return () => {
      supabase.removeChannel(colisSub);
      supabase.removeChannel(msgSub);
    };
  }, [sbReady]);

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
  const upd = useCallback((id, changes) => {
    // Optimistic local update
    setData((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    // Persist to Supabase (fire and forget, realtime will sync)
    if (sbReady) {
      sb.updateColis(id, changes).catch((err) => console.error('[Supabase] upd error:', err.message));
    }
  }, [sbReady]);

  const log = useCallback((id, oldStatut, newStatut) => {
    setLogs((prev) => [...prev, { id: uid(), cid: id, o: oldStatut, n: newStatut, w: auth?.u?.nom || '?' }]);
  }, [auth]);

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
    flash(`Catégorie "${label}" ajoutée`);
    return id;
  }, [flash]);

  const updateCatTaux = useCallback((catId, destCode, field, val) => {
    setCategories((prev) => prev.map((c) => {
      if (c.id !== catId) return c;
      const newTaux = { ...c.taux };
      newTaux[destCode] = { ...(newTaux[destCode] || { om: 0, omr: 0 }), [field]: Number(val) || 0 };
      return { ...c, taux: newTaux };
    }));
  }, []);

  const updateCatLabel = useCallback((catId, label) => {
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, label } : c)));
  }, []);

  const deleteCategory = useCallback((catId) => {
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    flash('Catégorie supprimée');
  }, [flash]);

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
  const sendMsg = useCallback((colisId, clientId, canal, templateKey, customMsg) => {
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

    const fullMsg = tpl ? (canal === 'whatsapp' ? tpl.whatsapp(c, colis) : tpl.email(c, colis)) : customMsg || '';

    if (canal === 'whatsapp' && c.tel) {
      if (isWaConfigured()) {
        // ── API WhatsApp Business Cloud — template Meta + fallback texte ──
        const prenom = c.nom.split(' ')[0];
        // Préparer les infos template Meta si disponibles
        const metaInfo = tpl?.meta ? {
          name: tpl.meta.name,
          lang: tpl.meta.lang || 'fr',
          params: tpl.meta.params ? tpl.meta.params(c, colis || {}) : [],
        } : null;
        flash({ msg: `Envoi WhatsApp → ${prenom}…`, type: 'info' });
        sendNotification(c.tel, fullMsg, metaInfo).then((res) => {
          if (res.ok) {
            const methodLabel = res.method === 'template' ? 'template' : 'texte';
            // Add to chat thread
            setData((prev) => prev.map((p) => {
              if (p.id !== colisId) return p;
              return {
                ...p,
                messages: [...p.messages, {
                  id: uid(), type: 'staff', auteur: auth?.u?.nom || 'Système',
                  texte: fullMsg, statut: 'envoye', waId: res.messageId || null,
                  heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                }],
              };
            }));
            flash({ msg: `WhatsApp envoyé (${methodLabel}) → ${prenom}`, type: 'success' });
          } else {
            // Échec API → bouton fallback, PAS de redirection auto
            const link = res.waLink;
            flash({
              msg: `Envoi auto impossible → ${prenom}\n(${res.error || 'fenêtre 24h expirée'})`,
              type: 'warning',
              action: link ? {
                label: 'Ouvrir WhatsApp manuellement',
                onClick: () => window.open(link, '_blank'),
              } : null,
            });
          }
        });
      } else {
        // API non configurée → bouton wa.me, pas de redirection auto
        const link = waMeLink(c.tel, fullMsg);
        flash({
          msg: `API WhatsApp non configurée`,
          type: 'warning',
          action: {
            label: 'Ouvrir WhatsApp',
            onClick: () => window.open(link, '_blank'),
          },
        });
      }
    } else if (canal === 'email' && c.email) {
      window.open(mailtoLink(c.email, fullMsg), '_blank');
      flash(`Email → ${c.nom.split(' ')[0]}`);
    }
  }, [clients, data, auth, flash]);

  const getPreview = useCallback((templateKey, clientId, colisId, canal) => {
    const c = clients.find((x) => x.id === clientId);
    const colis = data.find((x) => x.id === colisId);
    if (!c || !MSG_TEMPLATES[templateKey]) return '';
    return canal === 'whatsapp' ? MSG_TEMPLATES[templateKey].whatsapp(c, colis || {}) : MSG_TEMPLATES[templateKey].email(c, colis || {});
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

    const resetMap = {
      receptionne: { casier: null, photoReception: false, checkInterdits: [], produitInterdit: false, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], dateReception: null },
      mesure: { dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [] },
      attente_feu_vert: { feuVert: null },
      autorise: { feuVert: null },
      en_preparation: { finL: null, finW: null, finH: null, finP: null },
      devis_envoye: { devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, avantOptimTransport: null, avantOptimTotal: null, economie: null, devisBrouillon: false, finL: null, finW: null, finH: null, finP: null },
      attente_paiement: { devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, avantOptimTransport: null, avantOptimTotal: null, economie: null, devisBrouillon: false },
      paye: { paiementMontant: null },
    };

    const reset = { ...(resetMap[c.statut] || {}), statut: prev };
    log(id, c.statut, prev + ' (correction)');
    upd(id, reset);
    flash(`Retour à : ${STATUTS[prev].label}`);
  }, [data, log, upd, flash]);

  const annulerColis = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c) return;
    log(id, c.statut, 'annule');
    upd(id, { statut: 'annule' });
    flash('Colis annulé');
  }, [data, log, upd, flash]);

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

  const feuVert = useCallback((id, ok) => {
    const ns = ok ? 'autorise' : 'refuse_client';
    log(id, 'attente_feu_vert', ns);
    upd(id, { statut: ns, feuVert: ok ? 'autorise' : 'refuse' });
    flash({ msg: ok ? 'Vous avez autorisé la préparation' : 'Vous avez refusé — le colis ne sera pas préparé', type: ok ? 'success' : 'warning', duration: 4000 });
  }, [log, upd, flash]);

  const feuVertBulk = useCallback((ids) => {
    ids.forEach((id) => {
      log(id, 'attente_feu_vert', 'autorise');
      upd(id, { statut: 'autorise', feuVert: 'autorise' });
    });
    flash({ msg: `${ids.length} colis autorisés`, type: 'success', duration: 4000 });
  }, [log, upd, flash]);

  const envoyerDevis = useCallback((id) => {
    const c = data.find((x) => x.id === id);
    if (!c || !c.finL || !c.finW || !c.finH || !c.finP) {
      flash('Renseignez les dimensions et poids après optimisation');
      return;
    }
    const dest = getClientDest(c.clientId, clients);
    const t = tarifs[dest.code] || tarifs['974'];

    // Calcul APRÈS optimisation
    const pv = (c.finL * c.finW * c.finH) / 5000;
    const pf = Math.max(c.finP, pv);
    const tr = calcTransport(pf, t);
    let om = 0, omr = 0;
    c.lignes.forEach((l) => {
      const cat = categories.find((x) => x.id === l.cat);
      if (cat) {
        const ct = getCatTaux(cat, dest.code);
        om += l.qte * l.prix * ct.om / 100;
        omr += l.qte * l.prix * ct.omr / 100;
      }
    });
    const ht = tr + om + omr;
    const tva = ht * (dest.tva / 100);
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
  }, [data, clients, tarifs, categories, upd, flash]);

  const payer = useCallback((id, mt) => {
    log(id, 'attente_paiement', 'paye');
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
    const msgId = uid();
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const isStaffSender = authInfo.type === 'staff';

    // Add message immediately (status 'envoi' for staff, null for client)
    setData((prev) => prev.map((c) => {
      if (c.id !== colisId) return c;
      return {
        ...c,
        messages: [...c.messages, {
          id: msgId,
          type: isStaffSender ? 'staff' : 'client',
          auteur: authInfo.u.nom,
          texte: msgTxt.trim(),
          heure,
          statut: isStaffSender && tel ? 'envoi' : null,
        }],
      };
    }));

    // Send via WhatsApp if staff + phone available
    if (isStaffSender && tel && isWaConfigured()) {
      const res = await sendWhatsApp(tel, msgTxt.trim());
      setData((prev) => prev.map((c) => {
        if (c.id !== colisId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, statut: res.ok ? 'envoye' : 'echec', waId: res.ok ? res.messageId : null } : m,
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
                waId: event.waId,
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
            m.waId === event.waId ? { ...m, statut: newStatut } : m,
          ),
        })));
      }
    });
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({
    // Auth
    auth, setAuth, isStaff, authCl, sbReady,
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
    receptionner, changerStatut, revertStatut, annulerColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  }), [
    auth, isStaff, authCl, data, clients, categories, tarifs, envois, logs, produitsInterdits,
    comLog, sendMsg, getPreview, notifs, unreadNotifs, markNotifRead, markAllNotifsRead,
    selId, sel, selClient, selDest, toast, setToast, page, clientTab, colisFilter, cfm,
    flash, ask, closeConfirm, upd, log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

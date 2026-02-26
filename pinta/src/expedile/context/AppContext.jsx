import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { STATUTS, PREV_STATUT, CATEGORIES_INIT, CLIENTS_INIT, TARIFS_DEFAUT, initEnvois, getDestByCP, CUTOFF_DEFAULT } from '../constants';
import { MSG_TEMPLATES } from '../constants/templates';
import { uid, makeData, calcTransport, getCatTaux, eur, mailtoLink, getClientDest } from '../utils';
import { isWaConfigured, sendWhatsApp, sendNotification, waMeLink, normalizeTel } from '../services/whatsappApi';
import { connectWebhook } from '../services/webhookListener';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  // ── Auth ──
  const [auth, setAuth] = useState(null);

  // ── Core data ──
  const [data, setData] = useState(makeData);
  const [clients, setClients] = useState(CLIENTS_INIT);
  const [categories, setCategories] = useState(CATEGORIES_INIT);
  const [tarifs, setTarifs] = useState(TARIFS_DEFAUT);
  const [envois, setEnvois] = useState(initEnvois);
  const [logs, setLogs] = useState([]);
  const [cutoff, setCutoff] = useState(CUTOFF_DEFAULT);

  // ── Communication ──
  const [comLog, setComLog] = useState([
    { id: 'com1', colisId: 'p1', clientId: 'c1', canal: 'whatsapp', template: 'reception', msg: 'Colis réceptionné', date: '08/02 14:30', user: 'Sophie Martin' },
    { id: 'com2', colisId: 'p1', clientId: 'c1', canal: 'whatsapp', template: 'demande_feu_vert', msg: 'Demande de feu vert envoyée', date: '08/02 16:00', user: 'Sophie Martin' },
    { id: 'com3', colisId: 'p7', clientId: 'c1', canal: 'whatsapp', template: 'devis_final', msg: 'Devis final 54,67€ envoyé', date: '07/02 11:00', user: 'Marie Dupont' },
  ]);

  // ── Notifications (client) ──
  const [notifs, setNotifs] = useState([
    { id: 'n1', date: '09/02 08:30', titre: 'Colis réceptionné', msg: 'Votre colis EXP-0001 est arrivé à Paris', lu: false, colisId: 'p1' },
    { id: 'n2', date: '08/02 16:00', titre: 'Accord requis', msg: 'Votre colis EXP-0001 a été mesuré. Donnez votre feu vert pour la préparation !', lu: false, colisId: 'p1' },
    { id: 'n3', date: '07/02 14:20', titre: 'Devis à payer', msg: 'Le devis final de EXP-0008 est de 54,67€', lu: true, colisId: 'p7' },
    { id: 'n4', date: '06/02 09:15', titre: 'Colis pré-annoncé', msg: 'Votre pré-annonce EXP-0004 a bien été enregistrée', lu: true, colisId: 'p4' },
  ]);

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
    setData((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  }, []);

  const log = useCallback((id, oldStatut, newStatut) => {
    setLogs((prev) => [...prev, { id: uid(), cid: id, o: oldStatut, n: newStatut, w: auth?.u?.nom || '?' }]);
  }, [auth]);

  const getClient = useCallback((id) => clients.find((c) => c.id === id), [clients]);
  const getTarif = useCallback((destCode) => tarifs[destCode || '974'] || tarifs['974'], [tarifs]);

  // ── Client CRUD ──
  const updateClient = useCallback((id, changes, silent) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    if (!silent) flash('Client mis à jour');
  }, [flash]);

  const addNewClient = useCallback((cl) => {
    const id = 'cl_' + uid();
    setClients((prev) => [...prev, { id, ...cl }]);
    flash('Client ajouté');
    return id;
  }, [flash]);

  const deleteClient = useCallback((id) => {
    if (data.some((p) => p.clientId === id)) {
      flash('Ce client a des colis, impossible de le supprimer');
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== id));
    flash('Client supprimé');
  }, [data, flash]);

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
  }, []);

  const markAllNotifsRead = useCallback(() => {
    setNotifs((prev) => prev.map((n) => ({ ...n, lu: true })));
  }, []);

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

  // ── Auto-affectation helpers ──
  const getNextDeparture = useCallback(() => {
    return envois.find((e) => e.statut === 'prochain' || e.statut === 'en_cours')
      || envois.find((e) => e.statut === 'planifie');
  }, [envois]);

  const isBeforeCutoff = useCallback(() => {
    const now = new Date();
    const nextDep = getNextDeparture();
    if (!nextDep) return false;
    const depDate = new Date(nextDep.date + 'T00:00:00');
    // Cutoff = cutoff.day jours avant le départ à cutoff.hour heures
    // Ex: départ vendredi (5), cutoff mercredi (3) 17h → 2 jours avant
    const cutoffDate = new Date(depDate);
    const daysDiff = (depDate.getDay() - cutoff.day + 7) % 7 || 7;
    cutoffDate.setDate(depDate.getDate() - daysDiff);
    cutoffDate.setHours(cutoff.hour, 0, 0, 0);
    return now < cutoffDate;
  }, [getNextDeparture, cutoff]);

  const autoAffectEnvoi = useCallback((colisId) => {
    if (!isBeforeCutoff()) return null;
    const dep = getNextDeparture();
    if (!dep) return null;
    upd(colisId, { envoi: dep.id });
    return dep;
  }, [isBeforeCutoff, getNextDeparture, upd]);

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
    flash('Demande de feu vert envoyée au client');
  }, [data, log, upd, flash]);

  const feuVert = useCallback((id, ok) => {
    const ns = ok ? 'autorise' : 'refuse_client';
    log(id, 'attente_feu_vert', ns);
    upd(id, { statut: ns, feuVert: ok ? 'autorise' : 'refuse' });
    if (ok) {
      const dep = autoAffectEnvoi(id);
      if (dep) {
        const d = new Date(dep.date + 'T00:00:00');
        const lbl = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
        flash(`Autorisé — affecté au vol du ${lbl}`);
      } else {
        flash('Vous avez autorisé la préparation');
      }
    } else {
      flash('Vous avez refusé — le colis ne sera pas préparé');
    }
  }, [log, upd, flash, autoAffectEnvoi]);

  const feuVertBulk = useCallback((ids) => {
    let autoCount = 0;
    ids.forEach((id) => {
      log(id, 'attente_feu_vert', 'autorise');
      upd(id, { statut: 'autorise', feuVert: 'autorise' });
      if (autoAffectEnvoi(id)) autoCount++;
    });
    flash(`${ids.length} colis autorisés${autoCount > 0 ? ` — ${autoCount} affecté(s) au prochain vol` : ''}`);
  }, [log, upd, flash, autoAffectEnvoi]);

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
    upd(id, { statut: 'paye', paiementMontant: mt });
    const c = data.find((x) => x.id === id);
    if (!c?.envoi) {
      const dep = autoAffectEnvoi(id);
      if (dep) {
        const d = new Date(dep.date + 'T00:00:00');
        const lbl = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
        flash(`Paiement confirmé — affecté au vol du ${lbl}`);
        return;
      }
    }
    flash('Paiement confirmé !');
  }, [log, upd, data, flash, autoAffectEnvoi]);

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
    auth, setAuth, isStaff, authCl,
    // Data
    data, setData, clients, setClients, categories, setCategories, tarifs, setTarifs, envois, setEnvois, logs,
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
    cutoff, setCutoff, getNextDeparture,
  }), [
    auth, isStaff, authCl, data, clients, categories, tarifs, envois, logs,
    comLog, sendMsg, getPreview, notifs, unreadNotifs, markNotifRead, markAllNotifsRead,
    selId, sel, selClient, selDest, toast, setToast, page, clientTab, colisFilter, cfm,
    flash, ask, closeConfirm, upd, log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
    cutoff, setCutoff, getNextDeparture,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

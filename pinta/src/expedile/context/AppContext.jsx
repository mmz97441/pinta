import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { STATUTS, PREV_STATUT, CATEGORIES_INIT, CLIENTS_INIT, TARIFS_DEFAUT, initEnvois, getDestByCP } from '../constants';
import { MSG_TEMPLATES } from '../constants/templates';
import { uid, makeData, calcTransport, getCatTaux, eur, waLink, mailtoLink, getClientDest } from '../utils';

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
  const flash = useCallback((m) => {
    setToast(m);
    setTimeout(() => setToast(''), 2200);
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
      window.open(waLink(c.tel, fullMsg), '_blank');
    } else if (canal === 'email' && c.email) {
      window.open(mailtoLink(c.email, fullMsg), '_blank');
    }

    flash(`${canal === 'whatsapp' ? 'WhatsApp' : 'Email'} → ${c.nom.split(' ')[0]}`);
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
    flash('Demande de feu vert envoyée au client');
  }, [data, log, upd, flash]);

  const feuVert = useCallback((id, ok) => {
    const ns = ok ? 'autorise' : 'refuse_client';
    log(id, 'attente_feu_vert', ns);
    upd(id, { statut: ns, feuVert: ok ? 'autorise' : 'refuse' });
    flash(ok ? 'Vous avez autorisé la préparation' : 'Vous avez refusé — le colis ne sera pas préparé');
  }, [log, upd, flash]);

  const feuVertBulk = useCallback((ids) => {
    ids.forEach((id) => {
      log(id, 'attente_feu_vert', 'autorise');
      upd(id, { statut: 'autorise', feuVert: 'autorise' });
    });
    flash(`${ids.length} colis autorisés`);
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
    upd(id, { statut: 'paye', paiementMontant: mt });
    flash('Paiement confirmé !');
  }, [log, upd, flash]);

  const envMsg = useCallback((id, msgTxt, authInfo) => {
    if (!msgTxt.trim()) return;
    setData((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      return { ...c, messages: [...c.messages, { id: uid(), type: authInfo.type === 'staff' ? 'staff' : 'client', auteur: authInfo.u.nom, texte: msgTxt.trim() }] };
    }));
  }, []);

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
    selId, setSelId, sel, selClient, selDest, toast, page, setPage, clientTab, setClientTab, colisFilter, setColisFilter, cfm, setCfm,
    // Actions
    flash, ask, closeConfirm, upd, log: log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  }), [
    auth, isStaff, authCl, data, clients, categories, tarifs, envois, logs,
    comLog, sendMsg, getPreview, notifs, unreadNotifs, markNotifRead, markAllNotifsRead,
    selId, sel, selClient, selDest, toast, page, clientTab, colisFilter, cfm,
    flash, ask, closeConfirm, upd, log, getClient, getTarif,
    updateClient, addNewClient, deleteClient,
    addCategory, updateCatTaux, updateCatLabel, deleteCategory,
    receptionner, changerStatut, revertStatut, annulerColis, demanderFeuVert, feuVert, feuVertBulk, envoyerDevis, payer, envMsg,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

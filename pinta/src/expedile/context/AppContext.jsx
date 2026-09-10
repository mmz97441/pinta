import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { STATUTS, PREV_STATUT, PRODUITS_INTERDITS } from '../constants';
import { functionErrorMessage } from '../services/functionErrors';
import { MSG_TEMPLATES } from '../constants/templates';
import { eur, mailtoLink, getClientDest, getPrenom } from '../utils';
import { deliverMessage } from '../services/telegramApi';
import { calculateQuote, quoteInputFingerprint } from '../domain/quote';
import { hasCompleteReceptionMeasurements } from '../domain/reception';
import { renderTemplate } from '../services/messageTemplates';
import { DEFAULT_BODIES } from '../services/messageDefaults';
import * as sb from '../lib/supabaseData';
import { supabase, configurationError } from '../lib/supabase';
import { randomId } from '../lib/randomId';

const isStaffForSession = (identity) => identity?.type === 'staff';
const AppContext = createContext(null);
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [data, setData] = useState([]);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tarifs, setTarifs] = useState({});
  const [envois, setEnvois] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sbReady, setSbReady] = useState(false);
  const [settings, setSettings] = useState({});
  const [messageTemplates, setMessageTemplates] = useState({});
  const [produitsInterdits, setProduitsInterditsState] = useState(PRODUITS_INTERDITS);
  const [notifs, setNotifs] = useState([]);
  const [comLog, setComLog] = useState([]);
  const [inboxItems, setInboxItems] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [selId, setSelId] = useState(null);
  const [toast, setToast] = useState('');
  const [page, setPage] = useState('home');
  const [clientTab, setClientTab] = useState('accueil');
  const [colisFilter, setColisFilter] = useState(null);
  const [cfm, setCfm] = useState(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const authRef = useRef(auth);
  authRef.current = auth;
  const generation = useRef(0);
  const queues = useRef(new Map());
  const flashTimer = useRef(null);
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem('expedile-theme') ||
      (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('expedile-theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const flash = useCallback((message) => {
    clearTimeout(flashTimer.current);
    setToast(message);
    flashTimer.current = setTimeout(
      () => setToast(''),
      typeof message === 'object' ? message.duration || 6000 : 3000,
    );
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const reportError = useCallback(
    (error) => {
      flash({ msg: error.message || 'L’opération a échoué. Réessayez.', type: 'error' });
      return error;
    },
    [flash],
  );
  const replaceColis = useCallback((saved) => {
    // A mutation result contains the row only; preserve separately loaded relations.
    const previous = dataRef.current.find((c) => c.id === saved.id);
    const next = {
      ...previous,
      ...saved,
      factures: previous?.factures || saved.factures || [],
      lignes: previous?.lignes || saved.lignes || [],
      messages: previous?.messages || saved.messages || [],
    };
    const updated = previous
      ? dataRef.current.map((c) => (c.id === saved.id ? next : c))
      : [...dataRef.current, next];
    dataRef.current = updated;
    setData(updated);
    return next;
  }, []);
  const refreshColis = useCallback(async (id) => {
    const token = generation.current;
    const rows = await sb.fetchColis(id);
    if (token !== generation.current || !rows[0]) return;
    const updated = dataRef.current.some((c) => c.id === id)
      ? dataRef.current.map((c) => (c.id === id ? rows[0] : c))
      : [...dataRef.current, rows[0]];
    dataRef.current = updated;
    setData(updated);
    return rows[0];
  }, []);
  const refreshInbox = useCallback(async () => {
    if (authRef.current?.type !== 'staff') return;
    const token = generation.current;
    const rows = await sb.fetchAllRows('client_inbox', (q) => q.eq('status', 'unassigned'));
    if (token !== generation.current) return;
    setInboxItems(rows);
    return rows;
  }, []);
  const loadArchives = useCallback(async () => {
    const token = generation.current;
    const archived = await sb.fetchColis(null, { archived: true });
    if (token !== generation.current) return;
    const known = new Map(dataRef.current.map((c) => [c.id, c]));
    archived.forEach((c) => known.set(c.id, c));
    dataRef.current = [...known.values()];
    setData(dataRef.current);
    setArchivesLoaded(true);
  }, []);
  const loadData = useCallback(async (identity, token) => {
    setDataLoading(true);
    setDataError('');
    try {
      const [colisRows, clientRows, envoiRows, catRows, tarifRows, notifications, configuration] =
        await Promise.all([
          sb.fetchColis(),
          sb.fetchClients(),
          sb.fetchEnvois(),
          sb.fetchCategories(),
          sb.fetchTarifs(),
          sb.fetchNotifications(identity.session.user.id),
          sb.fetchSettings(),
        ]);
      if (token !== generation.current) return;
      dataRef.current = colisRows;
      setArchivesLoaded(false);
      setData(colisRows);
      setClients(clientRows);
      setEnvois(envoiRows);
      setCategories(catRows);
      setTarifs(tarifRows);
      setNotifs(notifications);
      setSettings(configuration.settings.business || {});
      setMessageTemplates(configuration.templates);
      setProduitsInterditsState(configuration.settings.produits_interdits || PRODUITS_INTERDITS);
      if (identity.type === 'staff') {
        const [inbox, team] = await Promise.all([
          sb.fetchAllRows('client_inbox', (q) => q.eq('status', 'unassigned')),
          sb.fetchStaffUsers(),
        ]);
        if (token !== generation.current) return;
        setInboxItems(inbox);
        setTeamUsers(team);
      } else setInboxItems([]);
      setSbReady(true);
    } catch (error) {
      if (token !== generation.current) return;
      setSbReady(false);
      setDataError(`Chargement impossible : ${error.message}`);
    } finally {
      if (token === generation.current) setDataLoading(false);
    }
  }, []);
  const establishSession = useCallback(
    async (session) => {
      const token = ++generation.current;
      setAuthLoading(true);
      setAuthError('');
      setSbReady(false);
      if (!session) {
        sb.setDataScope('staff');
        dataRef.current = [];
        authRef.current = null;
        setSettings({});
        setMessageTemplates({});
        setInboxItems([]);
        setTeamUsers([]);
        setCategories([]);
        setTarifs({});
        setArchivesLoaded(false);
        setLogs([]);
        setComLog([]);
        setAuth(null);
        setData([]);
        setClients([]);
        setEnvois([]);
        setNotifs([]);
        setSelId(null);
        setDataLoading(false);
        setAuthLoading(false);
        return;
      }
      try {
        const identity = await sb.resolveIdentity(session);
        if (token !== generation.current) return;
        sb.setDataScope(identity.type);
        authRef.current = identity;
        setAuth(identity);
        await loadData(identity, token);
      } catch (error) {
        if (token === generation.current) {
          setAuth(null);
          setAuthError(error.message);
        }
        throw error;
      } finally {
        if (token === generation.current) setAuthLoading(false);
      }
    },
    [loadData],
  );
  useEffect(() => {
    let active = true;
    if (configurationError) {
      setAuthError(configurationError);
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(error.message);
        setAuthLoading(false);
        return;
      }
      establishSession(session).catch(() => {});
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event === 'INITIAL_SESSION') return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      // Never await another Auth call inside Supabase's auth event lock.
      if (event === 'TOKEN_REFRESHED' && authRef.current?.session.user.id === session?.user.id) {
        setAuth((previous) => (previous ? { ...previous, session } : previous));
        return;
      }
      if (event === 'SIGNED_IN' && authRef.current?.session.user.id === session?.user.id) return;
      setTimeout(() => {
        if (active) establishSession(session).catch(() => {});
      }, 0);
    });
    return () => {
      active = false;
      generation.current++;
      subscription.subscription.unsubscribe();
    };
  }, [establishSession]);
  const signIn = useCallback(
    async (email, password) => {
      if (configurationError) throw new Error(configurationError);
      const { data: result, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      await establishSession(result.session);
    },
    [establishSession],
  );
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw reportError(error);
    authRef.current = null;
    setPasswordRecovery(false);
    await establishSession(null);
  }, [establishSession, reportError]);
  const completePasswordRecovery = useCallback(async () => {
    setPasswordRecovery(false);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await establishSession(session);
  }, [establishSession]);
  const retryLoad = useCallback(() => auth && loadData(auth, generation.current), [auth, loadData]);
  useEffect(() => {
    if (!sbReady || !auth?.session.user.id) return;
    const token = generation.current;
    const timers = new Map();
    const changed = (payload) => {
      const recordId = payload.new?.id || payload.old?.id;
      const relation =
        payload.table === 'factures'
          ? 'factures'
          : payload.table === 'lignes'
            ? 'lignes'
            : 'messages';
      const id =
        payload.new?.colis_id ||
        payload.old?.colis_id ||
        (payload.table === 'colis'
          ? recordId
          : dataRef.current.find((c) => (c[relation] || []).some((row) => row.id === recordId))
              ?.id);
      if (!id) return;
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => refreshColis(id).catch(reportError), 200),
      );
    };
    const reloadConfiguration = () => {
      clearTimeout(timers.get('configuration'));
      timers.set(
        'configuration',
        setTimeout(async () => {
          try {
            const [config, cats, rates] = await Promise.all([
              sb.fetchSettings(),
              sb.fetchCategories(),
              sb.fetchTarifs(),
            ]);
            if (token !== generation.current) return;
            setSettings(config.settings.business || {});
            setMessageTemplates(config.templates);
            setCategories(cats);
            setTarifs(rates);
            if (config.settings.produits_interdits)
              setProduitsInterditsState(config.settings.produits_interdits);
          } catch (error) {
            reportError(error);
          }
        }, 200),
      );
    };
    const channels = [
      ...['app_settings', 'message_templates', 'categories', 'taux_categories', 'tarifs'].map(
        (table) =>
          supabase
            .channel(`${table}-changes`)
            .on('postgres_changes', { event: '*', schema: 'public', table }, reloadConfiguration)
            .subscribe(),
      ),
      sb.subscribeColis(changed),
      sb.subscribeFactures(changed),
      sb.subscribeMessages(changed),
      supabase
        .channel('lignes-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lignes' }, changed)
        .subscribe(),
      ...(isStaffForSession(auth)
        ? [
            supabase
              .channel('inbox-changes')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'client_inbox' }, () =>
                refreshInbox().catch(reportError),
              )
              .subscribe(),
          ]
        : []),
      supabase
        .channel('clients-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () =>
          sb
            .fetchClients()
            .then((rows) => {
              if (token === generation.current) setClients(rows);
            })
            .catch(reportError),
        )
        .subscribe(),
      supabase
        .channel('envois-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'envois' }, () =>
          sb
            .fetchEnvois()
            .then((rows) => {
              if (token === generation.current) setEnvois(rows);
            })
            .catch(reportError),
        )
        .subscribe(),
      sb.subscribeNotifications(auth.session.user.id, (payload) => {
        sb.fetchNotifications(auth.session.user.id)
          .then((rows) => {
            if (token === generation.current) setNotifs(rows);
          })
          .catch(reportError);
        if (payload.new?.colis_id) refreshColis(payload.new.colis_id).catch(reportError);
      }),
    ];
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [sbReady, auth?.session.user.id, refreshColis, refreshInbox, reportError]);
  // Raw table realtime is intentionally unavailable to clients: read through the safe views.
  useEffect(() => {
    if (!sbReady || auth?.type !== 'client') return;
    const token = generation.current;
    let busy = false;
    const refreshVisible = async () => {
      if (document.visibilityState !== 'visible' || busy) return;
      busy = true;
      try {
        const [rows, customerRows] = await Promise.all([sb.fetchColis(), sb.fetchClients()]);
        if (token === generation.current) {
          const archived = dataRef.current.filter((c) => c.archive);
          const combined = [...rows, ...archived];
          dataRef.current = combined;
          setData(combined);
          setClients(customerRows);
          setDataError('');
        }
      } catch (error) {
        if (token === generation.current)
          setDataError(`Actualisation impossible : ${error.message}`);
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(refreshVisible, 60000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [sbReady, auth?.type, auth?.session.user.id]);
  const isStaff = auth?.type === 'staff';
  const authRole = isStaff ? auth.u.role : 'client';
  const can = useCallback(
    (permission) =>
      isStaff &&
      (['directeur', 'vice_directeur'].includes(authRole) ||
        auth.u.permissions?.[permission] === true),
    [auth, authRole, isStaff],
  );
  const authCl = useMemo(
    () => (auth?.type === 'client' ? clients.find((c) => c.id === auth.cl.id) || auth.cl : null),
    [auth, clients],
  );
  const sel = useMemo(() => data.find((c) => c.id === selId) || null, [data, selId]);
  const selClient = useMemo(() => clients.find((c) => c.id === sel?.clientId), [clients, sel]);
  const selDest = useMemo(
    () => (sel ? getClientDest(sel.clientId, clients) : null),
    [sel, clients],
  );
  const unreadNotifs = notifs.filter((n) => !n.lu).length;
  const ask = useCallback(
    (title, msg, onOk, opts) =>
      setCfm({ title, msg, onOk, danger: opts?.danger, okLabel: opts?.okLabel || 'Confirmer' }),
    [],
  );
  const closeConfirm = useCallback(() => setCfm(null), []);
  const requireReady = useCallback(() => {
    if (!sbReady)
      throw new Error('Les données ne sont pas disponibles. Rechargez avant de modifier.');
  }, [sbReady]);
  const upd = useCallback(
    (id, changes, { expectedUpdatedAt } = {}) => {
      const operation = (queues.current.get(id) || Promise.resolve())
        .catch(() => {})
        .then(async () => {
          requireReady();
          const token = generation.current;
          const current = dataRef.current.find((c) => c.id === id);
          const saved = await sb.updateColis(id, changes, expectedUpdatedAt ?? current?.updatedAt);
          return token === generation.current ? replaceColis(saved) : saved;
        })
        .catch((error) => {
          throw reportError(error);
        });
      queues.current.set(id, operation);
      operation
        .finally(() => {
          if (queues.current.get(id) === operation) queues.current.delete(id);
        })
        .catch(() => {});
      return operation;
    },
    [requireReady, replaceColis, reportError],
  );
  // The database trigger is the canonical status audit; do not write duplicate logs.
  const log = useCallback(() => {}, []);
  const getClient = useCallback((id) => clients.find((c) => c.id === id), [clients]);
  const getTarif = useCallback((code) => tarifs[code], [tarifs]);
  const updateClient = useCallback(
    async (id, changes, silent) => {
      try {
        requireReady();
        const token = generation.current;
        const saved = await sb.updateClient(id, changes);
        if (token === generation.current) {
          setClients((prev) => prev.map((c) => (c.id === id ? saved : c)));
          if (!silent) flash('Client mis à jour');
        }
        return saved;
      } catch (error) {
        throw reportError(error);
      }
    },
    [requireReady, flash, reportError],
  );
  const addNewClient = useCallback(
    async (client) => {
      try {
        requireReady();
        const token = generation.current;
        const saved = await sb.insertClient(client);
        if (token === generation.current) {
          setClients((prev) => [...prev, saved]);
          flash('Client ajouté');
        }
        return saved.id;
      } catch (error) {
        throw reportError(error);
      }
    },
    [requireReady, flash, reportError],
  );
  const deleteClient = useCallback(
    async (id) => {
      try {
        requireReady();
        if (dataRef.current.some((c) => c.clientId === id))
          throw new Error('Ce client possède des colis. Conservez son historique.');
        await sb.deleteClient(id);
        setClients((prev) => prev.filter((c) => c.id !== id));
        flash('Client supprimé');
        return true;
      } catch (error) {
        throw reportError(error);
      }
    },
    [requireReady, flash, reportError],
  );
  const addCategory = useCallback(
    async (label, taux) => {
      requireReady();
      const saved = await sb.insertCategorie(label);
      if (taux)
        for (const [code, t] of Object.entries(taux))
          await sb.upsertTauxCategorie(saved.id, code, t.om || 0, t.omr || 0);
      setCategories(await sb.fetchCategories());
      flash('Catégorie ajoutée');
      return saved.id;
    },
    [requireReady, flash],
  );
  const updateCatTaux = useCallback(
    async (catId, code, field, value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100)
        throw reportError(new Error('Taux invalide (0 à 100 %).'));
      const existing = categories.find((c) => c.id === catId)?.taux?.[code] || { om: 0, omr: 0 };
      const next = { ...existing, [field]: n };
      await sb.upsertTauxCategorie(catId, code, next.om, next.omr);
      setCategories(await sb.fetchCategories());
    },
    [categories, reportError],
  );
  const updateCatLabel = useCallback(async (id, label) => {
    await sb.updateCategorie(id, { label });
    setCategories(await sb.fetchCategories());
  }, []);
  const deleteCategory = useCallback(
    async (id) => {
      await sb.deleteCategorie(id);
      setCategories(await sb.fetchCategories());
      flash('Catégorie supprimée');
    },
    [flash],
  );
  const saveSettings = useCallback(
    async (values) => {
      await sb.saveSetting('business', values);
      setSettings(values);
      flash('Paramètres enregistrés');
    },
    [flash],
  );
  const saveMessageTemplate = useCallback(async (key, canal, body) => {
    await sb.saveTemplate(key, canal, body);
    setMessageTemplates((prev) => ({ ...prev, [`${key}_${canal}`]: body }));
  }, []);
  const setProduitsInterdits = useCallback(
    async (value) => {
      const next = typeof value === 'function' ? value(produitsInterdits) : value;
      await sb.saveSetting('produits_interdits', next);
      setProduitsInterditsState(next);
    },
    [produitsInterdits],
  );
  const markNotifRead = useCallback(async (id) => {
    await sb.markNotifRead(id);
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, lu: true } : n)));
  }, []);
  const markAllNotifsRead = useCallback(async () => {
    if (!auth) return;
    await sb.markAllNotifsRead(auth.session.user.id);
    setNotifs((prev) => prev.map((n) => ({ ...n, lu: true })));
  }, [auth]);
  const getPreview = useCallback(
    (key, clientId, colisId, canal) => {
      const client = clients.find((c) => c.id === clientId);
      const colis = dataRef.current.find((c) => c.id === colisId) || {};
      if (!client) return '';
      const effectiveKey = key === 'devis_final' && client.type === 'pro' ? 'devis_final_pro' : key;
      const body =
        messageTemplates[`${effectiveKey}_${canal}`] ?? DEFAULT_BODIES[`${effectiveKey}_${canal}`];
      if (body)
        return renderTemplate(body, {
          client,
          colis,
          destination: getClientDest(clientId, clients),
          settings,
        });
      const template = MSG_TEMPLATES[key];
      return template
        ? canal === 'telegram'
          ? template.telegram(client, colis)
          : template.email(client, colis)
        : '';
    },
    [clients, messageTemplates, settings],
  );
  const sendMsg = useCallback(
    async (colisId, clientId, canal, key, customMsg, options = {}) => {
      try {
        requireReady();
        const client = clients.find((c) => c.id === clientId);
        if (!client) throw new Error('Client introuvable.');
        const text = customMsg ?? getPreview(key, clientId, colisId, canal);
        if (!text?.trim()) throw new Error('Le message est vide.');
        const isDecision = ['demande_feu_vert', 'relance_feu_vert'].includes(key);
        const buttons =
          options.buttons ||
          (isDecision
            ? [
                [{ text: 'Autoriser la préparation', callback_data: `fv_oui_${colisId}` }],
                [
                  { text: 'Attendre mes autres colis', callback_data: `fv_wait_${colisId}` },
                  { text: 'Refuser', callback_data: `fv_non_${colisId}` },
                ],
              ]
            : null);
        const actualCanal = canal === 'telegram' && !client.telegramChatId ? 'portal' : canal;
        const { data: queued, error } = await supabase.rpc('queue_message', {
          p_colis_id: colisId,
          p_text: text,
          p_template: key || null,
          p_idempotency_key: options.idempotencyKey || randomId(),
          p_reply_markup: buttons ? { inline_keyboard: buttons } : null,
          p_canal: actualCanal,
        });
        if (error) throw error;
        await refreshColis(colisId);
        const messageId = queued.message?.id || queued.message_id;
        let delivered = false;
        if (actualCanal === 'telegram') {
          const result = await deliverMessage(colisId, messageId);
          delivered = result.ok;
          if (!result.ok)
            throw new Error(
              result.error ||
                'Message conservé dans la file d’envoi ; livraison Telegram à réessayer.',
            );
        }
        if (actualCanal === 'email' && client.email) {
          window.open(mailtoLink(client.email, text), '_blank', 'noopener,noreferrer');
          flash({
            msg: 'Brouillon ouvert dans votre messagerie. L’envoi doit être confirmé dans votre application email.',
            type: 'info',
          });
        } else
          flash(
            delivered
              ? 'Message livré à Telegram'
              : 'Message disponible dans l’espace client. Telegram n’est pas encore relié.',
          );
        setComLog((prev) => [
          {
            id: messageId,
            colisId,
            clientId,
            canal: actualCanal,
            template: key,
            msg: text,
            date: new Date().toISOString(),
            user: auth?.u?.nom,
          },
          ...prev,
        ]);
        await refreshColis(colisId);
        return { ok: true, delivered, messageId };
      } catch (error) {
        throw reportError(error);
      }
    },
    [requireReady, clients, getPreview, refreshColis, auth, flash, reportError],
  );
  const changerStatut = useCallback(
    async (id, status) => {
      if (!STATUTS[status]) throw reportError(new Error('Statut non reconnu.'));
      await upd(id, { statut: status });
      flash(STATUTS[status].label);
      return true;
    },
    [upd, flash, reportError],
  );
  const receptionner = useCallback(
    async (id, casier, notify) => {
      if (!casier?.trim()) throw reportError(new Error('Numéro de casier obligatoire.'));
      const saved = await upd(id, {
        statut: 'receptionne',
        casier: casier.trim(),
        dateReception: new Date().toISOString(),
      });
      if (notify) await sendMsg(id, saved.clientId, 'telegram', 'reception');
      else flash('Réception enregistrée');
      return true;
    },
    [upd, sendMsg, flash, reportError],
  );
  const revertStatut = useCallback(
    async (id) => {
      const current = dataRef.current.find((c) => c.id === id);
      const { data: row, error } = await supabase.rpc('revert_colis', {
        p_colis_id: id,
        p_expected_updated_at: current?.updatedAt || null,
      });
      if (error) throw reportError(error);
      await refreshColis(id);
      flash('Étape précédente rétablie. L’historique est conservé.');
      return row;
    },
    [refreshColis, reportError, flash],
  );
  const annulerColis = useCallback((id) => changerStatut(id, 'annule'), [changerStatut]);
  const archiverColis = useCallback(
    async (id) => {
      await upd(id, { archive: true });
      flash('Colis archivé');
    },
    [upd, flash],
  );
  const desarchiverColis = useCallback(
    async (id) => {
      await upd(id, { archive: false });
      flash('Colis restauré');
    },
    [upd, flash],
  );
  const demanderFeuVert = useCallback(
    async (id) => {
      const c = dataRef.current.find((c) => c.id === id);
      if (!c || !hasCompleteReceptionMeasurements(c))
        throw reportError(new Error('Renseignez les dimensions et le poids à réception de chaque carton, avant optimisation, avant de demander l’accord du client.'));
      await upd(id, { statut: 'attente_feu_vert', feuVert: 'en_attente' });
      return true;
    },
    [upd, reportError],
  );
  const feuVert = useCallback(
    async (id, ok, options = {}) => {
      const c = dataRef.current.find((c) => c.id === id);
      const { data: row, error } = await supabase.rpc('client_decision', {
        p_colis_id: id,
        p_action: ok === 'wait' ? 'wait' : ok ? 'approve' : 'refuse',
        p_expected_updated_at: options.expectedUpdatedAt ?? c?.updatedAt ?? null,
        p_wait_until: options.waitUntil || null,
        p_reason: options.reason || null,
      });
      if (error) throw reportError(error);
      if (row) replaceColis(sb.mapColis(Array.isArray(row) ? row[0] : row));
      await refreshColis(id);
      setEnvois(await sb.fetchEnvois());
      flash(
        ok === 'wait'
          ? 'Votre demande d’attente est enregistrée.'
          : ok
            ? 'Accord enregistré pour ce dossier.'
            : 'Refus enregistré.',
      );
      return true;
    },
    [replaceColis, refreshColis, flash, reportError],
  );
  const feuVertBulk = useCallback(
    async (ids, options = {}) => {
      const results = await Promise.allSettled(
        ids.map((id) => feuVert(id, true, { expectedUpdatedAt: options.expectedVersions?.[id] })),
      );
      const count = results.filter((r) => r.status === 'fulfilled').length;
      flash({
        msg: `${count}/${ids.length} dossiers autorisés`,
        type: count === ids.length ? 'success' : 'warning',
      });
      return count;
    },
    [feuVert, flash],
  );
  const envoyerDevis = useCallback(
    async (id, changes = {}) => {
      const current = dataRef.current.find((c) => c.id === id);
      if (!current) throw new Error('Dossier introuvable.');
      const colis = { ...current, ...changes };
      const client = clients.find((c) => c.id === colis.clientId);
      const destination = getClientDest(colis.clientId, clients);
      const result = calculateQuote({
        colis,
        client,
        destination,
        tarif: tarifs[destination?.code],
        categories,
        settings,
      });
      if (!result.ok) throw reportError(new Error(result.errors.map((e) => e.message).join('\n')));
      const snapshot = {
        ...result.snapshot,
        ...result.patch,
        finL: colis.finL,
        finW: colis.finW,
        finH: colis.finH,
        finP: colis.finP,
      };
      const { data: saved, error } = await supabase.rpc('save_quote', {
        p_colis_id: id,
        p_snapshot: {
          ...snapshot,
          fraisDivers: colis.fraisDivers || [],
          poidsFact: result.patch.poidsFact,
          modePaiementPro: colis.modePaiementPro || null,
        },
        p_expected_updated_at: current.updatedAt || null,
      });
      if (error) throw reportError(error);
      if (saved.colis) replaceColis(sb.mapColis(saved.colis));
      await refreshColis(id);
      flash(`Devis enregistré : ${eur(result.amounts.total)}. Vérifiez puis envoyez.`);
      return true;
    },
    [clients, tarifs, categories, settings, reportError, replaceColis, refreshColis, flash],
  );
  const confirmerDevis = useCallback(
    async (id, options = {}) => {
      const c = await refreshColis(id);
      if (!c?.devisTotal || !c.quoteVersion)
        throw reportError(new Error('Calculez et enregistrez le devis avant son envoi.'));
      const client = clients.find((client) => client.id === c.clientId);
      const destination = getClientDest(c.clientId, clients);
      const fresh = calculateQuote({
        colis: c,
        client,
        destination,
        tarif: tarifs[destination.code],
        categories,
        settings,
      });
      if (
        !fresh.ok ||
        quoteInputFingerprint(fresh.snapshot) !== quoteInputFingerprint(c.devisSnapshot)
      )
        throw reportError(
          new Error(
            'Les informations du dossier ont changé. Recalculez et vérifiez le devis avant son envoi.',
          ),
        );
      let payment = {};
      if (client?.type !== 'pro') {
        const result = await supabase.functions.invoke('payplug-create', { body: { colisId: id } });
        if (result.error || result.data?.error)
          throw reportError(new Error(await functionErrorMessage(result, 'Paiement indisponible. Le brouillon du devis est conservé et aucun message n’a été envoyé.')));
        payment = result.data;
      } else if (!['virement', 'especes', '30_jours', 'fin_de_mois'].includes(c.modePaiementPro)) {
        throw reportError(
          new Error('Choisissez les modalités de règlement professionnel avant l’envoi.'),
        );
      }
      const refreshed = await refreshColis(id);
      if (
        refreshed.devisBrouillon ||
        !['devis_envoye', 'attente_paiement'].includes(refreshed.statut)
      )
        await upd(id, {
          statut: refreshed.statut === 'attente_paiement' ? 'attente_paiement' : 'devis_envoye',
          devisBrouillon: false,
        });
      const canal = options.canal || 'telegram';
      const paymentUrl = payment.paymentUrl || payment.url || refreshed.payplugPaymentUrl;
      const preview = getPreview('devis_final', c.clientId, id, canal);
      const message =
        options.message ||
        `${preview}${paymentUrl && !preview.includes(paymentUrl) ? `\n\nPayer ce devis : ${paymentUrl}` : ''}`;
      await sendMsg(id, c.clientId, canal, 'devis_final', message, {
        idempotencyKey: `quote:${id}:${c.quoteVersion}:${canal}`,
      });
      return true;
    },
    [clients, tarifs, categories, settings, refreshColis, upd, getPreview, sendMsg, reportError],
  );
  const payer = useCallback(
    async (id, amount) => {
      const { error } = await supabase.rpc('mark_manual_payment', {
        p_colis_id: id,
        p_amount: Number(amount),
      });
      if (error) throw reportError(error);
      await refreshColis(id);
      flash('Paiement enregistré');
      return true;
    },
    [refreshColis, flash, reportError],
  );
  const envMsg = useCallback(
    async (id, text, identity) => {
      if (!text.trim()) return false;
      const c = dataRef.current.find((c) => c.id === id);
      if (identity.type === 'staff') return sendMsg(id, c.clientId, 'telegram', null, text);
      await sb.insertMessage(id, {
        type: 'client',
        auteur: authCl?.nom || 'Client',
        auteurId: auth.session.user.id,
        texte: text.trim(),
      });
      await refreshColis(id);
      return true;
    },
    [sendMsg, authCl, auth, refreshColis],
  );
  const value = {
    auth,
    setAuth,
    authLoading,
    authError,
    dataLoading,
    dataError,
    retryLoad,
    signIn,
    signOut,
    passwordRecovery,
    completePasswordRecovery,
    isStaff,
    authCl,
    authRole,
    sbReady,
    can,
    data,
    setData,
    clients,
    setClients,
    categories,
    setCategories,
    tarifs,
    setTarifs,
    envois,
    setEnvois,
    logs,
    inboxItems,
    refreshInbox,
    teamUsers,
    loadArchives,
    archivesLoaded,
    settings,
    saveSettings,
    messageTemplates,
    saveMessageTemplate,
    produitsInterdits,
    setProduitsInterdits,
    comLog,
    sendMsg,
    getPreview,
    notifs,
    unreadNotifs,
    markNotifRead,
    markAllNotifsRead,
    selId,
    setSelId,
    sel,
    selClient,
    selDest,
    toast,
    setToast,
    page,
    setPage,
    clientTab,
    setClientTab,
    colisFilter,
    setColisFilter,
    cfm,
    setCfm,
    flash,
    ask,
    closeConfirm,
    upd,
    log,
    getClient,
    getTarif,
    updateClient,
    addNewClient,
    deleteClient,
    addCategory,
    updateCatTaux,
    updateCatLabel,
    deleteCategory,
    receptionner,
    changerStatut,
    revertStatut,
    annulerColis,
    archiverColis,
    desarchiverColis,
    demanderFeuVert,
    feuVert,
    feuVertBulk,
    envoyerDevis,
    confirmerDevis,
    payer,
    envMsg,
    refreshColis,
    theme,
    toggleTheme,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

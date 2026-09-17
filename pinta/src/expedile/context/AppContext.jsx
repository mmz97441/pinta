import { clearDrafts } from '../lib/draftStore';
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
  const [adminSettingsBaseline, setAdminSettingsBaseline] = useState({});
  const [messageTemplates, setMessageTemplates] = useState({});
  const [produitsInterdits, setProduitsInterditsState] = useState(PRODUITS_INTERDITS);
  const [notifs, setNotifs] = useState([]);
  const [comLog, setComLog] = useState([]);
  const [inboxItems, setInboxItems] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [workActions, setWorkActions] = useState([]);
  const [workPreferences, setWorkPreferences] = useState([]);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState('');
  const workSequence = useRef(0);
  const [notificationTotal, setNotificationTotal] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const notificationLimit = useRef(50);
  const notificationSequence = useRef(0);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [selId, setSelId] = useState(null);
  const [toast, setToast] = useState('');
  const [page, setPage] = useState('home');
  const [clientTab, setClientTab] = useState('accueil');
  const [colisFilter, setColisFilter] = useState(null);
  const [cfm, setCfm] = useState(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  const authRef = useRef(auth);
  const staffAccessSequence = useRef(0);
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
    if (token !== generation.current) return;
    if (!rows[0]) {
      dataRef.current = dataRef.current.filter((c) => c.id !== id);
      setData(dataRef.current);
      return;
    }
    const current = dataRef.current.find((c) => c.id === id);
    // A delayed background read must not replace a more recent saved edit.
    if (Date.parse(current?.updatedAt) > Date.parse(rows[0].updatedAt)) return current;
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
  const refreshWork = useCallback(async () => {
    if (authRef.current?.type !== 'staff') return;
    const token = generation.current;
    const sequence = ++workSequence.current;
    setWorkLoading(true);
    try {
      const result = await sb.fetchStaffWork();
      if (token !== generation.current || sequence !== workSequence.current) return;
      setWorkActions(result.actions); setWorkPreferences(result.preferences); setWorkError('');
      return result;
    } catch (error) {
      if (token === generation.current && sequence === workSequence.current) setWorkError(error.message);
      throw error;
    } finally {
      if (token === generation.current && sequence === workSequence.current) setWorkLoading(false);
    }
  }, []);
  const mutateWorkAction = useCallback(async (action, command, payload = {}) => {
    const token = generation.current;
    const saved = await sb.mutateStaffWorkAction(action, command, payload);
    if (token !== generation.current) return saved;
    ++workSequence.current;
    setWorkActions((previous) => previous.some((item) => item.id === saved.id)
      ? previous.map((item) => item.id === saved.id ? saved : item) : [...previous, saved]);
    setWorkLoading(false);
    setWorkError('');
    return saved;
  }, []);
  const saveWorkPreferences = useCallback(async (changes, { expectedVersion = null } = {}) => {
    const token = generation.current;
    const saved = await sb.saveStaffWorkPreferences(changes, expectedVersion);
    if (token !== generation.current) return saved;
    ++workSequence.current;
    setWorkPreferences((previous) => [...previous.filter((row) => row.staff_id !== saved.staff_id), saved]);
    setWorkLoading(false);
    return saved;
  }, []);
  const refreshNotifications = useCallback(async () => {
    const identity = authRef.current;
    if (!identity?.session?.user?.id) return;
    const token = generation.current;
    const sequence = ++notificationSequence.current;
    setNotificationsLoading(true);
    try {
      const result = await sb.fetchNotificationPage(identity.session.user.id, notificationLimit.current);
      if (token !== generation.current || sequence !== notificationSequence.current) return;
      setNotifs(result.rows); setNotificationTotal(result.total); setUnreadNotifs(result.unread); setNotificationsError('');
    } catch (error) {
      if (token === generation.current && sequence === notificationSequence.current) setNotificationsError(error.message);
      throw error;
    } finally {
      if (token === generation.current && sequence === notificationSequence.current) setNotificationsLoading(false);
    }
  }, []);
  const loadMoreNotifications = useCallback(async () => {
    if (notificationsLoading) return;
    notificationLimit.current += 50;
    await refreshNotifications();
  }, [notificationsLoading, refreshNotifications]);
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
          sb.fetchNotificationPage(identity.session.user.id),
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
      notificationLimit.current = 50;
      setNotifs(notifications.rows); setNotificationTotal(notifications.total); setUnreadNotifs(notifications.unread);
      setSettings(configuration.settings.business || {});
      setAdminSettingsBaseline(configuration.settings);
      setMessageTemplates(configuration.templates);
      setProduitsInterditsState(configuration.settings.produits_interdits || PRODUITS_INTERDITS);
      if (identity.type === 'staff') {
        const [inbox, team, work] = await Promise.all([
          sb.fetchAllRows('client_inbox', (q) => q.eq('status', 'unassigned')),
          sb.fetchStaffUsers(),
          sb.fetchStaffWork(),
        ]);
        if (token !== generation.current) return;
        setInboxItems(inbox);
        setTeamUsers(team);
        setWorkActions(work.actions); setWorkPreferences(work.preferences); setWorkError('');
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
        setWorkActions([]); setWorkPreferences([]); setWorkError(''); setWorkLoading(false);
        setNotificationTotal(0); setUnreadNotifs(0); setNotificationsError(''); setNotificationsLoading(false);
        notificationLimit.current = 50;
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
      if (event === 'SIGNED_OUT') clearDrafts();
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
    clearDrafts();
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
  const refreshStaffAccess = useCallback(async () => {
    const identity = authRef.current;
    if (identity?.type !== 'staff') return [];
    const token = generation.current;
    const sequence = ++staffAccessSequence.current;
    const users = await sb.fetchStaffUsers();
    if (token !== generation.current || sequence !== staffAccessSequence.current
      || authRef.current?.u?.id !== identity.u.id) return users;
    const me = users.find((user) => user.authId === identity.u.id);
    if (!me || me.actif === false) {
      await establishSession(null);
      setAuthError('Votre accès équipe a été désactivé. Contactez la direction.');
      return users;
    }
    setTeamUsers(users);
    setAuth((current) => current?.type === 'staff' && current.u.id === identity.u.id ? {
      ...current,
      u: {
        ...current.u,
        staffId: me.id,
        role: me.role,
        nom: me.nom,
        prenom: me.prenom || '',
        mustChangePassword: me.mustChangePassword,
        permissions: me.permissions,
      },
    } : current);
    return users;
  }, [establishSession]);
  // Another director may change access while this staff session remains open.
  // Realtime updates are backed by focus/visibility and a visible-page refresh.
  useEffect(() => {
    if (!sbReady || auth?.type !== 'staff') return;
    let timer;
    let stopped = false;
    let busy = false;
    let warned = false;
    const refreshVisible = async () => {
      if (document.visibilityState !== 'visible' || busy || stopped) return;
      busy = true;
      try {
        await refreshStaffAccess();
        warned = false;
      } catch (error) {
        if (!stopped && !warned) {
          warned = true;
          reportError(new Error(`Actualisation des accès indisponible : ${error.message}`));
        }
      } finally { busy = false; }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refreshVisible, 150);
    };
    const channel = supabase.channel(`staff-access-${auth.u.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_permissions' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_users' }, schedule)
      .subscribe();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    const interval = setInterval(refreshVisible, 60000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
      supabase.removeChannel(channel);
    };
  }, [sbReady, auth?.type, auth?.u?.id, refreshStaffAccess, reportError]);
  useEffect(() => {
    if (!sbReady || auth?.type !== 'staff') return;
    let stopped = false;
    let busy = false;
    let timer;
    const refresh = async () => {
      if (stopped || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try { await refreshWork(); } catch { /* The workspace shows a persistent retryable error. */ }
      finally { busy = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
    const channel = supabase.channel(`staff-work-${auth.u.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_work_actions' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_work_preferences' }, schedule)
      .subscribe();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    const interval = setInterval(refresh, 60000);
    return () => {
      stopped = true; clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('focus', schedule); document.removeEventListener('visibilitychange', schedule);
      supabase.removeChannel(channel);
    };
  }, [sbReady, auth?.type, auth?.u?.id, refreshWork]);
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
            setAdminSettingsBaseline(config.settings);
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
        refreshNotifications().catch(reportError);
        if (payload.new?.colis_id) refreshColis(payload.new.colis_id).catch(reportError);
      }),
    ];
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [sbReady, auth?.session.user.id, refreshColis, refreshInbox, refreshNotifications, reportError]);
  // Realtime can miss events during sleep or a network interruption. Reconcile
  // the shared staff list without downloading every dossier's relations again.
  useEffect(() => {
    if (!sbReady || auth?.type !== 'staff') return;
    const token = generation.current;
    let stopped = false;
    let busy = false;
    let timer;
    const refreshVisible = async () => {
      if (stopped || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const index = await sb.fetchAllRows('colis', (q) => q.eq('archive', false), 'id', 'id,updated_at,client_id');
        if (stopped || token !== generation.current) return;
        const known = new Map(dataRef.current.map((c) => [c.id, c]));
        const activeIds = new Set(index.map((c) => c.id));
        const changedIds = index.filter((c) => !known.has(c.id) || known.get(c.id).updatedAt !== c.updated_at).map((c) => c.id);
        // An active dossier missing from the index may have been archived or removed.
        for (const c of known.values()) if (!c.archive && !activeIds.has(c.id)) changedIds.push(c.id);
        const knownClients = new Set(clientsRef.current.map((c) => c.id));
        const missingClients = [...new Set(index.map((c) => c.client_id).filter((id) => id && !knownClients.has(id)))];
        for (let i = 0; i < missingClients.length; i += 100) {
          const rows = await sb.fetchAllRows('clients', (q) => q.in('id', missingClients.slice(i, i + 100)));
          if (stopped || token !== generation.current) return;
          setClients((previous) => {
            const merged = new Map(previous.map((c) => [c.id, c]));
            rows.forEach((row) => merged.set(row.id, sb.mapClient(row)));
            return [...merged.values()];
          });
        }
        // Bound concurrent detail requests, including the first catch-up after a long absence.
        let cursor = 0;
        const workers = Array.from({ length: Math.min(3, changedIds.length) }, async () => {
          while (!stopped && token === generation.current && cursor < changedIds.length) {
            await refreshColis(changedIds[cursor++]);
          }
        });
        const results = await Promise.allSettled(workers);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
        if (!stopped && token === generation.current) {
          setDataError((previous) => previous.startsWith('Actualisation des dossiers impossible') ? '' : previous);
        }
      } catch (error) {
        if (!stopped && token === generation.current) setDataError(`Actualisation des dossiers impossible : ${error.message}`);
      } finally { busy = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refreshVisible, 150); };
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    const interval = setInterval(refreshVisible, 60000);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [sbReady, auth?.type, auth?.session.user.id, refreshColis]);
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
  const saveCategory = useCallback(async (id, values, expected) => {
    requireReady();
    const saved = await sb.saveAdminCategory(id, values, expected);
    setCategories(previous => id ? previous.map(cat => cat.id === id ? { ...cat, ...saved } : cat) : [...previous, { ...saved, custom: true }]);
    return saved;
  }, [requireReady]);
  const addCategory = useCallback(async (label, taux = {}) => (await saveCategory(null, { label, codeHs: '', taux }, null)).id, [saveCategory]);
  const updateCatTaux = useCallback(async (catId, code, field, value) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat?.taux?.[code]) throw new Error('Renseignez et enregistrez les deux taux de cette destination depuis les paramètres.');
    const expected = { label: cat.label, codeHs: cat.codeHs || '', taux: cat.taux };
    return saveCategory(catId, { ...expected, taux: { ...cat.taux, [code]: { ...cat.taux[code], [field]: Number(value) } } }, expected);
  }, [categories, saveCategory]);
  const updateCatLabel = useCallback(async (id, label) => {
    const cat = categories.find(c => c.id === id);
    const expected = { label: cat.label, codeHs: cat.codeHs || '', taux: cat.taux };
    return saveCategory(id, { ...expected, label }, expected);
  }, [categories, saveCategory]);
  const saveTariffs = useCallback(async (values, expected) => {
    requireReady(); const saved = await sb.saveAdminTariffs(values, expected); setTarifs(saved); return saved;
  }, [requireReady]);
  const deleteCategory = useCallback(async id => {
    const category = categories.find(cat => cat.id === id);
    if (!category) throw new Error('Catégorie introuvable. Rechargez les paramètres.');
    await sb.deleteAdminCategory(id, { label: category.label, codeHs: category.codeHs || '', taux: category.taux });
    setCategories(previous => previous.filter(cat => cat.id !== id));
    flash('Catégorie supprimée');
  }, [categories, flash]);
  const saveSettings = useCallback(async (values, expected = adminSettingsBaseline.business ?? null) => {
    const saved = await sb.saveSetting('business', values, expected);
    setSettings(saved); setAdminSettingsBaseline(previous => ({ ...previous, business: saved }));
    return saved;
  }, [adminSettingsBaseline]);
  const saveMessageTemplate = useCallback(async (key, canal, body, expected = messageTemplates[`${key}_${canal}`] ?? null) => {
    const saved = await sb.saveTemplate(key, canal, body, expected);
    setMessageTemplates(previous => ({ ...previous, [`${key}_${canal}`]: saved }));
    return saved;
  }, [messageTemplates]);
  const setProduitsInterdits = useCallback(async value => {
    const next = typeof value === 'function' ? value(produitsInterdits) : value;
    const saved = await sb.saveSetting('produits_interdits', next, adminSettingsBaseline.produits_interdits ?? null);
    setProduitsInterditsState(saved); setAdminSettingsBaseline(previous => ({ ...previous, produits_interdits: saved }));
  }, [produitsInterdits, adminSettingsBaseline]);
  const markNotifRead = useCallback(async (id) => {
    const token = generation.current;
    await sb.markNotifRead(id);
    if (token !== generation.current) return;
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, lu: true } : n)));
    await refreshNotifications();
  }, [refreshNotifications]);
  const markAllNotifsRead = useCallback(async () => {
    if (!auth) return;
    const token = generation.current;
    await sb.markAllNotifsRead(auth.session.user.id);
    if (token !== generation.current) return;
    setNotifs((prev) => prev.map((n) => ({ ...n, lu: true })));
    await refreshNotifications();
  }, [auth, refreshNotifications]);
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
        if (actualCanal === 'portal' && !client.userId) throw new Error('Le client n’a pas encore accès au portail ni à Telegram. Ouvrez sa fiche pour activer son accès ou préparer un email.');
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
    async (id, changes = {}, { expectedUpdatedAt } = {}) => {
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
        finalPackages: colis.finalPackages || [],
        preparationCompositionVersion: colis.preparationCompositionVersion,
      };
      const { data: saved, error } = await supabase.rpc('save_quote', {
        p_colis_id: id,
        p_snapshot: {
          ...snapshot,
          fraisDivers: colis.fraisDivers || [],
          poidsFact: result.patch.poidsFact,
          modePaiementPro: colis.modePaiementPro || null,
        },
        p_expected_updated_at: expectedUpdatedAt ?? current.updatedAt ?? null,
      });
      if (error) throw reportError(error);
      if (!saved?.colis) throw new Error('Le devis n’a pas été confirmé par le serveur. Rechargez le dossier.');
      const canonical = replaceColis(sb.mapColis(saved.colis));
      let reloaded;
      try { reloaded = await refreshColis(id); }
      catch (refreshError) {
        flash({ msg: `Devis enregistré. Actualisation à réessayer : ${refreshError.message}`, type: 'warning' });
        return canonical;
      }
      flash(`Devis enregistré : ${eur(result.amounts.total)}. Vérifiez puis envoyez.`);
      return reloaded || canonical;
    },
    [clients, tarifs, categories, settings, reportError, replaceColis, refreshColis, flash],
  );
  const savePreparationMeasurements = useCallback(async (id, changes, { expectedUpdatedAt, expectedCompositionVersion } = {}) => {
    if (!expectedUpdatedAt || !Number.isInteger(expectedCompositionVersion)) throw new Error('Rechargez le dossier avant d’enregistrer les mesures.');
    const { data: saved, error } = await supabase.rpc('save_preparation_measurements', {
      p_colis_id: id,
      p_final_packages: changes.finalPackages,
      p_expected_updated_at: expectedUpdatedAt,
      p_expected_composition_version: expectedCompositionVersion,
    });
    if (error) throw error;
    if (!saved?.colis) throw new Error('Les mesures n’ont pas été confirmées. Rechargez le dossier.');
    const result = replaceColis(sb.mapColis(saved.colis));
    refreshWork().catch(() => {});
    return result;
  }, [replaceColis, refreshWork]);
  const assignDeparture = useCallback(async (colis, envoiId) => {
    const { data: row, error } = await supabase.rpc('assign_colis_departure', {
      p_colis_id: colis.id, p_envoi_id: envoiId || null, p_expected_updated_at: colis.updatedAt,
    });
    if (error) throw error;
    const canonical = Array.isArray(row) ? row[0] : row;
    if (!canonical?.id) throw new Error('Affectation non confirmée. Actualisez le dossier.');
    const saved = replaceColis(sb.mapColis(canonical));
    refreshWork().catch(() => {});
    return saved;
  }, [replaceColis, refreshWork]);
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
    async (id, text, identity, options = {}) => {
      if (!text.trim()) return false;
      const c = dataRef.current.find((c) => c.id === id);
      if (identity.type === 'staff') return sendMsg(id, c.clientId, options.channel || 'telegram', null, text, { idempotencyKey: options.idempotencyKey });
      // A stable client-generated primary key makes a lost insert response
      // retryable too; RLS still checks dossier ownership and the author.
      const row = {
        id: options.idempotencyKey || randomId(),
        colis_id: id,
        type: 'client',
        auteur_nom: authCl?.nom || 'Client',
        auteur_id: auth.session.user.id,
        texte: text.trim(),
      };
      const { error } = await supabase.from('messages').insert(row);
      if (error) {
        if (error.code !== '23505') throw error;
        const { data: existing, error: readError } = await supabase.from('messages').select('id,colis_id,type,auteur_id,texte').eq('id', row.id).single();
        if (readError || !existing || existing.colis_id !== id || existing.type !== 'client' || existing.auteur_id !== row.auteur_id || existing.texte !== row.texte) throw error;
      }
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
    workActions,
    workPreferences,
    workLoading,
    workError,
    refreshWork,
    mutateWorkAction,
    saveWorkPreferences,
    refreshStaffAccess,
    loadArchives,
    archivesLoaded,
    settings,
    saveSettings,
    adminSettingsBaseline,
    saveCategory,
    saveTariffs,
    messageTemplates,
    saveMessageTemplate,
    produitsInterdits,
    setProduitsInterdits,
    comLog,
    sendMsg,
    getPreview,
    notifs,
    notificationsHasMore: notifs.length < notificationTotal,
    notificationsLoading,
    notificationsError,
    refreshNotifications,
    loadMoreNotifications,
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
    savePreparationMeasurements,
    assignDeparture,
    confirmerDevis,
    payer,
    envMsg,
    refreshColis,
    theme,
    toggleTheme,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

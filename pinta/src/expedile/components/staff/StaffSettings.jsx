import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plane,
  CreditCard,
  FileText,
  Trash2,
  Lock,
  MessageCircle,
  Loader2,
  ShieldAlert,
  Plus,
  Archive,
  Save,
  Download,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DESTINATIONS } from '../../constants';
import { eur } from '../../utils';
import TemplateEditor from './TemplateEditor';
import StaffPermissions from './StaffPermissions';
import * as sb from '../../lib/supabaseData';

const DESTINATION_LIST = Object.values(DESTINATIONS);
const FIELD =
  'min-h-[44px] w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm';
const BUTTON =
  'min-h-[44px] rounded-xl px-4 py-2 font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50';
const PANELS = [
  ['planning', 'Départs', Plane],
  ['tarifs', 'Tarifs', CreditCard],
  ['categories', 'Catégories', FileText],
  ['users', 'Équipe et accès', Lock],
  ['telegram', 'Telegram', MessageCircle],
  ['templates', 'Messages', MessageCircle],
  ['metier', 'Règles métier', FileText],
  ['interdits', 'Produits interdits', ShieldAlert],
];
export default function StaffSettings() {
  const navigate = useNavigate();
  const {
    envois,
    setEnvois,
    data,
    clients,
    tarifs,
    setTarifs,
    categories,
    addCategory,
    updateCatTaux,
    updateCatLabel,
    deleteCategory,
    flash,
    ask,
    produitsInterdits,
    setProduitsInterdits,
    authRole,
    sbReady,
    settings,
    saveSettings,
    setCategories,
  } = useApp();
  const [tab, setTab] = useState('planning');
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [destination, setDestination] = useState('974');
  const [weeks, setWeeks] = useState(4);
  const [archived, setArchived] = useState(false);
  const [tarifDraft, setTarifDraft] = useState(tarifs);
  const [businessDraft, setBusinessDraft] = useState(settings);
  const [newCategory, setNewCategory] = useState('');
  const [newInterdit, setNewInterdit] = useState('');
  const director = ['directeur', 'vice_directeur'].includes(authRole);
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      flash({ msg: error.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const refreshDepartures = async () => setEnvois(await sb.fetchEnvois());
  const createDepartures = async (count) => {
    if (!date) throw new Error('Choisissez une date de départ.');
    let created = 0;
    for (let n = 0; n < count; n++) {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n * 7);
      const target = d.toISOString().slice(0, 10);
      if (
        envois.some(
          (e) => e.date === target && e.destinationCode === destination && e.statut !== 'archive',
        )
      )
        continue;
      await sb.insertEnvoi({ date: target, destinationCode: destination, statut: 'planifie' });
      created++;
    }
    await refreshDepartures();
    flash(`${created} départ${created > 1 ? 's' : ''} enregistré${created > 1 ? 's' : ''}`);
  };
  const updateDeparture = async (id, statut) => {
    await sb.updateEnvoi(id, { statut });
    await refreshDepartures();
    flash('Départ mis à jour');
  };
  const exportDeparture = async (envoi, type) => {
    const colis = data.filter((c) => c.envoi === envoi.id);
    if (!colis.length) throw new Error('Aucun colis rattaché à ce départ.');
    if (type === 'manifest') {
      const { exportColisExcel } = await import('../../utils/exportExcel');
      exportColisExcel(colis, clients);
    }
    if (type === 'invoice') {
      const { exportFactureCommerciPDF } = await import('../../utils/exportFactureCommerciPDF');
      exportFactureCommerciPDF(envoi, colis, clients, categories);
    }
    if (type === 'dau') {
      const { exportDAUData } = await import('../../utils/exportDAU');
      exportDAUData(envoi, colis, clients, categories);
    }
  };
  const saveBusiness = async () => {
    for (const key of ['fraisStockage', 'stockageGratuit', 'diviseurVolumetrique']) {
      const value = Number(businessDraft[key]);
      if (!Number.isFinite(value) || value < 0 || (key === 'diviseurVolumetrique' && value === 0))
        throw new Error(`Valeur invalide : ${key}`);
    }
    for (const key of ['relancesFeuVert', 'relancesPaiement']) {
      if (!/^\s*J\+\d+(\s*,\s*J\+\d+)*\s*$/.test(businessDraft[key] || ''))
        throw new Error('Écrivez les échéances sous la forme J+2, J+5, J+7.');
    }
    await saveSettings({ ...businessDraft, timezone: 'Europe/Paris' });
  };
  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500">Configuration partagée</p>
          <h1 className="text-2xl font-bold">Paramètres</h1>
        </div>
        <button className={BUTTON + ' bg-gray-100 dark:bg-gray-800'} onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          Retour
        </button>
      </header>
      <div className="flex flex-col md:flex-row gap-6">
        <nav
          aria-label="Paramètres"
          className="md:w-52 shrink-0 flex md:flex-col gap-1 overflow-x-auto"
        >
          {PANELS.filter(([key]) => director || ['planning', 'telegram'].includes(key)).map(
            ([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={
                  BUTTON +
                  ` shrink-0 whitespace-nowrap justify-start ${tab === key ? 'bg-[#17324D] text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`
                }
              >
                <Icon size={17} />
                {label}
              </button>
            ),
          )}
        </nav>
        <main className="flex-1 min-w-0 space-y-4" aria-busy={busy}>
          {!sbReady && (
            <p role="alert" className="rounded-xl p-4 bg-amber-50 text-amber-800">
              Connexion nécessaire pour enregistrer les modifications.
            </p>
          )}
          {tab === 'planning' && (
            <>
              <section className="card p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-bold">Planifier les départs</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Choisissez la destination, le premier départ et le nombre de semaines à planifier.
                  </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="text-sm">
                    Premier départ
                    <input
                      className={FIELD + ' mt-1'}
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Destination
                    <select
                      className={FIELD + ' mt-1'}
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    >
                      {DESTINATION_LIST.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Nombre de semaines
                    <select
                      className={FIELD + ' mt-1'}
                      value={weeks}
                      onChange={(e) => setWeeks(Number(e.target.value))}
                    >
                      {[1, 2, 4, 8].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className={BUTTON + ' bg-[#17324D] text-white'}
                  disabled={busy || !sbReady || !date}
                  onClick={() => run(() => createDepartures(weeks))}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Créer{' '}
                  {weeks === 1 ? 'le départ' : `les ${weeks} départs`}
                </button>
              </section>
              <div className="flex justify-between items-center">
                <h2 className="font-bold">
                  {archived ? 'Historique archivé' : 'Départs en cours'}
                </h2>
                <button
                  className={BUTTON + ' text-gray-500'}
                  onClick={() => setArchived(!archived)}
                >
                  <Archive size={16} />
                  {archived ? 'Voir les départs actifs' : 'Voir les archives'}
                </button>
              </div>
              {envois
                .filter((e) => (e.statut === 'archive') === archived)
                .map((envoi) => {
                  const parcels = data.filter((c) => c.envoi === envoi.id);
                  const dest = DESTINATION_LIST.find((d) => d.code === envoi.destinationCode);
                  return (
                    <article key={envoi.id} className="card p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold">
                            {new Date(`${envoi.date}T12:00:00`).toLocaleDateString('fr-FR', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                            })}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {dest?.label || 'Destination à renseigner'} · {parcels.length} dossier
                            {parcels.length > 1 ? 's' : ''}
                          </p>
                        </div>
                        {!archived ? (
                          <select
                            aria-label={`Statut départ ${envoi.date}`}
                            className={FIELD + ' !w-auto'}
                            value={envoi.statut}
                            disabled={busy}
                            onChange={(e) => run(() => updateDeparture(envoi.id, e.target.value))}
                          >
                            {['planifie', 'en_preparation', 'pret', 'parti', 'arrive'].map(
                              (status) => (
                                <option key={status} value={status}>
                                  {
                                    {
                                      planifie: 'Planifié',
                                      en_preparation: 'En préparation',
                                      pret: 'Prêt',
                                      parti: 'Parti',
                                      arrive: 'Arrivé',
                                    }[status]
                                  }
                                </option>
                              ),
                            )}
                          </select>
                        ) : (
                          <span className="text-xs text-gray-500">Archivé</span>
                        )}
                      </div>
                      {!envoi.destinationCode && !archived && (
                        <label className="block text-sm text-amber-700">
                          Compléter la destination
                          <select
                            className={FIELD + ' mt-1'}
                            value=""
                            onChange={(e) =>
                              run(async () => {
                                await sb.updateEnvoi(envoi.id, { destinationCode: e.target.value });
                                await refreshDepartures();
                              })
                            }
                          >
                            <option value="">Sélectionner</option>
                            {DESTINATION_LIST.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {[
                          ['manifest', 'Liste colis'],
                          ['invoice', 'Facture commerciale'],
                          ['dau', 'Données douane'],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            disabled={busy || !parcels.length}
                            className={BUTTON + ' bg-gray-50 dark:bg-gray-800'}
                            onClick={() => run(() => exportDeparture(envoi, key))}
                          >
                            <Download size={14} />
                            {label}
                          </button>
                        ))}
                        {!archived && (
                          <button
                            className={BUTTON + ' text-gray-500'}
                            onClick={() =>
                              ask(
                                'Archiver ce départ',
                                'Les colis et leur historique restent liés à ce départ.',
                                () => updateDeparture(envoi.id, 'archive'),
                              )
                            }
                          >
                            <Archive size={14} />
                            Archiver
                          </button>
                        )}
                        {!archived && !parcels.length && (
                          <button
                            className={BUTTON + ' text-red-600'}
                            onClick={() =>
                              ask(
                                'Supprimer ce départ vide',
                                'Ce départ ne contient aucun colis.',
                                async () => {
                                  await sb.deleteEnvoi(envoi.id);
                                  await refreshDepartures();
                                },
                                { danger: true },
                              )
                            }
                          >
                            <Trash2 size={14} />
                            Supprimer
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              {!envois.some((e) => (e.statut === 'archive') === archived) && (
                <div className="card p-10 text-center text-gray-500">
                  Aucun départ {archived ? 'archivé' : 'planifié'}.
                </div>
              )}
            </>
          )}
          {tab === 'tarifs' && director && (
            <section className="card p-5 space-y-4">
              <h2 className="font-bold text-lg">Tarifs de transport</h2>
              <p className="text-sm text-gray-500">
                Les devis déjà enregistrés conservent leur version et leurs montants.
              </p>
              {DESTINATION_LIST.map((d) => {
                const t = tarifDraft[d.code] || {};
                return (
                  <div
                    key={d.code}
                    className="grid sm:grid-cols-3 gap-3 items-end border-b dark:border-gray-700 pb-4"
                  >
                    <p className="font-semibold self-center">{d.label}</p>
                    {[
                      ['base', 'Forfait (€)'],
                      ['parKg', 'Prix par kg (€)'],
                    ].map(([key, label]) => (
                      <label key={key} className="text-sm">
                        {label}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={FIELD + ' mt-1'}
                          value={t[key] ?? ''}
                          onChange={(e) =>
                            setTarifDraft((prev) => ({
                              ...prev,
                              [d.code]: { ...t, [key]: e.target.value },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                );
              })}
              <button
                disabled={busy}
                className={BUTTON + ' bg-[#17324D] text-white'}
                onClick={() =>
                  run(async () => {
                    for (const [code, t] of Object.entries(tarifDraft)) {
                      if (
                        ![t.base, t.parKg].every(
                          (n) => n !== '' && Number.isFinite(Number(n)) && Number(n) >= 0,
                        )
                      )
                        throw new Error('Tous les tarifs doivent être positifs ou nuls.');
                      await sb.updateTarif(code, Number(t.base), Number(t.parKg));
                    }
                    setTarifs(await sb.fetchTarifs());
                    flash('Tarifs enregistrés');
                  })
                }
              >
                <Save size={16} />
                Enregistrer les tarifs
              </button>
            </section>
          )}
          {tab === 'categories' && director && (
            <section className="card p-5 space-y-4">
              <h2 className="font-bold text-lg">Catégories et taxes</h2>
              <p className="text-sm text-gray-500">
                Un taux absent bloque le devis. Renseignez explicitement zéro pour une catégorie
                exonérée.
              </p>
              {categories.map((cat) => (
                <div key={cat.id} className="border-b dark:border-gray-700 pb-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      aria-label="Nom de catégorie"
                      className={FIELD}
                      defaultValue={cat.label}
                      key={cat.label}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value !== cat.label)
                          run(() => updateCatLabel(cat.id, e.target.value.trim()));
                      }}
                    />
                    <button
                      className={BUTTON + ' text-red-600'}
                      aria-label={`Supprimer ${cat.label}`}
                      onClick={() =>
                        ask(
                          'Supprimer cette catégorie',
                          'Les catégories utilisées dans des articles doivent être conservées.',
                          () => deleteCategory(cat.id),
                          { danger: true },
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label className="block text-xs font-semibold">
                    Code douanier vérifié
                    <input
                      className={FIELD + ' mt-1'}
                      defaultValue={cat.codeHs || ''}
                      key={cat.codeHs}
                      placeholder="À renseigner avec votre déclarant"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== cat.codeHs)
                          run(async () => {
                            await sb.updateCategorie(cat.id, {
                              code_hs: e.target.value.trim() || null,
                            });
                            setCategories(await sb.fetchCategories());
                          });
                      }}
                    />
                  </label>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {DESTINATION_LIST.map((d) => (
                      <fieldset key={d.code} className="flex gap-2 items-center">
                        <legend className="text-xs text-gray-500">{d.label}</legend>
                        {['om', 'omr'].map((key) => (
                          <label key={key} className="text-xs flex-1 uppercase">
                            {key} %
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              className={FIELD + ' mt-1'}
                              defaultValue={cat.taux?.[d.code]?.[key] ?? ''}
                              key={`${key}-${cat.taux?.[d.code]?.[key]}`}
                              onBlur={(e) => {
                                if (
                                  e.target.value !== '' &&
                                  Number(e.target.value) !== cat.taux?.[d.code]?.[key]
                                )
                                  run(() => updateCatTaux(cat.id, d.code, key, e.target.value));
                              }}
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  aria-label="Nouvelle catégorie"
                  placeholder="Nouvelle catégorie"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
                <button
                  disabled={!newCategory.trim() || busy}
                  className={BUTTON + ' bg-[#17324D] text-white'}
                  onClick={() =>
                    run(async () => {
                      await addCategory(newCategory.trim(), {});
                      setNewCategory('');
                    })
                  }
                >
                  <Plus size={16} />
                  Ajouter
                </button>
              </div>
            </section>
          )}
          {tab === 'users' && director && (
            <section className="card p-5">
              <StaffPermissions />
            </section>
          )}
          {tab === 'templates' && director && (
            <section className="card p-5">
              <h2 className="font-bold text-lg mb-2">Messages clients</h2>
              <p className="text-sm text-gray-500 mb-5">
                Le modèle enregistré est utilisé pour les aperçus et les prochains envois de
                l’équipe.
              </p>
              <TemplateEditor />
            </section>
          )}
          {tab === 'metier' && director && (
            <section className="card p-5 space-y-4">
              <h2 className="font-bold text-lg">Règles métier</h2>
              <p className="text-sm text-gray-500">
                Relances calculées à partir de la demande envoyée. Une attente demandée par le
                client suspend les relances de préparation.
              </p>
              {[
                ['diviseurVolumetrique', 'Diviseur volumétrique', '5000'],
                ['fraisStockage', 'Frais de stockage prévus (€/jour)', '1.50'],
                ['stockageGratuit', 'Jours de stockage gratuit prévus', '14'],
                ['relancesFeuVert', 'Relances accord client', 'J+2, J+5, J+7'],
                ['relancesPaiement', 'Relances paiement', 'J+3, J+7, J+14'],
              ].map(([key, label, placeholder]) => (
                <label key={key} className="block text-sm font-semibold">
                  {label}
                  <input
                    className={FIELD + ' mt-1'}
                    value={businessDraft[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(e) =>
                      setBusinessDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <p className="text-xs text-gray-500">
                Les frais de stockage ne sont pas prélevés automatiquement. Les frais ajoutés au
                devis doivent être vérifiés par l’équipe. Heure limite des départs : mercredi 17 h,
                heure de Paris.
              </p>
              <button
                className={BUTTON + ' bg-[#17324D] text-white'}
                disabled={busy}
                onClick={() => run(saveBusiness)}
              >
                <Save size={16} />
                Enregistrer les règles
              </button>
            </section>
          )}
          {tab === 'interdits' && director && (
            <section className="card p-5 space-y-4">
              <h2 className="font-bold text-lg">Produits interdits</h2>
              {produitsInterdits.map((item) => (
                <div
                  key={item}
                  className="flex items-center justify-between border-b dark:border-gray-700 pb-2 gap-3"
                >
                  <span className="text-sm">{item}</span>
                  <button
                    className={BUTTON + ' text-red-600'}
                    aria-label={`Retirer ${item}`}
                    onClick={() =>
                      ask(
                        'Retirer ce produit de la liste',
                        item,
                        () => setProduitsInterdits(produitsInterdits.filter((x) => x !== item)),
                        { danger: true },
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  aria-label="Produit interdit"
                  className={FIELD}
                  value={newInterdit}
                  onChange={(e) => setNewInterdit(e.target.value)}
                  placeholder="Ajouter un produit"
                />
                <button
                  className={BUTTON + ' bg-[#17324D] text-white'}
                  disabled={busy || !newInterdit.trim()}
                  onClick={() =>
                    run(async () => {
                      if (produitsInterdits.includes(newInterdit.trim()))
                        throw new Error('Ce produit est déjà présent.');
                      await setProduitsInterdits([...produitsInterdits, newInterdit.trim()]);
                      setNewInterdit('');
                    })
                  }
                >
                  <Plus size={16} />
                  Ajouter
                </button>
              </div>
            </section>
          )}
          {tab === 'telegram' && (
            <section className="card p-5 space-y-4">
              <div className="flex items-center gap-3">
                <MessageCircle size={28} className="text-sky-600" />
                <h2 className="font-bold text-lg">Un échange rattaché à chaque dossier</h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Depuis la fiche client, générez une invitation personnelle. Le client ouvre le bot
                et confirme la liaison. Les demandes, réponses et documents apparaissent ensuite
                dans son dossier.
              </p>
              <ol className="list-decimal pl-5 space-y-3 text-sm">
                <li>Envoyez une demande complète avec les cartons concernés.</li>
                <li>Le client autorise la préparation, demande d’attendre ou refuse.</li>
                <li>
                  Consultez les réponses dans la file « Messages clients » et traitez les
                  exceptions.
                </li>
              </ol>
              <p className="rounded-xl bg-sky-50 text-sky-900 p-4 text-sm">
                Un message est marqué envoyé après confirmation de Telegram. Les clients sans
                Telegram retrouvent leurs demandes dans leur espace client.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { searchClients } from '../../utils';
import { receptionTarget } from '../../domain/brouillon';
import { receptionCartonManifest } from '../../domain/reception';
import NewClientForm from './NewClientForm';
import { Casier, Place } from './ReceptionParts';
import { EMPTY_NEW_CLIENT } from './useReceptionSession';
import { clientPlace, count } from './receptionFlowModel';

// Step 1, « Pour quel client ? »: the search (name, phone, client number) and, for each client found, what will
// happen to the carton (receptionTarget): it joins the open brouillon, or opens a new one.
const MAX_RESULTS = 8;
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** The second line of a client found: the open brouillon, or why the carton opens a new one. */
function targetLine(target) {
  if (target.mode === 'append') return <>Brouillon en cours : {count(receptionCartonManifest(target.dossier).nbColis, 'carton')} · <Casier value={target.dossier.casier} /></>;
  if (target.blockedReason) return 'Le brouillon en cours ne peut pas recevoir de carton';
  return target.detail === 'Devis déjà envoyé' ? 'Devis déjà envoyé, en attente de paiement' : 'Aucun brouillon en cours';
}

/** What a typed search already says about a new client: an e-mail, a phone or a name. */
export function newClientFromQuery(query) {
  const typed = String(query || '').trim();
  if (!typed) return { ...EMPTY_NEW_CLIENT };
  if (typed.includes('@')) return { ...EMPTY_NEW_CLIENT, email: typed };
  if ((typed.match(/\d/g) || []).length >= 6 && /^[+\d\s.()-]+$/.test(typed)) return { ...EMPTY_NEW_CLIENT, tel: typed };
  return /^CLI-/i.test(typed) ? { ...EMPTY_NEW_CLIENT } : { ...EMPTY_NEW_CLIENT, nom: typed };
}

export default function ClientStep({ start, updateStart, onChoose }) {
  const { clients, data, can } = useApp();
  const searchRef = useRef(null);
  const query = start.q || '';
  const canCreate = can('perm_clients_creer');
  useEffect(() => { if (!start.creating) searchRef.current?.focus(); }, [start.creating]);

  const found = useMemo(() => query.trim() ? searchClients(clients, query).slice().sort((left, right) => collator.compare(left.nom || '', right.nom || '')) : [], [clients, query]);
  const shown = found.slice(0, MAX_RESULTS);

  const openCreation = () => updateStart(previous => ({ creating: true, newClient: Object.values(previous.newClient || {}).some(value => value && value !== 'particulier') ? previous.newClient : newClientFromQuery(previous.q) }));

  if (start.creating && canCreate) return <section aria-labelledby="rf-step-title" className="mx-auto w-full max-w-3xl space-y-5">
    <h2 id="rf-step-title" className="rf-strong text-[26px] font-extrabold sm:text-[30px]">Pour quel client ?</h2>
    <NewClientForm values={start.newClient} onChange={newClient => updateStart({ newClient })}
      onCancel={() => updateStart({ creating: false })} onCreated={id => { updateStart({ creating: false, newClient: { ...EMPTY_NEW_CLIENT }, q: '' }); onChoose(id); }} />
  </section>;

  return <section aria-labelledby="rf-step-title" className="mx-auto w-full max-w-3xl space-y-4">
    <h2 id="rf-step-title" className="rf-strong text-[26px] font-extrabold sm:text-[30px]">Pour quel client ?</h2>
    <div>
      <label htmlFor="rf-client-search" className="rf-label rf-muted">Nom, téléphone ou numéro client</label>
      <div className="relative">
        <Search size={24} aria-hidden="true" className="rf-muted pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2" />
        <input ref={searchRef} id="rf-client-search" type="search" autoComplete="off" spellCheck={false} value={query} aria-describedby="rf-client-count"
          onChange={event => updateStart({ q: event.target.value })} className="rf-field rf-field--search" />
      </div>
    </div>
    <p id="rf-client-count" aria-live="polite" className="rf-muted text-[15px]">
      {!query.trim() ? 'Tapez le nom, le téléphone ou le numéro client.'
        : found.length === 0 ? `Aucun client ne correspond à « ${query.trim()} ».`
          : found.length > MAX_RESULTS ? `${count(found.length, 'client trouvé', 'clients trouvés')} : les ${MAX_RESULTS} premiers sont affichés, précisez la recherche.`
            : count(found.length, 'client trouvé', 'clients trouvés')}
    </p>
    {shown.length > 0 && <ul aria-label="Clients trouvés" className="space-y-2.5">
      {shown.map(client => {
        const target = receptionTarget(client.id, data);
        const place = clientPlace(client);
        return <li key={client.id}>
          <button type="button" onClick={() => onChoose(client.id)} className={`rf-result${target.mode === 'append' ? ' rf-result--join' : ''} flex min-h-[84px] w-full items-center gap-3 px-4 py-3 text-left sm:gap-4 sm:px-5`}>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1 basis-60">
                <span className="rf-strong block text-[21px] font-extrabold leading-snug">{client.nom}<Place place={place} /></span>
                <span className="mt-1 block text-[16px]">{targetLine(target)}</span>
              </span>
              <span className={`rf-pill rf-pill--${target.mode === 'append' ? 'join' : 'new'}`}>{target.label}</span>
            </span>
            <ChevronRight size={24} aria-hidden="true" className="rf-strong shrink-0" />
          </button>
        </li>;
      })}
    </ul>}
    {canCreate && <div className="rf-line mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="rf-muted text-[17px]">Client introuvable ?</p>
      <button type="button" onClick={openCreation} className="rf-secondary inline-flex items-center gap-2 px-5"><Plus size={20} aria-hidden="true" />Créer un nouveau client</button>
    </div>}
  </section>;
}

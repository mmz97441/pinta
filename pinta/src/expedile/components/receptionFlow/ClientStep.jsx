import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { randomId } from '../../lib/randomId';
import { searchClients } from '../../utils';
import { receptionTarget } from '../../domain/brouillon';
import { receptionCartonManifest } from '../../domain/reception';
import NewClientForm from './NewClientForm';
import { Casier, Place, TableFrame } from './ReceptionParts';
import { EMPTY_NEW_CLIENT } from './useReceptionSession';
import { clientPlace, count } from './receptionFlowModel';

// Step 1, « Pour quel client ? »: the search (name, phone, client number) and, in a table, each client found with what
// will happen to the carton (receptionTarget): it joins the open brouillon, or opens a new one.
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
  // One creation identifier per form, kept with its typing (a session written before it had none).
  useEffect(() => { if (start.creating && canCreate && !start.createId) updateStart(previous => previous.createId ? {} : { createId: randomId() }); }, [start.creating, start.createId, canCreate, updateStart]);

  const found = useMemo(() => query.trim() ? searchClients(clients, query).slice().sort((left, right) => collator.compare(left.nom || '', right.nom || '')) : [], [clients, query]);
  const shown = found.slice(0, MAX_RESULTS);

  // The typing kept since the last opening (and its identifier), else what the search already says.
  const openCreation = () => updateStart(previous => {
    const typed = Boolean(previous.pendingCreation) || Object.entries(previous.newClient || {}).some(([key, value]) => key === 'type' ? value === 'pro' : Boolean(value));
    return { creating: true, newClient: typed ? previous.newClient : newClientFromQuery(previous.q), createId: typed && previous.createId ? previous.createId : randomId() };
  });
  const created = id => { updateStart({ creating: false, newClient: { ...EMPTY_NEW_CLIENT }, q: '', createId: null, pendingCreation: null }); onChoose(id); };
  // The client of a creation still to check, found by the search: that creation is resolved.
  const choose = id => id && id === start.createId ? created(id) : onChoose(id);

  if (start.creating && canCreate) return <section aria-labelledby="rf-step-title" className="mx-auto w-full max-w-3xl space-y-5">
    <h2 id="rf-step-title" className="rf-strong text-[26px] font-extrabold sm:text-[30px]">Pour quel client ?</h2>
    <NewClientForm values={start.newClient} createId={start.createId} pending={start.pendingCreation}
      onChange={newClient => updateStart({ newClient })} onPending={pendingCreation => updateStart({ pendingCreation })}
      onCancel={() => updateStart({ creating: false })} onCreated={created} />
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
      {/* Without the right to create a client, the way forward when the search finds nobody. */}
      {!canCreate && query.trim() && found.length === 0 && <span className="rf-strong mt-1 block text-[17px] font-bold">Demandez à un responsable de créer ce client.</span>}
    </p>
    {shown.length > 0 && <TableFrame label="Clients trouvés">
      <table className="rf-table">
        <caption className="sr-only">Clients trouvés pour « {query.trim()} »</caption>
        <thead><tr><th scope="col">Client</th><th scope="col">Brouillon</th><th scope="col">Le carton</th><th scope="col">Action</th></tr></thead>
        <tbody>{shown.map(client => {
          const target = receptionTarget(client.id, data);
          const join = target.mode === 'append';
          // The whole line answers the tap (its action may wait on the right of a phone); the button is the action.
          return <tr key={client.id} data-clickable="true" data-tone={join ? 'join' : undefined} onClick={event => { if (!event.target.closest('a, button')) choose(client.id); }}>
            <th scope="row"><span className="rf-cell-id">
              <span className="rf-strong block text-[17px] font-extrabold leading-snug">{client.nom}</span>
              <Place place={clientPlace(client)} lead={false} className="block" />
            </span></th>
            <td className="rf-cell-text">{targetLine(target)}</td>
            <td><span className={`rf-pill rf-pill--${join ? 'join' : 'new'}`}>{target.label}</span></td>
            <td><button type="button" onClick={() => choose(client.id)} aria-label={`Choisir ${client.nom}`}
              className="rf-small-action inline-flex items-center gap-1.5 whitespace-nowrap">Choisir<ChevronRight size={20} aria-hidden="true" /></button></td>
          </tr>;
        })}</tbody>
      </table>
    </TableFrame>}
    {canCreate && <div className="rf-line mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="rf-muted text-[17px]">Client introuvable ?</p>
      <button type="button" onClick={openCreation} className="rf-secondary inline-flex items-center gap-2 px-5"><Plus size={20} aria-hidden="true" />Créer un nouveau client</button>
    </div>}
  </section>;
}

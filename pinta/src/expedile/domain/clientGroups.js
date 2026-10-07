// « Regrouper › Par client » in the dossier list: the default of « Accords
// clients », offered in every tab. Pure: the caller has sorted the dossiers.

const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
export const CLIENT_GROUP_PREFIX = 'client:';
// Dossiers without a client; a client the person cannot read keeps its own band.
export const UNKNOWN_CLIENT_GROUP_KEY = 'client:unknown';
const UNKNOWN_CLIENT_LABEL = 'Client non renseigné';

/** « Payet Flavie »: the family name then the first name, as the dossier rows
 * show the client (mapClient `nom`); null when the record names nobody. */
export function clientDisplayName(client) {
  const name = client?.nomFamille ? [client.nomFamille, client.prenom].filter(Boolean).join(' ') : client?.nom || client?.prenom;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** The title of a client band: the same name as its rows, so a band and its
 * dossiers read alike. */
export function clientGroupTitle(client) {
  return clientDisplayName(client) || UNKNOWN_CLIENT_LABEL;
}

const compareKey = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** What tells two clients with the same name apart, as the band's secondary
 * text: their reference, else their town, else their email; null without any. */
export function clientGroupDistinction(client) {
  return [client?.ref, client?.ville || client?.commune, client?.email].map(value => typeof value === 'string' ? value.trim() : '').find(Boolean) || null;
}

/** One band per client, keyed `client:<id>` (`client:unknown` without a client),
 * titled like its rows (« Payet Flavie »):
 * the client whose oldest dossier was received first leads, then by name.
 * `receivedAt(dossier)` gives a dossier's first reception (an ISO instant, or
 * null when unknown: such bands follow the dated ones). Each band keeps the
 * incoming order of its dossiers, so the current sort applies inside it. Bands
 * whose titles are the same carry `ref` (clientGroupDistinction), otherwise null. */
export function groupDossiersByClient(dossiers = [], { getClient = () => undefined, receivedAt = () => null } = {}) {
  const groups = new Map();
  for (const dossier of dossiers || []) {
    const key = dossier.clientId ? `${CLIENT_GROUP_PREFIX}${dossier.clientId}` : UNKNOWN_CLIENT_GROUP_KEY;
    if (!groups.has(key)) {
      const client = dossier.clientId ? getClient(dossier.clientId) || null : null;
      groups.set(key, { key, client, title: clientGroupTitle(client), oldest: null, dossiers: [] });
    }
    const group = groups.get(key);
    group.dossiers.push(dossier);
    const value = receivedAt(dossier), time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isFinite(time) && (group.oldest === null || time < group.oldest)) group.oldest = time;
  }
  const bands = [...groups.values()];
  const sameTitle = new Map();
  for (const band of bands) sameTitle.set(band.title, (sameTitle.get(band.title) || 0) + 1);
  return bands.sort((left, right) => Number(left.oldest === null) - Number(right.oldest === null)
    || (left.oldest ?? 0) - (right.oldest ?? 0)
    || naturalOrder.compare(left.title, right.title)
    || compareKey(left.key, right.key))
    .map(({ key, client, title, dossiers: members }) => ({ key, client, title, ref: sameTitle.get(title) > 1 ? clientGroupDistinction(client) : null, dossiers: members }));
}

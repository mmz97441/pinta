/** The most recent message of a channel in the session log (AppContext comLog,
 * newest first), whatever the order of the log: the date decides. */
export function latestChannelEvent(log, canal) {
  return (Array.isArray(log) ? log : [])
    .filter(event => event?.canal === canal && Number.isFinite(Date.parse(event.date)))
    .reduce((latest, event) => !latest || Date.parse(event.date) > Date.parse(latest.date) ? event : latest, null);
}

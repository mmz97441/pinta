// What a technical answer says (a function or a column the server does not know, the network, a database rule, an
// English message) is never shown to the team, which reads a plain French sentence and its way forward instead; the
// technical detail goes to the console. The server's own French refusals (« Le dossier EXP-… est archivé… »,
// « Photos indisponibles ») are kept.
const TECHNICAL = /schema cache|function|relation|column|violates|duplicate key|permission denied|jwt|failed to fetch|networkerror|network request|load failed|timeout|timed out|syntax|typeerror|internal server|bad request|not found|forbidden|unauthorized|undefined|null value|https?:\/\//i;
const ENGLISH = /\b(the|of|in|is|are|not|no|to|for|with|and|could|cannot|can't|unable|invalid|missing|denied|error|failed|request|response|server|unknown|unexpected|already|exists)\b/i;

/** Whether a message can be shown as it is: French words, nothing technical. */
export function isReadableMessage(message) {
  const text = String(message ?? '').trim();
  return Boolean(text) && !TECHNICAL.test(text) && !ENGLISH.test(text);
}

/** The message of an error as the team can read it: the server's French sentence, otherwise `fallback`. */
export function readableError(error, fallback, context = 'Expedîle') {
  const message = String(typeof error === 'string' ? error : error?.message ?? '').trim();
  const code = String(error?.code ?? '');
  if (!/^PGRST/i.test(code) && isReadableMessage(message)) return message;
  if (error) console.warn(`[${context}]`, error);
  return fallback;
}

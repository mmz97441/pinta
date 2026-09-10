import { HttpError } from './http.ts';

/** Production is the safe default; test operation requires an explicit setting. */
export function payplugMode() {
  const mode = (Deno.env.get('PAYPLUG_MODE') || 'live').trim();
  if (!['live', 'test'].includes(mode)) throw new HttpError(503, 'Le mode PayPlug doit être configuré sur live ou test.');
  return mode as 'live' | 'test';
}

export function payplugKeyMode(key: string) {
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  throw new HttpError(503, 'La clé PayPlug doit être vérifiée avant tout règlement.');
}

export function requirePayplugCreationMode(key: string) {
  const mode = payplugMode();
  if (payplugKeyMode(key) !== mode) throw new HttpError(503, mode === 'live'
    ? 'Le paiement réel est indisponible : la clé PayPlug de production doit être configurée. Aucun lien de test ne sera envoyé.'
    : 'Le mode de la clé PayPlug ne correspond pas à cet environnement de test.');
  return mode === 'live';
}

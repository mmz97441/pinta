// Pure helpers of « Réceptionner des cartons » (/recevoir) and « Avis d’arrivée » (/avis):
// the carton form, the commands' payloads, the error rule shared with ColisModal and the
// labels of the screens. No React, no network: the components call the existing commands.
import { RECEPTION_MEASURES, receptionAppendImpact, receptionCartonManifest } from '../../domain/reception';
import { getDestByCP } from '../../constants';

export const MEASURES = RECEPTION_MEASURES;
// interditsOpen: the list of the forbidden products is open (« Signaler un problème »), kept with the typing.
export const EMPTY_CARTON = Object.freeze({ casier: '', tracking: '', fournisseur: '', dimL: '', dimW: '', dimH: '', poids: '', abime: false, note: '', interdits: [], photoName: '', interditsOpen: false });

/** Whether a carton is being typed (a number, a measure, a problem flagged), which a validation would leave out. The
 * locker of a new brouillon is not a carton: it may be typed ahead. */
export function formHasTyping(form) {
  if (!form) return false;
  return ['tracking', 'fournisseur', 'dimL', 'dimW', 'dimH', 'poids', 'note'].some(key => String(form[key] ?? '').trim() !== '')
    || Boolean(form.abime) || (Array.isArray(form.interdits) && form.interdits.length > 0);
}

const text = value => typeof value === 'string' ? value.trim() : '';

/** « 45 », « 12,5 » or « 12.5 » → a number; null unless positive with at most two decimals (the columns are
 * NUMERIC(8,2): a third decimal would be rounded by the database and the replay of a lost save refused). */
export function parseMeasure(value) {
  const typed = String(value ?? '').replace(/\s+/g, '').replace(',', '.');
  if (!/^(\d{1,6}(\.\d{1,2})?|\.\d{1,2})$/.test(typed)) return null;
  const number = Number(typed);
  return Number.isFinite(number) && number > 0 ? number : null;
}

const MEASURE_ERRORS = {
  dimL: ['Indiquez la longueur en centimètres.', 'Écrivez la longueur en chiffres, par exemple 45 ou 45,5 (deux chiffres au plus après la virgule).'],
  dimW: ['Indiquez la largeur en centimètres.', 'Écrivez la largeur en chiffres, par exemple 30 ou 30,5 (deux chiffres au plus après la virgule).'],
  dimH: ['Indiquez la hauteur en centimètres.', 'Écrivez la hauteur en chiffres, par exemple 20 ou 20,5 (deux chiffres au plus après la virgule).'],
  poids: ['Indiquez le poids en kilogrammes.', 'Écrivez le poids en chiffres, par exemple 2,4 (deux chiffres au plus après la virgule).'],
};

/** The four measures of the form as numbers, or null when one is missing or invalid. */
export function cartonMeasures(form) {
  const box = Object.fromEntries(MEASURES.map(({ key }) => [key, parseMeasure(form?.[key])]));
  return MEASURES.every(({ key }) => box[key] !== null) ? box : null;
}

const CLOSED = ['livre', 'annule'];
const sameCode = (left, right) => text(left) !== '' && text(left).toLowerCase() === text(right).toLowerCase();

/** The open dossier that already holds this tracking number: { dossier, number } (number: its carton), or null. */
export function trackingOwner(tracking, dossiers = []) {
  if (!text(tracking)) return null;
  for (const dossier of dossiers || []) {
    if (!dossier || dossier.archive || CLOSED.includes(dossier.statut)) continue;
    const manifest = receptionCartonManifest(dossier);
    const index = manifest.trackingsDetail.findIndex(detail => sameCode(detail.number, tracking));
    if (index >= 0) return { dossier, number: index + 1 };
    if (manifest.trackings.some(number => sameCode(number, tracking))) return { dossier, number: null };
  }
  return null;
}

/** The refused fields of the carton form, in the order of the form: { key: message }. `duplicate`: the
 * trackingOwner of its number, with `same` when it is the target dossier and `ownerName` its client. */
export function cartonFieldErrors(form, { needsCasier = false, hasPhoto = false, duplicate = null } = {}) {
  const errors = {};
  if (needsCasier && !text(form.casier)) errors.casier = 'Indiquez le casier où vous rangez ce carton.';
  if (duplicate) {
    errors.tracking = duplicate.same
      ? `Ce numéro de suivi est déjà dans ce brouillon${duplicate.number ? ` (carton n° ${duplicate.number})` : ''}. Vérifiez le carton.`
      : `Ce numéro de suivi est déjà enregistré dans le dossier ${duplicate.dossier.ref || 'd’un autre client'}${duplicate.ownerName ? ` (${duplicate.ownerName})` : ''}. Vérifiez le carton.`;
  }
  for (const { key } of MEASURES) {
    const value = String(form[key] ?? '').trim();
    if (!value) errors[key] = MEASURE_ERRORS[key][0];
    else if (parseMeasure(value) === null) errors[key] = MEASURE_ERRORS[key][1];
  }
  if (form.abime && !hasPhoto) errors.photo = 'Prenez une photo du carton abîmé. S’il ne l’est pas, touchez à nouveau « Carton abîmé ou ouvert ».';
  return errors;
}

/** The line written in the reception notes for a damaged or opened carton. */
export function damageNote(form, number) {
  const which = [text(form.fournisseur), text(form.tracking)].filter(Boolean).join(', ');
  const remark = text(form.note);
  return `Carton n° ${number}${which ? ` (${which})` : ''} abîmé ou ouvert à la réception${remark ? ` : ${remark}` : ''}.`;
}

/** Whether the reception notes of a dossier say that its carton n° `number` arrived damaged or opened (damageNote). */
export function notesSayDamaged(notes, number) {
  if (!Number.isInteger(number) || number < 1) return false;
  return new RegExp(`(^|\\n)Carton n°\\s?${number}(?!\\d)[^\\n]*abîmé ou ouvert`).test(String(notes || ''));
}

// The photo of a damaged carton: add_reception_photo keeps a JPEG, PNG or WebP image stored in the dossier's folder, and
// uploadDocument names the stored file after the extension of the file's name (a photo taken by the camera may have none).
const PHOTO_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** Why this file cannot be the photo of the carton, or '' when it can. */
export function photoProblem(file) {
  if (!file) return '';
  if (!PHOTO_EXTENSIONS[file.type]) return 'Cette image n’est pas au format JPEG, PNG ou WebP : reprenez la photo ou choisissez-en une autre.';
  if (!(file.size <= MAX_PHOTO_BYTES)) return 'Cette photo dépasse 20 Mo : reprenez-la ou choisissez-en une plus légère.';
  return '';
}

/** The photo as it is uploaded: its name ends with the extension of its type. */
export function receptionPhotoFile(file) {
  const extension = PHOTO_EXTENSIONS[file?.type];
  if (!extension || /\.(jpe?g|png|webp)$/i.test(String(file.name || ''))) return file;
  return new File([file], `photo.${extension}`, { type: file.type, lastModified: file.lastModified });
}

/** The new dossier of a first carton, as ColisModal builds it: measured, so « mesure » (the Brouillon would
 * otherwise show « Mesures à compléter »). insertColis(payload, { createId }) is replayed with the same values. */
export function newDossierPayload(clientId, form, box) {
  const tracking = text(form.tracking), fournisseur = text(form.fournisseur);
  const interdits = [...(form.interdits || [])];
  return {
    clientId, desc: fournisseur || 'Carton reçu',
    trackings: tracking ? [tracking] : [], trackingsDetail: [{ number: tracking, fournisseur }],
    casier: text(form.casier), valeur: null,
    notesReception: form.abime ? damageNote(form, 1) : null,
    dimL: box.dimL, dimW: box.dimW, dimH: box.dimH, poids: box.poids,
    nbColis: 1, dimsParColis: [{ ...box }], statut: 'mesure',
    checkInterdits: interdits, produitInterdit: interdits.length > 0,
  };
}

/** What the addition of a carton changes for the client's consent, read before the first addition of this
 * reception (receptionAppendImpact): { kind: 'devis' | 'accord' | 'demande', cartons } or null. */
export function consentRenewal(dossier) {
  if (!dossier || !receptionAppendImpact(dossier)) return null;
  const kind = ['devis_envoye', 'attente_paiement'].includes(dossier.statut) || dossier.devisTotal != null || dossier.devisSnapshot ? 'devis'
    : dossier.feuVert === 'autorise' || ['autorise', 'en_preparation'].includes(dossier.statut) ? 'accord' : 'demande';
  return { kind, cartons: receptionCartonManifest(dossier).nbColis };
}

/**
 * A refusal stated by the server (a SQLSTATE or a PostgREST code): nothing was written, the attempt can be
 * forgotten. Anything else (lost response, network) is uncertain: the very same request must be replayed.
 * The rule of ColisModal, with the SQLSTATEs that contain letters (42P01, P0001…).
 */
export function definiteRefusal(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code);
}

// The message of an error as the team can read it (utils/readableError.js).
export { readableError } from '../../utils/readableError';

/** A refusal of the server without its advice to refresh (« … : actualisez la liste. », « Actualisez avant de
 * valider. »), whatever its case: the screen reads the list again by itself and says so. */
export function withoutRefreshAdvice(message) {
  const said = String(message || '').replace(/\s*(?:[:;,.]\s*)?actualisez\b[^.]*\.?/gi, '.').replace(/\.{2,}/g, '.').trim();
  return said === '.' ? '' : said;
}

/** What insertClient(payload, { createId }) receives from the quick creation of a client. The same values give the
 * same payload: a creation whose answer was lost is replayed as it was sent. */
export function newClientPayload(values) {
  const field = key => text(values?.[key]);
  const email = field('email');
  const pro = values?.type === 'pro';
  return {
    nom: field('nom'), prenom: field('prenom'), tel: field('tel'), telFixe: field('telFixe'), email,
    adresseLigne1: field('adresseLigne1'), cp: field('cp'), ville: field('ville'),
    type: pro ? 'pro' : 'particulier', raisonSociale: pro ? field('raisonSociale') : '',
    canal: email ? 'email' : 'telegram', modePaiement: 'colis', abonnement: 'freemium', points: 0,
  };
}

// ── Names, places, counts ──────────────────────────────────────────────────
/** « Flavie »: the first name, otherwise the name as the list shows it. */
export function firstName(client) {
  return text(client?.prenom) || text(client?.nom) || 'le client';
}

/** « Réunion · Saint-Pierre ». */
export function clientPlace(client) {
  if (!client) return '';
  const destination = getDestByCP(client.cp)?.label || '';
  return [destination, text(client.commune) || text(client.ville)].filter(Boolean).join(' · ');
}

const NUMBER = new Intl.NumberFormat('fr-FR');
/** « 1 carton », « 3 cartons » (French: below two is singular). */
export const count = (value, singular, pluralForm = `${singular}s`) => `${NUMBER.format(Number(value) || 0)} ${Math.abs(Number(value) || 0) >= 2 ? pluralForm : singular}`;

// ── Paris time for the team ────────────────────────────────────────────────
const PARIS_DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const PARIS_SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });
const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
const instant = value => { const time = typeof value === 'string' || typeof value === 'number' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; };

/** { day: « Aujourd’hui » | « Hier » | « Mar. 27 oct. », time: « 16 h 07 » } in Paris time, or null. */
export function parisMoment(value, now = Date.now()) {
  const time = instant(value);
  if (time === null) return null;
  const key = PARIS_DAY.format(time);
  const day = key === PARIS_DAY.format(now) ? 'Aujourd’hui' : key === PARIS_DAY.format(now - 86400000) ? 'Hier'
    : PARIS_SHORT_DAY.format(time).replace(/^./, letter => letter.toLocaleUpperCase('fr-FR'));
  return { day, time: PARIS_TIME.format(time).replace(':', ' h ') };
}

/** « aujourd’hui à 16 h 07 », « le mar. 27 oct. à 9 h 05 ». */
export function parisWhen(value, now = Date.now()) {
  const moment = parisMoment(value, now);
  if (!moment) return '';
  const day = moment.day === 'Aujourd’hui' ? 'aujourd’hui' : moment.day === 'Hier' ? 'hier' : `le ${moment.day.charAt(0).toLocaleLowerCase('fr-FR')}${moment.day.slice(1)}`;
  return `${day} à ${moment.time}`;
}

// ── The arrival notice by e-mail, sent by hand until the provider is connected ──
/** A ready e-mail for the team's mail app: mailto with the client's address, a subject and the notice. */
export function noticeMailto(email, cartonCount, body) {
  if (!text(email) || !text(body)) return null;
  const subject = Number(cartonCount) > 1 ? `Vos ${cartonCount} colis sont arrivés chez Expedîle` : 'Votre colis est arrivé chez Expedîle';
  return `mailto:${encodeURIComponent(text(email)).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// French counts without « (s) »: 0 and 1 take the singular, 2 and more the plural.

const NUMBER = new Intl.NumberFormat('fr-FR');

/** The word alone: pluralWord(2, 'carton') → « cartons »; irregular forms go in `pluralForm`. */
export function pluralWord(count, singular, pluralForm = `${singular}s`) {
  return Math.abs(Number(count) || 0) < 2 ? singular : pluralForm;
}

/** The count and its word: plural(1, 'dossier') → « 1 dossier », plural(1234, 'carton') → « 1 234 cartons ». */
export function plural(count, singular, pluralForm = `${singular}s`) {
  const value = Number(count) || 0;
  return `${NUMBER.format(value)} ${pluralWord(value, singular, pluralForm)}`;
}

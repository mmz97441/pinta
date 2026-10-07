import React, { useEffect, useId, useState } from 'react';
import { DOSSIER_TEXT_SIZE_BOUNDS, sanitizeDossierTextSize } from '../../domain/dossierTablePreferences';

/** `subject` names what the text belongs to in every control name: « dossiers »
 * in the dossier list, « tâches » in Mon travail. */
export default function DossierTextSizeControl({ value, onChange, label = 'Texte', subject = 'dossiers' }) {
  const [draft, setDraft] = useState(String(value));
  const id = useId();
  const { min, max } = DOSSIER_TEXT_SIZE_BOUNDS;
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = draft.trim() === '' ? value : sanitizeDossierTextSize(Number(draft));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return <div className="dossier-text-size" role="group" aria-label={`Régler la taille du texte des ${subject}`}>
    <label htmlFor={id}>{label}</label>
    <button type="button" className="dossier-text-size-step" aria-label={`Réduire le texte des ${subject}`} disabled={value <= min} onClick={() => onChange(value - 1)}>A−</button>
    <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} aria-label={`Taille du texte des ${subject}`} aria-description={`De ${min} à ${max} pixels. Appuyez sur Entrée pour appliquer.`} value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        // Escape first undoes a typed size. Only then may it close the dialog
        // that hosts this control (native dialog cancel).
        if (event.key === 'Escape' && draft !== String(value)) { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); }
      }} />
    <span aria-hidden="true">px</span>
    <button type="button" className="dossier-text-size-step" aria-label={`Agrandir le texte des ${subject}`} disabled={value >= max} onClick={() => onChange(value + 1)}>A+</button>
  </div>;
}

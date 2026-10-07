import React, { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ColumnDialog } from '../staff/DossierColumnOptions';
import DossierTextSizeControl from '../staff/DossierTextSizeControl';

/** « Densité » belongs to the account (staff_work_preferences): only this
 * field is sent, with the version read, and the page changes once the server
 * has confirmed it. A refused save keeps the confirmed density on screen. */
function WorkDensityField({ preference }) {
  const { saveWorkPreferences } = useApp();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const noteId = useId();
  const saved = preference?.density === 'compact' ? 'compact' : 'comfortable';
  async function change(next) {
    if (pending || next === saved) return;
    setPending(next); setError('');
    try { await saveWorkPreferences({ density: next }, { expectedVersion: preference?.version ?? null }); }
    catch (err) { setError(`La densité n’a pas été enregistrée : ${err.message || 'réessayez.'}`); }
    finally { setPending(null); }
  }
  return <>
    <label className="dossier-display-field">
      <span>Densité</span>
      <select aria-label="Densité" aria-describedby={noteId} value={pending || saved} disabled={Boolean(pending)} onChange={event => change(event.target.value)}>
        <option value="comfortable">Confortable</option><option value="compact">Compacte</option>
      </select>
    </label>
    <p id={noteId} role={pending ? 'status' : undefined} className="dossier-display-note">{pending ? 'Enregistrement de la densité…' : 'Mémorisée pour votre compte, sur tous vos appareils.'}</p>
    {error && <p role="alert" className="dossier-display-error">{error}</p>}
  </>;
}

/** « Affichage » of Mon travail: the table columns, the layout, the density and
 * the text size. Columns, layout and text size are remembered per person on
 * this device. Each field's visible label is its accessible name. Escape, the
 * backdrop or the close button return focus to the trigger. */
export default function WorkDisplayOptions({ anchor, onClose, visibleColumnCount, columnCount, onOpenColumns, layout, onLayoutChange, textSize, onTextSizeChange, textSizeKey, preference }) {
  return <ColumnDialog id="work-display-dialog" titleId="work-display-title" testId="work-display-dialog" className="dossier-display-options"
    title="Affichage" closeLabel="Fermer l’affichage" anchor={anchor} align="end" onClose={onClose}>
    <div className="dossier-display-section" role="group" aria-labelledby="work-display-columns">
      <h3 id="work-display-columns" className="dossier-display-section-title">Colonnes</h3>
      <button type="button" data-filter-focus="" aria-haspopup="dialog" className="dossier-display-row" onClick={onOpenColumns}>
        <span>Colonnes</span><ChevronRight size={18} aria-hidden="true" />
      </button>
      <p className="dossier-display-note">{visibleColumnCount} sur {columnCount} colonnes affichées</p>
    </div>

    <div className="dossier-display-section" role="group" aria-labelledby="work-display-reading">
      <h3 id="work-display-reading" className="dossier-display-section-title">Lecture</h3>
      <label className="dossier-display-field">
        <span>Affichage des tâches</span>
        <select aria-label="Affichage des tâches" value={layout} onChange={event => onLayoutChange(event.target.value)}>
          <option value="auto">Automatique</option><option value="table">Tableau</option><option value="cards">Cartes</option>
        </select>
      </label>
      <WorkDensityField preference={preference} />
      <DossierTextSizeControl key={textSizeKey} label="Taille du texte" subject="tâches" value={textSize} onChange={onTextSizeChange} />
    </div>
  </ColumnDialog>;
}

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ColumnDialog } from '../staff/DossierColumnOptions';
import DossierTextSizeControl from '../staff/DossierTextSizeControl';

/** « Affichage » of Mon travail: the table columns, the layout and the text
 * size, remembered per person on this device. Each field's visible label is its
 * accessible name. Escape, the backdrop or the close button return focus to the
 * trigger. */
export default function WorkDisplayOptions({ anchor, onClose, visibleColumnCount, columnCount, onOpenColumns, layout, onLayoutChange, textSize, onTextSizeChange, textSizeKey }) {
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
      <DossierTextSizeControl key={textSizeKey} label="Taille du texte" subject="tâches" value={textSize} onChange={onTextSizeChange} />
    </div>
  </ColumnDialog>;
}

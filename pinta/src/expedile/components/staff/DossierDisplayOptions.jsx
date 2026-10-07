import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ColumnDialog } from './DossierColumnOptions';
import DossierTextSizeControl from './DossierTextSizeControl';
import { countLabel, countWord, dossierTableSortDirectionLabel } from '../../domain/dossierTable';

/** « Affichage »: every reading and organisation preference of the dossier
 * list behind one toolbar button. Each field's visible label is its accessible
 * name, so speech input can reach it by what it reads. Changing a setting keeps the dialog open;
 * Escape, the backdrop or the close button return focus to the trigger. */
export default function DossierDisplayOptions({
  anchor, onClose,
  visibleColumnCount, columnCount, onOpenColumns,
  layout, onLayoutChange, textSize, onTextSizeChange, textSizeKey,
  grouping, onGroupingChange, noDeparture, onNoDepartureChange,
  sortValue, sortOptions, sortableColumns, onSortChange,
  canExport, exportCount, exportBusy, exportError, onExport,
}) {
  return <ColumnDialog id="dossier-display-dialog" titleId="dossier-display-title" testId="display-options-dialog" className="dossier-display-options"
    title="Affichage" closeLabel="Fermer l’affichage" anchor={anchor} align="end" onClose={onClose}>
    <div className="dossier-display-section" role="group" aria-labelledby="dossier-display-columns">
      <h3 id="dossier-display-columns" className="dossier-display-section-title">Colonnes</h3>
      <button type="button" data-filter-focus="" aria-haspopup="dialog" className="dossier-display-row" onClick={onOpenColumns}>
        <span>Colonnes</span><ChevronRight size={18} aria-hidden="true" />
      </button>
      <p className="dossier-display-note">{visibleColumnCount === 1 ? `1 colonne affichée sur ${columnCount}` : `${visibleColumnCount} sur ${columnCount} colonnes affichées`}</p>
    </div>

    <div className="dossier-display-section" role="group" aria-labelledby="dossier-display-reading">
      <h3 id="dossier-display-reading" className="dossier-display-section-title">Lecture</h3>
      <label className="dossier-display-field">
        {/* Visible label = accessible name (WCAG 2.5.3, voice control). */}
        <span>Affichage des dossiers</span>
        <select aria-label="Affichage des dossiers" value={layout} onChange={event => onLayoutChange(event.target.value)}>
          {/* One choice for the four tabs of the list. */}
          <option value="auto">Automatique</option><option value="table">Tableau</option><option value="cards">Cartes</option>
        </select>
      </label>
      <DossierTextSizeControl key={textSizeKey} label="Taille du texte" value={textSize} onChange={onTextSizeChange} />
    </div>

    <div className="dossier-display-section" role="group" aria-labelledby="dossier-display-organisation">
      <h3 id="dossier-display-organisation" className="dossier-display-section-title">Organisation</h3>
      <label className="dossier-display-field">
        <span>Regrouper</span>
        <select aria-label="Regrouper les dossiers" value={grouping} onChange={event => onGroupingChange(event.target.value)}>
          <option value="none">Aucun</option><option value="statut">Par étape</option><option value="envoi">Par départ</option><option value="client">Par client</option>
        </select>
      </label>
      {grouping === 'envoi' && <label className="dossier-display-field">
        <span>Dossiers sans départ</span>
        <select aria-label="Dossiers sans départ" value={noDeparture} onChange={event => onNoDepartureChange(event.target.value)}>
          <option value="bottom">En bas</option><option value="top">En haut</option>
        </select>
      </label>}
      <label className="dossier-display-field">
        <span>Tri par défaut</span>
        <select aria-label="Tri par défaut" value={sortValue} onChange={event => onSortChange(event.target.value)}>
          <optgroup label="Ordres de travail">{sortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup>
          <optgroup label="Colonnes du tableau">{sortableColumns.flatMap(column => ['asc', 'desc'].map(direction => <option key={`${column.key}:${direction}`} value={`column:${column.key}:${direction}`}>{column.label} · {dossierTableSortDirectionLabel(column, direction)}</option>))}</optgroup>
        </select>
      </label>
    </div>

    {canExport && <div className="dossier-display-section" role="group" aria-labelledby="dossier-display-export">
      <h3 id="dossier-display-export" className="dossier-display-section-title">Export</h3>
      <button type="button" className="dossier-display-action" disabled={exportBusy || !exportCount} onClick={onExport}>{exportBusy ? 'Export…' : `Exporter ${countLabel(exportCount, 'dossier')} ${countWord(exportCount, 'filtré', 'filtrés')}`}</button>
      {exportError && <p role="alert" className="dossier-display-error">{exportError}</p>}
    </div>}
  </ColumnDialog>;
}

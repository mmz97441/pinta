import React, { useState } from 'react';
import { Edit3, Check, X, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { eur, hasTrack, trackStr, trackCount, waLink } from '../../utils';

export default function ColisInfo() {
  const { sel, selClient: cl, selDest, isStaff, upd, flash, data } = useApp();
  const [editCasier, setEditCasier] = useState(false);
  const [casierTmp, setCasierTmp] = useState('');
  const [moveAll, setMoveAll] = useState(false);
  const [showCasierHist, setShowCasierHist] = useState(false);

  if (!sel) return null;

  // ── Casier save handler (with moveAll support) ──
  const handleSaveCasier = () => {
    const newCasier = casierTmp.trim();
    if (!newCasier) { setEditCasier(false); setCasierTmp(''); return; }

    const oldCasier = sel.casier;

    // Build casier historique entry
    const histEntry = oldCasier ? { casier: oldCasier, date: new Date().toISOString() } : null;
    const updFields = { casier: newCasier };
    if (histEntry) {
      updFields.casierHistorique = [...(sel.casierHistorique || []), histEntry];
    }
    upd(sel.id, updFields);

    // Move all client's active colis if checked
    if (moveAll && cl) {
      const activeColis = data.filter(
        (c) => c.clientId === cl.id && c.id !== sel.id && c.statut !== 'livre' && c.statut !== 'annule'
      );
      activeColis.forEach((c) => {
        const cHistEntry = c.casier ? { casier: c.casier, date: new Date().toISOString() } : null;
        const cUpd = { casier: newCasier };
        if (cHistEntry) {
          cUpd.casierHistorique = [...(c.casierHistorique || []), cHistEntry];
        }
        upd(c.id, cUpd);
      });
      flash(`Casier mis à jour pour ${activeColis.length + 1} colis`);
    } else {
      flash('Casier mis à jour');
    }

    setEditCasier(false);
    setCasierTmp('');
    setMoveAll(false);
  };

  return (
    <div className="card p-4 anim-fade">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase">Contenu</p>
          <p className="font-medium">{sel.desc}</p>
          {sel.valeur > 0 && <p className="text-xs text-gray-500">Valeur déclarée : {eur(sel.valeur)}</p>}
        </div>
        {cl && (
          <div className="text-right">
            <p className="text-xs font-bold text-gray-400">Client</p>
            <p className="text-sm">
              {cl.nom}
              {cl.points > 0 && cl.type === 'particulier' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-1">
                  {cl.points} pts
                </span>
              )}
            </p>
            {selDest && (
              <p className="text-xs mt-0.5">
                <span className="px-1.5 py-0.5 rounded-full bg-gray-100 font-medium">{selDest.flag} {selDest.nom}</span>
              </p>
            )}
            {isStaff && cl.tel && (
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <a href={waLink(cl.tel, '')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold hover:bg-green-200">
                  WhatsApp
                </a>
                <a href={`tel:${cl.tel}`} className="text-xs text-gray-400 hover:text-gray-600">Appeler</a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dimensions */}
      {sel.dimsParColis && sel.dimsParColis.length > 1 ? (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase">
            Dimensions initiales ({sel.dimsParColis.length} colis)
          </p>
          {sel.dimsParColis.map((d, i) => {
            const tracking = sel.trackings?.filter((t) => t)[i];
            return (
              <div key={i} className="rounded-lg bg-gray-50 p-2">
                <p className="text-[10px] font-bold text-gray-400 mb-0.5">
                  {tracking || `Colis ${i + 1}`}
                </p>
                <p className="text-sm">{d.dimL} × {d.dimW} × {d.dimH} cm · {d.poids} kg</p>
                <p className="text-xs text-gray-400">Vol: {((d.dimL * d.dimW * d.dimH) / 5000).toFixed(2)} kg</p>
              </div>
            );
          })}
          {sel.finL && (
            <div className="mt-1">
              <p className="text-xs font-bold uppercase" style={{ color: BRAND.gold }}>Après optimisation</p>
              <p className="text-sm">{sel.finL} × {sel.finW} × {sel.finH} cm</p>
              <p className="text-sm">Poids : {sel.finP || '—'} kg</p>
              <p className="text-xs text-gray-400">Vol: {((sel.finL * sel.finW * sel.finH) / 5000).toFixed(2)} kg</p>
            </div>
          )}
        </div>
      ) : sel.dimL ? (
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase">Dimensions initiales</p>
            <p className="text-sm">{sel.dimL} × {sel.dimW} × {sel.dimH} cm</p>
            <p className="text-sm">Poids : {sel.poids || '—'} kg</p>
            <p className="text-xs text-gray-400">Vol: {((sel.dimL * sel.dimW * sel.dimH) / 5000).toFixed(2)} kg</p>
          </div>
          {sel.finL && (
            <div>
              <p className="text-xs font-bold uppercase" style={{ color: BRAND.gold }}>Après optimisation</p>
              <p className="text-sm">{sel.finL} × {sel.finW} × {sel.finH} cm</p>
              <p className="text-sm">Poids : {sel.finP || '—'} kg</p>
              <p className="text-xs text-gray-400">Vol: {((sel.finL * sel.finW * sel.finH) / 5000).toFixed(2)} kg</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Trackings — rich format if trackingsDetail exists */}
      {hasTrack(sel) && (
        <div className="mt-2 pt-2 border-t">
          <p className="text-xs font-bold text-gray-400 uppercase mb-1">
            N° de suivi origine{trackCount(sel) > 1 ? ` (${trackCount(sel)} colis)` : ''}
          </p>
          {sel.trackingsDetail && sel.trackingsDetail.length > 0 ? (
            sel.trackingsDetail.map((td, i) => (
              <p key={i} className="text-xs font-mono text-gray-500">
                {td.fournisseur ? (
                  <><span className="font-sans font-semibold text-gray-700">{td.fournisseur}</span> — {td.number}</>
                ) : td.number}
              </p>
            ))
          ) : (
            sel.trackings.filter((t) => t).map((t, i) => (
              <p key={i} className="text-xs font-mono text-gray-500">{t}</p>
            ))
          )}
        </div>
      )}

      {/* Casier */}
      {(sel.casier || isStaff) && (
        <div className="mt-2 pt-2 border-t">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400">Casier :</span>
            {editCasier && isStaff ? (
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-1">
                  <input
                    value={casierTmp}
                    onChange={(e) => setCasierTmp(e.target.value.toUpperCase())}
                    className="px-2 py-1 border-2 border-amber-300 rounded-lg text-sm font-mono w-24"
                    style={{ outline: 'none' }}
                    autoFocus
                  />
                  <button onClick={handleSaveCasier} className="p-1 rounded-md text-green-600 hover:bg-green-50 transition-colors">
                    <Check size={16} />
                  </button>
                  <button onClick={() => { setEditCasier(false); setCasierTmp(''); setMoveAll(false); }} className="p-1 rounded-md text-gray-400 hover:bg-gray-100 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                {isStaff && cl && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={moveAll}
                      onChange={(e) => setMoveAll(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer"
                    />
                    <span className="text-[11px] text-gray-600 font-medium">Appliquer à tous les colis de ce client</span>
                  </label>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className={`text-sm font-mono font-bold ${sel.casier ? '' : 'text-gray-300 italic'}`} style={sel.casier ? { color: BRAND.navy } : {}}>
                  {sel.casier || 'Non attribué'}
                </span>
                {isStaff && (
                  <button onClick={() => { setCasierTmp(sel.casier || ''); setEditCasier(true); }} className="text-xs text-gray-400 hover:text-gray-600 ml-1">
                    <Edit3 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Casier history */}
          {sel.casierHistorique && sel.casierHistorique.length > 0 && (
            <div className="mt-1.5">
              <button
                onClick={() => setShowCasierHist(!showCasierHist)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 font-medium transition-colors"
              >
                Historique casier ({sel.casierHistorique.length})
                {showCasierHist ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showCasierHist && (
                <div className="mt-1 pl-2 space-y-0.5">
                  {[...sel.casierHistorique].reverse().map((h, i) => (
                    <p key={i} className="text-[11px] text-gray-400 font-mono">
                      {h.casier} — {new Date(h.date).toLocaleDateString('fr-FR')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notes de réception */}
      {sel.notesReception && (
        <div className="mt-2 pt-2 border-t">
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5">
            <ClipboardList size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-bold text-amber-700 uppercase mb-0.5">Notes de réception</p>
              <p className="text-xs text-amber-900">{sel.notesReception}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tags préparation */}
      {sel.tagsPreparation && sel.tagsPreparation.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t">
          {sel.tagsPreparation.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

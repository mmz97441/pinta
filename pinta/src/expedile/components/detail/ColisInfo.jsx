import { SecureImage } from '../ui/SecureFile';
import { createTelegramInvitation } from '../../services/telegramApi';
import React, { useState } from 'react';
import { Edit3, Check, X, ChevronDown, ChevronUp, ClipboardList, Camera, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS } from '../../constants';
import { eur, hasTrack, trackStr, trackCount, telegramLink } from '../../utils';
import ReceivedCartons from './ReceivedCartons';

export default function ColisInfo() {
  const { sel, selClient: cl, selDest, isStaff, upd, flash, data, settings } = useApp();
  const [editCasier, setEditCasier] = useState(false);
  const [casierTmp, setCasierTmp] = useState('');
  const [moveAll, setMoveAll] = useState(false);
  const [showCasierHist, setShowCasierHist] = useState(false);

  if (!sel) return null;

  // ── Casier save handler (with moveAll support) ──
  const handleSaveCasier = async () => {
    try {
    const newCasier = casierTmp.trim();
    if (!newCasier) { setEditCasier(false); setCasierTmp(''); return; }

    const oldCasier = sel.casier;

    // Build casier historique entry
    const histEntry = oldCasier ? { casier: oldCasier, date: new Date().toISOString() } : null;
    const updFields = { casier: newCasier };
    if (histEntry) {
      updFields.casierHistorique = [...(sel.casierHistorique || []), histEntry];
    }
    await upd(sel.id, updFields);

    // Move all client's active colis if checked (same envoi only)
    if (moveAll && cl) {
      // Only move colis that have NO envoi (locked colis stay in their casier)
      const activeColis = data.filter(
        (c) => c.clientId === cl.id && c.id !== sel.id
          && c.statut !== 'livre' && c.statut !== 'annule'
          && !c.envoi // NEVER move a colis that has an envoi
      );
      for (const c of activeColis) {
        const cHistEntry = c.casier ? { casier: c.casier, date: new Date().toISOString() } : null;
        const cUpd = { casier: newCasier };
        if (cHistEntry) {
          cUpd.casierHistorique = [...(c.casierHistorique || []), cHistEntry];
        }
        await upd(c.id, cUpd);
      }
      const skipped = data.filter(
        (c) => c.clientId === cl.id && c.id !== sel.id
          && c.statut !== 'livre' && c.statut !== 'annule'
          && c.envoi
      ).length;
      flash(skipped > 0
        ? `Casier mis à jour pour ${activeColis.length + 1} colis (${skipped} colis sur un autre envoi non déplacés)`
        : `Casier mis à jour pour ${activeColis.length + 1} colis`
      );
    } else {
      flash('Casier mis à jour');
    }

    setEditCasier(false);
    setCasierTmp('');
    setMoveAll(false);
    }catch(error){flash({msg:`Casier non enregistré : ${error.message}`,type:'error'});}
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
            {cl && !cl.telegramChatId && (
              <button
                onClick={async () => {
                  try{const invitation=await createTelegramInvitation(cl.id);await navigator.clipboard.writeText(invitation.url);flash('Invitation Telegram copiée');}
                  catch(error){flash({msg:error.message,type:'error'});}
                }}
                className="text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
              >
                Inviter sur Telegram
              </button>
            )}
            {cl.abonnement && (() => {
              const abo = ABONNEMENTS[cl.abonnement];
              const isFreemium = cl.abonnement === 'freemium';
              const fin = cl.abonnementFin ? new Date(cl.abonnementFin) : null;
              const now = new Date();
              const joursRestants = fin ? Math.ceil((fin - now) / (1000 * 60 * 60 * 24)) : null;
              const isExpired = joursRestants !== null && joursRestants <= 0;
              const isWarning = joursRestants !== null && joursRestants > 0 && joursRestants <= 7;
              const isAnnuel = cl.abonnement === 'premium_annuel' || cl.abonnement === 'vip';

              return (
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${abo?.couleur || 'bg-gray-200 text-gray-600'}`}>
                      {abo?.icon} {abo?.label || cl.abonnement}
                    </span>
                    {!isFreemium && fin && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        isExpired ? 'bg-red-100 text-red-700' : isWarning ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {isExpired
                          ? 'Expiré'
                          : `Fin : ${fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        }
                      </span>
                    )}
                  </div>
                  {isStaff && isExpired && !isFreemium && (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-red-50 border border-red-200">
                      <AlertTriangle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] font-bold text-red-700">
                        Abonnement expiré — préparation et expédition bloquées.
                        {isAnnuel ? ' Le client doit renouveler.' : ' Renouvellement requis.'}
                      </p>
                    </div>
                  )}
                  {isStaff && isWarning && !isFreemium && (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] font-bold text-amber-700">
                        Abonnement expire dans {joursRestants} jour{joursRestants > 1 ? 's' : ''}
                        {isAnnuel ? ' — penser à prévenir le client.' : '.'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
            {selDest && (
              <p className="text-xs mt-0.5">
                <span className="px-1.5 py-0.5 rounded-full bg-gray-100 font-medium">{selDest.flag} {selDest.nom}</span>
              </p>
            )}
            {isStaff && cl.tel && (
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <button onClick={async()=>{
                  try{const invitation=await createTelegramInvitation(cl.id);await navigator.clipboard.writeText(invitation.url);flash('Invitation Telegram copiée. Transmettez-la au client.');}
                  catch(error){flash({msg:error.message,type:'error'});}
                }} className="inline-flex items-center min-h-[44px] gap-1 text-xs bg-blue-100 text-blue-700 px-3 rounded-xl font-bold">Inviter sur Telegram</button>
                <a href={`tel:${cl.tel}`} className="text-xs text-gray-400 hover:text-gray-600">Appeler</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t"><ReceivedCartons colis={sel} settings={settings} /></div>

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

      {/* Photo de réception */}
      {sel.photoReceptionUrl && (
        <div className="mt-2 pt-2 border-t flex items-center gap-1.5 text-xs text-gray-500">
          <Camera size={12} />
          <SecureImage src={sel.photoReceptionUrl} alt="Photo du colis à réception" className="max-h-64 w-full object-contain rounded-xl"/>
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

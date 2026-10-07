import { SecureImage } from '../ui/SecureFile';
import { createTelegramInvitation } from '../../services/telegramApi';
import React, { useEffect, useRef, useState } from 'react';
import { Edit3, ChevronDown, ChevronUp, ClipboardList, Camera, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ABONNEMENTS } from '../../constants';
import { eur } from '../../utils';
import ReceivedCartons from './ReceivedCartons';
import CasierEditor, { casierEditable } from './CasierEditor';

export default function ColisInfo({ compact = false, onCompleteReception, casierEditRequest = 0 }) {
  const { sel, selClient: cl, selDest, isStaff, flash, settings, can } = useApp();
  const [editCasier, setEditCasier] = useState(false);
  const [casierSaved, setCasierSaved] = useState('');
  const [showCasierHist, setShowCasierHist] = useState(false);
  const casierEditButton = useRef(null);
  const wasEditingCasier = useRef(false);
  const handledCasierRequest = useRef(0);

  const canEditCasier = isStaff && casierEditable(sel, can);
  useEffect(() => {
    if (!canEditCasier || !casierEditRequest || casierEditRequest === handledCasierRequest.current) return;
    handledCasierRequest.current = casierEditRequest;
    // A direct request opens the editor without replacing an unsaved correction
    // when the live dossier receives a colleague's update.
    if (!editCasier) { setCasierSaved(''); setEditCasier(true); }
  }, [casierEditRequest, canEditCasier, editCasier]);
  // The editor focuses its own field; closing it returns to « Modifier le casier ».
  useEffect(() => {
    if (editCasier) { wasEditingCasier.current = true; return; }
    if (wasEditingCasier.current) casierEditButton.current?.focus();
    wasEditingCasier.current = false;
  }, [editCasier]);

  if (!sel) return null;
  const canInvite = isStaff && (can('perm_comm_telegram') || can('perm_clients_creer'));

  return (
    <div className="card p-4 anim-fade">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-bold text-gray-600 uppercase">Contenu</p>
          <p className="font-medium">{sel.desc}</p>
          {sel.valeur > 0 && <p className="text-xs text-gray-500">Valeur déclarée : {eur(sel.valeur)}</p>}
        </div>
        {cl && !compact && (
          <div className="text-right">
            <p className="text-xs font-bold text-gray-600">Client</p>
            <p className="text-sm">
              {cl.nom}
              {cl.points > 0 && cl.type === 'particulier' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-1">
                  {cl.points} pts
                </span>
              )}
            </p>
            {canInvite && !cl.telegramChatId && !cl.tel && (
              <button
                onClick={async () => {
                  try{const invitation=await createTelegramInvitation(cl.id);await navigator.clipboard.writeText(invitation.url);flash('Invitation Telegram copiée');}
                  catch(error){flash({msg:error.message,type:'error'});}
                }}
                className="min-h-11 text-xs font-semibold px-3 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
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
                {canInvite && !cl.telegramChatId && <button onClick={async()=>{
                  try{const invitation=await createTelegramInvitation(cl.id);await navigator.clipboard.writeText(invitation.url);flash('Invitation Telegram copiée. Transmettez-la au client.');}
                  catch(error){flash({msg:error.message,type:'error'});}
                }} className="inline-flex items-center min-h-[44px] gap-1 text-xs bg-blue-100 text-blue-700 px-3 rounded-xl font-bold">Inviter sur Telegram</button>}
                <a href={`tel:${cl.tel}`} className="inline-flex min-h-11 items-center text-xs text-gray-600 hover:text-gray-800">Appeler</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t"><ReceivedCartons colis={sel} settings={settings} onCompleteReception={onCompleteReception} /></div>

      {/* Casier: one line (label, value and « Modifier » on the same centre line),
          or the editor in its place, its label above the field. */}
      {(sel.casier || isStaff) && (
        <div className="mt-2 pt-2 border-t">
          {editCasier && canEditCasier ? <CasierEditor variant="panel" onDone={result => { setCasierSaved(result?.saved ? result.message : ''); setEditCasier(false); }} /> : (
            <div className="flex min-h-11 items-center gap-2">
              <span className="text-xs font-bold text-gray-600">Casier :</span>
              <span className={`text-sm font-mono font-bold ${sel.casier ? '' : 'text-gray-500 italic'}`} style={sel.casier ? { color: 'var(--brand-text)' } : {}}>
                {sel.casier || 'Non attribué'}
              </span>
              {canEditCasier && (
                <button ref={casierEditButton} aria-label="Modifier le casier" onClick={() => { setCasierSaved(''); setEditCasier(true); }} className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-800">
                  <Edit3 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {/* The toast stays under this panel: the confirmation is repeated here. */}
          {casierSaved && !editCasier && <p role="status" className="dossier-casier-saved">{casierSaved}</p>}

          {/* Casier history */}
          {sel.casierHistorique && sel.casierHistorique.length > 0 && (
            <div className="mt-1.5">
              <button
                onClick={() => setShowCasierHist(!showCasierHist)}
                aria-expanded={showCasierHist}
                className="flex min-h-11 items-center gap-1 text-[11px] text-gray-600 hover:text-gray-600 font-medium transition-colors"
              >
                Historique casier ({sel.casierHistorique.length})
                {showCasierHist ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showCasierHist && (
                <div className="mt-1 pl-2 space-y-0.5">
                  {[...sel.casierHistorique].reverse().map((h, i) => (
                    <p key={i} className="text-[11px] text-gray-600 font-mono">
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

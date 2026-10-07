import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { plural, pluralWord } from '../../domain/plural';
import './dossierActions.css';
import './dossierDeparture.css';

/** Who may change the casier: the same rule in the overview and the details panel. */
export function casierEditable(dossier, can = () => false) {
  return Boolean(dossier) && !dossier.archive && !['livre', 'annule'].includes(dossier.statut)
    && ['perm_colis_receptionner', 'perm_colis_preparer', 'perm_colis_modifier_dims'].some(permission => can(permission));
}

/** The casier of the open dossier, edited in place: in the overview (`summary`,
 * below the heading like the Départ field) or in the details panel (`panel`).
 * Its label sits above the field, so label and field always line up. Nothing
 * is shown as saved before the server's answer; a refusal keeps the typed value
 * and says why under the field. « Appliquer à tous les colis de ce client »
 * moves the client's other open dossiers without a departure, as before.
 * `onDone(result)` closes the editor: `{ saved: true, message }` once the
 * server confirmed, nothing when cancelled; its caller gives the focus back to
 * its « Modifier » button. */
export default function CasierEditor({ id, variant = 'panel', onDone }) {
  const { sel: dossier, selClient: client, data = [], upd, flash } = useApp();
  const [value, setValue] = useState(dossier?.casier || '');
  const [moveAll, setMoveAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const input = useRef(null);
  const inputId = useId(), errorId = useId();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      // scroll-margin (dossierActions.css) keeps it clear of the phone's bottom navigation.
      input.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!dossier) return null;
  const cancel = () => { if (!lock.current) onDone?.(); };
  const save = async () => {
    if (lock.current) return;
    const next = value.trim();
    if (!next) { setError('Indiquez le casier, ou annulez la modification.'); input.current?.focus(); return; }
    lock.current = true; setBusy(true); setError('');
    let saved = 0;
    try {
      const now = new Date().toISOString();
      const moved = (item, casier) => ({ casier, ...(item.casier ? { casierHistorique: [...(item.casierHistorique || []), { casier: item.casier, date: now }] } : {}) });
      // An unchanged casier writes nothing (and adds no history entry).
      if (next !== (dossier.casier || '')) await upd(dossier.id, moved(dossier, next));
      saved = 1;
      let kept = 0;
      if (moveAll && client) {
        const open = data.filter(item => item.clientId === client.id && item.id !== dossier.id && item.statut !== 'livre' && item.statut !== 'annule');
        // A dossier on a departure keeps its casier.
        kept = open.filter(item => item.envoi).length;
        for (const item of open.filter(item => !item.envoi)) {
          if ((item.casier || '') !== next) await upd(item.id, moved(item, next));
          saved += 1;
        }
      }
      const message = moveAll ? `Casier ${next} enregistré pour ${saved} colis${kept ? ` (${kept} colis sur un départ non ${pluralWord(kept, 'déplacé')})` : ''}.` : `Casier ${next} enregistré.`;
      flash(message);
      onDone?.({ saved: true, message });
    } catch (failure) {
      const reason = failure?.message || 'Enregistrement impossible.';
      setError(saved > 0
        ? `Casier ${next} enregistré pour ${plural(saved, 'colis', 'colis')} ; les autres colis du client n’ont pas été modifiés : ${reason} Réessayez pour les déplacer.`
        : `Casier non enregistré : ${reason}`);
    } finally {
      lock.current = false; setBusy(false);
    }
  };
  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  };

  return <div id={id} className="dossier-casier-editor" data-variant={variant} aria-busy={busy || undefined}>
    <label htmlFor={inputId} className="dossier-departure-label">Casier du dossier</label>
    <div className="dossier-casier-row">
      <input ref={input} id={inputId} className="dossier-casier-input" value={value} readOnly={busy} autoComplete="off" spellCheck={false}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        onChange={event => { setValue(event.target.value.toUpperCase()); setError(''); }} onKeyDown={onKeyDown} />
      {/* The visible « Enregistrer » stays inside the accessible name, also while saving. */}
      <button type="button" className="dossier-primary-button" aria-label="Enregistrer le casier" disabled={busy} onClick={save}>
        {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Check size={16} aria-hidden="true" />}<span>Enregistrer</span>
      </button>
      <button type="button" className="dossier-departure-cancel" aria-label="Annuler la modification du casier" disabled={busy} onClick={cancel}>Annuler</button>
    </div>
    {client && <label className="dossier-casier-all">
      <input type="checkbox" checked={moveAll} disabled={busy} onChange={event => setMoveAll(event.target.checked)} />
      <span>Appliquer à tous les colis de ce client</span>
    </label>}
    {error && <p id={errorId} role="alert" className="dossier-departure-error">{error}</p>}
  </div>;
}

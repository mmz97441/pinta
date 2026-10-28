import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The message sheet of a page (ConsentSheet): which dossier it shows (`sheet` = { id, title }), the selection
 * TaskMessage reads (`setSelId`), and the confirmation of what was sent from it, by dossier. `focusAfter(id)`
 * gives the focus back once the sheet is closed (the line's action, or its name when the action is gone).
 */
export default function useConsentSheet({ setSelId, focusAfter }) {
  const [sheet, setSheet] = useState(null);
  const [confirmations, setConfirmations] = useState({});
  const current = useRef(null);
  current.current = sheet;
  const focus = useRef(focusAfter);
  focus.current = focusAfter;

  const open = useCallback((id, title) => {
    setSelId(id);
    setConfirmations(previous => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setSheet({ id, title });
  }, [setSelId]);
  const close = useCallback(() => {
    const shown = current.current;
    if (!shown) return;
    setSheet(null);
    setSelId(selected => selected === shown.id ? null : selected);
    requestAnimationFrame(() => focus.current?.(shown.id));
  }, [setSelId]);
  const sent = useCallback(text => {
    const shown = current.current;
    if (!shown) return;
    setConfirmations(previous => ({ ...previous, [shown.id]: text }));
    close();
  }, [close]);
  // Leaving the page releases the selection the sheet took.
  useEffect(() => () => {
    const shown = current.current;
    if (shown) setSelId(selected => selected === shown.id ? null : selected);
  }, [setSelId]);
  return { sheet, open, close, sent, confirmations };
}

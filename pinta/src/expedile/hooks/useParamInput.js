import { useEffect, useRef, useState } from 'react';

/**
 * A text field whose value lives in the address (?q=…). The router applies an
 * address change in a transition, so a field bound to the address directly is
 * reset to its previous value after every keystroke until the transition ends:
 * a barcode scanner, which types a whole reference at once, would search for
 * « X5 » instead of « EXP-2026-0355 ». The field keeps the text as typed and
 * the address follows it; a change made elsewhere (« Effacer les filtres »,
 * the back button) comes back into the field.
 * Returns [text, change]: the text to show, and the function for onChange.
 */
export default function useParamInput(value, commit) {
  const [text, setText] = useState(value);
  // The values sent to the address that it has not shown yet, in order.
  const sent = useRef([]);
  useEffect(() => {
    const index = sent.current.indexOf(value);
    if (index >= 0) { sent.current = sent.current.slice(index + 1); return; }
    sent.current = [];
    setText(value);
  }, [value]);
  const change = next => { sent.current.push(next); setText(next); commit(next); };
  return [text, change];
}

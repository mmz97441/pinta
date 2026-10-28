import { useEffect, useRef } from 'react';

// A barcode scanner (« douchette ») types a whole code in a few milliseconds, then Enter; a person is much slower.
const SCAN_GAP = 60; // ms at most between two characters of one scan
const SCAN_MIN = 4; // characters at least (a casier « C-03 », a reference, a tracking number)
const typingInto = element => Boolean(element) && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));

/**
 * A scan made while no field has the focus: `onScan(text)` on its Enter. No field is focused for it (a tablet would
 * open its keyboard), and neither its Enter nor a Space inside it reaches the button or the link that has the
 * focus. Enter pressed by a person, on a button, keeps its usual effect. Nothing is taken while `enabled` is false
 * or a dialog is open.
 */
export default function useScanner({ enabled = true, onScan }) {
  const handler = useRef(onScan);
  handler.current = onScan;
  const active = useRef(enabled);
  active.current = enabled;
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const onKeyDown = event => {
      if (!active.current || event.ctrlKey || event.metaKey || event.altKey || event.isComposing
        || typingInto(document.activeElement) || document.querySelector('[role="dialog"][aria-modal="true"]')) { buffer = ''; return; }
      const now = event.timeStamp;
      if (buffer && now - last > SCAN_GAP) buffer = '';
      if (event.key === 'Enter') {
        const text = buffer;
        buffer = '';
        if (text.length < SCAN_MIN) return;
        event.preventDefault();
        event.stopPropagation();
        handler.current?.(text);
        return;
      }
      if (event.key.length !== 1) return; // Shift between two characters, an arrow…
      // Inside a scan, a focused button never reacts (a Space in a tracking number).
      if (buffer) event.preventDefault();
      buffer += event.key;
      last = now;
    };
    const onKeyUp = event => { if (buffer && event.key === ' ') event.preventDefault(); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);
}

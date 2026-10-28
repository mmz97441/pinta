/**
 * Copies a text to the clipboard: the Clipboard API first, then a selected off-screen field and the browser's
 * copy command (an older tablet, a page without the permission). True only when the browser confirmed the copy;
 * otherwise the caller selects the text so that it can be copied by hand.
 */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* the copy command below */ }
  if (typeof document === 'undefined') return false;
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
  const focused = document.activeElement;
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
    if (focused && typeof focused.focus === 'function') focused.focus({ preventScroll: true });
  }
}

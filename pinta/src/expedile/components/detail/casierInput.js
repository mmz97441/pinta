/** A casier is written in capitals as it is typed, the caret staying where it
 * is: a lowercase letter typed in the middle of « C-003 » stays in the middle
 * (React would otherwise move the caret to the end). The field's value is
 * changed in place before React compares it, so React leaves the caret alone.
 * Returns the new value. Casier editor and reception form. */
export function upperCaseInPlace(input) {
  const upper = input.value.toUpperCase();
  if (upper !== input.value) {
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.value = upper;
    if (selectionStart != null) input.setSelectionRange(selectionStart, selectionEnd, selectionDirection || 'none');
  }
  return upper;
}

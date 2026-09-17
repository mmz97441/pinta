// Drafts stay in this browser tab and are partitioned by authenticated account.
// In-memory fallback preserves navigation when browser storage is unavailable.
const PREFIX = 'expedile:draft:v1:';
const memory = new Map();
export const draftKey = (owner, scope) => owner && scope ? `${PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(scope)}` : null;
const storage = () => { try { return globalThis.sessionStorage; } catch { return null; } };
export function readDraft(key, fallback, target = storage()) {
  if (!key) return fallback;
  if (memory.has(key)) return memory.get(key);
  try { const raw = target?.getItem(key); if (raw != null) { const value = JSON.parse(raw).value; memory.set(key, value); return value; } } catch { /* Corrupt or blocked storage must not prevent writing. */ }
  return fallback;
}
export function writeDraft(key, value, target = storage()) {
  if (!key) return false;
  memory.set(key, value);
  try { if (!target) return false; target.setItem(key, JSON.stringify({ value })); return true; } catch { return false; }
}
export function removeDraft(key, target = storage()) {
  if (!key) return;
  memory.delete(key);
  try { target?.removeItem(key); } catch { /* Memory is still cleared. */ }
}
export function clearDrafts(target = storage()) {
  memory.clear();
  try { for (let i = target.length - 1; i >= 0; i--) { const key = target.key(i); if (key?.startsWith(PREFIX)) target.removeItem(key); } } catch { /* Storage may be disabled. */ }
}

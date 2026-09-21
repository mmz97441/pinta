// This registry describes local, unsaved work in this tab. It never contains
// form values and never claims that a draft has been shared with a colleague.
// Entries intentionally survive component unmount, like the editors' caches.
const drafts = new Map();
const valid = value => typeof value === 'string' && value.trim().length > 0;
const keyFor = (userId, dossierId, kind, source) => [userId, dossierId, kind, source].every(valid)
  ? JSON.stringify([userId, dossierId, kind, source]) : null;

export function registerWorkDraft(userId, dossierId, kind, source, dirty, label) {
  const key = keyFor(userId, dossierId, kind, source);
  if (!key) return;
  if (!dirty) { drafts.delete(key); return; }
  drafts.set(key, { userId, dossierId, kind, source, label: valid(label) ? label : 'Modifications non enregistrées' });
}

export function pendingWorkDrafts(userId, dossierId, kind) {
  if (!valid(userId) || !valid(dossierId)) return [];
  return [...drafts.values()].filter(draft => draft.userId === userId && draft.dossierId === dossierId && (!kind || draft.kind === kind))
    .map(draft => ({ ...draft }));
}

export function clearWorkDrafts(userId) {
  if (userId == null) { drafts.clear(); return; }
  for (const [key, draft] of drafts) if (draft.userId === userId) drafts.delete(key);
}

/** Comparable revision of an ISO timestamp, or null when it is not a valid one. */
export function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  // PostgreSQL timestamps retain microseconds; Date alone discards the final three.
  const fraction = (value.match(/\.(\d+)/)?.[1] || '').padEnd(6,'0');
  return `${Date.parse(value)}:${fraction.slice(3)}`;
}

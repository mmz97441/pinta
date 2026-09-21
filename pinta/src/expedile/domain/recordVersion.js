const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  // Date discards PostgreSQL's final three fractional digits. Preserve them
  // so an older row within the same millisecond never unlocks a comparison.
  const fraction = (value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0');
  return BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3));
};

export function recordVersionAtLeast(current, expected) {
  const actual = timestamp(current), baseline = timestamp(expected);
  return actual !== null && baseline !== null && actual >= baseline;
}

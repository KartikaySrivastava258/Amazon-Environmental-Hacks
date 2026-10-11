// Re-exports plus small date helper, kept separate to avoid circular imports.
export * from './catalog.js';
export function monthOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

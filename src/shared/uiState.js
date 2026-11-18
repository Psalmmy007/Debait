// Presentation only: never assigns a category or changes an AI result.
export const LIVE_KINDS = ['rage', 'fear', 'envy', 'clean'];
export function orbFeedback({ results = [], busy = false, error = false, unavailable = false, disabled = false } = {}) {
  if (disabled) return { state: 'disabled', category: null, label: 'Debait is disabled' };
  if (unavailable) return { state: 'unavailable', category: null, label: 'AI is unavailable' };
  if (error) return { state: 'error', category: null, label: 'Some headlines could not be analyzed' };
  if (busy) return { state: 'busy', category: null, label: 'Reading headlines' };
  const counts = Object.fromEntries(LIVE_KINDS.map(k => [k, 0]));
  for (const r of results) if (r && ['cloud', 'on-device'].includes(r.source) && LIVE_KINDS.includes(r.kind)) counts[r.kind]++;
  const max = Math.max(...Object.values(counts));
  if (!max) return { state: 'empty', category: null, label: 'No verified analysis on this page yet' };
  const leaders = LIVE_KINDS.filter(k => counts[k] === max);
  if (leaders.length !== 1) return { state: 'mixed', category: null, label: 'Mixed categories: no single most common category' };
  const category = leaders[0];
  return { state: category, category, label: `${category[0].toUpperCase() + category.slice(1)} is the most common analyzed category on this page` };
}

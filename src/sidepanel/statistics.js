// Read-only presentation calculations. Never modify stored statistics or infer
// an emotion from missing, inconsistent or tied counts.
export const KINDS = ['rage', 'fear', 'envy', 'clean'];
const EMOTIONS = ['rage', 'fear', 'envy'];
const LABEL = { rage: 'Rage', fear: 'Fear', envy: 'Envy' };
const count = value => Number.isSafeInteger(value) && value >= 0;
const empty = () => ({ total: 0, rage: 0, fear: 0, envy: 0, clean: 0, debaited: 0, sources: Object.create(null) });

export function summarizeWeek(days) {
  const sum = empty(); let complete = true;
  const rates = days.map(input => {
    const day = { ...empty(), ...input };
    const categorized = KINDS.reduce((n, k) => n + (count(day[k]) ? day[k] : 0), 0);
    const valid = ['total', ...KINDS].every(k => count(day[k])) && categorized === day.total;
    complete &&= valid;
    if (count(day.total)) sum.total += day.total;
    if (count(day.debaited)) sum.debaited += day.debaited;
    if (!valid) return null;
    for (const kind of KINDS) sum[kind] += day[kind];
    const bait = day.rage + day.fear + day.envy;
    const sources = Object.entries(day.sources && typeof day.sources === 'object' ? day.sources : {})
      .filter(([, n]) => count(n) && n > 0);
    // Sources count flagged headlines, not category-specific counts. Corrupt source
    // totals must not be used to claim a site's contribution to any emotion.
    if (sources.reduce((n, [, value]) => n + value, 0) <= bait) {
      for (const [host, n] of sources) sum.sources[host] = (sum.sources[host] || 0) + n;
    }
    return day.total > 0 ? bait / day.total : null;
  });
  complete &&= ['total', ...KINDS].every(k => count(sum[k]));
  const bait = sum.rage + sum.fear + sum.envy;
  const percentage = n => complete && sum.total > 0 && count(n) && n <= sum.total
    ? Math.round(n / sum.total * 100) : null;
  return { sum, complete, bait, rates, percentage };
}

export function recommendation(summary, sample = false) {
  if (sample) return 'Sample statistics only. These made-up counts do not describe your reading.';
  const { sum, complete, bait, percentage } = summary;
  if (!complete) return 'Category statistics are incomplete or inconsistent. No reliable category recommendation is available for this period.';
  if (!sum.total) return 'No analyzed headlines yet. Browse with Debait enabled, then return to see your reading statistics.';
  if (!bait) return `All analyzed headlines in this period were classified Clean (${sum.total}). No emotional category was flagged.`;
  const maximum = Math.max(...EMOTIONS.map(k => sum[k]));
  const leaders = EMOTIONS.filter(k => sum[k] === maximum).map(k => LABEL[k]);
  const names = leaders.length === 3 ? `${leaders[0]}, ${leaders[1]} and ${leaders[2]}` : leaders.join(' and ');
  if (leaders.length > 1) return `${names} are tied as the most common flagged categories (${maximum} each out of ${sum.total} analyzed headlines). Review the explanations before deciding whether to rewrite.`;
  return `${names} was the most common flagged category (${maximum} of ${sum.total} analyzed headlines, ${percentage(maximum)}%). Review the explanations before deciding whether to rewrite.`;
}

export const statisticsMode = sample => ({
  badge: sample ? 'Sample data' : 'Real numbers',
  sampleFoot: 'The sample week contains made-up counts and sources. It is not your reading and is never saved.',
});

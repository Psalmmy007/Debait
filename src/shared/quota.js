// Only scalar scheduling metadata is passed between contexts; never provider payloads.
export function retryDelayMs(error, now = Date.now()) {
  const delays = [];
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) delays.push(error.retryAfterMs);
  const header = error?.response?.headers?.get?.('Retry-After') ?? error?.headers?.get?.('Retry-After');
  if (header != null) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
    if (Number.isFinite(delay) && delay >= 0) delays.push(delay);
  }
  for (const detail of Array.isArray(error?.customData?.errorDetails) ? error.customData.errorDetails : []) {
    if (!String(detail?.['@type']).endsWith('google.rpc.RetryInfo')) continue;
    const value = detail.retryDelay;
    const delay = typeof value === 'string' && /^\d+(?:\.\d+)?s$/.test(value) ? parseFloat(value) * 1000
      : value && Number.isFinite(Number(value.seconds)) ? Number(value.seconds) * 1000 + Number(value.nanos || 0) / 1e6 : NaN;
    if (Number.isFinite(delay) && delay >= 0) delays.push(delay);
  }
  return Math.max(0, ...delays);
}
export function quotaError(message, retryAt, autoRetry = true, code = 'debait/quota') {
  return Object.assign(new Error(message), { code, retryAt, autoRetry });
}
export function isQuotaError(error) { return String(error?.code || '').startsWith('debait/quota'); }

// A per-headline budget stops tab timers from becoming unlimited model retry loops.
export function planAnalysisRetry(records, error, now = Date.now(), random = Math.random) {
  const eligible = [];
  for (const record of records) {
    const pacing = error.code === 'debait/quota-pacing';
    const field = pacing ? 'pacingDeferrals' : 'analysisRetries';
    const limit = pacing ? 30 : 2;
    if (error.autoRetry === false || (record[field] || 0) >= limit || error.retryAt - now > 2147483647) { record.retryStopped = true; continue; }
    record[field] = (record[field] || 0) + 1;
    eligible.push(record);
  }
  return eligible.length ? { records: eligible, at: Math.max(now + 1000, error.retryAt || now + 60000) + Math.floor(random() * 2000) } : null;
}

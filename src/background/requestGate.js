import { quotaError, retryDelayMs, isQuotaError } from '../shared/quota.js';

// Defaults are conservative local budgets; configured values are not Google allocations.
// This is not a project-wide reservation.
export function createRequestGate({ read, write, now = Date.now, random = Math.random,
  intervalMs = 10000, dailyLimit = 240, leaseMs = 45000 } = {}) {
  let state, loading, active = false;
  async function load() {
    return loading ||= (async () => {
      const saved = await read();
      state = { day: '', count: 0, nextAt: 0, retryAt: 0, busyUntil: 0, failures: 0, ...saved };
    })().catch(error => { loading = undefined; throw error; });
  }
  return {
    async run(operation) {
      await load();
      const time = now(), day = new Date(time).toISOString().slice(0, 10);
      if (state.day !== day) { state.day = day; state.count = 0; }
      if (state.count >= dailyLimit) {
        throw quotaError('Analysis paused: Debait reached this installation’s local daily request budget. No classification was produced.', Date.parse(`${day}T00:00:00Z`) + 86400000, false, 'debait/quota-daily');
      }
      if (time < state.retryAt) throw quotaError('Gemini server rate limit: analysis is paused until the shared cooldown ends.', state.retryAt, state.failures < 3);
      if (active || time < state.busyUntil || time < state.nextAt) {
        throw quotaError('Waiting for Debait’s local request slot. No classification was produced.', Math.max(time + intervalMs, state.nextAt, active ? 0 : state.busyUntil), true, 'debait/quota-pacing');
      }
      active = true;
      state.count++;
      state.nextAt = time + intervalMs;
      state.busyUntil = time + leaseMs;
      try {
        await write({ ...state }); // Reserve before dispatch; survives worker restarts.
        const result = await operation();
        state.failures = 0; state.retryAt = 0;
        return result;
      } catch (error) {
        if (isQuotaError(error)) {
          state.failures++;
          const backoff = Math.min(300000, 30000 * 2 ** Math.min(state.failures - 1, 4));
          state.retryAt = now() + Math.max(backoff, retryDelayMs(error, now())) + Math.floor(random() * 2000);
          throw quotaError('Gemini server rate limit: no analysis was produced. ' + (state.failures >= 3 ? 'Automatic retries stopped; try again later.' : 'A limited retry will be attempted after the shared cooldown.'), state.retryAt, state.failures < 3);
        }
        throw error;
      } finally {
        state.busyUntil = 0;
        try { await write({ ...state }); } finally { active = false; }
      }
    },
  };
}

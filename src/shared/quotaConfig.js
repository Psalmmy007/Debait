// Local operating budgets, not claims about any Google model's allocation.
// Use current project/model quota information before selecting these public build settings.
export function quotaConfig(env = {}) {
  const integer = (name, fallback) => {
    if (env[name] === undefined || env[name] === '') return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const rpm = integer('VITE_DEBAIT_QUOTA_RPM', 6);
  const dailyLimit = integer('VITE_DEBAIT_QUOTA_RPD', 240);
  return { rpm, intervalMs: Math.max(1, Math.ceil(60000 / rpm)), dailyLimit };
}

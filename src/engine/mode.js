// Both switches must be explicit; setting the variable in a normal build is insufficient.
export function isDemoBuild(env) {
  return env?.MODE === 'demo' && env?.VITE_DEBAIT_ENGINE === 'mock';
}
export const DEMO_MODE = isDemoBuild(import.meta.env);

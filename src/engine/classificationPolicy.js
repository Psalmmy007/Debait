import { baselineHeadlinePrompt, BASELINE_POLICY_VERSION } from './policies/baseline-v4.js';
import { SUBTLE_CLASSIFICATION, CANDIDATE_POLICY_VERSION } from './policies/subtle-v5.js';
export const POLICY_VARIANTS = ['baseline-v4', 'subtle-v5'];
export function classificationPolicy(variant = 'subtle-v5') {
  if (!POLICY_VARIANTS.includes(variant)) throw new Error('Unsupported Debait classification policy. Use baseline-v4 or subtle-v5.');
  return {
    variant, version: variant === 'baseline-v4' ? BASELINE_POLICY_VERSION : CANDIDATE_POLICY_VERSION,
    prompt(texts) {
      const baseline = baselineHeadlinePrompt(texts);
      if (variant === 'baseline-v4') return baseline;
      const start = baseline.indexOf('Classification:\n');
      const end = baseline.indexOf('\nRewrite policy:');
      if (start < 0 || end < start) throw new Error('Frozen baseline prompt structure changed.');
      return baseline.slice(0, start) + SUBTLE_CLASSIFICATION + '\n' + baseline.slice(end);
    },
  };
}
// This experiment defaults to the candidate; existing branches remain untouched.
// Build-time selection only: no page/message can switch policy during a run.
const selected = classificationPolicy(import.meta.env?.VITE_DEBAIT_CLASSIFICATION_POLICY || 'subtle-v5');
export const CLASSIFICATION_POLICY_VARIANT = selected.variant;
export const QUALITY_POLICY_VERSION = selected.version;
export const headlinePrompt = selected.prompt;

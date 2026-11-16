import { rewriteDecision } from './qualityPolicy.js';

// The one shape every Debait engine must follow.
// The UI only ever talks to an engine through these three functions,
// so the mock engine and the real Firebase engine are interchangeable.
// See docs/ENGINE.md.

/**
 * @typedef {'rage'|'fear'|'envy'|'clean'} BaitKind
 *
 * @typedef {Object} Trigger
 * @property {string} word   Exact words as they appear in the headline, e.g. "DESTROYING".
 * @property {string} why    Short reason, e.g. "outrage trigger".
 *
 * @typedef {Object} ScoreResult
 * @property {BaitKind} kind
 * @property {number} score            0 (calm) to 100 (pure bait).
 * @property {Trigger[]} triggers
 * @property {string} honest_rewrite   Calm, honest version of the headline.
 * @property {'on-device'|'cloud'|'mock'} source   Where this result was computed.
 * @property {'clean'|'model_unchanged'|'preservation_guard'|'semantic_change_risk'|'alternative'} [rewriteReason] Internal enum only; never raw rejected text.
 *
 * @typedef {Object} EngineStatus
 * @property {boolean} ready
 * @property {'on-device'|'cloud'|'mock'|'none'} source
 * @property {boolean} localOnly
 * @property {number} [downloading]    0..1 while Gemini Nano downloads.
 * @property {string} [message]        Human-readable status/error.
 *
 * @typedef {Object} Engine
 * @property {(texts: string[], opts: {localOnly: boolean}) => Promise<ScoreResult[]>} scoreHeadlines
 *           Must return one result per input text, in the same order.
 * @property {(opts: {localOnly: boolean}) => Promise<EngineStatus>} getStatus
 * @property {() => Promise<EngineStatus>} initDeviceModel   Called after the user clicks "Turn on Debait".
 */

export const KINDS = ['rage', 'fear', 'envy', 'clean'];

// Message types used between content script, service worker and offscreen page.
export const MSG = {
  SCORE: 'debait/score',
  STATUS: 'debait/status',
  INIT: 'debait/init',
};

/** Reject absent/malformed answers instead of manufacturing a clean classification. */
export function normalizeResult(r, text) {
  if (!KINDS.includes(r?.kind) || !Number.isFinite(r?.score) ||
      !Array.isArray(r?.triggers) || r.triggers.some(t => typeof t?.word !== 'string' || typeof t?.why !== 'string') ||
      typeof r?.honest_rewrite !== 'string' || !r.honest_rewrite.trim() ||
      !['on-device', 'cloud', 'mock'].includes(r?.source)) {
    throw new Error('AI returned an invalid result. No classification was produced.');
  }
  const { kind, source } = r;
  const score = Math.max(0, Math.min(100, Math.round(r.score)));
  const triggers = r.triggers.filter(t => t.word.trim()).slice(0, 6);
  const decision = rewriteDecision(text, r.honest_rewrite.trim(), kind);
  // Preserve this enum through internal normalization/cache hops, never raw model payloads.
  const rewriteReason = decision.reason === 'model_unchanged' && ['preservation_guard', 'semantic_change_risk'].includes(r.rewriteReason)
    ? r.rewriteReason : decision.reason;
  return { kind, score, triggers, honest_rewrite: decision.text, source, rewriteReason };
}

import { rewriteDecision } from './qualityPolicy.js';

// The one shape every Debait engine must follow.
// Classification and status share one interface. Interactive assistance uses
// the real SDK pipeline and never substitutes the demo engine.
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
 * @property {(text: string, opts: {task: 'rewrite'|'explain', kind?: BaitKind, localOnly: boolean}) => Promise<Object>} assistHeadline See docs/HEADLINE_ASSISTANCE.md.
 * @property {() => Promise<EngineStatus>} initDeviceModel   Called after the user clicks "Turn on Debait".
 */

export const KINDS = ['rage', 'fear', 'envy', 'clean'];

// Message types used between content script, service worker and offscreen page.
export const MSG = {
  SCORE: 'debait/score',
  ASSIST: 'debait/headline-assist',
  STATUS: 'debait/status',
  INIT: 'debait/init',
};

function invalidClassification(message) {
  return Object.assign(new Error(`${message} No classification was produced.`), { code: 'debait/invalid-classification' });
}

// Exact copied text, with word boundaries when a phrase starts/ends in a word.
// This prevents e.g. "rich" inside "Richard" from serving as fabricated evidence.
// No keywords assign a category, and this does not judge the explanation's meaning.
function isHeadlineEvidence(word, text) {
  const start = text.indexOf(word);
  if (start < 0) return false;
  const wordChar = char => !!char && /[\p{L}\p{N}\p{M}_]/u.test(char);
  let index = start;
  while (index >= 0) {
    const before = [...text.slice(0, index)].at(-1);
    const after = [...text.slice(index + word.length)][0];
    if ((!wordChar([...word][0]) || !wordChar(before)) &&
        (!wordChar([...word].at(-1)) || !wordChar(after))) return true;
    index = text.indexOf(word, index + 1);
  }
  return false;
}

/** Reject absent/malformed answers instead of manufacturing a clean classification. */
export function normalizeResult(r, text) {
  if (r && !KINDS.includes(r.kind)) throw invalidClassification('AI returned an unsupported category.');
  if (typeof text !== 'string' || !KINDS.includes(r?.kind) || !Number.isFinite(r?.score) ||
      !Array.isArray(r?.triggers) || r.triggers.some(t => typeof t?.word !== 'string' || typeof t?.why !== 'string') ||
      typeof r?.honest_rewrite !== 'string' || !r.honest_rewrite.trim() ||
      !['on-device', 'cloud', 'mock'].includes(r?.source)) {
    throw invalidClassification('AI returned an invalid result.');
  }
  const { kind, source } = r;
  const score = Math.max(0, Math.min(100, Math.round(r.score)));
  if ((kind !== 'clean' && !r.triggers.length) || r.triggers.some(t =>
    !/[\p{L}\p{N}]/u.test(t.word) || !/[\p{L}\p{N}]/u.test(t.why) ||
    !isHeadlineEvidence(t.word.trim(), text))) {
    throw invalidClassification('AI returned unsupported classification evidence.');
  }
  // Validate every entry before limiting display size; never hide invalid evidence.
  const triggers = r.triggers.map(t => ({ word: t.word.trim(), why: t.why.trim() })).slice(0, 6);
  const decision = rewriteDecision(text, r.honest_rewrite.trim(), kind);
  // Preserve this enum through internal normalization/cache hops, never raw model payloads.
  const rewriteReason = decision.reason === 'model_unchanged' && ['preservation_guard', 'semantic_change_risk'].includes(r.rewriteReason)
    ? r.rewriteReason : decision.reason;
  return { kind, score, triggers, honest_rewrite: decision.text, source, rewriteReason };
}

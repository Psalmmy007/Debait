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
  SUMMARY: 'debait/summary',
};

/** Makes sure a result from any engine has the right shape. */
export function normalizeResult(r, text) {
  const kind = KINDS.includes(r?.kind) ? r.kind : 'clean';
  const score = Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0)));
  const triggers = Array.isArray(r?.triggers)
    ? r.triggers.filter((t) => t && typeof t.word === 'string' && t.word.trim()).slice(0, 6)
    : [];
  const honest_rewrite = typeof r?.honest_rewrite === 'string' && r.honest_rewrite.trim()
    ? r.honest_rewrite.trim()
    : text;
  const source = ['on-device', 'cloud', 'mock'].includes(r?.source) ? r.source : 'mock';
  return { kind, score, triggers, honest_rewrite, source };
}

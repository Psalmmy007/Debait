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
// Minimum manipulation score (0-100) required to classify a headline as bait.
export const BAIT_THRESHOLD = 60;

// Message types used between content script, service worker and offscreen page.
export const MSG = {
  SCORE: 'debait/score',
  STATUS: 'debait/status',
  INIT: 'debait/init',
  SUMMARY: 'debait/summary',
};

const normSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** Same words, ignoring punctuation, quote marks and spacing (capital letters still count). */
const words = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const sameWords = (a, b) => words(a) === words(b);

/** Keeps only triggers whose exact word/phrase actually appears in the headline text. */
export function filterTriggers(triggers, text) {
  if (!Array.isArray(triggers)) return [];
  const haystack = normSpace(text).toLowerCase();
  if (!haystack) return [];
  return triggers
    .filter((t) => {
      if (!t || typeof t.word !== 'string') return false;
      const w = normSpace(t.word);
      return w.length >= 2 && haystack.includes(w.toLowerCase());
    })
    .map((t) => ({ word: t.word.trim(), why: typeof t.why === 'string' ? t.why.trim() : '' }))
    .slice(0, 6);
}

/** Makes sure a result from any engine has the right shape and enforces clean-text guards. */
export function normalizeResult(r, text) {
  const kind = KINDS.includes(r?.kind) ? r.kind : 'clean';
  const score = Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0)));
  const triggers = filterTriggers(r?.triggers, text);
  const honest_rewrite = typeof r?.honest_rewrite === 'string' && r.honest_rewrite.trim()
    ? r.honest_rewrite.trim()
    : text;
  const source = ['on-device', 'cloud', 'mock'].includes(r?.source) ? r.source : 'mock';
  // Never mark or rewrite neutral/borderline text: real bait must clear the score threshold,
  // cite at least one trigger actually present in the headline, and offer a genuinely calmer rewrite.
  if (kind === 'clean' || score < BAIT_THRESHOLD || triggers.length === 0 || sameWords(honest_rewrite, text)) {
    return {
      kind: 'clean',
      score: kind === 'clean' ? score : Math.min(score, BAIT_THRESHOLD - 1),
      triggers: [],
      honest_rewrite: text,
      source,
    };
  }
  return { kind, score, triggers, honest_rewrite, source };
}

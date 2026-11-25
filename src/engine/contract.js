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
// Shared score cache version across service worker and content script instant cache.
// v5: enforces Local Only source isolation and factual rewrite-integrity validation.
export const CACHE_VERSION = 5;
export const NO_SUMMARY_TEXT = 'Not enough text on this page to summarize.';
export const NO_SAFE_REWRITE = 'No verified neutral rewrite available';

// Message types used between content script, service worker and offscreen page.
export const MSG = {
  SCORE: 'debait/score',
  STATUS: 'debait/status',
  INIT: 'debait/init',
  SUMMARY: 'debait/summary',
  CANCEL_CLOUD: 'debait/cancel-cloud',
};

const normSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** Same words, ignoring punctuation, quote marks and spacing (capital letters still count). */
const words = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const sameWords = (a, b) => words(a) === words(b);

/**
 * Enforces Local Only cache isolation:
 * - Never serves heuristic/mock entries from cache.
 * - When localOnly is true, ONLY accepts verified 'on-device' entries (never 'cloud').
 */
export function isCacheEntryValid(entry, localOnly = false) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.source !== 'on-device' && entry.source !== 'cloud') return false;
  if (localOnly && entry.source !== 'on-device') return false;
  return true;
}

/** True only when there is enough real article text or feed headlines to summarize. */
export function hasEnoughSummaryText(page) {
  if (!page) return false;
  if (page.kind === 'article') return normSpace(page.text).length >= 300;
  return Array.isArray(page.headlines)
    && page.headlines.filter((h) => normSpace(h).length >= 12).length >= 3;
}

const REFUSAL_RE = /^(i'?m sorry|i am sorry|sorry[,!.]?\s+(but\s+)?(i|there|you)|as an ai|i (can'?t|cannot|am unable to) (summarize|provide a summary)|unable to summarize|there (is|was) no (article|text|content|web page|information)|you (did not|didn'?t|have not|haven'?t) provide|please provide (the |an? )?(article|text|web page|content|headlines)|no (article|text|content|web page) (was )?provided)/i;
/** Catches chatty AI refusals so they are never shown in "In short". */
export const isSummaryRefusal = (text) => REFUSAL_RE.test(normSpace(text));

// Words that assert external attribution, causation, or backstory — must never be invented in a rewrite.
const INVENTED_FACT_TERMS = [
  'study', 'studies', 'research', 'researchers', 'scientists', 'experts',
  'officials', 'police', 'court', 'survey', 'report', 'reports', 'data shows',
  'according to', 'saving', 'savings', 'years of', 'exchange',
];
const HOOK_NEGATIONS = /\b(you won'?t believe|don'?t want you to know|can'?t believe)\b/gi;
const NEGATION_RE = /\b(not|never|no|without|denies|denied|refuses|refused|fails|failed|won'?t|can'?t|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|weren'?t)\b/i;

function extractNumbers(s) {
  return [...String(s || '').matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)].map((m) => m[0].replace(/,/g, ''));
}

/**
 * Deterministic fact-preservation gate run after EVERY rewrite pass:
 * rejects rewrites that invent numbers, introduce unsupported authority/backstory terms
 * (e.g. "study", "years of saving", "exchange"), flip polarity negations, or bloat excessively.
 */
export function validateRewriteIntegrity(original, rewrite) {
  const orig = normSpace(original);
  const rew = normSpace(rewrite);
  if (!orig || !rew || sameWords(orig, rew)) return { ok: false, reason: 'unchanged' };
  if (rew.length > Math.max(Math.round(orig.length * 1.5) + 20, 60)) {
    return { ok: false, reason: 'too_long' };
  }
  const origLow = orig.toLowerCase();
  const rewLow = rew.toLowerCase();

  // 1. No invented numbers, dates, or percentages
  const origNums = new Set(extractNumbers(orig));
  for (const num of extractNumbers(rew)) {
    if (!origNums.has(num)) return { ok: false, reason: `invented_number:${num}` };
  }

  // 2. No invented attribution, evidence, or backstory words
  for (const term of INVENTED_FACT_TERMS) {
    const re = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(rewLow) && !re.test(origLow)) {
      return { ok: false, reason: `invented_term:${term}` };
    }
  }

  // 3. Preserve substantive negation polarity (ignoring stripped clickbait hooks)
  const origCore = origLow.replace(HOOK_NEGATIONS, '');
  const origNeg = NEGATION_RE.test(origCore);
  const rewNeg = NEGATION_RE.test(rewLow);
  if (origNeg !== rewNeg) return { ok: false, reason: 'negation_flip' };

  return { ok: true, reason: '' };
}

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

/** Makes sure a result from any engine has the right shape and enforces clean-text + rewrite-safety guards. */
export function normalizeResult(r, text) {
  const kind = KINDS.includes(r?.kind) ? r.kind : 'clean';
  const score = Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0)));
  const triggers = filterTriggers(r?.triggers, text);
  const rawRewrite = typeof r?.honest_rewrite === 'string' && r.honest_rewrite.trim()
    ? r.honest_rewrite.trim()
    : text;
  const source = ['on-device', 'cloud', 'mock'].includes(r?.source) ? r.source : 'mock';
  // Never mark or rewrite neutral/borderline text: real bait must clear the score threshold
  // and cite at least one trigger actually present in the headline.
  if (kind === 'clean' || score < BAIT_THRESHOLD || triggers.length === 0) {
    return {
      kind: 'clean',
      score: kind === 'clean' ? score : Math.min(score, BAIT_THRESHOLD - 1),
      triggers: [],
      honest_rewrite: text,
      rewrite_safe: false,
      source,
    };
  }
  const check = validateRewriteIntegrity(text, rawRewrite);
  if (!check.ok) {
    // Keep honest bait classification & triggers, but refuse to swap in an unverified/fact-altering rewrite.
    return {
      kind,
      score,
      triggers,
      honest_rewrite: NO_SAFE_REWRITE,
      rewrite_safe: false,
      source,
    };
  }
  return { kind, score, triggers, honest_rewrite: rawRewrite, rewrite_safe: true, source };
}

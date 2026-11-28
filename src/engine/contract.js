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
// Minimum manipulation score (0-100) for high-confidence bait threshold helpers.
export const BAIT_THRESHOLD = 60;
// Shared score cache version enforcing Local Only source isolation and rewrite-integrity guards.
export const CACHE_VERSION = 6;
export const NO_SUMMARY_TEXT = 'Not enough text on this page to summarize.';
export const NO_SAFE_REWRITE = 'No verified neutral rewrite available';

// Message types used between content script, service worker and offscreen page.
export const MSG = {
  SCORE: 'debait/score',
  ASSIST: 'debait/headline-assist',
  STATUS: 'debait/status',
  INIT: 'debait/init',
};

const normSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const normWords = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const sameWords = (a, b) => normWords(a) === normWords(b);

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

/**
 * Guards against late in-flight cloud responses after Local Only is toggled ON:
 * while currentLocalOnly is true, only verified 'on-device' results may render, cache, or mutate stats.
 */
export function isResultAllowedInMode(result, currentLocalOnly = false) {
  if (!result || typeof result !== 'object') return false;
  if (currentLocalOnly) return result.source === 'on-device';
  return result.source === 'on-device' || result.source === 'cloud' || result.source === 'mock';
}

/** True only when there is enough real article text or feed headlines to summarize. */
export function hasEnoughSummaryText(page) {
  if (!page) return false;
  if (page.kind === 'article') return normSpace(page.text).length >= 300;
  return Array.isArray(page.headlines)
    && page.headlines.filter((h) => normSpace(h).length >= 12).length >= 3;
}

const REFUSAL_RE = /^(i'?m sorry|i am sorry|sorry[,!.]?\s+(but\s+)?(i|there|you)|as an ai|i (can'?t|cannot|am unable to) (summarize|provide a summary)|unable to summarize|there (is|was) no (article|text|content|web page|information)|you (did not|didn'?t|have not|haven'?t) provide|please provide (the |an? )?(article|text|web page|content|headlines)|no (article|text|content|web page) (was )?provided)/i;
/** Catches chatty AI refusals so they are never shown in summary output. */
export const isSummaryRefusal = (text) => REFUSAL_RE.test(normSpace(text));

const INVENTED_FACT_TERMS = [
  'study', 'studies', 'research', 'researchers', 'scientists', 'experts',
  'officials', 'police', 'court', 'survey', 'report', 'reports', 'data shows',
  'according to', 'saving', 'savings', 'years of', 'exchange',
];
const HOOK_NEGATIONS = /\b(you won'?t believe|don'?t want you to know|can'?t believe|won'?t tell you|never believe|no one saw|nobody knows)\b/gi;
const NEGATION_RE = /\b(not|never|no|without|denies|denied|refuses|refused|fails|failed|won'?t|can'?t|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|weren'?t)\b/i;

function extractNumbers(s) {
  return [...String(s || '').matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)].map((m) => m[0].replace(/,/g, ''));
}

/**
 * Deterministic fact-preservation gate: rejects rewrites that invent numbers, introduce
 * unsupported authority/backstory terms, flip negation polarity, or bloat excessively.
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

  const origNums = new Set(extractNumbers(orig));
  for (const num of extractNumbers(rew)) {
    if (!origNums.has(num)) return { ok: false, reason: `invented_number:${num}` };
  }

  for (const term of INVENTED_FACT_TERMS) {
    const re = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(rewLow) && !re.test(origLow)) {
      return { ok: false, reason: `invented_term:${term}` };
    }
  }

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

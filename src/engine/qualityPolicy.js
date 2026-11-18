// Policy selection changes classification instructions only; rewrite acceptance below is unchanged.
export { QUALITY_POLICY_VERSION, headlinePrompt } from './classificationPolicy.js';

const comparable = text => text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const protectedWords = /\b(?:no|not|never|without|neither|nor|may|might|could|likely|unlikely|possibly|allegedly|reportedly|suspected|some|many|most|all|only|permanent|permanently|temporary|temporarily|lifelong|forever|says|said|report|reports|reported)\b|\b\w+n't\b/g;
const protectedPhrases = /\b(?:one of the most|more than|less than|at least|at most|up to|according to|never go away)\b/g;
const quantities = /[£$€]?\d+(?:[.,]\d+)*(?:%|\s+(?:million|billion|thousand))?/g;
const durations = /\b\d+(?:[.,]\d+)*[- ](?:hours?|days?|weeks?|months?|years?)\b/g;

// Case and meaningful punctuation remain significant (US is not the pronoun us).
export function normalizeRewriteText(text) {
  return text.normalize('NFC').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}
// Textual difference only; factual acceptance is enforced separately by rewriteDecision.
export function hasMeaningfulRewrite(original, proposed) {
  return typeof original === 'string' && typeof proposed === 'string' &&
    !!normalizeRewriteText(proposed) && normalizeRewriteText(original) !== normalizeRewriteText(proposed);
}
export function canRewriteRecord(record) {
  return record?.state === 'scored' && !record.animating && record.result?.kind !== 'clean' &&
    hasMeaningfulRewrite(record.text, record.result?.honest_rewrite);
}
function quotedSpans(text) {
  const value = normalizeRewriteText(text), spans = [];
  const word = char => !!char && /[\p{L}\p{N}]/u.test(char);
  let start = -1, quote;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "'" && char !== '"') continue;
    if (char === "'" && word(value[i - 1]) && word(value[i + 1])) continue; // don't / teenager's
    if (start < 0) {
      if (char === '"' || !word(value[i - 1])) { start = i; quote = char; }
    } else if (char === quote) {
      spans.push(value.slice(start, i + 1)); start = -1;
    }
  }
  return spans;
}
// Conservative lexical tripwires, not a semantic or medical fact checker.
function guardRejects(original, proposed) {
  if (quotedSpans(original).some(quote => !normalizeRewriteText(proposed).includes(quote))) return true;
  const before = comparable(original), after = comparable(proposed);
  const protectedSpans = [
    ...before.matchAll(protectedWords), ...before.matchAll(protectedPhrases),
    ...before.matchAll(quantities), ...before.matchAll(durations),
    ...original.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b|\b[A-Z]{2,4}\b/g),
  ].map(match => comparable(match[0]));
  const occurrences = (text, span) => {
    const literal = span.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, 'gu'))].length;
  };
  return protectedSpans.some(span => occurrences(after, span) < occurrences(before, span));
}
// Deliberately narrow structural policy, not a semantic equivalence detector.
// Matching starts outside quotations and leaves the full claim intact. Case is
// significant in the retained text; normalization only tolerates typography/spacing.
const promotionalPrefix = /^(?:You won't believe this|You will not believe this|Click to find out): /i;
function isSafePrefixRemoval(original, proposed) {
  const before = normalizeRewriteText(original);
  const prefix = before.match(promotionalPrefix);
  return !!prefix && before.slice(prefix[0].length) === normalizeRewriteText(proposed);
}
export function rewriteDecision(original, proposed, kind) {
  if (kind === 'clean') return { text: original, reason: 'clean' };
  if (!hasMeaningfulRewrite(original, proposed)) return { text: original, reason: 'model_unchanged' };
  if (isSafePrefixRemoval(original, proposed)) return { text: proposed, reason: 'alternative' };
  if (guardRejects(original, proposed)) return { text: original, reason: 'preservation_guard' };
  return { text: original, reason: 'semantic_change_risk' };
}
export function preserveRewrite(original, proposed, kind) {
  return rewriteDecision(original, proposed, kind).text;
}

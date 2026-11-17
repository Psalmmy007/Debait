// Mock engine: fakes the AI so the UI can be built and demoed without Firebase.
// Same contract as the real engine (see contract.js). Swap it out in engine/index.js.

// Hand-written results for the demo feed, so the demo always looks great.
const CANNED = {
  'senator destroys reporter in brutal 30-second clip — you won\'t believe how it ends': {
    kind: 'rage', score: 91,
    triggers: [
      { word: 'DESTROYS', why: 'outrage trigger: turns a disagreement into a fight' },
      { word: 'brutal', why: 'violence framing' },
      { word: "you won't believe", why: 'curiosity bait' },
    ],
    honest_rewrite: "Senator pushes back on reporter in tense 30-second clip",
  },
  'this common breakfast food is silently killing you': {
    kind: 'fear', score: 86,
    triggers: [
      { word: 'silently killing you', why: 'fear of hidden harm' },
      { word: 'common', why: 'makes it feel like it applies to you' },
    ],
    honest_rewrite: "This common breakfast food may carry health risks, a study suggests",
  },
  "22-year-old retires as a millionaire while you're still stuck at your 9-to-5": {
    kind: 'envy', score: 78,
    triggers: [
      { word: 'millionaire', why: 'status envy' },
      { word: "while you're still stuck", why: 'comparison jab aimed at you' },
    ],
    honest_rewrite: "22-year-old retires early after years of saving, while most still work 9-to-5",
  },
  "the radical left's war on your car is here. they're coming for your engine next": {
    kind: 'rage', score: 94,
    triggers: [
      { word: 'radical left', why: '"other side" framing' },
      { word: 'WAR', why: 'conflict framing' },
      { word: 'coming for your', why: 'personal threat' },
    ],
    honest_rewrite: "New car emissions rules are coming, and critics say engines could be next",
  },
  'i tried the diet doctors are terrified of (shocking results)': {
    kind: 'fear', score: 72,
    triggers: [
      { word: 'TERRIFIED', why: 'borrowed fear from authority' },
      { word: 'shocking', why: 'shock bait' },
    ],
    honest_rewrite: "I tried the diet doctors debate (my honest results)",
  },
  "billionaires don't want you to know this one secret": {
    kind: 'envy', score: 83,
    triggers: [
      { word: 'Billionaires', why: 'elite envy' },
      { word: "don't want you to know", why: 'conspiracy hook' },
      { word: 'secret', why: 'curiosity bait' },
    ],
    honest_rewrite: "One investing habit wealthy people often use",
  },
  'economy on the brink of total collapse — experts are panicking': {
    kind: 'fear', score: 88,
    triggers: [
      { word: 'brink', why: 'catastrophe framing' },
      { word: 'TOTAL COLLAPSE', why: 'doom exaggeration' },
      { word: 'panicking', why: 'contagious fear' },
    ],
    honest_rewrite: "Economy could slow down, some experts warn",
  },
  'fans furious as star player slams the coach in explosive rant': {
    kind: 'rage', score: 76,
    triggers: [
      { word: 'furious', why: 'borrowed anger' },
      { word: 'SLAMS', why: 'outrage trigger' },
      { word: 'explosive rant', why: 'drama framing' },
    ],
    honest_rewrite: "Fans react as star player criticizes the coach after the game",
  },
  "your neighbours are getting richer than you — here's why": {
    kind: 'envy', score: 69,
    triggers: [
      { word: 'richer than you', why: 'comparison jab aimed at you' },
      { word: "here's why", why: 'curiosity bait' },
    ],
    honest_rewrite: "Your neighbours' incomes are rising — here's why",
  },
  'deadly new virus could be in your home right now, warn experts': {
    kind: 'fear', score: 90,
    triggers: [
      { word: 'Deadly', why: 'fear trigger' },
      { word: 'in your home RIGHT NOW', why: 'false urgency, aimed at you' },
    ],
    honest_rewrite: "New virus is spreading; experts explain how to stay safe at home",
  },
};

// Calm replacements: same meaning, no emotional charge ('' = drop the hook entirely).
const CALM = {
  destroy: 'criticize', destroys: 'criticizes', destroying: 'criticizing', slams: 'criticizes',
  furious: 'upset', outrage: 'criticism', disgusting: 'controversial', humiliates: 'challenges',
  'war on': 'debate over', betrayal: 'reversal', radical: '', owned: 'answered',
  'killing you': 'linked to health risks', deadly: 'serious', terrifying: 'concerning', warning: 'note',
  collapse: 'slowdown', crisis: 'problem', shocking: 'surprising', danger: 'risk', panic: 'concern',
  'right now': '', millionaire: 'wealthy', billionaire: 'very wealthy person', 'richer than you': 'earning more',
  secret: 'tip', "don't want you to know": 'rarely mention', luxury: 'high-end', 'while you': 'while others',
  "you won't believe": '',
};

// Simple word list for headlines that aren't in the demo.
const LEXICON = [
  // rage
  ['destroy', 'rage', 'outrage trigger', 30], ['destroys', 'rage', 'outrage trigger', 30],
  ['destroying', 'rage', 'outrage trigger', 30], ['slams', 'rage', 'outrage trigger', 25],
  ['furious', 'rage', 'borrowed anger', 20], ['outrage', 'rage', 'outrage trigger', 25],
  ['disgusting', 'rage', 'moral disgust', 25], ['humiliates', 'rage', 'humiliation framing', 25],
  ['war on', 'rage', 'conflict framing', 25], ['betrayal', 'rage', 'moral anger', 20],
  ['radical', 'rage', '"other side" framing', 20], ['owned', 'rage', 'fight framing', 15],
  // fear
  ['killing you', 'fear', 'fear of hidden harm', 35], ['deadly', 'fear', 'fear trigger', 25],
  ['terrifying', 'fear', 'fear trigger', 25], ['warning', 'fear', 'alarm framing', 15],
  ['collapse', 'fear', 'doom exaggeration', 25], ['crisis', 'fear', 'alarm framing', 15],
  ['shocking', 'fear', 'shock bait', 20], ['danger', 'fear', 'fear trigger', 20],
  ['panic', 'fear', 'contagious fear', 20], ['right now', 'fear', 'false urgency', 15],
  // envy
  ['millionaire', 'envy', 'status envy', 25], ['billionaire', 'envy', 'elite envy', 25],
  ['richer than you', 'envy', 'comparison jab', 30], ['secret', 'envy', 'curiosity bait', 15],
  ["don't want you to know", 'envy', 'conspiracy hook', 30], ['luxury', 'envy', 'status envy', 15],
  ['while you', 'envy', 'comparison jab', 20],
  // general bait
  ["you won't believe", 'rage', 'curiosity bait', 20],
];

function heuristic(text) {
  const lower = text.toLowerCase();
  const totals = { rage: 0, fear: 0, envy: 0 };
  const triggers = [];

  const byLength = [...LEXICON].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, kind, why, weight] of byLength) {
    const i = lower.indexOf(phrase);
    if (i !== -1 && !triggers.some((t) => t.word.toLowerCase().includes(phrase) || phrase.includes(t.word.toLowerCase()))) {
      totals[kind] += weight;
      triggers.push({ word: text.slice(i, i + phrase.length), why });
    }
  }

  // SHOUTING words (3+ capital letters) are a bait signal too.
  for (const m of text.matchAll(/\b[A-Z]{3,}\b/g)) {
    if (!triggers.some((t) => t.word.includes(m[0]))) {
      triggers.push({ word: m[0], why: 'shouting caps' });
      const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
      totals[top[1] > 0 ? top[0] : 'rage'] += 12;
    }
  }
  if (text.includes('!')) totals.rage += 5;

  const [kind, raw] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  if (raw < 20) {
    return { kind: 'clean', score: Math.min(18, raw), triggers: [], honest_rewrite: text };
  }

  // Rewrite: keep the sentence, swap each loaded word for a calm one, drop pure hooks.
  let rewrite = text;
  for (const t of triggers) {
    const calm = CALM[t.word.toLowerCase()];
    const re = new RegExp(t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (calm !== undefined) rewrite = rewrite.replace(re, calm);
  }
  rewrite = rewrite
    .replace(/!+/g, '')
    .replace(/\b[A-Z]{3,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    .replace(/\s+([,.:;—-])/g, '$1')
    .replace(/^[\s,.:;—-]+|[\s,:;—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!rewrite) rewrite = text;
  rewrite = rewrite.charAt(0).toUpperCase() + rewrite.slice(1);

  return { kind, score: Math.min(97, 30 + raw), triggers, honest_rewrite: rewrite };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {import('./contract.js').Engine} */
export const mockEngine = {
  async scoreHeadlines(texts) {
    await wait(250 + Math.random() * 350); // feel like a real model
    return texts.map((text) => {
      const canned = CANNED[text.trim().toLowerCase()];
      return { ...(canned || heuristic(text)), source: 'mock' };
    });
  },
  async getStatus({ localOnly }) {
    return { ready: true, source: 'mock', localOnly, message: 'Mock engine (no AI yet)' };
  },
  async initDeviceModel() {
    return { ready: true, source: 'mock', localOnly: false, message: 'Mock engine (no AI yet)' };
  },
};

/** Offline backup: the first sentences of the article, or the page's top headlines. */
mockEngine.summarize = async function summarize({ title, text, headlines, kind }) {
  if (kind === 'article') {
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim()).filter((x) => x.length > 40);
    return { summary: sentences.slice(0, 3).join(' ') || title, source: 'mock' };
  }
  const top = headlines.slice(0, 3).map((h) => h.replace(/[.!?]*$/, '.'));
  return { summary: top.length ? `Top stories on this page: ${top.join(' ')}` : title, source: 'mock' };
};

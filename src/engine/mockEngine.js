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
    honest_rewrite: "Senator disagrees with a reporter's question in a 30-second exchange",
  },
  'this common breakfast food is silently killing you': {
    kind: 'fear', score: 86,
    triggers: [
      { word: 'silently killing you', why: 'fear of hidden harm' },
      { word: 'common', why: 'makes it feel like it applies to you' },
    ],
    honest_rewrite: 'Study links very high intake of processed cereals to modest health risks',
  },
  "22-year-old retires as a millionaire while you're still stuck at your 9-to-5": {
    kind: 'envy', score: 78,
    triggers: [
      { word: 'millionaire', why: 'status envy' },
      { word: "while you're still stuck", why: 'comparison jab aimed at you' },
    ],
    honest_rewrite: '22-year-old says they saved aggressively and invested early',
  },
  "the radical left's war on your car is here. they're coming for your engine next": {
    kind: 'rage', score: 94,
    triggers: [
      { word: 'radical left', why: '"other side" framing' },
      { word: 'WAR', why: 'conflict framing' },
      { word: 'coming for your', why: 'personal threat' },
    ],
    honest_rewrite: 'Proposed city rules would phase in stricter emissions limits for new cars',
  },
  'i tried the diet doctors are terrified of (shocking results)': {
    kind: 'fear', score: 72,
    triggers: [
      { word: 'TERRIFIED', why: 'borrowed fear from authority' },
      { word: 'shocking', why: 'shock bait' },
    ],
    honest_rewrite: 'I followed a low-carb diet for 30 days — here is what changed',
  },
  "billionaires don't want you to know this one secret": {
    kind: 'envy', score: 83,
    triggers: [
      { word: 'Billionaires', why: 'elite envy' },
      { word: "don't want you to know", why: 'conspiracy hook' },
      { word: 'secret', why: 'curiosity bait' },
    ],
    honest_rewrite: 'A simple explanation of how index funds work',
  },
  'economy on the brink of total collapse — experts are panicking': {
    kind: 'fear', score: 88,
    triggers: [
      { word: 'brink', why: 'catastrophe framing' },
      { word: 'TOTAL COLLAPSE', why: 'doom exaggeration' },
      { word: 'panicking', why: 'contagious fear' },
    ],
    honest_rewrite: 'Economists expect slower growth next quarter; views on risk vary',
  },
  'fans furious as star player slams the coach in explosive rant': {
    kind: 'rage', score: 76,
    triggers: [
      { word: 'furious', why: 'borrowed anger' },
      { word: 'SLAMS', why: 'outrage trigger' },
      { word: 'explosive rant', why: 'drama framing' },
    ],
    honest_rewrite: "Player publicly criticizes the coach's decisions after Sunday's loss",
  },
  "your neighbours are getting richer than you — here's why": {
    kind: 'envy', score: 69,
    triggers: [
      { word: 'richer than you', why: 'comparison jab aimed at you' },
      { word: "here's why", why: 'curiosity bait' },
    ],
    honest_rewrite: 'Average household income in the region rose 3% last year',
  },
  'deadly new virus could be in your home right now, warn experts': {
    kind: 'fear', score: 90,
    triggers: [
      { word: 'Deadly', why: 'fear trigger' },
      { word: 'in your home RIGHT NOW', why: 'false urgency, aimed at you' },
    ],
    honest_rewrite: 'Health officials share tips for reducing common household germs',
  },
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

  for (const [phrase, kind, why, weight] of LEXICON) {
    const i = lower.indexOf(phrase);
    if (i !== -1 && !triggers.some((t) => t.word.toLowerCase().includes(phrase))) {
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

  // Rough rewrite: drop the trigger words, calm the caps. The real model does this properly.
  let rewrite = text;
  for (const t of triggers) {
    rewrite = rewrite.replace(new RegExp(t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
  }
  rewrite = rewrite
    .replace(/!+/g, '.')
    .replace(/\b[A-Z]{3,}\b/g, (w) => w.toLowerCase())
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.—-])/g, '$1')
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

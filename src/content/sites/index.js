// Per-site adapters: how to find headlines on each supported site.
// Each adapter returns headline elements whose text we score and rewrite.
// Keep selectors tight: headlines and post titles only, not every word.
// Sites change their markup often, so each list has a current selector plus older/alternate ones.

const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

const adapters = [
  {
    name: 'demo',
    match: (h) => h === 'localhost' || h === '127.0.0.1',
    find: (root) => root.querySelectorAll('[data-debait-headline]'),
  },
  {
    name: 'x',
    match: (h) => h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com'),
    // post text when signed in (the normal case); the lang-tagged div is a fallback
    find: (root) => {
      const posts = root.querySelectorAll('article [data-testid="tweetText"]');
      return posts.length ? posts : root.querySelectorAll('article div[lang][dir="auto"]');
    },
  },
  {
    name: 'youtube',
    match: (h) => h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com',
    find: (root) => root.querySelectorAll([
      // search results and older grids (checked on live search results)
      'a#video-title yt-formatted-string',
      'a#video-title-link yt-formatted-string#video-title',
      // the newer "lockup" cards on home and the watch-page sidebar
      'yt-lockup-view-model h3 a > span',
      'h3 a.yt-lockup-metadata-view-model__title span',
      'h3 a.yt-lockup-metadata-view-model-wiz__title span',
      // older sidebar cards
      'ytd-compact-video-renderer span#video-title',
      // the title of the video being watched
      'ytd-watch-metadata h1 yt-formatted-string',
    ].join(', ')),
    // YouTube cuts titles at two lines, which would hide a tag at the end: put it under the title
    place: (el) => el.closest('h3, h1') || el,
  },
  {
    name: 'bbc',
    match: (h) => h.endsWith('bbc.com') || h.endsWith('bbc.co.uk'),
    // story cards (checked on the live front page: ~48 per page) and the article headline
    find: (root) => root.querySelectorAll(
      '[data-testid="card-headline"], [data-component="headline-block"] h1, h1#main-heading',
    ),
  },
];

// ---------- every other website ----------
// Finds headline-like text: article headings and headline links, skipping menus, footers,
// buttons and forms. Keeps the innermost match (a heading inside a link, not both).
const SKIP = 'nav, footer, header nav, aside nav, [role="navigation"], [role="menu"], [role="banner"] nav, form, button, [contenteditable="true"], debait-tag, debait-root, [aria-hidden="true"], code, pre';
const CANDIDATES = 'h1, h2, h3, h4, [role="heading"], a[href], [class*="headline" i], [class*="title" i], [data-testid*="title" i], [data-testid*="headline" i]';

function looksLikeHeadline(el) {
  if (el.closest(SKIP)) return false;
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false; // hidden
  const t = textOf(el);
  if (t.length < 22 || t.length > 220) return false;
  if (el.children.length > 6) return false; // a container, not a headline
  const words = t.split(' ').length;
  if (words < 4 || words > 32) return false;
  if (/^(sign in|log in|subscribe|cookie|accept|skip to|menu|share|read more)/i.test(t)) return false;
  return true;
}

// post text on the big social sites (their own markup, checked first)
const SOCIAL = [
  'shreddit-post a[slot="title"]', '[id^="post-title"]', 'h3._eYtD2XCVieq6emjKBH3m',            // Reddit
  'div[data-ad-preview="message"]', 'div[data-ad-comet-preview="message"]',                    // Facebook
  '[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="search-card-desc"]', // TikTok
  '.update-components-text', '.feed-shared-update-v2__description',                            // LinkedIn
  'article h1', 'h1._ap3a', 'span._ap3a._aaco',                                                 // Instagram
  'span[dir="auto"] > span[dir="auto"]',                                                       // Threads / Meta
].join(', ');
function looksLikePost(el) {
  if (el.closest(SKIP)) return false;
  const t = textOf(el);
  return t.length >= 15 && t.length <= 320 && t.split(' ').length >= 3;
}

const generic = {
  name: 'generic',
  match: () => true,
  find: (root) => {
    const social = [...root.querySelectorAll(SOCIAL)].filter(looksLikePost);
    const found = [...social, ...[...root.querySelectorAll(CANDIDATES)].filter(looksLikeHeadline)];
    const set = new Set(found);
    // drop an element if another match sits inside it (keep the innermost)
    const inner = found.filter((el) => !found.some((o) => o !== el && el.contains(o)));
    return inner.filter((el) => set.has(el)).slice(0, 150);
  },
};

export function getAdapter(hostname) {
  return adapters.find((a) => a.match(hostname)) || generic;
}

export { textOf };

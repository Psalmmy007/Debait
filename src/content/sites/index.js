// Per-site adapters: how to find headlines on each supported site.
// Each adapter returns headline elements whose text we score and rewrite.
// Keep selectors tight: headlines and post titles only, not every word.
// Sites change their markup often, so each list has a current selector plus older/alternate ones.

const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

// Private/sensitive hosts (webmail, banking/financial portals, cloud IDEs/code hosts,
// cloud consoles, private workspaces, and AI chats) where Debait stays off by default
// and never collects page text for scoring or summarization.
export const PRIVATE_HOST_RE = /(^|\.)(gemini\.google\.com|chatgpt\.com|chat\.openai\.com|claude\.ai|copilot\.microsoft\.com|perplexity\.ai|chat\.deepseek\.com|github\.com|github\.dev|gitlab\.com|bitbucket\.org|replit\.com|vscode\.dev|codesandbox\.io|stackblitz\.com|console\.firebase\.google\.com|console\.cloud\.google\.com|console\.aws\.amazon\.com|portal\.azure\.com|mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|mail\.protonmail\.com|fastmail\.com|docs\.google\.com|drive\.google\.com|sheets\.google\.com|slides\.google\.com|calendar\.google\.com|meet\.google\.com|notion\.so|notion\.site|slack\.com|discord\.com|figma\.com|linear\.app|atlassian\.net|chase\.com|bankofamerica\.com|wellsfargo\.com|citi\.com|citibank\.com|capitalone\.com|paypal\.com|dashboard\.stripe\.com|wise\.com|venmo\.com|cash\.app|robinhood\.com|coinbase\.com|fidelity\.com|schwab\.com|vanguard\.com|barclays\.co\.uk|hsbc\.com|hsbc\.co\.uk|chromewebstore\.google\.com)$/i;
const SUBDOMAIN_LOCALHOST_RE = /\.localhost$/i;
const SENSITIVE_PATH_RE = /\/(login|signin|sign-in|auth|oauth|checkout|billing|payment|account|settings|admin|devtools|graphql|graphiql|swagger|api-docs|phpmyadmin|pgadmin)\b/i;

export function isPrivateHost(hostname = '') {
  const h = String(hostname || '').toLowerCase();
  return PRIVATE_HOST_RE.test(h) || SUBDOMAIN_LOCALHOST_RE.test(h);
}

export function isSensitivePage(doc = document, loc = location) {
  const host = String(loc?.hostname || '').toLowerCase();
  const path = String(loc?.pathname || '');
  if (isPrivateHost(host)) return true;
  if (host === 'www.icloud.com' && /^\/mail\b/i.test(path)) return true;
  if (SENSITIVE_PATH_RE.test(path)) return true;
  // Block localhost dev tools unless the page explicitly opts in as the Debait demo fixture.
  if ((host === 'localhost' || host === '127.0.0.1') && !doc?.querySelector?.('[data-debait-headline]')) return true;
  if (doc?.querySelector?.('input[type="password"]')) return true;
  return false;
}

const adapters = [
  {
    // Private/sensitive apps & AI chats: never scrape messages, code, mail, or forms
    name: 'off',
    match: (h) => isPrivateHost(h),
    find: () => [],
  },
  {
    name: 'google',
    match: (h) => /^(www.)?google.[a-z.]+$/.test(h),
    // only the result titles and Top stories / News cards; never AI Overviews, AI Mode or your own query
    find: (root) => (/[?&]udm=50(&|$)/.test(location.search) ? [] : root.querySelectorAll('#rso a h3, #rso g-section-with-header a [role="heading"], #rso a [role="heading"][aria-level="3"]')),
    // Google wraps organic result <h3> links inside span.V9tjod with transform: scaleY(-1);
    // placing the tag right after .yuRUbf keeps it upright and cleanly below the headline.
    place: (el) => el.closest('.yuRUbf') || el,
  },
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
// dialogs, buttons and forms. Keeps the innermost match (a heading inside a link, not both).
const SKIP = 'nav, footer, header nav, aside nav, [role="navigation"], [role="menu"], [role="menuitem"], [role="menubar"], [role="banner"] nav, [role="contentinfo"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="alert"], [role="status"], [role="toolbar"], [role="tablist"], [role="tab"], [role="button"], dialog, form, button, label, select, [contenteditable="true"], debait-tag, debait-root, [aria-hidden="true"], code, pre';
const CANDIDATES = 'h1, h2, h3, h4, [role="heading"], a[href], [class*="headline" i], [class*="title" i], [data-testid*="title" i], [data-testid*="headline" i]';
const UI_TEXT = /^(sign in|sign up|log in|log out|sign out|subscribe|unsubscribe|cookie|accept|reject|decline|dismiss|skip to|jump to|back to|go to|return to|menu|share|read more|learn more|see more|show more|view more|view all|load more|continue (on|with|to|reading|watching|as|without|using|browsing|shopping)|create (an? |your )?account|get started|get the app|open in|download (the )?app|try (it )?free|start (your )?free|manage (your )?|update (your )?|verify (your )?|confirm (your )?|reset (your )?|forgot (your )?|choose (an? |your )?|select (an? |your )?|switch to|use another|turn on|turn off|enable |disable |allow |privacy policy|terms of (service|use)|contact us|help center|your account|my account)\b/i;

function looksLikeHeadline(el) {
  if (el.closest(SKIP)) return false;
  if (el.hasAttribute('aria-haspopup')) return false;
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false; // hidden
  const t = textOf(el);
  if (t.length < 22 || t.length > 220) return false;
  if (el.children.length > 6) return false; // a container, not a headline
  const words = t.split(' ').length;
  if (words < 4 || words > 32) return false;
  if (UI_TEXT.test(t)) return false;
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

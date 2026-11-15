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

export function getAdapter(hostname) {
  return adapters.find((a) => a.match(hostname)) || null;
}

export { textOf };

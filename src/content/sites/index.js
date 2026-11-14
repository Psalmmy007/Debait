// Per-site adapters: how to find headlines on each supported site.
// Each adapter returns headline elements whose text we score and rewrite.
// Keep selectors tight: headlines and post titles only, not every word.

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
    find: (root) => root.querySelectorAll('article [data-testid="tweetText"]'),
  },
  {
    name: 'youtube',
    match: (h) => h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com',
    // home/search/sidebar video titles + the watch-page title
    find: (root) => root.querySelectorAll(
      'a#video-title-link yt-formatted-string#video-title, a#video-title yt-formatted-string, ' +
      'h3 a.yt-lockup-metadata-view-model__title span, ytd-watch-metadata h1 yt-formatted-string',
    ),
  },
  {
    name: 'bbc',
    match: (h) => h.endsWith('bbc.com') || h.endsWith('bbc.co.uk'),
    find: (root) => root.querySelectorAll('[data-testid="card-headline"], h1#main-heading, main h1'),
  },
];

export function getAdapter(hostname) {
  return adapters.find((a) => a.match(hostname)) || null;
}

export { textOf };

// Debait's bundled call chimes (100% offline, zero network calls):
// "start" plays when picking up / starting Talk to Debait, "end" when cutting / ending it.
import startAsset from '../../assets/chime-start.ogg';
import endAsset from '../../assets/chime-end.mp3';

const VOLUME = 0.35;
const ASSETS = { start: startAsset, end: endAsset };
const players = {};

function resolveUrl(url) {
  if (!url || /^(data|blob|chrome-extension|https?):/i.test(url)) return url;
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(url.replace(/^\//, ''));
  }
  return url;
}

function getPlayer(kind) {
  if (!players[kind]) {
    const audio = new Audio(resolveUrl(ASSETS[kind] || ASSETS.start));
    audio.preload = 'auto';
    audio.volume = VOLUME;
    players[kind] = audio;
  }
  return players[kind];
}

export function chime(kind = 'start') {
  const key = kind === 'end' ? 'end' : 'start';
  try {
    const other = players[key === 'start' ? 'end' : 'start'];
    if (other && !other.paused) {
      other.pause();
      other.currentTime = 0;
    }
    const audio = getPlayer(key);
    audio.volume = VOLUME;
    audio.pause();
    audio.currentTime = 0;
    const p = audio.play();
    if (p?.catch) p.catch(() => {});
  } catch { /* autoplay or audio unavailable on this page: stay silent */ }
}

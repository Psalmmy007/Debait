# Debait

**Nutrition facts for your feed.**

Debait is a Chrome extension that reads the headlines on X, YouTube and BBC News, tags the bait
(Rage, Fear, Envy or Clean, with a 0–100 bait score), highlights the manipulative words, and
rewrites bait into calm, honest headlines with one click.

It runs on-device with Gemini Nano through **Firebase AI Logic hybrid inference**. If a computer has
no local model, it falls back to the cloud and sends only the single headline text, never your
history. A **Local only** switch turns the cloud off.

> Built for Google's #BuildHybridAI 2026 hackathon.

## What you see

- **The orb.** A small glass sphere of moving smoke (real-time WebGL) floats on the page. It's a
  dark storm when the page is full of bait and a calm pearl once it's clean. Drag it anywhere.
  Click it and a ring sweeps across the page while every bait headline decodes into an honest one.
  Click again to restore the originals. Double-click for settings.
- **Tags.** Each headline gets a Rage / Fear / Envy / Clean keycap with its bait score.
- **Highlights.** Manipulative words are underlined.
- **Ingredients card.** Click a tag to see why a headline is bait, word by word, and what actually happened.
- **Popup.** Today's bait %, breakdown, switches, and which engine is running (on-device / cloud).
- **Weekly Mind Facts.** A side panel laid out like a nutrition label for your week.

## Setup

You need [Node.js](https://nodejs.org) 20+ and Chrome 139+ on desktop.

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder.
4. Open x.com, youtube.com, bbc.com, or the demo feed below.

After you change code, run `npm run build` again (or keep `npm run watch` running) and press the
reload icon on the Debait card in `chrome://extensions`.

### Demo feed

```bash
npm run demo
```

This opens a fake feed at http://localhost:5180 with the extension's demo headlines.
Add `?preview` to the URL (http://localhost:5180/?preview) to see the Debait UI **without
installing the extension**, which is handy for UI work. Add `&dark` for a dark-mode feed.

Design tools on the same server:
- http://localhost:5180/orb.html shows the orb large, in every mood, on light and dark backgrounds.
- http://localhost:5180/pages.html shows Weekly Mind Facts, and `pages.html?page=popup` the popup.

## Project layout

```
src/content/     on-page UI: orb, tags, highlights, Ingredients card, ripple
src/engine/      the AI: mock engine now, Firebase AI Logic engine (see docs/ENGINE.md)
src/offscreen/   hidden page that hosts the engine
src/background/  service worker: message routing, cache, daily stats
src/popup/       toolbar popup
src/sidepanel/   Weekly Mind Facts
demo/            demo feed page
```

## Why

- Facebook altered the feeds of 689,003 users, and their own posts shifted in the same emotional
  direction ([Kramer et al., PNAS 2014](https://doi.org/10.1073/pnas.1320040111)).
- Each negative word in a headline raised clicks 2.3%
  ([Robertson et al., Nature Human Behaviour 2023](https://doi.org/10.1038/s41562-023-01538-4)).
- Each moral-emotional word made tweets spread about 20% more
  ([Brady et al., PNAS 2017](https://doi.org/10.1073/pnas.1618923114)).
- Food has a label. Your feed doesn't. Debait is that label.

## License

[Apache 2.0](LICENSE)

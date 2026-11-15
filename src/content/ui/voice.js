// Voice mode: talk to Debait, and it answers out loud.
// Listens with the browser's speech recognition and replies with the best female voice
// available on this computer. Chrome asks for microphone access the first time on each site.
//
// Commands (said naturally, anywhere in a sentence):
//   "debait this page" / "debait"      -> rewrite the bait
//   "undo" / "restore" / "show original" -> bring the originals back
//   "how bad is this page" / "summary"  -> spoken report
//   "settings"                           -> open the settings panel
//   "stop listening"                     -> voice mode off
//   "hello" / "help"                     -> what you can say

const FEMALE = [
  /aria.*natural/i, /jenny.*natural/i, /ava.*natural/i, /emma.*natural/i, /michelle.*natural/i, // Edge/Windows natural voices
  /google uk english female/i, /google us english/i, /samantha/i, /karen/i, /moira/i, /tessa/i,
  /aria/i, /jenny/i, /zira/i, /female/i,
];

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en'));
  for (const re of FEMALE) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] || null;
}

const COMMANDS = [
  ['restore', /\b(undo|restore|show (me )?(the )?original|bring (it|them) back|put it back)\b/],
  ['summary', /\b(how bad|how much bait|summary|report|what('?s| is) (on )?(this|the) page|any bait)\b/],
  ['settings', /\b(settings|options|open (the )?panel)\b/],
  ['off', /\b(stop listening|voice off|turn off (the )?voice|be quiet|goodbye)\b/],
  ['debait', /\b(de-?bait|debate|the bait|calm (it|this|them) down|clean (it|this) up)\b/],
  ['hello', /\b(hello|hi|hey|help|what can you do|who are you)\b/],
];

export function createVoice({ onCommand, onState }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let on = false;
  let speaking = false;
  let voice = null;
  speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
  voice = pickVoice();

  function listen() {
    if (!on || speaking || !Recognition) return;
    try { rec?.start(); } catch { /* already listening */ }
  }

  function build() {
    rec = new Recognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[e.results.length - 1][0].transcript.trim();
      const text = said.toLowerCase();
      onState?.({ mode: 'heard', text: said });
      const hit = COMMANDS.find(([, re]) => re.test(text));
      if (hit) onCommand(hit[0], said);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        onState?.({ mode: 'error', text: 'Microphone blocked. Allow it in the address bar.' });
        on = false;
      }
    };
    rec.onend = () => { if (on && !speaking) setTimeout(listen, 250); }; // keep listening
  }

  function say(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.02;
      u.pitch = 1.05;
      speaking = true;
      try { rec?.stop(); } catch { /* not running */ }
      onState?.({ mode: 'speaking', text });
      u.onend = u.onerror = () => {
        speaking = false;
        onState?.({ mode: on ? 'listening' : 'idle' });
        listen();
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  return {
    supported: !!Recognition,
    get on() { return on; },
    start() {
      if (on) return;
      if (!Recognition) {
        onState?.({ mode: 'error', text: 'Voice needs Chrome speech recognition, which is not available here.' });
        return;
      }
      on = true;
      if (!rec) build();
      onState?.({ mode: 'listening' });
      listen();
    },
    stop() {
      on = false;
      try { rec?.stop(); } catch { /* not running */ }
      speechSynthesis.cancel();
      onState?.({ mode: 'idle' });
    },
    say,
  };
}

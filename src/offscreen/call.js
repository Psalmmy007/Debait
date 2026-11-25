// Call mode: a live voice conversation with Gemini (Firebase AI Logic Live API).
// Runs in the offscreen page, so it works the same on every website and the microphone
// permission is asked once for the extension, not per site.
// The model can act on the page you're looking at through tools (debait, restore, report, explain).
import { getLiveGenerativeModel, ResponseModality, Schema } from 'firebase/ai';
import { openAudio } from './voice-audio.js';
import { getAi, projectOrder, projectName, isOnline } from '../engine/firebaseEngine.js';
import { FIREBASE_PROJECTS, LIVE_MODELS, LIVE_VOICE } from '../engine/firebaseConfig.js';

const SYSTEM = `You are Debait — a chill, sharp, easygoing friend who lives inside the Debait Chrome extension.
Never break character. Never say you are a large language model, never mention Google or Gemini, and never refer to any underlying API or model.
If anyone asks who you are or who created you, keep it natural: "I'm Debait, built by the Debait team to help you read the web without the clickbait and noise."

How to talk:
- Talk like a real, relaxed, witty friend — warm, natural, short, and punchy (usually 1 or 2 sentences). Never sound like a scripted customer support bot.
- Feel free to have normal, fun, casual conversations about anything the user brings up — greetings, banter, jokes, random thoughts, whatever they want to chat about. Never lecture them or awkwardly force the conversation back to the webpage.
- When the user asks about the page, headlines, or Debait, jump right in and use your tools (page_report, debait_page, restore_page, explain_headline, summarize_page, set_setting, open_mind_facts). Always call page_report before describing what's on the page, and never invent headlines or claim to fact-check news.
- You know Debait inside out: it spots emotional bait (rage, fear, envy), tags headlines, rewrites bait into calm factual versions, summarizes pages ("In short"), tracks Weekly Mind Facts, and works both on-device and online (including Local only / offline mode).
- Start the call with a quick, warm, casual hi.
- Speak English at a natural, relaxed pace. Let the user finish before replying; if they cut in, drop what you were saying right away and roll with their new topic.
- If you didn't catch what they said, just ask casually rather than guessing.
- Ignore background noise, music, and your own voice coming back through the speakers.`;

// Speech detection & interruption behavior use Firebase AI Logic's documented Live SDK
// connection directly (no global WebSocket.prototype monkeypatch).
const TOOLS = [{
  functionDeclarations: [
    { name: 'page_report', description: 'Read what Debait found on the current page: how many headlines, how many are bait, and the worst examples.' },
    { name: 'debait_page', description: 'Rewrite every bait headline on the current page into an honest version.' },
    { name: 'restore_page', description: 'Bring back the original headlines on the current page.' },
    {
      name: 'explain_headline',
      description: 'Explain why one bait headline from page_report is manipulative, word by word, and give its honest rewrite.',
      parameters: Schema.object({ properties: { number: Schema.integer({ description: 'The headline number from page_report, starting at 1.' }) } }),
    },
    {
      name: 'set_setting',
      description: 'Turn a Debait setting on or off.',
      parameters: Schema.object({
        properties: {
          setting: Schema.enumString({ enum: ['show_tags', 'auto_debait', 'local_only', 'show_orb'] }),
          on: Schema.boolean(),
        },
      }),
    },
    { name: 'summarize_page', description: 'Summarize the whole page the user is on (the article, or the main stories) in 2 or 3 sentences. Read the summary out in your own calm words.' },
    { name: 'open_mind_facts', description: "Open the Weekly Mind Facts report: a nutrition label for the user's week of reading." },
  ],
}];

let session = null;
const state = (s, message = '', extra = {}) => chrome.runtime.sendMessage({ type: 'debait/call-state', state: s, message, ...extra }).catch(() => {});

function open(debugToken, i, model, handle) {
  const live = getLiveGenerativeModel(getAi(debugToken, i), {
    model,
    systemInstruction: SYSTEM,
    tools: TOOLS,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
      // what the user said, as text: shown under the orb so you can see Debait heard you right
      inputAudioTranscription: {},
      // long calls: the server trims old context instead of ending the call
      contextWindowCompression: { slidingWindow: {} },
    },
  });
  // asking for resumption makes the server send handles we can reconnect with
  return live.connect(handle ? { handle } : {});
}

// tries every project (team, then backup) with every live model until one connects
let picked = null; // { i, model } that connected, reused when reconnecting
// Keep Live WebSocket App Check skips local to voice calls so normal HTTP scoring isn't affected.
const liveSkip = new Set();
const CONNECT_TIMEOUT = 10000;

// Browsers cannot attach X-Firebase-AppCheck headers to WebSocket handshakes, so try allowed
// projects without enforced App Check first for Live calls (HTTP scoring still tries Team first).
export function liveProjectOrder(order = projectOrder()) {
  const noAppCheck = order.filter((i) => FIREBASE_PROJECTS[i]?.appCheckEnforced === false);
  const rest = order.filter((i) => FIREBASE_PROJECTS[i]?.appCheckEnforced !== false);
  return [...noAppCheck, ...rest];
}

export function withConnectTimeout(promise, ms = CONNECT_TIMEOUT) {
  let timer;
  let timedOut = false;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('connection timed out'));
    }, ms);
  });
  // If the underlying WebSocket resolves after the timeout already fired, close it immediately.
  Promise.resolve(promise).then((s) => {
    if (timedOut) s?.close?.().catch?.(() => {});
  }, () => {});
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function connect(debugToken, handle, gen) {
  if (!isOnline()) throw new Error('OFFLINE: Talk to Debait needs an internet connection.');
  if (picked) {
    try {
      const s = await withConnectTimeout(open(debugToken, picked.i, picked.model, handle));
      if (!active || gen !== callGen) { s.close().catch(() => {}); return null; }
      return s;
    } catch { picked = null; }
  }
  let lastErr = null;
  const baseOrder = liveProjectOrder(projectOrder());
  const projects = baseOrder.filter((i) => !liveSkip.has(i));
  const order = projects.length ? projects : baseOrder;
  for (const i of order) {
    if (!active || gen !== callGen) return null;
    if (!isOnline()) throw new Error('OFFLINE: Talk to Debait needs an internet connection.');
    // note: the Live WebSocket can't carry an App Check token from a browser, so calls only
    // connect on a project where App Check is not enforced for AI Logic
    for (const model of LIVE_MODELS) {
      if (!active || gen !== callGen) return null;
      try {
        const s = await withConnectTimeout(open(debugToken, i, model, handle));
        if (!active || gen !== callGen) { s.close().catch(() => {}); return null; }
        picked = { i, model };
        console.info(`[Debait] call connected: ${projectName(i)} project, ${model}`);
        return s;
      } catch (err) {
        lastErr = err;
        console.debug(`[Debait] call: ${projectName(i)} project, ${model} failed:`, err?.message || err);
        if (/app ?check/i.test(String(err?.message))) { liveSkip.add(i); break; } // no Live model will work on this project
      }
    }
  }
  throw lastErr || new Error('could not connect');
}

let audio = null;
let active = false;
let userMuted = false;
let callGen = 0;        // increments on every start/end so late async resolves never leak mic or socket
let handle = null;      // latest session resumption handle
let token = null;
let heard = '';         // what the user is saying, as the server transcribes it

async function runTools(calls, gen) {
  // the model asked to do things on the page: hand them to the tab, send the results back
  if (!active || gen !== callGen) return;
  state('working', calls[0]?.name);
  const responses = await Promise.all(calls.map(async (call) => {
    const res = await chrome.runtime.sendMessage({ type: 'debait/tool', name: call.name, args: call.args || {} }).catch(() => null);
    return { id: call.id, name: call.name, response: res?.result ?? { error: 'Debait is not running on this page. Ask the user to refresh it.' } };
  }));
  if (active && gen === callGen && session && !session.isClosed) {
    session.sendFunctionResponses(responses).catch(() => {});
    state('live');
  }
}

/** Reads the server until the socket closes. Returns true if it should reconnect. */
async function listen(s, gen) {
  try {
    for await (const msg of s.receive()) {
      if (!active || gen !== callGen) return false;
      if (msg.type === 'serverContent') {
        if (msg.interrupted) {
          heard = '';
          audio?.interrupt();
        }
        if (msg.inputTranscription?.text) {
          heard += msg.inputTranscription.text;
          state('heard', heard.trim());
        }
        if (msg.modelTurn || msg.turnComplete) heard = '';
        for (const part of msg.modelTurn?.parts || []) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) audio?.play(part.inlineData.data);
        }
      } else if (msg.type === 'toolCall') {
        runTools(msg.functionCalls || [], gen); // don't block audio while the page works
      } else if (msg.type === 'sessionResumptionUpdate') {
        if (msg.resumable !== false && msg.newHandle) handle = msg.newHandle;
      } else if (msg.type === 'goingAwayNotice') {
        break; // the server will close soon: move to a new connection now
      }
    }
  } catch (err) {
    console.debug('[Debait] call: connection dropped:', err?.message || err);
  }
  return active && gen === callGen; // dropped or going away: reconnect while the call is on
}

async function keepAlive(gen) {
  // reconnect into the same conversation whenever the connection drops
  let tries = 0;
  while (active && gen === callGen) {
    const again = await listen(session, gen);
    if (!again || !active || gen !== callGen) break;
    if (!isOnline()) {
      await endCall(true);
      state('error', 'You went offline — call ended.');
      return;
    }
    audio?.setMuted(true);
    state('reconnecting');
    try { await session?.close(); } catch { /* already closed */ }
    let ok = false;
    while (active && gen === callGen && tries < 6 && !ok) {
      if (!isOnline()) break;
      await new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** tries)));
      if (!active || gen !== callGen || !isOnline()) break;
      tries++;
      try {
        const next = await connect(token, handle, gen);
        if (next && active && gen === callGen) { session = next; ok = true; }
      } catch (err) {
        console.debug('[Debait] call: reconnect failed:', err?.message || err);
      }
    }
    if (!ok) {
      const wasActive = active && gen === callGen;
      if (wasActive) {
        await endCall(true);
        state('error', isOnline() ? 'The call dropped — check your internet and try again.' : 'You went offline — call ended.');
      }
      return;
    }
    tries = 0;
    audio?.setMuted(userMuted);
    state('live', '', { muted: userMuted });
  }
}

export async function startCall(debugToken) {
  if (active) return;
  if (!isOnline()) {
    state('error', 'Talk to Debait needs an internet connection.');
    return;
  }
  const gen = ++callGen;
  active = true;
  userMuted = false;
  token = debugToken;
  handle = null;
  heard = '';
  state('connecting', '', { muted: false });
  let nextSession = null;
  let nextAudio = null;
  try {
    nextSession = await connect(debugToken, null, gen);
    if (!nextSession || !active || gen !== callGen) {
      await nextSession?.close().catch(() => {});
      return;
    }
    nextAudio = await openAudio({
      onMic: (b64) => {
        if (active && !userMuted && gen === callGen && session && !session.isClosed) {
          session.sendAudioRealtime({ mimeType: 'audio/pcm;rate=16000', data: b64 }).catch(() => {});
        }
      },
      onTalking: (talking) => { if (active && gen === callGen) state(talking ? 'talking' : 'live'); },
    });
    if (!active || gen !== callGen) {
      await nextAudio.close().catch(() => {});
      await nextSession.close().catch(() => {});
      return;
    }
    session = nextSession;
    audio = nextAudio;
    if (userMuted) audio.setMuted(true);
    state('live', '', { muted: userMuted });
    keepAlive(gen);
    // nudge the model to say hello first
    session.send('The call just started. Say a quick, casual hi.', true).catch(() => {});
  } catch (err) {
    await nextAudio?.close().catch(() => {});
    await nextSession?.close().catch(() => {});
    if (gen !== callGen) return; // cancelled by endCall() while connecting
    const msg = String(err?.message || err);
    const offline = !isOnline() || /^OFFLINE:/i.test(msg);
    const micDenied = /NotAllowedError|PermissionDeniedError|permission/i.test(msg);
    const appCheck = /app ?check|401|403/i.test(msg);
    await endCall(true);
    state(
      'error',
      offline ? 'Talk to Debait needs an internet connection.'
        : micDenied ? 'Microphone access is blocked. Allow it in Chrome and try again.'
        : appCheck ? 'Voice needs Gemini: register the App Check code from the popup in a Firebase project.'
        : 'Could not connect the voice call. Check your internet and try again.',
    );
  }
}

export async function endCall(quiet = false) {
  callGen++;
  active = false;
  userMuted = false;
  heard = '';
  const s = session;
  const a = audio;
  session = null;
  audio = null;
  try { await s?.close(); } catch { /* already closed */ }
  try { await a?.close(); } catch { /* already closed */ }
  if (!quiet) state('ended', '', { muted: false });
}

export function setMuted(next) {
  if (!active) return false;
  userMuted = typeof next === 'boolean' ? next : !userMuted;
  audio?.setMuted(userMuted);
  state('mute', '', { muted: userMuted });
  return userMuted;
}

export const toggleMute = () => setMuted();
export const isMuted = () => active && userMuted;
export const inCall = () => active;

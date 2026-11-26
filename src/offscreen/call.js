// Call mode: a live voice conversation with Gemini Live API using App-Check-protected ephemeral tokens.
// Runs in the offscreen page, so it works the same on every website and the microphone
// permission is asked once for the extension, not per site.
// The model can act on the page you're looking at through tools (debait, restore, report, explain).
import { getFunctions, httpsCallable } from 'firebase/functions';
import { openAudio } from './voice-audio.js';
import { getFirebaseApp, isProjectAllowed, projectOrder, projectName, isOnline } from '../engine/firebaseEngine.js';
import { FIREBASE_PROJECTS, LIVE_MODELS, LIVE_VOICE, FUNCTIONS_REGION, LIVE_TOKEN_FUNCTION, ENABLE_LIVE_VOICE, VOICE_GATED_MESSAGE } from '../engine/firebaseConfig.js';

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

// Standard Gemini Live API tool declarations (no global WebSocket.prototype monkeypatch).
const TOOLS = [{
  functionDeclarations: [
    { name: 'page_report', description: 'Read what Debait found on the current page: how many headlines, how many are bait, and the worst examples.' },
    { name: 'debait_page', description: 'Rewrite every bait headline on the current page into an honest version.' },
    { name: 'restore_page', description: 'Bring back the original headlines on the current page.' },
    {
      name: 'explain_headline',
      description: 'Explain why one bait headline from page_report is manipulative, word by word, and give its honest rewrite.',
      parameters: {
        type: 'OBJECT',
        properties: {
          number: { type: 'INTEGER', description: 'The headline number from page_report, starting at 1.' },
        },
        required: ['number'],
      },
    },
    {
      name: 'set_setting',
      description: 'Turn a Debait setting on or off.',
      parameters: {
        type: 'OBJECT',
        properties: {
          setting: { type: 'STRING', enum: ['show_tags', 'auto_debait', 'local_only', 'show_orb'] },
          on: { type: 'BOOLEAN' },
        },
        required: ['setting', 'on'],
      },
    },
    { name: 'summarize_page', description: 'Summarize the whole page the user is on (the article, or the main stories) in 2 or 3 sentences. Read the summary out in your own calm words.' },
    { name: 'open_mind_facts', description: "Open the Weekly Mind Facts report: a nutrition label for the user's week of reading." },
  ],
}];

let session = null;
const state = (s, message = '', extra = {}) => chrome.runtime.sendMessage({ type: 'debait/call-state', state: s, message, ...extra }).catch(() => {});

const CONNECT_TIMEOUT = 10000;
const WS_OPEN = 1;
const MAX_WS_BACKPRESSURE = 32768;

/** Builds the constrained Gemini Live WebSocket URL authenticated with a short-lived ephemeral token. */
export function buildConstrainedWsUrl(token, apiVersion = 'v1alpha') {
  const ver = apiVersion === 'v1beta' ? 'v1beta' : 'v1alpha';
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${ver}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
}

// Enforce project policy first so Live calls never silently route to a disabled backup project.
export function liveProjectOrder(order = projectOrder()) {
  const allowed = order.filter((i) => isProjectAllowed(i));
  const permitted = allowed.length ? allowed : projectOrder();
  const noAppCheck = permitted.filter((i) => FIREBASE_PROJECTS[i]?.appCheckEnforced === false);
  const rest = permitted.filter((i) => FIREBASE_PROJECTS[i]?.appCheckEnforced !== false);
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

/** Classifies Live call startup failures into accurate, actionable user messages. */
export function classifyCallError(err, online = isOnline()) {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '');
  if (!online || /^OFFLINE:/i.test(msg)) {
    return 'Talk to Debait needs an internet connection.';
  }
  if (/NotAllowedError|PermissionDeniedError|permission/i.test(msg)) {
    return 'Microphone access is blocked. Allow it in Chrome and try again.';
  }
  if (/^APP_CHECK_ERROR:/i.test(msg) || code.includes('unauthenticated') || /app ?check|401|403/i.test(msg)) {
    return 'Voice blocked by App Check: register the debug token from the Debait popup in Firebase Console (debait-d6d5d).';
  }
  if (/^TOKEN_ENDPOINT_NOT_FOUND:/i.test(msg) || code.includes('not-found') || /\b404\b/.test(msg)) {
    return 'Voice token service is not deployed on debait-d6d5d yet. Deploy mintLiveVoiceToken and try again.';
  }
  if (/^TOKEN_MINT_ERROR:/i.test(msg) || code.includes('failed-precondition') || code.includes('internal')) {
    return 'Could not mint a voice session token on debait-d6d5d. Check App Check and GEMINI_API_KEY in Firebase Functions.';
  }
  return 'Could not connect the voice call. Check your internet and try again.';
}

/** Requests a single-use ephemeral Gemini Live token via the App-Check-enforced callable function. */
async function mintEphemeralToken(debugToken, projectIndex, model) {
  const app = getFirebaseApp(debugToken, projectIndex);
  const fn = httpsCallable(getFunctions(app, FUNCTIONS_REGION), LIVE_TOKEN_FUNCTION);
  try {
    const res = await fn({ model });
    const data = res?.data;
    if (!data?.token || typeof data.token !== 'string') {
      throw new Error('TOKEN_MINT_ERROR: token endpoint returned an empty token');
    }
    return {
      token: data.token,
      model: data.model || model,
      apiVersion: data.apiVersion || 'v1alpha',
    };
  } catch (err) {
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || err || '');
    if (code.includes('unauthenticated') || /app ?check|401|403/i.test(msg)) {
      throw Object.assign(new Error(`APP_CHECK_ERROR: ${msg}`), { code: err?.code, fatal: true });
    }
    if (code.includes('not-found') || /\b404\b/.test(msg)) {
      throw Object.assign(new Error(`TOKEN_ENDPOINT_NOT_FOUND: ${msg}`), { code: err?.code, fatal: true });
    }
    if (/^TOKEN_MINT_ERROR:/i.test(msg)) throw err;
    throw Object.assign(new Error(`TOKEN_MINT_ERROR: ${msg}`), { code: err?.code });
  }
}

/** Opens a Gemini Live WebSocket directly with an ephemeral token and completes the setup handshake. */
function openEphemeralSession({ token: ephemeralToken, model, apiVersion, handle }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildConstrainedWsUrl(ephemeralToken, apiVersion));
    const queue = [];
    let notify = null;
    let closed = false;
    let settled = false;
    let streamError = null;

    const wake = () => {
      if (notify) {
        const fn = notify;
        notify = null;
        fn();
      }
    };

    const failHandshake = (err) => {
      if (settled) return;
      settled = true;
      closed = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(err);
    };

    const normalizeServerMsg = (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      if ('serverContent' in raw) return { type: 'serverContent', ...raw.serverContent };
      if ('toolCall' in raw) return { type: 'toolCall', ...raw.toolCall };
      if ('sessionResumptionUpdate' in raw) return { type: 'sessionResumptionUpdate', ...raw.sessionResumptionUpdate };
      if ('goAway' in raw) return { type: 'goingAwayNotice', ...raw.goAway };
      return null;
    };

    const sessionObj = {
      get isClosed() {
        return closed || ws.readyState !== WS_OPEN;
      },
      send(text, turnComplete = true) {
        if (this.isClosed) return Promise.reject(new Error('Live session is closed'));
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: String(text) }] }],
            turnComplete: !!turnComplete,
          },
        }));
        return Promise.resolve();
      },
      sendAudioRealtime(blob) {
        if (this.isClosed) return Promise.resolve();
        if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > MAX_WS_BACKPRESSURE) {
          return Promise.resolve();
        }
        ws.send(JSON.stringify({ realtimeInput: { audio: blob } }));
        return Promise.resolve();
      },
      sendFunctionResponses(functionResponses) {
        if (this.isClosed) return Promise.reject(new Error('Live session is closed'));
        ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
        return Promise.resolve();
      },
      async *receive() {
        while (!closed || queue.length > 0) {
          if (queue.length > 0) {
            yield queue.shift();
          } else if (streamError) {
            const err = streamError;
            streamError = null;
            throw err;
          } else {
            await new Promise((r) => { notify = r; });
          }
        }
      },
      close() {
        closed = true;
        wake();
        try {
          if (ws.readyState === WS_OPEN || ws.readyState === 0) ws.close(1000, 'Client closed session');
        } catch { /* ignore */ }
        return Promise.resolve();
      },
    };

    ws.addEventListener('open', () => {
      const setup = {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: LIVE_VOICE },
            },
          },
        },
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: TOOLS,
        inputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: handle ? { handle } : {},
      };
      try {
        ws.send(JSON.stringify({ setup }));
      } catch (err) {
        failHandshake(err);
      }
    });

    ws.addEventListener('message', async (event) => {
      let text;
      try {
        text = event.data instanceof Blob ? await event.data.text() : String(event.data || '');
      } catch (err) {
        if (!settled) failHandshake(err);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (!settled) {
        if ('setupComplete' in parsed) {
          settled = true;
          resolve(sessionObj);
        } else {
          failHandshake(new Error('Live WebSocket handshake failed before setupComplete'));
        }
        return;
      }
      const msg = normalizeServerMsg(parsed);
      if (msg) {
        queue.push(msg);
        wake();
      }
    });

    ws.addEventListener('error', () => {
      const err = new Error('Live WebSocket connection error');
      if (!settled) failHandshake(err);
      else {
        streamError = err;
        closed = true;
        wake();
      }
    });

    ws.addEventListener('close', (ev) => {
      const reason = ev.reason ? ` (${ev.reason})` : '';
      if (!settled) {
        failHandshake(new Error(`Live WebSocket closed during handshake: code ${ev.code}${reason}`));
      } else {
        closed = true;
        wake();
      }
    });
  });
}

// tries every permitted project + model using an App-Check-minted ephemeral token
let picked = null; // { i, model } that connected, reused when reconnecting

async function open(debugToken, i, model, handle) {
  const minted = await mintEphemeralToken(debugToken, i, model);
  return openEphemeralSession({ ...minted, handle });
}

async function connect(debugToken, handle, gen) {
  if (!isOnline()) throw new Error('OFFLINE: Talk to Debait needs an internet connection.');
  if (picked && isProjectAllowed(picked.i)) {
    try {
      const s = await withConnectTimeout(open(debugToken, picked.i, picked.model, handle));
      if (!active || gen !== callGen) { s.close().catch(() => {}); return null; }
      return s;
    } catch (err) {
      picked = null;
      if (err?.fatal) throw err;
    }
  } else {
    picked = null;
  }
  let lastErr = null;
  const order = liveProjectOrder(projectOrder());
  for (const i of order) {
    if (!active || gen !== callGen) return null;
    if (!isOnline()) throw new Error('OFFLINE: Talk to Debait needs an internet connection.');
    for (const model of LIVE_MODELS) {
      if (!active || gen !== callGen) return null;
      try {
        const s = await withConnectTimeout(open(debugToken, i, model, handle));
        if (!active || gen !== callGen) { s.close().catch(() => {}); return null; }
        picked = { i, model };
        console.info(`[Debait] call connected via ephemeral token: ${projectName(i)} project, ${model}`);
        return s;
      } catch (err) {
        lastErr = err;
        console.debug(`[Debait] call: ${projectName(i)} project, ${model} failed:`, err?.message || err);
        if (err?.fatal) throw err; // App Check rejection or undeployed endpoint: stop retrying other models
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
    let lastErr = null;
    while (active && gen === callGen && tries < 4 && !ok) {
      if (!isOnline()) break;
      await new Promise((r) => setTimeout(r, Math.min(3000, 400 * 2 ** tries)));
      if (!active || gen !== callGen || !isOnline()) break;
      tries++;
      try {
        const next = await connect(token, handle, gen);
        if (next && active && gen === callGen) { session = next; ok = true; }
      } catch (err) {
        lastErr = err;
        console.debug('[Debait] call: reconnect failed:', err?.message || err);
        if (err?.fatal) break;
      }
    }
    if (!ok) {
      const wasActive = active && gen === callGen;
      if (wasActive) {
        await endCall(true);
        state('error', lastErr?.fatal ? classifyCallError(lastErr) : isOnline() ? 'The call dropped — check your internet and try again.' : 'You went offline — call ended.');
      }
      return;
    }
    tries = 0;
    audio?.setMuted(userMuted);
    state('live', '', { muted: userMuted });
  }
}

export async function startCall(debugToken) {
  if (!ENABLE_LIVE_VOICE) {
    state('error', VOICE_GATED_MESSAGE, { muted: false });
    return;
  }
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
    await endCall(true);
    state('error', classifyCallError(err));
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

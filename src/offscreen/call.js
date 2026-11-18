// Call mode: a live voice conversation with Gemini (Firebase AI Logic Live API).
// Runs in the offscreen page, so it works the same on every website and the microphone
// permission is asked once for the extension, not per site.
// The model can act on the page you're looking at through tools (debait, restore, report, explain).
import { getLiveGenerativeModel, ResponseModality, Schema } from 'firebase/ai';
import { openAudio } from './voice-audio.js';
import { getAi, projectOrder, projectName, setPreferredProject, skipProject } from '../engine/firebaseEngine.js';
import { LIVE_MODELS, LIVE_VOICE } from '../engine/firebaseConfig.js';

const SYSTEM = `You are Debait, a warm, calm voice assistant built into a Chrome extension.
Debait spots bait headlines (written to make people angry, scared or envious), labels them Rage, Fear, Envy or Clean,
and rewrites them into honest headlines that keep the facts.
You are on a live voice call with the user. Keep every reply short: one or two natural sentences.
Use your tools to act on the web page the user is looking at: report on it, debait it, restore it, explain a headline,
or change a setting. Always call page_report before talking about what is on the page.
Explain manipulation plainly and kindly. Never claim to fact-check news, and never invent headlines.
Start the call by saying hi in a few words and offering to check the page.
Always speak English. Speak clearly at a calm, natural pace, in short sentences, with a brief pause between ideas.
Let the user finish their sentence before you answer.
If you did not clearly hear or understand what the user said, say so briefly and ask them to repeat it. Never guess.
Ignore background noise, music and your own voice coming back through the speakers.`;

// Speech detection tuned for real rooms: less jumpy about noise (start LOW), and it waits
// for a real pause before deciding you're done (end LOW + 800 ms), so it stops cutting you off.
// The SDK has no option for this, so it's added to the setup message on its way out.
const REALTIME_INPUT = {
  automaticActivityDetection: {
    startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
    endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
    prefixPaddingMs: 300,
    silenceDurationMs: 800,
  },
};
const wsSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  if (typeof data === 'string' && data.startsWith('{"setup":')) {
    try {
      const msg = JSON.parse(data);
      msg.setup.realtimeInputConfig = REALTIME_INPUT;
      data = JSON.stringify(msg);
    } catch { /* send as is */ }
  }
  return wsSend.call(this, data);
};

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
const state = (s, message = '') => chrome.runtime.sendMessage({ type: 'debait/call-state', state: s, message }).catch(() => {});

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

async function connect(debugToken, handle) {
  if (picked) {
    try { return await open(debugToken, picked.i, picked.model, handle); } catch { picked = null; }
  }
  let lastErr = null;
  for (const i of projectOrder()) {
    // note: the Live WebSocket can't carry an App Check token from a browser, so calls only
    // connect on a project where App Check is not enforced for AI Logic
    for (const model of LIVE_MODELS) {
      try {
        const session = await open(debugToken, i, model, handle);
        picked = { i, model };
        setPreferredProject(i);
        console.info(`[Debait] call connected: ${projectName(i)} project, ${model}`);
        return session;
      } catch (err) {
        lastErr = err;
        console.debug(`[Debait] call: ${projectName(i)} project, ${model} failed:`, err?.message || err);
        if (/app check/i.test(String(err?.message))) { skipProject(i); break; } // no model will work there
      }
    }
  }
  throw lastErr || new Error('could not connect');
}

let audio = null;
let active = false;
let handle = null;      // latest session resumption handle
let token = null;
let heard = '';         // what the user is saying, as the server transcribes it

async function runTools(calls) {
  // the model asked to do things on the page: hand them to the tab, send the results back
  state('working', calls[0]?.name);
  const responses = await Promise.all(calls.map(async (call) => {
    const res = await chrome.runtime.sendMessage({ type: 'debait/tool', name: call.name, args: call.args || {} }).catch(() => null);
    return { id: call.id, name: call.name, response: res?.result ?? { error: 'Debait is not running on this page. Ask the user to refresh it.' } };
  }));
  if (active && session && !session.isClosed) session.sendFunctionResponses(responses).catch(() => {});
  state('live');
}

/** Reads the server until the socket closes. Returns true if it should reconnect. */
async function listen(s) {
  try {
    for await (const msg of s.receive()) {
      if (!active) return false;
      if (msg.type === 'serverContent') {
        if (msg.interrupted) audio.interrupt();
        if (msg.inputTranscription?.text) {
          heard += msg.inputTranscription.text;
          state('heard', heard.trim());
        }
        if (msg.modelTurn || msg.turnComplete) heard = '';
        for (const part of msg.modelTurn?.parts || []) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) audio.play(part.inlineData.data);
        }
      } else if (msg.type === 'toolCall') {
        runTools(msg.functionCalls || []); // don't block audio while the page works
      } else if (msg.type === 'sessionResumptionUpdate') {
        if (msg.resumable !== false && msg.newHandle) handle = msg.newHandle;
      } else if (msg.type === 'goingAwayNotice') {
        break; // the server will close soon: move to a new connection now
      }
    }
  } catch (err) {
    console.debug('[Debait] call: connection dropped:', err?.message || err);
  }
  return active; // dropped or going away: reconnect while the call is on
}

async function keepAlive() {
  // reconnect into the same conversation whenever the connection drops
  let tries = 0;
  while (active) {
    const again = await listen(session);
    if (!again || !active) break;
    audio.setMuted(true);
    state('reconnecting');
    try { await session.close(); } catch { /* already closed */ }
    let ok = false;
    while (active && tries < 6 && !ok) {
      await new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** tries)));
      tries++;
      try { session = await connect(token, handle); ok = true; } catch (err) {
        console.debug('[Debait] call: reconnect failed:', err?.message || err);
      }
    }
    if (!ok) {
      if (active) state('error', 'The call dropped: check your internet and call again.');
      await endCall(true);
      return;
    }
    tries = 0;
    audio.setMuted(false);
    state('live');
  }
}

export async function startCall(debugToken) {
  if (active) return;
  active = true;
  token = debugToken;
  handle = null;
  state('connecting');
  try {
    session = await connect(debugToken, null);
    audio = await openAudio({
      onMic: (b64) => {
        if (active && session && !session.isClosed) session.sendAudioRealtime({ mimeType: 'audio/pcm;rate=16000', data: b64 }).catch(() => {});
      },
      onTalking: (talking) => active && state(talking ? 'talking' : 'live'),
    });
    state('live');
    keepAlive();
    // nudge the model to say hello first
    session.send('The call just started. Greet me briefly.', true).catch(() => {});
  } catch (err) {
    const appCheck = /app check|401|403/i.test(String(err?.message));
    await endCall(true);
    state('error', appCheck ? 'Voice needs Gemini: register the App Check code from the popup in a Firebase project.' : `Could not start the call (${err?.message || err})`);
  }
}

export async function endCall(quiet = false) {
  active = false;
  try { await session?.close(); } catch { /* already closed */ }
  try { await audio?.close(); } catch { /* already closed */ }
  session = null;
  audio = null;
  if (!quiet) state('ended');
}

export const inCall = () => active;

// Call mode: a live voice conversation with Gemini (Firebase AI Logic Live API).
// Runs in the offscreen page, so it works the same on every website and the microphone
// permission is asked once for the extension, not per site.
// The model can act on the page you're looking at through tools (debait, restore, report, explain).
import { getLiveGenerativeModel, startAudioConversation, ResponseModality, Schema } from 'firebase/ai';
import { getAi } from '../engine/firebaseEngine.js';
import { LIVE_MODELS, LIVE_VOICE } from '../engine/firebaseConfig.js';

const SYSTEM = `You are Debait, a warm, calm voice assistant built into a Chrome extension.
Debait spots bait headlines (written to make people angry, scared or envious), labels them Rage, Fear, Envy or Clean,
and rewrites them into honest headlines that keep the facts.
You are on a live voice call with the user. Keep every reply short: one or two natural sentences.
Use your tools to act on the web page the user is looking at: report on it, debait it, restore it, explain a headline,
or change a setting. Always call page_report before talking about what is on the page.
Explain manipulation plainly and kindly. Never claim to fact-check news, and never invent headlines.
Start the call by saying hi in a few words and offering to check the page.`;

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
    { name: 'open_mind_facts', description: "Open the Weekly Mind Facts report: a nutrition label for the user's week of reading." },
  ],
}];

let controller = null;
let session = null;
const state = (s, message = '') => chrome.runtime.sendMessage({ type: 'debait/call-state', state: s, message }).catch(() => {});

async function connect(debugToken) {
  let lastErr = null;
  for (const model of LIVE_MODELS) {
    try {
      const live = getLiveGenerativeModel(getAi(debugToken), {
        model,
        systemInstruction: SYSTEM,
        tools: TOOLS,
        generationConfig: {
          responseModalities: [ResponseModality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
        },
      });
      return await live.connect();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('could not connect');
}

export async function startCall(debugToken) {
  if (controller) return;
  state('connecting');
  try {
    session = await connect(debugToken);
    controller = await startAudioConversation(session, {
      // the model asked to do something on the page: hand it to the tab, send the result back
      functionCallingHandler: async (calls) => {
        const call = calls[0];
        state('working', call.name);
        const res = await chrome.runtime.sendMessage({ type: 'debait/tool', name: call.name, args: call.args || {} }).catch(() => null);
        state('live');
        return { id: call.id, name: call.name, response: res?.result ?? { error: 'Debait is not running on this page. Ask the user to refresh it.' } };
      },
    });
    state('live');
    // nudge the model to say hello first
    session.send('The call just started. Greet me briefly.', true).catch(() => {});
  } catch (err) {
    controller = null;
    session = null;
    const appCheck = /app check|401|403|permission/i.test(String(err?.message));
    state('error', appCheck ? 'Voice needs Gemini: send the App Check code in the popup to your teammate.' : `Could not start the call (${err?.message || err})`);
  }
}

export async function endCall() {
  try { await controller?.stop(); } catch { /* already stopped */ }
  try { await session?.close(); } catch { /* already closed */ }
  controller = null;
  session = null;
  state('ended');
}

export const inCall = () => !!controller;

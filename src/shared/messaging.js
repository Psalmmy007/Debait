export function contextUnavailable() {
  return Object.assign(new Error('Debait’s extension context is unavailable or was reloaded. Refresh this page and try again.'), { code: 'debait/context-unavailable' });
}
export async function sendRuntimeMessage(message, chromeApi = globalThis.chrome) {
  const runtime = chromeApi?.runtime;
  if (typeof runtime?.sendMessage !== 'function') throw contextUnavailable();
  try { return await runtime.sendMessage(message); }
  catch (error) {
    if (/extension context invalidated/i.test(error?.message || '')) throw contextUnavailable();
    throw error;
  }
}

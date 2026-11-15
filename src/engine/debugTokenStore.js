// Extension-origin IndexedDB is not readable by website content scripts. Do not
// keep App Check debug credentials in chrome.storage.local, which those scripts use.
function openStore(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('debait-development-auth', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('credentials');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open development authentication storage.'));
  });
}
export async function readDebugToken(indexedDB) {
  const db = await openStore(indexedDB);
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('credentials').objectStore('credentials').get('app-check-debug');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not read development authentication storage.'));
    });
  } finally { db.close(); }
}
export async function writeDebugToken(indexedDB, token) {
  const db = await openStore(indexedDB);
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('credentials', 'readwrite');
      transaction.objectStore('credentials').put(token, 'app-check-debug');
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(new Error('Could not save development authentication storage.'));
    });
  } finally { db.close(); }
}
export function createDebugTokenStore({ read, write, local, randomUUID }) {
  let pending;
  return () => pending ||= (async () => {
    const stored = await read();
    const legacy = await local.get('appCheckDebugToken');
    const token = stored || legacy.appCheckDebugToken || randomUUID();
    if (!stored) await write(token);
    // Migrate only after the protected write succeeds. Never send a token to a website.
    await local.remove('appCheckDebugToken');
    return token;
  })().catch(error => { pending = undefined; throw error; });
}

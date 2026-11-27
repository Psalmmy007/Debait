// Some sites (YouTube) enforce Trusted Types: assigning a plain string to innerHTML throws.
// Every HTML insertion in the content script goes through setHTML, which wraps the string in a
// Trusted Types policy when the page allows it. On pages whose CSP forbids our policy name
// (e.g. strict IDE/Codespaces hosts), we avoid throwing unhandled CSP/TypeErrors.
let policy;

function trusted(str) {
  if (policy === undefined) {
    policy = null;
    try {
      if (globalThis.trustedTypes?.createPolicy) {
        policy = globalThis.trustedTypes.createPolicy('debait', { createHTML: (s) => s });
      }
    } catch {
      // Page CSP disallows the 'debait' TrustedTypePolicy name; use defaultPolicy if available.
      policy = globalThis.trustedTypes?.defaultPolicy || null;
    }
  }
  return policy?.createHTML ? policy.createHTML(str) : str;
}

export function setHTML(el, str) {
  try {
    el.innerHTML = trusted(str);
  } catch {
    // Host enforces strict Trusted Types without permitting our policy: degrade safely with no crash.
  }
}

// Styles for our shadow roots. A constructed stylesheet is parsed once and shared by every
// tag on the page, and strict sites can't block it the way they can block <style> tags.
const sheets = new Map();
export function adoptCss(root, cssText) {
  try {
    let sheet = sheets.get(cssText);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      sheets.set(cssText, sheet);
    }
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = cssText;
    root.prepend(style);
  }
}

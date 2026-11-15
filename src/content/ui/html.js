// Some sites (YouTube) enforce Trusted Types: assigning a plain string to innerHTML throws.
// Every HTML insertion in the content script goes through setHTML, which wraps the string in a
// Trusted Types policy when the page has the API. Our templates are our own strings (any text that
// comes from a page or the AI is escaped before it gets here), so the policy passes them through.
let policy;

function trusted(str) {
  if (policy === undefined) {
    policy = null;
    try {
      if (globalThis.trustedTypes?.createPolicy) {
        policy = globalThis.trustedTypes.createPolicy('debait', { createHTML: (s) => s });
      }
    } catch {
      // the page doesn't allow our policy name; fall back to plain strings
    }
  }
  return policy ? policy.createHTML(str) : str;
}

export function setHTML(el, str) {
  el.innerHTML = trusted(str);
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

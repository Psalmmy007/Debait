// Small black-and-white icons, drawn as inline SVG (they inherit the text colour).
const stroke = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export const ICON = {
  // bolt
  rage: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M7.3.7 2.5 6.9h2.8l-.8 4.4L9.5 5H6.6z"/></svg>',
  // warning triangle
  fear: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.4"><path d="M6 1.5 11 10.2H1z"/><path d="M6 5v2.2M6 8.8v.1"/></svg>`,
  // eye
  envy: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.3"><path d="M1 6s1.9-3.4 5-3.4S11 6 11 6 9.1 9.4 6 9.4 1 6 1 6z"/><circle cx="6" cy="6" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  clean: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.7"><path d="M2.4 6.4 4.9 8.9l4.7-5.6"/></svg>`,
  check: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.7"><path d="M2.4 6.4 4.9 8.9l4.7-5.6"/></svg>`,
  dots: '<svg viewBox="0 0 12 12" fill="currentColor"><circle cx="2" cy="6" r="1.3"/><circle cx="6" cy="6" r="1.3"/><circle cx="10" cy="6" r="1.3"/></svg>',
  close: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.6"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>`,
  share: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.5"><path d="M6 7.5V1.5M3.5 4 6 1.5 8.5 4M2.5 6.5v3.5h7V6.5"/></svg>`,
  arrow: `<svg viewBox="0 0 12 12" ${stroke} stroke-width="1.6"><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5"/></svg>`,
};

export const LABEL = { rage: 'Rage', fear: 'Fear', envy: 'Envy', clean: 'Clean' };
export const SOURCE = { 'on-device': 'Gemini Nano, on this device', cloud: 'Gemini, in the cloud', mock: 'Quick estimate', none: 'AI not ready' };

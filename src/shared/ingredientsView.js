import { ICON } from '../content/ui/icons.js';
import { setHTML } from '../content/ui/html.js';
import { INGREDIENTS } from './ingredients.js';
export function createIngredientsGuide() {
  const guide = document.createElement('details'); guide.className = 'ingredients-guide';
  const summary = document.createElement('summary'); summary.textContent = 'Know Your Ingredients'; guide.append(summary);
  const intro = document.createElement('p'); intro.textContent = 'These labels describe headline presentation, not whether a story is true. Examples below are fictional.'; guide.append(intro);
  for (const item of INGREDIENTS) {
    const entry = document.createElement('details'); entry.className = 'ingredient-entry'; entry.dataset.ingredient = item.key;
    const title = document.createElement('summary');
    const icon = document.createElement('span'); icon.className = 'ingredient-icon'; icon.setAttribute('aria-hidden', 'true'); if (ICON[item.key]) setHTML(icon, ICON[item.key]); else icon.textContent = item.icon;
    title.append(icon, document.createTextNode(item.name + (item.key.endsWith('-preview') ? ' · Not active' : ''))); entry.append(title);
    for (const text of [item.status, item.definition, `Example: “${item.example}”`, item.explanation]) {
      const p = document.createElement('p'); p.textContent = text; entry.append(p);
    }
    guide.append(entry);
  }
  return guide;
}

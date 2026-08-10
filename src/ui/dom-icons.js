export const $ = (selector) => document.querySelector(selector);

export function icon(name) {
  return `<i class="icon-glyph" data-lucide="${name}" aria-hidden="true"></i>`;
}

export function actionLabel(iconName, label) {
  return `<span class="action-label">${icon(iconName)}<span>${label}</span></span>`;
}

export function inspectorAction(action, iconName, label, title = label) {
  return `<button type="button" class="inspector-action" data-action="${action}" title="${title}" aria-label="${title}">${icon(iconName)}<span>${label}</span></button>`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function refreshIcons() {
  if (!globalThis.lucide?.createIcons) return;
  globalThis.lucide.createIcons({ attrs: { "stroke-width": "1.8" } });
}

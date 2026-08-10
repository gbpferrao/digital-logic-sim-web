const NOTIFICATION_ICONS = Object.freeze({
  info: "info",
  success: "check",
  warning: "triangle-alert",
  error: "circle-alert"
});

const LEAVE_DURATION = 180;

export function createNotificationCenter({ root, refreshIcons, defaultDuration = 3400 } = {}) {
  if (!root) {
    return {
      notify: () => () => {},
      dismiss: () => {},
      clear: () => {}
    };
  }

  let sequence = 0;
  const entries = new Map();

  function clearTimer(entry) {
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  function dismiss(id) {
    const key = String(id);
    const entry = entries.get(key);
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    clearTimer(entry);
    entry.element.classList.add("is-leaving");
    setTimeout(() => {
      entry.element.remove();
      entries.delete(key);
    }, LEAVE_DURATION);
  }

  function notify(message, options = {}) {
    const text = String(message ?? "").trim();
    if (!text) return () => {};

    const requestedTone = String(options.tone || "info").toLowerCase();
    const tone = Object.hasOwn(NOTIFICATION_ICONS, requestedTone) ? requestedTone : "info";
    const requestedDuration = Number(options.duration);
    const duration = Number.isFinite(requestedDuration)
      ? Math.max(0, requestedDuration)
      : tone === "error" ? 4800 : defaultDuration;
    const id = "notification-" + (++sequence);
    const element = document.createElement("article");
    element.className = "notification notification-" + tone;
    element.setAttribute("role", tone === "error" ? "alert" : "status");

    const iconElement = document.createElement("span");
    iconElement.className = "notification-icon";
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.innerHTML = '<i class="icon-glyph" data-lucide="' + NOTIFICATION_ICONS[tone] + '" aria-hidden="true"></i>';

    const messageElement = document.createElement("span");
    messageElement.className = "notification-message";
    messageElement.textContent = text;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "notification-close icon-button";
    close.dataset.notificationClose = id;
    close.title = "Dismiss notification";
    close.setAttribute("aria-label", "Dismiss notification");
    close.innerHTML = '<i class="icon-glyph" data-lucide="x" aria-hidden="true"></i>';

    element.append(iconElement, messageElement, close);
    const entry = { element, timer: null, leaving: false };
    entries.set(id, entry);
    root.prepend(element);
    refreshIcons?.();
    if (duration > 0) entry.timer = setTimeout(() => dismiss(id), duration);
    return () => dismiss(id);
  }

  root.addEventListener("click", (event) => {
    const close = event.target.closest("[data-notification-close]");
    if (close && root.contains(close)) dismiss(close.dataset.notificationClose);
  });

  return {
    notify,
    dismiss,
    clear: () => [...entries.keys()].forEach(dismiss)
  };
}

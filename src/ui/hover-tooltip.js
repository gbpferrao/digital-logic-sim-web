const TOOLTIP_OFFSET = 12;
const VIEWPORT_MARGIN = 8;
const FALLBACK_WIDTH = 96;
const FALLBACK_HEIGHT = 24;
const HOVER_REVEAL_DELAY = 500;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function hoverTooltipPosition({
  cursor,
  width = FALLBACK_WIDTH,
  height = FALLBACK_HEIGHT,
  viewportWidth,
  viewportHeight,
  offset = TOOLTIP_OFFSET,
  margin = VIEWPORT_MARGIN
} = {}) {
  const safeCursor = cursor ?? { x: 0, y: 0 };
  const safeWidth = Math.max(0, Number(width) || FALLBACK_WIDTH);
  const safeHeight = Math.max(0, Number(height) || FALLBACK_HEIGHT);
  const safeViewportWidth = Math.max(0, Number(viewportWidth) || 0);
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const maxX = Math.max(margin, safeViewportWidth - safeWidth - margin);
  const maxY = Math.max(margin, safeViewportHeight - safeHeight - margin);
  return {
    x: clamp(Number(safeCursor.x) + offset, margin, maxX),
    y: clamp(Number(safeCursor.y) + offset, margin, maxY)
  };
}

// The tooltip is deliberately a separate layer from the world canvas. It is
// a stationary-hover affordance, not a cursor follower: raw movement hides
// it immediately, and a resolved target is revealed only after the pointer
// has stayed still for a short settling period.
export function createHoverTooltipController({ element, container, revealDelay = HOVER_REVEAL_DELAY } = {}) {
  let name = "";
  let lastCursor = null;
  let metrics = null;
  let lastTransform = "";
  let revealTimer = null;
  let visible = false;

  const clearRevealTimer = () => {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
  };

  const hideVisual = () => {
    visible = false;
    element?.classList.remove("visible");
    element?.setAttribute?.("aria-hidden", "true");
  };

  const measure = () => {
    if (!element || !container) return;
    const bounds = element.getBoundingClientRect();
    metrics = {
      width: Math.max(0, bounds.width),
      height: Math.max(0, bounds.height),
      viewportWidth: Math.max(0, container.clientWidth),
      viewportHeight: Math.max(0, container.clientHeight)
    };
  };

  const applyPosition = (cursor) => {
    if (!element || !container || !name || !cursor) return false;
    if (!metrics) measure();
    const position = hoverTooltipPosition({ ...metrics, cursor });
    const transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    if (transform === lastTransform) return false;
    element.style.transform = transform;
    lastTransform = transform;
    return true;
  };

  const reveal = () => {
    revealTimer = null;
    if (!element || !container || !name || !lastCursor) return;
    element.classList.remove("hidden");
    metrics = null;
    measure();
    lastTransform = "";
    applyPosition(lastCursor);
    element.classList.add("visible");
    element.setAttribute?.("aria-hidden", "false");
    visible = true;
  };

  const scheduleReveal = () => {
    clearRevealTimer();
    if (!name || !lastCursor) return;
    const delay = Math.max(0, Number(revealDelay) || 0);
    revealTimer = setTimeout(reveal, delay);
  };

  const move = (cursor) => {
    if (!cursor) return false;
    const nextCursor = { x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 };
    const changed = !lastCursor || nextCursor.x !== lastCursor.x || nextCursor.y !== lastCursor.y;
    lastCursor = nextCursor;
    if (!changed) return false;
    clearRevealTimer();
    hideVisual();
    lastTransform = "";
    metrics = null;
    return true;
  };

  const setName = (nextName, cursor = lastCursor) => {
    const normalized = String(nextName || "").trim();
    if (cursor) lastCursor = { x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 };
    if (normalized === name) {
      if (normalized && !visible && revealTimer === null) scheduleReveal();
      return false;
    }
    clearRevealTimer();
    name = normalized;
    hideVisual();
    lastTransform = "";
    metrics = null;
    if (!name) return true;
    element.textContent = name;
    element.classList.remove("hidden");
    scheduleReveal();
    return true;
  };

  const hide = () => {
    clearRevealTimer();
    name = "";
    hideVisual();
  };

  const refresh = (cursor = lastCursor) => {
    if (!element || !name || !visible || !cursor) return false;
    lastCursor = { x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 };
    metrics = null;
    measure();
    lastTransform = "";
    return applyPosition(lastCursor);
  };

  return {
    move,
    setName,
    hide,
    refresh,
    get name() { return name; }
  };
}

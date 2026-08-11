const TOOLTIP_OFFSET = 12;
const VIEWPORT_MARGIN = 8;
const FALLBACK_WIDTH = 96;
const FALLBACK_HEIGHT = 24;

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

// The tooltip is deliberately a separate layer from the world canvas. Its
// content changes at hover-resolution cadence, but its transform can follow
// every pointer event without asking the renderer to redraw the circuit.
export function createHoverTooltipController({ element, container } = {}) {
  let name = "";
  let lastCursor = null;
  let metrics = null;
  let lastTransform = "";

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

  const move = (cursor) => {
    if (!element || !container || !name || !cursor) return false;
    lastCursor = { x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 };
    if (!metrics) measure();
    const position = hoverTooltipPosition({ ...metrics, cursor: lastCursor });
    const transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    if (transform === lastTransform) return false;
    element.style.transform = transform;
    lastTransform = transform;
    return true;
  };

  const setName = (nextName, cursor = lastCursor) => {
    const normalized = String(nextName || "").trim();
    if (normalized === name) {
      if (normalized) move(cursor);
      return false;
    }
    name = normalized;
    lastTransform = "";
    metrics = null;
    if (!name) {
      element?.classList.add("hidden");
      return true;
    }
    element.textContent = name;
    element.classList.remove("hidden");
    measure();
    move(cursor);
    return true;
  };

  const hide = () => setName("");

  const refresh = (cursor = lastCursor) => {
    if (!element || !name) return false;
    metrics = null;
    measure();
    lastTransform = "";
    return move(cursor);
  };

  return {
    move,
    setName,
    hide,
    refresh,
    get name() { return name; }
  };
}

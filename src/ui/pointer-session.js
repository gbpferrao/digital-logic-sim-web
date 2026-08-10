export const POINTER_DRAG_THRESHOLD_PX = 5;

export function createPointerSession({
  pointerId,
  kind,
  originScreen,
  originWorld,
  target = null,
  additive = false
}) {
  return {
    pointerId,
    kind,
    originScreen: { ...originScreen },
    originWorld: { ...originWorld },
    target,
    additive: Boolean(additive),
    moved: false
  };
}

export function pointerDistance(session, screen) {
  if (!session || !screen) return 0;
  return Math.hypot(screen.x - session.originScreen.x, screen.y - session.originScreen.y);
}

export function hasPointerMoved(session, screen, threshold = POINTER_DRAG_THRESHOLD_PX) {
  return pointerDistance(session, screen) >= threshold;
}

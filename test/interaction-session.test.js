import assert from "node:assert/strict";
import test from "node:test";
import { createPointerSession, hasPointerMoved, pointerDistance } from "../src/ui/pointer-session.js";

test("pointer sessions keep one stable origin for click-versus-drag decisions", () => {
  const session = createPointerSession({
    pointerId: 7,
    kind: "instance-press",
    originScreen: { x: 10, y: 20 },
    originWorld: { x: 100, y: 200 },
    target: { id: "chip-1" },
    additive: true
  });

  assert.equal(session.pointerId, 7);
  assert.equal(session.kind, "instance-press");
  assert.deepEqual(session.originWorld, { x: 100, y: 200 });
  assert.equal(session.additive, true);
  assert.equal(session.moved, false);
  assert.equal(pointerDistance(session, { x: 13, y: 24 }), 5);
  assert.equal(hasPointerMoved(session, { x: 13, y: 24 }), true);
});

test("sub-threshold movement remains a click", () => {
  const session = createPointerSession({
    pointerId: 2,
    kind: "empty-press",
    originScreen: { x: 0, y: 0 },
    originWorld: { x: 0, y: 0 }
  });

  assert.equal(hasPointerMoved(session, { x: 3, y: 3 }), false);
});

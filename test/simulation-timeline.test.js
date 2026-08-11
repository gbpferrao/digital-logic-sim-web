import assert from "node:assert/strict";
import test from "node:test";
import { SimulationBake, createTimelineFrame } from "../src/simulation-timeline.js";

function frame(step, signature) {
  return createTimelineFrame({ step, signature, snapshot: { step, signature } });
}

test("timeline keeps a meaningful checkpoint rail and an exact execution head", () => {
  const bake = new SimulationBake({ maxFrames: 8 });
  bake.reset(frame(0, "LOW"));
  bake.record(frame(1, "LOW"), { visible: false });
  bake.record(frame(2, "LOW"), { visible: false });

  assert.equal(bake.length, 1);
  assert.equal(bake.currentIndex, 0);
  assert.equal(bake.executionFrame.step, 2);

  bake.record(frame(3, "HIGH"));
  assert.equal(bake.length, 2);
  assert.equal(bake.latestCheckpoint.step, 3);
  assert.equal(bake.latestCheckpoint.signature, "HIGH");
});

test("timeline branches cleanly after scrubbing back", () => {
  const bake = new SimulationBake({ maxFrames: 8 });
  bake.reset(frame(0, "A"));
  bake.record(frame(1, "B"));
  bake.record(frame(2, "C"));
  bake.setCursor(1);
  bake.record(frame(5, "D"));

  assert.equal(bake.length, 3);
  assert.equal(bake.frameAt(0).step, 0);
  assert.equal(bake.frameAt(1).step, 1);
  assert.equal(bake.frameAt(2).step, 5);
  assert.equal(bake.latestCheckpoint.signature, "D");
});

test("bake owns recording, stability detection, and finalization", () => {
  const bake = new SimulationBake({ stabilityWindow: 2 });
  bake.begin(frame(0, "LOW"));
  assert.equal(bake.status, "baking");
  bake.record(frame(1, "LOW"), { visible: false });
  assert.equal(bake.executionFrame.step, 1);
  assert.equal(bake.observe("LOW"), false);
  assert.equal(bake.observe("LOW"), true);

  bake.finish("stable");
  assert.equal(bake.isReady, true);
  assert.equal(bake.reason, "stable");
  bake.reopen();
  bake.record(frame(2, "HIGH"));
  assert.equal(bake.isBaking, true);
  assert.equal(bake.latestCheckpoint.signature, "HIGH");

  bake.clear();
  assert.equal(bake.hasBake, false);
  assert.equal(bake.status, "empty");
});

test("bake keeps semantic interactions beside bounded engine trace metadata", () => {
  const bake = new SimulationBake({ maxInteractions: 2 });
  assert.equal(createTimelineFrame().traceStart, null);
  bake.begin(frame(0, "LOW"));
  bake.recordInteraction({ kind: "input-change", source: "canvas", target: "input-1", step: 0 });
  bake.recordInteraction({ kind: "manual-step", source: "step-control", step: 1 });
  bake.recordInteraction({ kind: "key-change", source: "keyboard", target: "Space", step: 2 });
  bake.recordTrace({ kind: "engine-tick", step: 1, changedCount: 1, propagations: 4 });

  assert.deepEqual(bake.interactions.map((event) => event.kind), ["manual-step", "key-change"]);
  assert.deepEqual(bake.interactions.map((event) => event.sequence), [1, 2]);
  assert.equal(bake.totalInteractions, 3);
  assert.equal(bake.traceEvents[0].propagations, 4);

  bake.clear();
  assert.equal(bake.interactions.length, 0);
  assert.equal(bake.traceEvents.length, 0);
  assert.equal(bake.totalInteractions, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { SimulationBake, SimulationTimeline, createTimelineFrame } from "../src/simulation-timeline.js";

function frame(step, signature) {
  return createTimelineFrame({ step, signature, snapshot: { step, signature } });
}

test("timeline keeps a meaningful checkpoint rail and an exact execution head", () => {
  const timeline = new SimulationTimeline({ maxFrames: 8 });
  timeline.reset(frame(0, "LOW"));
  timeline.record(frame(1, "LOW"), { visible: false });
  timeline.record(frame(2, "LOW"), { visible: false });

  assert.equal(timeline.length, 1);
  assert.equal(timeline.currentIndex, 0);
  assert.equal(timeline.executionFrame.step, 2);

  timeline.record(frame(3, "HIGH"));
  assert.equal(timeline.length, 2);
  assert.equal(timeline.latestCheckpoint.step, 3);
  assert.equal(timeline.latestCheckpoint.signature, "HIGH");
});

test("timeline branches cleanly after scrubbing back", () => {
  const timeline = new SimulationTimeline({ maxFrames: 8 });
  timeline.reset(frame(0, "A"));
  timeline.record(frame(1, "B"));
  timeline.record(frame(2, "C"));
  timeline.setCursor(1);
  timeline.record(frame(5, "D"));

  assert.equal(timeline.length, 3);
  assert.equal(timeline.frameAt(0).step, 0);
  assert.equal(timeline.frameAt(1).step, 1);
  assert.equal(timeline.frameAt(2).step, 5);
  assert.equal(timeline.latestCheckpoint.signature, "D");
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

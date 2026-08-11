import assert from "node:assert/strict";
import test from "node:test";
import { createRenderScheduler } from "../src/ui/performance.js";
import { SimulationBake, createTimelineFrame } from "../src/simulation-timeline.js";

test("render scheduler coalesces lanes into one frame", () => {
  const callbacks = [];
  const frames = [];
  const scheduler = createRenderScheduler({
    requestFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelFrame: () => {},
    onFrame: (lanes) => frames.push(lanes)
  });

  scheduler.request({ canvas: true, coordinates: true });
  scheduler.request({ simulation: true });
  assert.equal(callbacks.length, 1);
  callbacks.shift()();

  assert.deepEqual(frames, [{ canvas: true, coordinates: true, simulation: true, full: false }]);
  assert.deepEqual(scheduler.stats, { scheduled: 1, completed: 1, pending: false });
});

test("bake memory pruning keeps the initial and latest frames", () => {
  const bake = new SimulationBake({ maxFrames: 16, maxBytes: 420 });
  const frame = (step) => createTimelineFrame({ step, signature: String(step), snapshot: { payload: "x".repeat(80) } });
  bake.begin(frame(0));
  for (let step = 1; step <= 8; step += 1) bake.record(frame(step));

  assert.equal(bake.frameAt(0).step, 0);
  assert.equal(bake.latestCheckpoint.step, 8);
  assert.ok(bake.memoryBytes <= bake.maxBytes || bake.length === 2);
});

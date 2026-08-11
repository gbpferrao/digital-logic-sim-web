import assert from "node:assert/strict";
import test from "node:test";
import {
  SimulationTrace,
  summarizeSnapshotChanges
} from "../src/simulation-trace.js";

function snapshot({ input = 0, output = 0, display = [0, 0, 0] } = {}) {
  return {
    scopes: {
      root: {
        endpoints: { "input:0": { bits: input, tri: 0 } },
        instances: {
          output: {
            signals: { "0": { bits: output, tri: 0 } },
            internal: { display }
          }
        }
      }
    }
  };
}

test("snapshot change summaries capture signal, endpoint, and display flow", () => {
  const summary = summarizeSnapshotChanges(snapshot(), snapshot({ input: 1, output: 1, display: [1, 1, 1] }));

  assert.equal(summary.changedCount, 3);
  assert.deepEqual(summary.changedScopes, ["root"]);
  assert.deepEqual(summary.changes.map((change) => change.kind).sort(), ["display", "endpoint", "signal"]);

  const limited = summarizeSnapshotChanges(snapshot(), snapshot({ input: 1, output: 1, display: [1, 1, 1] }), { maxChanges: 1 });
  assert.equal(limited.changes.length, 1);
  assert.equal(limited.truncated, true);
});

test("simulation trace keeps a bounded, ordered engine-tick rail", () => {
  const trace = new SimulationTrace({ maxEvents: 2 });
  trace.record({ step: 1, changedCount: 1, propagations: 2 });
  trace.record({ step: 2, changedCount: 0 });
  trace.record({ step: 3, changedCount: 1 });

  assert.equal(trace.length, 2);
  assert.deepEqual(trace.events.map((event) => event.step), [2, 3]);
  assert.deepEqual(trace.events.map((event) => event.sequence), [1, 2]);
  assert.equal(trace.totalEvents, 3);
  assert.equal(trace.truncated, true);
});

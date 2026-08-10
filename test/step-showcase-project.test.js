import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

const projectFile = new URL("../storage/projects/step-showcase.json", import.meta.url);

test("the step showcase produces a visible staircase across simulation steps", async () => {
  const project = normalizeProject(JSON.parse(await readFile(projectFile, "utf8")));
  const simulator = new Simulator(project);
  const expectedStages = [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 1, 1, 1],
    [0, 0, 1, 1],
    [0, 0, 0, 1]
  ];

  expectedStages.forEach((expected, stepIndex) => {
    simulator.step();
    const actual = [1, 2, 3, 4].map((stage) => isHigh(simulator.snapshot.instances[`stage-${stage}`].signals["0"]) ? 1 : 0);
    assert.deepEqual(actual, expected, `visible stages after step ${stepIndex + 1}`);
  });
});

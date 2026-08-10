import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

const projectFile = new URL("../storage/projects/full-adder.json", import.meta.url);

test("the saved full-adder project implements all eight input combinations", async () => {
  const project = normalizeProject(JSON.parse(await readFile(projectFile, "utf8")));
  const simulator = new Simulator(project);
  const cases = [
    [0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 1, 0, 1],
    [1, 0, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 1, 1, 1, 1]
  ];

  for (const [a, b, cin, expectedSum, expectedCarry] of cases) {
    project.inputValues["input-a"] = a;
    project.inputValues["input-b"] = b;
    project.inputValues["input-cin"] = cin;
    simulator.step();
    assert.equal(isHigh(simulator.snapshot.instances["output-sum"].signals["0"]), Boolean(expectedSum), `SUM for ${a}${b}${cin}`);
    assert.equal(isHigh(simulator.snapshot.instances["output-carry"].signals["0"]), Boolean(expectedCarry), `CARRY for ${a}${b}${cin}`);
  }
});

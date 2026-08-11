import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

async function loadProject() {
  const raw = JSON.parse(await readFile(new URL("../storage/projects/multiplexer-2-1.json", import.meta.url), "utf8"));
  return normalizeProject(raw);
}

test("the from-scratch 2:1 multiplexer selects exactly one data input", async () => {
  const project = await loadProject();
  const simulator = new Simulator(project);
  const mux = project.customChips["MUX 2:1"];

  assert.equal(project.root.instances.find((instance) => instance.id === "mux")?.name, "MUX 2:1");
  assert.equal(mux.instances.some((instance) => instance.name === "MUX 2:1"), false, "the implementation stays one custom-chip layer deep");

  for (const select of [0, 1]) for (const d0 of [0, 1]) for (const d1 of [0, 1]) {
    project.inputValues["input-d0"] = d0;
    project.inputValues["input-d1"] = d1;
    project.inputValues["input-select"] = select;
    simulator.step();
    const selected = simulator.snapshot.instances.mux.signals.out;
    assert.equal(isHigh(selected), Boolean(select ? d1 : d0), `SELECT=${select}, D0=${d0}, D1=${d1}`);
  }
});

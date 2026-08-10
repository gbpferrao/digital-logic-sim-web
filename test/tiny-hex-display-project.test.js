import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

const projectFile = new URL("../storage/projects/tiny-hex-display.json", import.meta.url);
const segments = ["a", "b", "c", "d", "e", "f", "g"];
const glyphs = [
  "abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc",
  "abcdefg", "abcdfg", "abcefg", "cdefg", "adef", "bcdeg", "adefg", "aefg"
];

test("the hex display project has a readable layout and renders all 16 digits", async () => {
  const project = normalizeProject(JSON.parse(await readFile(projectFile, "utf8")));
  const instances = Object.fromEntries(project.root.instances.map((instance) => [instance.id, instance]));

  assert.equal(project.name, "Hex Display Lab");
  assert.deepEqual(project.root.size, { x: 1000, y: 560 });
  assert.deepEqual(
    ["input-d3", "input-d2", "input-d1", "input-d0"].map((id) => instances[id].position.x),
    [-400, -400, -400, -400]
  );
  assert.equal(instances.decoder.position.x, -80);
  assert.equal(instances.display.position.x, 360);
  assert.equal(project.root.annotations.length, 2);
  assert.equal(instances["input-d3"].label, "D3 (8)");

  const simulator = new Simulator(project);
  for (let value = 0; value < 16; value += 1) {
    ["d3", "d2", "d1", "d0"].forEach((bit, index) => {
      project.inputValues[`input-${bit}`] = (value >> (3 - index)) & 1;
    });
    simulator.step();
    const actual = segments
      .filter((segment, index) => isHigh(simulator.snapshot.instances.display.signals[String(index)]))
      .join("");
    assert.equal(actual, glyphs[value], `seven-segment glyph for ${value.toString(16).toUpperCase()}`);
  }
});

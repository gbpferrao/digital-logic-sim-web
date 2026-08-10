import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createJsonRepository } from "../server/json-repository.mjs";
import { COLORS } from "../src/domain/catalog.js";
import { BUILTINS, MIN_CHIP_SIZE, TYPE, chipBoundingBox, chipBoundsSize, collectionGroupsFor, createProject, normalizeProject } from "../src/model.js";

test("collection groups preserve saved order and always expose custom chips", () => {
  const project = normalizeProject({
    collectionOrder: ["CUSTOM", "LOGIC"],
    customChips: { Demo: { name: "Demo", inputPins: [], outputPins: [], instances: [], wires: [] } }
  });
  assert.deepEqual(collectionGroupsFor(project).map((group) => group.name).slice(0, 2), ["CUSTOM", "LOGIC"]);
  assert.deepEqual(collectionGroupsFor(project)[0].chips, ["Demo"]);
});

test("catalog descriptions are usable by the normalized project model", () => {
  const project = createProject("contract test");
  assert.equal(BUILTINS[TYPE.AND].inputPins.length, 2);
  assert.equal(BUILTINS[TYPE.AND].outputPins[0].direction, "output");
  assert.equal(project.root.type, TYPE.CUSTOM);
});

test("minimum canvas bounds do not inflate compact chip geometry", () => {
  assert.deepEqual(BUILTINS[TYPE.IN_1].size, { x: 60, y: 60 });
  assert.deepEqual(BUILTINS[TYPE.OUT_1].size, { x: 60, y: 60 });
  assert.deepEqual(chipBoundsSize(BUILTINS[TYPE.IN_1]), MIN_CHIP_SIZE);
  assert.deepEqual(chipBoundsSize(BUILTINS[TYPE.OUT_1]), MIN_CHIP_SIZE);
  for (const description of Object.values(BUILTINS)) {
    const bounds = chipBoundsSize(description);
    for (const pin of description.inputPins) {
      assert.equal(pin.x, -bounds.x / 2, description.name + " input pin should be on the left bounds");
      assert.ok(Math.abs(pin.y) <= bounds.y / 2, description.name + " input pin should remain inside the vertical bounds");
    }
    for (const pin of description.outputPins) {
      assert.equal(pin.x, bounds.x / 2, description.name + " output pin should be on the right bounds");
      assert.ok(Math.abs(pin.y) <= bounds.y / 2, description.name + " output pin should remain inside the vertical bounds");
    }
  }
  const project = normalizeProject({ customChips: { Tiny: { name: "Tiny", size: { x: 1, y: 1 }, inputPins: [], outputPins: [], instances: [], wires: [] } } });
  assert.deepEqual(project.customChips.Tiny.size, { x: 1, y: 1 });
  assert.deepEqual(chipBoundingBox(project, { name: "Tiny", position: { x: 0, y: 0 }, rotation: 0 }), {
    x: -MIN_CHIP_SIZE.x / 2,
    y: -MIN_CHIP_SIZE.y / 2,
    w: MIN_CHIP_SIZE.x,
    h: MIN_CHIP_SIZE.y
  });
});

test("native component colors reserve warning red for actual errors", () => {
  const nativeBodyColours = Object.values(BUILTINS).map((description) => description.colour.toLowerCase());
  assert.equal(nativeBodyColours.includes("#b94e57"), false);
  assert.equal(BUILTINS[TYPE.NAND].colour, COLORS.nand);
  assert.equal(BUILTINS[TYPE.CLOCK].colour, COLORS.control);
  assert.equal(BUILTINS[TYPE.RAM].colour, COLORS.memory);
  assert.equal(BUILTINS[TYPE.ROM].colour, COLORS.rom);
});

test("project menu keeps persistence actions in the library boundary", async () => {
  const html = await readFile(path.join(process.cwd(), "index.html"), "utf8");
  const main = await readFile(path.join(process.cwd(), "src", "main.js"), "utf8");
  const storage = await readFile(path.join(process.cwd(), "src", "storage.js"), "utf8");
  const importer = await readFile(path.join(process.cwd(), "src", "io", "project-import.js"), "utf8");

  assert.equal(html.includes("import-folder"), false);
  assert.equal(html.includes("bottom-unity-import"), false);
  assert.equal(html.includes("bottom-find"), false);
  assert.match(html, /id="bottom-save"[\s\S]*>SAVE</);
  assert.match(html, /SAVE AS PROJECT/);
  assert.match(html, /SAVE AS CHIP/);
  assert.equal(main.includes("readProjectFiles"), false);
  assert.equal(storage.includes("readProjectFiles"), false);
  assert.equal(importer.includes("readProjectFiles"), false);
});

test("json repository cleans runtime fields and round-trips projects and chips", async (t) => {
  const directory = await mkdtemp(path.join(process.cwd(), ".dls-repository-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const repository = createJsonRepository({ storageDir: directory });
  await repository.ensure();

  const project = createProject("Repository test");
  project._revision = 4;
  project._simSnapshot = { step: 4 };
  const saved = await repository.saveProject("repository-test", project);
  assert.equal(saved.storageId, "repository-test");
  assert.equal(saved._revision, undefined);
  assert.equal((await repository.getProject("repository-test"))._simSnapshot, undefined);
  assert.equal((await repository.listProjects())[0].name, "Repository test");

  const chip = await repository.saveChip("demo", { name: "Demo", description: { name: "Demo" } });
  assert.equal(chip.name, "Demo");
  assert.equal((await repository.getChip("demo")).description.name, "Demo");
  assert.match(await readFile(path.join(directory, "projects", "repository-test.json"), "utf8"), /Repository test/);
});

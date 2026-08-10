import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createJsonRepository } from "../server/json-repository.mjs";
import { COLORS } from "../src/domain/catalog.js";
import { BUILTINS, MIN_CHIP_SIZE, TYPE, chipBoundingBox, chipBoundsSize, collectionGroupsFor, createProject, customFromRoot, instanceFor, instancePinPosition, interfaceBindingsFor, normalizeProject } from "../src/model.js";

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

test("custom reusable fit records canvas geometry without annotation baggage", () => {
  const rawDescription = {
    id: "chip-composite",
    name: "Composite",
    type: TYPE.CUSTOM,
    kind: "custom",
    size: { x: 640, y: 440 },
    inputPins: [{ id: "in", name: "IN", direction: "input", x: -320, y: 0 }],
    outputPins: [{ id: "out", name: "OUT", direction: "output", x: 320, y: 0 }],
    instances: [{ id: "gate", name: TYPE.AND, position: { x: 0, y: 0 }, rotation: 0 }],
    wires: [],
    annotations: [{ id: "note", type: "text", text: "far away explanation", position: { x: 10000, y: 10000 }, width: 900, height: 300 }]
  };
  const withNote = normalizeProject({ customChips: { Composite: rawDescription } });
  const withoutNote = normalizeProject({ customChips: { Composite: { ...rawDescription, annotations: [] } } });
  const description = withNote.customChips.Composite;
  assert.deepEqual(description.fit, withoutNote.customChips.Composite.fit);
  assert.equal(description.fit.version, 1);
  assert.equal(chipBoundsSize(description).x, description.fit.bounds.w);
  assert.equal(chipBoundingBox(withNote, { name: "Composite", position: { x: 0, y: 0 }, rotation: 0 }).w, description.fit.bounds.w);
  assert.equal(instancePinPosition(withNote, { name: "Composite", position: { x: 0, y: 0 }, rotation: 0 }, "in").x, -description.fit.bounds.w / 2);
  assert.equal(instancePinPosition(withNote, { name: "Composite", position: { x: 0, y: 0 }, rotation: 0 }, "out").x, description.fit.bounds.w / 2);
});

test("custom chips preserve movable interface nodes and derive their public ports", () => {
  const project = createProject("node-authored");
  const input = instanceFor(TYPE.IN_1, { x: -180, y: -20 });
  input.label = "A";
  const output = instanceFor(TYPE.OUT_1, { x: 180, y: 20 });
  output.label = "RESULT";
  const not = instanceFor(TYPE.NOT, { x: 0, y: 0 });
  project.root.instances.push(input, not, output);
  project.root.wires.push(
    { id: "in", source: { owner: input.id, pin: "0" }, target: { owner: not.id, pin: "0" }, points: [] },
    { id: "out", source: { owner: not.id, pin: "1" }, target: { owner: output.id, pin: "0" }, points: [] }
  );

  const custom = customFromRoot(project, "NODE INV");
  assert.ok(custom.instances.some((item) => item.id === input.id && item.name === TYPE.IN_1));
  assert.ok(custom.instances.some((item) => item.id === output.id && item.name === TYPE.OUT_1));
  assert.deepEqual(interfaceBindingsFor(custom, "input").map((item) => item.instanceId), [input.id]);
  assert.deepEqual(interfaceBindingsFor(custom, "output").map((item) => item.instanceId), [output.id]);
  assert.equal(custom.inputPins[0].name, "A");
  assert.equal(custom.outputPins[0].name, "RESULT");
  assert.ok(custom.wires.every((wire) => wire.source.owner !== "root" && wire.target.owner !== "root"));

  const roundTrip = normalizeProject({ customChips: { [custom.name]: JSON.parse(JSON.stringify(custom)) } }).customChips[custom.name];
  assert.equal(roundTrip.instances.find((item) => item.id === input.id).position.y, -20);
  assert.equal(roundTrip.instances.find((item) => item.id === output.id).position.y, 20);
  assert.equal(interfaceBindingsFor(roundTrip, "input")[0].publicId, custom.inputPins[0].id);
});

test("legacy fixed custom pins migrate into terminal nodes and internal wire endpoints", () => {
  const project = normalizeProject({ customChips: {
    Legacy: {
      id: "legacy",
      name: "Legacy",
      type: TYPE.CUSTOM,
      kind: "custom",
      size: { x: 640, y: 440 },
      inputPins: [{ id: "in-a", name: "A", bits: 1, direction: "input", x: -320, y: -20 }],
      outputPins: [{ id: "out-z", name: "Z", bits: 1, direction: "output", x: 320, y: 20 }],
      instances: [{ id: "not", name: TYPE.NOT, position: { x: 0, y: 0 }, rotation: 0 }],
      wires: [
        { id: "a", source: { owner: "root", pin: "in-a" }, target: { owner: "not", pin: "0" }, points: [] },
        { id: "z", source: { owner: "not", pin: "1" }, target: { owner: "root", pin: "out-z" }, points: [] }
      ]
    }
  }}).customChips.Legacy;
  const inputBinding = interfaceBindingsFor(project, "input")[0];
  const outputBinding = interfaceBindingsFor(project, "output")[0];
  assert.ok(project.instances.some((item) => String(item.id) === inputBinding.instanceId && item.name === TYPE.IN_1));
  assert.ok(project.instances.some((item) => String(item.id) === outputBinding.instanceId && item.name === TYPE.OUT_1));
  assert.ok(project.wires.every((wire) => wire.source.owner !== "root" && wire.target.owner !== "root"));
  assert.equal(project.inputPins[0].id, "in-a");
  assert.equal(project.outputPins[0].id, "out-z");
  const normalizedAgain = normalizeProject({ customChips: { Legacy: JSON.parse(JSON.stringify(project)) } }).customChips.Legacy;
  assert.equal(normalizedAgain.instances.length, project.instances.length);
  assert.equal(interfaceBindingsFor(normalizedAgain).length, 2);
});

test("xray controls are a view contract rather than a second editing mode", async () => {
  const html = await readFile(path.join(process.cwd(), "index.html"), "utf8");
  const renderer = await readFile(path.join(process.cwd(), "src", "renderer.js"), "utf8");
  assert.match(html, /id="xray-toggle"/);
  assert.match(html, /id="bottom-xray"/);
  assert.match(html, /<kbd>X<\/kbd>/);
  assert.match(renderer, /const XRAY_MAX_DEPTH = 3/);
  assert.match(renderer, /XRAY_MAX_INSTANCES/);
  assert.match(renderer, /drawXrayComposite/);
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

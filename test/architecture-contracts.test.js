import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createJsonRepository } from "../server/json-repository.mjs";
import { BUILTINS, TYPE, collectionGroupsFor, createProject, normalizeProject } from "../src/model.js";

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

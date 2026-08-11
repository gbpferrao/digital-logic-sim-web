import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { annotationBoundingBox, chipBoundingBox, normalizeProject } from "../src/model.js";

const projectDirectories = [
  path.join(process.cwd(), "storage", "projects"),
  path.join(process.cwd(), "storage", "nand2tetris", "projects")
];
const chipDirectory = path.join(process.cwd(), "storage", "chips");

function overlaps(a, b) {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapX > 1 && overlapY > 1;
}

function endpointOwnerExists(description, endpoint) {
  const owner = String(endpoint?.owner ?? "");
  if (["root", "junction", "wire"].includes(owner)) return true;
  return (description.instances ?? []).some((instance) => String(instance.id) === owner);
}

function assertCollisionFree(project, descriptions, label) {
  for (const [name, description] of descriptions) {
        const ids = new Set();
        const boxes = (description.instances ?? []).map((instance) => {
          assert.ok(!ids.has(String(instance.id)), `${label} / ${name}: duplicate instance ${instance.id}`);
          ids.add(String(instance.id));
          return { instance, box: chipBoundingBox(project, instance) };
        });

        for (let index = 0; index < boxes.length; index += 1) {
          for (let other = index + 1; other < boxes.length; other += 1) {
            assert.ok(
              !overlaps(boxes[index].box, boxes[other].box),
              `${label} / ${name}: ${boxes[index].instance.id} overlaps ${boxes[other].instance.id}`
            );
          }
        }

        for (const annotation of description.annotations ?? []) {
          const note = annotationBoundingBox(annotation);
          for (const { instance, box } of boxes) {
            assert.ok(
              !overlaps(note, box),
              `${label} / ${name}: ${annotation.id} overlaps ${instance.id}`
            );
          }
        }

        for (const wire of description.wires ?? []) {
          assert.ok(endpointOwnerExists(description, wire.source), `${label} / ${name}: ${wire.id} has a missing source owner`);
          assert.ok(endpointOwnerExists(description, wire.target), `${label} / ${name}: ${wire.id} has a missing target owner`);
        }
  }
}

test("stored projects keep collision-free objects, annotation lanes, and valid wire owners", async () => {
  for (const directory of projectDirectories) {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const relativeDirectory = path.relative(process.cwd(), directory);
      const project = normalizeProject(JSON.parse(await readFile(path.join(directory, file), "utf8")));
      assertCollisionFree(project, [["root", project.root], ...Object.entries(project.customChips ?? {})], `${relativeDirectory}/${file}`);
    }
  }
});

test("standalone stored chips keep collision-free geometry and valid wire owners", async () => {
  const customChips = {};
  for (const file of (await readdir(chipDirectory)).filter((name) => name.endsWith(".json"))) {
    const raw = JSON.parse(await readFile(path.join(chipDirectory, file), "utf8"));
    if (raw.description?.name) customChips[raw.description.name] = raw.description;
    Object.assign(customChips, raw.dependencies ?? {});
  }
  const project = normalizeProject({ name: "Stored chip library", customChips });
  assertCollisionFree(project, Object.entries(project.customChips), "storage/chips");
});

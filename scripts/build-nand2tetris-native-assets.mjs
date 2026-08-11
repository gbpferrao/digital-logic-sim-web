import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProject, refreshReusableFit } from "../src/model.js";
import { layoutProject } from "./layout-stored-circuits.mjs";

// This is a companion asset track, not a mutation of storage/nand2tetris.
// The original tree remains the visible NAND-derived teaching reference; this
// tree keeps the same landmarks while using native catalog primitives wherever
// the simulator has an exact equivalent.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import("./build-nand2tetris-assets.mjs");

const sourceRoot = path.join(root, "storage", "nand2tetris");
const outputRoot = path.join(root, "storage", "nand2tetris-native");
const sourceChipDirectory = path.join(sourceRoot, "chips");
const sourceProjectDirectory = path.join(sourceRoot, "projects");
const chipDirectory = path.join(outputRoot, "chips");
const projectDirectory = path.join(outputRoot, "projects");
const UPDATED_AT = "2026-08-11T00:00:00.000Z";

const nativeSubstitutions = Object.freeze({
  "N2T NAND": { name: "NAND", pins: { a: "0", b: "1", out: "2" } },
  "N2T NOT": { name: "NOT", pins: { in: "0", out: "1" } },
  "N2T AND": { name: "AND", pins: { a: "0", b: "1", out: "2" } },
  "N2T OR": { name: "OR", pins: { a: "0", b: "1", out: "2" } },
  "N2T XOR": { name: "XOR", pins: { a: "0", b: "1", out: "2" } },
  "N2T NOR": { name: "NOR", pins: { a: "0", b: "1", out: "2" } },
  "N2T XNOR": { name: "XNOR", pins: { a: "0", b: "1", out: "2" } },
  "N2T BUFFER": { name: "BUFFER", pins: { in: "0", out: "1" } },
  "N2T TRI-STATE": { name: "3-STATE BUFFER", pins: { in: "0", enable: "1", out: "2" } }
});
const substitutionByName = new Map(Object.entries(nativeSubstitutions));

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fileName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function remapEndpoint(endpoint, replacementByInstanceId) {
  const replacement = replacementByInstanceId.get(String(endpoint?.owner));
  if (!replacement || replacement.pins[String(endpoint.pin)] == null) return endpoint;
  return { ...endpoint, pin: replacement.pins[String(endpoint.pin)] };
}

function remapOutputPinColours(instance, replacement) {
  if (!replacement || !instance.outputPinColours || typeof instance.outputPinColours !== "object") return;
  instance.outputPinColours = Object.fromEntries(
    Object.entries(instance.outputPinColours).map(([pin, colour]) => [replacement.pins[pin] ?? pin, colour])
  );
}

function rewriteDescription(description) {
  const rewritten = clone(description);
  const replacementByInstanceId = new Map();
  for (const instance of rewritten.instances ?? []) {
    const replacement = substitutionByName.get(String(instance.name));
    if (!replacement) continue;
    replacementByInstanceId.set(String(instance.id), replacement);
    remapOutputPinColours(instance, replacement);
    instance.name = replacement.name;
  }
  rewritten.wires = (rewritten.wires ?? []).map((wire) => ({
    ...wire,
    source: remapEndpoint(wire.source, replacementByInstanceId),
    target: remapEndpoint(wire.target, replacementByInstanceId)
  }));
  return rewritten;
}

function collectDependencies(name, descriptions, result = new Map()) {
  const description = descriptions.get(name);
  if (!description) return result;
  for (const instance of description.instances ?? []) {
    const childName = String(instance.name);
    if (!descriptions.has(childName) || result.has(childName)) continue;
    result.set(childName, descriptions.get(childName));
    collectDependencies(childName, descriptions, result);
  }
  return result;
}

function refreshAndLayout(customDescriptions, rootDescription = null) {
  const project = normalizeProject({
    name: "Nand2Tetris native primitives variant",
    root: rootDescription ?? {
      id: "root",
      name: "Nand2Tetris native primitives variant",
      type: "custom",
      kind: "custom",
      size: { x: 1800, y: 1100 },
      colour: "#202b3a",
      nameLocation: "top",
      inputPins: [],
      outputPins: [],
      instances: [],
      wires: [],
      junctions: [],
      displays: [],
      annotations: []
    },
    customChips: Object.fromEntries(customDescriptions)
  });
  for (let pass = 0; pass < customDescriptions.size + 2; pass += 1) {
    for (const description of Object.values(project.customChips)) refreshReusableFit(project, description);
  }
  layoutProject(project, { parkAnnotations: true });
  return project;
}

const sourceChipFiles = (await readdir(sourceChipDirectory)).filter((file) => file.endsWith(".json")).sort();
const sourceChipRecords = await Promise.all(sourceChipFiles.map((file) => readJson(path.join(sourceChipDirectory, file))));
const sourceDescriptions = new Map(
  sourceChipRecords
    .filter((record) => !record.native && record.description?.name)
    .map((record) => [record.description.name, record.description])
);
const rewrittenDescriptions = new Map(
  [...sourceDescriptions.entries()].map(([name, description]) => [name, rewriteDescription(description)])
);
const laidOutContext = refreshAndLayout(rewrittenDescriptions);
const variantDescriptions = new Map(Object.entries(laidOutContext.customChips));

await rm(outputRoot, { recursive: true, force: true });
await cp(sourceRoot, outputRoot, { recursive: true });
await mkdir(chipDirectory, { recursive: true });
await mkdir(projectDirectory, { recursive: true });

for (const record of sourceChipRecords) {
  const name = record.description?.name ?? record.name;
  if (!name) continue;
  if (record.native) {
    await writeJson(path.join(chipDirectory, fileName(name)), record);
    continue;
  }
  const description = variantDescriptions.get(name);
  if (!description) throw new Error(`Missing rewritten Nand2Tetris description: ${name}`);
  const dependencies = collectDependencies(name, variantDescriptions);
  await writeJson(path.join(chipDirectory, fileName(name)), {
    ...record,
    variant: "native-primitives",
    description,
    dependencyNames: [...dependencies.keys()],
    dependencies: Object.fromEntries(dependencies)
  });
}

const sourceProjectFiles = (await readdir(sourceProjectDirectory)).filter((file) => file.endsWith(".json")).sort();
for (const file of sourceProjectFiles) {
  const sourceProject = await readJson(path.join(sourceProjectDirectory, file));
  const rootDescription = rewriteDescription(sourceProject.root);
  const project = normalizeProject({
    ...sourceProject,
    root: rootDescription,
    customChips: Object.fromEntries(variantDescriptions)
  });
  for (let pass = 0; pass < variantDescriptions.size + 2; pass += 1) {
    for (const description of Object.values(project.customChips)) refreshReusableFit(project, description);
  }
  layoutProject(project, { parkAnnotations: true });
  project.variant = "native-primitives";
  project.sourceTrack = "nand2tetris";
  project.storageId = `nand2tetris-native-${file.slice(0, -5)}`;
  project.updatedAt = UPDATED_AT;
  project.createdAt = sourceProject.createdAt ?? UPDATED_AT;
  await writeJson(path.join(projectDirectory, file), project);
}

const sourceManifest = await readJson(path.join(sourceRoot, "manifest.json"));
const variantManifest = {
  ...clone(sourceManifest),
  schema: "digital-logic-sim-web/nand2tetris-native/1",
  name: "Nand2Tetris chip progression (native primitives)",
  variant: "native-primitives",
  sourceTrack: "nand2tetris",
  description: "The same Nand2Tetris landmarks, with native catalog primitives substituted for exact basic-gate equivalents inside composed chips and projects.",
  nativeSubstitutions: Object.entries(nativeSubstitutions).map(([from, substitution]) => ({ from, ...substitution })),
  chips: sourceManifest.chips.map((entry) => {
    if (entry.native) return { ...entry };
    const dependencies = collectDependencies(entry.name, variantDescriptions);
    return {
      ...entry,
      dependencies: [...dependencies.keys()]
    };
  }),
  projects: sourceManifest.projects.map((entry) => ({ ...entry, variant: "native-primitives" }))
};
await writeJson(path.join(outputRoot, "manifest.json"), variantManifest);

const readme = `# Nand2Tetris: native-primitives variant

This is a parallel version of the \`storage/nand2tetris/\` learning track.

The original track is the pedagogical construction path: its \`N2T\` chips show how larger parts are composed from the Nand2Tetris building blocks. This variant keeps the same chip names, projects, stages, and software landmarks, but replaces exact basic-gate wrappers inside compositions with the simulator's native primitives:

- \`NAND\`, \`NOT\`, \`AND\`, \`OR\`, \`XOR\`, \`NOR\`, and \`XNOR\`
- \`BUFFER\`
- \`3-STATE BUFFER\`

That means a native-primitives \`N2T MUX\` visibly contains native \`NOT\`, \`AND\`, and \`OR\` parts, and the same substitution continues through larger compositions such as the bitwise units, adders, ALU, and CPU teaching path. Endpoint pins are remapped to the native catalog contracts when a wrapper is replaced.

MUX, DMUX, arithmetic, state, memory, CPU, and computer chips remain composed when there is no exact one-to-one basic native equivalent. Native state and device leaves that already existed in the original bundle are retained.

Use this tree when you want to study the higher-level architecture without every basic gate expanding into a handmade Nand2Tetris wrapper. Use the original tree when you want to inspect that construction step itself. Both are portable JSON bundles and can be imported without a storage backend.
`;
const about = [
  "# About this variant",
  "",
  "`nand2tetris-native` is the compact-leaf companion to `nand2tetris`.",
  "",
  "It is deliberately not a new curriculum. It is the same progression with a different implementation lens: exact basic Boolean parts resolve to native simulator chips, while meaningful Nand2Tetris compositions remain visible as `N2T` composites. This makes large projects easier to read while keeping the original NAND-derived path available beside it.",
  ""
].join("\\n");
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");
await writeFile(path.join(outputRoot, "about-nand2tetris.md"), about, "utf8");

const progressionFile = path.join(outputRoot, "_computer-nan2tetirs-chip-progression.md");
const progression = await readFile(progressionFile, "utf8");
if (!progression.startsWith("> Variant lens:")) {
  await writeFile(progressionFile, `> Variant lens: this copy uses native basic primitives inside the same composed landmarks. The original storage/nand2tetris directory remains the NAND-derived comparison track.\n\n${progression}`, "utf8");
}

console.log(`Built native-primitives variant from ${sourceChipRecords.length} chips and ${sourceProjectFiles.length} projects.`);

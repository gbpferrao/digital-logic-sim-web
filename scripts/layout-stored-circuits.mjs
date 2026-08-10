import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRID,
  MIN_CHIP_SIZE,
  chipBoundingBox,
  chipBoundsSize,
  getDescription,
  isInterfaceNode,
  normalizeProject,
  refreshReusableFit
} from "../src/model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_DIR = path.join(ROOT, "storage", "projects");
const CHIP_DIR = path.join(ROOT, "storage", "chips");
const HALF_GRID = GRID / 2;
const COLUMN_TOLERANCE = GRID * 2;
const COLUMN_GAP = GRID * 2;
const ROW_GAP = GRID * 2;

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function snap(value) {
  return Math.round(number(value) / HALF_GRID) * HALF_GRID;
}

function isInputTerminal(instance) {
  return String(instance?.name ?? "").startsWith("IN-");
}

function isOutputTerminal(instance) {
  return String(instance?.name ?? "").startsWith("OUT-");
}

function instanceSize(project, instance) {
  const description = getDescription(project, instance?.name);
  const size = description ? chipBoundsSize(description) : MIN_CHIP_SIZE;
  return Number(instance?.rotation ?? 0) % 2 !== 0
    ? { w: size.y, h: size.x }
    : { w: size.x, h: size.y };
}

function endpointKey(endpoint) {
  const owner = String(endpoint?.owner ?? "");
  if (owner === "root") return `root:${String(endpoint?.pin ?? "")}`;
  if (owner === "junction") return `junction:${String(endpoint?.pin ?? "")}`;
  if (owner === "wire") return `wire:${String(endpoint?.pin ?? "")}`;
  return owner;
}

function circuitBounds(project, description) {
  const boxes = (description.instances ?? []).map((instance) => chipBoundingBox(project, instance));
  for (const junction of description.junctions ?? []) {
    boxes.push({ x: number(junction.position?.x) - 4, y: number(junction.position?.y) - 4, w: 8, h: 8 });
  }
  for (const pin of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) {
    if (description.interfaceBindings?.inputs?.length || description.interfaceBindings?.outputs?.length) break;
    boxes.push({ x: number(pin.x) - 4, y: number(pin.y) - 4, w: 8, h: 8 });
  }
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function remapAnnotations(description, before, after) {
  if (!before || !after || !description.annotations?.length) return;
  for (const annotation of description.annotations) {
    const x = number(annotation.position?.x);
    const y = number(annotation.position?.y);
    const u = (x - before.x) / Math.max(1, before.w);
    const v = (y - before.y) / Math.max(1, before.h);
    annotation.position = {
      x: snap(after.x + u * after.w),
      y: snap(after.y + v * after.h)
    };
  }
}

function graphFor(description) {
  const nodes = new Set((description.instances ?? []).map((instance) => String(instance.id)));
  const edges = [];
  const outgoing = new Map();
  const incoming = new Map();
  const addNode = (key) => {
    if (!key) return;
    if (!outgoing.has(key)) outgoing.set(key, new Set());
    if (!incoming.has(key)) incoming.set(key, 0);
  };
  const addEdge = (from, to) => {
    if (!from || !to || from === to) return;
    addNode(from);
    addNode(to);
    if (outgoing.get(from).has(to)) return;
    outgoing.get(from).add(to);
    incoming.set(to, incoming.get(to) + 1);
    edges.push([from, to]);
  };

  for (const node of nodes) addNode(node);
  for (const wire of description.wires ?? []) addEdge(endpointKey(wire.source), endpointKey(wire.target));

  // This pass intentionally keeps junctions and route owners in the graph. It
  // lets the same layout routine remain safe for hand-routed circuits even
  // though the bundled examples currently use direct instance-to-instance wires.
  const rank = new Map([...outgoing.keys()].map((key) => [key, 0]));
  const queue = [...outgoing.keys()].filter((key) => (incoming.get(key) ?? 0) === 0);
  const processed = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    processed.add(current);
    for (const next of outgoing.get(current) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(current) ?? 0) + 1));
      const remaining = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return { nodes, edges, rank, processed };
}

function explicitColumns(description) {
  const instances = description.instances ?? [];
  const byId = new Map(instances.map((instance) => [String(instance.id), instance]));
  const pick = (...ids) => ids.flat().map((id) => byId.get(String(id))).filter(Boolean);
  const terminals = (predicate) => instances.filter(predicate).sort((a, b) => number(a.position?.y) - number(b.position?.y));
  const input = terminals(isInputTerminal);
  const output = terminals(isOutputTerminal);
  const profiles = {
    "HALF ADDER": [
      input, pick("xor", "and"), output
    ],
    "FULL ADDER": [
      input, pick("ha-ab", "ha-cin"), pick("carry-or"), output
    ],
    "MUX 4:1": [
      input,
      pick("not-s0", "not-s1"),
      pick("d0-a", "d1-a", "d2-a", "d3-a"),
      pick("d0-b", "d1-b", "d2-b", "d3-b"),
      pick("or-01", "or-23"),
      pick("or-out"),
      output
    ],
    "ALU 1-BIT": [
      input,
      pick("and", "or", "xor"),
      pick("adder", "mux"),
      pick("carry-op1", "carry-op"),
      output
    ],
    "RIPPLE ADDER 4": [
      input,
      pick("split-a", "split-b"),
      pick("fa0", "fa1"),
      pick("fa2", "fa3"),
      pick("merge-sum"),
      output
    ],
    "ALU 4-BIT": [
      input,
      pick("split-a", "split-b"),
      pick("alu0", "alu1"),
      pick("alu2", "alu3"),
      pick("merge-result", "or01", "or23"),
      pick("or-all", "not-zero"),
      pick("xor-overflow", "overflow-op1", "overflow-op"),
      output
    ]
  };
  const profile = profiles[description.name];
  if (!profile) return null;
  const used = new Set(profile.flat().map((instance) => String(instance.id)));
  const remaining = instances.filter((instance) => !used.has(String(instance.id)));
  if (remaining.length) profile.splice(profile.length - (output.length ? 1 : 0), 0, remaining);
  return profile.filter((nodes) => nodes.length);
}

function layoutDescription(project, description, options = {}) {
  const instances = [...(description.instances ?? [])];
  if (!instances.length) {
    if (options.reusable && description.kind === "custom") refreshReusableFit(project, description);
    return;
  }

  const before = circuitBounds(project, description);
  const graph = graphFor(description);
  const byId = new Map(instances.map((instance) => [String(instance.id), instance]));
  const groups = new Map();

  const addToGroup = (key, instance) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(instance);
  };

  const profile = explicitColumns(description);
  const orderedGroups = profile
    ? profile.map((nodes, index) => ({ key: `profile:${index}`, nodes, explicit: true }))
    : (() => {
      for (const instance of instances) {
        if (isInputTerminal(instance)) addToGroup("input", instance);
        else if (isOutputTerminal(instance)) addToGroup("output", instance);
        else addToGroup(`column:${Math.round(number(instance.position?.x) / COLUMN_TOLERANCE)}`, instance);
      }
      const result = [];
      if (groups.has("input")) result.push({ key: "input", nodes: groups.get("input") });
      const regular = [...groups.entries()]
        .filter(([key]) => key.startsWith("column:"))
        .sort(([a], [b]) => number(a.slice("column:".length)) - number(b.slice("column:".length)));
      result.push(...regular.map(([key, nodes]) => ({ key, nodes })));
      if (groups.has("output")) result.push({ key: "output", nodes: groups.get("output") });
      return result;
    })();

  // A graph-derived rank is used only to break ties in an old x-column. The
  // existing columns carry useful pedagogical grouping (for example, the
  // decoder's AND-gate banks), so preserving them produces fewer wire
  // crossings than replacing the whole design with a generic DAG layout.
  const rankFor = (instance) => graph.rank.get(String(instance.id)) ?? 0;
  const oldYFor = (instance) => number(instance.position?.y);
  for (const group of orderedGroups) {
    if (!group.explicit) group.nodes.sort((a, b) => oldYFor(a) - oldYFor(b) || rankFor(a) - rankFor(b) || String(a.id).localeCompare(String(b.id)));
    group.width = Math.max(...group.nodes.map((instance) => instanceSize(project, instance).w));
    group.height = group.nodes.reduce((sum, instance) => sum + instanceSize(project, instance).h, 0)
      + Math.max(0, group.nodes.length - 1) * ROW_GAP;
  }

  const totalWidth = orderedGroups.reduce((sum, group) => sum + group.width, 0)
    + Math.max(0, orderedGroups.length - 1) * COLUMN_GAP;
  let left = -totalWidth / 2;
  for (const group of orderedGroups) {
    const centerX = snap(left + group.width / 2);
    let top = -group.height / 2;
    for (const instance of group.nodes) {
      const size = instanceSize(project, instance);
      instance.position = { x: centerX, y: snap(top + size.h / 2) };
      top += size.h + ROW_GAP;
    }
    left += group.width + COLUMN_GAP;
  }

  // Keep junctions attached to the visual center of the connected elements.
  // (The stored examples have none, but this makes the utility safe to rerun
  // after a user has added one.)
  for (const junction of description.junctions ?? []) {
    const neighbours = [];
    for (const wire of description.wires ?? []) {
      for (const endpoint of [wire.source, wire.target]) {
        if (String(endpoint?.owner) !== "junction" || String(endpoint?.pin) !== String(junction.id)) continue;
        const other = endpoint === wire.source ? wire.target : wire.source;
        const instance = byId.get(String(other?.owner));
        if (instance) neighbours.push(instance.position);
      }
    }
    if (neighbours.length) {
      junction.position = {
        x: snap(neighbours.reduce((sum, point) => sum + number(point.x), 0) / neighbours.length),
        y: snap(neighbours.reduce((sum, point) => sum + number(point.y), 0) / neighbours.length)
      };
    }
  }

  if (options.reusable && description.kind === "custom") refreshReusableFit(project, description);
  const after = circuitBounds(project, description);
  remapAnnotations(description, before, after);
}

function dependencyDepths(project) {
  const names = new Set(Object.keys(project.customChips ?? {}));
  const memo = new Map();
  const visit = (name, trail = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    if (trail.has(name)) return 0;
    const description = project.customChips?.[name];
    if (!description) return 0;
    const nextTrail = new Set(trail).add(name);
    const depth = Math.max(0, ...(description.instances ?? [])
      .filter((instance) => names.has(String(instance.name)))
      .map((instance) => visit(String(instance.name), nextTrail) + 1));
    memo.set(name, depth);
    return depth;
  };
  return [...names].sort((a, b) => visit(a) - visit(b));
}

function layoutProject(project) {
  for (const name of dependencyDepths(project)) layoutDescription(project, project.customChips[name], { reusable: true });
  layoutDescription(project, project.root, { reusable: false });
  // A stored project root is the live canvas, not a reusable chip boundary.
  // Its IN/OUT instances are real editable nodes; only custom-chip records
  // derive public ports from interface nodes.
  project.root.inputPins = [];
  project.root.outputPins = [];
  delete project.root.interfaceBindings;
  delete project.root.fit;
  for (const instance of project.root.instances ?? []) delete instance.interfaceId;
  return project;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadChipProject() {
  const customChips = {};
  for (const file of fs.readdirSync(CHIP_DIR).filter((name) => name.endsWith(".json"))) {
    const raw = loadJson(path.join(CHIP_DIR, file));
    if (raw.description?.name) customChips[raw.description.name] = raw.description;
  }
  return normalizeProject({ name: "Stored chip library layout", customChips });
}

function layoutStandaloneChips(writeToDisk = false) {
  const context = loadChipProject();
  layoutProject(context);
  for (const file of fs.readdirSync(CHIP_DIR).filter((name) => name.endsWith(".json"))) {
    const filePath = path.join(CHIP_DIR, file);
    const raw = loadJson(filePath);
    const name = raw.description?.name;
    if (!name || !context.customChips[name]) continue;
    raw.description = context.customChips[name];
    if (writeToDisk) writeJson(filePath, raw);
  }
  return context;
}

function layoutStoredProjects(writeToDisk = false) {
  const reports = [];
  for (const file of fs.readdirSync(PROJECT_DIR).filter((name) => name.endsWith(".json"))) {
    const filePath = path.join(PROJECT_DIR, file);
    const project = layoutProject(normalizeProject(loadJson(filePath)));
    if (writeToDisk) writeJson(filePath, project);
    reports.push({
      file,
      name: project.name,
      root: reportDescription(project, project.root),
      custom: Object.fromEntries(Object.entries(project.customChips ?? {}).map(([name, description]) => [name, reportDescription(project, description)]))
    });
  }
  return reports;
}

function reportDescription(project, description) {
  const boxes = (description.instances ?? []).map((instance) => chipBoundingBox(project, instance));
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps += 1;
    }
  }
  return { instances: boxes.length, overlaps, bounds: circuitBounds(project, description) };
}

const write = process.argv.includes("--write");
const chipContext = layoutStandaloneChips(write);
const projectReports = layoutStoredProjects(write);
const chipReports = Object.entries(chipContext.customChips).map(([name, description]) => ({
  name,
  ...reportDescription(chipContext, description)
}));

console.log(JSON.stringify({ write, projects: projectReports, chips: chipReports }, null, 2));

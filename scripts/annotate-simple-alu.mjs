import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProject } from "../src/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, "../storage/projects/simple-alu.json");
const project = normalizeProject(JSON.parse(fs.readFileSync(file, "utf8")));

project.root.annotations = [
  {
    id: "note-how-to-use",
    type: "text",
    text: "HOW TO USE\n1. Toggle A, B, and CIN.\n2. Set OP1 / OP0.\n3. Read RESULT and CARRY.",
    position: { x: -820, y: -460 },
    width: 360,
    height: 150,
    fontSize: 12,
    colour: "#d7eaff",
    background: "#172438"
  },
  {
    id: "note-opcode-table",
    type: "text",
    text: "OPCODE (OP1 OP0)\n00  =  AND\n01  =  OR\n10  =  XOR\n11  =  ADD",
    position: { x: -820, y: 360 },
    width: 300,
    height: 150,
    fontSize: 12,
    colour: "#f3d36b",
    background: "#2b2530"
  },
  {
    id: "note-output-guide",
    type: "text",
    text: "OUTPUTS\nRESULT = selected logic result or ADD sum.\nCARRY = carry-out from ADD mode; otherwise LOW.",
    position: { x: 950, y: -270 },
    width: 360,
    height: 150,
    fontSize: 12,
    colour: "#b8f3ca",
    background: "#172b27"
  },
  {
    id: "label-logic-paths",
    type: "label",
    text: "LOGIC PATHS",
    position: { x: -460, y: -350 },
    width: 180,
    height: 22,
    fontSize: 12,
    colour: "#f3d36b"
  },
  {
    id: "label-mode-selector",
    type: "label",
    text: "MODE SELECTOR: only the matching opcode path is enabled",
    position: { x: 120, y: 480 },
    width: 520,
    height: 22,
    fontSize: 11,
    colour: "#b8d7ff"
  }
];
project.updatedAt = new Date().toISOString();
fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
console.log(`Annotated ${path.basename(file)} with ${project.root.annotations.length} objects.`);

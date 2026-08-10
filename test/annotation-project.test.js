import test from "node:test";
import assert from "node:assert/strict";
import { annotationPalette, normalizeProject } from "../src/model.js";

test("annotation colour is normalized into a brighter outline and darker background", () => {
  const project = normalizeProject({
    name: "annotation palette",
    root: {
      annotations: [
        { id: "note", type: "text", text: "Note", colour: "#336699", background: "#ffffff" }
      ]
    }
  });
  const note = project.root.annotations[0];
  const palette = annotationPalette("#336699");

  assert.equal(note.colour, palette.colour);
  assert.equal(note.background, palette.background);
  assert.notEqual(note.background, "#ffffff");
  assert.ok(Number.parseInt(palette.outline.slice(1, 3), 16) > Number.parseInt(note.colour.slice(1, 3), 16));
  assert.ok(Number.parseInt(palette.background.slice(1, 3), 16) < Number.parseInt(note.colour.slice(1, 3), 16));
});

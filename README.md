# Digital Logic Sim Web

This directory is a standalone vanilla JavaScript and HTML5 Canvas rewrite of Sebastian Lague's Digital Logic Sim. It does not depend on Unity or on the existing Next.js port elsewhere in the workspace.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the dependency-free local JSON API together. Open the local URL printed by Vite. The editor renders immediately from its browser cache while saves happen asynchronously to `storage/projects/*.json` and `storage/chips/*.json`.

The default web port is `5173` and the default JSON API port is `5174`. Set `DLS_WEB_PORT` or `DLS_API_PORT` to use different ports. The separate processes are also available when needed:

- `npm run dev:web` starts Vite only.
- `npm run dev:api` starts the local JSON API only.

Run the checks with:

```bash
npm test
npm run build
```

`npm run build` writes the production bundle to `dist/`; `npm run preview` serves that bundle locally after a build. The tests use Node's built-in test runner and cover the simulator, primitive truth tables, recursive custom chips, junctions, and three saved example projects.

## GitHub Pages static build

The repository includes a v0 GitHub Pages workflow at [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). Push the repository to GitHub, set Pages' publishing source to **GitHub Actions**, and the workflow will build and deploy the site on pushes to `main` or `master`.

The Pages build sets `VITE_STATIC_MODE=true`. In that mode the app never calls `/api`: it starts from the browser cache or a blank project, saves locally to browser storage, and uses JSON import/export for portability. The local `npm run dev` workflow keeps the optional JSON API for development.

The build copies the example projects and reusable chips into [`public/examples`](public/examples). The Help dialog exposes them as downloads with the intended flow: download a JSON file, then use **MENU → IMPORT JSON**. No backend or storage service is needed for the hosted version.

## Current web architecture

- `src/model.js` contains the chip descriptions, project model, pin metadata, collections, and custom-chip conversion.
- `src/simulation.js` contains the recursive simulator, tri-state pin states, built-in processors, sequential state, and snapshots.
- `src/simulation-timeline.js` contains the SimulationBake lifecycle: bounded run recording, stability detection, exact execution head, scrub branching, and compatibility timeline exports.
- `src/renderer.js` contains the canvas world renderer, camera, grid, wire drawing, chip drawing, display drawing, and hit testing.
- `src/storage.js` contains the immediate browser cache, local API synchronization, and JSON import/export.
- `server/api.mjs` contains the local JSON storage API; `server/dev.mjs` runs it alongside Vite without a page reload.
- `src/main.js` contains the editor state, commands, input handling, simulation controls, and application wiring.
- `index.html` loads the pinned Lucide CDN runtime for consistent interface icons; `src/main.js` refreshes icons after dynamic menus and inspector content are rendered.

The port is designed around the same behavior spine as the reference application:

**chip descriptions -> placed instances -> pin connections -> signal propagation -> built-in or custom-chip processing -> visible state**

The interface palette and the boundary between grayscale UI chrome and semantic circuit colors are documented in [`COLOR-SYSTEM.md`](COLOR-SYSTEM.md).

## Included workflows

- Place the built-in chip families exposed by the library: LOGIC, BASIC, IN/OUT, MERGE/SPLIT, BUS, DISPLAY, MEMORY, and AUDIO.
- The editor uses the reference-style full-world view: a compact top command strip for MENU, project name/save state, tools, and simulation controls; a lower bar with reorderable chip-group drop-ups (including CUSTOM); and floating library/inspector drawers.
- Each RUN starts a fresh bake. The bake can close automatically when the visible state stabilizes or manually through BAKE for indefinite circuits; CLEAR discards it. Step, visible-step navigation, boundaries, and the paused scrubber operate only on the current bake. The Step control includes the exact current engine tick, and the project menu opens a centered Help dialog with the most important shortcuts and commands.
- Simulate recursive custom chips, tri-state signals, clocks, pulses, RAM, ROM, displays, buses, conversion chips, and the built-in input/output devices.
- Use the primitive LOGIC collection: AND, OR, NOT, NAND, NOR, XOR, XNOR, and BUFFER.

## Interaction reference

- Click a library or drop-up chip to place it; drag a chip from the library or an open bottom-bar group directly onto the canvas. Drag the bottom-bar group tabs to reorder them; that order is saved with the project through the local JSON API.
- `V` selects and moves, `W` activates wire mode, `N` starts a note, and `L` starts a label. Drag on empty canvas for a selection box; hold Alt or Shift for additive multi-selection. Dragging one selected chip moves the selected group, and wires between selected chips follow.
- Hold Shift while moving to constrain the movement to one axis. Grid snapping is on by default; Ctrl/Command forces snapping. `R` rotates clockwise, Shift+R rotates counter-clockwise, and Ctrl/Command+D duplicates the selection.
- Pan with middle mouse or Alt+left drag on empty canvas. Zoom with the wheel or Alt+right drag. `FIT` frames the current circuit, Ctrl/Command+R resets the camera, and Ctrl/Command+G toggles the grid.
- Click a pin to start or finish a compatible wire. Drag from a pin directly to another pin to finish without a separate click. While a wire is active, click empty canvas to add route points, or start from an existing wire to create a branch; right-click or Escape cancels the unfinished interaction.
- Double-click a chip to open its inspector; a custom chip can then be opened into its internal circuit. Double-click a wire to enter wire-edit mode. Double-click a note or label to edit its content.
- Inside custom-chip internals, `IN-*` and `OUT-*` are ordinary interface nodes: place them from the IN/OUT library group, move or label them, and wire them normally. Their public parent-facing ports follow the nodes' interface identity and vertical position.
- In wire-edit mode, hover close to a route point to highlight it, click a segment to insert a point, drag-select points, drag selected points together, right-click a hovered point to delete it, and press Enter to leave the mode. Delete removes selected route points.
- Escape cancels placement, movement, wiring, or wire editing; when no transient interaction is active it clears the selection. Delete/Backspace removes the current selection.
- `RUN` starts a new bake and `PAUSE` pauses it without closing it. `BAKE` manually closes an open recording; `CLEAR` returns to evaluated step zero. The start/end controls, visible-step controls, `Step N`, and paused scrubber operate on that bake. The scrubber shows meaningful visual checkpoints while `Step N` remains the exact engine tick. Set the steps-per-second rate with the numeric speed field; Space advances one step while paused; Ctrl/Command+Space starts a fresh bake or pauses the current one. Clicking an input device toggles its value, while the inspector exposes live pin state and device-specific settings.
- The MENU Help dialog is the in-app shortcut reference. Ctrl/Command+S saves, Ctrl/Command+N creates a project, and Ctrl/Command+F opens chip search.

## Projects and storage

- Use SAVE to persist the current project; the first save asks whether the new circuit should be kept as a project or chip. SAVE AS PROJECT and SAVE AS CHIP remain explicit menu actions. Locally, the API writes the complete project and its custom chips as JSON files in one save operation; on GitHub Pages, SAVE uses browser cache and EXPORT/IMPORT JSON is the portable path.
- The browser cache remains a fast fallback if the local API is not running. With the API available, the editor keeps the browser cache synchronized after saving.
- Export/import the web project JSON format separately when a portable file is needed.
- Import a single web project or Unity-shaped JSON file when a portable document is needed. Folder-based Unity project import is intentionally not part of the web editor.
- Save the current circuit as a custom chip and place it again from the library.

The web project schema is `digital-logic-sim-web/1`. A project contains its root circuit (`instances`, `wires`, `junctions`, and `annotations`), settings, input/key values, persisted `collectionOrder`, and a `customChips` map. Saved/exported JSON omits the simulator's runtime revision and signal snapshot. Individual custom-chip files use `digital-logic-sim-web/chip/1` and wrap the chip description.

Custom-chip interfaces are authored as ordinary movable `IN-*` and `OUT-*` nodes. Saving a chip preserves those nodes, their labels, positions, and wires. When the chip is reused, the parent-facing ports are derived from them and bridge the parent signal into the internal `IN` node or out of the internal `OUT` node. Older fixed-pin chip JSONs are upgraded automatically when normalized, so existing ALU, adder, and display examples remain usable.

The repository includes inspectable examples in [`storage/projects`](storage/projects): `basic-alu.json`, `full-adder.json`, `simple-alu.json`, `sophisticated-alu.json`, `step-showcase.json`, and `tiny-hex-display.json`. Their reusable chip JSON files live in [`storage/chips`](storage/chips), and the static build publishes copies under [`public/examples`](public/examples) for download/import.

The storage endpoints and file layout are documented in [`storage/README.md`](storage/README.md).

## Source reference

Behavior and built-in component scope are based on the official repository:

<https://github.com/SebLague/Digital-Logic-Sim>

The upstream repository is MIT licensed. This project is a separate web implementation and does not copy the Unity runtime or Unity rendering code.

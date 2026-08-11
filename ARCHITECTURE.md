# Digital Logic Sim Web architecture audit

Status: current-state audit, reconciled refactoring plan, and first refactor wave

Historical checkpoint: `a207fe6` (`Checkpoint before X-ray mode`) preserves the known-good state immediately before the X-ray pivot. Earlier architecture work is included in that checkpoint.

Current checkpoint: the Git commit that contains this documentation refresh is
the known-good checkpoint for the current implementation. The historical hash
above remains useful as the architectural-refactor starting point.

Scope: the standalone application in this directory, including the browser editor, canvas renderer, simulator, local JSON API, import adapters, tests, examples, and development scripts.

## Executive verdict

The project has a sound behavior spine:

chip descriptions -> placed instances -> endpoint wires -> signal propagation -> simulation snapshot -> canvas/UI state

The domain model and simulator are already useful, testable seams. The main architectural weakness remains the application shell. `src/main.js` still owns domain mutations, interaction state machines, persistence orchestration, inspector/help rendering, custom-chip navigation, and rendering coordination, but the simulation lifecycle now lives behind `src/simulation-controller.js`; the library/collection feature lives in `src/ui/library-controller.js`, and shared DOM/icon helpers live in `src/ui/dom-icons.js`.

The next refactor should preserve the existing vanilla JavaScript approach. It should create explicit boundaries around the application shell and I/O, not introduce a framework, global event bus, or a generalized plugin system before the product needs one.

## File topology

### Runtime and browser shell

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| index.html | Static shell, toolbar, drawers, bottom bar, menus, Help modal, file inputs | DOM contract and layout composition |
| src/main.js | App state, commands, interaction handling, lifecycle, persistence calls, and composition of UI controllers | Application controller; still broad, but the library slice is now isolated |
| src/renderer.js | Canvas drawing, camera transforms, hit testing, placement previews | Canvas presentation and geometric queries |
| src/styles.css | All interface and canvas-adjacent CSS | Presentation; currently has an initial layer plus a later override layer |
| src/ui/dom-icons.js | DOM lookup, Lucide icon snippets, escaping, and icon refresh | Shared browser UI utility |
| src/ui/library-controller.js | Library rendering, collection tabs/popups, chip drag placement, and collection reorder | Feature UI controller |
| src/ui/notifications.js | Transient notification creation, stacking, auto-dismissal, and close actions | Feedback UI controller |
| src/ui/pointer-session.js | Stable pointer origin and click-versus-drag threshold | Input contract utility |
| src/ui/performance.js | Animation-frame lane scheduler and opt-in diagnostics | Rendering/performance utility |

### Domain and runtime

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| src/model.js | Project/chip schema creation and normalization, geometry helpers, annotations, custom-chip conversion; re-exports catalog compatibility symbols | Domain project facade |
| src/domain/core.js | IDs and deep cloning | Small domain utility boundary |
| src/domain/catalog.js | Built-in descriptions, types, colors, collections, and catalog metadata | Built-in catalog |
| src/simulation.js | Signal algebra, runtime graph, built-in chip execution, recursive custom-chip evaluation, snapshots | Simulation domain/runtime |
| src/simulation-timeline.js | SimulationBake lifecycle, bounded run recording, stability detection, exact execution head, scrub branching, and bounded pruning | Simulation bake/history policy |
| src/simulation-preview.js | Short-lived cloned simulator for non-recording causal feedback | Simulation preview policy |
| src/simulation-controller.js | Browser-facing bake/preview transitions, stepping, scrubbing, timer, and status coordination | Application simulation controller |
| src/unity-compat.js | Unity-shaped project/chip conversion | Import adapter |

### Persistence and tooling

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| src/storage.js | Browser cache, export, and compatibility facade for server/import APIs | Client persistence facade |
| src/io/storage-client.js | Local JSON API request/save/load behavior | Client transport adapter |
| src/io/project-import.js | Single-file web/Unity project and chip parsing plus imported-pin exposure | File-format adapter |
| server/api.mjs | HTTP server, routes, request parsing, response codes, and CORS | Local persistence transport |
| server/json-repository.mjs | Storage paths, atomic JSON writes, listing, and project/chip records | Replaceable filesystem repository |
| server/dev.mjs | Starts Vite and the local API and coordinates shutdown | Development process composition |
| storage/projects/*.json | Complete example projects and regression fixtures | Data fixtures, not application source |
| storage/chips/*.json | Saved custom-chip records | Persistence fixtures |
| scripts/*.mjs | Example generation and annotation utilities | One-off data tooling |
| test/*.test.js | Simulator/model/example, interaction-contract, bake, performance, and renderer tests | Regression suite |

The package has one runtime dependency surface beyond the browser platform: Vite for development/build tooling. Lucide is loaded from a pinned CDN script in index.html and used as the interface icon source.

## Contracts and interfaces

### Project document

The persisted project contract is digital-logic-sim-web/1. The important fields are:

- schema, storageId, name, createdAt, updatedAt
- root, a chip description representing the open circuit
- customChips, a name-to-description map for recursive custom chips
- collections and collectionOrder, the library group data and user ordering
- settings, including grid, snapping, simulation pause, speed, and clock period
- inputValues and keyValues, external runtime inputs
- starred, a legacy compatibility field that is no longer the primary library UI

Runtime-only fields are project._revision and project._simSnapshot. The client and server remove those fields before persistence/export.

normalizeProject is the compatibility boundary. It fills defaults, normalizes IDs and positions, derives annotation palettes, and makes old/imported documents executable by the current runtime.

### Chip description

A chip description contains:

- identity and presentation: id, name, type, kind, size, colour, nameLocation, special
- interface: movable `IN-*`/`OUT-*` instances plus a derived `interfaceBindings` contract and compatibility `inputPins`/`outputPins` projection
- internal circuit: instances, wires, junctions
- optional displays and annotations

A custom description uses the same shape as a built-in description. Its instances can reference built-ins or other custom chips, so the simulator recursively builds child runtimes.

For custom chips, the terminal instances are the persisted authoring source of truth. An `IN-*` instance exposes its output pin as a public input; an `OUT-*` instance exposes its input pin as a public output. Their positions, labels, and IDs survive saving, internal inspection, X-ray rendering, and reuse. `interfaceBindings` maps stable public IDs to those instance pins. `inputPins` and `outputPins` remain derived compatibility projections for parent wires, renderer geometry, and the existing simulator boundary; they are refreshed from the terminal nodes after edits.

Legacy custom descriptions that only contain fixed `inputPins`/`outputPins` are normalized into this representation. Normalization creates terminal instances at the old interface positions, preserves public IDs and widths, and rewrites internal `{ owner: "root", pin }` wire endpoints to the new instance endpoints. Top-level project input/output devices remain ordinary devices; interface binding discovery is only active for reusable custom-chip descriptions.

Reusable custom descriptions may also carry `fit: { version, bounds }`. The fit is the annotation-free canvas footprint used when a chip is reused: it includes child geometry, interface pins, wires, and junctions, while the description's `size` remains the internal editing canvas. Normalization derives this field for legacy chips, and custom-chip save/edit paths refresh it before persistence.

### Circuit primitives

- Instance: id, name, position, rotation, label, internalData, linkedBusPairId, optional `interfaceId`, and outputPinColours
- Pin: id, name, bits, direction, x, y, valueDisplay, colour
- Endpoint: owner and pin; owner can be an instance ID, root, junction, or wire during an in-progress wire split
- Wire: id, source, target, route points, and optional colour
- Annotation: id, type, text, position, dimensions, font size, colour, and derived background

The endpoint shape is shared by editor hit testing, wire editing, renderer geometry, and simulation propagation. It is a high-value contract and should remain domain-owned rather than being recreated in UI code.

### Simulation interface

Simulator accepts a project and exposes:

- syncProject(project)
- evaluate()
- step()
- reset()
- restore(snapshot, stepCount)
- stateFor(endpoint)
- outputFor(instanceId)
- snapshot, containing version, step, endpoint states, per-instance signals/internal state, and root outputs

Every constructed or synchronized simulator has an evaluated step-zero snapshot; an empty snapshot is only a fallback shape, never the normal startup state. Structural project/root changes rebuild the runtime and return to step zero. cloneSnapshot(snapshot) is the boundary for restoring data without sharing mutable runtime state.

Signal states are two bitmasks: bits for values and tri for driven/disconnected bits. PIN_MASK represents disconnected bits. Built-in processing is currently a type switch inside simulation.js.

For a custom runtime, the parent still supplies a map keyed by public input IDs and receives a map keyed by public output IDs. The runtime resolves those IDs through `interfaceBindings`: input values are injected into the bound `IN-*` instance outputs before settling the child network, and bound `OUT-*` instance inputs are projected back into the public output map afterward. This keeps nested composite flow compatible with the existing bake and scrub snapshots.

SimulationBake accepts frames shaped as { version, step, snapshot, signature, estimatedBytes } and owns the lifecycle states empty, baking, and ready. Its checkpoint rail stores only meaningful visual changes, while executionFrame retains the exact current tick for reliable step counts and step-field restoration. Scrubbing moves the cursor; a subsequent step truncates the future branch. Macro navigation only visits frames already recorded in the current bake and never launches a hidden second simulation. Frame count and estimated byte budgets preserve the first and current/latest frames when pruning. SimulationTimeline remains as a compatibility export for older tests/integrations.

### Renderer interface

WorldRenderer owns a canvas and exposes:

- camera state and toWorld/toScreen transforms
- zoomAt and fit
- draw(project, simulator, editorState)
- wirePoints and endpointPosition
- findPin, findJunction, findInstance, findAnnotation, findWire, findWirePoint, and resize-handle queries

When `editorState.xray` is enabled, the renderer adds a clipped, read-only recursive projection for custom instances. The projection follows every finite nesting level below the current root, with 160 child instances and 240 wires per level plus a cycle guard. It does not alter hit testing, selection, simulation, or project ownership; the full rationale and flow are in [XRAY-ARCHITECTURE.md](XRAY-ARCHITECTURE.md).

The renderer is intentionally imperative and canvas-based. The editor supplies project data plus an editorState snapshot; the renderer does not mutate the project.
Canvas object strokes are authored in world units and scale with zoom, with a
one-device-pixel viewport floor so objects remain legible when zoomed out. The
renderer shares cached world geometry between drawing and hit testing.

### Persistence interface

The browser client currently provides:

- saveToServer and loadFromServer for the local JSON API
- saveToBrowser and loadFromBrowser for the immediate local cache
- encodeProject and downloadProject for portable JSON
- readProjectFile for single-file web/Unity import

The server provides:

- GET /api/health
- GET /api/projects
- GET /api/projects/latest
- GET, PUT, and POST /api/projects/:id
- GET /api/chips
- GET, PUT, and POST /api/chips/:id

The server writes complete project documents atomically through temporary files and rename. The client saves the project first to the API and then mirrors it to the browser cache; when the API is unavailable, the browser cache is the fallback.

### Implicit DOM contracts

The application shell depends on stable IDs such as world, project-name, inspector, collection-tabs, collection-popup, bottom-menu-popup, bake-sim, clear-bake, macro-prev-sim, step-sim, step-scrubber, macro-next-sim, sim-speed, xray-toggle, notifications, and viewed-back. Dynamic controls communicate through data-action, data-field, data-chip, data-collection, data-context-action, and data-notification-close attributes.

These attributes are effectively interfaces, but they are not centralized or type-checked. A renamed ID or action string can fail at runtime during module initialization or delegated event handling.

## Module boundaries and ownership

The intended dependency direction is:

browser shell/controller -> domain model and simulation
browser shell/controller -> persistence/import client
renderer -> domain model and simulation signal helpers
simulation -> domain model
storage/import client -> domain model and import adapters
HTTP API -> JSON repository

The domain must not depend on DOM, canvas, browser storage, or HTTP.

Current ownership is mostly aligned. The first refactor waves removed several leaks; the remaining broad areas are:

- main.js still directly constructs and mutates the project and simulator while also rendering inspector/help and coordinating most editor interactions. Simulation transitions are now delegated to simulation-controller.js rather than duplicated across the shell.
- storage.js remains a compatibility facade around browser cache, export, import, and the extracted API client.
- server/api.mjs now delegates filesystem behavior to json-repository.mjs.
- model.js now delegates catalog construction to domain/catalog.js, but remains the project/schema facade until a later rename or move.
- built-in chip presentation is split across model.js, simulation.js, renderer.js, and main.js rather than represented by one explicit chip definition contract.

## Main data and control flows

### Startup and hydration

1. index.html creates the shell and loads the Lucide runtime.
2. main.js loads the browser cache synchronously.
3. The project is normalized and a Simulator is constructed with an evaluated step-zero snapshot.
4. The simulation controller clears the bake from that snapshot before library, renderer, inspector, and controls are rendered.
5. The camera fits the current project. The simulation timer remains stopped until the user starts Bake; projects never autoplay on load.
6. hydrateProjectFromServer asynchronously loads the last/latest server project, replaces the project and simulator, rebuilds the step-zero bake state, then renders again.

This gives fast local-first startup, but the hydration boundary is hidden inside the same module as all editing behavior.

### Edit and render loop

1. A DOM or canvas event handler reads the current project and editor state.
2. A command mutates project data, often through mutate.
3. mutate records a full-project undo snapshot, updates revision/history, rebuilds the simulation runtime/bake state for structural changes, and calls render.
4. render copies the simulator snapshot onto the project, asks WorldRenderer to draw, updates DOM readouts, renders inspector/help/simulation controls, and refreshes Lucide icons.
5. Explicit Save or selected autosave paths call saveCurrentProject.

The flow is understandable but broad. Full command renders can still rebuild the
inspector, update Help metadata, redraw the canvas, and replace dynamic icons;
ordinary pointer movement and simulation paints now use scheduled canvas/UI
lanes so they do not pay that full-render cost.

### Simulation loop

1. The simulation controller starts Bake from evaluated step zero; the same control reads Stop while the timer is active.
2. The controller syncs the simulator to the project, truncates a future branch when necessary, advances the recursive runtime, and records the exact execution head in the open bake.
3. Only visually meaningful snapshots become bake checkpoints: the signature follows connected signal flow and visible displays, so isolated oscillators and unused pins do not inflate or prolong the bake.
4. A stability window closes finite bakes automatically; if no checkpoint appears beyond evaluated step zero, the controller canonicalizes the ready bake back to step zero. Stop closes indefinite bakes manually.
5. Paused scrubbing restores a checkpoint, and the editable step field plus visible-step controls navigate only the current bake. Direct input/key tweaks use a cloned non-recording preview until Bake or Step commits a new official timeline.

The runtime is separated from the UI by three seams: `simulation.js` owns signal/runtime semantics, `simulation-timeline.js` owns recorded history, and `simulation-controller.js` owns browser-facing lifecycle policy. `main.js` supplies rendering, status, audio, and persistence callbacks.

### Chip placement and library flow

1. library-controller derives groups from project collections, custom chips, and collectionOrder through the domain helper.
2. A click starts placement mode; a drag tracks a pointer across the library/popup and canvas.
3. library-controller owns drag capture, popup closing, placement preview, and final placement callback invocation.
4. The same placement state is also used by duplicate placement and bus-pair placement.

The shared placement concept is good. The library-specific pointer implementation is coupled to the global editor state and difficult to test without a browser.

### Custom-chip navigation

1. An instance with a custom description is inspected or double-clicked.
2. main.js pushes a view frame, swaps project.root to the custom description, and changes project.name.
3. The simulator is synchronized and a camera is remembered per view key.
4. The overlay back button restores the parent root/name/camera.

This works, but the open view is represented by mutation of the same project object rather than a distinct view/session model. That makes persistence and current-view metadata easy to confuse with the saved project identity.

### Import and persistence

Single-file project import and Unity conversion now live in `io/project-import.js`; API transport lives in `io/storage-client.js`; browser cache and export remain in `storage.js` as a compatibility facade. Folder-based Unity import is deliberately absent from the browser boundary. On the server, `api.mjs` routes into `json-repository.mjs`. The behavior remains local-first while the I/O seams can now be tested and replaced independently.

## Current architectural patterns

- Local-first persistence with asynchronous server synchronization.
- Mutable normalized document as the application state.
- Imperative controller with a full render path plus scheduled canvas/simulation lanes.
- Canvas retained as a stateless projection of project plus editor state.
- Recursive interpreter/runtime for custom chips.
- Full-document undo snapshots.
- Delegated DOM events for dynamically generated controls.
- Data-driven built-in catalog, but behavior still selected by type switches.
- Compatibility normalization at the document boundary.
- Atomic file replacement in the local JSON repository.

These patterns are appropriate for a small educational simulator. The problem is not the style; it is that several patterns are concentrated in the same files and lack explicit seams.

## Critique

### High-priority issues

#### 1. The application controller is too large

main.js combines at least six responsibilities:

- application bootstrap and hydration
- editor state and transient interaction state machines
- project mutation/undo/selection commands
- wire and placement geometry orchestration
- dynamic library/inspector/help rendering
- simulation state presentation and audio callback wiring
- persistence and import action wiring

The result is still a high fan-in/fan-out file with hidden dependencies on global variables, DOM IDs, renderer methods, and callback ordering. The simulation controller removes one of the most stateful slices; new editor features can still add another state flag, another branch in cancelTransientInteraction, another render side effect, or another delegated action string.

#### 2. Domain definitions are distributed by concern rather than by chip

Adding or changing a built-in can require edits in:

- model.js for catalog shape and pins
- simulation.js for behavior
- renderer.js for special visuals
- main.js for inspector editors or context actions
- model collection definitions for discoverability
- tests or example JSON

This is a reasonable first implementation, but it will not scale to many devices or user-defined behaviors. There is no explicit capability contract saying which optional behavior, visual, inspector, and internal-data handler belong to a chip.

#### 3. Persistence and import boundaries were mixed (addressed in the first wave)

The original issue was that storage.js was both a cache/API client and a project importer, while server/api.mjs was both an HTTP router and a JSON filesystem repository. `io/project-import.js`, `io/storage-client.js`, and `server/json-repository.mjs` now separate those responsibilities. `storage.js` intentionally remains as a compatibility facade until callers can migrate without a broad import change.

#### 4. UI contracts are stringly typed and scattered (partially addressed)

IDs, dynamic data attributes, action names, and template fragments remain distributed across index.html, main.js, and library-controller.js. Shared DOM/icon/escaping behavior is now centralized, but the inspector and context menu are still small command protocols without a central action registry.

### Medium-priority issues

#### 5. Rendering is a broad class

WorldRenderer handles camera math, grid, wires, pins, chip bodies, special displays, annotations, previews, and all canvas hit testing. It is still coherent as a canvas adapter, but visual growth will make the class difficult to navigate. Display rendering and interaction geometry are the first candidates for sub-boundaries.

#### 6. styles.css contains layered overrides

The file begins with a general application layout and later applies a reference-style shell that overrides many of the earlier rules. This is effective during iteration but makes the final value of a rule depend on location. It also leaves legacy selectors such as the hidden topbar concepts near the active shell.

#### 7. Runtime and editor revisions are coupled

Simulator runtime rebuilds are keyed from project._revision. Some meaningful changes intentionally use a non-structural touch call, while bake/checkpoint policy now lives behind SimulationBake and runtime snapshots expose an explicit version/step contract. The distinction is clearer, but the controller still decides which project mutations are structural; a future feature can still update the wrong revision channel.

#### 8. Test coverage is still domain-heavy and UI-light

The tests now cover simulator behavior, normalization, saved examples,
collection ordering, pointer-session invariants, render scheduling, stroke
geometry, bake/timeline/preview transitions, and static-build contracts. They
still do not cover the browser DOM end to end, storage HTTP round trips,
full pointer gesture integration, or custom-view lifecycle. The most fragile
application-shell paths therefore still have less protection than the domain.

### Lower-priority issues

#### 9. Full-project undo snapshots are simple but scale poorly

The current approach is excellent for correctness and small projects, but large RAM/display/custom-chip documents will make every edit allocate and retain large JSON clones. This is not an immediate problem; it is a boundary to monitor.

#### 10. The file topology does not distinguish source, adapters, fixtures, and app features

The top-level src directory is flat even though it contains domain, runtime, presentation, persistence, import, and application-shell code. The project is still small enough to find things, but feature growth will make discovery worse.

## Proposed improvements considered

### Proposal A: explicit domain and catalog layers

Move shared low-level utilities into a small domain core, isolate the built-in catalog from project normalization, and keep model.js as a compatibility facade while callers migrate. Add a collection-group helper to the domain so UI code does not reconstruct project ordering rules.

Benefits: built-in and schema boundaries become findable; catalog changes do not require searching through project normalization; collection ordering becomes one contract.

Risk: moving the catalog can create import cycles if IDs and cloning remain in model.js. The core utility split must happen first.

Decision: adopt as a safe first refactor.

### Proposal B: separate project file import from persistence

Create a project-import adapter module for web/Unity file parsing and leave storage.js responsible for browser cache, API transport, and export encoding. Preserve storage.js re-exports temporarily so the app contract does not change in one step.

Benefits: import tests can run without browser storage; persistence can evolve independently; Unity compatibility remains an adapter.

Decision: adopt.

### Proposal C: separate the server JSON repository from HTTP routing

Create a small JSON repository service that owns paths, atomic writes, listing, and project/chip record persistence. Keep api.mjs responsible for HTTP parsing, route selection, response codes, and CORS.

Benefits: server behavior can be tested without a network; a later SQLite or remote repository can replace the store without rewriting routes.

Decision: adopt.

### Proposal D: extract generic UI utilities and the library controller

Move DOM lookup, icon rendering, escaping, and small template helpers into ui utilities. Then isolate collection/library rendering, popup positioning, chip drag placement, and collection reordering behind a library controller with injected editor callbacks.

Benefits: removes a coherent feature slice from main.js and centralizes the most repetitive dynamic UI contract.

Risk: pointer capture and placement callbacks are sensitive to event ordering.

Decision: adopt in two steps: utilities first, library controller second, with focused static tests where possible.

### Proposal E: chip behavior registry

Replace the long built-in type switch with a registry of behavior handlers and optional display/inspector metadata. Keep the existing data-driven descriptions and use the registry only for behavior dispatch.

Benefits: a new built-in becomes a localized registration; simulation behavior becomes individually testable.

Risk: the registry must preserve simulator tick semantics, recursive custom evaluation, and stateful commit behavior.

Decision: design now, implement after the safer topology refactors. It is the most valuable medium-term change but has the highest behavior risk.

### Proposal F: split WorldRenderer and CSS immediately

Split canvas drawing into multiple renderer classes and rewrite styles.css into many files immediately.

Decision: defer. The current renderer is still a coherent canvas adapter, and CSS splitting before the shell boundary is stable would increase indirection without reducing the main risk. First establish feature ownership and tests.

## Reconciled prioritized refactoring plan

The following plan removes contradictions and keeps the refactor incremental.

### First-wave result

The required checkpoint was created before architectural code changes. Steps P0.2 through P0.4 and P1.5 through P1.8 are implemented: focused contract tests were added; catalog/core, DOM/icon utilities, project import, API client, JSON repository, collection derivation, and the library controller have explicit boundaries. The simulation-controller extraction is now also implemented: bake/preview transitions, timer ownership, stepping, and scrubbing are no longer duplicated in main.js. The compatibility facades remain deliberately in place. P2 remains future work because it carries higher behavior risk.

### P0: protect behavior and establish seams

1. Add this architecture document and a Git checkpoint of the known-good state.
2. Add focused tests for collection-order normalization, project file encoding, and repository round trips where they can be isolated.
3. Introduce domain/core and domain/catalog boundaries while preserving model.js exports.
4. Introduce ui/dom-icons helpers while preserving existing DOM IDs and dynamic action names.

### P1: separate I/O and feature ownership

5. Move web/Unity project-file parsing into a project-import adapter. Keep storage.js as a compatibility facade for the current main.js imports.
6. Extract the server JSON repository from HTTP routing.
7. Extract the library/collection controller from main.js using explicit getters and callbacks for project, editor state, placement, rendering, and menu closure.
8. Centralize collection-group derivation in the domain layer and remove duplicate ordering logic from the controller.
9. Extract the browser-facing simulation lifecycle into simulation-controller.js, keeping bake history and preview execution behind explicit callbacks.

### P2: improve extensibility after the seams are stable

10. Move built-in behavior dispatch into a processor registry with contract tests for combinational, stateful, and display/audio devices.
11. Split renderer internals by stable visual domains: wires/pins, annotations, chips, and special displays. Keep WorldRenderer as the public adapter.
12. Replace the layered CSS override structure with a single active shell layer plus explicit legacy removal, preserving the current palette tokens.
13. Add browser-level interaction tests for placement, group reorder, note resize, internal view navigation, inspector editing, and simulation scrubbing.

### Explicitly not in this refactor

- No framework migration.
- No global event bus.
- No database or remote service.
- No rewrite of the JSON schema.
- No change to user-facing circuit behavior.
- No premature plugin system for chips.

The checkpoint must precede steps 3 through 9. Each step should keep the old public import paths where practical and should end with tests/build passing.

## Final architectural target

The target topology is:

- domain/core.js: IDs, cloning, primitive shared utilities
- domain/catalog.js: TYPE, built-ins, collections, catalog metadata
- domain/project.js: project/chip normalization, geometry, annotations, custom-chip conversion
- simulation/: signal algebra, runtime graph, behavior registry, snapshots
- renderer/: WorldRenderer facade plus visual/hit-test subdomains
- io/project-import.js: web and Unity file adapters
- io/storage-client.js: local API client
- ui/: DOM/icon helpers, library controller, notifications, pointer sessions, performance scheduler, inspector/help views
- app/: bootstrap, editor state, commands, lifecycle orchestration
- server/json-repository.mjs: filesystem persistence
- server/api.mjs: HTTP transport/routes
- storage/: example documents and fixtures
- test/: domain, I/O, and interaction tests

Dependency rule:

domain has no browser dependencies; simulation depends on domain only; renderer depends on domain and simulation signal contracts; app/ui depend on all client-side services; server transport depends on the repository but not browser modules.

The current refactor should move toward this target without pretending every file needs to be split immediately. In the current implementation, `src/model.js` remains the compatibility facade for the future `domain/project.js` name, and `src/storage.js` remains the compatibility facade for the extracted I/O modules.

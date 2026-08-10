# Digital Logic Sim Web architecture audit

Status: current-state audit and reconciled refactoring plan

Scope: the standalone application in this directory, including the browser editor, canvas renderer, simulator, local JSON API, import adapters, tests, examples, and development scripts.

## Executive verdict

The project has a sound behavior spine:

chip descriptions -> placed instances -> endpoint wires -> signal propagation -> simulation snapshot -> canvas/UI state

The domain model and simulator are already useful, testable seams. The main architectural weakness is the application shell. src/main.js is a 2.7k-line module that owns domain mutations, interaction state machines, persistence orchestration, dynamic HTML templates, event registration, simulation controls, custom-chip navigation, and rendering coordination. That makes the product easy to extend initially but increasingly difficult to find, reason about, and test.

The next refactor should preserve the existing vanilla JavaScript approach. It should create explicit boundaries around the application shell and I/O, not introduce a framework, global event bus, or a generalized plugin system before the product needs one.

## File topology

### Runtime and browser shell

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| index.html | Static shell, toolbar, drawers, bottom bar, menus, Help modal, file inputs | DOM contract and layout composition |
| src/main.js | App state, commands, interaction handling, dynamic UI rendering, lifecycle, persistence calls | Application controller; currently too broad |
| src/renderer.js | Canvas drawing, camera transforms, hit testing, placement previews | Canvas presentation and geometric queries |
| src/styles.css | All interface and canvas-adjacent CSS | Presentation; currently has an initial layer plus a later override layer |

### Domain and runtime

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| src/model.js | Built-in catalog, project/chip schema creation and normalization, geometry helpers, annotations, custom-chip conversion | Domain model; currently combines catalog and project concerns |
| src/simulation.js | Signal algebra, runtime graph, built-in chip execution, recursive custom-chip evaluation, snapshots | Simulation domain/runtime |
| src/unity-compat.js | Unity-shaped project/chip conversion | Import adapter |

### Persistence and tooling

| Path | Current responsibility | Architectural role |
| --- | --- | --- |
| src/storage.js | Browser cache, JSON API client, project export, project import, Unity import wiring | Client persistence and file I/O; import and storage are mixed |
| server/api.mjs | HTTP server, routes, request parsing, filesystem paths, JSON repository operations | Local persistence service; transport and repository are mixed |
| server/dev.mjs | Starts Vite and the local API and coordinates shutdown | Development process composition |
| storage/projects/*.json | Complete example projects and regression fixtures | Data fixtures, not application source |
| storage/chips/*.json | Saved custom-chip records | Persistence fixtures |
| scripts/*.mjs | Example generation and annotation utilities | One-off data tooling |
| test/*.test.js | Simulator/model/example-project tests | Domain regression suite |

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
- interface: inputPins and outputPins
- internal circuit: instances, wires, junctions
- optional displays and annotations

A custom description uses the same shape as a built-in description. Its instances can reference built-ins or other custom chips, so the simulator recursively builds child runtimes.

### Circuit primitives

- Instance: id, name, position, rotation, label, internalData, linkedBusPairId, outputPinColours
- Pin: id, name, bits, direction, x, y, valueDisplay, colour
- Endpoint: owner and pin; owner can be an instance ID, root, junction, or wire during an in-progress wire split
- Wire: id, source, target, route points, and optional colour
- Annotation: id, type, text, position, dimensions, font size, colour, and derived background

The endpoint shape is shared by editor hit testing, wire editing, renderer geometry, and simulation propagation. It is a high-value contract and should remain domain-owned rather than being recreated in UI code.

### Simulation interface

Simulator accepts a project and exposes:

- syncProject(project)
- step()
- reset()
- restore(snapshot, stepCount)
- stateFor(endpoint)
- outputFor(instanceId)
- snapshot, containing endpoint states, per-instance signals/internal state, and root outputs

Signal states are two bitmasks: bits for values and tri for driven/disconnected bits. PIN_MASK represents disconnected bits. Built-in processing is currently a type switch inside simulation.js.

### Renderer interface

WorldRenderer owns a canvas and exposes:

- camera state and toWorld/toScreen transforms
- zoomAt and fit
- draw(project, simulator, editorState)
- wirePoints and endpointPosition
- findPin, findJunction, findInstance, findAnnotation, findWire, findWirePoint, and resize-handle queries

The renderer is intentionally imperative and canvas-based. The editor supplies project data plus an editorState snapshot; the renderer does not mutate the project.

### Persistence interface

The browser client currently provides:

- saveToServer and loadFromServer for the local JSON API
- saveToBrowser and loadFromBrowser for the immediate local cache
- encodeProject and downloadProject for portable JSON
- readProjectFile and readProjectFiles for web/Unity import

The server provides:

- GET /api/health
- GET /api/projects
- GET /api/projects/latest
- GET, PUT, and POST /api/projects/:id
- GET /api/chips
- GET, PUT, and POST /api/chips/:id

The server writes complete project documents atomically through temporary files and rename. The client saves the project first to the API and then mirrors it to the browser cache; when the API is unavailable, the browser cache is the fallback.

### Implicit DOM contracts

The application shell depends on stable IDs such as world, project-name, inspector, collection-tabs, collection-popup, bottom-menu-popup, run-sim, step-sim, step-scrubber, and viewed-back. Dynamic controls communicate through data-action, data-field, data-chip, data-collection, and data-context-action attributes.

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

Current ownership is mostly aligned except for these leaks:

- main.js directly constructs and mutates the project and simulator while also rendering every dynamic UI region.
- storage.js owns both storage transport and file-format conversion.
- server/api.mjs owns both HTTP concerns and filesystem repository behavior.
- model.js owns both catalog construction and project normalization/geometry.
- built-in chip presentation is split across model.js, simulation.js, renderer.js, and main.js rather than represented by one explicit chip definition contract.

## Main data and control flows

### Startup and hydration

1. index.html creates the shell and loads the Lucide runtime.
2. main.js loads the browser cache synchronously.
3. The project is normalized and a Simulator is constructed.
4. Library, renderer, inspector, and simulation controls are rendered.
5. The camera fits the current project and the simulation timer starts if not paused.
6. hydrateProjectFromServer asynchronously loads the last/latest server project, replaces the project and simulator, then renders again.

This gives fast local-first startup, but the hydration boundary is hidden inside the same module as all editing behavior.

### Edit and render loop

1. A DOM or canvas event handler reads the current project and editor state.
2. A command mutates project data, often through mutate.
3. mutate records a full-project undo snapshot, updates revision/history, and calls render.
4. render copies the simulator snapshot onto the project, asks WorldRenderer to draw, updates DOM readouts, renders inspector/help/simulation controls, and refreshes Lucide icons.
5. Explicit Save or selected autosave paths call saveCurrentProject.

The flow is understandable but broad. A single render can rebuild the inspector, update the help metadata, redraw the canvas, and replace dynamic icons even when only one small region changed.

### Simulation loop

1. setRunning creates or clears a timer.
2. runStep syncs the simulator to the project, truncates history if needed, steps the recursive runtime, records a snapshot, plays audio, and renders.
3. Paused history scrubbing restores a simulator snapshot and renders without changing the persisted project.

The runtime is separated well from the UI, but the UI owns history policy, timer policy, audio policy, and simulator lifecycle in one place.

### Chip placement and library flow

1. renderLibrary derives groups from project collections, custom chips, and collectionOrder.
2. A click starts placement mode; a drag tracks a pointer across the library/popup and canvas.
3. main.js owns drag capture, popup closing, placement preview, validity, and final instance insertion.
4. The same placement state is also used by duplicate placement and bus-pair placement.

The shared placement concept is good. The library-specific pointer implementation is coupled to the global editor state and difficult to test without a browser.

### Custom-chip navigation

1. An instance with a custom description is inspected or double-clicked.
2. main.js pushes a view frame, swaps project.root to the custom description, and changes project.name.
3. The simulator is synchronized and a camera is remembered per view key.
4. The overlay back button restores the parent root/name/camera.

This works, but the open view is represented by mutation of the same project object rather than a distinct view/session model. That makes persistence and current-view metadata easy to confuse with the saved project identity.

### Import and persistence

Project import, Unity conversion, browser cache, server save/load, export, and custom-chip synchronization meet in storage.js and main.js. The behavior is functional, but the boundary is too wide: a file-format adapter should not need to know how browser cache keys work, and a project save should not be coupled to import code.

## Current architectural patterns

- Local-first persistence with asynchronous server synchronization.
- Mutable normalized document as the application state.
- Imperative controller with a single render pass.
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

main.js combines at least seven responsibilities:

- application bootstrap and hydration
- editor state and transient interaction state machines
- project mutation/undo/selection commands
- wire and placement geometry orchestration
- dynamic library/collection/inspector/help rendering
- simulation lifecycle/history/audio
- persistence and import action wiring

The result is a high fan-in/fan-out file with hidden dependencies on global variables, DOM IDs, renderer methods, and callback ordering. New features tend to add another state flag, another branch in cancelTransientInteraction, another render side effect, and another delegated action string.

#### 2. Domain definitions are distributed by concern rather than by chip

Adding or changing a built-in can require edits in:

- model.js for catalog shape and pins
- simulation.js for behavior
- renderer.js for special visuals
- main.js for inspector editors or context actions
- model collection definitions for discoverability
- tests or example JSON

This is a reasonable first implementation, but it will not scale to many devices or user-defined behaviors. There is no explicit capability contract saying which optional behavior, visual, inspector, and internal-data handler belong to a chip.

#### 3. Persistence and import boundaries are mixed

storage.js is both a cache/API client and a project importer. server/api.mjs is both an HTTP router and a JSON filesystem repository. This makes it hard to test each part in isolation and makes future persistence changes more expensive than necessary.

#### 4. UI contracts are stringly typed and scattered

IDs, dynamic data attributes, action names, and template fragments are distributed across index.html and main.js. The inspector and context menu are effectively small command protocols without a central action registry.

### Medium-priority issues

#### 5. Rendering is a broad class

WorldRenderer handles camera math, grid, wires, pins, chip bodies, special displays, annotations, previews, and all canvas hit testing. It is still coherent as a canvas adapter, but visual growth will make the class difficult to navigate. Display rendering and interaction geometry are the first candidates for sub-boundaries.

#### 6. styles.css contains layered overrides

The file begins with a general application layout and later applies a reference-style shell that overrides many of the earlier rules. This is effective during iteration but makes the final value of a rule depend on location. It also leaves legacy selectors such as the hidden topbar concepts near the active shell.

#### 7. Runtime and editor revisions are coupled

Simulator runtime rebuilds are keyed from project._revision. Some meaningful changes intentionally use a non-structural touch call, while simulation history is maintained separately in main.js. The distinction is useful but implicit. A future feature can easily update the wrong revision/history channel.

#### 8. Test coverage is domain-heavy and UI-light

The tests cover simulator behavior, normalization, and saved examples. They do not cover storage API round trips, import adapters, collection ordering, command transitions, DOM rendering, pointer gestures, or custom-view lifecycle. The most fragile code therefore has the least automated protection.

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

### P2: improve extensibility after the seams are stable

9. Move built-in behavior dispatch into a processor registry with contract tests for combinational, stateful, and display/audio devices.
10. Split renderer internals by stable visual domains: wires/pins, annotations, chips, and special displays. Keep WorldRenderer as the public adapter.
11. Replace the layered CSS override structure with a single active shell layer plus explicit legacy removal, preserving the current palette tokens.
12. Add browser-level interaction tests for placement, group reorder, note resize, internal view navigation, inspector editing, and simulation scrubbing.

### Explicitly not in this refactor

- No framework migration.
- No global event bus.
- No database or remote service.
- No rewrite of the JSON schema.
- No change to user-facing circuit behavior.
- No premature plugin system for chips.

The checkpoint must precede steps 3 through 8. Each step should keep the old public import paths where practical and should end with tests/build passing.

## Final architectural target

The target topology is:

- domain/core.js: IDs, cloning, primitive shared utilities
- domain/catalog.js: TYPE, built-ins, collections, catalog metadata
- domain/project.js: project/chip normalization, geometry, annotations, custom-chip conversion
- simulation/: signal algebra, runtime graph, behavior registry, snapshots
- renderer/: WorldRenderer facade plus visual/hit-test subdomains
- io/project-import.js: web and Unity file adapters
- io/storage-client.js: browser cache and local API client
- ui/: DOM/icon helpers, library controller, inspector/help views
- app/: bootstrap, editor state, commands, lifecycle orchestration
- server/json-repository.mjs: filesystem persistence
- server/api.mjs: HTTP transport/routes
- storage/: example documents and fixtures
- test/: domain, I/O, and interaction tests

Dependency rule:

domain has no browser dependencies; simulation depends on domain only; renderer depends on domain and simulation signal contracts; app/ui depend on all client-side services; server transport depends on the repository but not browser modules.

The current refactor should move toward this target without pretending every file needs to be split immediately.

# Legacy implementation audit

Status: current codebase review for developer follow-up

This audit separates code that is genuinely unreachable from compatibility
paths that still protect saved documents, imports, or active callers. The rule
used here is conservative: an implementation is removed only when the active
application has no user path or internal caller for it, and the behavior is
already owned by a newer path.

## What was inspected

- source imports and symbol references across `src/`, `server/`, `scripts/`,
  and `test/`;
- active DOM IDs and event bindings in `index.html` and `src/main.js`;
- CSS selectors that were hidden or overridden by the active shell;
- compatibility, migration, fallback, and deprecated-field markers;
- architecture notes and tests that still describe older contracts.

## Removed in this audit

### Hidden topbar command surface

Removed:

- the hidden `topbar`, `brand`, and `top-actions` DOM subtree;
- the unreachable `new-project`, `save-project`, `export-project`, and
  `import-project` button bindings in `src/main.js`;
- the old topbar/brand/button CSS rules and the orphaned `bottom-inspector`
  selector.

Why this was safe: the final shell already forced `.topbar { display: none }`,
and the active bottom menu owns the same project, save, import, and export
actions. The shared `import-file` input was retained, but moved to the app root
so the active Import JSON command still has one clear file-input contract.

### `SimulationTimeline` compatibility alias

Removed:

- `SimulationTimeline extends SimulationBake`;
- the unused `SIMULATION_TIMELINE_VERSION` export;
- the tests' dependency on the alias.

Why this was safe: production code already constructs `SimulationBake` through
`simulation-controller.js`. The alias was referenced only by the timeline unit
test and its own compatibility comment. `src/simulation-timeline.js` remains
because it contains the live bake/history implementation and frame factory;
the filename is historical, but the implementation is not.

## Partial legacy paths retained for review

These are not dead enough to delete. Each one has a current caller or protects
documents that the application still promises to open.

| Area | Evidence | Why it remains | Review decision |
| --- | --- | --- | --- |
| Project facade | `src/model.js` re-exports `domain/catalog.js` and `domain/core.js` while owning normalization and geometry | Almost every domain, renderer, simulator, script, and test imports from it | Keep as the current project boundary; migrate toward `domain/project.js` only as a deliberate topology change |
| Storage facade | `src/storage.js` is imported by `main.js` and combines browser cache, static fallback, export, and server delegation | Removing it would require a coordinated import migration and would blur the static/local-first contract | Keep for now; later move `main.js` to explicit `io/project-import.js`, `io/storage-client.js`, and cache modules |
| Fixed-pin custom-chip migration | `legacyInterfaceInstance()` and `normalizeCompositeInterface()` in `src/model.js` | Older chip JSONs contain fixed `inputPins`/`outputPins` and root-owned wire endpoints; the migration makes them editable terminal nodes | Keep until a schema-version migration or one-time asset conversion is adopted; then delete the old branch and its fixtures together |
| Derived custom-chip pins | `refreshInterfacePorts()` produces `inputPins`/`outputPins` from movable `IN-*`/`OUT-*` nodes | Parent-facing wires, renderer geometry, and simulator boundaries still consume this projection | Keep; this is a compatibility projection, not a second authoring model |
| Unity file adapter | `src/io/project-import.js` calls `src/unity-compat.js` for single-file Unity chip/project records | Folder import UI is gone, but single-file conversion is still an active import format with tests and documentation | Keep unless Unity-file support is explicitly discontinued; if removed, delete the adapter and conversion tests together |
| `starred` project field | `createProject()`, `normalizeProject()`, Unity conversion, and stored examples still carry it, but no active UI or runtime reads it | It is a persisted/imported compatibility field even though its former library behavior is gone | Candidate for a versioned schema cleanup; do not silently remove it from old documents without deciding whether export should strip it |
| `nameLocation` and pin `valueDisplay` | Accepted by catalog/import/generated JSON, but current renderer behavior chooses label/display placement from current special-chip rules instead | They may still matter to imported Unity or educational records even though they are not current rendering controls | Verify format ownership; either implement them explicitly or document and migrate them out |
| Layered CSS shell | `src/styles.css` still has an initial generic layout, a reference-style shell, and later refinement rules | Many later rules rely on inherited values from the earlier layers; deleting the whole first layer would be a visual rewrite | Keep as a scoped refactor candidate; remove selectors only with browser screenshot checks |
| Main interaction state machine | `src/main.js` still owns pointer sessions plus separate `wireStart`, `drag`, `pan`, `zoomDrag`, selection, placement, and annotation states | These are all active behaviors, not duplicate unreachable implementations | Keep behavior stable; consolidate state ownership only with interaction integration tests |
| One-off circuit generators | `scripts/annotate-simple-alu.mjs`, `create-tiny-hex-display.mjs`, layout, and Nand2Tetris builders are not runtime imports | They preserve reproducible provenance for generated examples and are used by asset preparation workflows or developers | Keep; add an explicit generator/fixture ownership note before deleting any |
| Debug hooks | `globalThis.digitalLogicSim` and opt-in `__DLS_PERF_REPORT__` are not product UI | They provide local smoke-test and performance inspection entry points | Keep as intentional development seams, not legacy |

## Documentation drift found

The interaction audit documents still mention older names such as
`activePointerId` and `wireGesture` in places where the current source uses
`pointerSession`. Those notes describe the history and risks of the earlier
implementation, but they can mislead a developer trying to trace current code.
The next documentation pass should mark historical references explicitly or
rewrite them against the current session contract.

The current architecture document also previously described the removed hidden
topbar and the removed `SimulationTimeline` alias; those references were
updated in this pass.

## Recommended order for the next cleanup wave

1. Decide the saved-document policy for `starred`, `nameLocation`, and
   `valueDisplay`. Add a migration test before deleting or stripping fields.
2. Convert all active `main.js` persistence imports to the extracted I/O
   modules, then reduce `src/storage.js` to a cache/export boundary or remove
   it once no callers remain.
3. Add a versioned conversion step for fixed-pin custom chips. After all
   bundled and regression fixtures are current, remove the legacy interface
   synthesis branch.
4. Reconcile the interaction audit documents with `pointerSession` and add
   browser-level coverage before consolidating the remaining state flags.
5. Flatten `styles.css` only as a visual refactor with screenshot comparison;
   this is maintainability work, not a safe dead-code deletion.

## Verification target

The removals in this audit must preserve the active bottom-menu actions,
single-file import, bake history, custom-chip migration, and static build. The
full test suite and production build are the acceptance checks for this wave.

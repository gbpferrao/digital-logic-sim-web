# Interaction Architecture Audit

Date: 2026-08-10  
Scope: canvas selection, box selection, chip/annotation dragging, wire gestures, middle-button pan, Alt-pan, Alt-right zoom drag, wheel zoom, library placement, pointer capture, overlays, and interaction tests.

This document consolidates four independent medium-effort delegated reviews of the current implementation. The two detailed evidence reports are [`selection.md`](selection.md) and [`pan-zoom.md`](pan-zoom.md).

## Executive conclusion

The interaction problem is structural rather than a single missing click handler. The coordinate transform and camera math are internally consistent. The fragile part is interaction arbitration:

- several gesture states can represent overlapping phases;
- canvas capture and window-level fallback listeners form two pointer-delivery paths;
- toolbar and library drags have their own capture systems;
- selection, dragging, input toggling, and double-click editing share one immediate pointer-down path;
- pan priority is inconsistent with the Help contract;
- box selection is intentionally limited to empty-canvas starts and chip instances;
- cleanup does not cover every way a pointer can disappear.

This combination explains the reported symptoms: the canvas can become apparently dead after a lost release, Alt-pan can lose to an object gesture, and box selection can appear not to work when it starts over an object or is expected to include annotations/wires.

## Confidence and verification boundary

The reviews were code-based. The browser-control surface was unavailable during this pass, so the findings were not validated by a live pointer trace. The conclusions below are therefore based on the event topology, state transitions, and file references—not on claiming a successful manual reproduction.

The current working tree already contains a partial pointer-session correction (`activePointerId`, centralized canvas capture/release, outside-target fallback, and Select-mode wire selection). The audit evaluates what remains incomplete around that correction.

## Current interaction topology

| Concern | Current owner | Evidence | Assessment |
| --- | --- | --- | --- |
| Canvas pointer priority and transitions | `src/main.js` | `handlePointerDown` around lines 2109–2276 | One large priority chain; many state flags influence the result. |
| Canvas pointer movement/finalization | `src/main.js` | `handlePointerMove` / `handlePointerUp` around lines 2278–2471 | Capture plus window fallback; cleanup is spread across branches. |
| Hit testing and geometry | `src/renderer.js`, `src/model.js` | `findPin`, `findInstance`, `findWire`, bounds helpers | Math is coherent, but callers repeat and reorder hit-test logic. |
| Camera transforms | `src/renderer.js` | `toWorld`, `toScreen`, `zoomAt` | Small and internally consistent. |
| Library chip drag | `src/ui/library-controller.js` plus `src/main.js` | library pointer capture and injected callbacks | Separate pointer lifecycle mutates shared editor state. |
| Note/label toolbar drag | `src/main.js` | toolbar drag helpers near lines 200–286 | Another element-level capture path. |
| Collection tab reorder | `src/ui/library-controller.js` | native HTML drag/drop | Different cancellation and browser-default model. |
| Overlay boundaries | `index.html`, `src/styles.css` | toolbar, drawers, popups, status, modal | Mostly intentional, but the event boundary is split between CSS hit-testing and state gates. |
| Automated protection | `test/` | no pointer interaction tests | The most fragile layer is effectively untested. |

## Findings

### P0 — Pointer lifecycle can still deadlock the canvas

The current code tracks `state.activePointerId` in `captureCanvasPointer()` and rejects a different pointer while one is active. That is the right ownership concept, but it is not a complete lifecycle contract:

- capture failures are silently ignored;
- there is no `lostpointercapture` handler;
- there is no `window.blur` or `document.visibilitychange` emergency cleanup;
- `pointercancel` calls the broad `cancelTransientInteraction()` path, which also clears selection and can exit wire-edit mode;
- window-level fallback handlers and native capture can both deliver movement/finalization events.

Evidence: `src/main.js:178-198`, `src/main.js:1028-1060`, `src/main.js:2696-2748`.

If the browser loses capture without a usable `pointerup` or `pointercancel`, `activePointerId`, `pan`, `drag`, or `selectionBox` can remain active. Every later pointerdown can then be rejected, matching the “nothing responds” symptom.

Repair direction: create one idempotent `cancelActivePointerGesture(reason)` that clears the active session and releases capture. Call it from pointerup, pointercancel, lostpointercapture, blur, visibility loss, and project/tool reset. Keep editor-mode cancellation separate from pointer-session cleanup.

### P0 — Navigation priority conflicts with object priority

Middle-button pan is global, but Alt+left pan is currently guarded by `!pointerTarget`:

`event.button === 1 || event.altKey && event.button === 0 && !pointerTarget`

Evidence: `src/main.js:2160-2170`.

That means Alt+left pans over empty space but selects, drags, starts wiring, or edits routes over chips, wires, pins, notes, and labels. The Help UI says `MMB / ALT` pans the world (`index.html:180`), so the implementation and user contract disagree.

Repair direction: recognize navigation gestures before object hit testing. Middle-button and Alt+left should pan regardless of the object under the pointer, unless a deliberately documented interaction reserves that modifier.

### P1 — Selection is coupled to immediate drag ownership

An ordinary chip click calls `selectInstance()` and immediately calls `startDragging()`, which captures the pointer. Annotation selection does the same. Pointerup later decides whether that was a click, a move, or an input toggle.

Evidence: `src/main.js:2232-2248`, `src/main.js:1250-1273`, `src/main.js:1330-1340`, `src/main.js:2453-2470`.

This makes “select,” “drag,” and “toggle input” one gesture with several late interpretations. It amplifies any missed pointerup and makes double-click side effects possible before edit mode opens.

Repair direction: introduce a pending press record:

1. pointerdown records the target and origin;
2. movement beyond a threshold promotes it to a drag and captures the pointer;
3. pointerup without movement commits a click/selection;
4. cancel restores and clears the pending press.

This is a correction to the interaction model, not a visual workaround.

### P1 — Single-click and double-click paths compete

The canvas has pointer handlers and an independent `dblclick` handler. The first click of a double-click still performs selection, begins a drag candidate, and can toggle an input on pointerup before `dblclick` opens the editor.

Evidence: `src/main.js:2696-2721`, `src/main.js:2239-2248`, `src/main.js:2463-2465`.

Repair direction: use one click/double-click coordinator, or make the pending press cancellable by `dblclick`. Input toggling and drag commits must not happen for a gesture that is subsequently recognized as a double-click.

### P1 — Hit-test precedence is duplicated and tool-insensitive

Pointerdown, hover, wire targeting, context menus, and double-click each recompute hit targets, often in slightly different order. The common order is pin → junction → annotation → instance → wire.

Evidence: `src/main.js:2160-2176`, `src/main.js:2282-2304`, `src/main.js:799-807`, `src/main.js:2039-2075`; geometry methods in `src/renderer.js:671-739`.

Consequences:

- pins win over the chip that contains them;
- junctions win over nearby wires;
- a wire crossing close to a pin may be hard to select;
- hover and click can disagree about the target;
- wiring priority leaks into Select mode.

The screen-to-world conversion itself is not the likely cause: `canvasPoint()` and the renderer's CSS-pixel camera coordinates are consistent (`src/main.js:2104-2107`, `src/renderer.js:110-130`).

Repair direction: add one prioritized `hitTargetAt(world, mode)` query returning a single target object. Use it for hover, pointerdown, context menus, double-click, selection, and wire targeting. Let `mode` decide whether pin/junction priority is appropriate.

### P1 — Box selection has a narrow and surprising contract

Box selection begins only after no pin, junction, annotation, instance, or wire is hit. It therefore cannot begin from the surface of an object. On completion, normal selection adds only `project.root.instances`; annotations, wires, junctions, and root pins are excluded.

Evidence: `src/main.js:2205-2275`, `src/main.js:2412-2440`.

This is a missing capability if the intended meaning is “select everything in the rectangle.” It also explains why box selection can feel broken when the drag starts near or on a visible object.

Repair direction: decide and document the contract. Recommended Select-mode behavior:

- empty-canvas drag starts a chip/annotation selection box;
- a modifier can explicitly request box selection from an object if desired;
- selection geometry is centralized in `renderer.js`;
- annotations are included;
- wires/junctions are included only if the product intentionally supports mixed graphical selection;
- wire-point selection remains a separate Wire Edit mode.

### P1 — Pan/zoom cleanup has a stale context-menu flag

Alt+right zoom sets `state.suppressContextMenu = true`, but the flag is cleared only when a later contextmenu event arrives. The zoom pointerup path clears `state.zoomDrag` but not the flag.

Evidence: `src/main.js:2030-2038`, `src/main.js:2142-2146`, `src/main.js:2359-2361`.

Repair direction: make suppression owned by the zoom session and clear it on pointerup, pointercancel, lost capture, blur, and visibility loss.

### P1 — Pointer ownership is split across generations

The current implementation has:

- canvas pointer handlers;
- native canvas pointer capture;
- window-level fallback forwarding;
- library-button pointer capture;
- annotation-toolbar pointer capture;
- native HTML drag/drop for collection tabs;
- global keyboard and pointer listeners.

Evidence: `src/main.js:178-198`, `src/main.js:200-286`, `src/main.js:2696-2755`, `src/ui/library-controller.js:111-166`, `src/ui/library-controller.js:214-240`.

The code is not carrying a fully dead old implementation, but it is carrying several generations of interaction behavior composed together. The newer pointer-session helper coexists with older boolean states (`wireGesture`, `wireStart`, `selectionBox`, `drag`, `pan`, `zoomDrag`) and independent library/toolbar lifecycles.

Repair direction: do not immediately rewrite the whole editor. First define a single interaction session contract and route canvas gestures through it. Then adapt library/toolbar placement to emit placement intents into the same coordinator. Replace native drag/drop only if it remains a demonstrated source of conflicts.

### P2 — Touch behavior is undefined

`.canvas-wrap` and `#world` use `touch-action: none`, so native scrolling/gesture behavior is disabled. But the app has no two-finger pan/pinch model; a second pointer is rejected by the single active-pointer guard.

Evidence: `src/styles.css:87-90`, `src/main.js:2110`.

Repair direction: either explicitly support touch navigation, or narrow the custom touch policy. Do not disable native touch behavior without providing the intended replacement.

### P2 — Interaction tests are absent

Existing tests cover domain normalization, simulation, storage, and saved examples. They do not cover click selection, box selection, drag thresholds, pointer capture, pan, wheel zoom, cancellation, double-click, or overlay boundaries.

Evidence: `test/` and [`../system.md`](../system.md), around the interaction boundary section.

Repair direction: add a pure transition/interaction-session test layer first, then a small browser smoke suite for real Pointer Events and pointer capture.

## What is already coherent

- Screen/world transforms are internally consistent.
- `WorldRenderer` is a reasonable owner for geometric hit tests, even though the queries need a unified façade.
- Wheel zoom is correctly anchored at the cursor through `renderer.zoomAt()`.
- Middle-button pan exists and its camera math is straightforward.
- The current Select-mode wire-click correction is directionally right: selecting a wire and starting a wire branch should be different tool behaviors.
- Canvas CSS does not contain a broad rule that disables pointer input; overlays intentionally own their own regions.

## Prioritized refactoring plan

### Phase 1 — Stabilize the existing model (P0)

1. Define a single active canvas pointer session: `{ pointerId, kind, phase, originScreen, originWorld }`.
2. Add idempotent cleanup for pointerup, pointercancel, lostpointercapture, window blur, and visibility loss.
3. Clear gesture-local flags (`suppressContextMenu`, pan, zoom, selection box, wire gesture) in that cleanup.
4. Recognize middle/Alt navigation before hit testing and align Help text with behavior.
5. Add diagnostic assertions or a development-only interaction status for impossible combinations.

### Phase 2 — Make selection semantics explicit (P1)

1. Separate pending click from committed drag.
2. Coordinate single-click and double-click.
3. Centralize hit-target resolution with tool-aware priority.
4. Define box-selection scope and include annotations if mixed selection is intended.
5. Keep pin-to-pin wiring and wire-edit route-point manipulation as explicit modes.

### Phase 3 — Reduce boundary duplication (P2)

1. Route library and toolbar placement through a placement intent/session adapter.
2. Keep one primary pointer-capture strategy; retain only a narrowly documented emergency fallback.
3. Decide the touch contract and implement it or remove the broad custom touch policy.
4. Revisit native HTML drag/drop for group reordering after the pointer coordinator is stable.

### Phase 4 — Protect the contract (P2)

Add tests for:

- click selection and Escape clearing;
- click-versus-drag threshold;
- input click toggling;
- double-click edit without unintended movement/toggle;
- empty-canvas box selection and mixed annotation selection;
- middle-button pan and Alt-pan over empty space and objects;
- wheel zoom anchoring;
- pointer release outside canvas;
- pointercancel, lost capture, blur, and visibility loss;
- Select-mode wire click versus Wire-mode branch creation;
- library click placement and library drag placement.

## Implementation follow-up — 2026-08-10

The first two phases of the plan are now implemented in the canvas path:

- `src/ui/pointer-session.js` owns the small, pure click-versus-drag threshold contract.
- `src/main.js` now has one `pointerSession` owner for canvas gestures and one capture/release lifecycle.
- Selection, chip/note dragging, route-point dragging, resize, box selection, pan, zoom, and wire gestures are routed through that session.
- `lostpointercapture`, `pointercancel`, window blur, and document visibility loss all use the same cancellation path.
- Hit testing is resolved once through `canvasHitTarget()` instead of being repeated in each interaction branch.
- Ordinary clicks no longer create drag mutations; movement past the threshold promotes a press into a drag.
- Input toggles are delayed just long enough for a double-click to cancel them, so double-click editing does not require an accidental first-click toggle.
- Box selection now includes annotations as well as chips.
- Canvas-level window pointer fallbacks and the old `activePointer*`/`wireGesture` pointer ownership state are removed.

The pure session tests are in `test/interaction-session.test.js`. The remaining verification gap is live browser Pointer Event smoke testing; the available environment has no browser runtime, so this should be checked manually in the running app when available.

The app does not primarily need new hit-test math or another click workaround. It now has the explicit coordinator and cleanup contract the audit called for. The next independent improvement, if needed, is adapting library/toolbar placement to emit the same placement intent rather than expanding the canvas coordinator again.

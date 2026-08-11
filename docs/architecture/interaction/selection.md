# Interaction and Selection Audit and Resolution

This document retains the evidence from the pre-refactor selection audit and
records the current implementation contract. The older findings below are
historical rationale, not a report that the same defects remain open.

## Current status — 2026-08-11

- A canvas press is represented by `state.pointerSession` and the pure
  `src/ui/pointer-session.js` contract. Movement must pass the five-pixel
  threshold before a chip, annotation, route point, resize handle, or empty
  press becomes a drag operation.
- `canvasHitTarget(world)` is the shared hit-test priority used by hover,
  pointerdown, wire editing, and context interactions. It resolves resize
  handles and wire points before pins, junctions, annotations, instances, and
  wires.
- A normal click selects without moving the object. Double-click cancels the
  pending input toggle/session before entering chip, wire, or annotation edit.
- Box selection includes root chip instances and annotations. In wire-edit
  mode the same gesture selects route points on the active wire.
- Pointer capture cleanup is centralized and also runs for lost capture,
  pointer cancellation, window blur, and document visibility loss.

The remaining gap is browser-level Pointer Event smoke coverage; the pure
session contract is covered by `test/interaction-session.test.js`.

## Historical executive summary

The screen-to-world transform is internally consistent: `canvasPoint()` uses the canvas CSS rectangle, while `WorldRenderer` stores CSS-pixel dimensions and applies device-pixel-ratio only to the drawing context. The most likely causes of unreliable interaction are higher-level ownership conflicts:

1. A normal chip click immediately enters chip-drag state and pointer capture instead of first establishing a click gesture.
2. Double-click has no single-click suppression, so the first pointer sequence can select, start a drag, and toggle an input before the double-click handler enters edit mode.
3. Pointer ownership is represented by one global pointer id, while toolbar/library drags have separate state and separate capture paths.
4. Box selection only selects chip instances; annotations are visually selectable but are not included in box selection.
5. “Wheel drag” is not a separate interaction: the wheel event zooms, while middle-button dragging pans. If wheel-drag means pressing the mouse wheel, that path exists; if it means scroll-drag, it does not.

## Historical findings before the pointer-session refactor

### P0 — Selection is coupled to immediate drag ownership

`src/main.js:2239-2248` calls `selectInstance()` and then `startDragging()` for every ordinary left click on a chip. `startDragging()` immediately calls `captureCanvasPointer()` at `src/main.js:1251-1273`.

This means selection is not a discrete click operation. It is a drag operation whose no-movement completion later acts as a click (`src/main.js:2453-2465`). Any lost `pointerup`, pointer-capture mismatch, or competing pointer path leaves the interaction feeling stuck and makes subsequent clicks unreliable.

The same coupling exists for annotations at `src/main.js:2232-2237` and route points at `src/main.js:2208-2222`.

Prioritized fix: separate gesture intent from committed drag. On pointerdown, store a pending press target; only capture and mutate positions after movement exceeds a threshold. Commit selection immediately or on pointerup according to the desired click semantics. Always resolve pending presses through one centralized pointer-finalization path.

### P0 — Single-click and double-click paths compete

The canvas registers pointer handlers at `src/main.js:2697-2704` and a separate `dblclick` handler at `src/main.js:2706-2721`.

The first click of a double-click still runs `handlePointerDown()`. For a chip this selects and starts dragging; for an input chip, `pointerup` can also toggle the input at `src/main.js:2463-2465`. The later `dblclick` then enters instance edit mode. This is a legacy-style competing interaction path and can produce selection changes, toggles, or movement before edit mode opens.

Prioritized fix: use a click/double-click gesture coordinator or defer the single-click action for the platform double-click interval. Alternatively, make `dblclick` cancel the pending click/drag before entering edit mode and prevent input toggling when the gesture is part of a double-click.

### P1 — Pointer ownership is global but interaction state is distributed

Canvas ownership is stored in `state.activePointerId` and `state.activePointerKind` (`src/main.js:128-130`, `178-198`). Canvas gestures use `captureCanvasPointer()`, while annotation-toolbar and library drags maintain independent state and capture behavior (`src/main.js:209-286`; library controller module).

The event listeners are distributed across the canvas and window (`src/main.js:2696-2747`). Canvas handlers process events targeted at the canvas; window handlers only forward events whose target is not the canvas. This works when native pointer capture behaves exactly as expected, but it creates two routing modes and makes cancellation/release behavior difficult to reason about.

Prioritized fix: define one interaction session contract with `{ pointerId, kind, phase, origin, lastWorld }`, and route all pointer move/up/cancel events through one dispatcher. Toolbar/library drag sessions should either use the same dispatcher or explicitly remain outside the canvas session domain.

### P1 — Box selection does not include annotations

Box selection starts only after no pin, junction, annotation, instance, or wire is hit (`src/main.js:2160-2176`, `2260-2275`). On completion, the instances branch at `src/main.js:2430-2435` checks only `project.root.instances` and `chipBoundingBox()`.

Annotations have bounding boxes and direct hit tests (`src/renderer.js:701-707`, `src/model.js:105-114`), but they are absent from box selection. This is a concrete capability gap and can make box selection appear inconsistent when a box visibly covers notes or labels.

Prioritized fix: include `annotationBoundingBox()` in the selection-box pass and define whether mixed chip/annotation selection is supported. Preserve additive selection semantics.

### P1 — Hit-test precedence intentionally hides lower layers

Pointerdown precedence is pin, junction, annotation, instance, then wire (`src/main.js:2160-2176`). Hover uses the same ordering at `src/main.js:2289-2304`.

This is coherent for wiring, but it means a pin always wins over its containing chip and a junction always wins over a nearby wire. A wire crossing or ending close to a pin cannot be selected until the user moves away from the pin. This may be correct for wire creation but is not a neutral selection policy.

Prioritized fix: make precedence tool-dependent. In Select mode, use an explicit narrow-pin priority only when the cursor is within a pin hit radius; otherwise allow the wire/chip layer. In Wire mode, retain pin/junction priority.

### P1 — Wire hit testing is segment-based but not endpoint-aware in Select mode

`findWire()` tests every rendered segment with a fixed world threshold converted by zoom (`src/renderer.js:721-727`). `handlePointerDown()` checks wires after pins, junctions, annotations, and instances (`src/main.js:2250-2258`).

This is mathematically sound, but route endpoints and nearby wires can be difficult to select because pins/junctions win first. The behavior should be documented as a deliberate priority or changed to return the closest candidate rather than the first category match.

### P2 — Screen/world transforms are not the primary defect

`canvasPoint()` is at `src/main.js:2104-2107`. `WorldRenderer.toWorld()` and `toScreen()` are at `src/renderer.js:120-126`. Canvas CSS dimensions are recorded in `resize()` at `src/renderer.js:110-117`; the drawing context alone is scaled by `dpr` at `src/renderer.js:160`.

This is a correct arrangement: pointer coordinates are CSS pixels and camera calculations also use CSS pixels. No double-DPR or rect-offset error was found.

One maintainability improvement remains: centralize `canvasPoint()` and the renderer transform API so hit tests and event code cannot accidentally use different coordinate conventions later.

### P2 — Bounding-box geometry is consistent but has a deliberate visual/hit difference

`chipBoundingBox()` uses `chipBoundsSize()` and swaps dimensions for quarter-turn rotations (`src/model.js:254-270`). `findInstance()` uses this box with a 3-world-unit padding (`src/renderer.js:693-699`). Rendering still uses the descriptor's visual `size` for the shape (`src/renderer.js:480-516`).

This is the intended minimum bounding-box behavior for narrow chips, but it means the clickable area can extend beyond the visible triangle/body. Pins are tested first, so pin interaction remains available. The design should be treated as an explicit interaction bounds contract, not an accidental mismatch.

Annotation bounds are normalized in `src/model.js:105-114` and directly tested in `src/renderer.js:701-707`; resize handles are tested separately at `src/renderer.js:709-718`.

### P2 — CSS does not appear to block the canvas globally

The canvas and wrapper use `touch-action: none` at `src/styles.css:87-90`, which is appropriate for custom pointer gestures. The top toolbar is `pointer-events: none` with interactive children re-enabled at `src/styles.css:236-241`; the viewed banner is intentionally interactive at `src/styles.css:261-264`; bottom bars and panels are intentionally above the canvas (`src/styles.css:265-269`, `289-310`).

No broad `pointer-events: none` rule was found that would disable the canvas. Clicks in toolbar, status, bottom-bar, banner, or drawer regions are expected not to reach the canvas because those controls own those regions.

### P2 — Wheel and pan semantics are separate

The wheel listener at `src/main.js:2722-2729` always prevents default and zooms around the cursor. Middle-button pointerdown pans at `src/main.js:2165-2170`, with camera movement in `src/main.js:2312-2316`.

Therefore “wheel drag” must mean middle-button drag for the current implementation. If users expect pressing and dragging the wheel to pan, the implementation is present. If they expect a wheel/scroll gesture to pan, that behavior is missing by design.

## Original recommended implementation order

1. Introduce a single pointer-session dispatcher and make cancellation/release idempotent.
2. Split pending click from committed drag; capture only after movement threshold.
3. Coordinate single-click and double-click so input toggles and drag do not fire before edit mode.
4. Add annotations to box selection and add tests for mixed selection.
5. Make hit-test priority tool-dependent and test pin/wire/junction overlap cases.
6. Add interaction tests covering click, click-drag, empty-canvas box selection, middle-button pan, wheel zoom, pointer leaving the canvas, pointer cancel, and double-click.

## Audit boundary and resolution

The original report was read-only with respect to application source. The
resolution described above was implemented afterward in `src/main.js` and
`src/ui/pointer-session.js`; the current source and tests are authoritative if
this historical evidence diverges from a later browser behavior change.

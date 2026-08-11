# Pan and Zoom Interaction Audit and Resolution

This document retains the evidence from the pre-refactor pan/zoom audit and
records the current implementation contract. The older findings below are
historical rationale, not a report that the same defects remain open.

## Current status — 2026-08-11

- Middle-button and Alt+left pan are recognized before canvas object
  hit-testing, so either gesture can begin over a chip, wire, pin, note, or
  empty canvas.
- Alt+right zoom owns a pointer session and clears its context-menu
  suppression flag when the gesture ends or is cancelled. Wheel zoom remains
  cursor-anchored.
- Canvas movement and release use native pointer capture through the shared
  `pointerSession`; the window-level pointer listeners are reserved for
  library/annotation placement completion rather than forwarding canvas
  movement.
- Lost capture, `pointercancel`, window blur, and document visibility loss all
  cancel the active canvas session and restore any provisional movement.
- `touch-action: none` remains an intentional single-pointer canvas contract;
  pinch zoom and multi-touch navigation are not implemented.

The remaining gap is live browser smoke testing for Pointer Events and the
overlay boundaries.

## Historical executive summary

The primary interaction defect is a real routing conflict, not a missing browser event:

- Alt+left pan is only started when the pointer is over empty canvas. Starting it over a chip, wire, pin, junction, note, or label is deliberately sent to that object’s selection/wiring path instead. This explains why pan feels unavailable in common canvas locations.
- Pointer capture is implemented together with window-level pointer fallbacks. The two mechanisms overlap and make ownership harder to reason about, especially because library and annotation drags use their own element-level capture.
- Alt+right zoom drag depends on a context-menu suppression flag that is only cleared by a later `contextmenu` event. If the browser does not dispatch that event, the next ordinary right-click can be incorrectly suppressed.
- Pointer cancellation is handled, but there is no explicit `window.blur` or `visibilitychange` cleanup for a pointer that disappears during a browser/window transition.
- `touch-action: none` is correctly preventing browser scrolling, but the application has no multi-touch/pinch policy. Touch input is therefore treated as ordinary primary-pointer canvas interaction rather than as a deliberate navigation gesture.

## Historical interaction topology

### Canvas event entry points

`src/main.js:2696-2729` registers `contextmenu`, `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerleave`, `dblclick`, and `wheel` directly on `canvas`.

`src/main.js:2730-2747` also registers window-level `pointermove`, `pointerup`, and `pointercancel` listeners. These are used as a fallback when the event target is no longer the canvas.

### Camera operations

`src/renderer.js:121-130` converts screen/world coordinates and applies anchored zoom through `zoomAt`.

`src/main.js:2165-2169` starts pan and `src/main.js:2312-2317` applies pan deltas.

`src/main.js:2142-2146` starts Alt+right zoom drag and `src/main.js:2305-2310` applies its vertical-drag zoom deltas.

`src/main.js:2722-2729` handles wheel zoom and calls `renderer.zoomAt` around the cursor.

## Historical findings before the pointer-session refactor

### P0 — Alt+left pan is blocked over every existing object

At `src/main.js:2160-2165`, the code first computes `pointerTarget` by testing pin, junction, annotation, instance, and wire. At `src/main.js:2165`, Alt+left pan starts only when `!pointerTarget`:

`event.button === 1 || event.altKey && event.button === 0 && !pointerTarget`

Consequences:

- Alt+left works over empty canvas.
- Alt+left does not pan when started over a chip, wire, pin, junction, note, or label.
- The same gesture is then interpreted as object selection, dragging, wire initiation, or route editing.

This is the clearest explanation for the reported inability to pan reliably. It is a competing interaction policy, not a browser limitation. If Alt+left is intended as a global navigation gesture, it should be recognized before object hit-testing or be allowed regardless of `pointerTarget`.

### P1 — Right-button zoom can leave stale context-menu suppression

Alt+right zoom sets `state.suppressContextMenu = true` at `src/main.js:2142-2145`.

The flag is cleared only in the early branch of `showContextMenu` at `src/main.js:2057-2061`. Therefore the lifecycle depends on a subsequent `contextmenu` event arriving after the gesture. If a browser, OS, pointer-capture transition, or cancellation path omits that event, the next normal right-click can enter `showContextMenu`, consume the stale flag, and fail to open its menu.

The zoom cleanup at `src/main.js:2360` clears `state.zoomDrag` but does not clear `state.suppressContextMenu`. The flag should be owned by the zoom gesture and cleared when zoom ends or is cancelled, not only by the context-menu handler.

### P1 — Two pointer-ownership systems are active

Canvas gestures use `captureCanvasPointer` at `src/main.js:178-183`, which calls `canvas.setPointerCapture`. Releases are centralized by `releaseCanvasPointer` at `src/main.js:185-194`.

At the same time, window listeners at `src/main.js:2733-2747` manually forward outside-target pointer events to the canvas handlers. This is redundant when pointer capture works, because captured events are delivered to the capturing canvas. It is also a second ownership mechanism with different conditions:

- canvas handlers use `ownsCanvasPointer`, `src/main.js:196-198`;
- window fallback handlers require `event.target !== canvas` and matching `state.activePointerId`, `src/main.js:2734-2739`;
- library and annotation toolbar drags use element-level capture independently, `src/ui/library-controller.js:111-124` and `src/main.js:209-222`.

The current behavior can work, but the implementation is difficult to audit and easy to break when an overlay or browser changes event targeting. A single gesture owner and one capture strategy would make release behavior more predictable.

### P1 — No explicit window-loss cleanup

`pointercancel` is handled on both canvas and window (`src/main.js:2700-2704`, `src/main.js:2741-2747`), and `cancelTransientInteraction` clears pan/zoom and releases the canvas pointer (`src/main.js:1031-1053`).

There is no `window.blur`, `document.visibilitychange`, or equivalent emergency cleanup. If the browser loses the pointer while the window changes focus and emits neither a usable `pointerup` nor `pointercancel`, `state.activePointerId`, `state.pan`, or `state.zoomDrag` can remain active. The next pointer may then be rejected by `src/main.js:2110` because another pointer is still considered active.

This is an edge case, but it directly affects the “stuck” interaction symptom and is worth treating as a lifecycle boundary.

### P2 — Touch navigation has no defined gesture model

Both `.canvas-wrap` and `#world` use `touch-action: none` at `src/styles.css:87-88`. This correctly prevents native page scrolling and browser gesture takeover.

However, `handlePointerDown` treats touch like a normal left-button pointer. There is no `pointerType` branch, active-touch count, pinch-distance state, or two-finger pan/zoom behavior. As a result:

- one-finger touch begins selection, dragging, or wiring;
- a second touch is rejected by `src/main.js:2110` while another pointer is active;
- pinch zoom is not implemented;
- the CSS disables browser fallback navigation without providing an application replacement.

If touch is not a supported target, the current CSS is overbroad. If touch is supported, the navigation contract is incomplete.

### P2 — Wheel handling is globally consuming and has one ordering smell

At `src/main.js:2722-2729`, wheel always calls `event.preventDefault()` before checking `if (state.placement && event.shiftKey) return`.

That means Shift+wheel during placement is intentionally ignored by the app but still prevents native scrolling. This may be correct for a canvas-first application, but it should be an explicit policy rather than an accidental ordering result.

Wheel zoom is otherwise correctly anchored to the cursor through `canvasPoint` and `renderer.zoomAt`. It is only registered on the canvas, so wheel input over panels or bottom controls is not intercepted by this handler.

### P2 — Overlay hit-testing is intentional but scattered

The canvas wrapper and world both accept no native touch action (`src/styles.css:87-88`). The canvas toolbar uses `pointer-events: none` on its shell but re-enables events on selected children at `src/styles.css:375-399`, `src/styles.css:417`, and `src/styles.css:432-453`.

Other overlays sit above the world:

- viewed/internal-navigation banner: `src/styles.css:261-264`, z-index 4;
- toolbar controls: `src/styles.css:375-453`, z-index 4 for the vertical tool group;
- library and inspector: `src/styles.css:265-269`, z-index 12;
- bottom bar: `src/styles.css:289`, z-index 15;
- popups: `src/styles.css:302-310`, z-index 16;
- context menu: `src/styles.css:191`, z-index 30;
- help modal: `src/styles.css:198`, z-index 40.

`isCanvasInteractionBlocked` only blocks the canvas while Help is open (`src/main.js:296-298`). Other overlays prevent canvas events through DOM hit-testing instead. That split is valid, but it means debugging “canvas did not receive the click” requires inspecting both state gates and CSS stacking/pointer-events.

### P3 — Pointer-cancel cleanup is broad

`cancelTransientInteraction` at `src/main.js:1031-1059` cancels pan/zoom, placement, wire start, wire edit, selection, and clears all selection state. It is used for pointer cancellation at `src/main.js:2700-2703` and `src/main.js:2741-2747`.

This guarantees cleanup, but a cancellation of one gesture can also exit wire edit and clear selections. That is safe against stuck state but broad in scope. A future interaction refactor should separate “release this pointer gesture” from “cancel the entire editing mode.”

### P3 — Pointer capture is not acquired for every pointer path

Capture is acquired for pan, zoom, selection-box, chip drag, annotation drag/resize, wire drag, and route-point drag through the functions referenced above. A simple click selection does not capture, which is fine because it completes on `pointerdown`/`pointerup` without movement.

Wire-start clicks and pin-to-pin gestures have their own `wireGesture` state (`src/main.js:2181-2183`, `src/main.js:2373-2393`). The distinction between `wireGesture`, `wireStart`, and `activePointerId` is another state split that should be documented or consolidated if interaction work continues.

## Original recommended repair order

1. Move global navigation recognition ahead of object hit-testing, or remove the `!pointerTarget` requirement for Alt+left pan. Preserve an explicit exception only where an object has a deliberate Alt gesture.
2. Make zoom/pan gesture cleanup clear all gesture-local flags, including `suppressContextMenu`, on pointerup, pointercancel, blur, and visibility loss.
3. Choose one primary outside-canvas strategy: prefer Pointer Events capture for canvas gestures, retaining only a narrowly scoped emergency fallback if browser support requires it.
4. Add a single `cancelActivePointerGesture()` lifecycle hook for `pointercancel`, `blur`, and `visibilitychange`, separate from the broader editor-mode cancellation.
5. Decide and document the touch contract: either support one-/two-finger navigation explicitly or allow native touch behavior instead of disabling it on the entire canvas.
6. Add interaction tests around gesture priority and cleanup: Alt+left over each object type, middle drag leaving the canvas, Alt+right followed by ordinary right-click, window blur during pan, and two simultaneous pointers.

## Historical overall assessment

The camera math is small and coherent. The main maintainability problem is interaction arbitration: hit-testing, gesture priority, pointer capture, window fallbacks, overlay DOM boundaries, and editor-mode cancellation are distributed across several paths. The app is not missing basic pan/zoom primitives; it is allowing object tools and navigation tools to compete, with cleanup split between gesture state and global editor cancellation.

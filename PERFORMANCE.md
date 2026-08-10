# Browser performance roadmap

Status: reconciled performance plan

Baseline checkpoint: `72d8969` (`Checkpoint nested X-ray signal tracing`)

This is a practical performance plan for the vanilla browser application. It
keeps the current interaction model, simulation behavior, X-ray traceability,
and bake/scrub contract intact. It does not propose a framework migration or a
general-purpose rendering engine.

## Executive diagnosis

The initial payload is already reasonable for this project. The current
production build is approximately:

| Asset | Raw size | Approx. Brotli |
| --- | ---: | ---: |
| JavaScript | 164 KB | 40.5 KB |
| CSS | 38 KB | 6.6 KB |
| HTML | 24 KB | 4.2 KB |
| Core initial payload | 226 KB | about 51 KB |

The main browser cost is repeated work on the main thread:

```text
pointer/simulation change
  -> full application render
  -> full canvas redraw
  -> inspector and status DOM work
  -> global icon scan
```

The simulation has a second scaling cost:

```text
one step
  -> repeated whole-network settling
  -> recursive composite evaluation
  -> full nested snapshot collection
  -> visual-signature allocation and serialization
```

The most valuable first boundary is therefore a small render coordinator,
followed by contained simulation hot-path improvements.

## Current evidence

The read-only reviews identified these repeated costs:

- `main.js` has many direct `render()` call sites. Pointer movement, wheel
  zoom, dragging, wire routing, simulation steps, and hover changes can all
  redraw synchronously.
- `render()` combines canvas drawing, inspector regeneration, simulation
  controls, status updates, help metadata, and icon hydration.
- `refreshIcons()` performs a global Lucide scan even when only the canvas
  changed.
- Hit testing scans pins, junctions, annotations, instances, wires, and every
  wire segment. Geometry is rebuilt for both hit testing and drawing.
- The renderer draws all root objects whether they are inside the viewport or
  not. X-ray has depth and count limits, but nested geometry is still rebuilt
  each frame.
- `settleNetwork()` may run up to 32 passes and compares full runtime signal
  strings on each pass.
- Every simulation step creates a full nested snapshot. The current bake cap is
  a frame-count cap, not a memory cap.
- The visual signature scans, sorts, copies display arrays, and serializes
  nested signal state on every recorded step.

Exploratory local measurements varied with machine and test setup, but showed
the important scale:

| Circuit | Approx. step time range |
| --- | ---: |
| Basic ALU | 5–6 ms |
| Tiny hex display | 7–9 ms |
| Sophisticated ALU | 25–36 ms |

A sophisticated ALU snapshot was approximately 57 KB serialized. A 512-frame
bake was estimated at roughly 29 MB serialized and about 85 MB of JavaScript
heap in one measurement. These numbers are baselines to validate with a
repeatable harness, not permanent guarantees.

## Performance principles

1. Measure before introducing a complex optimization.
2. Coalesce work at the browser frame boundary.
3. Keep immutable topology separate from mutable simulation state.
4. Cache world geometry, not camera-dependent screen geometry.
5. Reuse one source of truth for drawing, hit testing, and placement checks.
6. Keep signal values dynamic in X-ray; cache only its structure and geometry.
7. Preserve full nested state at the bake boundary until memory measurements
   justify a more complex representation.
8. Prefer bounded, understandable strategies over invisible throttling or
   behavior-changing shortcuts.

## Target runtime shape

The intended flow is:

```text
domain/editor mutation
  -> invalidation flags
  -> one scheduled animation frame
  -> canvas lane + only affected UI lanes

simulation clock
  -> advance mutable runtime
  -> record bake/checkpoint data
  -> publish latest visual state
  -> scheduled animation frame
```

The simulation clock must not wait for a full DOM render, and the DOM must not
be rebuilt merely because the pointer moved over the canvas.

## Prioritized implementation waves

### Wave 0 — measurement harness

Add development-only timing and memory diagnostics before changing the hot
paths. Instrument:

- `render()` total time;
- `renderer.draw()` time;
- hit-test time;
- inspector and status-lane time;
- icon refresh time;
- `Simulator.step()` time;
- settle-pass count and maximum;
- nested evaluation count and depth;
- snapshot collection, clone, and restore time;
- signature generation time;
- bake frame count and estimated memory;
- scheduled versus completed renders.

Use `performance.mark()`/`performance.measure()` behind a development flag so
production does not pay for verbose instrumentation.

Profile these scenarios at normal speed and with roughly 4x CPU throttling:

- empty project and basic gates;
- full adder;
- basic ALU;
- sophisticated ALU;
- tiny hex display;
- deep nested X-ray;
- continuous pan, zoom, box select, wire routing, and scrubber movement;
- a long bake approaching the frame cap.

Record p50, p95, worst frame, JavaScript heap growth, and visible-versus-total
object counts. Keep one repeatable benchmark script for simulation timing and
one browser trace checklist for interaction timing.

### Wave 1 — frame scheduling and targeted UI updates

Highest return and lowest risk.

1. Add a small render scheduler with `requestAnimationFrame` and a pending
   flag. Mutations request a frame; they do not synchronously render multiple
   times in one browser turn.
2. Split the current render operation into lanes:

   - canvas;
   - transient canvas status/coordinates;
   - inspector;
   - simulation controls;
   - library and modal metadata.

3. Give each lane an invalidation condition. Pointer motion should normally
   update the canvas and coordinate readout, not rebuild the inspector,
   library, Help metadata, and every toolbar icon.
4. Let the simulation timer advance state and record its bake independently;
   the next animation frame paints the latest state.
5. Replace the current interval behavior with a guarded/self-scheduling clock
   if measurements show callbacks can queue behind expensive steps. Never let
   a slower step create overlapping simulation runs.
6. Refresh Lucide icons only after a subtree’s markup changes. Initialize
   static icons once and scope refreshes to newly inserted dynamic regions.
7. Cache the canvas `getBoundingClientRect()` through the existing resize
   boundary instead of reading layout on every pointer event.

Acceptance criteria:

- at most one scheduled canvas render per animation frame;
- no global icon refresh during ordinary hover, pan, or simulation paint;
- focused inspector fields remain stable;
- bake frame order and scrub behavior are unchanged;
- no interaction task over 50 ms in the normal benchmark set.

### Wave 2 — reusable geometry and viewport work

Do this after Wave 1 so measurements distinguish scheduling gains from geometry
gains.

Create a derived world-geometry cache, either inside `WorldRenderer` first or
as a small focused module later. Share it across:

- canvas drawing;
- instance/pin/annotation hit testing;
- wire hit testing;
- selection-box checks;
- placement validity checks.

Cache:

- descriptor lookup by chip name;
- instance bounds and pin world positions;
- annotation bounds;
- wire point arrays and segment bounds;
- stable caption layout where text and dimensions are unchanged.

Cache keys should include the active root/view and project revision. Invalidate
only after a relevant topology, position, rotation, route, annotation, or
custom-chip-definition change. Do not cache screen coordinates.

Then add:

1. A padded world-space viewport check for root instances, annotations,
   junctions, and wires.
2. Broad-phase wire/instance bounds before exact segment-distance tests.
3. A simple uniform spatial grid only when object counts or measured hit-test
   time justify it. A general tree is unnecessary at this stage.
4. Two batched grid paths (regular and highlighted) before considering a
   separate offscreen grid layer.

During active panning, hover hit testing can be skipped when no interaction
depends on it. During an active drag, retain only the hit tests required for
validity and selection behavior.

Acceptance criteria:

- cached and uncached geometry produce identical hit targets;
- offscreen objects remain selectable after entering the viewport;
- route-point, pin, wire, and multi-selection behavior is unchanged;
- heap growth stabilizes during continuous pan;
- large-circuit frame time improves without changing visual output.

### Wave 3 — bounded X-ray geometry

Keep the existing safety limits:

- maximum depth: 3;
- maximum instances: 160;
- maximum wires: 240.

Precompute a per-description X-ray render tree containing immutable structure:

- nested child identity and scope path;
- local transforms;
- wire point geometry;
- pin positions;
- chip bounds and clipping frames;
- optional caption layout.

Keep signal lookup, activation colors, and baked state dynamic per frame. This
is required for live simulation and scrubbed X-ray frames. A geometry cache must
never cache signal values.

Cull nested descendants outside the current composite frame or viewport. Do
not add a second X-ray simulation or a second bake representation.

Acceptance criteria:

- live X-ray activations remain correct;
- baked/scrubbed nested activations remain correct;
- repeated custom-chip instances do not share signal state accidentally;
- enabling X-ray stays bounded and has a measured activation cost.

### Wave 4 — simulation hot path

This is the deeper algorithmic work and should follow measurement plus the
renderer waves.

1. Replace `snapshotRuntimeSignals()` string creation in settle convergence
   checks with a direct mutation/change counter. Preserve the 32-pass safety
   limit and add diagnostics when it is reached.
2. Compile immutable runtime topology once per project revision:

   - pin lookup maps;
   - interface binding maps;
   - resolved wire source/target accessors;
   - child runtime construction metadata;
   - stable endpoint ordering.

   Runtime signal and memory values must remain per placed instance.
3. Avoid repeated descriptor and pin-array searches in the evaluation loop.
4. Ensure side effects such as buzzer/audio notes are emitted only in the
   committed simulation pass, not during speculative settling.
5. Measure and consolidate redundant `syncProject()` followed immediately by
   `reset()` calls without weakening reset semantics.
6. Keep the current full-settle fallback for unusual cyclic or unsupported
   circuits until a dependency-based evaluator is proven equivalent.

Do not begin with a full dirty-graph or strongly-connected-component rewrite.
That is a later option if compiled topology and change tracking do not meet the
measured budget.

Acceptance criteria:

- all existing simulator and project tests remain green;
- settle results and macro-step detection are unchanged;
- sequential device state and audio behavior remain correct;
- sophisticated composite step time improves in repeatable benchmarks;
- no extra simulation path is introduced for X-ray.

### Wave 5 — bake memory and restore policy

First add diagnostics and a byte-oriented budget to `SimulationBake` while
keeping its public frame/cursor API stable. Measure actual snapshot sizes before
enforcing an aggressive limit.

Conservative order:

1. Make bake-frame ownership explicit and avoid unnecessary defensive cloning
   during internal restore when the frame is already immutable to the UI.
2. Estimate frame bytes and report bake memory in development diagnostics.
3. Preserve the first frame and the current/latest frame when pruning by a
   memory budget.
4. Only if measurements justify it, add periodic full keyframes plus compact
   deltas inside `SimulationBake`.
5. Keep `frameAt`, `setCursor`, `restore`, macro navigation, and scrubber
   semantics unchanged.

Nested scopes must remain available in frames because X-ray is a supported
   view. Do not default to root-only trace data and silently show incomplete
   internals. A future trace policy may be considered only with an explicit
   re-bake state and clear UI semantics.

Acceptance criteria:

- scrubber restoration is deterministic;
- branching after a scrub still truncates future history correctly;
- X-ray sees the same nested activations before and after restore;
- bake memory is bounded by a measured policy rather than an arbitrary hidden
  truncation.

## Delivery and bundle policy

The current core payload does not justify a bundler rewrite. Keep Vite and the
static GitHub Pages distribution.

Later, if startup traces show value:

- bundle only the required Lucide icons so Pages is fully self-contained;
- retain hashed Vite assets and explicit cache headers where hosting allows;
- content-version example JSON assets if stale browser caching becomes a real
  issue;
- enforce soft size budgets in the build/CI path.

Initial soft budgets:

- Brotli JavaScript: 60 KB;
- Brotli CSS: 10 KB;
- core initial Brotli payload: 75 KB;
- normal interaction p95: under 16.7 ms;
- 4x throttled interaction p95: under 33 ms;
- X-ray activation: under 100 ms for the bounded reference fixture;
- no ordinary editing task above 50 ms.

These are guardrails for regression detection, not reasons to add premature
compression or to sacrifice clarity.

## Deliberately deferred work

Do not do these as the first optimization wave:

- framework migration;
- Web Worker simulation;
- dirty-region canvas rendering;
- a general-purpose scene graph;
- delta/compressed snapshots without memory evidence;
- advanced spatial trees;
- root-only simulation traces that weaken X-ray bake compatibility;
- broad refactoring of the domain model and renderer at the same time.

They may become appropriate after the simpler boundaries and measurements are
in place, but they are not necessary to make the current application feel
performant and coherent.

## Definition of done for the performance initiative

The initiative is successful when:

1. interaction changes are coalesced into frame-paced rendering;
2. unrelated DOM and icon work is not performed during canvas motion;
3. drawing and hit testing share cached world geometry;
4. offscreen and nested work is bounded and measurable;
5. simulation settling no longer serializes the whole runtime on every pass;
6. bake memory and restore time are observable and bounded;
7. X-ray live and baked nested activations remain correct;
8. the full regression suite and static production build remain green.

The intended result is a faster version of the same simple architecture, not a
more complicated product hidden behind performance machinery.

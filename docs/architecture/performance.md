# Browser performance roadmap

Status: reconciled performance plan

Baseline checkpoint: `72d8969` (`Checkpoint nested X-ray signal tracing`)

## Implementation status

The first implementation pass is now in place without changing the editor or
simulation contracts:

- Wave 0: opt-in diagnostics are available with `?perf=1` or
  `globalThis.__DLS_PERF__ = true`; the report is exposed as
  `globalThis.__DLS_PERF_REPORT__()`.
- Wave 1: pointer and simulation paints are coalesced at the animation-frame
  boundary; canvas/simulation paints no longer rebuild inspector, Help, or
  global icons; canvas bounds are reused between layout changes.
- Wave 2: shared world geometry covers root instances, pins, annotations,
  junctions, and wires for drawing and hit testing, with viewport culling and
  wire broad-phase checks.
- Wave 3: X-ray definitions reuse cached nested geometry while signal lookup
  and activation colours remain dynamic. There is no fixed visual-depth cutoff;
  cycle detection and per-level instance/wire budgets bound the projection.
- Wave 4: settle convergence uses output change counters instead of building
  and serializing a complete runtime signal string on every pass. Simulator
  diagnostics expose evaluation count, settle passes, depth, and safety-limit
  hits.
- Wave 5: bake frames carry estimated memory ownership and a conservative byte
  budget while preserving the first and current/latest checkpoints.
- Latest bake pass: the simulation clock uses a guarded self-scheduling timer,
  so a slow step cannot accumulate interval callbacks; it preserves the target
  cadence by subtracting the completed step time from the next delay. Visual
  signature topology is cached for the active project, and simulator
  diagnostics are computed lazily only when the opt-in report reads them.

Periodic full keyframes/deltas, a spatial index, compiled dependency topology,
and more aggressive snapshot compression remain deliberately deferred until
the opt-in report demonstrates that they are needed.

This is a practical performance plan for the vanilla browser application. It
keeps the current interaction model, simulation behavior, X-ray traceability,
and bake/scrub contract intact. It does not propose a framework migration or a
general-purpose rendering engine.

## Executive diagnosis

The initial payload is already reasonable for this project. The production
build checked on 2026-08-11 reports:

| Asset | Raw size | Gzip |
| --- | ---: | ---: |
| JavaScript | 205.52 KB | 59.94 KB |
| CSS | 39.38 KB | 7.81 KB |
| HTML | 23.85 KB | 5.06 KB |
| Core initial payload | 268.75 KB | 72.81 KB |

The remaining browser cost is concentrated in repeated work on the main
thread. Ordinary pointer and simulation paints now use a scheduled canvas lane;
full command renders still follow this broader path:

```text
full command mutation
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

The render coordinator and contained simulation improvements are now the
current baseline. The next valuable work is measured topology compilation or
snapshot compression only if the opt-in report shows that the remaining costs
justify their complexity.

## Current evidence

The read-only reviews identified these repeated costs. The first implementation
wave now addresses the marked geometry/settling issues; the remaining costs are
kept here so future measurements have an explicit baseline:

- `main.js` still has many direct full-render call sites for commands. Pointer
  movement, wheel zoom, dragging, wire routing, simulation steps, and hover
  changes use the scheduler where they only need canvas/status updates.
- `render()` combines canvas drawing, inspector regeneration, simulation
  controls, status updates, help metadata, and icon hydration.
- Full renders still perform a global Lucide scan; targeted canvas/simulation
  lanes avoid icon work when only the canvas changed.
- Hit testing still scans pins, junctions, annotations, instances, wires, and
  route segments, but it now reuses cached world geometry and wire broad-phase
  bounds rather than rebuilding the geometry for every query.
- Root drawing now uses viewport culling. X-ray has per-level instance/wire
  budgets and a cycle guard; nested geometry is reused where the cache applies.
- `settleNetwork()` still has a 32-pass safety limit, but convergence now uses
  output-change counters instead of serializing the complete runtime signal
  state on every pass.
- Every simulation step creates a full nested snapshot. The bake now has both
  frame-count and estimated-byte caps; the byte estimate is conservative and
  remains a candidate for better measurement if long histories become common.
- The visual signature scans, sorts, copies display arrays, and serializes
  nested signal state on every recorded step.
- Official bake recording also produces one bounded aggregate trace event per
  engine tick. Its change summary is capped to a small number of signal/display
  entries, while propagation and settle diagnostics are counters from the
  simulator rather than a per-wire callback stream.

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
  -> record bake trace + checkpoint data
  -> publish latest visual state
  -> scheduled animation frame
```

The simulation clock must not wait for a full DOM render, and the DOM must not
be rebuilt merely because the pointer moved over the canvas.

## Prioritized implementation waves

### Wave 0 — implemented measurement harness

The development-only timing and memory diagnostics are available behind
`?perf=1` or `globalThis.__DLS_PERF__ = true`. They instrument:

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
- bake interaction count, trace event count, and trace memory;
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

### Wave 1 — implemented frame scheduling and targeted UI updates

This is the current low-risk scheduling boundary.

1. `createRenderScheduler` coalesces requests with `requestAnimationFrame`
   (and a timer fallback outside a browser). Mutations request a frame instead
   of synchronously rendering multiple canvas updates in one turn.
2. The render operation has lanes for:

   - canvas;
   - transient canvas status/coordinates;
   - inspector;
   - simulation controls;
   - library and modal metadata.

3. Each lane has an invalidation condition. Pointer motion normally updates
   the canvas and coordinate readout, not the inspector, library, Help
   metadata, or every toolbar icon.
4. The simulation timer advances state and records its bake independently; the
   next animation frame paints the latest state.
5. The clock is a guarded, self-scheduling timeout. A slow step cannot queue
   overlapping simulation runs; the next delay subtracts completed step time
   from the target cadence.
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

### Wave 2 — implemented reusable geometry and viewport work

The renderer now derives a world-geometry cache after Wave 1 so scheduling and
geometry gains remain separately measurable. It is shared across:


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

Cache keys include the active root/view and project revision. Invalidate only
after a relevant topology, position, rotation, route, annotation, or
custom-chip-definition change. Screen coordinates are never cached.

The implementation includes:

1. A padded world-space viewport check for root instances, annotations,
   junctions, and wires.
2. Broad-phase wire/instance bounds before exact segment-distance tests.
3. No general spatial tree or uniform grid yet; the simple broad-phase is the
   current measured boundary.
4. Batched regular and highlighted grid paths without a separate offscreen
   layer.

During active panning, hover hit testing can be skipped when no interaction
depends on it. During an active drag, retain only the hit tests required for
validity and selection behavior.

Acceptance criteria:

- cached and uncached geometry produce identical hit targets;
- offscreen objects remain selectable after entering the viewport;
- route-point, pin, wire, and multi-selection behavior is unchanged;
- heap growth stabilizes during continuous pan;
- large-circuit frame time improves without changing visual output.

### Wave 3 — implemented bounded X-ray geometry

Keep the existing safety limits:

- maximum instances: 160;
- maximum wires: 240.

There is no fixed maximum nesting depth. The cycle guard stops recursive chip
identity paths, while the per-level budgets prevent a single large definition
from overwhelming the canvas.

The renderer caches/reuses per-description geometry where possible. The
projected structure contains:

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

### Wave 4 — partially implemented simulation hot path

The convergence part is implemented and the remaining topology work should
follow measurement plus the renderer waves.

1. Implemented: settle convergence uses a direct output-change counter,
   preserves the 32-pass safety limit, and exposes diagnostics when it is
   reached.
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

### Wave 5 — implemented bake memory and restore policy

`SimulationBake` now has an estimated byte budget while keeping its public
frame/cursor API stable. The estimate is a conservative diagnostic and pruning
signal, not a claim about exact JavaScript heap usage.

The implementation order is:

1. Bake frames carry estimated ownership and avoid unnecessary defensive cloning
   during internal restore when the frame is already immutable to the UI.
2. Estimate frame bytes and report bake memory in development diagnostics.
3. Preserve the first frame and the current/latest frame when pruning by a
   memory budget.
4. Periodic full keyframes plus compact deltas remain deferred until measured
   memory pressure justifies the added representation.
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

# Recording mechanism architecture

This document is the implementation deep dive for the simulator's recording
mechanism. The shorter [simulation bake contract](simulation-bake.md) explains
the user-facing behavior; this note follows the data and control flow through
the simulator, controller, preview branch, and history stores.

Status: current implementation in `src/`.

## The principal model

Recording means: take the circuit from evaluated step zero, advance the
official simulator one tick at a time, keep the complete simulator state for
exact restoration, and expose only meaningful visual changes as the compact
history rail. Two side rails explain the official run: semantic actions tell
us what the user did, and an engine trace tells us what each official tick
changed or cost.

The flow is therefore:

`user intent -> official simulator tick -> full snapshot + bounded trace ->
sparse checkpoint rail -> restore/render`

The important boundary is that the interaction rail and engine trace are
diagnostic history. They do not replay the circuit. The full simulator
snapshot is the authority used to restore a state; the simulator itself is the
only thing that executes circuit behavior.

## Terminology

- **Record** is the idle UI label. The implementation and architecture docs
  call the resulting session a **bake**.
- An **official tick** is one call to `Simulator.step()` made by the
  simulation controller for a bake or manual Step. Internal settle passes are
  not separate official ticks.
- A **frame** is a complete snapshot plus metadata for one simulator step.
- A **checkpoint** is a frame retained on the visible history rail. A frame
  can be an exact execution frame without becoming a checkpoint when its
  meaningful visual signature did not change.
- The **execution head** is the exact current simulator frame, including a
  hidden tick. The **cursor** is the selected index on the checkpoint rail.
- A **preview** is a cloned, short-lived simulator branch used for immediate
  input/key feedback. It is not a bake and never writes official history.

## Ownership map

| Layer | Implementation | Owns | Does not own |
| --- | --- | --- | --- |
| Circuit execution | [`simulation.js`](../../src/simulation.js) | Signal algebra, recursive runtime, stateful devices, step count, snapshots, restore | UI controls, history pruning, preview lifetime |
| Bake history | [`simulation-timeline.js`](../../src/simulation-timeline.js) | Empty/baking/ready lifecycle, checkpoint rail, execution head, interactions, stability counters, pruning | Circuit evaluation |
| Engine diagnostics | [`simulation-trace.js`](../../src/simulation-trace.js) | One normalized event per official tick, bounded change summaries, propagation diagnostics | Exact restoration or replay |
| Browser lifecycle | [`simulation-controller.js`](../../src/simulation-controller.js) | Start/stop/clear, Step, timer, scrub, branching, preview transitions, status | DOM structure and canvas drawing |
| Causal feedback | [`simulation-preview.js`](../../src/simulation-preview.js) | Cloned project/simulator, short preview run, preview stability/limit | Official bake frames and trace |
| DOM/editor shell | `main.js` | Event binding, project edits, input/key mutations, rendering callbacks, persistence calls | Core simulator transitions |

## The bake state machine

The runtime state is held by `SimulationBake.status`:

- **`empty`**: the official simulator has an evaluated step-zero state, but
  there is no recorded history.
- **`baking`**: the bake is open. Official ticks may be added and the primary
  control reads `STOP`.
- **`ready`**: recording is closed. Existing frames can be restored and
  browsed; the primary control reads `BAKED` until the bake is cleared or the
  flow changes.

The main transitions are:

- `empty -> baking`: Record or Step calls `beginBake()`.
- `baking -> ready`: Stop, the stability detector, or the 4096-tick safety
  limit calls `finishBake()`.
- any recorded state -> `empty`: Clear calls `clearBake()`.
- a structural edit invalidates the old bake and resets the simulator. If the
  simulation was running, the reset immediately starts a fresh bake at step
  zero; otherwise it leaves the bake empty.

`SimulationBake.begin()` creates the initial step-zero frame, clears old
frames/interactions/trace data, resets stability counters, and stores the
initial visual signature. The controller then transfers pending semantic
interactions and records `bake-start`.

## End-to-end official recording flow

### 1. Establish the official starting state

`beginBake()` first disposes any preview, synchronizes the simulator with the
current project, and calls `Simulator.reset()`. Reset rebuilds the recursive
runtime and performs a non-committing evaluation at step zero. That evaluated
snapshot becomes the initial frame with `cause: "initial"` and
`source: "bake"`.

This is why pressing Record does not continue from an arbitrary paused
preview step. The official bake starts from the current circuit definition at
its canonical evaluated step zero. A prior open bake is the exception: the
controller continues that existing bake instead of calling `beginBake()`
again.

### 2. Transfer semantic intent

Direct input/key changes and some inspector changes may happen while no
official bake exists. The controller keeps those events in a small pending
list. The next official Bake or Step transfers them into the new bake before
adding its `bake-start` event.

The pending list is metadata, not an instruction queue for the simulator. The
project model already contains the changed input/key/memory value when the
official simulator is reset. The interaction event explains the cause of the
new official run; it does not mutate the runtime by replaying itself.

When an official bake is already open, a live input/key interaction takes a
different path. The controller appends the semantic event directly to the
current bake at the current exact execution step. It does not clear the bake,
start a ghost preview, or stop the simulation timer. The changed project value
is then consumed by the next official tick. A paused open bake consumes it on
the next manual Step.

The event ordering is consequently explicit:

`interaction at step n -> Simulator.step() to step n+1 -> engine-tick trace
with propagation/change diagnostics -> exact frame/checkpoint decision`

For a keyboard event while the timer is running, the browser handler may run
that next official tick immediately. For a canvas switch toggle, the normal
timer performs it on its next scheduled tick. Both cases retain the same
semantic-before-engine ordering.

### 3. Execute one official tick

`runStep()` is the controller's official tick boundary:

1. It clears any preview.
2. It synchronizes the simulator with the current project and ensures an open
   bake exists.
3. It captures `beforeSnapshot` from the current official simulator state.
4. It calls `Simulator.step()`, which increments the exact step count and
   evaluates the recursive runtime with stateful commit enabled.
5. It builds a complete frame from the new snapshot and visual signature.
6. It summarizes the before/after snapshot and records one `engine-tick`
   trace event.
7. It records the frame as either a visible checkpoint or a hidden execution
   frame.
8. It plays audio notes, mirrors the official snapshot to the project runtime
   field, checks stability/limit completion, and renders or schedules a
   canvas render.

Production calls use one trace event for one `Simulator.step()` call. A
single simulator tick can still contain many propagation and settle passes;
those counts are fields on the one trace event.

### 4. Decide whether the frame is meaningful

The controller calculates a deterministic visual signature for the new
snapshot. A frame is visible when that signature differs from the previous
exact execution frame. This comparison is deliberately against the execution
head, not merely the last checkpoint: if several hidden ticks occur, a later
change is still recognized as visible.

`SimulationBake.record(frame, { visible })` always updates the exact execution
head. It appends a checkpoint only when `visible` is true. Hidden ticks remain
available as the current exact step while the checkpoint rail stays compact.

If a visible frame is recorded at the same step as the current last frame, the
last checkpoint is replaced rather than duplicated. Normal official stepping
increments the simulator step, so this mainly protects callers that provide
same-step frame updates.

### 5. Finish or remain open

After a tick, a running bake compares the new signature with the previous
signature through `SimulationBake.observe()`. A matching signature increments
the stability counter; a changed signature resets it. A paused manual bake
does not run automatic stability completion because the controller only
observes while `state.simRunning` is true.

The controller finishes for one of three normal reasons:

- `manual`: Stop was pressed.
- `stable`: the meaningful signature stayed unchanged for the configured
  window.
- `limit`: the official step reached `DEFAULT_BAKE_MAX_TICKS` (4096).

For a stable bake with no checkpoint beyond step zero, `finishBake()` restores
the initial snapshot and classifies the result as `static`. Hidden confirmation
ticks therefore do not leak into the user-visible step count for a static
circuit. A non-static bake keeps its exact execution head, even when that head
is later than the latest visible checkpoint.

## The three history layers

### Semantic interaction rail

`SimulationBake.interactions` contains normalized user-intent events. The
current event kinds emitted by the application are:

- `bake-start` and `bake-stop`
- `manual-step`
- `input-change` and `key-change`
- `memory-reset`, `memory-programmed`, and `pulse-configured`

Each normalized event contains a bake version, monotonic sequence, kind,
source, step, target, before/after values, phase, and reason. Missing optional
values become `null`; targets are normalized to strings.

The rail records semantic causes, not browser noise. Hover, selection, panning,
zooming, route-point movement, pointer coordinates, and inspector navigation
do not belong in simulation history. A direct input click is recorded as an
`input-change`; it is not stored as a raw pointer event.

When a bake exists, events go directly into the bake. When it does not, the
controller keeps at most 256 pending events and later transfers them during
`beginBake()`. The bake keeps at most 256 retained interaction objects; old
events are discarded from the retained list while `totalInteractions` counts
events recorded since the current bake was started.

### Engine trace rail

`SimulationTrace` stores one normalized event for each recorded official tick.
The event combines:

- `step`, `source`, `cause`, and `visible`;
- `changedCount`, `changedScopes`, and a bounded `changes` sample;
- propagation count, signal-change count, settle-pass count, settle-limit
  hits, evaluation count, and maximum recursive depth.

The change summary compares scoped snapshot entries for endpoints, instance
signals, and display arrays. It is richer than the visual signature: an
internal or disconnected signal can appear in `changedCount` even when the
frame is not visible. The summary retains at most 64 individual changes and
32 changed scopes. Display arrays are copied to at most 32 items.

There are two different truncation meanings:

- An event's `truncated` field means the change sample is smaller than the
  complete change count.
- `SimulationTrace.truncated` means older trace events were evicted because
  of the event or byte budget.

Each frame stores `traceStart` and `traceEnd`. The current implementation
records one event per frame-producing tick, so both values normally equal the
trace sequence for that tick. The trace sequence is monotonic and is not
renumbered after pruning; a retained trace can therefore have sequence gaps.

The trace is intentionally not a raw propagation callback stream. The
simulator may settle a nested network repeatedly, but exposing every internal
propagation would make the browser history large and couple the UI to runtime
implementation details.

### Checkpoint rail and exact execution head

Each frame has this contract:

`{ version, step, snapshot, signature, cause, source, visible, traceStart,
traceEnd, estimatedBytes }`

The `snapshot` is a full recursive simulator state, not a diff. The rail
starts with the initial step-zero checkpoint and normally adds only frames
whose visual signature changed. `SimulationBake.execution` always points to
the latest exact frame, including hidden ticks. `cursor` points to the
currently selected checkpoint.

During ordinary baking the cursor is moved to the newest visible checkpoint,
while the execution head may advance through invisible ticks. Restoring a
checkpoint while paused sets both the simulator and the execution head to
that checkpoint. This distinction explains why the exact step field can show a
step later than the scrubber's latest checkpoint.

The checkpoint rail is the restore/navigation authority. The interaction and
trace rails provide explanation and diagnostics around it; neither can rebuild
the circuit state by itself.

## Simulator semantics behind a frame

### Evaluation versus a tick

`Simulator.syncProject()`, `reset()`, and `evaluate()` perform a non-committing
evaluation at the current step (normally step zero after a project change).
`Simulator.step()` increments `stepCount`, evaluates the network, and commits
stateful device transitions for that tick.

The runtime first settles the combinational network. On a committing tick it
then gives stateful devices one commit pass and settles again so their changed
outputs propagate. Each runtime is bounded to 32 settle passes; a pass limit
is reported in diagnostics rather than allowing an accidental infinite loop.

The `lastTick` guard prevents a stateful instance from committing repeatedly
when it is visited through nested settle work. This matters for edge-triggered
devices, registers, counters/PC state, pulse timing, memories, and display
backing state. A snapshot must capture both signal values and internal state
for restore to be exact.

### Recursive snapshots

`collectSnapshot()` captures:

- endpoint signal states;
- every instance's input/output signals;
- every instance's cloned internal state;
- junction states;
- root outputs;
- nested custom-chip scopes keyed by encoded paths such as
  `root/<instance-id>`.

`Simulator.restore(snapshot, step)` synchronizes the runtime shape, sets the
exact step count, hydrates internal state/signals/junctions recursively, and
uses the hydrated snapshot directly. It does not execute ticks while
restoring. That is what makes scrub and exact checkpoint navigation stable for
stateful and composite circuits.

## Visual signature and meaningfulness

The controller's `visualSignature()` is a sorted serialization of two things:

1. driven values on connected endpoints in every available scope; and
2. visible display state exposed through instance internal data.

Disconnected pins, unused component outputs, and isolated internal activity
are omitted from the signal portion. Nested scopes are included, and the
sorted output makes equivalent object enumeration order produce the same
signature. The signature context is cached against the project root, custom
chip collection, and project revision, so connected endpoint lookup is not
rebuilt for every tick unless the project structure changes.

The signature is used for three separate policies:

- deciding whether an exact frame becomes a checkpoint;
- determining whether a running bake has stabilized; and
- implementing previous/next visible-step navigation.

The trace change summary is intentionally separate. It describes broad
runtime change, while the signature describes what the user should consider
visible and meaningful.

## Controls, navigation, and branching

### Record, Stop, Clear, and Step

- **Record** starts from evaluated step zero when the bake is empty. If a bake
  is open after manual Step operations, it continues that bake.
- **Stop** records `bake-stop`, closes the bake, and keeps all retained frames.
- **Clear** stops the timer, disposes a preview, resets the official simulator
  to step zero, and removes frames, interactions, and trace events.
- **Step** starts an open bake and advances one official tick. While a bake is
  ready, Step moves to the next already-recorded checkpoint instead of
  creating a second run.

The active timer uses one self-scheduling `setTimeout`. It clears its timer
reference before running the tick, measures elapsed work, and subtracts that
work from the next cadence. Canvas rendering is scheduled separately, so
simulation cadence and drawing cadence do not become one recursive loop.

### Scrubbing and exact-step navigation

Scrub, the step field, and the previous/next controls are paused operations.
Scrub selects a checkpoint index and restores its full snapshot. The scrubber
value is a history index, not an engine step number.

The step field searches the retained checkpoint rail for the closest recorded
step. It cannot reconstruct a hidden tick that is no longer a checkpoint; it
restores the nearest available exact snapshot instead. The displayed current
step can still come from the hidden execution head after a bake finishes.

Previous/next are meaningful-step controls. They compare frame signatures and
move across existing checkpoints only. They never run a hidden simulator to
search for another change.

If the user scrubs backward and then performs an open Step, the intended
operation is a branch:

1. the simulator is already restored to the selected checkpoint;
2. `SimulationBake.record()` removes later checkpoints;
3. trace events after the selected checkpoint step are removed;
4. interaction events after that checkpoint step are removed; and
5. the new official frame is appended to the shortened rail.

This keeps a branch deterministic and prevents stale future history from
appearing in the UI.

## Automatic completion and safety limits

The bake stability window is derived from `project.settings.stepsPerClock`:

`max(4, min(64, round(stepsPerClock) * 2))`

The setting is a circuit clock period, not the UI playback speed. The window
is long enough to confirm a finite flow has stopped changing, but capped so a
misconfigured circuit does not keep the browser busy indefinitely.

The separate official safety limit is 4096 ticks. A visible oscillator or
clocked feedback loop can therefore remain open until Stop, but it cannot run
forever through the timer.

Static completion is a special canonicalization: if the stability detector
fires and the rail still contains only the initial checkpoint, the controller
restores step zero and marks the ready bake as `static`. If visible changes
were recorded earlier, the bake remains at its current exact execution step
and is marked `stable`.

## Causal preview path

When no official bake is open, direct input and key changes need immediate
feedback without committing official history. The controller handles that
idle/ready path as follows:

1. Capture a source snapshot and source step from the current preview if one
   exists, otherwise from the official simulator.
2. Change the project input/key value in the editor model.
3. Clear the official bake while preserving pending semantic interactions;
   this also resets the official simulator against the changed project.
4. Add the input/key event to the pending interaction list.
5. Create a `SimulationPreview` with a cloned project and cloned simulator,
   restore the captured source state, and advance it immediately.
6. Render the preview simulator. The official simulator is not advanced by
   preview ticks; `clearBake()` intentionally resets it to evaluated step zero
   and discards the old official history while the captured source state is
   retained only by the clone.

The preview has a shorter stability window, a 96-step maximum, and a bounded
interval delay. Its completion status says that a future Bake or Step is
needed to make the result official. Starting Bake or Step disposes the
preview, resets/uses the official simulator according to the bake state, and
records the resulting official ticks.

While `SimulationBake.isBaking` is true, this preview path is bypassed. The
same input/key call records a semantic interaction directly in the active
bake, leaves the official simulator at its current step, and waits for the
next official tick to show the consequence. This distinction is what lets a
user turn a switch or press a mapped key during Record without ending the
recording.

Inspector actions such as memory reset, ROM programming, and pulse-duration
changes use the normal project mutation path. That path invalidates the bake,
then records the semantic event either into a new running bake or into the
pending list.

## Invalidation and persistence

Structural editor changes call `touch()` with a revision change. The revision
causes the simulator runtime to rebuild and the controller clears the old
bake. This applies to topology, chips, wires, custom-chip changes, and
undo/redo. A bake is always tied to one project revision; it is not a durable
history across structural edits.

Direct input/key changes intentionally use the non-structural path for the
project revision. If the bake is idle or ready, the old official history is
cleared and the cloned preview gives immediate feedback while the timeline
waits for the next explicit Bake or Step. If the bake is open, the history is
not cleared: the semantic event is appended at the current step and the
changed project value becomes input to the next official tick.

The bake object, preview, trace, and checkpoint snapshots are runtime-only.
The storage layer removes `_revision` and `_simSnapshot` before saving or
exporting. A reload constructs a new simulator with an evaluated step-zero
snapshot and starts with no retained bake.

## Bounds and pruning

The defaults are deliberately independent:

| Resource | Default bound | Retention policy |
| --- | ---: | --- |
| Checkpoint count | 512 frames | Keep the initial frame; discard older interior checkpoints first |
| Checkpoint estimate | 32 MiB | Remove safe interior frames while possible; preserve initial/current/latest when possible |
| Semantic interactions | 256 retained events | Keep newest events; sequence and total count continue |
| Engine trace | 2048 events or 4 MiB estimate | Remove oldest events; preserve monotonic sequence numbers |
| Per-tick change sample | 64 changes | Keep a bounded sample and expose `truncated` |
| Changed scopes | 32 scopes | Keep a bounded sorted list |
| Display array sample | 32 values | Copy only the leading bounded sample |
| Official run | 4096 ticks | Finish with `reason: "limit"` |
| Causal preview | 96 ticks | Finish with `reason: "limit"` |

The checkpoint byte value is an estimate of the in-memory frame, not a
serialized storage size. The pruning algorithm is best effort: if only the
initial, current, and latest frames remain, it stops rather than deleting a
frame required by the current navigation state. Trace memory is reported
separately from checkpoint memory and does not silently consume the
checkpoint budget.

## Current correctness contracts

These are the contracts that keep the mechanism coherent:

- A new official bake starts from an evaluated, non-committing step-zero
  simulator state.
- A live input/key interaction during an open bake is recorded before the
  next official tick without stopping the timer or clearing the bake.
- One official controller tick produces at most one trace event and one exact
  execution frame.
- Stateful devices commit once per official tick, then expose their new state
  through the final settle pass.
- A checkpoint contains enough recursive signal/internal state for direct
  restore without replay.
- Hidden ticks update the exact execution head but do not inflate the visible
  checkpoint rail.
- Visible-step navigation searches retained frames and never launches a
  second hidden simulation.
- A structural project revision invalidates the old bake.
- Preview state never becomes official history until a new Bake or Step runs.
- All three history stores are bounded independently.

## Tests and current gaps

The domain tests cover most of the mechanism's core contracts:

- [`simulation-controller.test.js`](../../test/simulation-controller.test.js)
  covers lifecycle transitions, semantic actions, official trace events, and
  preview-event carry-over plus live interaction capture during an open bake.
- [`simulation-timeline.test.js`](../../test/simulation-timeline.test.js)
  covers sparse checkpoints, hidden execution frames, stability, clearing,
  interaction caps, and frame branching.
- [`simulation-trace.test.js`](../../test/simulation-trace.test.js) covers
  signal/display summaries, bounded change samples, event pruning, and
  sequence behavior.
- [`simulation-preview.test.js`](../../test/simulation-preview.test.js)
  verifies that preview execution advances a clone without changing the
  official simulator.
- [`bake-controls-project.test.js`](../../test/bake-controls-project.test.js)
  covers static completion, connected indefinite clocks, and the visible
  progression fixture.
- [`simulator.test.js`](../../test/simulator.test.js) covers the underlying
  state and recursive execution semantics on which restore depends.

The remaining implementation risks are narrower than the core lifecycle:

1. There is no browser-level end-to-end test that clicks Record/Stop, scrubs,
   branches, and verifies the DOM against the canvas state. The current UI
   checks are mostly domain tests and source/architecture contracts.
2. Branch truncation is performed inside `SimulationBake.record()`, but
   `simulation-controller.js` currently calls `recordTrace()` before
   `record()`. When recording from a scrubbed cursor, the trace truncation can
   remove the just-created new-branch event; the new frame's
   `traceStart`/`traceEnd` can then refer to a sequence no longer retained.
   Frame branching itself is covered; this trace-linkage case is not.
3. Full recursive snapshots and signatures are intentionally simple and
   reliable, but they repeat work for every meaningful checkpoint. The byte
   limits bound memory; they do not eliminate the cost of cloning a large
   composite snapshot.
4. The trace is exposed to the DOM only through event counts/data attributes.
   There is no user-facing trace inspector yet, so its diagnostic value is
   currently available to tests and future tooling rather than the main UI.

The architectural direction is consequently clear: preserve the simulator
snapshot as the restore authority, keep semantic intent and engine evidence
bounded and separate, and add tests around trace-to-frame linkage before
making the history model more elaborate.

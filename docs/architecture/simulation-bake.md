# Simulation Bake Architecture

The simulation is organized around one bounded **bake**. A bake is an official
recording session produced by the primary simulation action and the staging
area consumed by Step, relevant-step navigation, and the scrubber. It has
three deliberately different layers:

1. **Semantic interactions**: input changes, key changes, stateful-device
   edits, manual stepping, and bake start/stop actions. View-only gestures
   such as hover, selection, pan, and zoom are not useful simulation history
   and are excluded.
2. **Engine trace**: one compact event per official engine tick, including
   propagation count, signal-change count, changed signal/display summaries,
   nested settle diagnostics, and whether the tick produced a visible change.
3. **Checkpoint rail**: the existing sparse snapshots used for exact restore,
   scrub, and visible-step navigation. This remains the replay authority; the
   trace explains the ticks between checkpoints without becoming a second
   simulator.

## Lifecycle

    empty --Bake/Step--> baking --stable detector or Stop--> ready
      ^                                      |
      |---------------- Clear Bake ----------|

- **empty**: the project has an evaluated step-zero snapshot but no recorded
  simulation history.
- **baking**: exact simulator steps may advance; meaningful checkpoints are
  recorded for navigation. The primary control reads `STOP` in this state.
- **ready**: the recording is closed. Scrub and relevant-step controls read from
  it, and the primary control reads `BAKED` until Clear or a flow-changing
  edit invalidates it.

## Ownership

- `Simulator` owns deterministic circuit execution, exact `stepCount`, runtime
  state, and snapshots.
- `SimulationBake` owns the lifecycle, checkpoint rail, exact execution head,
  scrub cursor, stability observation, bounded pruning, semantic interactions,
  and the bounded engine trace.
- `SimulationTrace` owns compact per-tick diagnostics and signal/display
  change summaries. It is intentionally aggregate rather than a raw callback
  stream from every internal propagation, so nested circuits remain usable in
  the browser.
- `SimulationPreview` owns a short-lived cloned simulator for causal previews;
  it never records into the official bake.
- `simulation-controller.js` owns browser-facing simulation transitions:
  starting/stopping baking, stepping, scrubbing, macro navigation, preview
  invalidation, timer ownership, and status messages.
- `main.js` owns DOM event binding and rendering. It supplies callbacks to the
  controller but does not implement bake transitions itself.
- `renderer.js` consumes the selected simulator snapshot; it does not control
  bake history or preview lifetime.

The exact execution head can be ahead of the visible checkpoint cursor. This
keeps the scrubber compact while preserving the current exact step for the
editable step field and future execution.

## Control contract

- **Bake** starts a recording from evaluated step zero. If a paused, open bake
  exists after manual stepping, it continues that recording. A causal input or
  key preview is not itself official history; its semantic action is carried
  into the next Bake or Step so the official run records the resulting flow.
- **Stop** is the active state of the same Bake control. It closes the current
  recording without discarding its frames.
- A finite circuit closes automatically after the configured stable window.
  Indefinite or evolving circuits remain in `baking` until Stop.
- **Clear** stops execution, discards the recording, clears any causal preview,
  and returns to evaluated step zero.
- **Step** starts an open bake when none exists, advances it while it is open,
  or navigates to the next recorded frame after the bake is ready. It never
  silently creates a second bake from a completed timeline.
- **Scrub**, the editable step field, and previous/next visible-step controls
  only navigate frames already present in the current bake. Scrubbing backward
  followed by an open Step branches away the future checkpoints.
- The scrubber stays mounted in the bake rail as a stable spatial affordance;
  it is muted and disabled until a ready bake contains more than one
  checkpoint, then becomes interactive without changing the rail layout.
- The official trace and interaction rail are bounded independently from
  snapshots. A safety limit also closes a continuously changing bake, so an
  oscillator cannot keep a browser timer alive forever.

## Control arrangement

The main bake rail is ordered as:

    Bake/Stop -> Previous visible step -> exact step field -> scrubber -> Next visible step -> Clear

The previous and next buttons are not simple engine-tick `-1`/`+1` controls.
They move to the nearest recorded checkpoint whose visible signal/display
signature differs from the current frame. The editable step field targets an
exact engine tick and restores the nearest recorded checkpoint when that tick
was not itself visually meaningful. The scrubber moves through the recorded
checkpoint rail; its position is therefore a history index, not necessarily an
engine-step number. Steps per second is an independent numeric control in the
secondary status bar.

## Causal preview contract

Changing an input device or key interaction captures the pre-change simulator
snapshot, clears the official bake, and starts a cloned `SimulationPreview`.
The renderer temporarily reads that cloned simulator so the user can watch
the consequence settle. Starting Bake or Step clears the preview and returns
the viewport to the official simulator before recording.

This preview is intentionally separate from baking: it is immediate,
non-recording feedback for a tweak, while a bake is an explicit, navigable,
user-committed history.

## Automatic completion

After each recorded bake step, the controller asks `SimulationBake` to compare
the meaningful visual signature with the previous one. The signature follows
signals on connected wire endpoints and visible display state; isolated
oscillators or unused component pins do not keep an otherwise settled circuit
alive. A bake closes after a bounded stable window with no significant change.
The window is derived from the configured clock period and capped so
combinational projects settle without producing an unnecessarily long history.

If that confirmation produces no visual checkpoint beyond evaluated step zero,
the controller classifies the bake as static and restores the official
execution head to step zero. The bake remains ready for Clear, but the step
field, relevant-step buttons, and scrubber stay non-navigable because there is
no visible timeline to inspect. Hidden engine ticks used for confirmation do
not leak into the user-facing step count.

A changing clock, feedback loop, or other evolving visible state does not
reach that stable window, so the user can stop it explicitly with the same
primary control.

## Recording boundary

The record is semantic rather than a browser event log. A click on an input is
recorded as an input change, a keyboard-controlled device is recorded as a key
transition, and stateful inspector actions such as resetting memory or
programming a ROM are recorded as runtime configuration changes. A click on
Bake, Stop, or Step is recorded as a control action.
The engine trace then records what the simulator did in response: how many
wires were propagated, how many signal values changed, how many settle passes
were needed, and which scoped signals or displays changed. Pointer coordinates,
hover labels, selection rectangles, camera movement, and inspector navigation
remain UI state and are intentionally absent from the bake.

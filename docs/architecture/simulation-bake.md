# Simulation Bake Architecture

The simulation is organized around one bounded **bake**. A bake is the
recording produced by the primary simulation action and the staging area
consumed by Step, relevant-step navigation, and the scrubber.

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
  scrub cursor, stability observation, and bounded pruning.
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
  exists after manual stepping, it continues that recording.
- **Stop** is the active state of the same Bake control. It closes the current
  recording without discarding its frames.
- A finite circuit closes automatically after the configured stable window.
  Indefinite or evolving circuits remain in `baking` until Stop.
- **Clear** stops execution, discards the bake, clears any causal preview, and
  returns to evaluated step zero.
- **Step** starts an open bake when none exists, advances it while it is open,
  or navigates to the next recorded frame after the bake is ready. It never
  silently creates a second bake from a completed timeline.
- **Scrub**, the editable step field, and previous/next visible-step controls
  only navigate frames already present in the current bake. Scrubbing backward
  followed by an open Step branches away the future checkpoints.
- The scrubber stays mounted in the bake rail as a stable spatial affordance;
  it is muted and disabled until a ready bake contains more than one
  checkpoint, then becomes interactive without changing the rail layout.

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

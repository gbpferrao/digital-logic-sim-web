# Simulation Bake Architecture

The simulation is organized around one bounded **bake**. A bake is the
recording produced by a run and the staging area consumed by Step, Start, End,
visible-step navigation, and the scrubber.

## Lifecycle

    empty --Run/Step--> baking --stable detector or Bake--> ready
      ^                                      |
      |---------------- Clear Bake ----------|

- empty: the project has an evaluated step-zero snapshot but no recorded
  simulation history.
- baking: exact simulator steps may continue to advance; meaningful
  checkpoints are recorded for navigation.
- ready: the recording is closed. Scrub and boundary controls read from it.
  Step can reopen it to extend or branch the recording.

## Ownership

- Simulator owns deterministic circuit execution, exact stepCount, runtime
  state, and snapshots.
- SimulationBake owns the lifecycle, checkpoint rail, exact execution head,
  scrub cursor, and stability observation.
- main.js owns user intent: starting a fresh run, pausing, manually
  finalizing, clearing, and rendering controls.
- renderer.js consumes the simulator snapshot only; it does not control bake
  history.

The exact execution head can be ahead of the visible checkpoint cursor. This
keeps the scrubber compact while preserving the current exact step for the
Step label and future execution.

## Control contract

- Run always starts a fresh bake from evaluated step zero.
- Pause pauses an open bake without finalizing it.
- Bake stops execution and closes the current bake for navigation. It is the
  manual escape hatch for clocks, feedback, and other indefinite systems.
- Clear stops execution, discards the bake, and returns to evaluated step zero.
- Step advances the current bake. If the bake is closed, it reopens it; if the
  user scrubbed backward, future checkpoints are branched away.
- Scrub, Start, End, and visible-step controls only navigate frames that
  already exist in the current bake. They do not silently run a second
  simulation.

## Automatic completion

After each recorded run step, the bake compares its meaningful visual
signature with the previous one. A run closes automatically after a bounded
stable window with no significant change. The window is derived from the
configured clock period and capped so combinational projects settle without
producing an unnecessarily long history.

A changing clock, feedback loop, or other evolving visible state never reaches
that stable window, so the user can stop it explicitly with Bake.

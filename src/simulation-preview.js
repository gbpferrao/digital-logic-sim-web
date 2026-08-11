import { clone } from "./model.js";
import { Simulator } from "./simulation.js";

export const DEFAULT_PREVIEW_MAX_STEPS = 96;
export const DEFAULT_PREVIEW_STEP_DELAY = 140;

/**
 * A short-lived, non-recording simulation branch used to preview the causal
 * effects of a direct canvas interaction. It deliberately owns a cloned
 * project and simulator; it never records preview frames into the official
 * SimulationBake. The caller owns any explicit bake invalidation required by
 * the interaction that started the preview.
 */
export class SimulationPreview {
  constructor({
    project,
    simulator,
    sourceSnapshot = simulator?.snapshot,
    sourceStep = simulator?.stepCount ?? 0,
    signature = () => "",
    stabilityWindow = 4,
    maxSteps = DEFAULT_PREVIEW_MAX_STEPS,
    stepDelay = DEFAULT_PREVIEW_STEP_DELAY,
    onUpdate = null,
    onFinish = null
  } = {}) {
    if (!project || !simulator) throw new TypeError("SimulationPreview needs a project and source simulator.");
    this.project = clone(project);
    this.simulator = new Simulator(this.project);
    this.simulator.restore(sourceSnapshot, sourceStep);
    this.signature = typeof signature === "function" ? signature : () => "";
    this.stabilityWindow = Math.max(2, Number(stabilityWindow) || 4);
    this.maxSteps = Math.max(1, Number(maxSteps) || DEFAULT_PREVIEW_MAX_STEPS);
    this.stepDelay = Math.max(40, Number(stepDelay) || DEFAULT_PREVIEW_STEP_DELAY);
    this.onUpdate = typeof onUpdate === "function" ? onUpdate : () => {};
    this.onFinish = typeof onFinish === "function" ? onFinish : () => {};
    this.steps = 0;
    this.stableSteps = 0;
    this.lastSignature = this.signature(this.simulator.snapshot);
    this.finished = false;
    this.reason = null;
    this.timer = null;
  }

  get stepCount() {
    return this.simulator.stepCount;
  }

  start() {
    if (this.finished) return this;
    this.advance();
    if (!this.finished) this.timer = setInterval(() => this.advance(), this.stepDelay);
    return this;
  }

  advance() {
    if (this.finished) return false;
    this.simulator.step();
    this.steps += 1;
    const nextSignature = this.signature(this.simulator.snapshot);
    if (nextSignature === this.lastSignature) this.stableSteps += 1;
    else {
      this.lastSignature = nextSignature;
      this.stableSteps = 0;
    }
    this.onUpdate(this);
    if (this.stableSteps >= this.stabilityWindow) this.finish("stable");
    else if (this.steps >= this.maxSteps) this.finish("limit");
    return !this.finished;
  }

  finish(reason = "stable") {
    if (this.finished) return this;
    this.finished = true;
    this.reason = String(reason || "stable");
    this.disposeTimer();
    this.onFinish(this);
    return this;
  }

  disposeTimer() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose() {
    this.disposeTimer();
    this.finished = true;
    this.reason = "cancelled";
    return this;
  }
}

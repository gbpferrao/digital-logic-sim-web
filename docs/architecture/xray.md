# X-ray view architecture

X-ray is a bounded visual projection of composite chips. It is intentionally not a second editor, simulator, or project tree.

## Contract

- `state.xray` is a transient view preference owned by the application shell.
- `WorldRenderer` reads that preference and overlays internals inside the existing composite-chip body.
- Selection, hit testing, dragging, wire editing, inspection, simulation, baking, and save operations continue to use the current `project.root` only.
- The `X` shortcut and the X-ray tool button are the two entry points. The menu exposes the same toggle for discoverability.
- The overlay is clipped to the composite body. It does not expand the world, change camera fitting, or create editable proxy objects.

## Recursive bounds

Each composite description can carry:

```json
"fit": {
  "version": 1,
  "bounds": { "x": -320, "y": -180, "w": 680, "h": 400 }
}
```

`fit.bounds` is the saved, reusable canvas footprint. It is derived from child chip bounds, interface pins, wires, and junctions. Notes and labels are deliberately excluded so documentation does not make a reusable chip physically larger.

The editing `size` remains the description's internal working canvas. When a custom description is reused, its visual body, placement bounds, and pin coordinates use `fit.bounds`; the original internal coordinates are mapped into that footprint. This preserves the authored scale rather than shrinking a composite to a generic minimum box.

Legacy custom descriptions without `fit` receive one during normalization. The migration uses their existing child `size` values once, avoiding recursive fit inflation. Newly saved and edited custom chips refresh their fit before they are stored.

## Safety limits

The projection follows every finite nesting level below the current root. It does not impose an arbitrary visual-depth cutoff, so a deeply composed chip remains inspectable in X-ray. Safety comes from:

- 160 child instances per projected level;
- 240 wires per projected level;
- a cycle guard keyed by composite identity.

The per-level budgets keep large descriptions readable, while the cycle guard prevents recursive custom-chip graphs from turning the canvas into an infinite render. A truncated level remains a valid normal chip and shows a small count marker instead of silently taking ownership of the editor.

## Rendering flow

1. If X-ray is active and the description is composite, draw one low-opacity,
   color-tinted composite shell with a single boundary stroke. Its normal
   top-left caption and pins remain the visible identity of the group.
2. Clip an inset region inside that shell and map the description's reusable
   fit into it. The inset is a clipping boundary only; it is not another
   visible box or dark wrapper.
3. Draw internal wires, child bodies, and small internal pin markers. Bound
   `IN`/`OUT` interface instances are hidden as proxy bodies and labels. The
   public group port is bridged directly to the real internal interface-pin
   coordinate, so the signal remains one continuous path without an extra
   interface-node tail. The group entry and exit ports use the same vertical
   fit projection as their hidden interface pins, keeping both sides level.
4. Recurse through every finite level while the cycle guard and per-level budgets allow.
5. Restore the normal canvas context and draw the ordinary caption/selection treatment.

Because the projection is rendered from the same normalized description and geometry helpers as ordinary placement, it does not introduce a parallel data model or interaction handler family.

## Deliberate tradeoff

Deep internals become visually smaller as they are nested. That is the honest result of showing many composition layers in one bounded chip footprint. The normal double-click/open-internals action remains the precise editing path when a layer needs full-size work.

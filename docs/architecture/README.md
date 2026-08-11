# Architecture documentation

These notes follow the implementation from broadest boundary to narrowest
behavior:

- [`system.md`](system.md) describes the current modules, contracts, data
  flows, topology, and refactoring priorities.
- [`simulation-bake.md`](simulation-bake.md) describes the simulation history
  contract consumed by baking, stepping, relevant-step navigation, and
  scrubbing.
- [`xray.md`](xray.md) describes the bounded recursive view of composite-chip
  internals.
- [`performance.md`](performance.md) records the browser performance plan and
  implementation waves.
- [`legacy-audit.md`](legacy-audit.md) separates removable dead paths from
  compatibility code that still needs a deliberate migration decision.
- [`interaction/`](interaction/) contains the interaction audit and its
  evidence reports.

Use the system audit for orientation, the specialized notes for a subsystem,
and the interaction reports when tracing pointer behavior or regressions.

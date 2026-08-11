# Nand2Tetris: native-primitives variant

This is a parallel version of the `storage/nand2tetris/` learning track.

The original track is the pedagogical construction path: its `N2T` chips show how larger parts are composed from the Nand2Tetris building blocks. This variant keeps the same chip names, projects, stages, and software landmarks, but replaces exact basic-gate wrappers inside compositions with the simulator's native primitives:

- `NAND`, `NOT`, `AND`, `OR`, `XOR`, `NOR`, and `XNOR`
- `BUFFER`
- `3-STATE BUFFER`

That means a native-primitives `N2T MUX` visibly contains native `NOT`, `AND`, and `OR` parts, and the same substitution continues through larger compositions such as the bitwise units, adders, ALU, and CPU teaching path. Endpoint pins are remapped to the native catalog contracts when a wrapper is replaced.

MUX, DMUX, arithmetic, state, memory, CPU, and computer chips remain composed when there is no exact one-to-one basic native equivalent. Native state and device leaves that already existed in the original bundle are retained.

Use this tree when you want to study the higher-level architecture without every basic gate expanding into a handmade Nand2Tetris wrapper. Use the original tree when you want to inspect that construction step itself. Both are portable JSON bundles and can be imported without a storage backend.

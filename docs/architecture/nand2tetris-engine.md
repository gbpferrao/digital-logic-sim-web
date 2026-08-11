# Nand2Tetris engine boundary

The Nand2Tetris track is implemented as a normal recursive chip graph. A project owns a `customChips` map; a custom instance resolves its child description by name; the simulator evaluates the child with a map of public input-pin states and returns public output-pin states. Standalone chip files include a `dependencies` map so import does not depend on a backend or on a second file being present.

## Hardware contract

The executable hardware path is:

`NAND -> Boolean logic -> routing -> 16-bit logic -> arithmetic -> DFF/BIT/register -> memory -> instruction decoder -> control -> composed CPU -> decoded CPU memory -> computer`

The outer chips are ordinary JSON compositions. The engine adds only the contracts that are either stateful or need a bounded, efficient implementation:

- `DFF` captures `D` on a rising `CLOCK` edge and exposes `Q`.
- `CONST-0`, `CONST-1`, and their 16-bit zero/one forms provide explicit sources for composition.
- `RAM8` through `RAM16K` use the common `ADDRESS`, `IN`, `LOAD`, `RESET`, `CLOCK`, `OUT` contract with a declared address width and bounded memory size.
- `ROM32K` exposes `ADDRESS` and a 16-bit `OUT` word.
- `MEMORY` exposes a bounded native Hack data-memory boundary, while `SCREEN` and `KEYBOARD` are explicit native device boundaries.
- `HACK CPU` remains available as a native reference contract. It owns the A register, D register, program counter, Hack ALU decoding, destination writes, and jump decision in JavaScript.
- `N2T CPU` is the teaching path: it composes the instruction decoder, constant generator, ALU-control, destination-control, jump-control, A/D registers, ALU, and PC. Its visible contract is `IN M`, `INSTRUCTION`, `RESET`, `CLOCK` to `OUT M`, `WRITE M`, `ADDRESS M`, `PC`.
- `N2T CPU-MEMORY` composes the address decoder and device-selection path. Its RAM, screen, and keyboard leaves still use bounded native device contracts, while `N2T CPU-MEMORY-BUS` makes the CPU/device flow explicit.

Stateful processors commit only during the simulator's commit pass. The settling passes expose the current state without mutating it; a rising edge commits once per simulation tick; the final settling pass makes the new state visible. This is the same snapshot/restore boundary used by Bake and the scrubber, so a DFF or CPU can be scrubbed without a second special timeline model.

## Asset topology

`storage/nand2tetris/` is the source asset tree. `scripts/build-nand2tetris-assets.mjs` is deterministic and regenerates the custom chip JSONs, lab projects, manifests, and software-stage records. `scripts/prepare-static-assets.mjs` invokes it before copying the tree to `public/examples/nand2tetris/`.

The hardware records are executable canvas chips. The software records for Hack assembly, the assembler, VM, Jack, Jack compiler, Jack OS, a later ARM/RISC-V bridge, and a real-OS bridge are deliberately metadata milestones: those are language tools, runtimes, and operating-system services, not canvas chips. They identify the next engine boundary instead of hiding an unimplemented compiler behind a chip-shaped JSON.

# Nand2Tetris chip progression

This folder is the simulator-facing companion to the chip progression plan. It follows *The Elements of Computing Systems* by Noam Nisan and Shimon Schocken, usually called Nand2Tetris: start with NAND, build logic and arithmetic, add state and memory, then assemble the CPU and complete computer.

## How the folder is organized

- `manifest.json` is the findable index: hardware landmarks, custom chip files, native engine primitives, lab projects, and the later software track.
- `chips/` contains standalone chip JSONs. Each custom chip carries its transitive custom-chip dependencies, so it can be imported by itself.
- `projects/` contains complete projects with the whole custom-chip bundle. Start with `nand2tetris-bit-lab.json`, then `nand2tetris-hardware-lab.json`, and finally `nand2tetris-computer-lab.json`.
- `software/` records the companion milestones after the hardware computer: Hack assembly, assembler, VM, Jack-like language, compiler, Jack OS, a later RISC-V or ARM bridge, and a real-OS bridge.

## Hardware landmarks

`NAND -> logic -> routing -> 16-bit logic -> arithmetic -> state -> memory -> instruction fields -> control -> composed CPU -> decoded memory -> computer`

The custom chips are ordinary nested simulator descriptions. The teaching path includes explicit `DMUX16`, `NEG16`, `REGISTER16`, `COUNTER`, instruction ROM/register/decoder layers, control layers, a CPU-memory bus, an address decoder, a composed CPU, and a composed CPU-memory boundary. The generator lays them out from dependency leaves toward the root using their actual minimum interaction bounds, then parks explanatory notes outside the circuit. New engine primitives remain limited to contracts that are awkward or needlessly expensive to reproduce at the current canvas level: rising-edge `DFF`, explicit constants, bounded 16-bit memories, ROM32K, screen/keyboard devices, and a native Hack CPU reference.

The native Hack CPU and native memory devices are retained as fast reference contracts. They are not silently used by the `N2T CPU` or `N2T CPU-MEMORY` teaching compositions, except at the documented RAM, screen, keyboard, and ROM leaves.

## Software boundary

Assembly, an assembler, a VM translator, a Jack compiler, and an OS are not canvas chips. They are language tools and runtime services. The `software/` records keep those milestones in the same progression without pretending that the current digital-logic canvas already implements a compiler or operating system. The ARM/RISC-V and real-OS records are later bridges beyond the original Nand2Tetris hardware path.

The static build copies this folder to `public/examples/nand2tetris/`, so the same JSONs are available on GitHub Pages for download and import.

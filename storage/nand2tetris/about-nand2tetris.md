# Nand2Tetris boundary in this simulator

This folder contains a visual, executable hardware path inspired by *The Elements of Computing Systems* (Nand2Tetris).

## What is composed

The JSON chips visibly compose:

- NAND-derived Boolean logic
- MUX and DMUX routing
- 16-bit logic and arithmetic
- adders, incrementer, negator, subtractor, comparator, and ALU
- BIT, REGISTER16, COUNTER, and PC
- instruction storage, decoding, and control signals
- A and D registers
- a composed Hack CPU
- a CPU-memory bus, address decoder, device selection, and Computer

## What remains native

The simulator provides the execution contracts that are expensive or lower-level than the canvas currently models:

- ideal bit and bus signals, wire settling, clocks, snapshots, Bake, and scrubbing
- NAND, DFF, constants, bus converters, and input/output terminals
- bounded RAM and ROM storage
- Screen and Keyboard device models
- a native `HACK CPU` reference contract

The native CPU is kept for comparison. The `N2T CPU` and `N2T COMPUTER` teaching path uses the composed CPU and memory-control chips instead.

## What is not implemented yet

The `software/` records mark the next learning stages. They are not fake canvas chips: an assembler, VM translator, Jack compiler, and Jack OS are language tools and runtime services. Those require a companion text/runtime track above the hardware graph.

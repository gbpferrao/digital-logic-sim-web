# Chip progression to a Nand2Tetris-style computer

This is a build order for the chips themselves.

Each stage should produce small chips that can be tested alone and composed into the next stage. The goal is not to build many disconnected demonstrations. The goal is to grow one understandable computer from simple parts.

This progression takes its main hardware sequence from *The Elements of Computing Systems* by Noam Nisan and Shimon Schocken, commonly known as the Nand2Tetris book. It follows the book’s path from NAND gates through Boolean logic, arithmetic, sequential logic, memory, CPU, and computer, while adapting the projects to the Digital Logic Simulator’s visual and compositional workflow.

The hardware target is an arguably complete educational computer in the style of Nand2Tetris. The full learning path continues above the hardware into assembly, translation tools, a high-level language, and an operating-system layer:

**NAND -> logic -> arithmetic -> memory -> CPU -> computer -> assembly -> assembler -> VM -> Jack -> compiler -> Jack OS**

ARM and RISC-V are a later bridge to modern instruction sets. They are not part of the original Nand2Tetris hardware path.

## How to use this progression

For every chip:

1. Define its input pins and output pins.
2. Write its truth table or behavior rules.
3. Build it from chips that already work.
4. Test all small input combinations.
5. Use it in a larger cornerstone project.
6. Add a note that explains what the chip does and why it exists.

Use a consistent bus width. For a Nand2Tetris-style computer, the main data path should eventually use 16-bit values. Use smaller 1-bit, 4-bit, and 8-bit circuits first because they are easier to inspect.

## Cornerstone 0: NAND foundation

### Build

- `NAND`

### Test

Test all four input combinations.

### Result

This is the smallest universal logic primitive. Every later logic chip can be built from NAND chips.

## Cornerstone 1: elementary logic

### Build in this order

1. `NOT`
2. `AND`
3. `OR`
4. `XOR`
5. `NOR`
6. `XNOR`
7. `BUFFER`
8. `TRI-STATE`

### Compose

- Build `AND` from `NAND` and `NOT`.
- Build `OR` from `NOT` and `AND` using De Morgan’s law.
- Build `XOR` from `AND`, `OR`, and `NOT`.
- Build `XNOR` by inverting `XOR`.

### Cornerstone project

**Logic gate laboratory**

Place each gate beside its truth table. Connect the same input switches to every gate and compare the outputs.

## Cornerstone 2: routing and selection

### Build

1. `MUX`
2. `DMUX`
3. `OR8WAY`
4. `MUX4WAY`
5. `MUX8WAY`
6. `DMUX4WAY`
7. `DMUX8WAY`

### Recommended interfaces

For a 1-bit multiplexer:

```text
a, b, select -> out
```

For a 16-bit multiplexer:

```text
a[16], b[16], select -> out[16]
```

### Compose

- Build `MUX` from `AND`, `OR`, and `NOT`.
- Build `DMUX` from `NOT`, `AND`, and routing logic.
- Build wider multiplexers from smaller multiplexers.
- Build multi-way multiplexers as trees of 2-way multiplexers.

### Cornerstone project

**Selector laboratory**

Show several data inputs, one selected output, and a visible selector value. This is the first project that demonstrates that control signals choose a data path.

## Cornerstone 3: multi-bit logic

### Build

1. `NOT16`
2. `AND16`
3. `OR16`
4. `XOR16`
5. `OR8WAY`
6. `MUX16`
7. `DMUX16`

### Compose

- Build each 16-bit chip from 1-bit chips.
- Keep bit ordering explicit.
- Label the lowest bit as bit 0.
- Test values such as `0x0000`, `0x0001`, `0x00FF`, `0x8000`, and `0xFFFF`.

### Cornerstone project

**16-bit logic panel**

Use 16-bit inputs, show their hexadecimal values, and let the user select between several operations.

## Cornerstone 4: arithmetic

### Build in this order

1. `HALFADDER`
2. `FULLADDER`
3. `ADD16`
4. `INC16`
5. `NEG16`
6. `SUB16`
7. `COMPARE16`
8. `ALU`

### Suggested interfaces

#### Half adder

```text
a, b -> sum, carry
```

#### Full adder

```text
a, b, carryIn -> sum, carryOut
```

#### ALU

```text
x[16], y[16], control -> out[16], zero, negative
```

The control inputs can select operations such as:

- Zero x
- Negate x
- Zero y
- Negate y
- Add x and y
- AND x and y
- Negate output

### Compose

- Build `FULLADDER` from two `HALFADDER` chips.
- Build `ADD16` from sixteen full adders.
- Build `INC16` from `ADD16` and a constant one.
- Build `SUB16` from two’s complement negation and `ADD16`.
- Build `ALU` from zeroing, negation, logic, addition, and selection stages.

### Cornerstone project

**ALU laboratory**

Show x, y, operation, output, zero flag, negative flag, and carry behavior. This should become the main arithmetic reference project.

## Cornerstone 5: sequential state

Combinational chips only calculate from their current inputs. Sequential chips introduce memory and time.

### Build in this order

1. `DFF`
2. `BIT`
3. `REGISTER`
4. `REGISTER16`
5. `COUNTER`
6. `PC`

### Suggested interfaces

#### D flip-flop

```text
in, clock -> out
```

#### Bit

```text
in, load, clock -> out
```

#### Register16

```text
in[16], load, clock -> out[16]
```

#### Program counter

```text
in[16], load, increment, reset, clock -> out[16]
```

### Compose

- Build `BIT` from a flip-flop and a feedback multiplexer.
- Build `REGISTER16` from sixteen bits.
- Build `COUNTER` from a register, incrementer, and selection logic.
- Build `PC` from a register, incrementer, reset path, and load path.

### Cornerstone project

**State and clock laboratory**

Show the clock, current value, next value, load signal, reset signal, and previous value. Make the state transition visible one step at a time.

## Cornerstone 6: memory hierarchy

### Build in this order

1. `RAM8`
2. `RAM64`
3. `RAM512`
4. `RAM4K`
5. `RAM16K`
6. `ROM32K`
7. `SCREEN`
8. `KEYBOARD`

The exact sizes can be smaller during learning. The important idea is hierarchical address selection.

### Suggested memory interface

```text
in[16], load, address[n], clock -> out[16]
```

### Compose

- Build `RAM8` from eight registers and address-selection logic.
- Build larger RAM chips from smaller RAM chips.
- Use high address bits to select a memory bank.
- Use low address bits to select a word inside the bank.
- Decode address ranges for RAM, screen, and keyboard.

### Cornerstone project

**Memory map laboratory**

Show RAM, screen memory, and keyboard memory as separate address ranges. Display the selected address and the active device.

## Cornerstone 7: instruction representation

Before building the CPU, define what an instruction means.

### Build

1. `INSTRUCTION-ROM`
2. `INSTRUCTION-REGISTER`
3. `INSTRUCTION-DECODER`
4. `CONSTANT-GENERATOR`
5. `CONTROL-SIGNAL-DECODER`

### Define

Document:

- Instruction width
- Opcode fields
- Register fields
- Address fields
- Constant fields
- Jump fields
- Destination fields

For a Nand2Tetris-style computer, use 16-bit instructions and distinguish A-instructions from C-instructions.

### Cornerstone project

**Instruction inspection laboratory**

Show the current instruction in binary, hexadecimal, and decoded form. Do not execute it yet.

## Cornerstone 8: CPU building blocks

### Build

1. `A-REGISTER`
2. `D-REGISTER`
3. `ALU-CONTROL`
4. `WRITE-DESTINATION-CONTROL`
5. `JUMP-CONTROL`
6. `CPU`

### CPU flow

```text
instruction -> decoder -> register inputs -> ALU -> destination registers
                                      -> jump decision -> PC
```

### CPU responsibilities

The CPU must:

- Read the current instruction.
- Read the A and D registers.
- Read memory when the instruction needs it.
- Run the ALU.
- Write the selected destinations.
- Decide whether to jump.
- Update the program counter.

### Cornerstone project

**Single-instruction CPU laboratory**

Execute one instruction at a time. Show the instruction, registers, ALU inputs, ALU output, memory input, memory output, jump condition, and next PC.

## Cornerstone 9: memory plus CPU

### Build

1. `CPU-MEMORY-BUS`
2. `MEMORY-ADDRESS-DECODER`
3. `CPU-MEMORY`
4. `COMPUTER`

### Complete computer flow

```text
ROM -> CPU -> RAM
          -> screen memory
          -> keyboard memory
```

### Computer responsibilities

The computer must:

- Start at a known program address.
- Fetch instructions from ROM.
- Read and write RAM.
- Route memory addresses to the correct device.
- Update the screen when screen memory changes.
- Read keyboard state when requested.

### Final cornerstone project

**Nand2Tetris-style computer**

The user can load a machine-code program and watch it execute. The project should include:

- CPU
- Program ROM
- RAM
- Screen or a simpler output device
- Keyboard or a simpler input device
- Address decoder
- Clock and reset
- Instruction and data views

## Cornerstone 10: Hack assembly

The computer is not complete as a learning system until it can execute a named machine language.

Nand2Tetris uses the custom 16-bit Hack instruction set. This is not ARM. It is intentionally small so the relationship between instructions and hardware stays visible.

### Build

- Hack instruction reference
- A small assembly program format
- Labels and symbols
- A machine-code representation
- An assembly program viewer in the simulator

### Test programs

- Add two values.
- Find the maximum of two values.
- Fill a screen memory region.
- Read a keyboard memory location.

### Cornerstone project

**Hack assembly laboratory**

Load an assembly or machine-code program and show the current instruction, registers, memory access, and next program counter.

## Cornerstone 11: assembler

### Build

1. `SYMBOL-TABLE`
2. `PARSER`
3. `A-INSTRUCTION-ENCODER`
4. `C-INSTRUCTION-ENCODER`
5. `ASSEMBLER`

### Flow

```text
Hack assembly -> parser -> symbols and instructions -> Hack machine code
```

### Test

The assembler output must match known `.hack` programs exactly.

### Cornerstone project

**Assembler laboratory**

Show one assembly line, its parsed fields, and its resulting binary instruction.

## Cornerstone 12: virtual machine

The VM is an intermediate layer between a high-level language and Hack assembly. It is similar in purpose to bytecode systems such as the JVM, but much smaller.

### Build

1. `VM-STACK`
2. `VM-ARITHMETIC`
3. `VM-MEMORY-SEGMENTS`
4. `VM-BRANCHING`
5. `VM-FUNCTION-CALLS`
6. `VM-TRANSLATOR`

### Flow

```text
VM program -> VM translator -> Hack assembly -> assembler -> machine code
```

### Test

- Stack arithmetic.
- Push and pop across memory segments.
- Labels and branching.
- Function calls and returns.
- Recursion.

### Cornerstone project

**VM execution laboratory**

Show the stack, active function, call frame, translated Hack instructions, and current CPU state.

## Cornerstone 13: Jack-like language

Jack is the small Java-like, object-based language used by Nand2Tetris. It is not Java. It is designed to be simple enough to implement during the course.

### Build

- Integer and boolean values
- Variables
- Arrays
- Classes and objects
- Methods and functions
- Conditions and loops
- Strings
- Constructors

### Flow

```text
Jack source -> tokens -> syntax tree -> VM code
```

### Test programs

- A small calculator.
- A text output program.
- Pong, Snake, Tetris, or another small game.

### Cornerstone project

**Jack language laboratory**

Write a small program, show its syntax tree, compile it to VM code, translate it to Hack assembly, and run it on the computer.

## Cornerstone 14: Jack compiler

### Build in two layers

#### Compiler front end

- Tokenizer
- Grammar parser
- Syntax tree
- Type and symbol information

#### Compiler back end

- Expression code generation
- Variable access
- Method calls
- Object construction
- Array access
- Control-flow code generation
- VM output

### Flow

```text
Jack source -> compiler front end -> compiler back end -> VM code
```

### Cornerstone project

**Compiler laboratory**

For each source line, show the tokens, parsed structure, generated VM commands, Hack assembly, and executed result.

## Cornerstone 15: Jack operating system

This is the educational OS layer from Nand2Tetris. It is not a modern kernel like Linux. It is a collection of services that closes the gap between Jack programs and the Hack hardware.

### Build as independent services

1. `Math`
2. `String`
3. `Array`
4. `Memory`
5. `Screen`
6. `Output`
7. `Keyboard`
8. `Sys`

### Flow

```text
Jack application -> Jack OS service -> VM -> Hack assembly -> CPU and devices
```

### Test

- Memory allocation and release.
- Integer multiplication and division.
- String creation and manipulation.
- Screen drawing.
- Keyboard input.
- Program startup and shutdown.

### Final Nand2Tetris software project

**A Jack application running on the self-built computer**

The final demonstration should compile a Jack application, include the Jack OS services, translate the result through the VM and assembler, and run it on the constructed computer.

## Cornerstone 16: modern instruction-set bridge

After completing the Hack and Jack path, add a separate modern hardware branch.

### Choose a target

- `RISC-V RV32I` is a clear open instruction set for studying a modern reduced instruction set.
- `ARM Thumb` or `AArch64` connects the learning path to widely used commercial processors.

Do not mix this branch into the Hack chips. First learn the general concepts with Hack, then compare how another instruction set expresses the same ideas.

### Build

1. Instruction format reader
2. Register file
3. ALU and condition logic
4. Branch and jump logic
5. Load and store path
6. Assembler
7. Linker and object format reader
8. Calling convention and ABI examples
9. Small C or Rust program compiled for the target

### Flow

```text
C or Rust -> compiler -> object code -> linker -> ARM or RISC-V machine code -> CPU
```

### Cornerstone project

**Instruction-set comparison laboratory**

Run the same small program through Hack, RISC-V, and ARM representations. Compare registers, instructions, memory access, calling conventions, and generated code.

## Cornerstone 17: real operating-system bridge

The Jack OS is the educational endpoint of Nand2Tetris. A more realistic OS path comes after it.

### Build in this order

1. Bootloader
2. Assembly startup code
3. C or Rust runtime entry
4. Interrupt handlers
5. Timer and device drivers
6. Physical memory allocator
7. Virtual memory or an MMU model
8. Processes and context switching
9. System calls
10. Filesystem
11. Shell
12. Networking

### Flow

```text
firmware -> bootloader -> kernel -> drivers -> processes -> system calls -> applications
```

This is where the roadmap becomes a real operating-system study. It should be treated as a new architectural layer, not as a few extra chips inside the original Nand2Tetris computer.

## Recommended hardware project sequence

Build these projects in order:

1. `01-logic-gate-lab`
2. `02-selector-lab`
3. `03-16-bit-logic-panel`
4. `04-full-adder-lab`
5. `05-alu-lab`
6. `06-register-and-clock-lab`
7. `07-memory-map-lab`
8. `08-instruction-inspection-lab`
9. `09-single-instruction-cpu-lab`
10. `10-nand2tetris-computer`

## Recommended software project sequence

11. `11-hack-assembly-lab`
12. `12-hack-assembler`
13. `13-vm-translator`
14. `14-jack-language-lab`
15. `15-jack-compiler`
16. `16-jack-os`
17. `17-jack-application-on-computer`

## Recommended modern systems sequence

18. `18-risc-v-or-arm-assembly`
19. `19-abi-and-linker`
20. `20-bootloader-and-kernel-entry`
21. `21-interrupts-and-drivers`
22. `22-memory-protection-and-processes`
23. `23-filesystem-and-shell`
24. `24-networked-operating-system`

Each project should contain notes that explain:

- What the project does.
- What each main chip does.
- Which signal is the control signal.
- What changes after one clock step.
- Which next project uses this project as a part.

## Current Digital Logic Simulator gap

The current simulator now supports the hardware path through:

**logic -> routing -> arithmetic -> state -> memory -> instruction control -> composed CPU -> decoded CPU memory -> computer**

The teaching bundle includes general edge-triggered storage, registers, a counter and program counter, 16-bit bus conventions, instruction representation and decoding, CPU control logic, instruction ROM, memory-mapped I/O, a composed CPU, an explicit CPU-memory bridge, and a composed computer.

The remaining hardware work is mainly stronger diagnostics, more complete machine-code loading, and larger program tests. RAM, ROM storage, screen, keyboard, and DFF remain documented native engine boundaries.

After the hardware computer, the simulator also needs companion software tools:

- Hack assembly and machine-code loading.
- A Hack assembler.
- A VM language and VM-to-Hack translator.
- A Jack-like language editor and compiler.
- Jack OS service modules.
- A program runner with instruction, stack, memory, and call-frame inspection.

The ARM/RISC-V and real operating-system stages need an additional systems layer:

- A second instruction-set model.
- Assembly, object files, linking, and an ABI.
- Bootloader and kernel execution.
- Interrupts, drivers, memory protection, processes, and system calls.
- Filesystem, shell, and networking models.

The cleanest next cornerstone is therefore:

**DFF -> BIT -> REGISTER16 -> PC -> instruction decoder -> CPU -> COMPUTER -> ASSEMBLER -> VM -> JACK -> JACK OS**

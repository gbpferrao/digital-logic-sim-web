# ALU component map

The ALU examples are layered so each level can be opened and inspected as its own chip:

`HALF ADDER → FULL ADDER → ALU 1-BIT → ALU 4-BIT`

## Basic ALU

`ALU 1-BIT` has five one-bit inputs and two one-bit outputs:

| Control | Operation | Result | Carry |
| --- | --- | --- | --- |
| `OP1:OP0 = 00` | `A AND B` | logic result | `0` |
| `01` | `A OR B` | logic result | `0` |
| `10` | `A XOR B` | logic result | `0` |
| `11` | `A + B + CIN` | sum bit | carry bit |

Its reusable parts are:

- `HALF ADDER`: XOR plus AND.
- `FULL ADDER`: two half adders plus OR.
- `MUX 4:1`: selects one of the four operation results.
- carry gating: exposes carry only for the ADD operation.

The runnable example is [basic-alu.json](../../storage/projects/basic-alu.json).

## More sophisticated ALU

`ALU 4-BIT` repeats the one-bit slice four times. `A[3:0]` and `B[3:0]` are split into individual bits, the carry ripples from bit 0 to bit 3, and the result bits are merged back into `RESULT[3:0]`.

It exposes:

- `CARRY`: unsigned carry out from the most significant bit.
- `ZERO`: high when the four-bit result is zero.
- `OVERFLOW`: signed two's-complement overflow for ADD, computed from carry-in/carry-out of the most significant bit.

The additional reusable datapath component [ripple-adder-4.json](../../storage/chips/ripple-adder-4.json) is included separately for reuse, even though the ALU uses four `ALU 1-BIT` slices directly so its logic and arithmetic paths remain visible together.

The runnable example is [sophisticated-alu.json](../../storage/projects/sophisticated-alu.json).

## JSON layout

The standalone chip records live in `storage/chips/`. Each runnable project embeds the custom-chip descriptions it depends on in `customChips`, so it remains self-contained when loaded by the simulator. The standalone files are the reusable/library copies; the project copies are the simulation dependency bundle.

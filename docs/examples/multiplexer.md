# 2:1 multiplexer example

The project `storage/projects/multiplexer-2-1.json` is a small, inspectable
2:1 multiplexer. It uses one reusable custom chip, `MUX 2:1`, and that chip is
built directly from primitive gates:

    OUT = (D0 AND NOT SELECT) OR (D1 AND SELECT)

The internal circuit contains one NOT gate, two AND gates, and one OR gate. It
has one custom-chip layer: the example project places `MUX 2:1`, but the
multiplexer itself contains only native primitives and movable IN/OUT
interface nodes.

| SELECT | OUT |
| --- | --- |
| 0 | D0 |
| 1 | D1 |

Open the project, toggle the three input devices, then use Step or Bake. Double
click the multiplexer to inspect its internal gates and follow the selected
signal path.

The reusable chip record is [`mux-2-1.json`](../../storage/chips/mux-2-1.json).

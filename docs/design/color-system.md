# Interface color system

The interface uses grayscale as its visual language. Brightness, contrast, borders, and weight communicate hierarchy and interaction. Blue is not used as a default accent for buttons, panels, drawers, menus, dividers, status readouts, or help surfaces.

This rule applies to the editor chrome around the circuit. The circuit itself still needs color to communicate its own state, so canvas wires, pins, outputs, component swatches, signal states, displays, and user-selected note colors remain semantic.

## Palette tokens

The shared tokens live in the final `:root` block in `src/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--world` | `#242629` | Dark unobstructed canvas/world background |
| `--surface` | `#1d1d1f` | Shell and dark surface |
| `--surface-raised` | `#29292c` | Cards, drawers, and dialogs |
| `--surface-hover` | `#38383b` | Neutral hover surface |
| `--surface-active` | `#4b4b50` | Selected or active UI surface |
| `--ui-line` | `#4c4c4f` | Primary dark-surface divider or outline |
| `--ui-line-soft` | `#3b3b3e` | Quiet inner divider |
| `--ui-text` | `#e7e7e9` | Primary interface text |
| `--ui-muted` | `#a6a6aa` | Supporting text |
| `--ui-subtle` | `#85858a` | Tertiary text and metadata |
| `--ui-accent` | `#d7d7da` | Normal grayscale accent |
| `--ui-accent-strong` | `#f5f5f6` | High-emphasis text and active affordances |
| `--ui-focus` | `#d4d4d8` | Keyboard focus ring |
| `--ui-control` | `#303034` | Button/control surface |
| `--ui-control-hover` | `#414144` | Button/control hover |
| `--ui-control-active` | `#4b4b50` | Button/control active state |
| `--ui-control-border` | `#66666a` | Normal control border |
| `--ui-control-border-hover` | `#919196` | Hover/focus border |

The canvas grid uses a deliberate two-level contrast against `--world`: minor grid lines use the subdued `#2b2e33`, while every fifth grid line uses the slightly brighter `#353940`. The world fill is intentionally close to the minor grid now, so the canvas feels cohesive while the two grid levels remain readable. When zoom drops below 40%, minor lines are hidden because their 20-world-unit spacing becomes less than 8 viewport pixels; the major grid remains as the scale reference.

Light popup surfaces use the same grayscale scale in a separate set of tokens:

- `--ui-light-surface`, `--ui-light-surface-raised`, and `--ui-light-surface-hover` define popup backgrounds.
- `--ui-light-line` and `--ui-light-line-soft` define their outer and inner dividers.
- `--ui-light-text` and `--ui-light-muted` define popup text hierarchy.

## Simulation controls

Simulation controls use the same grayscale system as the rest of the interface. Their tokens are named by control role, not by hue:

- `--sim-run-border`, `--sim-run-text`, and `--sim-run-surface` identify the idle Bake/Clear treatment.
- `--sim-pause-border`, `--sim-pause-text`, and `--sim-pause-surface` identify the active Baking/Stop treatment.

The Bake rail follows the same interaction rule as every other UI button: borders remain structural and stable. Hover, active, selected, and disabled states are shown through fill, text/icon contrast, and opacity—not by changing the button stroke. The active Baking/Stop state uses the active grayscale fill; Clear is a normal action with the normal control fill and hover fill.

The bake scrubber uses the same hierarchy inside its range track:

- the filled progress portion and thumb use `--ui-accent-strong` (`#f5f5f6`) so the current history position is immediately legible;
- the unfilled portion is a faint white tint over the dark control surface, so it remains present without competing with the current position;
- a disabled or unavailable scrubber is muted by the enclosing rail's opacity rather than by introducing another color.

The progress fill is driven by the current bake cursor, while the scrubber remains mounted even when a bake has no meaningful history to navigate.

Saved/dirty markers and runtime warnings may use semantic colors. Those colors must stay tied to a clear state and should not become general-purpose UI decoration.

## Circuit-color boundary

Do not replace semantic circuit colors with the interface palette. Keep the component-family swatches, wire/pin/output colors, high/low/disconnected signal colors, display colors, error colors, and note colors where they explain the circuit or its runtime state. A color belongs in the UI palette only when it describes the editor control or surface around that circuit.

## Native component palette

Native chip body colors follow one simple heuristic: hue identifies the chip's functional family, brightness stays in a similar muted middle range, and small variants stay within the same hue family. The palette is for identity and navigation, not signal state. Green/gray wires and pins still communicate HIGH/LOW/disconnected behavior.

| Family | Native chips | Body color | Rationale |
| --- | --- | --- | --- |
| Logic | AND, OR, NOT, BUFFER, NOR, XOR, XNOR | `#706aa4` | Indigo-violet reads as abstract logic and keeps the full gate family together |
| Logic variant | NAND | `#8176b3` | A lighter member of the same logic family; it is distinct without implying failure |
| Timing/control | CLOCK, PULSE, KEY, 3-STATE BUFFER | `#9b8653` | Muted gold makes time, enable, and user-control devices easy to find |
| I/O | IN-*, OUT-* | `#4e8d91` | Teal suggests the boundary between the circuit and the outside world |
| Bus | BUS-* and BUS-TERMINUS-* | `#647488` | Steel blue-gray suggests shared pathways without competing with active green signals |
| Conversion | MERGE/SPLIT chips | `#5c8d78` | Sage green indicates transformation/flow while remaining separate from HIGH-state green |
| Memory | RAM and ROM | `#967451` / `#857654` | Muted ochre/brown gives storage a warm, physical feel without red warning semantics |
| Display | 7-SEGMENT, LED, DOT, RGB | `#5f7885` | Cool slate keeps display hardware visually calm; the display itself supplies the brighter runtime color |
| Audio | BUZZER | `#77738f` | Lavender-slate distinguishes sound output without using another warning-like warm color |

Red is reserved for invalid connections, errors, and other genuinely problematic runtime states. It is not used as a normal native chip identity color.

## Usage guidelines

- New buttons, toolbar groups, drawers, cards, menus, help dialogs, status readouts, and dividers start with grayscale tokens.
- Use `--ui-line` or `--ui-line-soft` according to the contrast needed by the surface. Light popups use the `--ui-light-*` equivalents.
- Use fill, text/icon contrast, and opacity to distinguish hover, active, selected, and disabled button states. Keep button borders/strokes structural and stable; do not use a brighter or colored stroke as the button-state highlight.
- Reserve `:focus-visible` outlines for keyboard accessibility. Focus rings are the deliberate exception to the stable-button-border rule.
- Use `--ui-focus` for keyboard focus so focus remains visible without competing with circuit colors.
- Keep the run-control tokens local to simulation controls. Their names describe state roles, while their values remain within the grayscale UI family.
- When adding a new runtime/circuit state, place its color with the semantic model or renderer/component palette rather than adding it to the UI chrome tokens.

## Review checklist

When adding or changing a UI surface, check that its normal, hover, active, focus, and divider colors all come from the grayscale token family. For buttons, verify that the state change is carried by fill, text/icon contrast, or opacity and that the border remains structural. Then verify that the change did not alter canvas semantics such as wire state, pin state, output state, component identity, or user-selected annotation color.

## Icon and signal audit

UI actions use the imported Lucide icon set. Icons in toolbars, menus, drawers, inspectors, and status controls inherit the grayscale interface tokens; they do not introduce blue as a decorative accent. A colored icon is appropriate only when it represents a circuit or runtime state.

Canvas signals use a smaller semantic set: green means a driven HIGH state, neutral gray means LOW or disconnected, and red is reserved for invalid connections or other errors. Input devices use the same state treatment as their outgoing wires, so an active input body and its signal read consistently. Display colors and user-selected output/annotation colors remain intentional circuit-specific exceptions.

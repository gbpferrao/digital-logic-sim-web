# Interface color system

The interface uses grayscale as its visual language. Brightness, contrast, borders, and weight communicate hierarchy and interaction. Blue is not used as a default accent for buttons, panels, drawers, menus, dividers, status readouts, or help surfaces.

This rule applies to the editor chrome around the circuit. The circuit itself still needs color to communicate its own state, so canvas wires, pins, outputs, component swatches, signal states, displays, and user-selected note colors remain semantic.

## Palette tokens

The shared tokens live in the final `:root` block in `src/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--world` | `#424245` | Unobstructed canvas/world background |
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

The canvas grid uses a deliberate two-level contrast against `--world`: minor grid lines use the recessed `#2f2f32`, while every fifth grid line uses the subtle highlight `#4a4a4d`. This keeps the working grid visible without letting it compete with circuit elements.

Light popup surfaces use the same grayscale scale in a separate set of tokens:

- `--ui-light-surface`, `--ui-light-surface-raised`, and `--ui-light-surface-hover` define popup backgrounds.
- `--ui-light-line` and `--ui-light-line-soft` define their outer and inner dividers.
- `--ui-light-text` and `--ui-light-muted` define popup text hierarchy.

## Simulation controls

The RUN/PAUSE control is intentionally an exception because it communicates simulation state, not interface hierarchy:

- `--sim-run-border`, `--sim-run-text`, and `--sim-run-surface` identify the runnable state with green.
- `--sim-pause-border`, `--sim-pause-text`, and `--sim-pause-surface` identify the paused/running-toggle state with amber.

Saved/dirty markers and other runtime warnings may also use green, amber, or red. These colors must stay tied to a clear state and should not become general-purpose UI decoration.

## Circuit-color boundary

Do not replace semantic circuit colors with the interface palette. Keep the existing component-family swatches, wire/pin/output colors, high/low/disconnected signal colors, display colors, error colors, and note colors where they explain the circuit or its runtime state. A color belongs in the UI palette only when it describes the editor control or surface around that circuit.

## Usage guidelines

- New buttons, toolbar groups, drawers, cards, menus, help dialogs, status readouts, and dividers start with grayscale tokens.
- Use `--ui-line` or `--ui-line-soft` according to the contrast needed by the surface. Light popups use the `--ui-light-*` equivalents.
- Use luminance and border weight to distinguish hover, active, selected, and disabled states; do not introduce a blue replacement accent.
- Use `--ui-focus` for keyboard focus so focus remains visible without competing with circuit colors.
- Keep the run-control tokens local to simulation controls. Do not reuse green or amber as generic button states.
- When adding a new runtime/circuit state, place its color with the semantic model or renderer/component palette rather than adding it to the UI chrome tokens.

## Review checklist

When adding or changing a UI surface, check that its normal, hover, active, focus, and divider colors all come from the grayscale token family. Then verify that the change did not alter canvas semantics such as wire state, pin state, output state, component identity, or user-selected annotation color.

## Icon and signal audit

UI actions use the imported Lucide icon set. Icons in toolbars, menus, drawers, inspectors, and status controls inherit the grayscale interface tokens; they do not introduce blue as a decorative accent. A colored icon is appropriate only when it represents a circuit or runtime state.

Canvas signals use a smaller semantic set: green means a driven HIGH state, neutral gray means LOW or disconnected, and red is reserved for invalid connections or other errors. Input devices use the same state treatment as their outgoing wires, so an active input body and its signal read consistently. Display colors and user-selected output/annotation colors remain intentional circuit-specific exceptions.

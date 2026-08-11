# Documentation

The docs are grouped by the question they answer. Start with the smallest
useful layer and move deeper only when you need implementation detail:

1. **How is the system built?** Read [`architecture/system.md`](architecture/system.md).
2. **How does a behavior flow through the runtime?** Read the specialized
   architecture notes in [`architecture/`](architecture/), especially
   [`simulation-bake.md`](architecture/simulation-bake.md),
   [`xray.md`](architecture/xray.md), and the
   [`Nand2Tetris engine boundary`](architecture/nand2tetris-engine.md).
3. **Why does an interaction behave this way?** Read the focused reports in
   [`architecture/interaction/`](architecture/interaction/).
4. **How should the interface look and signal state?** Read
   [`design/color-system.md`](design/color-system.md).
5. **What can I inspect and learn from?** Open the runnable explanations in
   [`examples/`](examples/), including the layered ALU and 2:1 multiplexer.
6. **Where is data persisted?** Read [`reference/storage.md`](reference/storage.md).

## Topology

```text
docs/
├── architecture/          system and runtime behavior
│   └── interaction/       selection, pan, zoom, and pointer audits
├── design/                visual language and UI contracts
├── examples/              inspectable circuit walkthroughs
└── reference/             persistence and integration details
```

The root [`README.md`](../README.md) remains the project entry point for
running, testing, and hosting the application. This page is the index for the
deeper documentation set.

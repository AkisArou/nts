@AGENTS.md

# For Claude sessions on nts

The user's standing rules for this project:

- **The bar is clean architecture, good DX and performance, with no hacks.**
  Performance is the reason nts exists: the goal is to beat node on every
  benchmark row. Fix a cause where it lives rather than working around it
  downstream, and land only through the gate.
- **Features and conformance come first; compile time is guarded, not chased.**
  Each module has a compile-time tripwire in the gate. Fix only super-linear
  blow-ups until told otherwise.
- **Codex is retired.** Its work survives as archived branches
  (`refs/archive/codex/...`), a quarry: port an independent fix to `main` on its
  own, with its own fixture and gate. Never land that work wholesale.
- **Tooling is written in TypeScript**, run with node; not new `.mjs` files.
- **Keep upstream code as upstream wrote it** (node's tests, React, test262) and
  report the gap, rather than editing their code to pass.
- **Show every benchmark result** as it is produced, with its ratios, the
  machine's conditions, and whether it is a regression, an improvement or noise,
  including the rows where nts loses. A new method is done when it has a
  benchmark row.
- **`~/Projects/native-typescript` is a frozen proof of concept.** Its decision
  records and specs are evidence; never transliterate its code into nts.
- **Install a missing Arch package for a toolchain yourself** (`paru -S`), but
  never make nts itself depend on a system package.

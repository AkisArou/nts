# Tests

What nts must pass: every program and fixture the gate runs the compiler
against, one kind per directory, each fixture at `tests/<kind>/<name>/`. What
is measured rather than passed is under [`../benchmarks/`](../benchmarks).

A fixture moves between kinds with a plain `git mv`: a fixed outcome becomes a
program, a refusal that now compiles becomes a program. Its tsconfig's
`extends` does not change, since every kind sits at the same depth.

| Kind | What a fixture is | What runs it |
| --- | --- | --- |
| [`programs/`](programs) | A program compiled, run and compared with node. Many are a specific test's input: check before editing or reusing one. | `examples`, `llvm`, `llvm-rc`, `jvm`, `rc`, `integrity`, `example-refusals`, `dex`, `frontend-tsrs` |
| [`refusals/`](refusals) | A program the compiler must refuse, with the message its `// expect:` line names. | `blockers`, `integrity` |
| [`outcomes/`](outcomes) | A recorded wrong answer or crash (`outcome.json`), then a guard once fixed. | `outcomes`, `integrity`, `jvm-verifies` |
| [`agreements/`](agreements) | Node-agreement seam cases. | `tooling/conformance/agreement.mjs` |
| [`memory/`](memory) | A program with the live-object counts it may reach (`expected`). | `memory` |
| [`interop/`](interop) | A native platform project (GTK, Apple, Windows, Java, N-API...), each built by its `build.sh`. | `interop` |
| [`gjs/`](gjs) | GNOME Workbench ports, written as GJS writes them. | `tooling/gjs-corpus/run.sh` |
| [`workspace/`](workspace) | The build-system fixture: `nts.config.ts` products across packages. | `config` |

## Adding one

- **A defect** is a fixture with a **control** that differs from it in one thing
  and agrees with node, so the pair shows what breaks it (`AGENTS.md`).
- A new refusal or outcome whose refused function runs at module scope cuts that
  statement: register the cut in `tooling/conformance/integrity.known` in the
  same commit.
- Run a new fixture against the previous compiler too: if it passes on both, it
  does not test the fix.
- `node tooling/gate/owed.mjs --commit HEAD` says which steps the new fixture
  owes.

## Where these used to be

Until 2026-10-14 these were the root's examples directory (the programs, and
its interop, gjs-corpus and workspace), the blockers, outcomes and agreements
directories under tooling/conformance, and the memory cases and Wasm fixtures
under tooling.
[`../tooling/migrate/table.ts`](../tooling/migrate/table.ts) is the map, and
the `old-paths` gate step fails on anything placed or named at an old path.
`docs/records/` keeps the paths it was written with.

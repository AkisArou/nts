# How nts works

The pipeline from TypeScript to each target, how memory is chosen, and where
each part lives in the repository. [`README.md`](../README.md) says what nts is.

## The pipeline

```text
TypeScript / TSX
      ▼
tsrs in process, through its safe native adapter      →  semantic snapshot
      ▼
HIR lowering        typed SSA; every operation carries its source origin
      ▼
HIR preparation     specialization · simplification · escape and ownership
      │             analysis · reference counting where selected · verification
      ▼
C (→ clang) · LLVM IR · JVM class files (→ DEX) · WasmGC (via Binaryen IR) · N-API addons
```

`compiler/frontend-tsrs` owns the native checker's sessions and borrowed views.
`compiler/frontend-ts` captures their facts into the versioned semantic snapshot (`compiler/semantic-schema`); core and backends read only that snapshot. Backends emit
what preparation decided and decide nothing a sibling backend would decide
differently.

**Memory is chosen per build, not per backend.** `hir::Memory` has three:

- `NoGc` allocates and never frees: for testing, never shipped.
- `HostGc` leaves the heap to a managed host: the JVM or ART collector, or WasmGC.
- `ReferenceCounting` counts, with a cycle collector behind it.

`nts build` counts references on native targets unless told `--nogc`; the
inspection commands (`check`, `emit-c`, `hir`, ...) keep `NoGc` unless told
`--rc`. Before any count is emitted, escape analysis places objects that never
leave a call in its frame, and counts the compiler can prove unnecessary are
elided.

Products and targets are declared in `nts.config.ts` ([reference](reference/nts-config.md)). Which implementation of each builtin a target uses is [builtins](foundations/builtins.md); where each target runs is [targets](targets/README.md).

## The runtimes

Each backend has one runtime, linked or bundled only where a program uses it:

- `runtime/c`: the C runtime that C and LLVM programs share, with the vendored libraries it builds on (zmij, ffc, simdjson and others: [foundations](foundations/README.md)).
- `runtime/jvm`: the JVM runtime (`nts.rt`), in Java 8.
- `runtime/ecmascript` and `runtime/web-platform`: builtins written in TypeScript, compiled with the program that uses them (Intl, Temporal, RegExp, the web APIs).
- `runtime/node`: node's APIs, for native programs.
- Platform runtimes beside them: `runtime/gtk`, `runtime/objc`, `runtime/winrt`, `runtime/chromium`, `runtime/react`.

## Repository layout

```text
compiler/       frontend-ts (capture), frontend-tsrs (safe native adapter), semantic-schema, core (HIR), codegen/{c,llvm,jvm,napi,common},
                jvm-emitter (class files), diagnostics
runtime/        c, jvm, node, ecmascript, web-platform, native, chromium, react, gtk, objc, winrt, sdk
tooling/        cli (the `nts` binary), gate, conformance, census, bench, differential, suite, deps,
                config, and per-platform scripts
build/          the build model behind `nts build`
tests/          the corpora: programs compared with node, refusals, outcomes, memory, interop
benchmarks/     benchmark cases with C++ and Java references
results/        what the tools measured: benchmarks, test262, conformance records
docs/           language, foundations, targets, reference, conformance, contributing; records hold the evidence
third_party/    tsrs, typescript (corpus), test262, node, chromium and other pinned dependencies
```

## Decisions

- The frontend is tsrs, called in process; tsgo and every transport to it are gone, with no intermediate steps ([log](records/notebooks/decisions-log.md#frontend-tsrs)).
- A local patch to the vendored tsrs is allowed only for the two checker crashes it was made for, and goes when an upstream release fixes both.
- Shipped native programs count references; `NoGc` is for testing only ([log](records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).

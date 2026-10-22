# How nts works

The pipeline from TypeScript to each target, how memory is chosen, and where
each part lives in the repository. [`README.md`](../README.md) says what nts is.

## The pipeline

```text
TypeScript / TSX
      ▼
tsgo (the Go TypeScript compiler), asked over its API   →  semantic snapshot
      ▼
HIR lowering        typed SSA; every operation carries its source origin
      ▼
HIR preparation     specialization · simplification · escape and ownership
      │             analysis · reference counting where selected · verification
      ▼
C (→ clang) · LLVM IR · JVM class files (→ DEX) · WasmGC · N-API addons
```

Only `compiler/frontend-ts` talks to the TypeScript compiler; everything after it
reads the versioned semantic snapshot (`compiler/semantic-schema`). Backends emit
what preparation decided and decide nothing a sibling backend would decide
differently.

**Memory is chosen per build, not per backend.** `hir::Provider` has three:

- `NoGc` allocates and never frees: for testing, never shipped.
- `HostGc` leaves the heap to a managed host: the JVM or ART collector, or WasmGC.
- `ReferenceCounting` counts, with a cycle collector behind it.

`nts build` counts references on native targets unless told `--nogc`; the
inspection commands (`check`, `emit-c`, `hir`, ...) keep `NoGc` unless told
`--rc`. Before any count is emitted, escape analysis places objects that never
leave a call in its frame, and counts the compiler can prove unnecessary are
elided.

Products and targets are declared in `nts.config.ts`; [`nts-config.md`](nts-config.md) is that design.

## Repository layout

```text
compiler/       frontend-ts (tsgo), semantic-schema, core (HIR), codegen/{c,llvm,jvm,wasm,napi,common},
                jvm-emitter (class files), diagnostics
runtime/        c, jvm, node, ecmascript, web-platform, native, chromium, react, gtk, objc, winrt, sdk
tooling/        cli (the `nts` binary), gate, conformance, census, bench, differential, suite, deps,
                config, and per-platform scripts
build/          the build model behind `nts build`
tests/          the corpora: programs compared with node, refusals, outcomes, memory, interop
benchmarks/     benchmark cases with C++ and Java references
results/        what the tools measured: benchmarks, test262, conformance records
docs/           designs, lane notebooks, ideas, and the decision records
third_party/    typescript-go, test262, node, chromium and other pinned dependencies
```


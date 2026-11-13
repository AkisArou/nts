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

Lowering enters through [`hir/lower.rs`](../compiler/core/src/hir/lower.rs).
Its `lower` and `lower_with` entry points assemble the shared program context and
order the lowering pipeline. The parent module also owns `FuncBuilder`, its
shared state, and the primitives for constructing operations and blocks.
The modules under [`hir/lower/`](../compiler/core/src/hir/lower/) implement
specific responsibilities, including inherent `FuncBuilder` methods. They use
the parent's shared types and state within the same Rust module hierarchy.

| Responsibility | Starting points |
| --- | --- |
| Snapshot facts and diagnostics | [`snapshot_queries.rs`](../compiler/core/src/hir/lower/snapshot_queries.rs), [`diagnostics.rs`](../compiler/core/src/hir/lower/diagnostics.rs) |
| Representations and storage layouts | [`representations.rs`](../compiler/core/src/hir/lower/representations.rs), [`object_layouts.rs`](../compiler/core/src/hir/lower/object_layouts.rs), [`member_layouts.rs`](../compiler/core/src/hir/lower/member_layouts.rs) |
| Module bindings and body planning | [`module_bindings.rs`](../compiler/core/src/hir/lower/module_bindings.rs), [`module_evaluation.rs`](../compiler/core/src/hir/lower/module_evaluation.rs), [`capture_discovery.rs`](../compiler/core/src/hir/lower/capture_discovery.rs) |
| Body emission and calls | [`body_entries.rs`](../compiler/core/src/hir/lower/body_entries.rs), [`call_expression.rs`](../compiler/core/src/hir/lower/call_expression.rs), [`closure_bodies.rs`](../compiler/core/src/hir/lower/closure_bodies.rs) |
| Control flow and suspension | [`loop_flow.rs`](../compiler/core/src/hir/lower/loop_flow.rs), [`exceptions.rs`](../compiler/core/src/hir/lower/exceptions.rs), [`suspended_bodies.rs`](../compiler/core/src/hir/lower/suspended_bodies.rs) |
| Objects and collections | [`property_presence.rs`](../compiler/core/src/hir/lower/property_presence.rs), [`array_methods.rs`](../compiler/core/src/hir/lower/array_methods.rs), [`typed_arrays.rs`](../compiler/core/src/hir/lower/typed_arrays.rs) |
| Builtins and promise jobs | [`string_builtins.rs`](../compiler/core/src/hir/lower/string_builtins.rs), [`promise_settlement.rs`](../compiler/core/src/hir/lower/promise_settlement.rs), [`promise_reactions.rs`](../compiler/core/src/hir/lower/promise_reactions.rs) |
| Foreign ABI and platform registration | [`foreign_arguments.rs`](../compiler/core/src/hir/lower/foreign_arguments.rs), [`foreign_results.rs`](../compiler/core/src/hir/lower/foreign_results.rs), [`objc_class.rs`](../compiler/core/src/hir/lower/objc_class.rs), [`gobject_class.rs`](../compiler/core/src/hir/lower/gobject_class.rs), [`com_class.rs`](../compiler/core/src/hir/lower/com_class.rs) |

The conditional [`lower/tests.rs`](../compiler/core/src/hir/lower/tests.rs)
module retains the `hir::lower::tests` scope. Other focused test modules live
beside the responsibilities they exercise.

## Decisions

- The frontend is tsrs, called in process; tsgo and every transport to it are gone, with no intermediate steps ([log](records/notebooks/decisions-log.md#frontend-tsrs)).
- A local patch to the vendored tsrs is allowed only for the two checker crashes it was made for, and goes when an upstream release fixes both.
- Shipped native programs count references; `NoGc` is for testing only ([log](records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- Every analysis, search and recursive query converges by construction or
  fails closed. One that stops early, at a round, depth or work budget, gives
  everything it did not finish the conservative answer, or refuses, with a
  named reason; a cap kept only as a backstop against a bug fails closed
  too. A search that stops early never answers as if it were complete: a
  cut-off ancestry walk, alias chain or set of type parameters is unknown,
  not empty. No analysis publishes an unfinished optimistic answer. A sparse
  monotone worklist, which reaches its fixed point without a cap, is
  preferred to any cap. [Memory](foundations/memory.md#principles)'s
  "fail closed" is this rule for the memory analyses
  ([log](records/notebooks/decisions-log.md#compiler-10-29)).
- The compiler keeps none of its own work between runs: every compile reads
  and analyses the whole program, and the compiler is made fast by doing less
  work, never by reusing earlier results. A cache of the compiler's work is
  the last resort. Caches of another tool's work stay where each is keyed on
  every byte that tool reads: clang's objects in `build.cache`, and the
  compiled runtime the checks reuse
  ([log](records/notebooks/decisions-log.md#the-compiler-is-made-fast-not-cached-11-10)).

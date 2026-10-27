# Typed collector visitor verification

Source ff2426c11ca0a8f6ceeb217a025c0ec5e00aae06, against landed integer-Min/Max base d3a1d29fd. Format, runtime C format, workspace clippy with warnings denied, the native/common and all four backend test crates, and the native frontend tests passed (946 Rust tests). A plain cargo build --release built the whole workspace before the paired artifacts.

The runtime collector algorithm and ordinary death are unchanged. The nullable native descriptor callback replaces fixed-field discovery only. Arrays, maps, holders and handwritten descriptors preserve their existing paths; the runtime processes holder edges before dispatching fixed fields. C and LLVM render from the same managed/erased field plan as owned cleanup. No new public helper, helper-table row, HIR operation or schema change is introduced.

## Executed controls

Runtime tests exercise live anchored cycles and dead cycles, duplicate edges, an acyclic child of a cycle, ordinary typed and generic death, boxed bigint, null/scalar erased slots, a non-null native handle and a managed/foreign holder cycle. Both plain RC and POISON plus ASan/UBSan pass. Counts and live bytes balance, foreign slots clear before finalization, and holders sever before ordinary objects are freed.

Generated factory results exercise inherited/private and erased slots, captured managed closure fields and fixed tuple fields. The runtime driver checks the descriptor callback and invokes its exact edge list; instrumentation in test copies proves actual collector dispatch. Compiled NULL callback-slot mutations leave definitions present but fail the executed guard on both C and LLVM. NoGC emits no tracing functions and stores NULL. Six native target modules assemble with the appended descriptor field; native C/LLVM execution compares descriptor size and both callback offsets.

## Corpus and unchanged backends

```text
== agree c
  749 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 115 s
== agree llvm
  749 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 114 s
== agree jvm
  749 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 75 s
== agree wasm
  wrong, both   array-with                                       backend declined
  748 agree, 10 agree on part of their cases, 12 compared nothing, 1 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 106 s
== agree c rc
  749 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 123 s
== agree llvm rc
  749 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  771 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 128 s
```

The Wasm array-with refusal is the unchanged known result. All six comparisons have zero regressions, changes, unstable programs or missing measurements. Twelve prepared-HIR pairs and six JVM/Wasm output sets are byte-identical, recorded in unaffected.json. The initial missing-field warnings in two RSS-fixture descriptors and an import-position lint were corrected before the final green Rust pass.

## Measurement

paired.md reports all rows, every bracket, host launches, RSS and host/gate conditions. The native comparison is five A/B/A brackets on CPU 4 under with-lock; each host has five separate launches with its median and spread. All arms perform the same number of hot calls and validate checksum plus the repeated-addition aggregate. Hot-window counters require at least 99% PMU running time. The release/value-release inline budgets, linked text, descriptor bytes and tracing-function bytes are included per program. Attribution separates field enumeration and indirect visitor calls from trial-deletion work.

Raw commands, outputs, programs, profiles and reproducing scripts: /home/akisarou/.cache/nts-scratch/runtime-20261027/typed-trace-ab.

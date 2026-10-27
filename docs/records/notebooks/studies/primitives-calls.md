# Calls study (C and LLVM only): report

Saved by MainClaude from the calls study's final message, 2026-10-22. Branch `compiler/prim-calls` in ~/.cache/nts-scratch/primitives/calls/tree: two WIP commits on 5a2242da2, c68c293e4 and c5a139bad (686 lines). Prototype binary: ~/.cache/nts-scratch/primitives/calls/bin-p1b-nts. Timings in ab/sitting.txt, hand-edits in exp/, the correctness probe in probe/guards/, the build scripts in rig/.

## The decisive experiment (CPU 4, with-lock, 3 interleaved rounds, ns/op min; nts-bench flags -O2 -flto, RC; off/on = one binary with `NTS_NO_CLASS_GUARDS=1`)

| row | C off | C on | LLVM off | LLVM on | node | Bun |
|---|---|---|---|---|---|---|
| uniform-callback | 2928 | 522 | 2928 | 522 | 2363 | 939 |
| uniform-callback-arguments | 5639 | 808 | 5439 | 822 | 3171 | 1285 |
| uniform-callback-default | 3177 | 616 | 2962 | 694 | 2487 | 933 |

- The off arms reproduce the 2026-10-22 bench within 2-5%, and every checksum is identical.
- Instructions per op: 104.8k → 22.6k, 201k → 32k, 107k → 26.5k.
- **generator-dispatched:** 11.9M → 2.9M instructions per op; a hand-edit timed 598 → 166 µs.
- **closure-merge:** 115k → 103k instructions.

## The prototype

1. **`compiler/core/src/hir/class_sets.rs`** (core): the concrete classes a call's receiver can hold.
   - Joined over allocations through block parameters, a local array only read, written and measured, and the arguments of every direct caller of a function nothing else can enter (the interprocedural wall).
   - For `Callee::Closure` and `Callee::Virtual` with at most 2 classes: an `instanceof` per class, then a read-back, then a direct call.
   - Anything else ends in `nts_refused` (only null can get there). There is no fallback dispatch: any indirect call ends a borrow for the whole function (`own::slot_survives`). With a fallback it measured 1927 ns against 552 without.
   - Wired after `reshape_calls`, with `NTS_NO_CLASS_GUARDS` for A/B.
2. **`own.rs` (+28):** an erase, or its read-back, of a whole-life borrow is itself a borrow. Otherwise the class test's erase took back the count the borrow saved.

## Why native lost (uniform-callback, ns/op)

| variant | ns/op |
|---|---|
| baseline | 3128 |
| no RC in the loop | 2601 |
| typed adapter | 2724 |
| guard with fallback | 1927 |
| closed guard | 1642 |
| guard without the closure's retain/release | 985 |
| **guard + borrows** | **552** |

- The indirect call blocks inlining, so the FP accumulator spills to the stack across it.
- Every element read across an unknown call is retained and released, with `nts_env` counters and an out-of-line release.
- **Packing arguments (Q3):** each argument is a 16-byte tagged `NtsValue` (two registers, on the stack past the sixth), with a 10-14 instruction RC ladder and an unbox in the callee: 197 instructions per iteration against 103, and 30 against 20 once devirtualized.

## What's known statically but unused (Q2)

- `reachable::Dispatch` knows the allocated closure frames and used slots, but only prunes with them.
- `fields::closures` and `monomorphize` handle one class only, and `small_dispatch` two classes for interface fields only.
- Nothing computed sets for receivers from phis, arrays or parameters, or for virtual calls. The awfy `innerBenchmarkLoop` calls become direct too.

## fib (Q4)

| fib variant | µs |
|---|---|
| nts: i32 param, double result | 561 |
| C++: int64 with tail-recursion elimination | 311 |
| int64 with TRE blocked | 543 |
| double result with TRE by hand | 389 |
| int64 with overflow check | 723 |

The gap is clang's tail-recursion-with-accumulator transform, legal for an integer add and not for an FP add, so record 0049 is incomplete. Closing it needs an integral bounded result type, or the transform done by nts (exact only below 2^53). That's numbers-control's question.

## Proposal and staging

1. **Stage 1:** land `class_sets` (complete sets, at most 2 tests, no fallback) plus the own.rs borrow rule. Fixtures to pin:
   - a hole or null receiver;
   - calls inside `try`;
   - a closure reading `this`;
   - an escaping array (untouched);
   - 3 classes (past the cap);
   - recursion passing the parameter on;
   - generators through a parameter.
   Also update the uniform-callback cases' expect-ir lines, which assert one `call.closure`.
2. **Stage 2:** field and return-value sets.
3. **Stage 3:** call-site split plus monomorphize. A closure-merge hand-edit went 5813 → 2276 ns, against 3499 for guards alone.
4. **Stage 4:** typed adapters (−13%), and the RC counters out of release builds.

**Rows to add:**
- a typed bimorphic closure array;
- 3- and 8-class closure arrays;
- a virtual call with 2 subclasses through an array;
- rest and default arguments in a loop;
- recursion with an integer result.

**Not verified:**
- no gate run, agree, or records;
- no JVM or Wasm, including the JVM's 325-byte inlining cliff;
- 12 of 70 cases emit different C, and only 5 were measured;
- the probe agreed on 227 of 319 cases with the pass on and off alike.

**Behaviour change:** a call through a null receiver now stops with `nts_refused`, where it used to SIGSEGV.

**A pre-existing defect:** an object-literal `function (this: {k: number})` called through an array aborts on C (probe/guards/withthis.ts.txt).

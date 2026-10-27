# numbers-control (C and LLVM): report

Saved by MainClaude from the study's final message, 2026-10-22. Worktree ~/.cache/nts-scratch/primitives/numbers-control/tree, branch compiler/prim-numbers, on main 5a2242da2:
- WIP 8f06e3a96: three async benchmark rows;
- WIP d943a8dd9: the outcome fixture `tests/outcomes/a-wrapping-add-compared-with-its-operand-llvm`, recorded on main.
Experiments in exp/{fib,flags,intsum,nbody,async}, tables in notes/. Timings: CPU 4 under with-lock, the harness's main.cpp, best of 5, `-O2 -flto`, round-robin with a base arm at both ends.

## Correctness defects (C/LLVM)

1. **LLVM miscompiles wrapping i32 arithmetic.** `narrow::narrow_truncated` computes `| 0` chains at 32 bits, meant to wrap, but the LLVM backend emits `add nsw`/`mul nsw` for every signed i32 (codegen/llvm/src/lib.rs:5610-5620). clang then folds `((h+1)|0) > h` to true. The fixture's `wrapsPastMax` answers 10 on LLVM against 9 on node and C, and all 29 cases disagree; its control agrees. C's emit.rs:5238 comment, "LLVM's add carries no nsw", is false.
2. **FMA contraction is unguarded.** No build passes `-ffp-contract=off`, and clang's default is `on`. With `-march=x86-64-v3` the C++ references for mandelbrot and nbody fail their own verification. nts's program code escapes only because it emits one operation per statement; runtime C expressions would contract on any FMA CPU, aarch64 included.

## Rows

### fib (1.70× C++)

The cause is LLVM's accumulator tail-recursion elimination, which needs an associative `+`: never for f64, never for a checked add.

| variant | µs per fib(27) | sound? |
|---|---:|---|
| C++ int64 | 319.6 | — |
| nts today | 540.8 | yes |
| checked variants | 555-698 | yes |
| **today's types, recursion inlined one level** | **393.7 (0.73×)** | yes |

The sound lever is one level of recursive inlining, which HotSpot and V8 do. It goes to the calls area.

### elementwise (Java 2.3× faster)

The cause is vector width × element alignment.
- SSE2 today: C 131 µs, against C++ 149.
- AVX2 with today's 16-byte-aligned elements: C 157 (worse), with 792M split loads.
- AVX2 with 32- or 64-byte alignment: 74 µs, equal to C++ (75); Java is 59.7.

So 32-byte element alignment is the memory study's representation question, and `-march` is the user's.

### nbody (1.11× C++)

The array-of-references layout and the reloads are refuted as causes; `-fno-math-errno` and AVX2 don't move it either. The 10% isn't found.

### async rows (committed WIP; µs)

| row | nts C | LLVM | NoGC | C++ | node | Bun |
|---|---:|---:|---:|---:|---:|---:|
| async-await-chain | 474.7 | 481.7 | 526.5 | 77.5 | 325.4 | 333.3 |
| promise-all | 262.0 | 261.9 | 346.6 | 94.4 | 171.5 | 161.3 |
| microtask-loop | 199.0 | 198.6 | 206.7 | 26.0 | 234.4 | 157.4 |

- About 66% of the chain is object lifetime (release 22%, release_foreign 15%, each_reference 13%, destroy 8%, collect_cycles 4%), and NoGC is no faster. So the cost is about 28 objects per round, against C++'s 9 frames.
- **Proposed** (estimated, not measured):
  - the promise as the frame's prefix;
  - `await` of a non-thenable enqueues the frame;
  - the first waiter inline;
  - no frame/promise/reaction cycles;
  - facts across `suspend`.
- The harness can't time a Promise-returning entry: it needs `nts_promise_join` drivers and `measureAsync`.

## Other A/B results

- **Flags:** `-ffp-contract=off -fno-math-errno` are noise on 20 rows, so ship them.
- **`-march=x86-64-v3`** (ratios against `-O2 -flto`):

  | row | ratio |
  |---|---:|
  | exceptions | 0.31 |
  | dispatch (LLVM) | 0.35 |
  | logical-assignment | 0.67 |
  | user-iterable (LLVM) | 0.72 |
  | accumulate (C) | 0.77 |

  It loses on elementwise until elements are aligned.
- **`nts build` (-O2, no LTO) against the bench:**

  | row | LLVM | C |
  |---|---:|---:|
  | awfy-permute | 2.99× | 1.30× |
  | awfy-queens | 2.57× | 1.39× |
  | awfy-towers | 2.20× | 1.20× |
  | bigint | 1.35× | 1.36× |

  Runtime helpers are inlined only by LTO, **so the README overstates shipped speed by up to 3×.**
- **awfy-sieve on C:** 6.48 µs with LTO, 3.65 µs without (for CompilerHelper's C-vs-LLVM item).
- **nsw stripped from the emitted IR:** user-iterable 39.3 → 33.1 (equal to C) and queens 11.94 → 11.02, but sieve 4.27 → 6.10. So the fix needs a core fact, not a blanket removal.
- **Speculative accumulator** (sum of 4096 int32): f64 1.35 µs; i64 checked once per 256-element block (exact) 0.40, 3.4× faster; C++ 0.36.

## Proposed design and landing plan

1. **The LLVM nsw fix** (the fixture flips to a guard), as an `overflow: Exact | Wraps` bit on core integer Add/Sub/Mul/Neg. `specialize` sets Exact, `narrow`/`imul` set Wraps, and LLVM emits nsw only on Exact.
2. **Flags:** `-ffp-contract=off -fno-math-errno` everywhere, with a runtime-C contraction fixture.
3. **LTO in `nts build`** (ThinLTO, or helper bitcode for LLVM), plus a bench mode that builds like the product.
4. **Math core ops:** `imul`, `clz32` (refused today), `sign`, `fround`; Min/Max on i32 (missing from specialize's list, specialize.rs:462). glibc differs from V8 by 1-3 ULP (cbrt 53% of inputs, hypot 35%, sin 3%); V8's fdlibm `ieee754` would match bit for bit.
5. **Loop-level speculative accumulators** (the block-check shape).
6. **Async object fusion.**
7. **`-march` plus 32-byte alignment,** once the user decides.

## Rows to add

int-sum, imul-hash, math-rounding, math-transcendental, bigint-mulmod, bigint-u64 (splitmix64 via `asUintN(64)` aborts today), typed-f64-map, typed-i32-reduce, typed-u8-write, queue-microtask, and the exceptions variants (across a call, deep, guarded with no throw, finally, instanceof).

## User decisions

1. The ISA level.
2. Bit-exact Math against V8.
3. bigint past signed 128 bits.
4. Whether the bench builds like `nts build`.

## Read and probed, not timed

- Two silent wrong answers on all four backends (a throwing override called through a base, and a closure in a field, inside `try`); both are existing outcomes.
- Runtime faults abort instead of throwing.
- JVM: `Promise.race` plus array growth gives a VerifyError (async/probes/race-jvm-grown).
- bigint `~b` gives invalid HIR (math/bignot).
- Typed arrays on C/LLVM: two out-of-line calls per element, and no vectorization.
- Generator frames on Wasm aren't scalarized (scalarize refuses an object passed to a call).

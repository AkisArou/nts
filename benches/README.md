# Benchmarks

```sh
cargo build --release -p nts-bench
NTS_TSGO=$PWD/target/tsgo ./target/release/nts-bench          # everything
NTS_TSGO=$PWD/target/tsgo ./target/release/nts-bench fib      # one case
```

Needs `clang` and `node` on `PATH`.

## What is being compared

Each case is one TypeScript source compiled four ways. The numbers that matter
are the gaps between them, not any single column.

| Variant   | What it is                                          | What the gap means                    |
| --------- | --------------------------------------------------- | ------------------------------------- |
| `C++`     | hand-written C++, what a C++ programmer would write | the ceiling                           |
| `nts`     | `src/main.ts`, compiled by this compiler            | —                                     |
| `nts f64` | the same, with number specialization **off**        | the gap is what the analysis is worth |
| `node`    | the same `.ts`, run on V8                           | the thing being replaced              |

`nts f64` is the column that makes a speedup a measurement rather than a claim:
one program, compiled two ways, run against each other.

**One reference per case, and it is C++.** There used to be two, `C (double)`
and `C (int)`, because it was not obvious which was a fair ceiling — and this
file carried a footnote apologising for that. The double one was really
answering "what does the conservative lowering cost", and `nts f64` answers that
better: it measures the compiler's actual output rather than a hand-written
simulation of it. So the reference is singular now and means one thing — what a
C++ programmer writes — and each `ref.cpp` says in a comment why that is what it
is for that program.

That makes `nts/C++` a ratio worth printing. It is not always reachable: `fib`'s
C++ uses `int64_t`, which nts cannot choose from the type `number` because
`fib(93)` overflows it. The row shows the gap rather than hiding it behind a
choice of reference. `fib` is also where that ratio was decomposed rather than
guessed at — compiling the reference a second time with an `int32_t` parameter
and a `double` result gives 485.93us against its own 301.96us, so 1.61x of its
1.70x is the representation and 6.5% is this compiler.

## Three kinds of row, and only one is about real programs

The table mixes three things and they are not the same evidence.

**Ported.** The eight `awfy-*` rows are Are We Fast Yet's own programs,
transcribed rather than rewritten, and its C++ port is the reference. Nobody
here chose what they do.

**Probes.** `elementwise` exists to ask whether the loop counter narrows to an
integer; `checksum` whether integer work stays integer; `erasure-*` what a
tagged value costs, in pairs where the two programs differ in exactly one thing.
These are diagnostics. They are worth having and they are *not* evidence about
real code, because the program was chosen knowing what would be measured.

**Real code.** `node-utf8` is the first: `runtime/node/internal/utf8.ts`,
imported unmodified, which is 176 lines of the Node implementation in this
repository written to *be* Node. It had been compiled only for reach — the
profile asks whether it lowers and nothing ever ran it.

It earned its place immediately. It was refused on the first attempt, because
`String.fromCharCode(a, b)` was not lowered and that is how the decoder writes a
surrogate pair. And it is the only row in the table where this compiler is
**3.03x behind node and 3.40x behind bun** — the generated C has thirteen
`nts_concat` calls in the decode loop, so `out += …` allocates a fresh string
and copies the whole prefix every time, where both engines use a cons-string and
flatten once.

**A real-code case may have no `ref.cpp`.** Transcribing a WHATWG decoder into
C++ so there is something to divide by is a second implementation to keep
correct — it would have to match this one's exact placement of U+FFFD on
malformed input or the checksum gate rejects it. The `nts/C++` column prints
`--` and the row is worth having against node and bun without one.

Two languages go into each binary. The harness and the reference are C++; the
generated program and the runtime are C. They are compiled separately rather
than by letting one driver guess from file extensions, and the `nts.cpp` shim
declares the generated entry point `extern "C"`.

Node 24 strips TypeScript types natively, so `bench.mjs` imports the same
`src/main.ts` the compiler consumes. There is no second copy of the program to
drift out of step.

## Providers

A case that allocates per iteration says so in a `provider` file next to its
`tsconfig.json`, containing `rc`. The default is NoGC, which never frees — so a
run calibrated to a hundred milliseconds of work would touch hundreds of
megabytes of fresh memory and measure page faults rather than the code. The
provider is a property of the workload, not of the compiler, and the case name
is printed with the provider it used.

### NoGC is not a scenario, and the default hid a great deal

`NTS_BENCH_RC=1` runs **every** case under reference counting whatever it
declares. That is worth doing regularly, because the default answers a question
no real program asks. Measured against the same C++ references:

| row | NoGC vs C++ | RC vs C++ | RC vs node | RC vs bun |
|---|---:|---:|---:|---:|
| `awfy-list` | 1.07x | **12.97x** | 5.97x | 7.27x |
| `awfy-towers` | 1.31x | **8.67x** | 3.40x | 5.29x |
| `awfy-bounce` | 1.55x | **4.06x** | 1.35x | 1.54x |
| `awfy-queens` | 1.40x | **3.85x** | 1.06x | 1.25x |
| `awfy-permute` | 1.33x | **3.07x** | 1.36x | 1.74x |
| `awfy-nbody` | 1.14x | **2.13x** | 0.19x | 1.06x |
| `array-methods` | 0.55x | 1.25x | | |
| `accumulate`, `checksum`, `closures`, `dispatch`, `elementwise`, `loop`, `mandelbrot` | | *unchanged* | | |

Every row that moved allocates; every row that did not, does not. The two worst
are the two that build linked structures, which is the shape reference counting
is least good at and the shape a tracing collector is built for.

Read this as a statement about **`hir::rc`**, not about the benchmarks. It says
so itself: *"Many of the pairs cancel; that is what an optimizer is for, and
correctness first is what RFC §9.2 asks of a first implementation."* There is no
elision pass. `borrows_safely` already declines to retain a load whose last use
is close by, and gives up the moment a `Call` falls in between — which every
traversal of a linked structure has. Its comment names what is missing: knowing
what a callee can reach.

So the honest reading of the headline table is that it is measured with
reclamation off, and the honest reading of this one is that reclamation is
currently the largest single cost this compiler has.

### `objects` and what a column can and cannot say

`objects` is the case where the loop body is three arithmetic operations wrapped
in an allocation. clang removes a `malloc`/`free` pair whose result does not
escape, and V8 scalar-replaces the object; nts allocates anyway. Neither of them
is cheating — both are what those compilers do with a program whose objects are
provably local, and allocating anyway is a real gap rather than an artifact.

## Rules the harness enforces

**Every variant returns a checksum and the runner compares them.** A benchmark
that measured only time would reward a backend for computing the wrong answer
quickly. A case whose variants disagree fails instead of reporting.

**Inputs are opaque.** Each C variant reads its input through a `volatile`, and
each JS variant takes it from `argv`. A workload whose input is a compile-time
constant can be folded to a constant, and then reports an impressive zero.

**Everything is built with `-flto`.** Not for speed — for fairness. A reference
variant defines its workload and `bench_run` in one translation unit, so clang
would inline one into the other; nts output is necessarily in a separate unit
and could not be. That gap would show up as a codegen defect that does not
exist.

**Node is timed inside its own process.** `bench.mjs` warms up for 20,000
iterations to reach a JIT steady state, then times a calibrated loop with
`process.hrtime.bigint()` and prints nanoseconds per operation. The runner
parses that number; it never measures the wall-clock of `node bench.mjs`, so
process startup and warm-up are excluded.

**Best of five, after calibrating to ~100 ms of work.** The minimum is the run
least contaminated by the scheduler; a mean measures the machine's other tenants
as much as the code.

## Adding a case

A directory under `cases/` with `tsconfig.json`, `src/index.ts`, and:

- `nts.c` — declares the generated function and calls it through a `volatile`
- `ref-double.c` — the same algorithm by hand, in doubles
- `ref-int.c` — the same algorithm by hand, in native integers
- `bench.mjs` — imports `./src/main.ts` and calls `measure`

Each C file defines `double bench_run(void)`; `common/main.c` supplies `main`.

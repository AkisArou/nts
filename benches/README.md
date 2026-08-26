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

| Variant | What it is | What the gap means |
| --- | --- | --- |
| `nts` | `src/main.ts`, compiled by this compiler | — |
| `nts f64` | the same, with number specialization **off** | the gap is what the analysis is worth |
| `C (double)` | hand-written C, every `number` an IEEE double | what the semantics cost without any proof |
| `C (int)` | hand-written C with native integers | the ceiling, *where the proof succeeds* |
| `node` | the same `.ts`, run on V8 | the thing being replaced |

`nts f64` is the column that makes a speedup a measurement rather than a claim:
one program, compiled two ways, run against each other.

There is deliberately **no combined "distance from C" ratio**. Which
hand-written C is a legitimate ceiling differs per case — `C (int)` is a target
only where the three obligations can actually be discharged, and for `fib` they
cannot, because `fib(93)` overflows `int64` while the double version does not
(see `docs/records/0004`). A single column would need a footnote per row.

Node 24 strips TypeScript types natively, so `bench.mjs` imports the same
`src/main.ts` the compiler consumes. There is no second copy of the program to
drift out of step.

## Providers

A case that allocates per iteration has to say so, in a `provider` file next to
its `tsconfig.json`, containing `rc`. The default is NoGC, which never frees --
so a run calibrated to a hundred millisecond of work would touch hundreds of
megabytes of fresh memory and measure page faults rather than the code. The
provider is a property of the workload, not of the compiler, and the case name
is printed with the provider it used.

`objects` is currently the only case that allocates. It is also the only case
nts loses, by 10x, and the reason is visible in the generated C: the loop body
is three arithmetic operations wrapped in an allocation and a free. The C column
does not allocate at all -- clang removes a `malloc`/`free` pair whose result
does not escape, which is exactly the optimization nts does not have -- and V8
does not either, because it scalar-replaces the object. Neither column is
cheating; both are what those compilers do with a program whose objects are
provably local, and nts allocating anyway is a real gap rather than an artifact
of the benchmark.

`C (int)` reports single-digit nanoseconds there, which is not a measurement of
anything: integer arithmetic is associative, so clang derives a closed form for
the whole loop. It stays in the table because removing a column per case would
be worse, but the README's warning about `C (int)` applies to this row harder
than to any other.

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

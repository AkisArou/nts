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
| `nts` | `src/index.ts`, compiled by this compiler | — |
| `C (double)` | hand-written C, every `number` an IEEE double | **the ceiling.** A gap here is a codegen defect |
| `C (int64)` | hand-written C with native integers | **not a defect.** The prize for proving a `number` is integral |
| `node` | the same `.ts`, run on V8 | the thing being replaced |

Node 24 strips TypeScript types natively, so `bench.mjs` imports the same
`src/index.ts` the compiler consumes. There is no second copy of the program to
drift out of step.

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

**Best of five, after calibrating to ~100 ms of work.** The minimum is the run
least contaminated by the scheduler; a mean measures the machine's other tenants
as much as the code.

## Adding a case

A directory under `cases/` with `tsconfig.json`, `src/index.ts`, and:

- `nts.c` — declares the generated function and calls it through a `volatile`
- `ref-double.c` — the same algorithm by hand, in doubles
- `ref-int.c` — the same algorithm by hand, in native integers
- `bench.mjs` — imports `./src/index.ts` and calls `measure`

Each C file defines `double bench_run(void)`; `common/main.c` supplies `main`.

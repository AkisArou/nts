# The backend is at C parity; `number` is the remaining gap

Measured once the C backend produced a running binary, on the three cases in
`benches/`. Numbers are one machine, one clang, and move a few percent between
runs; the ratios are stable and the ratios are the finding.

| case | nts | C (double) | C (int64) | node | nts / C | node / nts |
| --- | --- | --- | --- | --- | --- | --- |
| fib | 664 us | 647 us | 385 us | 1.25 ms | 1.00x | 1.9x |
| loop | 881 ns | 899 ns | 1.02 us | 1.03 us | 0.98x | 1.2x |
| mandelbrot | 78 us | 83 us | 76 us | 77 us | 0.98x | 1.0x |

## The backend is done for scalar code

`nts / C (double)` is 0.94–1.07x across every case and every run — noise around
parity with hand-written C at the same semantics. There is no codegen work left
to do here.

That was not obvious in advance. The emitter declares every value at the top of
the function and assigns to it, destructs block parameters into copies at edges,
and emits `goto` where a structured `while` was written. All three look wasteful
in the text. None of them survives `-O2`: mem2reg, copy propagation and jump
threading are exactly the passes that remove them. Emitting simple, regular,
obviously-correct C and letting the C compiler do its job is measurably free.

## The remaining gap is not codegen, it is `number`

`C (int64)` is **1.7x faster than `C (double)`** on `fib`. Same algorithm, same
compiler, same flags — the only difference is that the C programmer knew the
values were integers.

The compiler does not know that. `HirType::NUMBER` is `f64` because that is what
TypeScript's `number` conservatively is, and every arithmetic operation is
therefore a double operation.

**V8 already does this inference**, which is what makes `loop` and `mandelbrot`
so close. On `loop`, node matches `C (int64)` almost exactly (1.03 us against
1.02 us) while nts sits with `C (double)` — V8 proved the loop counter was an
integer and used integer arithmetic. That is not a JIT advantage that a static
compiler cannot have; it is an analysis we have not written.

So the honest reading of the table is: **compiling TypeScript ahead of time does
not by itself beat a good JIT on numeric code.** It wins on `fib` (1.9x) because
the recursion defeats V8's inlining, and it draws everywhere else. What would
make it win everywhere is the integer inference — and the inference is a proof
obligation, not a heuristic.

`third_party/scriptc/packages/compiler/src/ir/number-facts.ts` in the
proof-of-concept discharges exactly that obligation: representability, wholeness
and range, with JavaScript's arithmetic rather than idealized arithmetic. The
table above is the argument for porting it, and the number to beat is 1.7x.

## What the benchmark caught on the way

`mandelbrot` was written to be a benchmark and turned out to be the first
program shaped like real code. Compiling it found four lowering bugs that every
fixture had missed: merge blocks without parameters, an arm terminated at the
wrong block, loop-body declarations treated as loop-carried, and no support for
parentheses or unary operators. Benchmarks are tests.

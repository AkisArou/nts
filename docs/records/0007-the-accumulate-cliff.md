# 0007 — What `accumulate` is measuring, and what it is not

`accumulate` reports nts at roughly 1.4x hand-written C++. This records an
afternoon spent finding out why, because the answer changes how the whole
benchmark table should be read.

## The answer

Nothing about the generated code. The program sits on a cliff in LLVM's
optimizer, and perturbations with no semantic content at all move it across.

Every measurement below is the *same algorithm* in C, compiled the same way,
linked the same way, timed by the same harness, producing the same checksum.

| variant | ns |
| --- | ---: |
| hand-written C++ reference | 1364 |
| the same loop, `h` declared before `total` and `i` | 1341 |
| the same loop, `h` declared *after* `total` and `i` | 1864 |
| the same loop, result via a temporary rather than read back from `h` | 1864 |
| nts, as generated | 1837 |

Two changes that cannot affect what a program computes — which line a local is
declared on, and whether a value is read from the variable it was just assigned
to or from a temporary holding the same bits — are each worth 39%.

## What was ruled out

Each of these was a plausible cause, was tested, and does nothing:

- **Widening.** `h * 31` is computed in `i64` and truncated by `ToInt32`.
  Rewriting the chain to wrapping 32-bit arithmetic — the same answer, four
  fewer operations — changes the time by less than 1%.
- **Loop shape.** The generated code is a `goto` with copies at the back edge
  rather than a `while`. Writing the identical operations as a `while` loop:
  1837 against 1837.
- **Copy coalescing.** Giving the back-edge copy and its source one variable, by
  hand, in the generated file: 1867 against 1870.
- **Translation-unit split.** The same source in one TU and in two with `-flto`:
  1364 against 1373. LTO is doing its job, including across the C/C++ boundary.
- **The `double` signature.** `double accumulate(double)` with a conversion at
  entry is, if anything, marginally *faster* than `int32_t accumulate(int32_t)`.
- **`nts_to_int32`.** Replacing it with a plain cast: no change.

The loop bodies differ by four instructions out of 27, both unrolled four times,
and that difference accounts for the gap almost exactly. It is an
induction-variable choice, and LLVM makes it differently for reasons that track
none of the above.

## What follows

**Do not tune codegen against this row.** A change that moved `accumulate` to
1.35x would be fitting an LLVM heuristic, and the next clang release would
unfit it. The four instructions are not a defect anyone can point at.

**Read the table as a whole.** `checksum` is the same kind of program —
integer arithmetic, bitwise operators, a counted loop — and sits at 0.98x. If
the compiler had a systematic weakness at integer loops, `checksum` would show
it too. It does not, which is the strongest evidence that `accumulate` is
idiosyncratic rather than representative.

**A ratio near 1.0 has error bars of roughly ±0.4 on this class of program.**
That is worth knowing before treating a 1.1x as a regression.

## What was kept

The investigation produced one change worth having on its own terms:
`hir::simplify`, which removes operations that return one of their own operands.
`x | 0` where `x` is already an `i32` is one; a `Convert` to the type a value
already has is another. It did not move the benchmark and was not expected to —
clang removes them too. It is worth having because every one of those values is
something reference counting has to place, liveness has to track, escape
analysis has to follow and the verifier has to check, and because `nts hir
--prepared` is how all of those get debugged. A listing where a third of the
lines are `or %16, 0` hides the two lines that are wrong.

# 0061 — The index a loop resets, and the widening that costs nothing

A tokenizer is written one way:

```ts
let start = 0;
for (let i = 0; i < text.length; i++) {
  if (text.charCodeAt(i) === 32) {
    total = (total + (i - start) * step) | 0;
    start = i + 1;
  }
}
```

and every number in it is an integer. `nts facts` says otherwise:

    %11  i32  [0, 2147483647] whole      <- start
    %20  i32  [-2147483647, 42] whole    <- i - start
    %21  f64  [-4.6e18, 4.6e18] whole    <- (i - start) * step

`i` is `[0, 42]`, bounded by the guard it is tested against. `start` has no
guard of its own, so after `WIDEN_AFTER` rounds the loop header widens its upper
bound to the `i32` threshold — and the product then leaves the safe-integer
range, which is not a whole number, so the accumulator and everything feeding it
stay doubles.

## The gap in `loops.rs`, which is real

That module exists for exactly this class of missing fact, and its own summary
says what it claims: "accumulators whose back edge is `accumulator +
increment`". `start = i + 1` is not that. Its back edge does not read it at all
— the loop *resets* it rather than accumulating into it — so iteration counting
has nothing to count and the shape falls through to widening.

The fix needs no counting. The header holds either the entry argument or the
latch argument, so the join of their facts bounds it, and both have facts from a
completed analysis. Implemented, it does what it should:

    before   13 doubles   0 int64   4 nts_to_int32
    after     3 doubles  10 int64   2 nts_to_int32

Sound, and the gate is green on it — twelve steps including the differential.

## And it is worth nothing

Eleven runs each of the tokenizer above, same machine, alternating:

    before   min 2454ns   median 2766ns   max 3126ns
    after    min 2448ns   median 2535ns   max 2912ns

The **minima are identical**. For a deterministic workload that is the statistic
with the least interference in it, and the median and max gap is scheduling
noise. Nothing on the benchmark board moved either, and `substrings` — the row
that has this exact shape in it — emits byte-identical C, because `start` is
also passed to `substring`, whose signature pins it to a double anyway.

So the arithmetic was never what the scan was paying for. The loop's cost is the
character load and the branch, and a `double` multiply beside them is free.

## Reverted, and why that is the finding

A change that makes the compiler prove more and the program no faster is a
change that has not been justified. It is committed here as a record rather than
as code.

What would make it matter is a loop where the index arithmetic *is* the
bottleneck, and I could not write one that was not obviously built to be won —
which is its own answer. The next person to reach this should come with a
program that was slow first.

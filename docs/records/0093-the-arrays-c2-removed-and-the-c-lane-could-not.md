# 0093 — The arrays C2 removed, and the C lane could not

**0.00 bytes/op**, over 2,352,941 operations of 200 calls each — roughly 470
million empty arrays — for the shape record 0092 measured at **17 allocations
for 17 calls** on the C lane.

## What was predicted, by two people, in the same direction

The plan for this backend lists **"No frame placement"** under *structurally
cannot win*:

> `ObjectNew { frame: true }` and `Call { frame }` have no analogue, so the lane
> depends on C2 doing at runtime what `escape.rs` proves at compile time.

`nts-69`, handing the case over, put it the same way from the other side:
frame-placed arrays are "a thing my lane could gain and yours structurally
cannot".

Both readings treat "the compiler cannot say it" as "the cost is paid". The
dependence on C2 is real and correctly stated. What neither of us checked is
whether C2 does it — and for this shape it does, completely.

## The measurement

A call that stops exactly at a rest parameter, so an empty array is built per
call and never escapes:

```ts
function f(a: number, ...rest: number[]): number { ... }
export function run(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) { s = s + f(i); }
  return s;
}
```

The bytecode allocates, plainly, inside the loop — `dconst_0; dstore; dload;
d2i; newarray double` — once per call. `getThreadAllocatedBytes` under
`NTS_BENCH_ALLOC=1`:

| | bytes/op | what it is |
| --- | --- | --- |
| empty rest array, bare `double[]` | **0.00** | 200 calls/op, each building one |
| empty rest array, growable wrapper | **0.00** | `NtsArrayD` *and* its backing array, both gone |
| 80-element array, non-escaping | **131,200.00** | 200 × 656 — the control |

The growable row is the one that surprised me. `arrays_can_grow` makes every
array an `NtsArrayD` wrapper holding a `double[]`, so the shape is **two**
allocations per call and one of them is an object with a field pointing at the
other. C2 scalar-replaces both.

## The control is the load-bearing part

A zero is exactly what a broken instrument reads. So the third row: an
80-element array that does not escape either, and allocates 656 bytes every
time — 16 bytes of header and 640 of payload, which is the arithmetic coming
out right rather than a number being plausible.

It is above `EliminateAllocationArraySizeLimit`, which is 64 by default. That
is the honest boundary of this result: **C2 removes non-escaping arrays up to
64 elements, and not one element past it.** The win is real and it is not
unconditional, and a program that builds 65-element temporaries pays for all
of them.

## What actually fell, and what did not

The claim "this lane cannot express frame placement" is still true. The claim
that follows from it — that the lane therefore pays for these allocations —
is false on HotSpot, for arrays under the size limit, escaping or not by
`hir::escape`'s reckoning or C2's.

The plan's sentence has a second half that this does **not** touch:

> and on ART, where escape analysis is much weaker, it simply loses that.

That remains untested and is now the interesting half. The measurement here
says HotSpot recovers what the IR cannot say. It says nothing about the
platform this backend exists for. If the ART number is not zero, then
`ArrayNew` gaining a `frame` flag is work with a number attached — and record
0092's seventeen is the C lane's argument for it, independent of mine.

## The asymmetry, pointed the other way

Record 0088 found the growable wrapper costing **1.4% here against 4.02x on the
native lane**, because a `double[]` was already a heap object with a header.
This is the same asymmetry and it favours this lane again, for a different
reason: there, the platform's representation was already what the wrapper
imposed; here, the platform's *optimiser* removes what the IR was going to have
to prove.

Two lanes, one IR, and the costs land in different places — which is the
argument for three backends restated as a number rather than as a principle.

## What would change this

- An ART measurement. Same probe, `d8`, `bytes/op` from the same counter.
- An array over 64 elements in a hot path, which pays in full and which no
  amount of `hir::escape` precision would help here.
- A shape where the array is merged at a control-flow join: JDK 21 has no
  `ReduceAllocationMerges`, and that is the documented hole in exactly this
  optimisation. It is why the erased-value question was decided by measurement
  rather than by this argument, and it applies here whenever an array is
  conditionally one of two.

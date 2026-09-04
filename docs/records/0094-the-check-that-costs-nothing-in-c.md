# 0094 — The check that costs nothing in C and 4.6x on the JVM

`examples/arrays` was answering `10` where node answers `NaN`. `xs[i]!` with a
fractional index is `undefined` in JavaScript, and the JVM's own bounds check
does not fire for it — `d2i` turns `xs[0.5]` into `xs[0]` and reads a real
element. So `ArrayGet { checked: true }` now tests **integrality as well as
range** and refuses, with the prefix the differential reads.

It is correct, it is required, and it costs 4.6x on one benchmark row.

## The numbers

    awfy-nbody, nts JVM   with the checked-index test    39.2 ms
                          without it                      8.67 ms

    awfy-nbody, nts C                                     6.77 ms
    awfy-nbody, C++                                       7.31 ms

The C lane pays **nothing measurable** for the same check. `nts_index` is
`static inline` and three comparisons, and `nts C` sits below the hand-written
C++ reference on that row.

## What it is not

Each of these was a hypothesis, and each was tested rather than reasoned about.

- **Not the call.** `-XX:+PrintInlining` reports
  `nts.rt.NtsRuntime::bounds (30 bytes) inline (hot)`.
- **Not `Math.floor`.** Replaced by `index == (double)(int) index`, which is what
  `nts_index` does and for the same reason — a register round trip against a
  library call. No change.
- **Not the array reload.** The first version emitted `aload; aload;
  arraylength` per access; `bounds` now takes the length *first* so the caller
  can `dup` the array it is already holding. No change.
- **Not the growable-array wrapper**, which was the first suspect and the
  obvious one, since both regressed rows are array-heavy. Bisected through
  `pinned.sh`: `bb0107e` is 8.66ms and `f302fd5` is 40.15ms, and the wrapper is
  in the first of those.

One earlier run said the check was *not* the cause, and it was wrong — the
binary had not picked up the edit. The bisect is what settled it, and the second
attempt verified the emitted bytecode before measuring rather than trusting the
build.

## What is left, stated as a hypothesis

The failure path is a **throw**. `nts_bounds` is `_Noreturn` and calls `abort`,
so clang knows nothing after it is reachable. A JVM raise needs precise state at
the raise point, inside a loop that reads and writes object fields, and that is
the shape that would stop C2 hoisting them.

This is not proven. It is the only difference left after the four tests above,
and the honest status is "the cause is in this region", not "the cause is this".

## Why it belongs upstream

nbody's indices are loop counters bounded by `bodies.length`, and the middle end
marks four of its seven accesses `checked: true`. **If `hir::bounds` proved
those, the check disappears on all three backends** — and this lane stops paying
4.6x for a fact the loop already establishes.

That is the whole argument for putting the work there rather than here. A
cheaper check is worth a few percent; not emitting one is worth 4.6x.

## The general shape

Record 0088 said a *representation* cost is only visible from a lane that was
not already paying it. This is the same sentence about *checks*: *the cost of a
check is only visible from the lane where its failure path is expensive.*

The C lane cannot see this one at all. Its failure path is `abort`, which the
optimizer treats as the end of the world and therefore as free. On a platform
where failure means an exception with observable state, the same three
comparisons are not the same three comparisons.

## Resolved: the fast path existed and was not selected

**39.28ms → 8.62ms**, and `nts (JVM)/Java` from **4.93x to 1.08x**.

`checked_subscript` chose the integral bounds check with
`self.kind_of(index)? == Kind::Int`. `awfy-nbody` indexes with an **`i64`**, so
`Kind::Long` failed that test and every access took the `double` form: an
`l2d`, two floating-point compares, and `index == (double)(int) index` — a
whole-number test that is *provably true of a long* — per element.

The fix is a `bounds(int, long)` overload and `matches!(kind, Kind::Int |
Kind::Long)`.

### Why this record's four refuted hypotheses were all in the wrong place

They were: not the call (C2 reports `inline (hot)`), not `Math.floor`, not the
array reload, not the growable wrapper. Every one asks *why does the JIT not
optimise this check away*. None asks **whether the check being emitted is the
one that was meant to be**.

That framing came from this record's own title, which is true and points away
from the answer: the check does cost nothing in C, and it did cost 4.6x here,
and neither fact locates the defect.

### The part worth keeping

`NtsRuntime.bounds(int, int)` exists **because of this row**. Its doc comment
names `awfy-nbody`, quotes 8.66ms and 40.15ms, and explains that an integer
cannot be fractional so only the range is in question. Someone measured this
regression, diagnosed it, built the integral path and wrote the numbers down —
and the fix did not cover the case it was written for, because the index was a
`long`.

So the row sat at 39.28ms with its own cure in the tree, beside a comment that
stayed true the whole time. A fix that names its own motivating case is not
evidence that the case is fixed, and the doc comment is what made it look like
one.

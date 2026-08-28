# 0016 — A value with no facts is a value nothing can specialize

Typed arrays landed and the benchmark written to show them off ran at **2.36x
the C++ reference and slower than node**. The feature was correct — 292
differential cases agreeing — and it was slow for a reason that had nothing to
do with typed arrays.

## What the measurement said

`bytes` is Adler-32 over 4096 bytes, sixty-four times. Its inner loop is two
`% 65521`. The emitted C:

```c
v58 = fmod(v56, v87);
v61 = fmod(v59, v88);
```

Two library calls per byte, half a million of them. `fmod` is the general
floating-point remainder; the program wanted `%` on an `int32_t`, which is one
instruction.

`hir::specialize` already knew how to do that. `BinOp::Rem` is in the list of
operations it will move into integer arithmetic, and it declines only when it
cannot *prove* both operands whole and in range. It could not prove it here, and
the reason was three passes upstream.

## The cause

A typed array's element is narrow and every expression around it is `number`, so
lowering emits an `OpKind::Convert` between them. `hir::flow` had no transfer
function for `Convert`. It fell to the catch-all and produced `TOP`.

So every byte read was an unknown number, `a + data[i]` was unknown, `a` was
unknown on the next iteration, and the modulo that could have been an
instruction stayed a call.

Nothing was wrong with the specializer, the fact lattice, or the typed array.
One arm was missing from one match, and the cost of it was 2.4x — on a program
where every other pass was doing its job.

## The two fixes, and why the second is the better one

**A conversion keeps the value it was given.** `Convert`'s facts are its
operand's, narrowed to what the result type can hold. Obvious in hindsight and
the arm should always have been there.

**A machine type's width *is* a range.** A `u8` holds 0 to 255, no fraction and
no NaN, and no analysis has to derive that. This matters more than it looks:
`hir::elements` records what a narrowed array holds because it did the
narrowing, but a *declared* `Uint8Array` was never narrowed by anything, so
nothing recorded it. The width was the only fact available and it was being
thrown away.

```text
bytes   1.98 ms -> 838 us      2.36x the C++ reference -> 1.00x
```

## What to take from it

The gap between "the feature works" and "the feature is worth having" was one
benchmark. Everything the differential harness checks was already green: 292
cases across eight widths, agreeing with node on NaN, negative zero, fractions
and every out-of-range store. Correctness said yes and the point of the feature
was still missing.

The general form, worth checking whenever a lattice gains a producer: **an
operation with no transfer function does not fail, it returns `TOP`** — and a
`TOP` is indistinguishable from an honest unknown at every use downstream. It
degrades silently, at a distance, and in a pass that is working correctly.
`hir::flow`'s catch-all now has two arms fewer, and the next thing to reach it
should be looked at rather than accepted.

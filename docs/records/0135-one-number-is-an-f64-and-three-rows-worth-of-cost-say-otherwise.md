# 0135 — One number is an f64 and three rows worth of cost say otherwise

Four things I chased separately today turned out to be one thing, and it is not
in this backend.

## Four symptoms

**Element width.** `arrays`, `array-methods`, `array-from` and
`array-predicates` all prepare as `managed<[f64]>` where the reference indexes
an `int[]`. Priced on `array-from`, which is nothing but two copies:

    nts (JVM)          8,280,888 bytes/op
    hand-written Java  4,176,848 bytes/op      1.98x, eight bytes against four

**Index conversion.** `arrays` emits **66 inline `d2i`** against two `toInt32`
calls. Each is one instruction and each exists only because the subscript is an
`f64` that has to become an `int` before an array instruction can use it.

**ToInt32 round trips.** `|`, `&`, `^`, `<<` and `>>` on a `number` narrow both
operands and widen the result. Fourteen bench cases carry between 6 and 23
`toint32` ops in their prepared IR, led by `node-utf8` at 23 and `dispatch` at
16.

**And the row that isolates it.** `generic-classes` is 1.49x, and it is not
allocation:

    nts (JVM)          0.00 bytes/op
    hand-written Java  0.00 bytes/op

Both zero. C2 scalar-replaces the objects this backend emits *and* the
`Integer`/`Boolean` boxes Java's erased generics force on the reference -- which
is the plan's first named measurement answered in our favour, on a row we lose.
What is left is `total = total ^ counted.get() ^ ...` as `int` arithmetic on one
side and an f64 round trip on the other. Nothing else differs.

## One cause

A TypeScript `number` is an f64 and the compiler is right to say so. But a value
whose every definition and every use is integral is an `int32` *in fact*, and
saying so is what removes all four symptoms at once: the array holds four bytes,
the subscript needs no conversion, the bitwise operator needs no round trip.

`hir::fields` already does this for **fields** -- record 0099's `Ball`, four
`double`s narrowed to four `int`s, worth 1.14x on `awfy-bounce`. The same
question for **values** and for **array elements** is the one still open.

## Why this is not a JVM backend change, though it looks like one

This lane makes it visible because a Java reference indexes an `int[]` and does
`int` arithmetic, so every one of these shows up as a ratio against a person's
code. It is not a JVM cost. The C lane pays the same eight bytes an element and
the same `(int32_t)` round trip, and has no `Java` column to make it obvious.

So the backend answer -- a union-find over values proving every definition and
use integral -- would be **the third instance of the same shape in this crate**
after `widen.rs` and `unbox.rs`, and it would be the wrong place for it. It
would decide something `hir::specialize` also decides, for one of three
backends, and the other two would keep paying.

Written down here rather than built, with the numbers, and handed upstream.

## What was refused, and what it cost to find out

Two backend-local answers were tried and neither survived:

- A **`store`/`load` peephole** for the round trip record 0099 named. Counted
  first: 4.0% of `awfy-bounce`'s instructions, 3.4% of `checksum`'s -- and
  `checksum` is at 1.00x. The peephole cannot separate them.
- **Emitting `irem` directly for a literal divisor**, which is real and does
  fire, but only after following the `Convert` the prepared IR puts between the
  `rem` and its constant. Worth having; not this.

Both are in record 0133. The pattern across them and this one: the cheap local
fix is available three times out of three, and three times out of three the
measurement said the cost was somewhere a local fix cannot reach.

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

**And a second row that isolates it, from the other direction.** `absences`
exists to measure how absences are represented -- `string | null`, `number |
undefined`, `number | null | undefined`, in a loop. It is 1.22x, and the
representation it was written to test is not the reason:

    nts (JVM)          0.00 bytes/op        zero `NtsValue` in the emitted code
    hand-written Java  0.00 bytes/op

Nothing boxes. The scalarised absence the plan asked for is what this backend
emits, and the row is still red. What is left is `total = (total + ...) | 0`
five times an iteration -- `int` arithmetic on one side and an f64 with a
`toint32` on the other, twelve of them in its prepared IR.

So two rows written to measure two different things both come down to this one,
and in both the thing they were written to measure is *fine*.

**And a fourth form, at the call boundary.** `module-closures` is 1.06x on three
consecutive draws -- the largest *stable* margin among the near-parity rows --
and its per-iteration sequence is:

    iload 11 ; i2d                                  the loop counter, widened
    invokestatic Closure0$call:(Lnts/gen/Closure0;D)D
    dstore 16 ; dload 16 ; d2i                      the result, narrowed back

Two conversions per call and 8192 calls. `mix` is `(x: number) => number`, so
its signature is `(D)D`, while the counter and the accumulator either side of it
are `int`. The reference is `mix(int) -> int` and converts nothing.

`hir::specialize` produces a `$whole` variant for a *direct* call; a closure
reached through a global is not one, so the specialised body has no caller that
can name it. Devirtualisation is what would make it nameable, which is the same
dependency nts-69 measured on the memory case.

## One cause

## Three prices, and one of them says we would win

Each is one variable changed in the Java reference -- the `number` spelled as
the `double` it is, with `(double)(int)` where the TypeScript writes `| 0`:

    array-methods     2.20x     reference 1.02 us -> 2.26 us     we go 1.67x -> **0.74x**
    generic-classes   1.89x     reference 1.45 us -> 2.74 us     we go 1.12x -> 0.61x
    array-from        1.24x     reference  865 us -> 1.06 ms     we go 2.43x -> 1.97x

`array-methods` is the one to point at: the whole of its 1.67x is the
representation, and with an int one this backend is **faster than hand-written
Java**. Its accumulator cannot narrow because `nts_array_index_of` returns
`Float { bits: 64 }`, so `total = (total + xs.indexOf(step) + ...) | 0` mixes an
int accumulator with an f64 return and every `| 0` becomes a `toInt32` call --
28.96% of the row.

**Four surface forms, one fact.** Element width in an array, a `d2i` per
subscript, a ToInt32 round trip on every bitwise operator, and a `(D)D`
signature at a call boundary. Nine of the twenty-four rows still above 1.00x are
one of these, and `dispatch` -- the only array row that prepares as
`managed<[i32]>` -- is the control at 1.04x.

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

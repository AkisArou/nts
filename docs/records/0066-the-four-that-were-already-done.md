# 0066 — The four that were already done

The queue is number, string, absence, bigint, symbol, array, object, closure,
Map and Set. Five of them were worked on this sitting and each ended in a
number. This record is the other four, closed the way the goal says a primitive
at its floor is closed: **by one measurement, not by assumption.**

That distinction earned its keep an hour before this was written. `map-and-set`
had an allocation floor of seventeen, argued carefully and correctly from the
code, and it was beatable — the argument was true of the code as written and
read as a statement about what was possible. So "the table says it is closed" is
not the same claim as "it is closed", and these four are measured rather than
cited.

## The measurements

```text
                  memory              speed (C++ / node)
number            0 / 0               loop 0.99 / 0.98
                                      number-format 0.83 / 0.50
                                      fib 1.69 / 0.52
bigint            0 / 0               bigint 1.00 / 0.09
symbol            0 / 0               symbol-keys 1.02 / 0.19
closure           0 / 0               closures 1.02 / 0.38
                                      dispatch 0.99 / 0.67
```

Every speed row is at or below parity with C++ except `fib`, and 0049 has that
one: the reference is a `std::int64_t` that wraps where ours cannot, because
`fib`'s return cannot be narrowed — the fixpoint over a recursive exponential
does not converge to a bound. At n=27 the two agree, which is why the checksum
passes at all.

## Why the Map/Set lesson does not reach them

It cannot. **All four memory floors are zero**, and a floor of zero has no room
under it. That is the whole reason "zero, and here is the case" is the strongest
answer a memory ratchet gives: seventeen invites the question of whether it
could be eight, and zero does not.

`closure-capture` is the sharpest of them — 34 operations under `NTS_RC_NAIVE`
and **0** with elision on, so every retain and release a closure and its cell
would cost is removed rather than reduced. A closure that does not escape is one
stack slot and no allocation.

## What is left, and it is not these

Two things on the board are worth more than anything remaining in this queue,
and neither is a primitive's representation:

`absences` at 2.13x C++ is entirely the LLVM backend — the C backend runs the
same HIR at **1.00x**, and 0058 has the cause measured (vectorization width) and
four refuted accounts of the fix.

`awfy-bounce`, `awfy-queens`, `awfy-permute`, `awfy-towers` and `awfy-sieve` all
have written reasons now, and three of those reasons name a change nobody has
made: objects by value in an array, `int32_t` elements where we keep `double`,
and internal linkage for a method the C compiler would otherwise inline.

The queue is done. The rows it does not cover are where the work is.

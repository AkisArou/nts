# 0118 — Grisu2 in Java, and the residue is not the digits

`number-format-double` was **7.56x** hand-written Java. `numberToString` searched
precisions 1 through 17 with `BigDecimal`: a `roundTo` per candidate, a
`doubleValue()` round trip to test it, and an allocation at every step.

Ported `runtime/c/nts_grisu.h` to Java -- the DiyFp core, the 88-entry
cached-powers table, `weed`, both digit loops. Integer arithmetic and one
128-bit multiply.

    number-format-double   38.21 us -> 8.06 us     7.56x -> 1.59x

**Predicted parity; got 1.59x.** The digits are no longer the cost and something
else is, which is worth saying before anyone reads 4.7x as done.

## Why not `Double.toString`

Its digits were not shortest-round-trip before JDK 19. The same class file would
print differently depending on the JVM it landed on, and **a compiler cannot
ship a number format that varies with the host.** That is a stronger reason than
the formatting differences -- `1.0E21` against `1e21` -- which are a fixed
translation. Digits are not.

## The two things that made it delicate

**Every value is an unsigned 64-bit quantity in a `long`, and the scaled
significands really do have their top bit set.** Every comparison goes through
`Long.compareUnsigned`. A signed `<` would be right for most inputs and wrong
for exactly the large ones, which is the shape of bug a random corpus does not
find.

**`Math.multiplyHigh` is Java 9.** This jar is built `--release 8` for the same
reason it contains no `invokedynamic`, so the 128-bit product is four 32-bit
partials -- which is what the C does anyway.

## What was checked, and what checking it was worth

152,275 doubles round-trip with **0 wrong** and 757 declining to the exact path,
which is the contract the C keeps rather than a hedge added for the port. The
sweep, the 4.65M-assertion regression suite and both format cases agree with
node.

Then the rounding was removed from `timesHigh` and the sweep went red: **4 of
104,152**. Narrow, and it detected. That number is the useful one -- it says a
subtly wrong Grisu is visible to this test but only just, and a corpus an order
of magnitude smaller would have passed a broken port.

## The residue

8.06 us over 192 conversions is 42 ns a call against the platform's 26. Grisu
itself is around 20. The rest is `layout` and building the `String`, which
allocates -- and `number-format`, the integer case, did not move at all (1.41x
before and after) because it takes the `Long.toString` fast path and never
reaches this code.

So the next question on this row is allocation, not arithmetic, and the
instrument for it is the one that has been right all day: `bytes/op`.

## `Integer.toString` is not faster than `Long.toString`, and that was worth one run

The integer row, `number-format`, takes the `Long.toString` fast path above and
sits at 1.39x against a reference that prints an `int`. The obvious inference is
that we call the 64-bit method where they call the 32-bit one, and that
`Long.toString` divides in 64 bits with its own digit loop.

    guarded Integer.toString    1.50 us    1.66x
    Long.toString                1.26 us    1.39x

**Nineteen percent worse**, and reverting restored the number exactly, so it was
not noise. Whatever `Long.toString` costs on this range, the range check in
front of the narrower call costs more -- and both answer identically on the
values they share, so nothing was bought at all.

Recorded because the inference is a good one and will occur to the next reader:
the narrower method for the narrower value is the sort of thing that does not
need measuring right up until it is wrong.

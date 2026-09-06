# 0170 — The formatter was the whole row, and I had parked it for want of one measurement

Record 0166 parked `number-format-double` at 1.41x. The reasoning was that
Grisu2 declines zero times on that row -- true, and measured -- so a formatter
that cannot decline replaces a fallback nothing reaches, and what was left "is
honest and much smaller". I wrote "a share of about 2.1 us" and did not measure
the share.

## The ceiling, which is one file and takes a second

Our `numberToString` against `Double.toString` plus the reference's own `.0`
strip, on the case's own 192 values:

    ours 7,123 ns per 192    jdk 4,998 ns per 192    1.43x

The row published at **1.41x**. The formatter's ratio *is* the row's ratio, so
the formatter is the whole gap and there was never a smaller remainder. The
parking was wrong and the thing that made it wrong was reasoning about a share
instead of measuring one -- which is the error record 0165 is named for, made
again eleven records later, in the record that names it.

`async-profiler` then said where inside: `shortest` 45.5%, `timesHigh` 6.7%,
`weed` 1.1%, `digitsOf` 0.5% -- **53.7% in Grisu** -- against `layoutDigits` at
4.0% and string construction at about 9%. The algorithm, not the placement.

## Four changes, no algorithm

    1.43x -> 1.31x   Long.numberOfLeadingZeros for the two normalise loops
         -> 1.24x    the digit loop divides as unsigned 32-bit
         -> 1.22x    timesHigh stops assembling its low half
         -> 1.19x    unit and distance leave the fractional loop

    number-format-double   1.41x -> 1.18x
    number-format          1.03x -> 1.00x

**The prediction I got wrong:** I expected the shift loops to be worth 15-25%
and they were worth 7.8%. Eleven iterations of a perfectly predicted branch is
not eleven iterations of work.

**The mistake I nearly shipped:** the digit loop's first version cast the
integral part to `int`. The chosen power bounds it below **2^32, not 2^31** --
the comment four lines up says thirty-two bits and I read it as an `int` -- so a
ten-digit value above 2,147,483,647 would have gone negative. Caught by reading
`digitsOf`, which returns up to 10, before running anything. `Integer.divideUnsigned`
is Java 8 and Android 24, inside both floors this jar keeps.

`Math.multiplyHigh` would be the obvious fifth and stays refused: Android API 31
against this jar's 26, the same constraint that keeps `invokedynamic` out.

## What is left, and why it is not a port

1.18x, and the formatter is 1.19x the JDK's. Closing it means matching Schubfach,
which is what `Double.toString` has been since JDK 19.

**Porting OpenJDK's `DoubleToDecimal` is not available**: it is GPL with the
classpath exception and this runtime is not. A clean-room Schubfach from the
paper is a real piece of work with a large table to get right, and its payoff is
"match the JDK", not beat it -- so the row lands at about 1.00x rather than
under it.

That is the honest statement of the remainder: **not a gap in this backend's
code generation, and not one this lane can close by being cleverer about Grisu.**
Named here rather than left as a row somebody re-derives.

## The instrument I duplicated

I wrote a 300,000-double fuzz against node to check these four changes, ran it
clean, and then found `compiler/codegen/jvm/tests/number_to_string.rs` already
does it -- better, because it sweeps **every power of two** first, and documents
that a build with 0 wrong in 299,827 random patterns had 46 of 2,098 powers of
two wrong. Random sampling cannot reach a short binary representation.

Deleted mine. Two instruments that can disagree is the thing record 0077 is
about, and I built the second one because I did not look for the first.

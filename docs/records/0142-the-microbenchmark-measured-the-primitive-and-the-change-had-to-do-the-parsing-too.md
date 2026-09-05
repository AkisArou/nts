# 0142 — The microbenchmark measured the primitive and the change had to do the parsing too

`number-format-double` is 1.46x and 52% of it is inside `NtsGrisu`. The JDK has
produced the shortest round-tripping decimal since JDK 19, by a newer algorithm
than Grisu2, so the obvious question is whether it can supply the digits.

Two things had to be true and both were:

**The digits agree.** Over 399,932 values, JS's shortest form and
`Double.toString`'s differ in **zero** cases. Over a sweep of every subnormal
from the bottom plus the normal floor and the ceiling, they differ in **eight**
-- all subnormal, all in the first twenty bit patterns, `4.9E-324` where the
shortest is `5e-324`, which is a legacy output the JDK documents. The exponent
field is an exact guard for those.

**And it is faster**, on the row's own inputs:

    Grisu2 (ours)      42.8 ns/value
    Double.toString    34.7 ns/value      1.23x

So: take the JDK's digits for normals, keep Grisu for subnormals, feed the
existing `layoutDigits`, which is already ECMAScript's placement rather than
Java's. Verified identical to the committed formatter on **3,399,045 values** --
400,000 subnormals, two million random bit patterns, a million ordinary ratios
and the awkward pool.

    number-format-double   1.46x -> **1.75x**
    number-format          1.39x -> **1.64x**

## Why it lost

`Double.toString` returns a *string laid out Java's way*. Using its digits means
parsing that string back -- character by character, tracking the point, reading
the exponent, stripping leading and trailing zeros, moving the array. The
microbenchmark compared `numberToString` against **bare `Double.toString`** and
none of that parsing existed in it.

I measured the primitive and the change had to do the parsing too. The 1.23x was
real and was not the thing being proposed.

## What would have caught it in thirty seconds

Benchmarking the *replacement* rather than the *component*: a version that
returns the final string through `layoutDigits`, which is what the row actually
calls. The comparison I ran could not have shown a cost that was not in it.

That is the eighth change reverted today, and the fourth whose refutation is
about the instrument rather than the idea. Records 0133 and 0137 have the other
shapes: a profile frame that is a stall rather than arithmetic, and a
percentage that is attribution rather than criticality. This one is simpler and
more embarrassing -- I benchmarked something adjacent to what I was going to
build.

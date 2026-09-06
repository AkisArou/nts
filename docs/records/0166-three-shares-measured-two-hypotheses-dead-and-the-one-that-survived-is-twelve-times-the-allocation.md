# 0166 — Three shares measured, two hypotheses dead, and the one that survived is twelve times the allocation

Three rows, three hypotheses, three share measurements taken before any of the
three builds they would have justified. Written down first, in
`predictions.md`, because the point of the exercise was that the *share* is the
cheap factor and I had been skipping it.

    saving = share x (1 - replacement / original)

Record 0165 is where that formulation came from and nts-69 supplied the half
that makes it operational: **the share is usually measurable before the change
and the replacement's price usually is not, so measure the share, argue the
price, and be most suspicious when you have only one of them.** All three of
today's measurements are the first factor and none of them is the second.

## 1. `array-predicates` -- partly refuted, and the build is not worth it

**Predicted:** ours about 2x Java's bytes an operation, ~33 KB against ~16.6 KB.
The reasoning was `NtsArrays.growCapacity` -- `max(wanted, max(4, current * 2))`
-- against a result array starting at `EMPTY`, so filtering ~250 of 259 allocates
4, 8, 16, 32, 64, 128, 256: seven allocations totalling 508 doubles where the
reference allocates one array of 259.

**Measured:**

    array-predicates    ours 24,992 B/op    java 18,792 B/op    1.33x

The Java side landed where I put it. Ours did not: 1.33x, not 2x. The doubling
really is ~2x *on the arrays it grows*, and the prediction failed by pricing the
filter results as though they were the whole allocation. `xs` itself is built by
`push` and grown the same way, and everything else in the row dilutes the
difference. Extra allocation is about 6.2 KB an operation, a quarter of ours.

So the capacity hint stays filed with nts-69 rather than built, and it is filed
with a smaller number than I sent them.

## 2. `number-format-double` -- refuted outright, and it saves four hundred lines

**Predicted:** 64 of 192 values take the `BigDecimal` fallback, because
`numberToString` runs Grisu2 first and falls back when it returns `UNPROVEN`,
and the case's `base / 7` needs all seventeen digits -- the shape Grisu2 is
worst at. The reference is `Double.toString`, which since JDK 19 is Schubfach
and never declines. A Schubfach port, about four hundred lines, would delete the
fallback.

**Measured**, by running the case's own 192 values through `NtsGrisu.shortest`
and counting:

    values 192   grisu declined 0   (base/7 0, base*1.5 0, base/1024 0)

**Zero.** The fallback is never reached on this row, so a formatter that never
declines buys nothing that this one is losing.

The error is worth naming because it sounds like knowledge. Grisu2 declines when
it cannot *prove* its answer is the shortest, which is rare and unrelated to how
many digits the answer has. I read "needs seventeen digits" as "is the case
Grisu2 fails on" -- two different properties, and the second one is the one the
fallback keys on.

What is left on the row is honest and much smaller: 7.48 us against 5.40 us,
both formatters succeeding, ours Grisu2 plus `layoutDigits` and theirs Schubfach.
A port would have to beat Grisu2 rather than replace a fallback, for a share of
about 2.1 us. **Not justified. Parked with the number.**

## 3. `node-utf8` -- confirmed, and it is the largest single thing this lane loses

**Predicted:** the Java reference allocates substantially less than our 784,888
bytes an operation, and if it did not the churn would be inherent to the
algorithm.

**Measured:**

    node-utf8    ours 784,888 B/op    java 65,568 B/op    11.97x
    node-utf8    ours 91.71 us        java 8.14 us        11.27x

The allocation ratio and the time ratio are the same number to within six
percent. On a row where nothing else moved, that is as close to a cause as an
instrument like this gets.

**And the reference is right, which is the part I did not expect.** A competent
Java programmer accumulating a string writes a `StringBuilder`; `+=` in a loop
is the thing Java programmers are taught not to write. So the reference is O(n)
where we are O(n^2), and for once that is not a reference to correct -- JS `+=`
is a rope and V8 makes it O(n) too, so the *program* is O(n) in the language it
is written in and our lowering is what makes it quadratic.

**Our own C lane is 31.85 us, faster than node's 39.91 us**, and the header of
`nts_runtime.h` says why: `nts_concat_into` takes the caller's storage, and
`rc` rewrites a `nts_concat` into it "where the ownership" allows. A uniquely
referenced accumulator is appended to in place. That is reference counting
buying something a tracing collector cannot, and it is why the two lanes of the
same compiler differ by 2.9x on identical source.

The JVM plan predicted exactly this and stopped one step short:

> `Call { frame: Some(n) }` has no analogue (`java.lang.String` is immutable,
> there is no fill-this-storage form), so the `_into` placement records
> 0013/0014/0059 price is C-specific.

True about `String`, and the conclusion does not follow. The accumulate pattern
does not need a mutable `String`; it needs a builder and one materialisation at
the end, which is what the reference does at 8.14 us. `java.lang.String` being
immutable rules out the C lane's *mechanism*, not the optimisation.

**This is the next build, and the share is 11x rather than argued.** What is not
yet priced is the replacement: recognising `s = s + t` accumulated across a loop
and holding it in a `StringBuilder` requires knowing no other use observes an
intermediate, which is an escape question `hir` may already answer. Per the rule
above I have one factor and not the other, so the next step is to price it, not
to start it.

# 0112 — An array index is a long, and on this platform it cannot be

**Status: diagnosis complete, cost not yet measured.** Written in this order on
purpose -- the static half is solid and the part that decides whether to build
anything is a number I do not have yet.

## What the bytecode says

`NBodySystem$advance`, the hot method of `awfy-nbody` at 1.14x hand-written
Java, decoded:

    199 dstore   118 dload    101 dconst_0
     57 lstore    41 lload     32 lconst_0     7 ladd    12 i2l

The loop counters are **`long`**. The Java reference's are `int`. Every array
access reads

    aload   array
    dup
    arraylength          <- an int, by the JVM's own definition
    lload   index        <- a long
    invokestatic NtsRuntime.bounds:(IJ)I
    aaload

so the platform hands us an `int`, we widen it, compare in 64 bits, and narrow
back to index.

## Where it comes from, at the source rather than by inference

`nts hir` on the same function:

    %6  = array.len %5 : f64
    %7  = lt %3, %6 : bool
    %10 = array.get %9[%3] : managed<obj#25>

Everything is `f64` before specialization, and specialization narrows the
counter to the smallest integer type whose range covers it. **A JavaScript array
length can reach 2^32 - 1, which does not fit an i32**, so the honest answer for
the language is i64 and that is what it picks.

## The claim

**On the JVM an array cannot have more than 2^31 - 1 elements.** `arraylength`
returns an `int` and there is no other way to ask. So on this platform the range
that forced i64 is not the real range, and every counter derived from a length
provably fits an i32.

This is a fact about a *target*, not about the language, which is why it cannot
be fixed by changing the range globally: a C array is bounded by `SIZE_MAX` and
the C lane's i64 is correct. The shape of the fix is a per-target bound on
`array.len`, after which specialization narrows every derived counter for free
and no backend needs a new pass.

## What correlates, and what that is worth

Long-integer opcode counts against the Java ratio, across the cases that have
both:

    case            long ops   jvm/Java
    awfy-bounce            0      0.96x
    dispatch               0         --
    arrays                 0         --
    awfy-list             18         --
    awfy-queens           20      1.25x
    awfy-towers           27         --
    awfy-permute          44         --
    awfy-sieve            50         --
    elementwise           80         --
    awfy-nbody           148      1.14x

Suggestive and not evidence. `arrays` has zero long ops because its array is a
literal whose length `allocated_length_is_exact` proves, which is a different
mechanism reaching the same place -- and is the strongest hint the mechanism is
real, since it is the one case where the bound is already known and the longs
already gone.

`awfy-queens` at 1.25x has only 20 long ops and a separately diagnosed cause
(element width, `double[]` against `int[]`), so it is not waiting on this.

## What would refute it

If `long` counters cost nothing on this algorithm, the correlation is an
artefact of which cases happen to index arrays, and there is nothing here to
build. That is a one-variable A/B and it is written: the same n-body inner loop
twice, `int i` against `long i` with an `(int)` cast at the index, everything
else identical.

Ordered this way because the last three things this lane tried were built before
they were priced, and two of them were reverted.

## The cost, and the first measurement of it was on the wrong case

Priced by mutating a Java n-body loop: `int i` against `long i`, everything else
identical, checksums equal.

    int   7.733 ms
    long  8.186 ms      1.059x

**6%.** Recorded above as "confirmed and modest", and the conclusion drawn was
that the correlation with the Java ratio was mostly an artefact of which cases
index arrays.

That measurement was taken on `awfy-nbody`, whose inner loop runs over **five**
bodies. A five-element loop is not vectorized by anything, so the experiment
compared two scalar loops and correctly found almost no difference between them.
It answered a question about long arithmetic. The question was about *array
loops*, and I picked the case because it was the row I was looking at.

Repeated on `elementwise`'s shape -- 512 passes over 4096 doubles, the loop this
lane is 7.95x on -- as a 2x2, because the first attempt at this moved two
variables at once and record 0106 is what that costs:

    int,  no check        60.1 us     --
    long, no check       616.7 us    10.27x
    int,  check          786.7 us    13.10x
    long, check          707.7 us    11.78x    <- what this backend emits

**Ten times, not six percent.** And the two effects do not add: once the loop
stops vectorizing, it is at ten-to-thirteen times whichever way it got there,
and the "both" cell is *lower* than "check alone" rather than higher.

## What it is really about, which is not long arithmetic

A `long` index and a conditional throw are both loop-vectorization blockers. C2
turns `xs[i] = xs[i] * k` over a `double[]` into AVX multiplies; it will not
vectorize a loop whose index is a widened long, and it will not vectorize one
carrying a branch to a throw. The arithmetic width was never the cost. **The
cost is losing the vector unit**, and either half is sufficient to lose it.

That reframes the fix and is worth stating before anyone builds half of it:

> Narrowing the index alone buys **nothing** here. `int, check` is 13.10x --
> the worst cell in the table. The explicit bounds check has to go at the same
> time, or the loop still does not vectorize and the work is wasted.

The corroborating row is the one that did *not* need to be measured to say this:
on `elementwise`, hand-written **Java is 58.94 us against C++'s 156.01 us**. The
reference beats the C++ reference by 2.6x on an elementwise multiply, which is
what a vectorized loop against a scalar one looks like. The JVM is not losing
this row; this backend is declining to let it be won.

## What I got wrong, precisely

The direction was named -- long counters cost something, and the correlation
said which rows. The magnitude was wrong by more than two orders of magnitude,
and the reason was **choosing the measurement case for convenience rather than
for the mechanism**. `awfy-nbody` was the row in front of me. The mechanism was
vectorization, and nbody has no vectorizable loop to lose.

A one-variable A/B is not sound merely because it moves one variable. It also
has to be run on a case where the thing being priced can *happen*.

## The 2x2 above was wrong, and the discipline that was supposed to prevent it is what failed

The "int, check" cell called `bounds(int length, long index)` with an `int i`.
**Java widens implicitly**, so that cell routed its index through a long and was
measuring both variables at once. It was labelled as the isolating cell and was
not one.

With a real `boundsInt(int, int)`, matching the `(II)I` overload this backend
already emits for an `i32` index:

    int,  no check       59.2 us     --
    long, no check      498.5 us    8.42x
    int,  check          91.5 us    1.54x
    long, check         701.6 us   11.85x   <- what this backend emits

**Every conclusion drawn from the previous table is retracted.** The two effects
are not co-equal blockers. The index is 8.42x and the explicit check is 1.54x,
so:

- Narrowing the index alone is worth **7.67x** (701.6 / 91.5), not nothing.
- The claim that "narrowing the index alone buys nothing" was the exact
  opposite of the truth, and it was sent upstream as guidance not to land the
  change without mine.

Predicted, before the change exists: `elementwise` at 468.47 us against Java's
58.94 goes to about **61 us, roughly 1.04x**, on one constant.

## What actually failed here

The 2x2 existed *because* record 0106 taught that moving two variables at once
costs a revert. The discipline was applied. The implementation of it moved two
variables anyway, through an implicit widening in a helper I wrote myself.

That is worse than not running the 2x2, and the reason is social rather than
technical: **a 2x2 is trusted in a way a single A/B is not.** A confounded A/B
gets a second look. A confounded 2x2 gets believed, written into a record, and
sent to another session as a warning not to do the right thing.

The check that would have caught it is the same one that has caught everything
else this week and it takes one command: `javap -c` the experiment and look at
whether the cell that says `int` contains an `i2l`. I decompiled the *subject*
four times today and never once decompiled the *instrument*.

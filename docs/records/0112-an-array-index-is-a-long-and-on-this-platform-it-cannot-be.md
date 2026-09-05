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

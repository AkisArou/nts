# 0086 — The lane is within one of hand-written Java on five of eight, and the first number was a lie

The JVM backend's reason to exist is a comparison no other column in this
repository can make: **the same program, written by hand, on the same runtime.**
Every other ratio here — against C++, against node, against bun — mixes a
codegen difference with an engine difference and cannot separate them. A ratio
against hand-written Java divides the runtime out and leaves only what this
compiler decided.

Are We Fast Yet ships its own Java, so the reference is theirs rather than one
written here. That is not convenience: **a reference written by the author of
the thing being measured is not a reference.** The cost of taking theirs is
stated rather than corrected for — the suite constrains every implementation to
a cross-language core, so `benchmark()` returns `Object` and boxes its result
once per call, against a body of hundreds of operations.

## The numbers

    case              nts JVM      Java   jvm/Java
    awfy-permute      12.12 us   17.10 us    0.71x
    awfy-mandelbrot   23.13 ms   27.53 ms    0.84x
    awfy-towers       17.80 us   19.49 us    0.91x
    awfy-list          8.12 us    8.71 us    0.93x
    awfy-sieve         4.36 us    4.62 us    0.94x
    awfy-nbody         8.66 ms    8.04 ms    1.08x
    awfy-queens       11.03 us    8.84 us    1.25x
    awfy-bounce        7.48 us    4.58 us    1.63x

Five of eight at or under hand-written Java, twelve hours after the lane was
refusing all eight at `Callee::Virtual`. The three above stay in the table and
are the queue, because a suite that held only its wins would be an advertisement
rather than an instrument.

**No diagnosis is offered for the three.** `bounce` allocates a hundred objects
per call and `queens` is boolean-array work, and both of those are guesses of
exactly the kind this repository's records are mostly about being wrong. They
are named here as untested so that whatever explains them can be checked against
having been written down first.

## The first run of this column was wrong, and the checksum agreed with it

    awfy-nbody   C++ 7.36 ms   nts JVM 8.66 ms   Java 59.5 ns   jvm/Java 145653.42x

Fifty-nine nanoseconds. **Are We Fast Yet's ports do not agree about where the
problem size lives.** Their Java takes 250,000 advances as
`innerBenchmarkLoop`'s argument; the TypeScript port keeps it as a constant
inside the benchmark and passes 1, the way every other case here holds its size
— and `ref.cpp` passes 250000 explicitly to match theirs, in a comment that had
been read. So their Java did one advance.

The cross-variant checksum guard — which exists *precisely* to stop a variant
being fast because it computed something else — passed. Every AWFY case answers
1 or 0, and `NBody.verifyResult` carries this:

    if (innerIterations == 250000) return result == -0.1690859889909308;
    if (innerIterations == 1)      return result == -0.16907495402506745;

An explicit branch for one iteration, returning true. The check ran, the check
passed, and what satisfied it was a special case in a third party's source
written years ago for their own reasons.

This is the same failure as the `examples/unsupported` gate assertion, which
held for years because node could not parse the fixture: **a green check
satisfied by something unrelated to its subject.** One by a parser, one by a
branch in somebody else's file.

## The fix is a new category of check, and it is the useful part

The iteration override is bookkeeping. The check is this:

> If the two hand-written references for one program differ by more than twenty
> times, the row fails.

Java beats C++ on some rows and that is a fine result; it does not beat it by an
order of magnitude on a numeric kernel. A gap that size is not a codegen
difference, it is the two references doing different amounts of work.

**What makes this different from every other check in the repository is that it
is a bound on the *relationship between two measurements* rather than a
statement about one artifact.** An artifact can always be made to satisfy an
assertion by something unrelated — that is what both of today's false greens
were. A ratio has no single author: no one program controls both sides of it, so
there is nothing to accidentally satisfy it with.

The general form is worth stating, because there are other places for it:
**find a quantity that two independent things both determine, and bound their
disagreement.** `nts C` against `nts LLVM` is one — two lowerings of one IR, and
no legitimate reason for them to differ by more than codegen noise. That bound
can be tight where this one must be loose, because `user-iterable` at 21.4x
against C++ is a real result and must pass.

## What caught it, and what did not

145653.42x is absurd on its face and that is the only reason it was seen. **At
4x it would have been published**, in this compiler's favour, on the row the
whole lane exists to produce. The instrument that would have caught it did not
exist until it had already failed once.

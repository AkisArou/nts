# 0129 — A row that reads 0.70x and 1.10x has no single number

`dispatch` reported **1.06, 1.24, 0.72, 1.06, 1.05** on five consecutive locked
runs of one binary. `array-predicates` has read 1.25x, 1.31x, 1.35x, 1.65x and
1.76x across the day. `checksum` reported 1.00x nine times out of nine in the
same window, so the machine is quiet and this is the programs.

Those swings are larger than every effect measured today. A 30% regression I
shipped and caught, a 26% one I fixed, an 11% win on the map -- all of them are
smaller than the distance between two readings of `dispatch`.

## The constant did not match its own reason

    /// A best-of-five *inside* one process is not enough for a JIT. Measured
    /// over five processes, node spread 18% and bun 26% on the same case ...
    const RUNS: usize = 3;

The paragraph measured five and the constant said three. Nobody changed the
reason; the number drifted out from under it, and a justification that keeps
making sense after it stops describing the code is the hardest kind to notice --
nts-69 has hit four of these upstream this week.

At five, `dispatch` read 1.04, 0.71, 0.70, 1.10. The fast shape turns up about
half the time rather than one set in five.

## Which is an improvement in the odds and not a fix

`dispatch` is **bimodal**. There is a shape the JIT reaches and one it does not,
and a best-of-N estimator does not converge on either -- it converges on *how
often you looked*. More runs make the published number more likely to be the
fast one, which is more reproducible and no more true.

So the harness now says when it cannot answer: `measure` carries the ratio of
its slowest pass to its fastest, and a row above 1.25x prints a note naming
itself. That catches the case where one set spans both shapes, which is exactly
when its minimum is not a description of anything.

It does **not** catch a set that lands wholly in one shape, and `dispatch` did
that on the run after this landed -- 1.08x, no note. The honest statement is
that a row can still publish either mode silently, and the note only fires when
the disagreement is visible from inside a single run.

## What it means for the column

The goal is a column, and a column with a row that reads 0.70x or 1.10x
depending on the morning cannot certify that row either way. Three rows have now
shown movement larger than the changes being evaluated against them --
`dispatch`, `array-predicates`, and `awfy-bounce`, which read 4.37 and 4.74 with
byte-identical output.

Every conclusion drawn today from a *single* filtered run of those three should
be read as provisional. The ones drawn from `checksum`, `generator`,
`growth-fixed` and the erasure rows should not: those repeat.

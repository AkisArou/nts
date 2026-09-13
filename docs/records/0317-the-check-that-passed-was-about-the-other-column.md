# The check that passed was about the other column

Earlier tonight I walked all thirteen entries of `tooling/gate/example-refusals`
and compared each stored **prose label** against the live refusal. All thirteen
matched. I reported it as a clean negative and said why it was worth reporting:
a check that could have failed, passing, means something.

It does. It just did not mean what I took from it, which was that the file was
verified.

Each row of that file is `name count description`. I checked the third column.
The gate, on the next run, checked the second:

```text
  13 example(s) carry a refusal, all accounted for
  progress, and the table is stale:
    array-from-unsupported refuses 1, down from 2 -- edit the table
```

One row had been wrong since `86994fb4`, which is the commit that landed
`Array.from`'s mapped-callback arm and cleared one of that example's two
refusals. My commit. I walked the file afterwards, column by column, and walked
the column that was right.

## Why it passed rather than failed

By design, and the design is correct. The step's own comment:

> A count that has gone *down* prints a note and passes -- that is somebody's
> progress and the file should be edited to match. A count that has gone up, or
> a name absent from the file, fails: it is a fixture measuring less than it
> says.

A gate that goes red when you fix something teaches people to stop fixing
things. So this prints and passes — and therefore relies on a person acting on a
line in a passing run, which is the weakest link any instrument can have. It had
printed on every gate run since that commit and been read as scenery, by me,
including on the run where I then went and audited the same file.

## What the staleness actually costs, which is not tidiness

A stale-high count is a **blind spot exactly the size of the progress**. The
comparison is `count > want`, so with `want` left at 2 a regression back to 2
passes silently. The row that documents an improvement is the row that stops
guarding it, and it stops guarding precisely the thing that just changed — the
code most likely to regress.

So "edit the table" is not bookkeeping. Until it is edited, the fixture measures
less than it says, which is the exact failure the step exists to catch, arrived
at through the door marked progress.

## The shape

The JVM lane hit the mirror of this twice in the same hours: a ratio that was
arithmetically right, compared against a denominator nobody had looked at —
`66-against-33` as a 2x deficit against a method that also loses, and `1.00x` as
a failed bar on a row where every implementation including node is at a hardware
floor. Right number, wrong column.

Mine is right *column*, wrong column — I verified one and concluded about the
row. Both are the same error one level up from [[0311]]: the instrument answered
cleanly, and the clean answer was about a subset nobody had stated. The fix is
not "check harder". It is to say which column a check covered when reporting
that it passed, because "all thirteen still match" is a sentence that sounds
like it covers the file and covers a third of it.

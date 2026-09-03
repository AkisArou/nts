# 0063 — The table nothing checked

`docs/primitives.md` is nine rows and about forty claims: that each primitive
has an example node agrees with, a memory case at its floor, a benchmark row,
and a record — and what each of those measures. It has been the answer to "is
this primitive done" since 0050 wrote it.

Nothing checked any of it.

## Both halves had already failed once

That is not hypothetical on either axis. 0053 exists because the absence
primitive had two ratchets and had never been timed, and the table is what made
the hole visible — by having a column for it and leaving the cell empty. A
person noticed. Nothing would have.

And checking the numbers by hand, once, found the `strings` row claiming 0.05x
node where the board says 0.09x. Small, and node's own timing on that row swung
between 2.31us and 3.81us across one afternoon, so it is drift rather than a
regression. But a number in a table that no run produces is the shape of the
problem, whatever its size.

## What it checks

`tooling/primitives/check.py`, in two halves that cost differently:

**Existence**, from the filesystem alone: every example, memory case, benchmark
row and record the table names is there. Milliseconds, so it is a gate step.

**Freshness**, against the output of a benchmark run: the speed column says what
the board says, within 0.03 — because node moves by more than a hundredth
between runs and a check that fails on that is a check nobody keeps. Run by
hand, since the gate does not run benchmarks and should not.

## That it can fail

Injected two faults — a memory case renamed to one that does not exist, and
`substrings` left at its old 1.87x — and it reported three problems and exited
1. Recorded because the rule is that a check which cannot fail is not one, and
the way to know is to break it on purpose rather than to read it.

    string: no memory case `case-convert-x`
    string: `substrings` says 1.87 against C++, the board says 0.92
    string: `substrings` says 0.48 against node, the board says 0.24

## What it does not check

That a memory case is *at* its floor, that an example *agrees* with node, that a
benchmark row *passes* — the suite, the differential and the bench each answer
their own question and the gate already runs all three. This one only asks
whether the table is telling the truth about what those are.

Which is the whole of it: nine rows saying "closed", and now something that
fails when one of them is not.

# 0152 — A row published at 1.16x and measured at 0.91x

`generic-classes` moved from 1.03x to 1.16x across two publishes today and I
flagged it twice as unexplained rather than call it noise. It is worse than
noise: the two numbers are of the same two programs and they disagree by 27%.

## The check

Its prepared HIR contains no `i64`, no array, no erasure, and its operations are
`add`, `and`, `call`, `const`, `convert`, `eq`, `field.get`, `lt`, `object.new`,
`param`, `xor`. Nothing any change this session made can reach it -- the
narrowing pass was about `i64`, the widening extension excludes any class that
computes a member, and `widen` refuses a class touched by `and` or `xor`
outright. So the emitted bytecode is the same bytecode.

A fixed-count driver over the same two programs -- ours and the published Java
reference, `work` called N times, measured at 20,000 and 40,000 and subtracted,
three repetitions, medians:

| | instructions/call | cycles/call |
| --- | ---: | ---: |
| hand-written Java | 39,211 | 12,985 |
| **ours** | **36,624** | **11,875** |

**We execute 6.6% fewer instructions and take 8.5% fewer cycles.** By this
instrument the row is **0.91x**. The suite publishes it at **1.16x**.

## What that means for the column

The harness warns when a row varies more than 1.1x across its own five runs, and
this row did not trip it in either publish. That check catches a row whose JIT
mode is unstable *within one invocation of the harness*; it cannot see a row
that settles consistently into one mode this hour and another mode next hour,
which is what a 1.03x and a 1.16x of the same bytes look like.

So the sub-1.10x band of the `nts (JVM)/Java` column is not resolvable by the
published number alone, at least on rows of a microsecond or two. Twelve of the
twenty-three rows currently above 1.00x sit in that band. That does not make the
column wrong -- `elementwise` at 7.61x and `optional-chain` at 2.12x were real
and moved when the cause was removed -- but it does mean **a row at 1.02x and a
row at 0.98x are the same reading**, and treating the tally as a score to
maximise would optimise noise.

The instrument that does resolve them is the one used here, and it is not
expensive: a fixed-count driver, two counts, subtracted. It removes startup, it
removes warmup, and instructions per operation are load-independent so it does
not even need the measurement lock. What it costs is a driver per case, which
is the reason it has been used per-investigation rather than per-row.

## What I am not doing about it

Not rewriting the harness. The published table is best-of-five with calibration
because that is what `bench.mjs` does for node and what makes the columns
comparable to each other, and changing it would break every historical number
in these records.

What changes is how the small rows get read: **below about 1.10x, believe a
fixed-count measurement over the published one**, and do not spend a change on a
row whose whole gap is inside that band without measuring it that way first. On
this row it would have been spent on a row we were already winning.

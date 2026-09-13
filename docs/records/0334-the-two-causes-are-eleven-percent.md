# The two causes are eleven percent, and I had been reading them as the blocker

A census across all 26 modules, `--top=400` so nothing is truncated, taken to
settle which row to build next. It settled a different question.

## The number

    roots: 203   things: 839   sites: 1388
    top 2 roots:  93 things (11%)
    top 10 roots: 257 things (31%)

The three totals reconcile exactly with the census's own header line, which is
the control that says the filter is reading the table and not the prose around
it. It did not on the first run: `$1 ~ /^[0-9]+$/` also matches
`26 module(s), …` and `1494 further things refuse only because …`, and the sum
came out at 3069 things across 216 roots against a header saying 839 and 203.
Requiring all three columns numeric fixed it. A count whose unit is wrong looks
exactly like a count.

## What it corrects

[[0331]] ends: *"Two causes, 93 distinct things, one missing mechanism."* That
sentence is true and I had been reading a claim into it that it does not make.
93 distinct things is **11% of the 839** that refuse at a root, spread across a
203-root long tail where the top ten together are less than a third. There is no
dominant cause. I had been treating the interface-representation work as *the*
blocker and deferring smaller rows behind it, which is a ranking the distribution
does not support.

## What it does not settle, which is the part worth keeping

It does not say that clearing those 93 would free 11% of anything. The census
header carries a second number I had been walking past:

    1494 further things refuse only because something they call was refused.

That is **64% of the 2333 things affected in total**, and it is unattributed —
the table ranks roots, and a root's cascade is not counted beside it. So a root
with 45 things behind it and a root with 45 things behind it are indistinguish-
able here even if one of them is the head of every chain in the module and the
other is a leaf.

Which is the same error in the other direction, and this project has already
paid for it once: `last-mile.mjs` ranked `internal/errors.ts:547` as reached by
fifteen of twenty-two modules, it was cleared, and **none of the fifteen moved**.
Reach counts chains passing through a point and says nothing about what is on
the far side. Root-rank counts what refuses first and says nothing about what
refuses behind it.

`tooling/conformance/prize.mjs` is the instrument that answers the question both
of these dodge: for each module it runs node's own tests twice, interpreted and
compiled, and the files that pass interpreted and fail compiled are the prize.
That is measured yield rather than ranked reach, and it is what should order the
queue. It is a long sweep and I have not run it; naming it as the next
measurement is the honest end of this record rather than a conclusion I can
state now.

## The shape

Three times today a number and the sentence beside it travelled together and
only the number was measured: a ledger row whose stated obstacle described a
reverted attempt rather than the live refusal, a note claiming a narrower
object-literal rule was reachable when dispatch is per-layout, and now a count
of distinct things read as a share of the work. The JVM lane put it better than
I will, arriving at it from `benches/jvm-rows.md` the same afternoon: **a named
cause that has never been applied is a hypothesis wearing a measurement's
clothes.**

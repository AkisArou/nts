# 0155 — Three rows published as wins are not

Record 0154 found that a row published at 1.16x measured differently, and drew
the wrong conclusion from the wrong counter. This is what happened when the
instrument was pointed at the whole column instead of one row, including — at
another session's insistence — the half of it I had no reason to doubt.

Thirty rows carry a Java reference. I re-read all of them with a fixed-count
driver, and the three that matter most are ones I published this afternoon as
wins.

## The losses recorded as wins

| row | published | instructions | cycles |
| --- | ---: | ---: | ---: |
| `awfy-sieve` | **0.94** | **1.07** | **1.15** |
| `objects` | **0.93** | **1.03** | 1.22 / 1.35 / 0.53 |
| `awfy-bounce` | **0.95** | 0.97 | 1.02 / 0.70 / 1.01 |

`awfy-sieve` is not ambiguous. Three repetitions under the lock give 1.07,
1.07, 1.07 in instructions and 1.15, 1.14, 1.15 in cycles — both counters
agreeing, both stable to a percent, both above parity, against a published
0.94x. **It is a loss recorded as a win.**

`objects` does 3% more work consistently and its cycle ratio will not sit still
(1.22, 1.35, 0.53). `awfy-bounce` is at parity within noise. Neither is the
clean result `awfy-sieve` is, and both were published under 1.00x.

**So it is six of the eight AWFY rows under hand-written Java, not seven.**
`awfy-queens` and `awfy-sieve` are above, and `awfy-bounce` sits on the line.
This afternoon's table and its commit message both say seven. They are wrong
and this record is the correction.

## The wins recorded as losses, which nobody would have found

The same instrument, in the other direction:

| row | published | instructions | cycles |
| --- | ---: | ---: | ---: |
| `instanceof` | 1.10 | **1.00** | **0.94** |
| `erasure-typed` | 1.00 | 0.83 | **0.67** |
| `erasure-unknown` | 1.00 | 0.83 | **0.72** |
| `substrings` | 0.97 | **0.41** | 0.92 |
| `erasure-stored-unknown` | 0.96 | **0.29** | 0.95 |
| `bytes` | 1.01 | 0.96 | 1.01 |
| `module-closures` | 1.06 | 1.01 | — |

`erasure-stored-unknown` executes **29%** of the reference's instructions,
because the Java version boxes a `Double` per element where an `NtsValue`
carries the double in a field it already has. `substrings` executes 41%. Those
are large facts about this backend that the published column rounds to *about
the same*.

## And two that got worse

`generic-classes` at 1.40x in cycles against a published 1.16x — record 0154
has that one, and it is the largest unexplained loss among the small rows.
`symbol-keys` does 18% more work than its published 1.04x suggests, though only
5% more time.

## Why the errors are not symmetric

Every row I had queued for investigation was one published above 1.00x. Nobody
re-reads a win, so a loss recorded as a win survives, and the three above did —
one of them load-bearing for a headline I wrote four hours ago.

This is the same asymmetry `docs/conformance/typescript.md` was found to have
this week, where a `✅` beside a refused fixture had stood for months while the
opposite error would have been noticed the first time anyone wondered why a
working feature was listed as missing. **The direction that persists is the one
that claims more**, in a table of ratios exactly as in a table of capabilities,
and a re-read that only covers the rows you already distrust cannot find it.

I did not plan to check the green rows. nts-69 said to, in as many words, and
they were right.

## What to do about the column

Not rewrite the harness. Best-of-five with calibration is what `bench.mjs` does
for node, and it is what makes the columns comparable to each other; changing it
would invalidate every number in these records.

What the harness reports is **the best mode this lane has**, which is the right
number when a distribution is tight and a flattering one when it is wide — and
ours is the wide one on the rows that disagree. The generated prose beside the
table now says so, because a reader cannot infer it and the notes the harness
already prints only fire when a row varies *within* one invocation.

The queue that comes out of this is shorter and different from the one that went
in. `instanceof`, `bytes` and `module-closures` come off it. `awfy-sieve`,
`objects` and `generic-classes` go on.

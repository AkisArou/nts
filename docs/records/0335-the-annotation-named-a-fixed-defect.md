# The instrument's annotation named a defect that was fixed

`prize.mjs --all`, run to order the remaining conformance work by measured yield
rather than by the census's ranked reach. It produced the ordering. It also
produced two ways of being wrong that I nearly took.

## The number the sweep is for

    26 modules   1980 files pass interpreted   48 pass compiled   1934 to gain

Those reconcile: 46 files pass both, and **2 pass compiled while failing
interpreted**, which the instrument flags itself as "an assertion holding for a
reason other than the one it states" — both in `net`, both
`test-listen-fd-detached*`, and both a matter for the Node lane rather than this
one.

So the compiled lane reaches **48 of 1980** of node's own test files. That is the
axis, measured against the suite that decides it rather than against refusal
counts.

## One: the ranking covered 6.9% and looked like a ranking

Ranking the failure reasons gave a clean table topped by "an exit handler
failed" at 10 files. Before reporting it I counted the denominator:

    FAIL lines printed: 134   files to gain: 1934   coverage: 6.9%

`prize.mjs` printed `gain.slice(0, 8)` per module. Every reason is computed; only
the **printing** was capped. So the table was the top of an arbitrary
eight-per-module sample, and any cause living in a module's ninth-or-later
failure was invisible to it.

What made this recoverable is a property worth copying rather than a discipline
of mine: the tool prints `… 107 more`. It bounded its coverage **and said so**,
which is the only reason 6.9% was computable at all. A silent truncation would
have handed me a ranking I would have believed and pointed the remaining work at.

Raised to `NTS_PRIZE_ROWS`, default still 8 so ordinary reading is unchanged, and
verified with both arms on a module that elides: default `… 13 more`, override no
elision.

## Two: the second gate names a defect that no longer exists

Eight of the 26 modules print a line like

    second gate: createServer take an optional parameter, which publishes as required
                 -- appearing is not enough; see optional-parameter-at-the-wrapper

and its doc comment states the consequence plainly: *"An export that appears
still publishes its optional parameters as required, so
`dgram.createSocket("udp4")` throws."*

`blockers/optional-parameter-at-the-wrapper` says, in its first line of prose:
**"FIXED, kept as a guard. An optional parameter crosses as optional."**

Checked against the live addon rather than against either document:

    path.basename("/a/b.txt")         -> "b.txt"
    path.basename("/a/b.txt", ".txt") -> "b"

Two arms, one of them the exact call the blocker records as having thrown. The
defect is fixed, the fixture guarding it is in the gate, and the instrument's
annotation went on describing it every sweep.

**And it is printed where it could not apply anyway.** `createServer` and
`createSocket` are the two names the annotation calls the largest prizes, and
neither is published at all — `net` publishes seven names and `dgram` publishes
**zero**. They are blocked by the first gate, and the second gate is moot until
they clear it.

I was one step from ranking `[optional-param]` as the top item of the remaining
queue on the strength of `createServer (96)` — which is a count of files
*mentioning* the name, not files blocked by it, and so not summable either.

## Why both halves are the same failure

The cap and the annotation are both **a claim that travelled without its
measurement**. The cap was an honest readability default that became a sampling
rule the moment anyone aggregated across it. The annotation was true when written
and went false when the defect was fixed, with nothing to notice — the same shape
as a doc comment falsified from elsewhere, which this project has recorded before
and which I hit again today in row 2024's stated obstacle.

The JVM lane's phrasing, arrived at independently the same afternoon from
`benches/jvm-rows.md`: **a named cause that has never been applied is a
hypothesis wearing a measurement's clothes.** An annotation that was applied once
and never re-applied is the same animal a year older.

The instrument is not wrong to carry the note. It is wrong to carry it as a
present-tense statement about the compiler, when what it can actually see is a
syntactic property of a TypeScript signature.

# The guard proved it and the merge threw it away

`benches/cases/node-utf8` is 6.69x and 62% of its profile is `toInt32`. The
cause is not integers, and it is not that row: **every `if (a >= lo && a < hi)`
in the tree loses its refinement**, which is the commonest way anyone writes a
range check.

## What is measured

Twenty-three coercions, eighteen of them on *block parameters* — loop-carried
values held in `f64` slots, converted at every use. They cannot be `i32` because
the code-point phi is

    %56  f64  [-2147474432, 2147558398] whole nan?

about 75,000 outside `i32` at both ends. `utf8Write` computes it as

    if (code >= 0xd800 && code < 0xdc00) {
      const next = ...;
      if (next >= 0xdc00 && next < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00;

which is provably `[0x10000, 0x10FFFF]` inside those guards, and comfortably
`i32`. Measured, `code - 0xd800` is `[-55296, 10239]` — exactly `[0, 65535]`
minus `55296`. The guard proved nothing.

## Why

`flow::refine_edge` does real interval refinement, and fires only when the
branch condition *is* a comparison. `&&` does not leave one:

    b0: %4 = ge %2, %3     br %4, b1, b2
    b1: %6 = lt %2, %5     jump b3(%6)
    b2:                    jump b3(%4)
    b3(%7: bool):          br %7, b4, b5

The short circuit materialises a boolean into a block parameter. The branch that
matters is on `%7`, which is not a comparison, so both comparisons' facts are
dropped at the merge.

## The two routes, and why neither was taken here

**Lower a logical operator in condition position as control flow**, so each
comparison branches directly. The obstacle is not the idea: `a && b` then
produces *several* false edges into the else block, and `lower_if` patches
exactly one `branch_block`'s arguments after the merge acquires parameters. That
is the most load-bearing bookkeeping in the lowering.

**Or teach the analysis to see through the boolean phi.** The JVM lane had
already built the enabling half of this yesterday — as a *backend* pass, to
delete the merge for speed. It worked, 55 bytecodes to 46, and was worth 0.16%,
because C2 already sees through a store-and-reload. The same transformation is
62% of the worst row one layer up. It is at `~/.cache/nts-merge-threading`.

Their structural correction is the part worth keeping. The framing "intersect
over the predecessors that can pass `true`" has the difficulty in the wrong
place: **the hard half is proving that a predecessor cannot**, and without it
the intersection is empty of information, because `b2` looks like it might pass
`true` and its facts are nothing. Four conditions decide it — a block with
exactly one predecessor, whose terminator is a branch, whose arms differ, gives
`%c = true` in one arm and `false` in the other. At `b2`, `%4` is false, so
`jump b3(%4)` provably passes `false`, so `b2` is not a `true`-source, so only
`b1` remains and there is nothing left to intersect.

## What stopped it, stated so it is not read as unattempted

Three caveats from the lane that built it, and the third is decisive.

Theirs carried a **boolean**; this needs an **interval**. A wrong boolean is a
wrong constant the verifier or the differential catches on the next run; a wrong
interval is a silently wrong `i32`. That asymmetry is real.

Theirs ran on one backend's view of an already-prepared function. This runs
where every lane reads the result.

And it was never tested against a **loop-carried phi**, which is precisely
`node-utf8`'s case: their diamonds were all acyclic, and a back edge into `b3`
adds a predecessor whose fact is not yet known. Their own assessment is that
they would assume it wrong until shown otherwise.

## The other half, which did land and is worth nothing today

`bounds::eliminate_checks` is the line that *proves* a string index in range, so
it is where `f64` stops being the honest type for a code unit — in range it is a
`uint16` and `nts_unit` returns one. It now retypes there.

`specialize` already believed this: its `usable` arm says a `checked: false`
read "is a `uint16`: integral, in range, and not NaN". It could only act through
a class that **pays**, and a comparison does not pay, so a classification loop
kept every unit in floating point.

The web-platform lane measured it on the row it was aimed at and **nothing
moved** — 1.14x to 1.15x on `json-serialize`, 1.19x to 1.20x on `json-scan`,
quoted as ratios because the machine got quieter and node fell too. Which is
what the `pays` gate said in the first place: a class with no arithmetic in it
has nothing to make faster. Overriding a heuristic that was right about this
shape bought zero.

It is kept on two arguments, neither about speed. A code unit proven inside its
string *is* a `uint16`, and a fact should not depend on what the value is later
used for. And no SIMD path — escape-class scanning, UTF-8 validation, base64 —
can exist while the loop carries `f64`: nothing widens `<32 x i8>` out of
doubles. Gates do not show up on the rows they gate.

## Two instruments that were wrong on the way

Counting `f64` *reads* to measure a change to arithmetic types. It reported
`json-serialize` unchanged at 6 → 6 while the same function went from seven
float constants and no integer ones to one and six — the read there was never
checked, so the count could not see the thing that moved.

And a whole-file value map over a multi-function HIR dump, which reported "18 of
23 coercions are on booleans". Value ids repeat per function. Rebuilt per
function, the answer is block parameters, which is the finding.

# 0164 — `String(n)` of an int32 went through a double formatter

The third member of a family, and the first one priced before it was built.

`number-format`'s TypeScript is deliberate about what it formats:

    const small = (round + seed) | 0;
    const wide  = (round * 7919 + seed) | 0;
    const a = String(small);

Every value is an int32 and says so with a `| 0`. The prepared HIR agrees —
`%13 : i32` — and then:

    %93 = convert %13 : f64
    %29 = call.extern nts_number_to_string(%93) : managed<str>

`hir::runtime` types `nts_number_to_string` as taking a `double`, which is
correct and is the single answer about conversions that all three backends read.
So the middle end widens, and this lane answered with the **Grisu port** — a
routine that exists to print every double node can print, `1e21` and `-0` and
seventeen significant digits, reached with a value that was an `i32` two
instructions ago.

`Integer.toString(int)` where the argument is a `Convert` from a signed integer
of at most 32 bits. Six sites on that row.

## Exact, not approximate

An `i32` cannot be `-0`, so the one case where a double formatter and an integer
formatter genuinely differ cannot arise. `Integer.MIN_VALUE` prints
`-2147483648` and node's `String(-2147483648)` is the same. Across the whole
`i32` range the two agree character for character, which is what makes this a
representation choice rather than a fast path with a fallback.

## The family, and where it hides

| | found in | worth |
| --- | --- | ---: |
| the array subscript, `get(a, double)` | 0138 | **4.56x** on `growth-grown` |
| the growable length, `length(a) -> double` | 0158 | ten sites, measured ~0 alone |
| **`String(n)` of an int32** | here | six sites on `number-format` |

All three are a helper whose only signature answers in a `double`, reached from
generated code that had an integer. **All three are visible in a descriptor and
invisible in a profile** — a conversion is two instructions attributed to
whatever frame it sits in, and `nts_number_to_string` looks like exactly what it
should be until you read what is on the stack in front of it.

Record 0158 called the family closed after auditing `NtsArrayD`. It audited the
wrong thing: the family is not "helpers on the array wrapper", it is **every
entry in the extern table whose descriptor says `D` where the caller had an
`I`**, and the array wrapper was only where I had been looking.

## Priced first, which is the point

Record 0163 arrived at *price the replacement before you build it, not the thing
you are removing*, and split changes three ways: priceable and small, build it;
priceable and not small, you are done without building; **unpriceable, and only
then does the experiment earn its run.**

This is the first case. The replacement is `Integer.toString` — a JDK intrinsic
formatting an `int` in tens of instructions against a Grisu conversion in
hundreds. That price is known without measuring, so the change needed a
*verification* rather than an A/B, and it got one: six sites emit
`Integer.toString`, `examples/strings` agrees with node on every case, and the
corpus reports no new declines.

The contrast is the map numeric-key path an hour earlier, where the replacement
was a second probe on every insert. I did not price it, and it cost **0.23x**.

`number-format-double` is the control and it must not move: it formats genuine
doubles, its values are not `| 0`'d, and the Grisu port is what it should keep
reaching. A change that sped up both rows would be a change that had broken one.

---

## Measured: **zero**, and the rule that failed is the one this record cites

    number-format          1.22x  ->  1.22x
    number-format-double   1.41x  ->  1.43x     control, held
    dispatch               0.67x  ->  0.70x     control, held

Six sites emit `Integer.toString`, the substitution is exact, the gate is green
at 111 of 111 — **and the row did not move.**

The arithmetic I did not do: that case formats three numbers a round and then
**sums every character of all three**, which is about 22 `charCodeAt` per round
against 3 conversions. Formatting is a fiftieth of the work. A replacement that
is ten times cheaper than what it replaces moves a row by nothing when the thing
replaced is two percent of it.

So record 0163's rule is necessary and **not sufficient**. *Price the
replacement, not the thing you are removing* stops one short of its own point:

> **Price the replacement, and price the share.**

The saving is `share x (1 - replacement/original)`, and I had been computing the
second factor and assuming the first was 1. Every one of today's four
over-promises is a term in that product:

| | share | replacement | outcome |
| --- | ---: | --- | ---: |
| `map-and-set` keys | unmeasured | a second probe, not free | **worse** |
| conversions in `queens` (nts-69) | unmeasured | inlining, not free | zero |
| `findLinear` | **20.64%, measured** | hashing, not free | 2% |
| `String(n)` here | **2%, not measured** | free enough | **zero** |

The third and fourth are the instructive pair. On `findLinear` I had the share
and not the replacement's price. Here I had the replacement's price and not the
share. Both predicted a win and both got approximately nothing, by opposite
omissions.

## Kept rather than reverted, and the reason is not the number

A change measuring zero is normally reverted here. This one stays on the same
footing as `count()` in 0158 and the proved growable store: **it is a deletion**.
Six Grisu calls become six JDK intrinsic calls, the emitted code is smaller, the
substitution is exact on every `i32`, and nothing was added to carry it.

What is reverted is the *claim*. I wrote that this was the first change built
under 0163's rule without an A/B because the replacement was priceable. The
replacement was priceable and the change still needed the run, because the rule
I was following had a factor missing.

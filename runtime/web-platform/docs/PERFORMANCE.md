# The performance objective, and what is currently established

This file is the objective. The goal text points here rather than carrying numbers, because
numbers go stale in a prompt and nobody notices; here they go stale in a file that a slice is
required to update, and the staleness is a diff.

**Keeping this correct is part of every performance slice.** A finding that contradicts something
below moves it into "Refuted" with the measurement that killed it. That has already happened
once, to a claim written by the same hand that is writing this.

## The target

Beat node **and** bun on every JSON row. bun is the real bar: it is the same TypeScript on a
better JIT, so losing to it is losing on the code we generate rather than on the language.

## Where it stands

Measured on one pinned binary, both sides, machine idle. A run that reports variance above about
1.2x across its five repetitions is a contended run and is not a number -- `wait-idle.sh` first,
then `with-lock.sh`.

| row | nts C | node | bun | nts/node | nts/bun |
| --- | --- | --- | --- | --- | --- |
| `json-serialize` | 14.53us | 12.11us | 7.19us | 1.16x | 1.98x |
| `json-scan` | **2.41us** (llvm 2.25) | 2.35us | 2.17us | 0.96x | 1.04x |
| `json-build-append` | 21.17us | 15.69us | 9.69us | 1.25x | 2.03x |
| `json-build-join` | 20.78us | 22.43us | 14.56us | **0.95x** | 1.46x |

One row is already faster than node. None is faster than bun, though `json-scan` is now within
6% of it.

**The node column is the noisy one.** `json-scan` on node measured 3.09, 5.16 and 2.92 across
three idle runs of the same source. Take a node number twice before believing a ratio built on it;
the nts column has been stable to about 2% throughout.

## What the bench table does and does not compare

**Every JSON row imports our own TypeScript, so the node and bun columns are those engines
running our code -- not their built-in `JSON`.** That makes the table a fair *compiler*
comparison and it is the right instrument for "does nts lower this well". It is not the
instrument for "is our JSON faster than node's JSON", and the goal's wording invites confusing
the two.

The harness cannot express the second question: one source is compiled four ways on purpose, so
that no column drifts from another. A case calling `JSON.parse` would give node and bun their
native parsers and this compiler a refusal -- see below.

## The ceiling, measured

A 1,668,869-byte document with the shape real JSON has. Every row below walks its result to the
same checksum (48566374) or the same length, so the work is controlled across implementations.

| parse | ms | | stringify | ms |
| --- | ---: | --- | --- | ---: |
| simdjson (C++, SIMD) | **0.851** | | bun native | **1.186** |
| bun native | 2.962 | | node native | 2.823 |
| node native | 4.744 | | ours on bun | 9.781 |
| ours on bun | 16.938 | | ours on node | 11.038 |
| ours on node | 19.445 | | | |
| ours + `toPlainValue` (node) | 23.681 | | | |

Three things follow, and the third is the one that matters.

**Our TypeScript is 4x off native on the same engine, and that is not a defect.** V8's parser is
hand-written C++; ours is TypeScript. No amount of tuning closes that *on a host*. The host path
exists for what node's parser does not do -- `context.source`, `rawJSON`, exact error text.

**A real-world parse walks the document twice.** `parseJsonText` builds the erased graph and
`toPlainValue` walks it into plain JavaScript values: 19.445ms becomes 23.681ms, so the second
pass is 22%. Without a reviver the graph is a pure intermediate and could be skipped entirely.

**node's own parser is 5.6x off the hardware.** That is the headroom that makes the goal
plausible at all: beating node does not require beating simdjson, it requires closing 4x with
compiled code, and the `json-scan` result shows what one codegen fix is worth.

## Established, with the counterfactual that established it

**Allocation volume is nearly free.** `json-build-append` and `json-build-join` produce the
identical document and return the identical checksum, so the pair is controlled by construction.
81x the allocation blocks and 18x the bytes, and no difference in time -- 21.17us against
20.78us.

**Reference counting is a net win, not a tax.** The same program under `NoGc` is 40.68us against
17.78us: 2.3x *slower*, because the working set stops fitting. Do not remove it. `nts_each_reference`
sitting at 20% of a profile is not an invitation.

**The hosts rope their concatenations and we do not.** node runs the append spelling 1.43x faster
than the join spelling and bun 1.50x faster; nts is flat between them. **A benchmark written with
`+=` flatters a host.** `json-serialize` is written that way and should be read knowing it.

**Specialization pays where numbers are formatted, not where characters are read.** `nts f64`
costs 1.20x on `json-serialize` and nothing at all on `json-scan` (4.39 against 4.33).

**An index that crosses a function parameter stops being an integer, and that costs 19%.**
The runtime has two entries behind `charCodeAt`. The integer one is an unsigned compare and a
read; the double one truncates through `ToIntegerOrInfinity`, compares twice in floating point
against a converted length, then converts again. A loop-local index is proved `int32` and gets the
fast entry -- which is why the escaper always had it. An index passed as a `number` **parameter**
is a double and gets the slow one, on every character.

`json-scan` read through `codeAt(source, at, length)` and paid it fourteen times per number.
`| 0` at each read restores the fast entry but leaves a conversion per character: 4.33us to
3.51us. Coercing **once at function entry** and keeping the index integer across every increment
(`at = (at + 1) | 0`) removes the conversion too: **4.33us to 2.41us, 46%**, and `nts f64` went
from 4.39 to 6.21 against it -- specialization now carries this row, where before it did nothing.

Two things pin the index, and only one is obvious. Coercing at entry is not enough on its own:
`at++` widens it straight back to a double, and all fourteen reads return to the slow entry. The
first version of this kept its `at < end` guard and stayed fast **because comparing against an
`int32` re-pinned the type** -- the guard was load-bearing for a reason that had nothing to do
with bounds. Removing the guard without also fixing the increments took the emission from 22 fast
reads to 27 slow ones.

The guard is gone for a separate reason: past the end `charCodeAt` is NaN, and every use of a unit
in the scan is `=== ` a constant or `isDigit`, all of which NaN fails. NaN *is* the end-of-input
sentinel, so the guard duplicated the one inside `charCodeAt`. Its `length` parameter went with
it rather than being left unused, since both callers passed `source.length` and a caller passing
a narrower limit would now be silently wrong.

This is checkable without running anything -- `grep nts_str_char_code_at_int` the emitted C -- and
it was found that way, not from a profile. **Across every bench emission, only four cases select
the integer entry.** The defect is general and this fixed one instance of it; `case-convert` and
the eight `utf8-*` cases still read through the slow entry and are not mine.

**The escaper is the program.** `quoteJSONString` is 26.98% of `json-build-append` and 36.62% of
`json-build-join`. Assembly strategy is a sideshow.

## Refuted

**"Making the classification integer will help."** A code unit read with `charCodeAt` is held as
a `double`, and the escaper compared it against `92.0` and `32.0` in floating point. `| 0` at the
read turns the whole classification integer -- the body went from mostly-`double` locals to 36
`int32_t` against 9, confirmed in the emitted C, which is deterministic.

It bought nothing. On a clean run `json-build-join` went 20.78us to 22.68us, `append` 21.17 to
21.96, `json-serialize` 15.02 to 15.37. Probably because `unicodeEscape` and the escape-table
index both take a number, so the conversions moved rather than left. Reverted.

**Better-looking generated code is not a faster program**, and reading the emitted C is a way to
confirm a change happened, not a way to confirm it helped.

**"Removing the redundant slice will help."** A string needing no escaping was still copied
whole: `out + value.slice(plainFrom) + '"'` with `plainFrom` at zero. `nts_str_range` has no
whole-string fast path -- it allocates and `memcpy`s -- so skipping it when `plainFrom === 0`
removes a real allocation and a real copy on the majority of strings, keys included. `member`
likewise stopped appending `""` when there is no gap.

Not measurable. `json-serialize` 15.02us to 14.53us with node moving 12.68 to 12.11 in the same
pair of runs; `json-build-join` moved the wrong way by as much. Both changes are kept -- they are
strictly less work and cost nothing to read -- but they buy nothing, and **that was predictable
from the pair above and I did not predict it.** Allocation being nearly free means removing an
allocation is nearly worthless, which is the same sentence read in the other direction.

**"Serialization is allocation-bound; allocation is the lever."** Written into an earlier goal
from a profile showing `nts_each_reference` at 20%, with no counterfactual. The append/join pair
above disproves it. The error was substituting a ranking for a price, and it is the second time
that has happened here.

## The remaining gap, as currently understood

Per character the escaper pays a bounds check (often elided -- the emitted C calls `nts_unit`
directly), a test of `NTS_TWO_BYTE`, a load, and a conversion to `double` -- the conversion is
still there, since removing it from the comparisons bought nothing. A host specializes the loop
for narrow or wide **once** and then loads.

The representation test being per character is the shape of what is left. That is in the scan
loop, which is the condition the goal names for proposing a compiler intrinsic to MainClaude
rather than working around it.

## Instruments

`perf record -g` on `target/bench/<case>.nts`; `valgrind --tool=dhat` for allocation, normalised
by the checksum because the driver calibrates to ~100ms and each binary therefore runs a
different number of repetitions; `hyperfine`; the bench table's own `nts f64` column and the
per-case `provider` file, which are the two counterfactuals that come for free.

Reading the emitted C in `target/bench/<case>.specialized.c` is the one measurement that does not
care whether the machine is busy.

## The blocker that makes all of this unreachable

**`JSON.parse` and `JSON.stringify` are refused in compiled user code**: `NTS1001 \`JSON.parse\`,
a global member with no definition here`. The implementation is reachable only by importing
`jsonParse` from this module, which no ordinary program does. Until the global resolves to it,
nothing measured here reaches a user, and the question "is nts's JSON faster than node's" cannot
be asked in the terms a user would ask it. This is compiler-owned and is the first proposal.

## Open, and owned elsewhere

`SyntaxError` unrepresentable keeps the whole parser off the compiled axis and out of this table;
`Number(string)` keeps `numberValueOf` off it. Both are with MainClaude, `SyntaxError` first.
Direct typed materialization -- one pass instead of building a graph and walking it again -- needs
the `JsonParse` boundary, which is compiler-owned. Propose, do not route around.

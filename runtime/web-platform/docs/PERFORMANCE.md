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
| `json-serialize` | 15.02us | 12.68us | 7.19us | 1.12x | 1.98x |
| `json-scan` | 4.33us | 3.09us | 3.55us | 1.33x | 1.22x |
| `json-build-append` | 21.17us | 15.69us | 9.69us | 1.25x | 2.03x |
| `json-build-join` | 20.78us | 22.43us | 14.56us | **0.95x** | 1.46x |

One row is already faster than node. None is faster than bun.

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

## Open, and owned elsewhere

`SyntaxError` unrepresentable keeps the whole parser off the compiled axis and out of this table;
`Number(string)` keeps `numberValueOf` off it. Both are with MainClaude, `SyntaxError` first.
Direct typed materialization -- one pass instead of building a graph and walking it again -- needs
the `JsonParse` boundary, which is compiler-owned. Propose, do not route around.

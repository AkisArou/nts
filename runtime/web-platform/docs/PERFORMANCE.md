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

| row | nts C | nts LLVM | nts f64 | node | bun | nts/node | nts/bun |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `json-serialize` | 14.87us | 14.52us | 17.84us | 12.79us | 6.79us | 1.14x | 2.14x |
| `json-scan` | 2.31us | 2.20us | 5.75us | 1.85us | 2.13us | 1.19x | 1.03x |
| `json-build-append` | 21.51us | 20.42us | 25.06us | 16.23us | 8.23us | 1.26x | 2.48x |
| `json-build-join` | 22.78us | 22.85us | 25.71us | 23.22us | 12.32us | **0.98x** | 1.85x |

One clean run, all four rows, so the columns are comparable to each other. The ratio column divides
by whichever nts backend is faster.

One row is faster than node. None is faster than bun, though `json-scan` is level with it.

**The node column is the noisy one, and on `json-scan` it is noisy enough to change the verdict.**
Across idle runs of identical source node has measured 1.85, 2.35, 2.86, 2.92, 3.09 and 5.16 on
that row while nts stayed between 2.20 and 2.45. So `json-scan` is *parity* -- ahead on some runs,
behind on others -- and a single run claiming either is not evidence. Take a node number twice.

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

**Built, and it is 2.46x.** `parsePlainText` parses straight into ordinary values and
`Body.json()` -- which is `response.json()` -- now takes it: **23.269ms to 9.465ms** on the same
document to the same checksum, from 4.8x off node's native parser to 1.95x. It shares the
`Scanner`, so the grammar, the error text and the number conversion are still spelled once, and
`test/json-plain-parse.test.ts` holds it against the canonical route and against node over every
corpus case, 2000 generated documents and every truncation of 400 of them, comparing error text
character for character. Two of three sabotages failed it loudly; the third -- returning a
different empty array -- is genuinely unobservable once the frame is popped, and a fourth, making
a closed container yield its parent, hung `deepStrictEqual` on the cycle it created rather than
failing an assertion.

**Skipping the graph is worth 2.8x on that path, and that is measured, not assumed.** A
throwaway one-pass parser -- recursive, no spec-exact errors, no source spans, written only to
bound the answer -- parses the same document to the same checksum in **8.450ms** against 23.681ms.
It lands 1.8x off node's native parser where the current route is 5.0x off. A real one would be
explicit-stack and would owe the specification a great deal that this one skips, so the true
number is smaller; it is not smaller than the difference between 2.8x and nothing.

The design question that comes with it is drift: a second parser is a second place for a spec bug.
The answer this project already uses is differential testing against the canonical one over the
whole upstream corpus, which is the same discipline as running against node.

**node's own parser is 5.6x off the hardware.** That is the headroom that makes the goal
plausible at all: beating node does not require beating simdjson, it requires closing 4x with
compiled code, and the `json-scan` result shows what one codegen fix is worth.

## Compiled against *native*, measured at last -- and the extrapolation was optimistic

The ceiling table below compares our TypeScript on a host with that host's built-in JSON, which
is a 4x gap and says nothing about compiled performance. `json-stringify-doc` is the first row
that answers the real question, because serialization compiles today where parsing does not:
`numberValueOf` ends in `Number(text)` and that direction is refused, while `numberText` is
`String(value)` and lowers to `nts_number_to_string`.

One 534,107-byte document, built once, serialized repeatedly. **The output is byte-identical to
`JSON.stringify`'s** -- checked character by character, not by length -- so the comparison is
controlled.

| | ms per serialize | vs node native |
| --- | ---: | ---: |
| bun native `JSON.stringify` | **0.455** | 0.51x |
| node native `JSON.stringify` | **0.885** | 1.00x |
| bun running *our* TypeScript | 2.06 - 2.38 | 2.6x |
| node running *our* TypeScript | 2.83 - 3.24 | 3.5x |
| nts JVM, compiled | 3.15 - 3.65 | 4.0x |
| nts C, compiled, `NoGc` | 4.87 | 5.5x |
| nts C, compiled, `rc` | 7.78 | **8.8x** |

**Compilation did not close the gap; it widened it.** Our compiled C is 8.8x off node's built-in
and 17.1x off bun's, where our TypeScript *on node* is 3.5x off. The host JIT beats our own
compiled output on our own code by 2.4x, and the JVM backend beats the C backend by 2.1x, which
is not the usual ordering and is its own finding.

**And the cause is not the escaper.** I predicted it would be -- 534,000 characters through a
per-character floating-point classification -- and the profile says otherwise:
`nts_collect_cycles` 9.7%, `nts_array_new` 8.5%, `nts_mark_gray_child` 7.8%, `nts_release` 5.0%,
`nts_each_reference` 3.2%, `malloc` 3.1%. That is cycle collection and allocation over a large
persistent object graph. (The profile covers module init as well as the timed loop and cannot
separate document construction from serialization; the `NoGc` counterfactual below is the
controlled version of the same claim.)

## And then the graph was removed, and the gap was the graph

`json-stringify-typed` is the same document again, byte-identical output again, serialized
straight from a typed structure with no `JsonValue` anywhere. It is what direct typed
materialization emits: at a boundary where the type is known, a serializer *for that type*
rather than a generic representation and a walk over it. Written by hand because the compiler
cannot emit it yet -- the point was to find out what it is worth before anyone ports the
implementation to native code on the assumption that it would not be enough.

| route | nts C | nts LLVM | nts JVM | node, our TS | bun, our TS |
| --- | ---: | ---: | ---: | ---: | ---: |
| graph (`json-stringify-doc`) | 7.20ms | 6.13 | 3.20 | 2.85 | 2.09 |
| typed (`json-stringify-typed`) | **1.26ms** | 1.21 | 1.06 | 0.860 | 0.878 |

**5.7x, from removing the intermediate.** Against the native serializers on the same document:

| | ms | our compiled typed route is |
| --- | ---: | --- |
| bun native `JSON.stringify` | 0.455 | 2.77x behind |
| node native `JSON.stringify` | 0.885 | **1.42x behind** |
| our typed TypeScript on node | 0.860 | -- |
| our compiled typed route | 1.26 | |

So the honest position moved from **8.8x off node's built-in to 1.42x**, and from 17.1x off bun's
to 2.77x, without touching the compiler, the escaper or the number formatter. Only the traversal
changed. Everything under the type is still `quoteJSONString` and `numberText`, unchanged,
because the escaping and number rules are the part that must not exist twice.

**Our typed TypeScript on node is 0.860ms against V8's own 0.885ms.** Essentially tied, and
faster is the expected direction rather than a surprise: a monomorphic serializer for a known
type does not enumerate properties, look for `toJSON`, or dispatch on a runtime kind. A generic
`JSON.stringify` must. Direct typed materialization is not a faster way to do the same work; it
is a smaller problem.

**The prediction was wrong and in the useful direction.** I predicted 2.5-4ms and 2-3x from the
profile, reasoning that the graph shrinks fivefold and 20,000 redundant key escapes per pass go
away. It is 1.26ms and 5.7x. Under-predicting is worth recording because the profile did not say
how much of the cost was *avoidable* -- it named `nts_collect_cycles` and `nts_array_new` as
large, and a profile never says what a different architecture would not do at all.

## Faster than node's built-in `JSON.stringify`

Four shapes of the same serializer, same document, byte-identical output every time. The last one
is ahead of node.

| route | nts C | vs node native | vs bun native |
| --- | ---: | ---: | ---: |
| graph, via `JsonValue` | 7.20ms | 9.1x behind | 21x behind |
| typed, factored | 1.26ms | 1.59x | 3.7x |
| typed, inlined | 0.99ms | 1.25x | 2.9x |
| **typed, inlined, escape append fused** | **0.691ms** | **0.88x -- ahead** | 2.03x |

The last row and the native numbers were taken in one window on an idle machine -- node 0.783ms,
bun 0.341ms -- because the natives move by 10% between sessions and a ratio built across two
windows is not a ratio. **10.2x from the first shape to the last, with no compiler change at all.**

**The fusion was worth 1.41x on its own**, 0.988ms to 0.707ms, against an estimate of 18%. What
it removes is the per-field intermediate: `out += quoteJSONString(x)` allocates the quoted
string, copies it into the accumulator and frees it, about twenty thousand times per
serialization. Fused, a string needing no escape becomes three in-place appends into a buffer
already at refcount 1, and allocates nothing.

**The classification is written once -- after a commit in which it was not, and I said it was.**
`firstEscapeIndex` came *out* of `quoteJSONString`, and the first version left `quoteFromIndex`
carrying its own copy of the same test and the same surrogate rule while the commit message
claimed both were written exactly once. Before that refactor the logic appeared once; after it,
twice. **The duplication this file argues against, introduced by the change that congratulated
itself on avoiding it**, and found by someone asking whether the fusion clashed with anything
rather than by any test.

The fix is that `quoteFromIndex` finds every subsequent escape through `firstEscapeIndex` too,
resuming where the last call stopped, so the string is still scanned once end to end.
`grep -c` on the classification test and on the surrogate rule each answer 1.

**It cost nothing.** 691us against 707us for the duplicated version, which is noise in the
favourable direction. That is worth stating plainly: the honest shape and the fast shape were the
same shape, and the argument for duplicating was never a measurement.

**What this row is and is not.** It is what a *generated* serializer for a statically known type
would do, written by hand to size the design before anyone builds it. It is not what ships today:
`JSON.stringify` is still refused in compiled user code, and the shipped path still builds the
erased graph. The number says the design is worth building, not that it is built.

The comparison with node is fair in the sense that matters -- same user code, same document, each
platform doing what it would actually do -- and unfair in one that should be stated: ours is
monomorphic for a known shape, node's must handle any object, look for `toJSON`, enumerate
properties and dispatch on runtime kinds. That difference *is* the advantage, and it is one a
dynamic engine cannot take.

## Two more shapes of the same serializer, and one of them is a trap

The typed row's profile says the largest remaining cost is string lifetime, not character work:
`nts_str_raw` 15.78%, `nts_release` 7.75%, `nts_free` 5.38%, `nts_each_reference` 3.63% -- about
32% allocating, counting and freeing short-lived strings -- against `quoteJSONString` at 18.45%
and `nts_grisu` at 8.56%. Every level builds its own string and hands it up.

**Threading the accumulator through helpers is 50x slower, and that is the important result.**
`appendRow(out, row)` returning the buffer looks like the obvious fix. `out = f(out, x)` has two
live references while `f` runs -- the caller's local and the parameter -- so `nts_str_append`'s
`reserved == 1` test fails and **every append copies the whole buffer.** LLVM measured 62.81ms
against 1.25ms; the arithmetic agrees, since 2,000 appends averaging 267KB is about 534MB of
memcpy and that is ~53ms at 10GB/s. The harness rejected the row outright for a backend
disparity, which is the sanity check working.

**The consequence is a constraint on code the compiler has not written yet.** A generated
serializer for a known type must emit *one flat function per boundary*, never a call tree that
passes the accumulator. The natural-looking factoring is the catastrophic one, and nothing but a
measurement says so.

**Inlining is worth 17.5% and needs no compiler change.** Keeping every append in one function so
the accumulator never crosses a parameter takes 1.26ms to **1.04ms** -- 1.42x off node's native
`JSON.stringify` becomes **1.18x**, and 2.77x off bun's becomes 2.29x. It removes the row, tags
and meta intermediates; it cannot remove the per-field ones, because `quoteJSONString` and
`numberText` still return strings that are allocated, copied in and freed.

**Hosts and an AOT target want opposite code shapes.** bun runs the *factored* version at 1.02ms
and the inlined one at 1.47ms -- it prefers small functions its JIT can specialize. Our compiled
C goes the other way, 1.26 to 1.04. node is flat, 0.885 to 0.822. A single source cannot be
optimal for both, which is worth knowing before any row here is read as a verdict on the code
rather than on the target.

**What is left is a compiler gap and it is now the smaller half.** 1.26ms compiled against 0.860
for the same TypeScript on node is 1.47x, which is the ordinary codegen distance this lane
already measures on every other row -- not a representation problem.

## Refuted here: "reference counting is a net win, not a tax"

That entry is below, established from `NoGc` running 40.68us against 17.78us on
`json-build-append` -- 2.3x *slower*. **It does not generalise, and this row is where it breaks.**
The same case under `NoGc` is **4.87ms against 7.78ms: 1.6x faster.**

The difference is the live set. `json-build-append` holds almost nothing between iterations, so
reclamation is cheap and not reclaiming means the working set stops fitting. This document is a
30,000-node `JsonValue` graph that survives every iteration, and the cycle collector walks it
again each time. **Reference counting is a win where the live set is small and a tax where it is
large**, and the earlier entry generalised from a workload that only ever showed one side.

Both measurements stand; only the sentence drawn from the first was too broad.

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
21.96, `json-serialize` 15.02 to 15.37. Reverted.

**Refuted as a spelling, not as an idea, and the difference is now known.** `nts_unit` already
returns `uint16_t`; the emitter casts it to a double because the HIR type of
`StringUnitAt { checked: false }` says so. So the double is *manufactured by the compiler at the
read*, once per character. `| 0` then adds `nts_to_int32` on top of that manufactured double --
it pays twice and saves once, which is the arithmetic under the measurement.

`specialize` declines to narrow because a class containing only comparisons "has nothing to make
faster": narrowing would cost a conversion at every use and buy only cheaper compares. **That rule
is correct given what the read returns**, which is why no source spelling can win here -- the
premise it reasons from is the manufactured double, and TypeScript cannot reach the premise.

Typing the read `i32` where it is lowered -- it is a `uint16` by construction and the lowering
knows it -- removes the double instead of converting it. The losing variant and the winning one
are the same change at different ends, and only the compiler is at the far end. With MainClaude.

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

**"The escaper's code unit can be made an integer from TypeScript."** It cannot, and this is
settled rather than untried. Six spellings were ruled out by reading emitted C: hoisting
`value.length`, three loop shapes (`for` against `.length`, `while`, and an `at < s.length ? ... :
0` ternary), mutating the index inside the body, splitting the `number`-typed consumer so the unit
is only ever compared, breaking the constant shared with the neighbour comparison, and deleting
the checked lookahead read entirely. Every one: float constants 8 or 9, integer constants 0.

The reason is visible in the shipped artifacts. **Integer code units come from bitwise operators,
not from a rule about where the unit came from.**

| function | bitwise ops | integer unit constants |
| --- | ---: | ---: |
| `utf8Write` | 15 | 8 |
| `unicodeEscape` | 6 | takes `int32_t`, 30 int32 locals to 10 double |
| `quoteJSONString` | 2 | 0 |

`unicodeEscape` gets `int32_t` for free because its body is `(unit >> 4) & 0xf`. `quoteJSONString`
only ever *compares* its unit, and comparing does not earn the representation. So the only
source-level lever is a bitwise operator -- which is `| 0`, already measured and already refuted,
because the conversion is per character and so is the saving. There is no third spelling.

**"Making the array index lazy will help the stringifier."** `SerializeJSONArray` never puts the
key in the output, so `String(frame.index)` per element is a string nobody reads -- 24000 of them
on the test document. Passing the index as a number and calling `String` only where the
specification hands it to user code is strictly less work.

Not measurable: 10.758/10.622/10.605ms against 10.743/10.798/10.574ms, three runs each. V8 caches
small-integer strings, so there was nothing to save. Reverted, because unlike the redundant slice
it also cost a `string | number` union and two casts to read.

**What survived it is the test.** The existing replacer suite logged `${key}` into a template,
which stringifies a number exactly as it stringifies a string, so it would have passed unchanged
had the index reached user code as a number -- and 25.5.4.2 says the key is a String.
`json-plain.test.ts` now asserts `typeof key` for both a replacer and a `toJSON` on an array
element, against node. Both fail if the `String(key)` is removed.

**"Serialization is allocation-bound; allocation is the lever."** Written into an earlier goal
from a profile showing `nts_each_reference` at 20%, with no counterfactual. The append/join pair
above disproves it. The error was substituting a ranking for a price, and it is the second time
that has happened here.

## The remaining gap, as currently understood

`json-serialize` profiles as: `quoteJSONString` 21.2%, `nts_str_raw` 13.7%, `nts_number_to_string`
13.5%, `nts_release` 12.1%, `work` 11.3%, `nts_free` 6.6%, `nts_each_reference` 4.7%.

**Allocation and reference counting are 37% of that and are not the lever.** The append/join pair
says allocation volume is nearly free and the `NoGc` counterfactual says reference counting is a
2.3x *win*, so this is the third time a profile has offered a ranking in place of a price. It is
recorded here so the next reader does not spend a day on it.

**The escaper's classification is floating point, and that is now traced to a single fact: the
integer entry returns a `double`.** Fixing the index took `json-scan` 46%, but
`nts_str_char_code_at_int` hands back a `double`, so the *value* is a double even when the index
is perfect. The emitted escaper compares against `92.0`, `32.0`, `34.0` and `55296.0` in floating
point, once per character.

Coercing with `| 0` cannot win this from TypeScript and the measurement says so: `nts_to_int32`
runs on every character while the saving is also per character, so it trades three operations for
at most two. That is why the `| 0` entry sits under Refuted rather than here -- **it was not the
wrong idea, it was the right idea at the wrong end.** A runtime entry returning `int32_t` removes
the conversion instead of moving it, and that is the compiler's to give; it is with MainClaude
alongside the index finding.

`nts_number_to_string` at 13.5% is the other compiler-side item and is untouched by anything here.

So `json-serialize`, `json-build-append` and `json-build-join` are at their limit without a
representation change, and saying so is more useful than another micro-experiment. `json-scan` was
the row where the lever was in my hands, and it moved 46%.

## Instruments

`perf record -g` on `target/bench/<case>.nts`; `valgrind --tool=dhat` for allocation, normalised
by the checksum because the driver calibrates to ~100ms and each binary therefore runs a
different number of repetitions; `hyperfine`; the bench table's own `nts f64` column and the
per-case `provider` file, which are the two counterfactuals that come for free.

Reading the emitted C in `target/bench/<case>.specialized.c` is the one measurement that does not
care whether the machine is busy.

**`nts emit-c <project> --main`, never bare `emit-c`.** Bare `emit-c` roots *every export*, and a
root is a wall -- its parameters stay as wide as their declared types because the next caller is a
linker away. `--main` roots only the module initialiser, which is what `nts-bench` does, and only
then does the emission match what ships. Four probe results in this lane were taken the wrong way
and had to be re-run; two of them reversed. Note that under `--main` an export nothing calls is
dead, so a probe needs a module-level `export const x = work(seed)` to keep its subject alive.

## The blocker that makes all of this unreachable

**`JSON.parse` and `JSON.stringify` are refused in compiled user code**: `NTS1001 \`JSON.parse\`,
a global member with no definition here`. The implementation is reachable only by importing
`jsonParse` from this module, which no ordinary program does. Until the global resolves to it,
nothing measured here reaches a user, and the question "is nts's JSON faster than node's" cannot
be asked in the terms a user would ask it. This is compiler-owned and is the first proposal.

## The parse row does not exist yet, and what it needs

There are four JSON rows and none of them parses a document. `json-scan` times the number grammar
because that is the only part of the parser that compiles. A real parse row needs three things
and two of them are not mine:

- `SyntaxError` representable, then `Frame#constructor`, then `Number(string)` for
  `numberValueOf`. With MainClaude; `SyntaxError` has landed and the rest is queued.
- **simdjson as the `ref.cpp`.** It is installed here (4.6.9, headers and shared object) and it is
  the right C++ reference for this row -- the one case in this lane where a reference is not a
  second implementation of a specification we already got right, because it answers "what is the
  hardware capable of" rather than "is our escaper correct". It needs `-lsimdjson` on the
  reference link line, and `tooling/bench/src/main.rs` links only `-lm` today. Not my file.
- A corpus. The 1.67MB document used for the ceiling numbers above is the obvious candidate and
  is generated rather than checked in.

Until then the ceiling table above is where the parse numbers live, and they are host numbers.

## Open, and owned elsewhere

`SyntaxError` unrepresentable keeps the whole parser off the compiled axis and out of this table;
`Number(string)` keeps `numberValueOf` off it. Both are with MainClaude, `SyntaxError` first.
Direct typed materialization -- one pass instead of building a graph and walking it again -- needs
the `JsonParse` boundary, which is compiler-owned. Propose, do not route around.

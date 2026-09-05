# Six contracts the runtime stated and did not keep

An external audit of `runtime/c` and the backends came back with six
correctness findings, each source-confirmed with an isolated reproducer. All six
are real. Every one was reproduced against this runtime *before* its repair, and
every one has been confirmed by reverting the repair and watching the check
fail.

They share a shape rather than a subject: **a promise the header or a comment
makes, kept by a line somewhere else, with nothing asking whether the two still
agree.**

Four of the six are undefined behaviour rather than wrong answers, which is most
of why they survived.

## The worst one: a retain changed what a string was

`NtsString` is a typedef of `NtsHeader`, so a string's representation flags and
the collector's colour live in the same word. They lived in the same two *bits*:

    #define NTS_TWO_BYTE   1u
    #define NTS_GROWN      2u
    #define NTS_COLOR_MASK 3u

`nts_retain` blackens a non-immortal object by clearing `NTS_COLOR_MASK`. So
**retaining a heap two-byte string made it a one-byte string.** The next read
took the narrow path and produced the low byte of each unit: a retained `"Ω"`
reads back as `"©"`.

Colours moved to bits 4–5, with a `_Static_assert` that they are disjoint from
the representation bits — because the defect was two constants agreeing by
accident for as long as nobody wrote down that they must not.

**Why nothing here caught it.** A string literal is immortal, and `nts_retain`
returns on its first line for an immortal object; so every string in a fixture
that is *written down* is safe. What is not safe is a heap string that is both
wide and retained, and the differential's non-ASCII cases mostly build strings
they immediately consume. 99 of 99 examples agreed with node under reference
counting, twice, with this live.

## The one that invalidates a measurement I reported

`nts_map_get`, `nts_map_key_at` and `nts_map_value_at` each call
`nts_value_retain` on what they return — the reference comes back **owned** —
and all three were declared `NTS_READS_ONLY`, which is `__attribute__((pure))`,
with `memory(read)` in the generated LLVM table.

`pure` licenses the optimizer to keep one result and drop the other call. Clang
at `-O2` does exactly that across translation units: two owned reads become one
retain, and releasing both credits ends one below where it started. That the
table's contents do not change is not the question. **The count is a memory
effect.**

Record 0102 reports that 51% of `Array.from(set)` is `nts_map_key_at` plus
`nts_map_next`. That profile was taken on a build where clang was licensed to
delete owned reads, so the number describes a program that is not the one the
source says. The whole thread needs re-measuring on the repaired runtime, and
the conclusion is withdrawn until it is.

The audit also corrected an inference in the same record that I had made
independently and stated as fact: `nts_value_retain` lives in the *same
translation unit* as the getters, so "an out-of-line source definition" was
never evidence of an out-of-line machine call. I inferred a call from where the
code was written.

`has` and `next` stay read-only. They genuinely are.

## The one that is a direct rebuttal of my own sweep

Yesterday the JVM session found their number formatter wrong on 46 of 2,098
powers of two, and told me their *random* sweep of 300,000 doubles had passed
the whole time — a random double essentially never has a short binary
representation. I ran the same powers-of-two sweep against `runtime/c`'s grisu:
**6,280 values, zero differences**, and reported the C lane clean.

The audit found this, four lines above where grisu is reached:

    const int32_t whole = (int32_t)x;
    if ((double)whole == x) {

The comment beside it says NaN and the infinities are expected to arrive and
fall through the round-trip test. Converting either to `int32_t` is undefined
*before* the test that would reject it runs.

My sweep could not have found it. **A machine can execute an undefined
conversion and still print exactly the right characters** — and it did, 6,280
times. Compare output *and* check defined execution; they are different
questions and only one of them prints.

The repair puts the range test before the conversion and gives an out-of-range
candidate zero, which no such input equals, so the gate answers the same and
executes.

## Three more

**`clear()` broke the iteration contract.** The runtime promises a walk sees
entries appended during it, and `nts_map_clear` reset `used` to zero — which
puts the next insertion at a slot a cursor already past can never reach. Walking
`[1, 2]`, clearing after the first element and adding `3` must yield `[1, 3]`
and yielded `[1]`. `used` is now kept, and the slots it keeps are *emptied*
rather than only released: the collector walks those arrays, and a slot still
naming a released object is a reference it would follow into freed memory.

The cost is named rather than hidden: a clear no longer returns the storage, so
a clear-and-refill loop grows. Reclaiming the dead prefix needs a logical base
the cursors are relative to, which is a design and not a line.

**`2^127` was admitted and then converted.** The bigint interval was closed at
both ends and two's complement is asymmetric: `-2^127` is the least signed
128-bit integer and `+2^127` is one past the greatest. Now `[-0x1p127,
0x1p127)`, in hex float literals because the boundary is a power of two and this
says which one.

**A fractional width below one shifted by minus one.** `BigInt.asIntN(0.5, v)`
is a width of zero after `ToIndex` truncates, and the signed path shifts by
`width - 1`. The test admitted `0.5` because it asked about the *double*; the
repair asks about what the conversion produced.

## What the instruments here could not see, and why

Six defects, in a tree with a differential against node on three backends, a
memory suite with argued floors, a corpus, a sabotage framework, and 9,889
sweep cases. None of them found any of these.

The reason is uniform and worth stating: **every instrument here compares
answers.** Four of these six produce the right answer on this machine and are
undefined; one produces a wrong answer only for a string that is both
heap-allocated and wide and then retained; one produces a wrong answer only for
a walk that spans a `clear`. An answer-comparing instrument is blind to
undefined execution by construction, and blind to a state nothing in the corpus
builds.

What found them was a sanitizer and a reader with no stake in the design.
`runtime/c/tests/contracts.c` is now twenty checks under
`-fsanitize=undefined,address`, one per defect and each confirmed by reverting
its repair — so the *class* is covered here from now on, even if the next one is
not.

## Ratchets

- `runtime/c/tests/contracts.c` — twenty checks, six defects, each confirmed by
  reverting its repair and watching the check fail.
- `compiler/codegen/c/tests/runtime_checkpoint.rs` — two tests driving it, the
  second in its own process because a refusal aborts.
- The LLVM signature table's drift test regenerates from the header through
  clang and compares attributes, so A2's backend half is machine-verified rather
  than hand-edited and hoped for.
- No new example: none of the six is reachable from TypeScript in a way a
  differential could observe, which is the finding above rather than a gap.
- No benchmark row: these are correctness repairs, and the one performance
  candidate the audit measured is opt-in and regressed GCC's common-range case.
  Not taken.

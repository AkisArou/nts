# 0191 — The rule was stated at one call site and read as that site's quirk

`ToIndex` is two steps and the order is the whole of it: truncate toward zero,
**then** range-check. Record 0179 wrote that down after finding it spelled wrong
six times. This is the seventh, eighth, ninth and tenth, all in one function,
and they were sitting one line away from the only place that had it right.

`lower_view_over` guards a typed array's `(buffer, offset, length)` arguments.
Five checks, and `guard_aligned_offset` was one of them:

    // On the `ToIndex` value, not the argument. `new Uint16Array(buf, 0.5)`
    // is an offset of **zero** and perfectly aligned; testing `0.5 % 2`
    // refuses a program node accepts.
    let index = self.call_runtime("nts_to_index", vec![offset], ...);

It converted, privately, and then compared. The four guards around it compared
the argument. So the comment above is not the record of a rule — it reads as
this call site's own quirk, a note about why *modulo* in particular needs care,
and every reader including its author took it that way.

## What that cost

    new Uint8Array(new ArrayBuffer(8), NaN, 15)   node: RangeError    we: 15
    new Uint8Array(new ArrayBuffer(8), 8.7)       node: 0             we: threw
    new Uint8Array(new ArrayBuffer(8), 0, 8.9)    node: 8             we: threw
    new Uint8Array(new ArrayBuffer(8), 7.9, 1)    node: 1             we: threw

The first is the dangerous direction and the JVM session found it. Every
comparison against NaN is false, so `NaN <= -1`, `NaN > 8` and `NaN + 15 > 8`
all pass, and `nts_view_new` then converts NaN to 0 and lays out fifteen
elements over eight bytes. `ToIndex(NaN)` is `0`, and `0 + 15 > 8` is the check
that should have fired.

The other three are the same comparison read the other way and they refuse
programs node accepts. `8.7 > 8` and `8 > 8` are different questions, and
truncation is *exactly* the operation that moves a value across a bound — which
is why every one of these appears at a boundary and nowhere else.

## The fix is one conversion, placed where it cannot be read as local

Convert immediately after `guard_buffer_length`, and everything below sees an
index. `guard_aligned_offset`'s private conversion is gone; it now documents
that its input is *already* one.

`guard_buffer_length` stays on the argument, and that is not an exception. Its
two bounds are the only ones truncation cannot move: `<= -1` and `>= 2**53`
answer the same before and after, because `trunc` changes neither the sign nor
the magnitude past `2**53`. It is the last thing that may look at the argument,
and it says so.

## The pool agreed on every case, before and after

`examples/typed-array-aliasing` drove 638 generated cases against node. Before
the fix: `agreed on every case`. After: `agreed on every case`. The pool never
put a fraction like `8.7` next to an eight-byte buffer and never put `NaN` in an
offset, so it measured nothing here in either direction and would have gone on
reporting agreement for as long as the bug lived.

This is the third instrument-shaped failure in a row and they are three
different failures, which is the reason to write them together:

  - `NTS_TSGO` unset, so tests skipped, and a skip prints `ok` (0183).
  - node throws, so the differential has nothing to compare and says nothing —
    which is how the JVM session saw this one at all, since their runtime keeps
    its own range check and *refused*, and a refusal is reportable where a
    silent wrong answer is not.
  - and here: the pool ran its cases correctly. They were the wrong cases.

The first two are an instrument reporting on something it did not run. The third
is an instrument reporting, accurately, on a region it never entered — and that
reads exactly like coverage. The four inputs are written out in the example now
rather than drawn from a pool; run against the old guards they produce four
disagreements, which is the only reason to believe any of this.

## Two lists are one fact, and only one of them is checked at commit time

The same gate run turned up `nts_dataview_get_bigint64` and
`nts_dataview_get_biguint64` marked `NTS_READS_ONLY` in the C header and absent
from `runtime::READS_ONLY`. Harmless — a missed elision, not a wrong answer, and
the pair is genuinely pure because it returns `__int128` by value and allocates
nothing. But it had been that way since the commit that added it, because
`commit-mine.sh` refuses a workspace that does not *lint* and the thing that
checks these two lists against each other is a *test*.

## A postscript this record earned twice over

It was written as 0190 and renumbered to 0191, and both sessions had used
`claim-record.sh`. The tool takes the next free number *in the tree*, and two
claims made before either is committed both see the same next free number. That
is not a misuse and no rule about running it would have prevented it; the
collision lives in the forty minutes between the two claims.

Which is this record's own subject in miniature. A tool that answers "what is
free" is answering about a moment, and it reads like an answer about a fact.

## What to take

A rule that appears once, correctly, at the site that needed it first is
indistinguishable from a local workaround. State it where the reader is
standing when they add the next guard — which here meant moving one function
call four lines up, and nothing else.

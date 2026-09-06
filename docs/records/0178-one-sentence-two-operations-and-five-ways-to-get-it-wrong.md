# One sentence, two operations, and five ways to get it wrong

`ToIndex` is one line of the specification: *truncate toward zero, then require
a non-negative integer below 2^53.* Two sessions implemented it into three
backends over one afternoon and got it wrong five times, in five different
spellings, and **not one of the five was found by reading the code**.

    (size_t)(-0.5)              C      undefined behaviour; asked for 9.2 quintillion bytes
    length > max, raw           C      refused (0, -0.5), (0.5, 0), (3.7, 3) -- all legal
    trunc(len) > trunc(max)     C      trunc(NaN) is NaN, so a RangeError stopped happening
    Math.floor(-0.5) == -1      JVM    slice(-0.5) started one back from the end
    transfer(NaN) kept length   JVM    answered the old length and looked like it worked

Three were found by running the corpus, two by a differential against node.
Every one of them survived being written, read back, and reviewed.

## Why they survive review

**Every wrong version is wrong only on the inputs nobody writes.**

`Math.floor` and truncate-toward-zero agree on every non-negative number. That
is every number a slice test contains unless someone deliberately writes the
negative one down, and `slice(2, 5)` is what a person writing a slice test
writes. The disagreement is confined to the open interval `(-1, 0)` — one
interval, no integers in it, and the whole of the bug.

The raw comparison is the same shape one level up. `length > max` is correct for
every pair of integers; it refuses only where one of them needed truncating
first, which is `(0, -0.5)` and `(0.5, 0)` and `(3.7, 3)` — three pairs a person
would have to be trying to write.

## The two that fail quietly, which are the dangerous half

Three of the five produce a wrong answer. Two produce **no answer**:

- `trunc(NaN) > trunc(max)` is `NaN > NaN`, which is false, so the `RangeError`
  that should have been raised is simply not raised. Nothing is wrong; something
  is missing.
- `transfer(NaN)` reading NaN as "no argument given" answered the buffer's
  current length. That is a plausible number, arriving from a working code path,
  in a shape a test asserts on.

A wrong answer disagrees with the oracle on the line where it happened. A
missing throw disagrees on a line that was supposed to exist and does not, and
the only instrument that sees it is one that asked for the throw by name.

## The two instruments found different halves, and neither would have found both

2,672 oracle vectors over `NtsBuffer` and `NtsDataView` compare every accessor
against node by bit pattern. They found neither `ToIndex` bug: a direct test
calls an accessor with the value it means, so it never asks what `slice(-0.5)`
does.

841 generated cases over `examples/array-buffer` found both, and had nothing to
say about NaN payloads — a generated case cannot ask for the bit pattern of a
signalling NaN read out of four bytes, which is where the round-trip vector
caught `floatToIntBits` canonicalising what node preserves.

Neither suite is redundant. One asks whether the operations are right and the
other asks whether the *language* is, and the second question is not a subset of
the first.

## What to take from it

The rule is one sentence and it is two operations, and the composition is where
it goes wrong every time. Every one of the five spellings did one of the two and
believed it had done both.

So: **one helper, used by everything that needs the rule**, rather than the rule
re-spelled at each site. `nts_to_index` is now that helper on the C lane and
`NtsBuffer.toIndexNumber` transliterates it on the JVM — comment and all, so if
either lane moves the guard the other can see where it went. That helper *clamps*
where the language throws, because the range check belongs to the callers and
they all have it; the header says so out loud, because "unreachable today" is
exactly the claim that ages.

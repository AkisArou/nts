# The name did not say "and you still owe a range check"

`ToIndex` has now been written wrong six times across two sessions, in six
distinct spellings, and it is one sentence of specification: *truncate toward
zero, then require a non-negative integer below 2^53.*

    (size_t)(-0.5)                   undefined behaviour; asked for 9.2 quintillion bytes
    length > max, raw                refused (0, -0.5), (0.5, 0), (3.7, 3) -- all legal
    trunc(len) > trunc(max)          trunc(NaN) is NaN, so a RangeError stopped happening
    Math.floor(-0.5) == -1           slice started one back from the end
    transfer(NaN) kept the length    answered the old length and looked like it worked
    new DataView(buffer, -1)         a view at zero where node raises RangeError

Record 0178 covered the first five and concluded that every wrong version is
wrong only on the inputs nobody writes. The sixth is different in kind, and it
is the one worth a second record: **the guard was not miswritten, it was
absent.** `guard_buffer_length` already existed and was already correct. I wrote
a constructor and sixteen accessors and did not call it, and twenty of 379 cases
disagreed with node.

## Why absence is the likely failure now

`nts_to_index` is half of a two-part rule wearing the name of a whole one. Its
header says the clamping is deliberate and that its callers are guarded:

> NOTE: this CLAMPS where `ToIndex` THROWS. ... Every caller is guarded at the
> lowering *before* the call -- `n <= -1` refuses first -- so nothing reaches
> this that the language would have rejected.

That is a true statement about the callers that existed when it was written, and
it reads as reassurance. It does not say *a new caller must add the guard
itself*. So the helper looks complete at the call site: it has "index" in the
name, it takes a double and answers an index, and nothing about using it
suggests an obligation is outstanding.

A comment that describes a *status* ages into a comment that describes a
*guarantee*. The fix is to make it an instruction — and that is the other
session's change to make, in their file, which is why it is written down here
rather than done here.

## Three sabotages that did not bite, for three different reasons

Found while testing the bigint half of the same feature, and each is a different
species.

**The distinguishing state was out of range.** The whole difference between
`getBigInt64` and `getBigUint64` is what happens when bit 63 is set, and the
example bounded its pool to 4,096. Nothing ever set it. Fifth instance of the
same shape in one day, after `Math.floor`, the clamped rounding, exact halves,
and overlapping ranges.

**The construction that was supposed to reach it did not.** Shifting the pool
value left still did not reach bit 63 for a bound of 4,096. Closer, and still
not the case — the top bit had to be *chosen* from the value rather than carried
there by arithmetic.

**And the third was not the test at all.** The C runtime is embedded with
`include_str!` at build time, so editing `nts_runtime.c` without rebuilding
`nts` changes nothing and the check keeps passing against a stale binary. Two of
four attempts were diagnosing an instrument that was fine.

That third one is [0183]'s hazard from underneath: a C runtime sabotage
*requires* a rebuild, and the rebuild is exactly what leaves a wrong compiler at
the shared path. The two are one hazard — you cannot sabotage the C runtime in
place without leaving the result there — and the fix is to copy the source *and*
build private, which a worktree does by construction.

## What to take

When a sabotage does not bite, the first suspect is the harness and not the
assertion. Three of the four times here, it was.

And a helper whose contract is partial should say so as an obligation rather
than as a status. "Every caller is guarded" is a fact that stops being true the
moment someone adds a caller, and the person adding it is the one who will not
read the note.

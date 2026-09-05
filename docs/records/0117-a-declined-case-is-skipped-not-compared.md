# 0117 — A declined case is skipped, not compared

Three defects in one afternoon, all in code gated green for weeks, all found the
same way: nts-69 changed the differential to treat an uncaught throwable as a
**defect** rather than as the program declining its input.

    examples/callbacks   17x  ClassCastException: NtsValue -> String
    examples/growable    13x  ArrayIndexOutOfBoundsException, and a silent one
    examples/async       17x  NullPointerException on a null array

## Why the instrument could not see them

**A declined case is skipped, not compared.** That is correct: a case the
program refuses has no answer, and there is nothing to hold against node. So
seventeen crashes classified as refusals became seventeen cases nobody looked
at, directly beneath the line "agreed on every case", and the floor counted the
example as passing.

The harness was **honest throughout**. It printed what it did not reach. A
dishonest instrument would have been caught long ago; this one reported exactly
what happened, in a category a reader skims, above a verdict that reads as a
pass.

nts-69's framing is the general form and it is worth stating in full: *the
lanes were disagreeing about what the program did, not about what it computed,
and that is a category the whole instrument is blind to by construction.* A
differential compares answers. When one lane refuses and the other crashes,
neither produces an answer.

The version that worries me more is refuse-versus-refuse. Two lanes declining
the same case for unrelated reasons are indistinguishable from two lanes
agreeing to decline it, and that one will not announce itself with a stack trace
when someone fixes the classifier.

**A cheap first move, short of comparing outcomes properly:** compare the
*counts*. `growable` reported 13 aborts on this lane against 17 declines on the
C lane, and I read past it because both numbers looked like "some". A row
putting them side by side would have been loud without needing to know which
cases.

## What the three had in common, which is not "async is hard"

Each was a value observable only on a path the suite reaches rarely.

- **An empty combinator.** `Promise.all` settled with `UNDEFINED_VALUE` on both
  paths, so `reference()` was null. Every non-empty `all` in the suite reads the
  array it passed in and never looks at the resolved value. `allOfNone` awaits
  an empty one, where there is nothing else to read.
- **An index a `!` promised.** `checked: false` means the middle end proved the
  index in range, and `xs[0]!` on an empty array makes that proof a lie.
- **A helper returning a wrapper.** `NtsValue` is not a supertype, so the
  narrowing `checkcast` that is free for `Object[] -> Foo[]` is a guaranteed
  failure for it.

Rare paths were not merely untested. They were **actively reported as fine**,
which is worse than untested, because it is what stops anyone from testing them.

## The best of the three, and the exception was its lesser half

`NtsArrayL.get` read `a.items[(int) at]`. Past the capacity it threw, which is
visible. Past the *length* but inside the capacity it returned a **stale slot
from an earlier grow** -- a wrong answer, silently, with no exception at all,
in a window exactly as wide as the last growth.

The crash is what got it looked at. The crash was not the bug.

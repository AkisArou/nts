# 0138 — The fix existed, in the other subscript path
`array-predicates` **1.67x hand-written Java to 0.71x** -- 13.08us to 5.65us,
2.3x on the row -- and the defect is one this backend already fixed once,
somewhere else.

The emitted per-element sequence was:

    lload 47
    l2d
    invokestatic  nts/rt/NtsArrayD.get:(Lnts/rt/NtsArrayD;D)D

An `i64` loop counter widened to a `double` so that `get` could narrow it
straight back with `(int) at`. Eight call sites of it, in loops that walk 256
elements eight times.

## It is the same bug as `bounds`, in the path that never learned

`checked_subscript` picks `(II)I` or `(IJ)I` by the index's kind, and the
comment there records what that was worth: an `i64` index taking the `double`
path cost **4.56x** on `awfy-nbody`, and *"the fix existed and did not cover
it"*.

It still did not cover this. The **bare** array subscript reads the index kind;
the **growable** wrapper always pushed a `double`, because a `double` overload
was the only signature `NtsArrayD.get` had. Two subscript paths, one taught and
one not, and the untaught one is the one every case that calls `push` takes.

So: `get(a, long)` and `get(a, int)` on all three growable classes, and the
backend picks by kind. `at < a.length` promotes the `int` for free and `(int)
at` is exact because the comparison bounded it.

## What it did not move, which is most of it

    array-predicates   1.67x -> 0.71x
    array-methods      1.66x -> 1.64x
    array-from         2.41x -> 2.43x
    array-mutations    1.14x -> 1.14x
    growth-grown       1.01x -> 1.01x
    pipeline           0.84x -> 0.84x

One row of six. `array-predicates` is the case with eight `get` sites inside hot
loops over a growable array with a `long` induction variable; the others index
with an `int`, or do not index in a loop at all. A fix worth 2.3x on one row and
nothing on five is the honest shape of this, and the five say the diagnosis was
specific rather than lucky.

`ArraySet` is **not** extended, because no case in the corpus emits a growable
`set` with a double subscript -- zero sites across all fifty. The overload would
be a path nothing takes.

## How it was found, which is the part worth keeping

A profile put 28.18% in `NtsArrayD.get` and that was true and not actionable: it
says where the time is, not that anything cheaper exists. Records 0133 and 0137
are two changes and a rule built on exactly that confusion, both reverted.

`javap -c | grep` is what showed the `l2d` that should not have been there.
Allocation had already excluded the other explanation -- we allocate **less**
than the reference on this row, 24,992 bytes/op against 26,776 -- so the box was

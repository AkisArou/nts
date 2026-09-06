# 0169 — The slot round trip is free until it crosses an edge

Record 0004 measured the store/load round trip at parity and called emitting
"simple, regular, obviously correct" code "measurably free", on the argument
that C2 removes it exactly as `mem2reg` removes the C backend's equivalent. I
have quoted that finding to decline work at least twice, including once today.

**It does not extend to a value that crosses an edge, and `awfy-queens` is 34%
of a row saying so.**

## The static shape

`a && b && c` lowers to a merge per operator whose parameter is the answer so
far:

    b1: %7 = array.get %5[%6] ; jump b3(%7)
    b2: jump b3(%4)
    b3(%8: bool): br %8, b4, b5

`Queens.getRowColumn` is three of those. javac branches straight to a common
`iconst_0`/`iconst_1` and materialises once, at the return:

    getRowColumn   ours 55 bytecodes   javac 25
    placeQueen     ours 66             javac 42
    setRowColumn   ours 34             javac 22
    queens         ours 50             javac 36

## The measurement, which is the reference and not this compiler

Record 0102 established that bytecode volume is not the currency -- 196 to 160
bought exactly zero -- so a count is a reason to look and not a reason to act.
Two instruments before acting.

**Dynamically, we issue more rather than stall more.**

    ours   instructions 374,978   cycles 63,461
    java   instructions 284,794   cycles 51,167
                          1.32x          1.24x

IPC is 5.91 against 5.57, so this is an instruction-count problem. Whatever the
extra is, C2 kept it.

**Then the reference, mutated, which is `widen`'s method and the only one that
prices the replacement.** `getRowColumn` rewritten to materialise the same three
booleans -- one method, one variable, the same checksum `3ff0000000000000`:

    original      8,946 ns
    materialised 12,019 ns     +34.4%

The mutated reference is **slower than this backend** at 11,010 ns. So the
materialisation is not merely present in the gap, it is larger than the gap, and
C2 does not undo it.

## The fix I built, measured at zero, and reverted

An edge whose target is nothing but a branch on the value the edge supplies is a
branch. Threading it deletes the store and the reload.

**It fires nowhere.** Threading is safe only when every reader of the merge
parameter is inside that block's terminator, and in this shape it never is:

    b5: jump b6(%8)

The sibling arm forwards the parameter to the next merge. Thread `b1 -> b3` and
`b5` reads a slot that path no longer writes -- a wrong answer, not a refusal.
Correct threading needs tail duplication of `b5`.

The first version of the guard was wrong in the other direction: it required the
parameter to have exactly one use, which is the branch. That is too strict for
the *arms* -- `a && b` hands its false answer straight on -- so I extended it to
substitute the parameter in the arms' arguments, and it still did not fire,
because the forwarding use is in a **sibling block** rather than in the
terminator. Two wrong guesses about a shape I had already printed, which is the
argument for reading `nts hir --prepared` before writing the predicate rather
than after.

Reverted. The measurement stands and the transformation does not.

## Where the fix belongs

On the `b2` edge `%4` is known false, so `br %8` in `b3` is `br false` and `b2`
can jump straight to `b5`. That is sparse conditional constant propagation in
`hir`, it turns the data merge back into the control merge javac emits, and C
and LLVM already get it from their own optimisers -- which is why our C lane is
6.58 us and this one is 11.01. It would shrink their output and move only this
lane.

Filed with nts-69 with the 34%, rather than built here, because the evidence is
in this lane and the change is in theirs.

# 0123 — Two rows are the element width, and the obvious hoist costs nothing

`arrays` is 1.35x hand-written Java and `awfy-queens` is 1.25x. They are one
cause, and it is not in this backend.

## The obvious thing first, because it was wrong

`arrays`' inner loop recomputes `(seed | 0)` on every iteration:

    472: dload_0
    473: invokestatic  NtsRuntime.toInt32:(D)I
    476: istore 24
    478: iload  24
    480: i2d

Loop-invariant, 3,968 times per operation, a runtime call and a conversion back.
It looks exactly like a missing hoist.

    hoisted        1.11 us
    per-iteration  1.07 us     0.98x

**It costs nothing.** C2 inlines `toInt32` to pure arithmetic and hoists it
itself, so the emitted shape is not the executed shape. Any effort spent on
loop-invariant code motion for this would have moved a number that was already
zero.

## What it actually is

The reference indexes an `int[]`; this backend emits a `double[]`, because
`hir::elements` has not proved the elements are integral. Same model, one
variable, same checksum:

    int[]      1.11 us
    double[]   1.39 us     1.26x

Our lane measures 1.42 against the reference's 1.05, so 1.26x is essentially the
whole row -- and `awfy-queens` was already attributed here at 1.14x by an
earlier measurement.

## Why this one is not a backend representation choice, when the counter was

Record 0121 widened an `i32` counter into a `double` slot on the argument that a
representation is the backend's to choose. That argument does not extend here.
A local's representation is visible only inside the method; an **array's** is
its ABI. `NtsArrayD`, `arrayIndexOf`, `arrayLastIndexOf` and the rest all
declare `double[]`, so narrowing the element type in this backend changes every
signature that touches an array rather than a slot in one frame.

The line is worth stating because it will come up again: **this backend may
choose how it holds a value; it may not choose how it hands one over.** The
counter never left its function. An array is passed.

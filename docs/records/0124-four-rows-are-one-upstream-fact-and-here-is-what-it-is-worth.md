# 0124 — Four rows are one upstream fact, and here is what it is worth

`hir::elements` does not prove an array's elements integral, so this backend
emits a `double[]` where the reference indexes an `int[]`. That is not one row.

Measured on each row's own shape, one variable, checksums equal:

    row                model int[] -> double[]     the row
    arrays                     1.11 -> 1.39 us     1.35x
    array-methods              1.10 -> 1.59 us     1.65x
    awfy-queens        (earlier measurement)       1.25x
    array-predicates                               1.35x

`arrays` measures 1.42 against 1.05 and the model says 1.26x of that is width.
`array-methods` measures 1.73 against 1.04 and the model says 1.45x. In both the
width is most of the gap and nothing else identified accounts for the rest.

**Four rows, one fact, and it is not in this backend.** An array's element type
is its ABI here: `NtsArrayD`, `arrayIndexOf`, `arrayLastIndexOf`, `arrayReverse`
and the rest all declare `double[]`, so narrowing it in codegen changes every
signature that touches an array rather than one slot in one frame. That is the
line record 0122 draws -- **this backend may choose how it holds a value; it may
not choose how it hands one over** -- and an array is handed over.

## What was checked and was not it

`array-methods` calls `NtsRuntime.arrayIndexOf` and friends rather than
inlining, and the obvious suspicion is the call. The helpers are plain counted
loops over 16 elements, C2 inlines them, and the model reproduces the gap
*without any calls at all* -- both its variants are hand-inlined. So the call
boundary is not the cost; the element width is, in a model that has no call
boundary to blame.

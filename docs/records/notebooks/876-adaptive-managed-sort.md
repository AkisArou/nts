# Adaptive managed sort — issue #876

The approved design replaces fixed-width passes over managed-element indices
with natural runs, strict descending reversal, stable binary insertion to a
minimum run and powersort merge ordering. The counted snapshot remains the
owner during observable comparator calls. A completed sort moves references
without counts when the target prefix still matches that snapshot; mutations
use counted reconciliation. `toSorted` permutes its private copy by cycles.

## Before: the measured cause

The compiler at `a33eacb74dc1ead6b9e182221c9862564298e102` already has integer
merge cursors and count-free index buffers. The old floating-cursor and
C-specific truthiness causes in [the previous profile](../../../results/count-free-sort/profile.md)
are gone. The largest remaining measured share is merge selection, index
addressing and loop control. The object row repeatedly sorts its own already
ordered result, so a general adaptive sort removes whole merge passes.

Fresh flat cycle samples, CPU 4 under the measurement lock, sibling 5 quiet,
`cpu_core/cycles/u`, period 50,003, zero lost samples:

| Portion | C samples % | LLVM samples % |
|---|---:|---:|
| Comparator loads and truthiness | 10.57 | 9.06 |
| Merge selection, index addressing and loop control | 38.16 | 42.93 |
| Snapshot copy | 3.89 | 3.22 |
| Inlined write-back and buffer cleanup | 9.08 | 7.88 |
| Common release/destruction | 10.94 | 10.39 |
| Allocation entrypoints | 0.77 | 0.58 |
| Other, including checksum | 26.59 | 25.95 |

The split includes startup and sampling skid. Inlined write-back also includes
stores and buffer cleanup; common release includes final destruction. Neither
is an exact measurement of count-only cycles. C has 11,247 samples and LLVM
10,940. Both comparator bodies inline, and both merge cursors use integer
arithmetic. Today's C object row is faster than LLVM, so the current gap is
not evidence for a C backend emission change.

At `work(0)`, the original object row executes 8,192 retains and 8,497 releases,
312 allocations and finishes with zero live objects and bytes: two retains
and two releases per element-sort, plus creation and final cleanup. The merge
itself already moves only indices. The new write-back removes one counted
transfer while preserving the snapshot needed by arbitrary comparators.

The run policy follows the natural-run, insertion and merge principles
documented by [CPython](https://github.com/python/cpython/blob/main/Objects/listsort.txt);
its integer midpoint [power calculation](https://github.com/python/cpython/blob/main/Objects/listobject.c)
avoids floating logarithms. Descending reversal is strict to preserve equal
keys. Scratch holds the smaller run, at most half the permutation; the bounded
power stack follows from the runtime's array-length limit.

## Controls and proof

The permanent new rows are `sort-objects-shuffled` (seeded Fisher–Yates),
`sort-objects-runs` (a seeded rotation into two ascending runs), and
`string-sort-control`. Each exports `work(seed)` and lands pending without an
oracle count. They were committed and measured with the original compiler
before the implementation changed.

`tests/programs/adaptive-sort` pairs pure, throwing, source-mutating and
mutating-then-throwing comparators with `toSorted` controls. Native tests force
real collection at comparator entries under RC, poisoning and ASan/UBSan;
ordered and reversed controls require exactly N−1 comparisons. The previous
fixed-width merge loop cannot meet that comparison bound. Runtime tests check
identity, unchanged and replaced prefixes, shrink-and-restore, appended tails,
private permutation cycles, zero counts on moves and no leaks. JVM runtime
tests exercise the matching fixed and growable write-back helpers.

## Evidence location

Raw output and binaries are kept under `/home/akisarou/.cache/nts-scratch/876/`.
Agent timed runs are evidence only: their automatic results commits were
removed from the branch, and their JSON is kept in that scratch directory.

| Raw sitting | SHA-256 |
|---|---|
| `baseline-sitting.json` | `fb9ef5dc064a15b93022b7934adfb20c32f2512dedcf48a35ab946a28d120793` |
| `controls-sitting-before.json` | `4a7fde13404c806ec481ddafa7d10704abd6f8e454e0be3f5ce23ee498a0550c` |

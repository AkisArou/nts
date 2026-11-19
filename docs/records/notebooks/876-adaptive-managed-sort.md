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

## Original timed sittings

These selected-row sittings use shipping RC, ThinLTO, x86-64-v3 and 32-byte loop alignment. Each native/engine ratio is within its own sitting. CPU 4 was locked with sibling 5 quiet, all displayed rows unspoiled. Comparator pins: Node v26.13.0; Bun 1.4.4-canary.1 at `89452d2ac13773aee8a6d632c4c30074bd1bb4fa`; ScriptC 0.4.5 at `8971d694b18a81a9a52b8f8208be22b182cb092b`. The JSON retains command digests, inputs, per-cell spreads and conditions.

### baseline-sitting.json

Source `a33eacb74dc1ead6b9e182221c9862564298e102`; 2026-11-19T09:41:58.800Z to 2026-11-19T09:44:43.212Z.

Times in µs; ratios are native / engine. Verdicts are the tool’s recorded verdicts, including losses and ties.

| Row | Backend | µs | / node | / Bun JIT | / Bun AOT | / ScriptC | Native repeat spread |
|---|---|---:|---:|---:|---:|---:|---:|
| array-copying-methods | nts C | 24.0862 | 0.347 WON | 0.452 WON | 0.509 WON | 0.789 WON | 1.0156× |
| array-copying-methods | nts LLVM | 23.4370 | 0.338 WON | 0.439 WON | 0.496 WON | 0.768 WON | 1.0312× |
| array-copying-methods | nts JVM | 27.9911 | 0.404 WON | 0.525 WON | 0.592 WON | 0.917 WON | 1.0589× |
| map-entries-top-k | nts C | 15.7883 | 0.659 WON | 0.752 WON | 0.829 WON | 1.152 LOSS | 1.0363× |
| map-entries-top-k | nts LLVM | 15.9540 | 0.666 WON | 0.760 WON | 0.838 WON | 1.164 LOSS | 1.0079× |
| map-entries-top-k | nts JVM | 16.4761 | 0.688 WON | 0.785 WON | 0.865 WON | 1.202 LOSS | 1.0349× |
| sort-objects | nts C | 58.7231 | 1.080 LOSS | 1.774 LOSS | 1.519 LOSS | 0.753 WON | 1.0171× |
| sort-objects | nts LLVM | 62.4806 | 1.149 LOSS | 1.888 LOSS | 1.616 LOSS | 0.801 WON | 1.0424× |
| sort-objects | nts JVM | 97.7514 | 1.798 LOSS | 2.954 LOSS | 2.528 LOSS | 1.254 TIE | 1.0145× |

| Row | Node µs | Bun JIT µs | Bun AOT µs | ScriptC µs | Load before → after | Available GiB before → after | Spoiled |
|---|---:|---:|---:|---:|---|---:|---|
| array-copying-methods | 69.3263 | 53.3442 | 47.2989 | 30.5276 | 21.47 → 16.27 | 18.81 → 19.17 | False |
| map-entries-top-k | 23.9507 | 20.9847 | 19.0441 | 13.7036 | 16.27 → 10.52 | 19.01 → 19.67 | False |
| sort-objects | 54.3792 | 33.0952 | 38.6602 | 77.9643 | 10.52 → 19.11 | 19.65 → 13.41 | False |

### controls-sitting-before.json

Source `a16a232853f2beba11ed1d5b23539de4a9f7f660`; 2026-11-19T09:59:37.369Z to 2026-11-19T10:02:02.911Z.

Times in µs; ratios are native / engine. Verdicts are the tool’s recorded verdicts, including losses and ties.

| Row | Backend | µs | / node | / Bun JIT | / Bun AOT | / ScriptC | Native repeat spread |
|---|---|---:|---:|---:|---:|---:|---:|
| sort-objects-runs | nts C | 63.6372 | 1.351 LOSS | 1.874 LOSS | 1.514 LOSS | 0.787 WON | 1.0664× |
| sort-objects-runs | nts LLVM | 65.4992 | 1.390 LOSS | 1.929 LOSS | 1.559 LOSS | 0.810 WON | 1.0531× |
| sort-objects-runs | nts JVM | 95.0948 | 2.019 LOSS | 2.801 LOSS | 2.263 LOSS | 1.177 LOSS | 1.0122× |
| sort-objects-shuffled | nts C | 170.3187 | 0.558 WON | 0.752 WON | 0.619 WON | 1.869 LOSS | 1.0166× |
| sort-objects-shuffled | nts LLVM | 168.5695 | 0.553 WON | 0.744 WON | 0.613 WON | 1.849 LOSS | 1.0165× |
| sort-objects-shuffled | nts JVM | 222.0449 | 0.728 WON | 0.980 SHORT | 0.807 WON | 2.436 LOSS | 1.0444× |
| string-sort-control | nts C | 0.1294 | 0.561 WON | 1.244 LOSS | 1.587 LOSS | 0.974 TIE | 1.0277× |
| string-sort-control | nts LLVM | 0.1291 | 0.559 WON | 1.241 LOSS | 1.583 LOSS | 0.971 TIE | 1.0397× |
| string-sort-control | nts JVM | 0.0915 | 0.396 WON | 0.879 SHORT | 1.122 TIE | 0.688 WON | 1.1977× |

| Row | Node µs | Bun JIT µs | Bun AOT µs | ScriptC µs | Load before → after | Available GiB before → after | Spoiled |
|---|---:|---:|---:|---:|---|---:|---|
| sort-objects-runs | 47.1106 | 33.9529 | 42.0249 | 80.8227 | 24.99 → 13.59 | 20.39 → 19.80 | False |
| sort-objects-shuffled | 305.0387 | 226.6259 | 275.1915 | 91.1442 | 13.59 → 13.65 | 20.14 → 19.80 | False |
| string-sort-control | 0.2308 | 0.1041 | 0.0816 | 0.1329 | 13.65 → 16.58 | 20.16 → 20.79 | False |

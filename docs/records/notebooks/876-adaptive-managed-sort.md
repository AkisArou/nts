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

## Adaptive base before galloping

Base `8ce7701cea5bd904bd39b533d2b2d611d44a9de8`, shipping RC, fixed inputs and the pinned Node engine. Counts are calibrated, empty-bracket-subtracted user instructions per call, on CPU 0 outside the measurement pair without a timing lock. Native instruction band: one basis point (0.01%). Filtered engine lanes were not run; their timing comparisons are reported separately.

| Row | Backend | Original instructions | Base instructions | Base / original | Verdict |
|---|---|---:|---:|---:|---|
| array-copying-methods | C | 482832 | 482832 | 1.000000 | WITHIN BAND |
| array-copying-methods | LLVM | 538832 | 538832 | 1.000000 | WITHIN BAND |
| clbg-k-nucleotide | C | 17432320 | 17425740 | 0.999623 | IMPROVED |
| clbg-k-nucleotide | LLVM | 17424398 | 17417796 | 0.999621 | IMPROVED |
| jetstream-wsl | C | -- | -- | — | REFUSED |
| jetstream-wsl | LLVM | -- | -- | — | REFUSED |
| map-entries-top-k | C | 414057 | 390052 | 0.942025 | IMPROVED |
| map-entries-top-k | LLVM | 415503 | 404962 | 0.974631 | IMPROVED |
| sort-objects | C | 1411192 | 500957 | 0.354989 | IMPROVED |
| sort-objects | LLVM | 1501920 | 531558 | 0.353919 | IMPROVED |
| sort-objects-runs | C | 1672921 | 779833 | 0.466151 | IMPROVED |
| sort-objects-runs | LLVM | 1723222 | 805414 | 0.467388 | IMPROVED |
| sort-objects-shuffled | C | 1829354 | 1499396 | 0.819631 | IMPROVED |
| sort-objects-shuffled | LLVM | 1877546 | 1648821 | 0.878179 | IMPROVED |
| string-sort-control | C | 2995 | 2438 | 0.814023 | IMPROVED |
| string-sort-control | LLVM | 3077 | 2544 | 0.826779 | IMPROVED |

The object row includes all sixteen sorts, not only its first disordered pass. The comparison census instruments emitted comparator entries separately from timing. Each object row sorts 4,096 elements per work call; the string control sorts six.

| Row | Original comparisons | Base comparisons | Original per element | Base per element |
|---|---:|---:|---:|---:|
| sort-objects | 17101 | 5545 | 4.175049 | 1.353760 |
| sort-objects-shuffled | 27592 | 27558 | 6.736328 | 6.728027 |
| sort-objects-runs | 18472 | 7302 | 4.509766 | 1.782715 |
| string-sort-control | 11 | 10 | 1.833333 | 1.666667 |

The ordered 65-element negative control returns the same result with both compilers. The original executes 256 comparisons and fails the N−1 bound; the adaptive base executes 64 and passes it. Both run with RC, poisoning, ASan/UBSan and zero live objects and bytes. Thus the optimization assertion distinguishes the change even though the preservation fixtures already agreed with Node before it.

| Raw evidence under the scratch root | SHA-256 |
|---|---|
| `count-base.log` | `1cbe84367bd95dfc069b9d7db4a0b5d598fa21090455a21416565fcaa2333f03` |
| `base/comparison-census/counts.json` | `60f19e96b04345d443a9953ccdaa019c13d5d6227de80af1b4328bc2fddea8ed` |
| `optimization-control/result.json` | `6f122346ff1f7dc67f486aee833fca74067dbefd8858f361078e1b147e37695a` |
| `base-probes.log` | `d55d9cd1d4ef7ce3d13cc0ae94385546973cad181aff10035c8fdf69011af8d9` |

### Original profile and count provenance

All paths below are relative to `/home/akisarou/.cache/nts-scratch/876/`. The saved ELF binaries bind sampled addresses to the disassembly, independently of later writes to `target/bench/`.

| Evidence | SHA-256 |
|---|---|
| `count-before-pinned.log` | `8c179b581c3a3eab865d93639edd91bf34904ba5b65aebb8dce401f76e9dc91c` |
| `count-memory-before.log` | `cc253cc4438c15a00f597c2af3d3d8672b96114a1d88633dd04cda2b2b6abb98` |
| `count-controls-before.log` | `728bc40aa1204b1b810fdf315aab43aa08be5510ff5374f5e87d0a9f5537b8cd` |
| `operations-before.log` | `71046a3b389e6f97abca467aff1125f5ff5b2325a7d7a513dd37ee364a869d07` |
| `before/nts.perf.data` | `70f9362070cfd3a7bdbab94b8f7972a903a97a6bb0e1ee07ac48ea92dbe0cdbc` |
| `before/ntsllvm.perf.data` | `1c0059ddeb6dcdb3736d80c4b8a38c1bc3fc733d677a88b00d98bba0b163c367` |
| `before/sort-objects.nts` | `41d01bbdbda202128fd56f58972a658f521d3f2afb8079a9312bd93690279b98` |
| `before/sort-objects.ntsllvm` | `f5ac19b95358aa58ba80fe385c2598e7421bb55ba058c909a6a38538beb26db7` |
| `before/c.dis` | `2792ef19c8310a50a42c61d14e92a00003ed46e2fc9badd06e517536ab56e045` |
| `before/llvm.dis` | `f9a130ebceb3a6823b022082794bb3749c639c3606a619d45f7504fc4e739250` |
| `before/c.samples` | `d6f907e9a8ef162c8ff13684c0be3a99c321d49c74ac189203c56ec45728ba41` |
| `before/llvm.samples` | `82baee92b48a8677a130ad6f75dfe3e13c28ab656987b2159c720621a6cf5f4f` |

## Three-variant locked sitting: rejected candidates

The original compiler, adaptive base without galloping, and galloping candidate
were run together on CPU 4 under one lock. Each cell is the median of six
invocations; each invocation uses the normal best-of-five native harness.
Invocation order alternates, output checksums agree, and sibling 5 user/nice
CPU counters do not advance across each row. Shipping RC, ThinLTO,
x86-64-v3, and 32-byte loop alignment match the original benchmark build.
The JSON preserves every sample, binary SHA-256, load and available-memory
observations. Ratios here compare variants only within this sitting; they
do not compare absolute times with earlier engine sittings.

Original is `a33eacb74dc1ead6b9e182221c9862564298e102`; base is
`8ce7701cea5bd904bd39b533d2b2d611d44a9de8`; galloping is
`9e55e732406f2bb9296c2aafeda6c7a6b7548536`. A 3% descriptive timing
threshold labels the following table, independently of the much tighter
instruction band. Neither candidate meets the acceptance criteria.

| Row | Backend | Original µs | Base µs | Galloping µs | Base / original | Galloping / original | Galloping / base | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|
| sort-objects | C | 59.140798 | 51.033164 | 48.403604 | 0.862910 | 0.818447 | 0.948473 | base gain; galloping gain |
| sort-objects | LLVM | 63.212653 | 54.317675 | 51.548281 | 0.859285 | 0.815474 | 0.949015 | base gain; galloping gain |
| sort-objects-runs | C | 69.626851 | 75.275130 | 59.442107 | 1.081122 | 0.853724 | 0.789665 | base LOSS; galloping gain |
| sort-objects-runs | LLVM | 71.539524 | 78.880819 | 62.649819 | 1.102619 | 0.875737 | 0.794234 | base LOSS; galloping gain |
| sort-objects-shuffled | C | 187.818762 | 188.417436 | 186.549378 | 1.003188 | 0.993241 | 0.990086 | base within 3%; galloping within 3% |
| sort-objects-shuffled | LLVM | 188.427282 | 204.857390 | 207.258119 | 1.087196 | 1.099937 | 1.011719 | base LOSS; galloping LOSS |
| map-entries-top-k | C | 17.645381 | 16.957027 | 18.487534 | 0.960990 | 1.047727 | 1.090258 | base gain; galloping LOSS |
| map-entries-top-k | LLVM | 17.975379 | 18.202150 | 19.212319 | 1.012616 | 1.068813 | 1.055497 | base within 3%; galloping LOSS |
| string-sort-control | C | 0.132063 | 0.110396 | 0.113487 | 0.835931 | 0.859336 | 1.028000 | base gain; galloping gain |
| string-sort-control | LLVM | 0.133430 | 0.110269 | 0.111185 | 0.826413 | 0.833285 | 1.008315 | base gain; galloping gain |
| array-copying-methods | C | 23.921520 | 23.946315 | 24.112822 | 1.001037 | 1.007997 | 1.006953 | base within 3%; galloping within 3% |
| array-copying-methods | LLVM | 25.011908 | 24.982880 | 24.893234 | 0.998839 | 0.995255 | 0.996412 | base within 3%; galloping within 3% |

Galloping reduces the two-run case by about 21% versus the adaptive base,
but increases map top-k by 9.0% on C and 5.5% on LLVM. Shuffled LLVM is
10.0% slower than the original; removing galloping alone still leaves an
8.7% loss. The unchanged array-copy control has byte-identical base and
galloping binaries; its small timing differences show sitting noise.

### Candidate counts, including losses

Native instruction band: one basis point (0.01%). Counts are calibrated, empty-bracket subtracted user instructions per call, outside CPUs 4–5 without a timing lock. JIT count repeats are informational. Filtered lanes were not run, as shown in the raw logs.

| Row | Backend | Original | Adaptive base | Galloping candidate | Galloping / original | Verdict |
|---|---|---:|---:|---:|---:|---|
| array-copying-methods | C | 482832 | 482832 | 482832 | 1.000000 | PASS |
| array-copying-methods | LLVM | 538832 | 538832 | 538831 | 0.999998 | PASS |
| awfy-towers | C | 941646 | -- | 941646 | 1.000000 | PASS |
| awfy-towers | LLVM | 908822 | -- | 908821 | 0.999999 | PASS |
| clbg-k-nucleotide | C | 17432320 | 17425740 | 17425768 | 0.999624 | IMPROVED |
| clbg-k-nucleotide | LLVM | 17424398 | 17417796 | 17417866 | 0.999625 | IMPROVED |
| cyclic-churn | C | 2375872 | -- | 2375872 | 1.000000 | PASS |
| cyclic-churn | LLVM | 2377860 | -- | 2377856 | 0.999998 | PASS |
| event-state | C | 1700 | -- | -- | — | native refused / not measured |
| event-state | LLVM | 1698 | -- | -- | — | native refused / not measured |
| immutable-update | C | 2031897 | -- | 2031902 | 1.000002 | PASS |
| immutable-update | LLVM | 2033945 | -- | 2033964 | 1.000009 | PASS |
| jetstream-wsl | C | -- | -- | -- | — | native refused / not measured |
| jetstream-wsl | LLVM | -- | -- | -- | — | native refused / not measured |
| json-build-append | C | 222777 | -- | 222777 | 1.000000 | PASS |
| json-build-append | LLVM | 222778 | -- | 222777 | 0.999996 | PASS |
| json-stringify-doc | C | 27212376 | -- | 27212313 | 0.999998 | PASS |
| json-stringify-doc | LLVM | 27037193 | -- | 27037192 | 1.000000 | PASS |
| map-entries-top-k | C | 414057 | 390052 | 415485 | 1.003449 | REGRESSED |
| map-entries-top-k | LLVM | 415503 | 404962 | 427380 | 1.028585 | REGRESSED |
| module-loop-retained | C | 262197 | -- | 262197 | 1.000000 | PASS |
| module-loop-retained | LLVM | 262197 | -- | 262197 | 1.000000 | PASS |
| objects | C | 27684 | -- | -- | — | native refused / not measured |
| objects | LLVM | 27684 | -- | -- | — | native refused / not measured |
| pipeline | C | 239558 | -- | 239557 | 0.999996 | PASS |
| pipeline | LLVM | 239555 | -- | 239558 | 1.000013 | PASS |
| record-word-counts | C | 152641 | -- | 152641 | 1.000000 | PASS |
| record-word-counts | LLVM | 154112 | -- | 154112 | 1.000000 | PASS |
| release-acyclic | C | 1832669 | -- | 1832669 | 1.000000 | PASS |
| release-acyclic | LLVM | 1832669 | -- | 1832665 | 0.999998 | PASS |
| sort-objects | C | 1411192 | 500957 | 507513 | 0.359634 | IMPROVED |
| sort-objects | LLVM | 1501920 | 531558 | 537520 | 0.357889 | IMPROVED |
| sort-objects-runs | C | 1672921 | 779833 | 698638 | 0.417616 | IMPROVED |
| sort-objects-runs | LLVM | 1723222 | 805414 | 716917 | 0.416033 | IMPROVED |
| sort-objects-shuffled | C | 1829354 | 1499396 | 1615404 | 0.883046 | IMPROVED |
| sort-objects-shuffled | LLVM | 1877546 | 1648821 | 1815709 | 0.967065 | IMPROVED |
| string-sort-control | C | 2995 | 2438 | 2436 | 0.813356 | IMPROVED |
| string-sort-control | LLVM | 3077 | 2544 | 2539 | 0.825154 | IMPROVED |
| tree-teardown | C | 597515 | -- | 597515 | 1.000000 | PASS |
| tree-teardown | LLVM | 597516 | -- | 597516 | 1.000000 | PASS |

Comparator census: same work(seed), same object shape and seeded inputs. Calls divided by all 4,096 element-sorts (six elements for the string control).

| Row | Original calls/element | Adaptive base calls/element | Galloping calls/element |
|---|---:|---:|---:|
| sort-objects | 4.175049 | 1.353760 | 1.353760 |
| sort-objects-shuffled | 6.736328 | 6.728027 | 6.737061 |
| sort-objects-runs | 4.509766 | 1.782715 | 1.112305 |
| string-sort-control | 1.833333 | 1.666667 | 1.666667 |

At `work(0)`, the galloping object row has 4,096 retains, 4,387 releases,
298 allocations, zero live objects and bytes on both C and LLVM. Those
4,096 retains are exactly the immutable snapshots, one per element-sort;
write-back contributes none. Map top-k has the same counts with and without
galloping: 1,646 retains, 2,057 releases and 215 allocations. Its regression
is not additional managed ownership traffic. Galloping increases its
comparisons only from 1,258 to 1,265. Binary insertion accounts for 873
of the base variant’s comparisons on this row.

| Evidence under the scratch root | SHA-256 |
|---|---|
| `paired-sort.json` | `eb12dd0cc845262b73e14b7479ad7ced037d9af73594b8c01532ffd58905a217` |
| `count-gallop.log` | `e54c1338705d2fcc17dafcdea1829876735dee1c5af8a397f6dc053fcb83b7c9` |
| `gallop/operations/counts.json` | `978c5b5b9927db0bfcc3390570d62ed70b29f0b41494359b229b1ddc9f67b370` |
| `map-census.json` | `6d9105170aaaf1fbb6d771229c4830e0cbcfd26735784cc441fe92813f9b74b3` |
| `gallop/comparison-census/counts.json` | `2562178ca86d926aab2c3da768387889d58316bd3d2abf9bbe2256d735e5cb88` |
| `gallop/comparison-census-llvm/counts.json` | `f90fa177e0617d4795f8c8986496913b9a9493c488af04d8b99ac34474f1f19c` |
| `gallop/nts.perf.data` | `0d2792cde62ced0cde66c1e52b495df9c21063b3e8df0014940e19629a7e4bad` |
| `gallop/ntsllvm.perf.data` | `ad17c0735bd0d84d3890d31a2dee484efc2a2f9103634ac7af05e657c8af479f` |

## Branch and stall counter control

A separate joint-lock sitting samples each of the three variants on the four
required rows, C and LLVM. One normal native harness invocation per cell;
CPU 4, shipping flags as above. All six user-mode events are one hardware
group at 100% running: cycles, instructions, branches, branch misses,
`cycle_activity.stalls_total`, and `int_misc.recovery_cycles`. These are
whole-harness ratios, including calibration and setup, not calibrated
per-call instruction counts. Stall and recovery events overlap and must
not be added. The six-invocation paired sitting above decides wall-time
regressions; these single invocations help explain them.

| Row | Backend | Variant | µs | / main | IPC | Misses / 1k instructions | Branch miss % | Stall cycles % | Recovery cycles % |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| sort-objects | C | before | 60.262 | 1.000 | 4.566 | 0.265 | 0.128 | 10.530 | 0.647 |
| sort-objects | C | base | 52.656 | 0.874 | 1.853 | 0.210 | 0.098 | 31.239 | 0.218 |
| sort-objects | C | gallop | 49.489 | 0.821 | 1.985 | 0.255 | 0.116 | 29.776 | 0.282 |
| sort-objects | LLVM | before | 66.081 | 1.000 | 4.418 | 0.304 | 0.148 | 10.961 | 0.714 |
| sort-objects | LLVM | base | 55.353 | 0.838 | 1.856 | 0.191 | 0.094 | 31.679 | 0.198 |
| sort-objects | LLVM | gallop | 51.603 | 0.781 | 1.978 | 0.228 | 0.109 | 29.249 | 0.253 |
| sort-objects-shuffled | C | before | 187.528 | 1.000 | 1.883 | 7.459 | 3.527 | 26.021 | 7.839 |
| sort-objects-shuffled | C | base | 186.282 | 0.993 | 1.526 | 6.018 | 3.248 | 30.736 | 5.517 |
| sort-objects-shuffled | C | gallop | 185.524 | 0.989 | 1.670 | 9.127 | 4.346 | 26.701 | 8.666 |
| sort-objects-shuffled | LLVM | before | 190.465 | 1.000 | 1.893 | 7.397 | 3.722 | 23.018 | 7.755 |
| sort-objects-shuffled | LLVM | base | 204.884 | 1.076 | 1.548 | 5.932 | 3.506 | 30.063 | 5.386 |
| sort-objects-shuffled | LLVM | gallop | 208.540 | 1.095 | 1.684 | 8.524 | 4.480 | 25.118 | 7.886 |
| sort-objects-runs | C | before | 70.685 | 1.000 | 4.601 | 0.292 | 0.132 | 10.032 | 0.772 |
| sort-objects-runs | C | base | 75.150 | 1.063 | 1.995 | 0.205 | 0.090 | 28.358 | 0.243 |
| sort-objects-runs | C | gallop | 60.047 | 0.849 | 2.249 | 0.230 | 0.094 | 25.389 | 0.302 |
| sort-objects-runs | LLVM | before | 71.561 | 1.000 | 4.608 | 0.270 | 0.132 | 9.635 | 0.723 |
| sort-objects-runs | LLVM | base | 79.214 | 1.107 | 1.960 | 0.227 | 0.103 | 28.867 | 0.260 |
| sort-objects-runs | LLVM | gallop | 62.595 | 0.875 | 2.197 | 0.253 | 0.106 | 25.614 | 0.325 |
| map-entries-top-k | C | before | 17.620 | 1.000 | 4.557 | 0.111 | 0.048 | 6.691 | 0.445 |
| map-entries-top-k | C | base | 16.614 | 0.943 | 4.452 | 0.098 | 0.042 | 6.892 | 0.354 |
| map-entries-top-k | C | gallop | 17.980 | 1.020 | 4.387 | 0.208 | 0.091 | 7.390 | 0.595 |
| map-entries-top-k | LLVM | before | 17.446 | 1.000 | 4.569 | 0.116 | 0.051 | 6.580 | 0.356 |
| map-entries-top-k | LLVM | base | 17.502 | 1.003 | 4.354 | 0.128 | 0.059 | 7.396 | 0.396 |
| map-entries-top-k | LLVM | gallop | 18.907 | 1.084 | 4.276 | 0.215 | 0.096 | 7.851 | 0.619 |

Base shuffled LLVM loses despite fewer branch misses per instruction than
main. Its lower IPC and higher stall fraction point at serialized load and
cursor dependencies. Galloping raises shuffled branch misses while reducing
the stall fraction. Map top-k has very few branch misses in every variant;
its galloping overhead is mainly extra instructions and control work, not
a large branch-recovery fraction.

The object-row profile places the largest remaining loop share in natural
run discovery. In both backends the generated native loop conditionally
adds zero or one to its cursor after the comparator returns. The next
iteration’s address therefore depends on that result. The correction
advances unconditionally, then excludes the first mismatching element
after exit. Run discovery and the insertion pivot also read the original
snapshot directly: the unprocessed permutation suffix is still identity.
This preserves the same comparator arguments and call order.

| Evidence under the scratch root | SHA-256 |
|---|---|
| `variant-perf.json` | `18204f2ef6400c44ca3348b34c82428201cdab57644090c52f02aa1fe75af39c` |
| `variant-perf.py` | `fca17e5df48636e5a07c948f21e3f1ab46cfae4093790faf6136d0be2201e7a0` |

## Independent cursor candidate

Kernel `194bfbea12`, recorded at `9142a21217`. The same pinned-engine
instruction-count conditions as above apply: CPU 0 outside the timing pair,
shipping RC and native flags, calibrated empty-bracket subtraction, native
band 0.01%. Comparator calls match the galloping candidate exactly on both
C and LLVM: object 5,545; shuffled 27,595; runs 4,556; strings 10.

| Row | Backend | Original | Cursor | / original | / galloping | Verdict vs original |
|---|---|---:|---:|---:|---:|---|
| array-copying-methods | C | 482832 | 482832 | 1.000000 | 1.000000 | WITHIN BAND |
| array-copying-methods | LLVM | 538832 | 538832 | 1.000000 | 1.000002 | WITHIN BAND |
| clbg-k-nucleotide | C | 17432320 | 17425596 | 0.999614 | 0.999990 | IMPROVED |
| clbg-k-nucleotide | LLVM | 17424398 | 17418029 | 0.999634 | 1.000009 | IMPROVED |
| map-entries-top-k | C | 414057 | 417463 | 1.008226 | 1.004761 | REGRESSED |
| map-entries-top-k | LLVM | 415503 | 427844 | 1.029701 | 1.001086 | REGRESSED |
| sort-objects | C | 1411192 | 482396 | 0.341836 | 0.950510 | IMPROVED |
| sort-objects | LLVM | 1501920 | 526928 | 0.350836 | 0.980295 | IMPROVED |
| sort-objects-runs | C | 1672921 | 679332 | 0.406075 | 0.972366 | IMPROVED |
| sort-objects-runs | LLVM | 1723222 | 698511 | 0.405352 | 0.974326 | IMPROVED |
| sort-objects-shuffled | C | 1829354 | 1596490 | 0.872707 | 0.988291 | IMPROVED |
| sort-objects-shuffled | LLVM | 1877546 | 1792031 | 0.954454 | 0.986959 | IMPROVED |
| string-sort-control | C | 2995 | 2426 | 0.810017 | 0.995895 | IMPROVED |
| string-sort-control | LLVM | 3077 | 2552 | 0.829379 | 1.005120 | IMPROVED |

Map top-k still fails the instruction guard. Its wall-time control is pending.

### Reducing generated merge control

Candidate `1c7d86625f` keeps the same minimum runs and powersort merge order.
A zero-power sentinel drains the pending stack through the same merge
site as ordinary boundaries, removing the second emitted merge kernel.
It tests the galloping streak before checking both run ends again; short
streaks need only the ordinary loop’s exhaustion check. Nonnegative binary
search spans below 2³¹ are halved with an unsigned shift rather than signed
division, removing the sampled sign-correction chain. The stable bound,
NaN handling, ownership paths and comparator arguments stay the same.

The code-size hypothesis is separate from the measured cursor latency:
large code alone does not prove an instruction-cache bottleneck. Exported
native function text sizes, excluding runtime helpers, are:

| Row | Backend | Original bytes | Base bytes | Galloping bytes | Galloping / base |
|---|---|---:|---:|---:|---:|
| sort-objects | C | 5299 | 20161 | 35150 | 1.743 |
| sort-objects | LLVM | 5624 | 26049 | 47349 | 1.818 |
| map-entries-top-k | C | 21931 | 43790 | 72822 | 1.663 |
| map-entries-top-k | LLVM | 21676 | 49412 | 83683 | 1.694 |

| Evidence under the scratch root | SHA-256 |
|---|---|
| `count-cursor.log` | `78aed1f09aaec565bb6e8dbcbfa909aab6d57cc682d2037743752477eb63c466` |
| `cursor/comparison-census/counts.json` | `9ad977cf8034222e250b44503a84fa29c181aa289858b74dfb42d150584e731c` |
| `cursor/comparison-census-llvm/counts.json` | `eaaa5b15c9d5b1e8c001c62ff923b48258d76cd92efe9301eeb93bfa2024ed63` |
| `variant-code-size.json` | `838a7e271ec12bdd1cec37c26054e07e7452ec970129d6a3f99a1b31f94a2268` |

## Cursor wall-time control

One CPU-4 lock, six alternating invocations of each archived variant per
row, sibling 5 user/nice unchanged, matching output checksums, shipping RC
and native flags as above. The original/base/galloping binaries are exactly
the earlier variants; cursor is kernel `194bfbea12`, record `9142a21217`.
The JSON binds every cell to its ELF SHA-256 and preserves every sample,
load and memory observation. The later source edit does not affect these
archived binaries. All times are µs. The same descriptive 3% timing threshold
labels each variant/main ratio; instruction guards are reported separately.

| Row | Backend | Main µs | Base µs | Galloping µs | Cursor µs | Base / main | Galloping / main | Cursor / main | Cursor / galloping |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| sort-objects | C | 59.332421 | 51.124662 | 48.103613 | 28.992671 | 0.8617 gain | 0.8107 gain | 0.4886 gain | 0.6027 gain |
| sort-objects | LLVM | 63.658864 | 54.197696 | 51.526803 | 31.460108 | 0.8514 gain | 0.8094 gain | 0.4942 gain | 0.6106 gain |
| sort-objects-runs | C | 70.063208 | 74.995762 | 59.363698 | 40.044581 | 1.0704 LOSS | 0.8473 gain | 0.5715 gain | 0.6746 gain |
| sort-objects-runs | LLVM | 71.670494 | 79.017400 | 62.410249 | 41.336407 | 1.1025 LOSS | 0.8708 gain | 0.5768 gain | 0.6623 gain |
| sort-objects-shuffled | C | 189.819961 | 189.337505 | 186.789416 | 184.246778 | 0.9975 within 3% | 0.9840 within 3% | 0.9706 within 3% | 0.9864 within 3% |
| sort-objects-shuffled | LLVM | 189.729320 | 205.995298 | 208.513034 | 209.529222 | 1.0857 LOSS | 1.0990 LOSS | 1.1044 LOSS | 1.0049 within 3% |
| map-entries-top-k | C | 17.901716 | 17.142060 | 18.589616 | 18.618733 | 0.9576 gain | 1.0384 LOSS | 1.0401 LOSS | 1.0016 within 3% |
| map-entries-top-k | LLVM | 18.021814 | 18.353718 | 19.454672 | 19.709008 | 1.0184 within 3% | 1.0795 LOSS | 1.0936 LOSS | 1.0131 within 3% |
| string-sort-control | C | 0.133487 | 0.111351 | 0.114543 | 0.108868 | 0.8342 gain | 0.8581 gain | 0.8156 gain | 0.9504 gain |
| string-sort-control | LLVM | 0.134444 | 0.110868 | 0.112129 | 0.112574 | 0.8246 gain | 0.8340 gain | 0.8373 gain | 1.0040 within 3% |
| array-copying-methods | C | 24.130819 | 24.014745 | 24.176817 | 24.193765 | 0.9952 within 3% | 1.0019 within 3% | 1.0026 within 3% | 1.0007 within 3% |
| array-copying-methods | LLVM | 25.506405 | 25.505420 | 25.430288 | 25.478640 | 1.0000 within 3% | 0.9970 within 3% | 0.9989 within 3% | 1.0019 within 3% |

The cursor correction removes about 40% of the galloping candidate’s object
wall time with identical comparator counts and only 2–5% fewer instructions.
This is direct evidence for the sampled loop-carried address dependency.
Both object backends improve about 51% against main in this sitting.
Shuffled LLVM and map top-k still fail: this candidate does not meet the
whole-task acceptance criteria. The single-kernel/search candidate is being
measured next; galloping remains provisional until the guards pass.

| Evidence under the scratch root | SHA-256 |
|---|---|
| `paired-cursor.json` | `b2e7804ab666fcc50fa82d25017a25afe059f6986f77ea56db898e3d4d17fa4e` |
| `paired-cursor.py` | `7a067b9226ae16b027c87f0990e5c73df1ee8c4ad086de2bc38e6fe46a2dc260` |

## Single merge-kernel candidate

Kernel `1c7d86625f`, record `029873836d`. The pinned count conditions and
0.01% native instruction band above apply. All four comparator censuses
match the cursor candidate exactly on C and LLVM, including checksums.

| Row | Backend | Original | Kernel | / original | / cursor | Verdict vs original |
|---|---|---:|---:|---:|---:|---|
| array-copying-methods | C | 482832 | 482832 | 1.000000 | 1.000000 | WITHIN BAND |
| array-copying-methods | LLVM | 538832 | 538832 | 1.000000 | 1.000000 | WITHIN BAND |
| clbg-k-nucleotide | C | 17432320 | 17425360 | 0.999601 | 0.999986 | IMPROVED |
| clbg-k-nucleotide | LLVM | 17424398 | 17417996 | 0.999633 | 0.999998 | IMPROVED |
| map-entries-top-k | C | 414057 | 391714 | 0.946039 | 0.938320 | IMPROVED |
| map-entries-top-k | LLVM | 415503 | 404439 | 0.973372 | 0.945295 | IMPROVED |
| sort-objects | C | 1411192 | 475402 | 0.336880 | 0.985502 | IMPROVED |
| sort-objects | LLVM | 1501920 | 518164 | 0.345001 | 0.983368 | IMPROVED |
| sort-objects-runs | C | 1672921 | 680407 | 0.406718 | 1.001582 | IMPROVED |
| sort-objects-runs | LLVM | 1723222 | 699506 | 0.405929 | 1.001424 | IMPROVED |
| sort-objects-shuffled | C | 1829354 | 1468231 | 0.802595 | 0.919662 | IMPROVED |
| sort-objects-shuffled | LLVM | 1877546 | 1807381 | 0.962629 | 1.008566 | IMPROVED |
| string-sort-control | C | 2995 | 2413 | 0.805676 | 0.994641 | IMPROVED |
| string-sort-control | LLVM | 3077 | 2520 | 0.818980 | 0.987461 | IMPROVED |

### Unchanged counter-control columns

These columns were run by the count owner even with native lanes filtered.
Every movement is retained below. Node is the same pinned v26.13.0; its
count spread is informational. C++'s displayed instruction band is 0.01%.
The saved C++ timed ELF binaries for map top-k and k-nucleotide are byte
identical across original, cursor and kernel. The observed C++ counter
movement is not attributed to an NTS compiler change. This identity check
does not establish identity of every transient count-bracket artifact.

| Row | Column | Original | Cursor | Kernel | Kernel / original | Condition/verdict |
|---|---|---:|---:|---:|---:|---|
| array-copying-methods | C++ | 295759 | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | node | 2318228 | 2320268 | 2353402 | 1.015173 | JIT spread: informational |
| clbg-k-nucleotide | C++ | 7805117 | 7805117 | 7806113 | 1.000128 | WORSE control: outside band |
| clbg-k-nucleotide | node | 36398076 | 34973878 | 34944029 | 0.960052 | JIT spread: informational |
| map-entries-top-k | C++ | 376413 | 376315 | 376630 | 1.000576 | WORSE control: outside band |
| map-entries-top-k | node | 778585 | 791779 | 879272 | 1.129320 | JIT spread: informational |
| sort-objects | C++ | 733449 | 733449 | 733449 | 1.000000 | within band |
| sort-objects | node | 1497315 | 1517237 | 1568420 | 1.047488 | JIT spread: informational |
| sort-objects-runs | C++ | 479914 | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | node | 1562565 | 1561662 | 1555882 | 0.995723 | JIT spread: informational |
| sort-objects-shuffled | C++ | 855387 | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | node | 4541688 | 7202371 | 11973954 | 2.636455 | JIT spread: informational |
| string-sort-control | C++ | 1700 | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | node | 5802 | 9935 | 6052 | 1.043089 | JIT spread: informational |

### Incomplete five-variant sitting

The first attempt completed eleven rows, then stopped on a sibling-5
user tick during the final LLVM array-copy control. Its final incomplete
row did not save timing samples. The failed condition records CPU-5
user/nice changing 8,360→8,361 ticks, load 10.45→47.43 and available memory
17,259,100→12,446,572 KiB. This attempt is incomplete and is not used as
the final acceptance sitting. All eleven completed rows are retained here,
including losses; their per-row user/nice counters were unchanged. A full
repeat checkpoints every row before assessing sibling activity.

Times are µs, medians of six alternating invocations. Archived binaries,
shipping flags, checksums, memory/load conditions and hashes are in the log.
Ratio labels use the descriptive 3% threshold, not the instruction band.

| Row | Backend | Main µs | Base µs | Galloping µs | Cursor µs | Kernel µs | Kernel / main | Kernel / cursor |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| sort-objects | C | 54.384762 | 46.210297 | 43.919254 | 26.721423 | 26.278626 | 0.4832 gain | 0.9834 within 3% |
| sort-objects | LLVM | 59.286498 | 50.069941 | 47.281684 | 28.641411 | 28.479013 | 0.4804 gain | 0.9943 within 3% |
| sort-objects-runs | C | 63.633322 | 68.705309 | 54.001275 | 36.136636 | 36.420451 | 0.5723 gain | 1.0079 within 3% |
| sort-objects-runs | LLVM | 63.346970 | 72.773406 | 56.830048 | 37.603797 | 37.236113 | 0.5878 gain | 0.9902 within 3% |
| sort-objects-shuffled | C | 173.043447 | 173.225853 | 170.133163 | 166.314327 | 172.034371 | 0.9942 within 3% | 1.0344 LOSS |
| sort-objects-shuffled | LLVM | 181.420209 | 197.636198 | 197.820033 | 198.579554 | 182.748508 | 1.0073 within 3% | 0.9203 gain |
| map-entries-top-k | C | 15.932301 | 15.347993 | 16.627939 | 16.738706 | 15.489808 | 0.9722 within 3% | 0.9254 gain |
| map-entries-top-k | LLVM | 16.980275 | 17.147479 | 17.688080 | 17.879392 | 16.713716 | 0.9843 within 3% | 0.9348 gain |
| string-sort-control | C | 0.122079 | 0.102082 | 0.105833 | 0.100517 | 0.105446 | 0.8637 gain | 1.0490 LOSS |
| string-sort-control | LLVM | 0.132539 | 0.109701 | 0.109705 | 0.110906 | 0.112892 | 0.8518 gain | 1.0179 within 3% |
| array-copying-methods | C | 23.888096 | 23.781903 | 23.673974 | 23.744244 | 24.003486 | 1.0048 within 3% | 1.0109 within 3% |

### Index-width follow-up under review

The builder currently uses signed 64-bit cursors throughout because
powersort's doubled midpoint arithmetic needs more than 31 bits. Ordinary
array indices need no such width: the runtime enforces length below 2³¹.
The sampled search and addressing path and new disassembly motivate
separating those representations. Both native functions vectorize copies,
but the kernel LLVM shuffled `work` contains 448 shift instructions that
restore signed-32 wrapping in address arithmetic; the C function has none
of those shifts. This static count is not a dynamic cycle attribution.
The current kernel shuffled instruction gap is 1,807,381 versus 1,468,231.
The narrower-index design was sent for coordinator review before editing.

| Evidence under the scratch root | SHA-256 |
|---|---|
| `count-kernel.log` | `103ebb46a20b69fddd1e82ab85380187265f66ded9d2cae83c07e1eb8170a386` |
| `kernel/comparison-census/counts.json` | `50179805eac58844a7db51a32ec8dfb852949f18eba9f78857ec39a8531f6eb1` |
| `kernel/comparison-census-llvm/counts.json` | `316850ae65d3343e6030d251e6393b09d5cfcfbf8f780f5fc2673d56f4399624` |
| `kernel-native/nts.dis` | `3615c76a62436eb88a99b095b21ca3cb10d0b1e6283fe9a5a0ed9a5410f3fbf6` |
| `kernel-native/ntsllvm.dis` | `c801cb3109132d21a0945cdf4b867559969f4238e8e452593b3d1107e7499dd0` |
| `paired-kernel-spoiled.log` | `9e70021792a3bdf1aa4141cff0ac308038fe59781dcac84cd19691809d125c6d` |
| `paired-kernel-initial.py` | `53ba4d59c899abf38e13d1d53d3c558524b11462b45fa3356bf6c254d81487c3` |

## Complete five-variant repeat

All twelve rows completed under one CPU-4 lock; no row has sibling-5
user/nice activity. Six alternating invocations per archived variant,
matching checksums, shipping RC and native flags. Each row retains load,
available memory, all samples and each ELF hash in the JSON. Ratios below
are within this sitting; times must not be compared with earlier sittings.
The descriptive 3% threshold labels wall-time movement. The final engine
acceptance sitting is still required.

| Row | Backend | Variant | Main µs | Variant µs | / main | / preceding variant | Verdict vs main |
|---|---|---|---:|---:|---:|---:|---|
| sort-objects | C | base | 57.085559 | 49.760160 | 0.871677 | 0.871677 | gain |
| sort-objects | C | gallop | 57.085559 | 47.425918 | 0.830787 | 0.953090 | gain |
| sort-objects | C | cursor | 57.085559 | 29.214409 | 0.511765 | 0.616001 | gain |
| sort-objects | C | kernel | 57.085559 | 28.629583 | 0.501521 | 0.979982 | gain |
| sort-objects | LLVM | base | 60.265874 | 50.890118 | 0.844427 | 0.844427 | gain |
| sort-objects | LLVM | gallop | 60.265874 | 48.191268 | 0.799644 | 0.946967 | gain |
| sort-objects | LLVM | cursor | 60.265874 | 29.158335 | 0.483828 | 0.605054 | gain |
| sort-objects | LLVM | kernel | 60.265874 | 28.818665 | 0.478192 | 0.988351 | gain |
| sort-objects-runs | C | base | 67.628220 | 70.324995 | 1.039876 | 1.039876 | LOSS |
| sort-objects-runs | C | gallop | 67.628220 | 55.080960 | 0.814467 | 0.783234 | gain |
| sort-objects-runs | C | cursor | 67.628220 | 36.719472 | 0.542961 | 0.666645 | gain |
| sort-objects-runs | C | kernel | 67.628220 | 37.265024 | 0.551028 | 1.014857 | gain |
| sort-objects-runs | LLVM | base | 68.914908 | 77.246216 | 1.120893 | 1.120893 | LOSS |
| sort-objects-runs | LLVM | gallop | 68.914908 | 61.097228 | 0.886560 | 0.790941 | gain |
| sort-objects-runs | LLVM | cursor | 68.914908 | 39.983225 | 0.580183 | 0.654420 | gain |
| sort-objects-runs | LLVM | kernel | 68.914908 | 40.144182 | 0.582518 | 1.004026 | gain |
| sort-objects-shuffled | C | base | 183.618320 | 184.815358 | 1.006519 | 1.006519 | within 3% |
| sort-objects-shuffled | C | gallop | 183.618320 | 181.300004 | 0.987374 | 0.980979 | within 3% |
| sort-objects-shuffled | C | cursor | 183.618320 | 173.135769 | 0.942911 | 0.954968 | gain |
| sort-objects-shuffled | C | kernel | 183.618320 | 181.752109 | 0.989836 | 1.049766 | within 3% |
| sort-objects-shuffled | LLVM | base | 174.309735 | 188.094622 | 1.079083 | 1.079083 | LOSS |
| sort-objects-shuffled | LLVM | gallop | 174.309735 | 192.439224 | 1.104007 | 1.023098 | LOSS |
| sort-objects-shuffled | LLVM | cursor | 174.309735 | 190.418975 | 1.092417 | 0.989502 | LOSS |
| sort-objects-shuffled | LLVM | kernel | 174.309735 | 176.398837 | 1.011985 | 0.926372 | within 3% |
| map-entries-top-k | C | base | 16.014177 | 15.412017 | 0.962398 | 0.962398 | gain |
| map-entries-top-k | C | gallop | 16.014177 | 16.772470 | 1.047351 | 1.088272 | LOSS |
| map-entries-top-k | C | cursor | 16.014177 | 16.766733 | 1.046993 | 0.999658 | LOSS |
| map-entries-top-k | C | kernel | 16.014177 | 15.396570 | 0.961434 | 0.918281 | gain |
| map-entries-top-k | LLVM | base | 17.774964 | 18.073679 | 1.016805 | 1.016805 | within 3% |
| map-entries-top-k | LLVM | gallop | 17.774964 | 19.219889 | 1.081290 | 1.063419 | LOSS |
| map-entries-top-k | LLVM | cursor | 17.774964 | 19.213673 | 1.080940 | 0.999677 | LOSS |
| map-entries-top-k | LLVM | kernel | 17.774964 | 18.022727 | 1.013939 | 0.938016 | within 3% |
| string-sort-control | C | base | 0.130001 | 0.108063 | 0.831247 | 0.831247 | gain |
| string-sort-control | C | gallop | 0.130001 | 0.111132 | 0.854854 | 1.028399 | gain |
| string-sort-control | C | cursor | 0.130001 | 0.106348 | 0.818050 | 0.956948 | gain |
| string-sort-control | C | kernel | 0.130001 | 0.111693 | 0.859165 | 1.050260 | gain |
| string-sort-control | LLVM | base | 0.127645 | 0.106324 | 0.832966 | 0.832966 | gain |
| string-sort-control | LLVM | gallop | 0.127645 | 0.107133 | 0.839303 | 1.007608 | gain |
| string-sort-control | LLVM | cursor | 0.127645 | 0.108042 | 0.846425 | 1.008485 | gain |
| string-sort-control | LLVM | kernel | 0.127645 | 0.108130 | 0.847115 | 1.000815 | gain |
| array-copying-methods | C | base | 22.373444 | 22.474478 | 1.004516 | 1.004516 | within 3% |
| array-copying-methods | C | gallop | 22.373444 | 22.637748 | 1.011813 | 1.007265 | within 3% |
| array-copying-methods | C | cursor | 22.373444 | 22.775063 | 1.017951 | 1.006066 | within 3% |
| array-copying-methods | C | kernel | 22.373444 | 22.740358 | 1.016400 | 0.998476 | within 3% |
| array-copying-methods | LLVM | base | 23.265954 | 23.117872 | 0.993635 | 0.993635 | within 3% |
| array-copying-methods | LLVM | gallop | 23.265954 | 23.357907 | 1.003952 | 1.010383 | within 3% |
| array-copying-methods | LLVM | cursor | 23.265954 | 23.141636 | 0.994657 | 0.990741 | within 3% |
| array-copying-methods | LLVM | kernel | 23.265954 | 22.954582 | 0.986617 | 0.991917 | within 3% |

Map LLVM remains unresolved: its kernel median is 1.4% slower than main in
this sitting, despite 2.7% fewer instructions. Its previous incomplete
sitting's quiet map row was 1.6% faster. The gain is not established by
these two observations. Shuffled LLVM is within the descriptive timing
band, while all of the earlier adaptive variants lose it. Galloping's
final decision must retain the partially ordered benefit and pass map,
shuffled and string guards on the final representation.

### Fresh shuffled and map profiles

These four profiles follow the paired timings under the same lock, with
`cpu_core/cycles/u`, period 50,003. Hardware-stat event groups run at
100%; metrics are whole-harness values including calibration/setup.
Stall and recovery events overlap, so their percentages are not additive.

| Row | Backend | IPC | Branch misses / 1k instructions | Stall cycles % | Recovery cycles % | Index-wrap idiom sample % |
|---|---|---:|---:|---:|---:|---:|
| sort-objects-shuffled | C | 1.512 | 11.344 | 29.682 | 10.045 | 0.000 |
| sort-objects-shuffled | LLVM | 1.840 | 7.957 | 23.888 | 8.252 | 1.320 |
| map-entries-top-k | C | 4.537 | 0.096 | 6.519 | 0.350 | 0.360 |
| map-entries-top-k | LLVM | 4.388 | 0.097 | 7.062 | 0.319 | 0.780 |

The index-wrap classifier matches `shl $0x20`, `sar $0x20` and
`sar $0x1e` native idioms. LLVM's 448 static occurrences in shuffled work
have only 1.32% of global cycle samples; their static number is not their
cycle share. The ordinary merge and binary-insertion loops remain much
larger, about one third and two fifths of the profile respectively. The
hot LLVM merge has extra cursor/index extensions, address scaling and
spills versus C; narrowing is a representation proposal, not a claim that
removing the 448 shifts alone removes the whole cost.

| Evidence under the scratch root | SHA-256 |
|---|---|
| `paired-kernel-retry.json` | `4ad42dc48f72aad55ee3a1d67e1befe75763c8fa93c3ec3b72bb72b390a5dacc` |
| `paired-kernel-retry.py` | `b7a8a3fa35c7cdf703ffeb3d4b1d7e7d01e6e402203ce572a780912f54d7c38b` |
| `kernel-profile/sort-objects-shuffled-nts.csv` | `01f0c0440bcf8e4ffa73a67afab1eb5cee8d0f956a631e5bc5e2bc665bc670db` |
| `kernel-profile/sort-objects-shuffled-nts.data` | `c23c9a0825ff4b5b610fee86aa594b1d283cedc8c3b27d5f4d875e6ef058c6b2` |
| `kernel-profile/sort-objects-shuffled-nts.annotate` | `307a12587d243a8e76e1f7653c197e4e3d00a1be5d5dc7946e1ef147afe55fe8` |
| `kernel-profile/sort-objects-shuffled-ntsllvm.csv` | `46a2fcc1c0cbbe1aed639415bc71c0e50af42d6bb69f318837208c473b43dc16` |
| `kernel-profile/sort-objects-shuffled-ntsllvm.data` | `3f2ec8f5f9a19dbc6f23e7d775979f38ae3b35ed02df125ad86514e3ba6bebe9` |
| `kernel-profile/sort-objects-shuffled-ntsllvm.annotate` | `6397d2638f37e32a18ab63925a550c1ec7ca1c026254aab891bc1215b14fffb7` |
| `kernel-profile/map-entries-top-k-nts.csv` | `0e7de0cfef1c3ef4389493bf975acff262b0138a3b3b533f2b31e67bf0b014d6` |
| `kernel-profile/map-entries-top-k-nts.data` | `527e23215428344d60586f46f18180006c295a15f394c8ab4d80c0477c8de2a7` |
| `kernel-profile/map-entries-top-k-nts.annotate` | `f20d6626bfb98033821e5ca8e0da4ad199f941de0bd83d78950b4d96a0b28c27` |
| `kernel-profile/map-entries-top-k-ntsllvm.csv` | `8dcd65a97da46c00fd35a70bf6924facb61d36bbe8bf66206bda0ec9bd335add` |
| `kernel-profile/map-entries-top-k-ntsllvm.data` | `f1146f8d88187e690d2f5f7e6ecc9996c7d60acd2a6dc6ad1bb75efe4120a6f2` |
| `kernel-profile/map-entries-top-k-ntsllvm.annotate` | `4334ffb558a6c751380ed6b3e547c2fdf10398cb2a7acf5398e17cdb228060c0` |

## Memory floors and unsigned cursor proof

The current release kernel `1c7d86625f` passes all 78 existing memory
cases: every reference-count and allocation floor, unchanged answers,
and zero leaks. Raw output is
`/home/akisarou/.cache/nts-scratch/876/memory-kernel.log`, SHA-256
`d7e80de961cb4aba098f5bfd30d1f3ed2b3befbe2dff7a2d443fb28343f899c1`.

The coordinator approved an unsigned 32-bit cursor contract, with exclusive
backward ends and i64 power arithmetic. The proof uses JavaScript's full
u32 length domain. Today's physical dense-allocation cap is narrower:
`NTS_MAX_LENGTH=2147483646` in `runtime/c/nts_runtime.h`, enforced by
`nts_array_allocate`. No runtime-limit policy changes here.

The boundary controls execute the production arithmetic emitter templates
with checked unsigned operations, including values around 2³¹ and 2³²−1,
without allocating element buffers. Bounded advancement subtracts before
adding, and backward positions use an exclusive end. Midpoint controls
check the widened coordinates and the at-most-32 power bound. A HIR guard
requires all generated sort memory indices to use at most 32 bits in raw
and prepared programs; the wide values are only power coordinates.

The matched policy arms will distinguish the width contract, minrun maxima
32/64, bounds-based/count-based binary insertion, and galloping on/off.

## Unsigned focused proof

Source `904a90d9a` passes Clippy, both scalar boundary-proof controls, the
raw/prepared HIR index-width contract, all 23 C write-back checks, both
C/LLVM forced-collection/throw/mutation suites under RC and NoGC with
poisoning and ASan/UBSan, and the JVM fixture executed with Node agreement
and `-Xverify:all`. The native fixtures cover 18 seeds and the JVM fixture
executes all eleven exports for those seeds.

The first focused attempts stopped before tests on documentation formatting
and test function length; those were corrected. The final raw log is
`/home/akisarou/.cache/nts-scratch/876/u32-focused-final.log`, SHA-256
`e36640660fbcb6f2fd28c8c9a7e11270fe8b36479ab71b43a3c2f768a231a301`.

The named policy arms use r64 for minrun normalization at 64 (returned runs
32–64), and r32 for normalization at 32 (returned runs 16–32). Count-based
upper-bound search has the same comparisons as bounds-based search; its
control changes the dependency representation. Galloping-disabled controls
keep the same policy and constant-fold the galloping entry condition away.
Each source arm is committed and its commit observed before an all-release
build and instruction counts. All archived arms are then timed together.

## Matched unsigned width and run-policy experiment

The six u32 arms differ only in the named factor: minrun normalization at
32 or 64, bounds-based or remaining-count insertion search, and galloping
on or off. The i64 single-kernel candidate and the original main compiler
are the other two arms. Each source is committed and HEAD observed before
its plain workspace release build. Pinned Node v26.13.0, shipping native
flags, RC provider, calibrated empty-bracket-subtracted user instructions
on CPU 0, outside reserved CPUs 4–5, no timing lock for instruction counts.
The native count band is 0.01%; JIT spread is informational.

| Arm | Commit | Source SHA-256 |
|---|---|---|
| u32-r64-bounds-gallop | `15ee696551c47f6018eb897d227d52cc93519f84` | `b126995b9514e1688f35f3efede88ac4f345aea2b8b3cd6c56d32ea480e2c270` |
| u32-r32-bounds-gallop | `4b78e63432cffa5bd23ab76fc1acfa18f4b7c0ec` | `632243b644616ff24f3c7c04c3a58738537f0732a8910f62695782f2178e90be` |
| u32-r64-count-gallop | `7c623aa0e5bb0b5de61fd0987800373ea0318b78` | `7639974a59497b5937f77f6801bff314a7c60c7a9a80bf0cf35741f29c346770` |
| u32-r32-count-gallop | `392c220ca10071e0ffb1d6741d1beab17b416402` | `b81099d55e841e6e2b8dc186c5cbf65040247e173930c0459883ed92f6e320f1` |
| u32-r64-bounds-plain | `9f7e4e3bcbcdaffa479ae9888041be6642926712` | `e3cc2c8e5c610211aaafe912960df5cbfab5b62fb1b2cf247eb68c50951955e3` |
| u32-r32-count-plain | `d1ea2ce912a82867c39a4441f251d23ecd1d6e06` | `d60469d0b47cca95367ac49e1c709a0dc9c20ce92df6f83bfb4e6f112f7c09cf` |

The count-search r64 arm's first pass completed six rows, then the final
string control's Node oracle did not complete. The failed log and raw
observations are preserved. Only that control was retried; it completed
and agreed. The earlier six rows were retained, not repeated or selected.
An initial archive attempt encountered nonregular counter-control FIFOs;
the archiver now copies regular evidence files and leaves FIFOs alone.
Neither evidence-copying failure changed product source or a verdict.

| Row | Backend | Arm | Original instructions | Arm instructions | / original | / u32 reference | Verdict vs original |
|---|---|---|---:|---:|---:|---:|---|
| array-copying-methods | C | u32-r64-bounds-gallop | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | C | u32-r32-bounds-gallop | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | C | u32-r64-count-gallop | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | C | u32-r32-count-gallop | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | C | u32-r64-bounds-plain | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | C | u32-r32-count-plain | 482832 | 482832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | LLVM | u32-r64-bounds-gallop | 538832 | 538832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | LLVM | u32-r32-bounds-gallop | 538832 | 538832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | LLVM | u32-r64-count-gallop | 538832 | 538832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | LLVM | u32-r32-count-gallop | 538832 | 538831 | 0.999998 | 0.999998 | within band |
| array-copying-methods | LLVM | u32-r64-bounds-plain | 538832 | 538832 | 1.000000 | 1.000000 | within band |
| array-copying-methods | LLVM | u32-r32-count-plain | 538832 | 538833 | 1.000002 | 1.000002 | within band |
| clbg-k-nucleotide | C | u32-r64-bounds-gallop | 17432320 | 17425096 | 0.999586 | 1.000000 | gain |
| clbg-k-nucleotide | C | u32-r32-bounds-gallop | 17432320 | 17425096 | 0.999586 | 1.000000 | gain |
| clbg-k-nucleotide | C | u32-r64-count-gallop | 17432320 | 17425425 | 0.999604 | 1.000019 | gain |
| clbg-k-nucleotide | C | u32-r32-count-gallop | 17432320 | 17425426 | 0.999605 | 1.000019 | gain |
| clbg-k-nucleotide | C | u32-r64-bounds-plain | 17432320 | 17425329 | 0.999599 | 1.000013 | gain |
| clbg-k-nucleotide | C | u32-r32-count-plain | 17432320 | 17425432 | 0.999605 | 1.000019 | gain |
| clbg-k-nucleotide | LLVM | u32-r64-bounds-gallop | 17424398 | 17417472 | 0.999603 | 1.000000 | gain |
| clbg-k-nucleotide | LLVM | u32-r32-bounds-gallop | 17424398 | 17417472 | 0.999603 | 1.000000 | gain |
| clbg-k-nucleotide | LLVM | u32-r64-count-gallop | 17424398 | 17417524 | 0.999605 | 1.000003 | gain |
| clbg-k-nucleotide | LLVM | u32-r32-count-gallop | 17424398 | 17417486 | 0.999603 | 1.000001 | gain |
| clbg-k-nucleotide | LLVM | u32-r64-bounds-plain | 17424398 | 17417580 | 0.999609 | 1.000006 | gain |
| clbg-k-nucleotide | LLVM | u32-r32-count-plain | 17424398 | 17417499 | 0.999604 | 1.000002 | gain |
| map-entries-top-k | C | u32-r64-bounds-gallop | 414057 | 387673 | 0.936279 | 1.000000 | gain |
| map-entries-top-k | C | u32-r32-bounds-gallop | 414057 | 390131 | 0.942216 | 1.006340 | gain |
| map-entries-top-k | C | u32-r64-count-gallop | 414057 | 389602 | 0.940938 | 1.004976 | gain |
| map-entries-top-k | C | u32-r32-count-gallop | 414057 | 391569 | 0.945689 | 1.010050 | gain |
| map-entries-top-k | C | u32-r64-bounds-plain | 414057 | 380853 | 0.919808 | 0.982408 | gain |
| map-entries-top-k | C | u32-r32-count-plain | 414057 | 384898 | 0.929577 | 0.992842 | gain |
| map-entries-top-k | LLVM | u32-r64-bounds-gallop | 415503 | 394244 | 0.948836 | 1.000000 | gain |
| map-entries-top-k | LLVM | u32-r32-bounds-gallop | 415503 | 396487 | 0.954234 | 1.005689 | gain |
| map-entries-top-k | LLVM | u32-r64-count-gallop | 415503 | 396354 | 0.953914 | 1.005352 | gain |
| map-entries-top-k | LLVM | u32-r32-count-gallop | 415503 | 397895 | 0.957622 | 1.009261 | gain |
| map-entries-top-k | LLVM | u32-r64-bounds-plain | 415503 | 387478 | 0.932552 | 0.982838 | gain |
| map-entries-top-k | LLVM | u32-r32-count-plain | 415503 | 387627 | 0.932910 | 0.983216 | gain |
| sort-objects | C | u32-r64-bounds-gallop | 1411192 | 471453 | 0.334081 | 1.000000 | gain |
| sort-objects | C | u32-r32-bounds-gallop | 1411192 | 474029 | 0.335907 | 1.005464 | gain |
| sort-objects | C | u32-r64-count-gallop | 1411192 | 470500 | 0.333406 | 0.997979 | gain |
| sort-objects | C | u32-r32-count-gallop | 1411192 | 472579 | 0.334879 | 1.002388 | gain |
| sort-objects | C | u32-r64-bounds-plain | 1411192 | 466981 | 0.330912 | 0.990514 | gain |
| sort-objects | C | u32-r32-count-plain | 1411192 | 469249 | 0.332520 | 0.995325 | gain |
| sort-objects | LLVM | u32-r64-bounds-gallop | 1501920 | 484827 | 0.322805 | 1.000000 | gain |
| sort-objects | LLVM | u32-r32-bounds-gallop | 1501920 | 487312 | 0.324459 | 1.005126 | gain |
| sort-objects | LLVM | u32-r64-count-gallop | 1501920 | 485173 | 0.323035 | 1.000714 | gain |
| sort-objects | LLVM | u32-r32-count-gallop | 1501920 | 487025 | 0.324268 | 1.004534 | gain |
| sort-objects | LLVM | u32-r64-bounds-plain | 1501920 | 479354 | 0.319161 | 0.988711 | gain |
| sort-objects | LLVM | u32-r32-count-plain | 1501920 | 480672 | 0.320038 | 0.991430 | gain |
| sort-objects-runs | C | u32-r64-bounds-gallop | 1672921 | 673797 | 0.402767 | 1.000000 | gain |
| sort-objects-runs | C | u32-r32-bounds-gallop | 1672921 | 670812 | 0.400982 | 0.995570 | gain |
| sort-objects-runs | C | u32-r64-count-gallop | 1672921 | 674267 | 0.403048 | 1.000698 | gain |
| sort-objects-runs | C | u32-r32-count-gallop | 1672921 | 670863 | 0.401013 | 0.995646 | gain |
| sort-objects-runs | C | u32-r64-bounds-plain | 1672921 | 732094 | 0.437614 | 1.086520 | gain |
| sort-objects-runs | C | u32-r32-count-plain | 1672921 | 729269 | 0.435926 | 1.082327 | gain |
| sort-objects-runs | LLVM | u32-r64-bounds-gallop | 1723222 | 681611 | 0.395545 | 1.000000 | gain |
| sort-objects-runs | LLVM | u32-r32-bounds-gallop | 1723222 | 678313 | 0.393631 | 0.995161 | gain |
| sort-objects-runs | LLVM | u32-r64-count-gallop | 1723222 | 682514 | 0.396069 | 1.001325 | gain |
| sort-objects-runs | LLVM | u32-r32-count-gallop | 1723222 | 678862 | 0.393949 | 0.995967 | gain |
| sort-objects-runs | LLVM | u32-r64-bounds-plain | 1723222 | 746633 | 0.433277 | 1.095395 | gain |
| sort-objects-runs | LLVM | u32-r32-count-plain | 1723222 | 743814 | 0.431641 | 1.091259 | gain |
| sort-objects-shuffled | C | u32-r64-bounds-gallop | 1829354 | 1417368 | 0.774792 | 1.000000 | gain |
| sort-objects-shuffled | C | u32-r32-bounds-gallop | 1829354 | 1461009 | 0.798648 | 1.030790 | gain |
| sort-objects-shuffled | C | u32-r64-count-gallop | 1829354 | 1432179 | 0.782888 | 1.010450 | gain |
| sort-objects-shuffled | C | u32-r32-count-gallop | 1829354 | 1471720 | 0.804503 | 1.038347 | gain |
| sort-objects-shuffled | C | u32-r64-bounds-plain | 1829354 | 1332806 | 0.728566 | 0.940339 | gain |
| sort-objects-shuffled | C | u32-r32-count-plain | 1829354 | 1367945 | 0.747775 | 0.965130 | gain |
| sort-objects-shuffled | LLVM | u32-r64-bounds-gallop | 1877546 | 1531933 | 0.815923 | 1.000000 | gain |
| sort-objects-shuffled | LLVM | u32-r32-bounds-gallop | 1877546 | 1568977 | 0.835653 | 1.024181 | gain |
| sort-objects-shuffled | LLVM | u32-r64-count-gallop | 1877546 | 1546930 | 0.823911 | 1.009790 | gain |
| sort-objects-shuffled | LLVM | u32-r32-count-gallop | 1877546 | 1578840 | 0.840906 | 1.030619 | gain |
| sort-objects-shuffled | LLVM | u32-r64-bounds-plain | 1877546 | 1462453 | 0.778917 | 0.954646 | gain |
| sort-objects-shuffled | LLVM | u32-r32-count-plain | 1877546 | 1478986 | 0.787723 | 0.965438 | gain |
| string-sort-control | C | u32-r64-bounds-gallop | 2995 | 2392 | 0.798664 | 1.000000 | gain |
| string-sort-control | C | u32-r32-bounds-gallop | 2995 | 2392 | 0.798664 | 1.000000 | gain |
| string-sort-control | C | u32-r64-count-gallop | 2995 | 2392 | 0.798664 | 1.000000 | gain |
| string-sort-control | C | u32-r32-count-gallop | 2995 | 2392 | 0.798664 | 1.000000 | gain |
| string-sort-control | C | u32-r64-bounds-plain | 2995 | 2374 | 0.792654 | 0.992475 | gain |
| string-sort-control | C | u32-r32-count-plain | 2995 | 2395 | 0.799666 | 1.001254 | gain |
| string-sort-control | LLVM | u32-r64-bounds-gallop | 3077 | 2443 | 0.793955 | 1.000000 | gain |
| string-sort-control | LLVM | u32-r32-bounds-gallop | 3077 | 2443 | 0.793955 | 1.000000 | gain |
| string-sort-control | LLVM | u32-r64-count-gallop | 3077 | 2455 | 0.797855 | 1.004912 | gain |
| string-sort-control | LLVM | u32-r32-count-gallop | 3077 | 2455 | 0.797855 | 1.004912 | gain |
| string-sort-control | LLVM | u32-r64-bounds-plain | 3077 | 2444 | 0.794280 | 1.000409 | gain |
| string-sort-control | LLVM | u32-r32-count-plain | 3077 | 2449 | 0.795905 | 1.002456 | gain |

The unchanged C++ and pinned Node counter controls are also retained.
C++ movement outside its 0.01% band is labeled as a control movement,
not attributed to the NTS compiler. Node repeat spread is informational.
Filtered JVM, Java, Bun and ScriptC columns were not measured here.

| Row | Column | Arm | Original | Arm | / original | Condition/verdict |
|---|---|---|---:|---:|---:|---|
| array-copying-methods | C++ | u32-r64-bounds-gallop | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | C++ | u32-r32-bounds-gallop | 295759 | 295760 | 1.000003 | within band |
| array-copying-methods | C++ | u32-r64-count-gallop | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | C++ | u32-r32-count-gallop | 295759 | 295760 | 1.000003 | within band |
| array-copying-methods | C++ | u32-r64-bounds-plain | 295759 | 295758 | 0.999997 | within band |
| array-copying-methods | C++ | u32-r32-count-plain | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | node | u32-r64-bounds-gallop | 2318228 | 2318542 | 1.000135 | JIT spread, informational |
| array-copying-methods | node | u32-r32-bounds-gallop | 2318228 | 2318751 | 1.000226 | JIT spread, informational |
| array-copying-methods | node | u32-r64-count-gallop | 2318228 | 2319937 | 1.000737 | JIT spread, informational |
| array-copying-methods | node | u32-r32-count-gallop | 2318228 | 2345594 | 1.011805 | JIT spread, informational |
| array-copying-methods | node | u32-r64-bounds-plain | 2318228 | 2318878 | 1.000280 | JIT spread, informational |
| array-copying-methods | node | u32-r32-count-plain | 2318228 | 2319365 | 1.000490 | JIT spread, informational |
| clbg-k-nucleotide | C++ | u32-r64-bounds-gallop | 7805117 | 7806113 | 1.000128 | worse control, outside band |
| clbg-k-nucleotide | C++ | u32-r32-bounds-gallop | 7805117 | 7806114 | 1.000128 | worse control, outside band |
| clbg-k-nucleotide | C++ | u32-r64-count-gallop | 7805117 | 7806113 | 1.000128 | worse control, outside band |
| clbg-k-nucleotide | C++ | u32-r32-count-gallop | 7805117 | 7806132 | 1.000130 | worse control, outside band |
| clbg-k-nucleotide | C++ | u32-r64-bounds-plain | 7805117 | 7805117 | 1.000000 | within band |
| clbg-k-nucleotide | C++ | u32-r32-count-plain | 7805117 | 7805118 | 1.000000 | within band |
| clbg-k-nucleotide | node | u32-r64-bounds-gallop | 36398076 | 35026035 | 0.962305 | JIT spread, informational |
| clbg-k-nucleotide | node | u32-r32-bounds-gallop | 36398076 | 34935848 | 0.959827 | JIT spread, informational |
| clbg-k-nucleotide | node | u32-r64-count-gallop | 36398076 | 35184819 | 0.966667 | JIT spread, informational |
| clbg-k-nucleotide | node | u32-r32-count-gallop | 36398076 | 34795130 | 0.955961 | JIT spread, informational |
| clbg-k-nucleotide | node | u32-r64-bounds-plain | 36398076 | 35517812 | 0.975816 | JIT spread, informational |
| clbg-k-nucleotide | node | u32-r32-count-plain | 36398076 | 34986101 | 0.961207 | JIT spread, informational |
| map-entries-top-k | C++ | u32-r64-bounds-gallop | 376413 | 376217 | 0.999479 | lower control, outside band |
| map-entries-top-k | C++ | u32-r32-bounds-gallop | 376413 | 376413 | 1.000000 | within band |
| map-entries-top-k | C++ | u32-r64-count-gallop | 376413 | 376623 | 1.000558 | worse control, outside band |
| map-entries-top-k | C++ | u32-r32-count-gallop | 376413 | 376406 | 0.999981 | within band |
| map-entries-top-k | C++ | u32-r64-bounds-plain | 376413 | 375945 | 0.998757 | lower control, outside band |
| map-entries-top-k | C++ | u32-r32-count-plain | 376413 | 376575 | 1.000430 | worse control, outside band |
| map-entries-top-k | node | u32-r64-bounds-gallop | 778585 | 692655 | 0.889633 | JIT spread, informational |
| map-entries-top-k | node | u32-r32-bounds-gallop | 778585 | 697684 | 0.896092 | JIT spread, informational |
| map-entries-top-k | node | u32-r64-count-gallop | 778585 | 893685 | 1.147832 | JIT spread, informational |
| map-entries-top-k | node | u32-r32-count-gallop | 778585 | 729764 | 0.937295 | JIT spread, informational |
| map-entries-top-k | node | u32-r64-bounds-plain | 778585 | 902139 | 1.158690 | JIT spread, informational |
| map-entries-top-k | node | u32-r32-count-plain | 778585 | 694680 | 0.892234 | JIT spread, informational |
| sort-objects | C++ | u32-r64-bounds-gallop | 733449 | 733449 | 1.000000 | within band |
| sort-objects | C++ | u32-r32-bounds-gallop | 733449 | 733449 | 1.000000 | within band |
| sort-objects | C++ | u32-r64-count-gallop | 733449 | 733449 | 1.000000 | within band |
| sort-objects | C++ | u32-r32-count-gallop | 733449 | 733449 | 1.000000 | within band |
| sort-objects | C++ | u32-r64-bounds-plain | 733449 | 733449 | 1.000000 | within band |
| sort-objects | C++ | u32-r32-count-plain | 733449 | 733449 | 1.000000 | within band |
| sort-objects | node | u32-r64-bounds-gallop | 1497315 | 1496679 | 0.999575 | JIT spread, informational |
| sort-objects | node | u32-r32-bounds-gallop | 1497315 | 1677825 | 1.120556 | JIT spread, informational |
| sort-objects | node | u32-r64-count-gallop | 1497315 | 1505018 | 1.005145 | JIT spread, informational |
| sort-objects | node | u32-r32-count-gallop | 1497315 | 1498341 | 1.000685 | JIT spread, informational |
| sort-objects | node | u32-r64-bounds-plain | 1497315 | 1677510 | 1.120345 | JIT spread, informational |
| sort-objects | node | u32-r32-count-plain | 1497315 | 1491177 | 0.995901 | JIT spread, informational |
| sort-objects-runs | C++ | u32-r64-bounds-gallop | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | C++ | u32-r32-bounds-gallop | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | C++ | u32-r64-count-gallop | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | C++ | u32-r32-count-gallop | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | C++ | u32-r64-bounds-plain | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | C++ | u32-r32-count-plain | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | node | u32-r64-bounds-gallop | 1562565 | 1554658 | 0.994940 | JIT spread, informational |
| sort-objects-runs | node | u32-r32-bounds-gallop | 1562565 | 1358899 | 0.869659 | JIT spread, informational |
| sort-objects-runs | node | u32-r64-count-gallop | 1562565 | 1734147 | 1.109808 | JIT spread, informational |
| sort-objects-runs | node | u32-r32-count-gallop | 1562565 | 1557286 | 0.996622 | JIT spread, informational |
| sort-objects-runs | node | u32-r64-bounds-plain | 1562565 | 1554370 | 0.994755 | JIT spread, informational |
| sort-objects-runs | node | u32-r32-count-plain | 1562565 | 1563242 | 1.000433 | JIT spread, informational |
| sort-objects-shuffled | C++ | u32-r64-bounds-gallop | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | C++ | u32-r32-bounds-gallop | 855387 | 855385 | 0.999998 | within band |
| sort-objects-shuffled | C++ | u32-r64-count-gallop | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | C++ | u32-r32-count-gallop | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | C++ | u32-r64-bounds-plain | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | C++ | u32-r32-count-plain | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | node | u32-r64-bounds-gallop | 4541688 | 6585620 | 1.450038 | JIT spread, informational |
| sort-objects-shuffled | node | u32-r32-bounds-gallop | 4541688 | 6507890 | 1.432923 | JIT spread, informational |
| sort-objects-shuffled | node | u32-r64-count-gallop | 4541688 | 11818419 | 2.602208 | JIT spread, informational |
| sort-objects-shuffled | node | u32-r32-count-gallop | 4541688 | 11858302 | 2.610990 | JIT spread, informational |
| sort-objects-shuffled | node | u32-r64-bounds-plain | 4541688 | 6010823 | 1.323478 | JIT spread, informational |
| sort-objects-shuffled | node | u32-r32-count-plain | 4541688 | 5946286 | 1.309268 | JIT spread, informational |
| string-sort-control | C++ | u32-r64-bounds-gallop | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | C++ | u32-r32-bounds-gallop | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | C++ | u32-r64-count-gallop | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | C++ | u32-r32-count-gallop | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | C++ | u32-r64-bounds-plain | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | C++ | u32-r32-count-plain | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | node | u32-r64-bounds-gallop | 5802 | 5842 | 1.006894 | JIT spread, informational |
| string-sort-control | node | u32-r32-bounds-gallop | 5802 | 330 | 0.056877 | JIT spread, informational |
| string-sort-control | node | u32-r64-count-gallop | 5802 | 5680 | 0.978973 | JIT spread, informational |
| string-sort-control | node | u32-r32-count-gallop | 5802 | 29573 | 5.097036 | JIT spread, informational |
| string-sort-control | node | u32-r64-bounds-plain | 5802 | 9580 | 1.651155 | JIT spread, informational |
| string-sort-control | node | u32-r32-count-plain | 5802 | 6152 | 1.060324 | JIT spread, informational |

### Observable comparator work

The C and LLVM instrumented comparator counts and checksums agree exactly
for each arm. Element counts are all element-sorts in one work call:
4,096 for object rows, six for the string control. Width and insertion
search controls preserve comparator calls; changing run policy can change
them, within the implementation-defined sort comparison sequence.

| Row | Arm | Calls | Calls / element | / original calls |
|---|---|---:|---:|---:|
| sort-objects | u32-r64-bounds-gallop | 5545 | 1.353760 | 0.324250 |
| sort-objects-shuffled | u32-r64-bounds-gallop | 27595 | 6.737061 | 1.000109 |
| sort-objects-runs | u32-r64-bounds-gallop | 4556 | 1.112305 | 0.246644 |
| string-sort-control | u32-r64-bounds-gallop | 10 | 1.666667 | 0.909091 |
| sort-objects | u32-r32-bounds-gallop | 5561 | 1.357666 | 0.325186 |
| sort-objects-shuffled | u32-r32-bounds-gallop | 27919 | 6.816162 | 1.011851 |
| sort-objects-runs | u32-r32-bounds-gallop | 4435 | 1.082764 | 0.240093 |
| string-sort-control | u32-r32-bounds-gallop | 10 | 1.666667 | 0.909091 |
| sort-objects | u32-r64-count-gallop | 5545 | 1.353760 | 0.324250 |
| sort-objects-shuffled | u32-r64-count-gallop | 27595 | 6.737061 | 1.000109 |
| sort-objects-runs | u32-r64-count-gallop | 4556 | 1.112305 | 0.246644 |
| string-sort-control | u32-r64-count-gallop | 10 | 1.666667 | 0.909091 |
| sort-objects | u32-r32-count-gallop | 5561 | 1.357666 | 0.325186 |
| sort-objects-shuffled | u32-r32-count-gallop | 27919 | 6.816162 | 1.011851 |
| sort-objects-runs | u32-r32-count-gallop | 4435 | 1.082764 | 0.240093 |
| string-sort-control | u32-r32-count-gallop | 10 | 1.666667 | 0.909091 |
| sort-objects | u32-r64-bounds-plain | 5545 | 1.353760 | 0.324250 |
| sort-objects-shuffled | u32-r64-bounds-plain | 27558 | 6.728027 | 0.998768 |
| sort-objects-runs | u32-r64-bounds-plain | 7302 | 1.782715 | 0.395301 |
| string-sort-control | u32-r64-bounds-plain | 10 | 1.666667 | 0.909091 |
| sort-objects | u32-r32-count-plain | 5561 | 1.357666 | 0.325186 |
| sort-objects-shuffled | u32-r32-count-plain | 27878 | 6.806152 | 1.010365 |
| sort-objects-runs | u32-r32-count-plain | 7188 | 1.754883 | 0.389129 |
| string-sort-control | u32-r32-count-plain | 10 | 1.666667 | 0.909091 |

### One locked sitting: all eight variants

CPU 4, sibling 5 idle; six invocations in alternating variant order per
row, medians of each harness's best-five result, shipping flags and RC.
Checksums agree across every variant. All attempts are checkpointed before
checking sibling activity. The table retains every arm and losing ratio.
The 3% labels describe wall-time movement; they are distinct from the
0.01% instruction band. Engine acceptance is a separate full-memory
sitting. Times and ratios must not be compared across sittings.

| Row | Backend | Arm | µs | / original | / u32 reference | Verdict vs original |
|---|---|---|---:|---:|---:|---|
| sort-objects | C | main | 57.278342 | 1.000000 | 2.046395 | within 3% |
| sort-objects | C | i64-r64-bounds-gallop | 28.297474 | 0.494034 | 1.010990 | gain |
| sort-objects | C | u32-r64-bounds-gallop | 27.989877 | 0.488664 | 1.000000 | gain |
| sort-objects | C | u32-r32-bounds-gallop | 28.028801 | 0.489344 | 1.001391 | gain |
| sort-objects | C | u32-r64-count-gallop | 28.004918 | 0.488927 | 1.000537 | gain |
| sort-objects | C | u32-r32-count-gallop | 28.082786 | 0.490286 | 1.003319 | gain |
| sort-objects | C | u32-r64-bounds-plain | 30.514756 | 0.532745 | 1.090207 | gain |
| sort-objects | C | u32-r32-count-plain | 31.697945 | 0.553402 | 1.132479 | gain |
| sort-objects | LLVM | main | 61.240006 | 1.000000 | 2.217957 | within 3% |
| sort-objects | LLVM | i64-r64-bounds-gallop | 29.890653 | 0.488090 | 1.082563 | gain |
| sort-objects | LLVM | u32-r64-bounds-gallop | 27.610993 | 0.450865 | 1.000000 | gain |
| sort-objects | LLVM | u32-r32-bounds-gallop | 27.911065 | 0.455765 | 1.010868 | gain |
| sort-objects | LLVM | u32-r64-count-gallop | 28.048471 | 0.458009 | 1.015844 | gain |
| sort-objects | LLVM | u32-r32-count-gallop | 27.949403 | 0.456391 | 1.012256 | gain |
| sort-objects | LLVM | u32-r64-bounds-plain | 31.344432 | 0.511829 | 1.135216 | gain |
| sort-objects | LLVM | u32-r32-count-plain | 32.232373 | 0.526329 | 1.167375 | gain |
| sort-objects-shuffled | C | main | 184.253735 | 1.000000 | 1.037859 | within 3% |
| sort-objects-shuffled | C | i64-r64-bounds-gallop | 182.776633 | 0.991983 | 1.029538 | within 3% |
| sort-objects-shuffled | C | u32-r64-bounds-gallop | 177.532611 | 0.963522 | 1.000000 | gain |
| sort-objects-shuffled | C | u32-r32-bounds-gallop | 167.086063 | 0.906826 | 0.941157 | gain |
| sort-objects-shuffled | C | u32-r64-count-gallop | 183.618586 | 0.996553 | 1.034281 | within 3% |
| sort-objects-shuffled | C | u32-r32-count-gallop | 175.188034 | 0.950798 | 0.986794 | gain |
| sort-objects-shuffled | C | u32-r64-bounds-plain | 176.320715 | 0.956945 | 0.993174 | gain |
| sort-objects-shuffled | C | u32-r32-count-plain | 171.598275 | 0.931315 | 0.966573 | gain |
| sort-objects-shuffled | LLVM | main | 183.435795 | 1.000000 | 1.004235 | within 3% |
| sort-objects-shuffled | LLVM | i64-r64-bounds-gallop | 187.967788 | 1.024706 | 1.029046 | within 3% |
| sort-objects-shuffled | LLVM | u32-r64-bounds-gallop | 182.662131 | 0.995782 | 1.000000 | within 3% |
| sort-objects-shuffled | LLVM | u32-r32-bounds-gallop | 175.414533 | 0.956272 | 0.960322 | gain |
| sort-objects-shuffled | LLVM | u32-r64-count-gallop | 182.908737 | 0.997127 | 1.001350 | within 3% |
| sort-objects-shuffled | LLVM | u32-r32-count-gallop | 177.914195 | 0.969899 | 0.974007 | gain |
| sort-objects-shuffled | LLVM | u32-r64-bounds-plain | 181.425547 | 0.989041 | 0.993230 | within 3% |
| sort-objects-shuffled | LLVM | u32-r32-count-plain | 179.764499 | 0.979986 | 0.984137 | within 3% |
| sort-objects-runs | C | main | 67.918356 | 1.000000 | 1.745072 | within 3% |
| sort-objects-runs | C | i64-r64-bounds-gallop | 39.180940 | 0.576883 | 1.006702 | gain |
| sort-objects-runs | C | u32-r64-bounds-gallop | 38.920083 | 0.573042 | 1.000000 | gain |
| sort-objects-runs | C | u32-r32-bounds-gallop | 39.110354 | 0.575844 | 1.004889 | gain |
| sort-objects-runs | C | u32-r64-count-gallop | 38.481428 | 0.566584 | 0.988729 | gain |
| sort-objects-runs | C | u32-r32-count-gallop | 38.231394 | 0.562902 | 0.982305 | gain |
| sort-objects-runs | C | u32-r64-bounds-plain | 47.905849 | 0.705345 | 1.230877 | gain |
| sort-objects-runs | C | u32-r32-count-plain | 47.596559 | 0.700791 | 1.222931 | gain |
| sort-objects-runs | LLVM | main | 67.453974 | 1.000000 | 1.763901 | within 3% |
| sort-objects-runs | LLVM | i64-r64-bounds-gallop | 39.620209 | 0.587367 | 1.036056 | gain |
| sort-objects-runs | LLVM | u32-r64-bounds-gallop | 38.241371 | 0.566925 | 1.000000 | gain |
| sort-objects-runs | LLVM | u32-r32-bounds-gallop | 37.989650 | 0.563194 | 0.993418 | gain |
| sort-objects-runs | LLVM | u32-r64-count-gallop | 38.103189 | 0.564877 | 0.996387 | gain |
| sort-objects-runs | LLVM | u32-r32-count-gallop | 38.160544 | 0.565727 | 0.997886 | gain |
| sort-objects-runs | LLVM | u32-r64-bounds-plain | 48.668637 | 0.721509 | 1.272670 | gain |
| sort-objects-runs | LLVM | u32-r32-count-plain | 48.326707 | 0.716440 | 1.263728 | gain |
| map-entries-top-k | C | main | 17.137533 | 1.000000 | 1.026694 | within 3% |
| map-entries-top-k | C | i64-r64-bounds-gallop | 16.576898 | 0.967286 | 0.993106 | gain |
| map-entries-top-k | C | u32-r64-bounds-gallop | 16.691966 | 0.974001 | 1.000000 | within 3% |
| map-entries-top-k | C | u32-r32-bounds-gallop | 16.491570 | 0.962307 | 0.987994 | gain |
| map-entries-top-k | C | u32-r64-count-gallop | 16.768038 | 0.978439 | 1.004557 | within 3% |
| map-entries-top-k | C | u32-r32-count-gallop | 16.422242 | 0.958262 | 0.983841 | gain |
| map-entries-top-k | C | u32-r64-bounds-plain | 16.259936 | 0.948791 | 0.974117 | gain |
| map-entries-top-k | C | u32-r32-count-plain | 16.145848 | 0.942134 | 0.967283 | gain |
| map-entries-top-k | LLVM | main | 17.388525 | 1.000000 | 1.009695 | within 3% |
| map-entries-top-k | LLVM | i64-r64-bounds-gallop | 17.816946 | 1.024638 | 1.034573 | within 3% |
| map-entries-top-k | LLVM | u32-r64-bounds-gallop | 17.221554 | 0.990398 | 1.000000 | within 3% |
| map-entries-top-k | LLVM | u32-r32-bounds-gallop | 16.946016 | 0.974552 | 0.984000 | within 3% |
| map-entries-top-k | LLVM | u32-r64-count-gallop | 17.406807 | 1.001051 | 1.010757 | within 3% |
| map-entries-top-k | LLVM | u32-r32-count-gallop | 17.051089 | 0.980594 | 0.990102 | within 3% |
| map-entries-top-k | LLVM | u32-r64-bounds-plain | 16.909823 | 0.972470 | 0.981899 | within 3% |
| map-entries-top-k | LLVM | u32-r32-count-plain | 16.802292 | 0.966286 | 0.975655 | gain |
| string-sort-control | C | main | 0.128380 | 1.000000 | 1.143609 | within 3% |
| string-sort-control | C | i64-r64-bounds-gallop | 0.111294 | 0.866910 | 0.991406 | gain |
| string-sort-control | C | u32-r64-bounds-gallop | 0.112259 | 0.874425 | 1.000000 | gain |
| string-sort-control | C | u32-r32-bounds-gallop | 0.112319 | 0.874896 | 1.000539 | gain |
| string-sort-control | C | u32-r64-count-gallop | 0.108158 | 0.842479 | 0.963467 | gain |
| string-sort-control | C | u32-r32-count-gallop | 0.108630 | 0.846158 | 0.967674 | gain |
| string-sort-control | C | u32-r64-bounds-plain | 0.110875 | 0.863647 | 0.987674 | gain |
| string-sort-control | C | u32-r32-count-plain | 0.108022 | 0.841420 | 0.962256 | gain |
| string-sort-control | LLVM | main | 0.130451 | 1.000000 | 1.207521 | within 3% |
| string-sort-control | LLVM | i64-r64-bounds-gallop | 0.110105 | 0.844038 | 1.019193 | gain |
| string-sort-control | LLVM | u32-r64-bounds-gallop | 0.108032 | 0.828143 | 1.000000 | gain |
| string-sort-control | LLVM | u32-r32-bounds-gallop | 0.107104 | 0.821029 | 0.991409 | gain |
| string-sort-control | LLVM | u32-r64-count-gallop | 0.109231 | 0.837333 | 1.011097 | gain |
| string-sort-control | LLVM | u32-r32-count-gallop | 0.109893 | 0.842408 | 1.017225 | gain |
| string-sort-control | LLVM | u32-r64-bounds-plain | 0.108288 | 0.830104 | 1.002368 | gain |
| string-sort-control | LLVM | u32-r32-count-plain | 0.106102 | 0.813347 | 0.982133 | gain |
| array-copying-methods | C | main | 22.993489 | 1.000000 | 0.995877 | within 3% |
| array-copying-methods | C | i64-r64-bounds-gallop | 23.211152 | 1.009466 | 1.005304 | within 3% |
| array-copying-methods | C | u32-r64-bounds-gallop | 23.088693 | 1.004141 | 1.000000 | within 3% |
| array-copying-methods | C | u32-r32-bounds-gallop | 23.132264 | 1.006035 | 1.001887 | within 3% |
| array-copying-methods | C | u32-r64-count-gallop | 22.935465 | 0.997477 | 0.993364 | within 3% |
| array-copying-methods | C | u32-r32-count-gallop | 23.039502 | 1.002001 | 0.997869 | within 3% |
| array-copying-methods | C | u32-r64-bounds-plain | 23.028458 | 1.001521 | 0.997391 | within 3% |
| array-copying-methods | C | u32-r32-count-plain | 22.951085 | 0.998156 | 0.994040 | within 3% |
| array-copying-methods | LLVM | main | 22.682095 | 1.000000 | 0.996738 | within 3% |
| array-copying-methods | LLVM | i64-r64-bounds-gallop | 22.592925 | 0.996069 | 0.992819 | within 3% |
| array-copying-methods | LLVM | u32-r64-bounds-gallop | 22.756334 | 1.003273 | 1.000000 | within 3% |
| array-copying-methods | LLVM | u32-r32-bounds-gallop | 22.618751 | 0.997207 | 0.993954 | within 3% |
| array-copying-methods | LLVM | u32-r64-count-gallop | 22.608650 | 0.996762 | 0.993510 | within 3% |
| array-copying-methods | LLVM | u32-r32-count-gallop | 22.554161 | 0.994360 | 0.991116 | within 3% |
| array-copying-methods | LLVM | u32-r64-bounds-plain | 22.772553 | 1.003988 | 1.000713 | within 3% |
| array-copying-methods | LLVM | u32-r32-count-plain | 22.858498 | 1.007777 | 1.004489 | within 3% |

### Matched factor ratios

Each cell is the named change divided by its otherwise matched control.
Galloping ratios are enabled / disabled. Values above one lose time.

| Row | Backend | u32 / i64 | r32 / r64 | count / bounds at r64 | r32 / r64 with count | count / bounds at r32 | galloping at reference | galloping at r32/count |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| sort-objects | nts | 0.989130 | 1.001391 | 1.000537 | 1.002780 | 1.001926 | 0.917257 | 0.885950 |
| sort-objects | ntsllvm | 0.923733 | 1.010868 | 1.015844 | 0.996468 | 1.001374 | 0.880890 | 0.867122 |
| sort-objects-shuffled | nts | 0.971309 | 0.941157 | 1.034281 | 0.954087 | 1.048490 | 1.006873 | 1.020920 |
| sort-objects-shuffled | ntsllvm | 0.971774 | 0.960322 | 1.001350 | 0.972694 | 1.014250 | 1.006816 | 0.989707 |
| sort-objects-runs | nts | 0.993342 | 1.004889 | 0.988729 | 0.993502 | 0.977526 | 0.812429 | 0.803239 |
| sort-objects-runs | ntsllvm | 0.965199 | 0.993418 | 0.996387 | 1.001505 | 1.004498 | 0.785750 | 0.789637 |
| map-entries-top-k | nts | 1.006941 | 0.987994 | 1.004557 | 0.979378 | 0.995796 | 1.026570 | 1.017119 |
| map-entries-top-k | ntsllvm | 0.966583 | 0.984000 | 1.010757 | 0.979564 | 1.006200 | 1.018435 | 1.014807 |
| string-sort-control | nts | 1.008668 | 1.000539 | 0.963467 | 1.004366 | 0.967153 | 1.012479 | 1.005631 |
| string-sort-control | ntsllvm | 0.981168 | 0.991409 | 1.011097 | 1.006061 | 1.026040 | 0.997637 | 1.035731 |
| array-copying-methods | nts | 0.994724 | 1.001887 | 0.993364 | 1.004536 | 0.995990 | 1.002616 | 1.003852 |
| array-copying-methods | ntsllvm | 1.007233 | 0.993954 | 0.993510 | 0.997590 | 0.997144 | 0.999288 | 0.986686 |

| Row | Backend | Accepted attempt | CPU-5 user+nice ticks before → after | Load before → after | Available GiB before → after |
|---|---|---:|---|---|---|
| sort-objects | nts | 1 | 8584 → 8584 | 13.29 → 12.80 | 16.201 → 18.091 |
| sort-objects | ntsllvm | 1 | 8584 → 8584 | 12.80 → 12.56 | 18.096 → 17.869 |
| sort-objects-shuffled | nts | 1 | 8584 → 8584 | 12.56 → 13.65 | 17.870 → 17.408 |
| sort-objects-shuffled | ntsllvm | 1 | 8584 → 8584 | 13.65 → 13.42 | 17.412 → 16.717 |
| sort-objects-runs | nts | 1 | 8584 → 8584 | 13.42 → 14.53 | 16.728 → 16.186 |
| sort-objects-runs | ntsllvm | 1 | 8584 → 8584 | 14.53 → 13.79 | 16.167 → 16.142 |
| map-entries-top-k | nts | 1 | 8584 → 8584 | 13.79 → 14.05 | 16.148 → 16.340 |
| map-entries-top-k | ntsllvm | 1 | 8584 → 8584 | 14.05 → 13.50 | 16.347 → 16.669 |
| string-sort-control | nts | 1 | 8584 → 8584 | 13.50 → 13.14 | 16.669 → 17.751 |
| string-sort-control | ntsllvm | 1 | 8584 → 8584 | 13.14 → 12.89 | 17.751 → 17.257 |
| array-copying-methods | nts | 1 | 8584 → 8584 | 12.89 → 12.31 | 17.257 → 19.033 |
| array-copying-methods | ntsllvm | 1 | 8584 → 8584 | 12.31 → 9.86 | 19.033 → 19.643 |

### Branch and stall counters from the same sitting

All eight binaries then run hardware-stat groups and cycle sampling under
the same reservation. Whole-harness counters include setup/calibration.
Stall/recovery percentages overlap and must not be added together.

| Row | Backend | Arm | IPC | Misses / 1k instructions | Stall cycles % | Recovery cycles % | Group running % | Sibling condition |
|---|---|---|---:|---:|---:|---:|---:|---|
| map-entries-top-k | nts | i64-r64-bounds-gallop | 4.501 | 0.101 | 6.653 | 0.373 | 100 | idle |
| map-entries-top-k | nts | main | 4.569 | 0.129 | 6.464 | 0.468 | 100 | idle |
| map-entries-top-k | nts | u32-r32-bounds-gallop | 4.534 | 0.115 | 6.995 | 0.406 | 100 | idle |
| map-entries-top-k | nts | u32-r32-count-gallop | 4.539 | 0.112 | 6.737 | 0.392 | 100 | idle |
| map-entries-top-k | nts | u32-r32-count-plain | 4.562 | 0.117 | 6.573 | 0.378 | 100 | idle |
| map-entries-top-k | nts | u32-r64-bounds-gallop | 4.421 | 0.136 | 7.248 | 0.459 | 100 | idle |
| map-entries-top-k | nts | u32-r64-bounds-plain | 4.420 | 0.119 | 7.304 | 0.388 | 100 | idle |
| map-entries-top-k | nts | u32-r64-count-gallop | 4.449 | 0.122 | 6.982 | 0.421 | 100 | idle |
| map-entries-top-k | ntsllvm | i64-r64-bounds-gallop | 4.358 | 0.100 | 7.191 | 0.339 | 100 | idle |
| map-entries-top-k | ntsllvm | main | 4.554 | 0.116 | 6.540 | 0.380 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r32-bounds-gallop | 4.419 | 0.113 | 7.488 | 0.399 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r32-count-gallop | 4.424 | 0.125 | 7.177 | 0.385 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r32-count-plain | 4.394 | 0.125 | 7.139 | 0.384 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r64-bounds-gallop | 4.319 | 0.130 | 7.562 | 0.408 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r64-bounds-plain | 4.347 | 0.109 | 7.432 | 0.389 | 100 | idle |
| map-entries-top-k | ntsllvm | u32-r64-count-gallop | 4.398 | 0.107 | 7.136 | 0.349 | 100 | idle |
| sort-objects | nts | i64-r64-bounds-gallop | 3.118 | 0.223 | 18.595 | 0.384 | 100 | idle |
| sort-objects | nts | main | 4.645 | 0.266 | 9.919 | 0.654 | 100 | idle |
| sort-objects | nts | u32-r32-bounds-gallop | 3.128 | 0.262 | 18.883 | 0.440 | 100 | idle |
| sort-objects | nts | u32-r32-count-gallop | 3.125 | 0.222 | 18.987 | 0.399 | 100 | idle |
| sort-objects | nts | u32-r32-count-plain | 2.759 | 0.226 | 23.518 | 0.345 | 100 | idle |
| sort-objects | nts | u32-r64-bounds-gallop | 3.081 | 0.269 | 19.096 | 0.464 | 100 | idle |
| sort-objects | nts | u32-r64-bounds-plain | 2.836 | 0.220 | 22.835 | 0.347 | 100 | idle |
| sort-objects | nts | u32-r64-count-gallop | 3.111 | 0.229 | 18.964 | 0.390 | 100 | idle |
| sort-objects | ntsllvm | i64-r64-bounds-gallop | 3.206 | 0.216 | 17.834 | 0.384 | 100 | idle |
| sort-objects | ntsllvm | main | 4.549 | 0.274 | 10.131 | 0.703 | 100 | idle |
| sort-objects | ntsllvm | u32-r32-bounds-gallop | 3.218 | 0.194 | 18.881 | 0.357 | 100 | idle |
| sort-objects | ntsllvm | u32-r32-count-gallop | 3.246 | 0.194 | 18.549 | 0.349 | 100 | idle |
| sort-objects | ntsllvm | u32-r32-count-plain | 2.739 | 0.218 | 22.768 | 0.325 | 100 | idle |
| sort-objects | ntsllvm | u32-r64-bounds-gallop | 3.218 | 0.199 | 18.770 | 0.363 | 100 | idle |
| sort-objects | ntsllvm | u32-r64-bounds-plain | 2.827 | 0.212 | 22.079 | 0.322 | 100 | idle |
| sort-objects | ntsllvm | u32-r64-count-gallop | 3.201 | 0.198 | 18.686 | 0.376 | 100 | idle |
| sort-objects-shuffled | nts | i64-r64-bounds-gallop | 1.515 | 11.297 | 29.655 | 10.009 | 100 | idle |
| sort-objects-shuffled | nts | main | 1.894 | 7.435 | 25.734 | 7.861 | 100 | idle |
| sort-objects-shuffled | nts | u32-r32-bounds-gallop | 1.648 | 8.845 | 26.146 | 7.644 | 100 | idle |
| sort-objects-shuffled | nts | u32-r32-count-gallop | 1.578 | 10.045 | 26.147 | 8.920 | 100 | idle |
| sort-objects-shuffled | nts | u32-r32-count-plain | 1.498 | 4.462 | 33.993 | 4.017 | 100 | idle |
| sort-objects-shuffled | nts | u32-r64-bounds-gallop | 1.506 | 10.730 | 28.098 | 9.080 | 100 | idle |
| sort-objects-shuffled | nts | u32-r64-bounds-plain | 1.420 | 7.249 | 34.128 | 6.555 | 100 | idle |
| sort-objects-shuffled | nts | u32-r64-count-gallop | 1.477 | 11.722 | 28.543 | 10.609 | 100 | idle |
| sort-objects-shuffled | ntsllvm | i64-r64-bounds-gallop | 1.833 | 8.017 | 23.923 | 8.270 | 100 | idle |
| sort-objects-shuffled | ntsllvm | main | 1.942 | 7.363 | 22.010 | 8.006 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r32-bounds-gallop | 1.712 | 8.313 | 24.061 | 7.884 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r32-count-gallop | 1.688 | 8.544 | 25.108 | 7.611 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r32-count-plain | 1.554 | 3.749 | 32.574 | 3.488 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r64-bounds-gallop | 1.579 | 9.896 | 26.295 | 9.307 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r64-bounds-plain | 1.515 | 6.048 | 32.437 | 5.747 | 100 | idle |
| sort-objects-shuffled | ntsllvm | u32-r64-count-gallop | 1.609 | 9.726 | 26.909 | 8.768 | 100 | idle |

### Count operations remain at the argued floor

The first operation-driver compilation stopped before execution because
the archive did not include the bundled `zmij` directory. The corrected
command adds the existing support include directory and first checks that
its runtime C/header bytes match every archived arm. Both driver scripts
and the failed compilation log are retained.

All six arms on both backends return checksum 66,980,960 with exactly
4,096 retains, 4,387 releases, 298 allocations, zero live allocations and
zero live bytes. The 4,096 element-sorts each retain one immutable snapshot
edge to anchor arbitrary callbacks; permutation and unchanged-prefix
write-back perform no element count moves. Width/minrun/search/galloping
change comparisons and native work, not managed ownership traffic.

### Raw evidence

All paths below are relative to
`/home/akisarou/.cache/nts-scratch/876/`. The evidence manifest names and
hashes every source arm, count log, comparator census, archived provenance,
operation count and timing/perf observation, including failed attempts.
It is raw scratch evidence, not a published benchmark run record.

Manifest: `/home/akisarou/.cache/nts-scratch/876/policy-evidence.json`, SHA-256 `4339d31c702b5a4eddffed23ed14341f0347b1533f4c1a616ec2154834665abb`.

## Selected policy

The selected arm is `u32-r32-bounds-gallop`: u32 ordinary cursors with
exclusive backward ends, widened i64 power coordinates, minrun normalization
at 32 (16–32 elements), bounds-based binary insertion and adaptive galloping.
No counterfactual switches or disabled code remain in the selected source.

In the matched sitting it runs sort-objects at 0.489344× original on C and
0.455765× on LLVM; shuffled at 0.906826× / 0.956272×; the two-run control
at 0.575844× / 0.563194×; map at 0.962307× / 0.974552×; and strings at
0.874896× / 0.821029×. The unchanged array-copy control is 1.006035× /
0.997207×, within the descriptive 3% timing band. Every selected native
instruction row improves or remains within its 0.01% band.

Minrun 32 wins shuffled by 5.9% C and 4.0% LLVM against the otherwise
matched u32/r64 reference, while other guards stay within 3%. Count-based
insertion has no consistent gain over bounds-based insertion and loses
shuffled versus the matched bounds search. Galloping remains because it
moves the partially ordered row: enabling it at r64 gives 0.812429× C
and 0.785750× LLVM versus plain merging. Its shuffled and map rows remain
within the 3% band against the plain control. The selected r32 arm further
improves the shuffled and map guards.

Instruction reductions do not imply proportional wall gains. In shuffled
LLVM, narrowing alone reduces instructions by about 15%, but IPC drops
from 1.833 to 1.579 and stall cycles rise from 23.923% to 26.295%; its wall
ratio against the i64 kernel is only 0.971774×. R32 bounds search raises IPC
to 1.712, lowers stalls to 24.061% and recovery cycles from 9.307% to 7.884%.
C shows the same benefit from shorter insertion runs: IPC 1.506→1.648,
stalls 28.098%→26.146%, recovery 9.080%→7.644%. The plain r64 arm has fewer
branch misses but more stalled cycles (34.128% C, 32.437% LLVM), so branch
misses alone do not explain the wall-time ordering. Map branch-miss rates
remain tiny; reduced native work is its main improvement.

## Full-memory instruction census before JVM correction

Selected source at `a2d395798d92e0f3bdebf098f3d28a9894a6f6d6`, pinned
Node v26.13.0, shipping native flags and RC, calibrated net user instructions
per work call on CPU 0 outside CPUs 4–5 without the measurement lock. The
18 memory rows and k-nucleotide run in one census. The native instruction
band is 0.01%; JIT spread is informational. Filtered JVM, Java, Bun and
ScriptC count columns were not requested. Every final native ELF for the
seven changed/control rows is byte-identical to the selected policy arm
in the eight-variant timing matrix.

Restoring a saved source initially preserved its old timestamp, and Cargo
reused the last plain-control artifacts. This was caught before any final
measurement. The source timestamp was refreshed and a real all-workspace
release build completed; both the cached-build log and fresh-build log are
retained. The final native ELF identity checks prove which policy ran.

| Row | Backend | Original | Final | / original | Verdict |
|---|---|---:|---:|---:|---|
| array-copying-methods | C | 482832 | 482832 | 1.000000 | within band |
| array-copying-methods | LLVM | 538832 | 538832 | 1.000000 | within band |
| awfy-towers | C | 941646 | 941646 | 1.000000 | within band |
| awfy-towers | LLVM | 908822 | 908821 | 0.999999 | within band |
| clbg-k-nucleotide | C | 17432320 | 17425096 | 0.999586 | gain |
| clbg-k-nucleotide | LLVM | 17424398 | 17417471 | 0.999602 | gain |
| cyclic-churn | C | 2375872 | 2375872 | 1.000000 | within band |
| cyclic-churn | LLVM | 2377860 | 2377856 | 0.999998 | within band |
| event-state | C | 1700 | 1700 | 1.000000 | within band |
| event-state | LLVM | 1698 | 1698 | 1.000000 | within band |
| immutable-update | C | 2031897 | 2031902 | 1.000002 | within band |
| immutable-update | LLVM | 2033945 | 2033945 | 1.000000 | within band |
| json-build-append | C | 222777 | 222777 | 1.000000 | within band |
| json-build-append | LLVM | 222778 | 222777 | 0.999996 | within band |
| json-stringify-doc | C | 27212376 | 27212310 | 0.999998 | within band |
| json-stringify-doc | LLVM | 27037193 | 27037191 | 1.000000 | within band |
| map-entries-top-k | C | 414057 | 390131 | 0.942216 | gain |
| map-entries-top-k | LLVM | 415503 | 396487 | 0.954234 | gain |
| module-loop-retained | C | 262197 | 262197 | 1.000000 | within band |
| module-loop-retained | LLVM | 262197 | 262197 | 1.000000 | within band |
| objects | C | 27684 | 27684 | 1.000000 | within band |
| objects | LLVM | 27684 | 27684 | 1.000000 | within band |
| pipeline | C | 239558 | 239558 | 1.000000 | within band |
| pipeline | LLVM | 239555 | 239558 | 1.000013 | within band |
| record-word-counts | C | 152641 | 152641 | 1.000000 | within band |
| record-word-counts | LLVM | 154112 | 154112 | 1.000000 | within band |
| release-acyclic | C | 1832669 | 1832669 | 1.000000 | within band |
| release-acyclic | LLVM | 1832669 | 1832669 | 1.000000 | within band |
| sort-objects | C | 1411192 | 474029 | 0.335907 | gain |
| sort-objects | LLVM | 1501920 | 487311 | 0.324459 | gain |
| sort-objects-runs | C | 1672921 | 670811 | 0.400982 | gain |
| sort-objects-runs | LLVM | 1723222 | 678313 | 0.393631 | gain |
| sort-objects-shuffled | C | 1829354 | 1461009 | 0.798648 | gain |
| sort-objects-shuffled | LLVM | 1877546 | 1568980 | 0.835655 | gain |
| string-sort-control | C | 2995 | 2392 | 0.798664 | gain |
| string-sort-control | LLVM | 3077 | 2443 | 0.793955 | gain |
| tree-teardown | C | 597515 | 597515 | 1.000000 | within band |
| tree-teardown | LLVM | 597516 | 597516 | 1.000000 | within band |

| Row | Control | Original | Final | / original | Condition/verdict |
|---|---|---:|---:|---:|---|
| array-copying-methods | C++ | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | node | 2318228 | 2310306 | 0.996583 | JIT spread, informational |
| awfy-towers | C++ | 347328 | 347328 | 1.000000 | within band |
| awfy-towers | node | 1148510 | 1148562 | 1.000045 | JIT spread, informational |
| clbg-k-nucleotide | C++ | 7805117 | 7806113 | 1.000128 | worse control, outside band |
| clbg-k-nucleotide | node | 36398076 | 35250861 | 0.968481 | JIT spread, informational |
| cyclic-churn | C++ | 529773 | 529773 | 1.000000 | within band |
| cyclic-churn | node | 282612 | 315264 | 1.115536 | JIT spread, informational |
| event-state | C++ | 13757 | 13757 | 1.000000 | within band |
| event-state | node | 39151 | 39338 | 1.004776 | JIT spread, informational |
| immutable-update | C++ | 557192 | 557192 | 1.000000 | within band |
| immutable-update | node | 2578497 | 3525646 | 1.367326 | JIT spread, informational |
| json-build-append | C++ | -- | -- | — | unavailable |
| json-build-append | node | 823273 | 556326 | 0.675749 | JIT spread, informational |
| json-stringify-doc | C++ | -- | -- | — | unavailable |
| json-stringify-doc | node | 42337038 | 42340883 | 1.000091 | JIT spread, informational |
| map-entries-top-k | C++ | 376413 | 376623 | 1.000558 | worse control, outside band |
| map-entries-top-k | node | 778585 | 903350 | 1.160246 | JIT spread, informational |
| module-loop-retained | C++ | -- | -- | — | unavailable |
| module-loop-retained | node | 136203 | 144513 | 1.061012 | JIT spread, informational |
| objects | C++ | 27659 | 27659 | 1.000000 | within band |
| objects | node | 115007 | 115021 | 1.000122 | JIT spread, informational |
| pipeline | C++ | 232103 | 232103 | 1.000000 | within band |
| pipeline | node | 25135777 | 25252181 | 1.004631 | JIT spread, informational |
| record-word-counts | C++ | 295481 | 295481 | 1.000000 | within band |
| record-word-counts | node | 269972 | 264503 | 0.979742 | JIT spread, informational |
| release-acyclic | C++ | 4230170 | 4230111 | 0.999986 | within band |
| release-acyclic | node | 1840107 | 1312892 | 0.713487 | JIT spread, informational |
| sort-objects | C++ | 733449 | 733449 | 1.000000 | within band |
| sort-objects | node | 1497315 | 1495978 | 0.999107 | JIT spread, informational |
| sort-objects-runs | C++ | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | node | 1562565 | 1555988 | 0.995791 | JIT spread, informational |
| sort-objects-shuffled | C++ | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | node | 4541688 | 11670961 | 2.569741 | JIT spread, informational |
| string-sort-control | C++ | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | node | 5802 | 5937 | 1.023268 | JIT spread, informational |
| tree-teardown | C++ | 3236823 | 3236823 | 1.000000 | within band |
| tree-teardown | node | 1393354 | 1393165 | 0.999864 | JIT spread, informational |

## Failed full-memory timed sitting: JVM method size

This sitting is **failed**, not acceptance evidence. The unchanged cross-backend
work guard marks all four sorting rows INVALID because JVM execution is over
20 times native execution. Map JVM also regresses sharply, without crossing
that guard. No guard or VM policy was changed. All 19 rows are unspoiled.

One locked CPU-4 sitting includes all 18 memory rows and k-nucleotide,
with sibling 5 quiet, shipping native flags and RC, and the pinned Node,
Bun JIT, Bun AOT and ScriptC engines. All rows, losses, unavailable cells,
repeat spreads, load and memory conditions are retained below. Ratios are
within this sitting; no absolute times are compared across sittings.

The automatic results-only commit was dropped from branch 876, and the
immutable JSON lives only in issue scratch. The nightly remains the
publisher of benchmark run records.

### final-bench/sitting.json

Source `a2d395798d92e0f3bdebf098f3d28a9894a6f6d6`; 2026-11-19T17:21:35.798Z to 2026-11-19T17:39:33.340Z.

Times in µs; ratios are native / engine. Verdicts are the tool’s recorded verdicts, including losses and ties.

| Row | Backend | µs | / node | / Bun JIT | / Bun AOT | / ScriptC | Native repeat spread |
|---|---|---:|---:|---:|---:|---:|---:|
| array-copying-methods | nts C | 24.3606 | 0.330 WON | 0.410 WON | 0.453 WON | 0.728 WON | 1.0163× |
| array-copying-methods | nts LLVM | 25.7520 | 0.348 WON | 0.434 WON | 0.479 WON | 0.770 WON | 1.0044× |
| array-copying-methods | nts JVM | 33.3112 | 0.451 WON | 0.561 WON | 0.620 WON | 0.996 TIE | 1.0375× |
| awfy-towers | nts C | 36.9391 | 0.969 SHORT | 1.566 LOSS | 1.003 TIE | 0.382 WON | 1.0266× |
| awfy-towers | nts LLVM | 35.0157 | 0.918 SHORT | 1.484 LOSS | 0.951 TIE | 0.362 WON | 1.0115× |
| awfy-towers | nts JVM | 29.9383 | 0.785 WON | 1.269 LOSS | 0.813 WON | 0.310 WON | 1.0179× |
| clbg-k-nucleotide | nts C | 1072.3869 | 0.576 WON | 0.654 WON | 0.877 WON | 0.910 WON | 1.0155× |
| clbg-k-nucleotide | nts LLVM | 1065.5404 | 0.572 WON | 0.650 WON | 0.871 WON | 0.904 WON | 1.0207× |
| clbg-k-nucleotide | nts JVM | 1218.5394 | 0.655 WON | 0.743 WON | 0.996 TIE | 1.033 TIE | 1.0604× |
| cyclic-churn | nts C | 98.2534 | 9.378 LOSS | 8.728 LOSS | 9.938 LOSS | 1.941 LOSS | 1.0179× |
| cyclic-churn | nts LLVM | 94.8523 | 9.053 LOSS | 8.426 LOSS | 9.594 LOSS | 1.874 LOSS | 1.0779× |
| cyclic-churn | nts JVM | 10.9316 | 1.043 LOSS | 0.971 SHORT | 1.106 LOSS | 0.216 WON | 1.0503× |
| event-state | nts C | 0.1057 | 0.074 WON | 0.623 WON | 0.837 WON | 0.776 WON | 1.0178× |
| event-state | nts LLVM | 0.1081 | 0.076 WON | 0.637 WON | 0.856 WON | 0.793 WON | 1.0137× |
| event-state | nts JVM | 0.1050 | 0.074 WON | 0.619 WON | 0.831 WON | 0.770 WON | 1.0253× |
| immutable-update | nts C | 75.9193 | 0.761 WON | 0.621 WON | 0.773 WON | 2.023 LOSS | 1.0115× |
| immutable-update | nts LLVM | 75.4769 | 0.756 WON | 0.617 WON | 0.768 WON | 2.011 LOSS | 1.0242× |
| immutable-update | nts JVM | 82.7224 | 0.829 SHORT | 0.677 WON | 0.842 WON | 2.204 LOSS | 1.0339× |
| json-build-append | nts C | 8.0048 | 0.534 WON | 1.067 LOSS | 0.480 WON | 0.359 WON | 1.0330× |
| json-build-append | nts LLVM | 8.3837 | 0.559 WON | 1.118 LOSS | 0.503 WON | 0.376 WON | 1.0187× |
| json-build-append | nts JVM | 13.0999 | 0.874 SHORT | 1.746 LOSS | 0.786 WON | 0.588 WON | 1.0349× |
| json-stringify-doc | nts C | 1110.4454 | 0.582 WON | 0.593 WON | 0.511 WON | 0.484 WON | 1.0186× |
| json-stringify-doc | nts LLVM | 1189.3446 | 0.624 WON | 0.635 WON | 0.548 WON | 0.519 WON | 1.0250× |
| json-stringify-doc | nts JVM | 1189.1667 | 0.624 WON | 0.635 WON | 0.548 WON | 0.519 WON | 1.0528× |
| map-entries-top-k | nts C | 16.2607 | 0.611 WON | 0.688 WON | 0.743 WON | 1.197 LOSS | 1.0301× |
| map-entries-top-k | nts LLVM | 16.9656 | 0.637 WON | 0.718 WON | 0.775 WON | 1.249 LOSS | 1.0196× |
| map-entries-top-k | nts JVM | 267.8714 | 10.062 LOSS | 11.340 LOSS | 12.239 LOSS | 19.726 LOSS | 1.0530× |
| module-loop-retained | nts C | 9.0374 | 1.939 LOSS | 2.707 LOSS | 3.512 LOSS | 1.371 LOSS | 1.0133× |
| module-loop-retained | nts LLVM | 8.8699 | 1.903 LOSS | 2.657 LOSS | 3.446 LOSS | 1.345 LOSS | 1.0215× |
| module-loop-retained | nts JVM | 1.7512 | 0.376 WON | 0.525 WON | 0.680 WON | 0.266 WON | 1.0089× |
| objects | nts C | 1.7388 | 0.142 WON | 0.770 WON | 0.737 WON | 1.012 TIE | 1.0064× |
| objects | nts LLVM | 1.7199 | 0.141 WON | 0.762 WON | 0.729 WON | 1.001 TIE | 1.0181× |
| objects | nts JVM | 1.8868 | 0.154 WON | 0.836 SHORT | 0.799 WON | 1.098 LOSS | 1.0152× |
| pipeline | nts C | 28.6755 | 0.198 WON | 0.178 WON | 0.269 WON | 1.119 LOSS | 1.0564× |
| pipeline | nts LLVM | 29.0097 | 0.200 WON | 0.180 WON | 0.272 WON | 1.132 LOSS | 1.0148× |
| pipeline | nts JVM | 55.4225 | 0.382 WON | 0.344 WON | 0.519 WON | 2.163 LOSS | 1.0676× |
| record-word-counts | nts C | 5.2789 | 0.539 WON | 1.106 LOSS | 1.692 LOSS | 0.263 WON | 1.0269× |
| record-word-counts | nts LLVM | 5.4441 | 0.556 WON | 1.141 LOSS | 1.745 LOSS | 0.271 WON | 1.0591× |
| record-word-counts | nts JVM | 6.6384 | 0.678 WON | 1.391 LOSS | 2.128 LOSS | 0.330 WON | 1.0453× |
| release-acyclic | nts C | 101.7625 | 1.471 LOSS | 2.226 LOSS | 2.285 LOSS | 2.268 LOSS | 1.0161× |
| release-acyclic | nts LLVM | 104.8975 | 1.516 LOSS | 2.294 LOSS | 2.356 LOSS | 2.338 LOSS | 1.0132× |
| release-acyclic | nts JVM | 42.8411 | 0.619 WON | 0.937 SHORT | 0.962 TIE | 0.955 TIE | 1.0978× |
| sort-objects | nts C | INVALID | on sort-objects, nts JVM ran in 774.61 us against 29.62 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects | nts LLVM | INVALID | on sort-objects, nts JVM ran in 774.61 us against 29.62 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects | nts JVM | INVALID | on sort-objects, nts JVM ran in 774.61 us against 29.62 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-runs | nts C | INVALID | on sort-objects-runs, nts JVM ran in 886.65 us against 40.46 us for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-runs | nts LLVM | INVALID | on sort-objects-runs, nts JVM ran in 886.65 us against 40.46 us for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-runs | nts JVM | INVALID | on sort-objects-runs, nts JVM ran in 886.65 us against 40.46 us for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-shuffled | nts C | INVALID | on sort-objects-shuffled, nts JVM ran in 4.27 ms against 175.31 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-shuffled | nts LLVM | INVALID | on sort-objects-shuffled, nts JVM ran in 4.27 ms against 175.31 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| sort-objects-shuffled | nts JVM | INVALID | on sort-objects-shuffled, nts JVM ran in 4.27 ms against 175.31 us for nts C -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| string-sort-control | nts C | INVALID | on string-sort-control, nts JVM ran in 2.80 us against 112.7 ns for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| string-sort-control | nts LLVM | INVALID | on string-sort-control, nts JVM ran in 2.80 us against 112.7 ns for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| string-sort-control | nts JVM | INVALID | on string-sort-control, nts JVM ran in 2.80 us against 112.7 ns for nts LLVM -- both are this compiler's backends, so they compile the same work and cannot differ by that much. One of them is doing a different amount of it: check the problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s `volatile`, and `ref.java`'s. | — | — | — | — |
| tree-teardown | nts C | 30.0016 | 0.485 WON | 0.543 WON | 0.844 WON | 0.986 TIE | 1.1257× |
| tree-teardown | nts LLVM | 31.4758 | 0.509 WON | 0.569 WON | 0.885 WON | 1.034 TIE | 1.1122× |
| tree-teardown | nts JVM | 31.7890 | 0.514 WON | 0.575 WON | 0.894 WON | 1.044 TIE | 1.0051× |

| Row | Node µs | Bun JIT µs | Bun AOT µs | ScriptC µs | Load before → after | Available GiB before → after | Spoiled |
|---|---:|---:|---:|---:|---|---:|---|
| array-copying-methods | 73.9270 | 59.3657 | 53.7693 | 33.4406 | 120.60 → 112.05 | 12.08 → 14.54 | False |
| awfy-towers | 38.1237 | 23.5926 | 36.8261 | 96.7292 | 107.88 → 56.33 | 14.36 → 16.14 | False |
| clbg-k-nucleotide | 1861.6383 | 1640.2768 | 1223.0534 | 1179.0446 | 56.33 → 23.91 | 16.39 → 17.27 | False |
| cyclic-churn | 10.4769 | 11.2573 | 9.8868 | 50.6187 | 23.91 → 16.10 | 17.04 → 16.89 | False |
| event-state | 1.4282 | 0.1697 | 0.1264 | 0.1363 | 16.10 → 13.81 | 16.86 → 18.47 | False |
| immutable-update | 99.8234 | 122.2497 | 98.2308 | 37.5318 | 13.81 → 12.04 | 18.32 → 14.43 | False |
| json-build-append | 14.9943 | 7.5013 | 16.6616 | 22.2844 | 12.04 → 10.85 | 15.09 → 14.78 | False |
| json-stringify-doc | 1906.9631 | 1871.8400 | 2170.9678 | 2293.4628 | 10.85 → 13.00 | 14.96 → 15.18 | False |
| map-entries-top-k | 26.6214 | 23.6212 | 21.8868 | 13.5797 | 13.00 → 12.30 | 15.14 → 13.79 | False |
| module-loop-retained | 4.6616 | 3.3384 | 2.5736 | 6.5928 | 12.30 → 13.78 | 14.48 → 13.05 | False |
| objects | 12.2258 | 2.2581 | 2.3606 | 1.7178 | 13.78 → 16.43 | 12.64 → 14.73 | False |
| pipeline | 144.9647 | 161.0419 | 106.7881 | 25.6289 | 16.43 → 30.48 | 14.43 → 12.80 | False |
| record-word-counts | 9.7919 | 4.7718 | 3.1191 | 20.1094 | 30.48 → 37.32 | 12.99 → 11.56 | False |
| release-acyclic | 69.1943 | 45.7170 | 44.5285 | 44.8627 | 37.32 → 45.84 | 11.45 → 8.83 | False |
| sort-objects | INVALID | INVALID | INVALID | INVALID | 45.84 → 36.49 | 8.60 → 12.18 | False |
| sort-objects-runs | INVALID | INVALID | INVALID | INVALID | 36.49 → 39.91 | 12.26 → 11.92 | False |
| sort-objects-shuffled | INVALID | INVALID | INVALID | INVALID | 39.91 → 35.12 | 12.00 → 13.80 | False |
| string-sort-control | INVALID | INVALID | INVALID | INVALID | 35.12 → 35.19 | 13.41 → 14.10 | False |
| tree-teardown | 61.8711 | 55.2972 | 35.5469 | 30.4370 | 35.19 → 31.17 | 14.12 → 13.31 | False |

| Raw evidence under `/home/akisarou/.cache/nts-scratch/876/` | SHA-256 |
|---|---|
| `final-release-cached.log` | `0b5fe2277fd2b29cc111b76604c482f8ec516047dbc0954657203c5614f4e4db` |
| `final-release.log` | `e891f377279e74c5bf75772f940cf5667089cce53d681f2eee859d27ef64cca4` |
| `final-count.log` | `ee9fb20adc4a72136322ee099a8cbfbf3801f053cc418c62305ebedc06c96eb3` |
| `final-timed.log` | `9c51b92185254c54298394e48555ab4738e6ae3d4e7a7941fe833a474ed370c4` |
| `final-bench/count-provenance.json` | `6fbdb83066e4f80749b601c5f8290c829deb1ce2c6389623134d6fdf83feec48` |
| `final-bench/time-provenance.json` | `6f6ca20f2852b592a3fc8ab1e4646fe4e5214d086fe7c0406b2fc43df874e309` |
| `final-bench/sitting.json` | `626bb3da7d8d7bbe67f44eef4b08bbec459c42a078f32f7be873a25dee328c1c` |
| `final-bench/sitting-raw.json` | `e6f05f1e792b61e23e89919fc1d5332ef24e1cb2e0978fcae26ce749d03c53e9` |
| `final-bench/session.journal` | `2737d8f73dcaecb84936b3288ec7c5628b1942a82f3e3b91c87756f90a79d7fb` |
| `final-bench.py` | `25bf3d1a06d67221fab66bd6a4cdcc61d6ee0e0572f9bfd60a90c2e9244ed840` |
| `final-timed.py` | `fc978529710b089fc44115904b46bc88e09ac441ff663938a7d8abeb80cb0558` |
| `final-timed.status` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `final-bench/time-launch.json` | `8a7a8167becd3421c491f68688e2b9e9ba89f03b9a6a728c8d71e9a883ea54df` |
| `record-final-bench.py` | `a5647b76199528170a44c6552bc8cfca70df9183619035437369c687806ff574` |

### Raw measurements behind the invalid sorting rows

These ratios are computed from the retained raw observations, not restored
as valid cells or substituted for the guard's verdict. Every entry remains
INVALID and cannot establish acceptance. The benchmark policy additionally
requires 0.80× against Node/Bun JIT; a ratio below one may still be SHORT.

| Row | Backend | µs | / Node | / Bun JIT | / Bun AOT | / ScriptC | Verdict |
|---|---|---:|---:|---:|---:|---:|---|
| sort-objects | C | 29.617415 | 0.551143 | 0.893486 | 0.771303 | 0.379307 | INVALID: JVM/native disparity |
| sort-objects | LLVM | 29.814188 | 0.554805 | 0.899422 | 0.776427 | 0.381827 | INVALID: JVM/native disparity |
| sort-objects | JVM | 774.610008 | 14.414534 | 23.368116 | 20.172555 | 9.920334 | INVALID: JVM/native disparity |
| sort-objects-runs | C | 41.095919 | 0.663825 | 0.950425 | 0.700269 | 0.455507 | INVALID: JVM/native disparity |
| sort-objects-runs | LLVM | 40.462276 | 0.653590 | 0.935771 | 0.689472 | 0.448484 | INVALID: JVM/native disparity |
| sort-objects-runs | JVM | 886.652135 | 14.322159 | 20.505604 | 15.108437 | 9.827658 | INVALID: JVM/native disparity |
| sort-objects-shuffled | C | 175.310525 | 0.504442 | 0.690025 | 0.619811 | 1.901585 | INVALID: JVM/native disparity |
| sort-objects-shuffled | LLVM | 183.131885 | 0.526948 | 0.720810 | 0.647463 | 1.986423 | INVALID: JVM/native disparity |
| sort-objects-shuffled | JVM | 4273.610045 | 12.296975 | 16.821002 | 15.109357 | 46.355644 | INVALID: JVM/native disparity |
| string-sort-control | C | 0.114551 | 0.460703 | 1.020686 | 1.293846 | 0.816975 | INVALID: JVM/native disparity |
| string-sort-control | LLVM | 0.112683 | 0.453188 | 1.004037 | 1.272741 | 0.803649 | INVALID: JVM/native disparity |
| string-sort-control | JVM | 2.798739 | 11.255966 | 24.937571 | 31.611449 | 19.960465 | INVALID: JVM/native disparity |

The initial classfile inspection finds map's topWords bytecode growing
1,422→10,020 bytes and its whole-number variant 1,357→9,881. The installed
JDK has DontCompileHugeMethods=true by default. The next diagnostic holds
classfiles and work constant and changes only that compilation flag, with
compilation logs, before any corrective compiler design is implemented.

The landing dry run also found the new managed.rs reader absent from the
Rust input manifest. The coordinator approved its empty imports/assets row;
it grants no runtime input paths and changes no selector policy.

| Additional evidence under the scratch root | SHA-256 |
|---|---|
| `jvm-map-method-sizes.json` | `a2a18e04d683ce687eb874c240f32d2aa3c3873d7f74274f03ad9c09bc1ed4dc` |
| `class-method-sizes.py` | `b1596fd3b0e32516dadd8303ebf433374df3af955c55ba781df43422b9660f49` |
| `sort-reader.patch` | `b1be9da7b024d2bb77b0065dfefe51f6106ba32ec49c594b1bcc5f31264cdad5` |
| `final-timed-retention.log` | `b26bcf8258d06ac073f3cc17b2be942827fd9b19295496e3a64537c9a7d24a95` |

## JVM diagnosis: huge-method compilation control

Commit `1ba7adb4815bac41f6ea435d4016408f1453564c`; one locked CPU-4
sitting, sibling 5 idle, six alternating invocations per arm, equal
checksums. Every arm has the same 1 GiB diagnostic cgroup cap and compilation
logging. This is a diagnostic control, separate from the standard full-engine
sitting. Only the last arm enables compilation of huge methods; production
VM policy is unchanged. All samples, including the slow enabled runs, remain
in the JSON and the table's min/max ranges.

[OpenJDK 21.0.5's declared limit](https://github.com/openjdk/jdk21u/blob/jdk-21.0.5%2B11/src/hotspot/share/compiler/compiler_globals.hpp)
is 8,000 bytecodes. Its [compilation policy](https://github.com/openjdk/jdk21u/blob/jdk-21.0.5%2B11/src/hotspot/share/compiler/compilationPolicy.cpp)
rejects larger methods when DontCompileHugeMethods is enabled. The local JDK
has that default. Every adaptive-default workload has no C1/C2 workload
compilation in all six runs; the enabled arm does compile workload methods.
Constructor compilations are excluded from that observation.

| Row | Arm | Median µs | Min µs | Max µs | / original median | Verdict vs original (descriptive 3%) | C1 workload runs /6 | C2 workload runs /6 |
|---|---|---:|---:|---:|---:|---|---:|---:|
| map-entries-top-k | original | 18.290608 | 18.092892 | 18.594256 | 1.000000 | within 3% | 6 | 6 |
| map-entries-top-k | adaptive-default | 279.092083 | 266.941500 | 283.751432 | 15.258765 | LOSS | 0 | 0 |
| map-entries-top-k | adaptive-compile-huge | 25.037432 | 24.829716 | 117.492152 | 1.368868 | LOSS | 6 | 6 |
| sort-objects | original | 95.996420 | 95.417106 | 98.056207 | 1.000000 | within 3% | 6 | 6 |
| sort-objects | adaptive-default | 761.334249 | 758.266697 | 764.700382 | 7.930861 | LOSS | 0 | 0 |
| sort-objects | adaptive-compile-huge | 49.701584 | 49.116728 | 50.196052 | 0.517744 | gain | 6 | 6 |
| sort-objects-runs | original | 104.361377 | 102.924710 | 105.898413 | 1.000000 | within 3% | 6 | 6 |
| sort-objects-runs | adaptive-default | 853.989846 | 847.772678 | 857.847836 | 8.183007 | LOSS | 0 | 0 |
| sort-objects-runs | adaptive-compile-huge | 82.740324 | 54.077816 | 203.115020 | 0.792825 | gain | 6 | 6 |
| sort-objects-shuffled | original | 245.856530 | 241.141387 | 252.894958 | 1.000000 | within 3% | 6 | 6 |
| sort-objects-shuffled | adaptive-default | 4184.805478 | 4158.529333 | 4195.834609 | 17.021331 | LOSS | 0 | 0 |
| sort-objects-shuffled | adaptive-compile-huge | 405.856295 | 346.601503 | 1231.723454 | 1.650785 | LOSS | 6 | 6 |
| string-sort-control | original | 0.098232 | 0.091082 | 0.114383 | 1.000000 | within 3% | 6 | 6 |
| string-sort-control | adaptive-default | 2.777265 | 2.706944 | 2.798838 | 28.272434 | LOSS | 0 | 0 |
| string-sort-control | adaptive-compile-huge | 0.159918 | 0.157499 | 0.162889 | 1.627957 | LOSS | 6 | 6 |

The flag control removes most of the loss but is not a product fix: enabled
map, shuffled and string rows still lose to original by 37%, 65% and 63%.
The emitted code must have smaller method boundaries so the default JVM
compiles the phases effectively. The coordinator requires shared run,
merge and insertion methods; no VM policy change will land.

| Row | CPU-5 user+nice before → after | Load before → after | Spoiled |
|---|---|---|---|
| map-entries-top-k | 8726 → 8726 | 16.00 → 16.09 | False |
| sort-objects | 8726 → 8726 | 16.09 → 15.38 | False |
| sort-objects-runs | 8726 → 8726 | 15.38 → 15.12 | False |
| sort-objects-shuffled | 8726 → 8726 | 15.12 → 16.83 | False |
| string-sort-control | 8726 → 8726 | 16.83 → 18.66 | False |

### Method sizes from javap

Each row is javap's last instruction offset plus the terminal return/throw
byte. Every endpoint is independently checked against the classfile Code
attribute's exact length. Original and adaptive disassemblies, all methods
and command lines are retained. The after-correction sizes are still owed.

| Row | Phase | Method | Bytecodes | Against default 8,000-byte limit |
|---|---|---|---:|---|
| map-entries-top-k | original | `public static double topWords(double);` | 1422 | within limit |
| map-entries-top-k | original | `public static int ¢nts$body$topWords$23$whole(int);` | 1357 | within limit |
| map-entries-top-k | adaptive | `public static double topWords(double);` | 10020 | OVER LIMIT |
| map-entries-top-k | adaptive | `public static int ¢nts$body$topWords$23$whole(int);` | 9881 | OVER LIMIT |
| sort-objects | original | `public static double work(double);` | 1151 | within limit |
| sort-objects | original | `public static int ¢nts$body$work$23$whole(int);` | 1091 | within limit |
| sort-objects | adaptive | `public static double work(double);` | 9520 | OVER LIMIT |
| sort-objects | adaptive | `public static int ¢nts$body$work$23$whole(int);` | 9378 | OVER LIMIT |
| sort-objects-runs | original | `public static double work(double);` | 1263 | within limit |
| sort-objects-runs | original | `public static int ¢nts$body$work$23$whole(int);` | 1199 | within limit |
| sort-objects-runs | adaptive | `public static double work(double);` | 9724 | OVER LIMIT |
| sort-objects-runs | adaptive | `public static int ¢nts$body$work$23$whole(int);` | 9572 | OVER LIMIT |
| sort-objects-shuffled | original | `public static double work(double);` | 1409 | within limit |
| sort-objects-shuffled | original | `public static int ¢nts$body$work$23$whole(int);` | 1345 | within limit |
| sort-objects-shuffled | adaptive | `public static double work(double);` | 9966 | OVER LIMIT |
| sort-objects-shuffled | adaptive | `public static int ¢nts$body$work$23$whole(int);` | 9840 | OVER LIMIT |
| string-sort-control | original | `public static double work(double);` | 927 | within limit |
| string-sort-control | original | `public static int ¢nts$body$work$23$whole(int);` | 860 | within limit |
| string-sort-control | adaptive | `public static double work(double);` | 9128 | OVER LIMIT |
| string-sort-control | adaptive | `public static int ¢nts$body$work$23$whole(int);` | 8970 | OVER LIMIT |

Raw evidence manifest: `/home/akisarou/.cache/nts-scratch/876/jvm-control-evidence.json`, SHA-256 `9b47dc03c526fb6bdc8a665e4592e3a4d615008b76d1a5c871f90af883f35be5`.

## Typed helper correction: focused proof and emitted size

Source: `06196c2e3114d6d4aa228f10768c8229d06f7b0a`. The coordinator approved
typed helper boundaries with shared identical families. The registry is shared
across specialized builders and keys resolved element/callback types, the typed
callback entry, source/substitution facts and carrying mode. Caller-owned
permutation buffers and comparator call order are unchanged. Each family emits
run detection, binary insertion, merge and four direction/strictness-specific
gallop methods. Every carrying helper call tests the raised flag before using
its result. No JVM flag changes.

The focused run passed nine tests: two u32 cursor/power boundary guards; two
raw/prepared-HIR ownership and family-sharing guards; the C runtime write-back
and mutation control; JVM size and Node agreement; and the two native sort
suites, including forced collection, reentrancy, phase-specific throws, RC
poisoning and ASan/UBSan. The adaptive fixture has 17 exports and 18 seeds
(306 Node cases). Insertion, merge and gallop throws have a matching quiet
control. A test-only Shared initializer and a duplicate helper drain were
corrected before this green run. `cargo fmt --check` passed. An initial
`fmt --all --check` traversed unformatted third-party dependencies; it changed
no files and is not the gate formatting command.

These are static sizes from the fresh nts-dev compiler, not timed benchmark
rows. javap instruction endpoints match the exact Code attribute lengths for
every method. Each benchmark emits one seven-method family shared by the public
and whole-number entry points. The two-site fixture independently checks that
one identical comparator requests one family. All seven helper lengths are
455 / 253 / 2363 / 470 / 432 / 444 / 482 bytes. The largest emitted method is
2,363 bytes in every row, below default HotSpot's 8,000-byte limit.

| Row | Families | Helper methods | Helper bytecodes | Program total bytecodes | Program.class bytes | All emitted class bytes | Size verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| sort-objects | 1 | 7 | 4899 | 7868 | 13401 | 14605 | all methods within limit |
| sort-objects-shuffled | 1 | 7 | 4899 | 8380 | 14589 | 15793 | all methods within limit |
| sort-objects-runs | 1 | 7 | 4899 | 8088 | 13687 | 14891 | all methods within limit |
| map-entries-top-k | 1 | 7 | 4899 | 8545 | 15471 | 16813 | all methods within limit |
| string-sort-control | 1 | 7 | 4899 | 7321 | 12213 | 13041 | all methods within limit |

All emitted class bytes includes the program, closure and data classes; it
excludes the unchanged runtime jar. The complete per-method names and sizes,
javap output, emitted classes, compiler arguments and SHA-256 identities live
in kept scratch. The preceding table retains the oversized before methods.

The machine hold remains active: no final instruction-count, native inlining
profile, matched JVM timing or whole-memory sitting has run for this correction.
The before flag-enabled map/shuffled/string losses remain unresolved timing
evidence until the default-flag matched run measures the split. Inner, the five
test262 records and --here are also still owed.

Raw evidence manifest: `/home/akisarou/.cache/nts-scratch/876/helper-static-evidence.json`,
SHA-256 `42587adb0c87fa1bd4ccde4272eb6b05bd81e8f335cdbb2269e884934369eaee`.
The focused command and launcher are in that manifest; the failed launcher
syntax attempts are retained too.

### Native helper ownership inspection

The fresh nts-dev compiler emitted RC C and LLVM for sort-objects and
map-entries-top-k. All seven generated helper bodies in each of the four
outputs contain zero explicit retain or release sites. Caller-owned buffers
keep their releases in the callers. This is a static placement control; it
does not replace the exact dynamic counting floor or optimized-code inlining
proof, which remain owed after the machine hold. Emission diagnostics are
empty in all four outputs.

| Row | Backend | Helpers inspected | Explicit retain/release sites inside helpers | Verdict |
|---|---|---:|---:|---|
| sort-objects | c | 7 | 0 | no helper argument counting |
| sort-objects | llvm | 7 | 0 | no helper argument counting |
| map-entries-top-k | c | 7 | 0 | no helper argument counting |
| map-entries-top-k | llvm | 7 | 0 | no helper argument counting |

The next matched sitting's script has main, monolithic adaptive and split
adaptive arms, six alternating repetitions on the five sorting rows, C, LLVM
and default-policy JVM, checksum checks, CPU-5 observations and retained
compilation logs. Its separate output prefix preserves the failed full-memory
sitting and the huge-method flag control. The replacement full-memory scripts
retain the automatic results JSON in scratch and drop only their results-only
commit, as before; they no longer assert ELF identity with the pre-split arm.
These scripts are prepared, syntax checked, and have not been run.

Raw evidence and prepared scripts: `/home/akisarou/.cache/nts-scratch/876/helper-native-evidence.json`, SHA-256
`56ea710a5480db2c40ee961ccf9240ecb2fe8ffd2cd77c04a9868b39a93346ce`.

## Rebased typed helpers: final measurements

Frozen source `b1cf5c24d9d60ac03f3fda693470a0ee1a641009`, rebased onto
verified/main `1dccb9d1090c2b825f4e071cac7d43236f162cec`. All 34 task
commits replayed without a changed patch (range-diff retained). The earlier
compiler and branch bundle are retained. A plain all-workspace release build
passed before any measurement. Node is pinned to v26.13.0.

The verified compiler emits byte-identical C, LLVM and Program.class to the
original baseline for all five sorting rows. Thus the archived main timing
controls are also controls for this verified revision. The new JVM classes
are byte-identical to the earlier javap size proof: one seven-method family
per benchmark, 4,899 helper bytecodes, largest method 2,363 bytes. No VM policy
flag changes are part of the product.

### Instruction counts, every row

Calibrated net user instructions per work call, CPU 0 outside CPUs 4–5,
without the CPU lock. Shipping RC and native flags. Native band 0.01%.
Original is the pre-task a33eacb baseline; monolithic is the selected unsigned
r32/bounds/galloping policy. Losses against either comparison are retained.
JVM/Java/Bun/ScriptC instruction columns were filtered, not measured here.

The census completed all 19 rows before the archiver encountered perf-control
FIFOs. All 14 native identity receipts were verified against the completed
artifacts; regular files and compiler identities were archived without
repeating the census. The original failing archiver and complete log remain.

| Row | Backend | Original | Monolithic | Split | / original | / monolithic | vs original | vs monolithic |
|---|---|---:|---:|---:|---:|---:|---|---|
| array-copying-methods | C | 482832 | 482832 | 482832 | 1.000000 | 1.000000 | within band | within band |
| array-copying-methods | LLVM | 538832 | 538832 | 538832 | 1.000000 | 1.000000 | within band | within band |
| awfy-towers | C | 941646 | 941646 | 941646 | 1.000000 | 1.000000 | within band | within band |
| awfy-towers | LLVM | 908822 | 908821 | 908821 | 0.999999 | 1.000000 | within band | within band |
| clbg-k-nucleotide | C | 17432320 | 17425096 | 17425499 | 0.999609 | 1.000023 | gain | within band |
| clbg-k-nucleotide | LLVM | 17424398 | 17417471 | 17417574 | 0.999608 | 1.000006 | gain | within band |
| cyclic-churn | C | 2375872 | 2375872 | 2375872 | 1.000000 | 1.000000 | within band | within band |
| cyclic-churn | LLVM | 2377860 | 2377856 | 2377856 | 0.999998 | 1.000000 | within band | within band |
| event-state | C | 1700 | 1700 | 1700 | 1.000000 | 1.000000 | within band | within band |
| event-state | LLVM | 1698 | 1698 | 1698 | 1.000000 | 1.000000 | within band | within band |
| immutable-update | C | 2031897 | 2031902 | 2031902 | 1.000002 | 1.000000 | within band | within band |
| immutable-update | LLVM | 2033945 | 2033945 | 2033945 | 1.000000 | 1.000000 | within band | within band |
| json-build-append | C | 222777 | 222777 | 222777 | 1.000000 | 1.000000 | within band | within band |
| json-build-append | LLVM | 222778 | 222777 | 222776 | 0.999991 | 0.999996 | within band | within band |
| json-stringify-doc | C | 27212376 | 27212310 | 27212312 | 0.999998 | 1.000000 | within band | within band |
| json-stringify-doc | LLVM | 27037193 | 27037191 | 27037192 | 1.000000 | 1.000000 | within band | within band |
| map-entries-top-k | C | 414057 | 390131 | 387301 | 0.935381 | 0.992746 | gain | gain |
| map-entries-top-k | LLVM | 415503 | 396487 | 398771 | 0.959731 | 1.005761 | gain | LOSS |
| module-loop-retained | C | 262197 | 262197 | 262197 | 1.000000 | 1.000000 | within band | within band |
| module-loop-retained | LLVM | 262197 | 262197 | 262197 | 1.000000 | 1.000000 | within band | within band |
| objects | C | 27684 | 27684 | 27684 | 1.000000 | 1.000000 | within band | within band |
| objects | LLVM | 27684 | 27684 | 27684 | 1.000000 | 1.000000 | within band | within band |
| pipeline | C | 239558 | 239558 | 239558 | 1.000000 | 1.000000 | within band | within band |
| pipeline | LLVM | 239555 | 239558 | 239558 | 1.000013 | 1.000000 | within band | within band |
| record-word-counts | C | 152641 | 152641 | 152641 | 1.000000 | 1.000000 | within band | within band |
| record-word-counts | LLVM | 154112 | 154112 | 154112 | 1.000000 | 1.000000 | within band | within band |
| release-acyclic | C | 1832669 | 1832669 | 1832674 | 1.000003 | 1.000003 | within band | within band |
| release-acyclic | LLVM | 1832669 | 1832669 | 1832669 | 1.000000 | 1.000000 | within band | within band |
| sort-objects | C | 1411192 | 474029 | 468806 | 0.332206 | 0.988982 | gain | gain |
| sort-objects | LLVM | 1501920 | 487311 | 480865 | 0.320167 | 0.986772 | gain | gain |
| sort-objects-runs | C | 1672921 | 670811 | 669658 | 0.400293 | 0.998281 | gain | gain |
| sort-objects-runs | LLVM | 1723222 | 678313 | 674744 | 0.391560 | 0.994738 | gain | gain |
| sort-objects-shuffled | C | 1829354 | 1461009 | 1425253 | 0.779102 | 0.975527 | gain | gain |
| sort-objects-shuffled | LLVM | 1877546 | 1568980 | 1531948 | 0.815931 | 0.976397 | gain | gain |
| string-sort-control | C | 2995 | 2392 | 2401 | 0.801669 | 1.003763 | gain | LOSS |
| string-sort-control | LLVM | 3077 | 2443 | 2465 | 0.801105 | 1.009005 | gain | LOSS |
| tree-teardown | C | 597515 | 597515 | 597515 | 1.000000 | 1.000000 | within band | within band |
| tree-teardown | LLVM | 597516 | 597516 | 597516 | 1.000000 | 1.000000 | within band | within band |

| Row | Control | Original | Split | / original | Condition/verdict |
|---|---|---:|---:|---:|---|
| array-copying-methods | C++ | 295759 | 295759 | 1.000000 | within band |
| array-copying-methods | node | 2318228 | 2354171 | 1.015505 | JIT spread, informational |
| awfy-towers | C++ | 347328 | 347328 | 1.000000 | within band |
| awfy-towers | node | 1148510 | 1148321 | 0.999835 | JIT spread, informational |
| clbg-k-nucleotide | C++ | 7805117 | 7805117 | 1.000000 | within band |
| clbg-k-nucleotide | node | 36398076 | 35262087 | 0.968790 | JIT spread, informational |
| cyclic-churn | C++ | 529773 | 529773 | 1.000000 | within band |
| cyclic-churn | node | 282612 | 271884 | 0.962040 | JIT spread, informational |
| event-state | C++ | 13757 | 13757 | 1.000000 | within band |
| event-state | node | 39151 | 39687 | 1.013691 | JIT spread, informational |
| immutable-update | C++ | 557192 | 557192 | 1.000000 | within band |
| immutable-update | node | 2578497 | 3756019 | 1.456670 | JIT spread, informational |
| json-build-append | C++ | -- | -- | — | unavailable |
| json-build-append | node | 823273 | 1080663 | 1.312642 | JIT spread, informational |
| json-stringify-doc | C++ | -- | -- | — | unavailable |
| json-stringify-doc | node | 42337038 | 42330361 | 0.999842 | JIT spread, informational |
| map-entries-top-k | C++ | 376413 | 376406 | 0.999981 | within band |
| map-entries-top-k | node | 778585 | 763647 | 0.980814 | JIT spread, informational |
| module-loop-retained | C++ | -- | -- | — | unavailable |
| module-loop-retained | node | 136203 | 144293 | 1.059397 | JIT spread, informational |
| objects | C++ | 27659 | 27659 | 1.000000 | within band |
| objects | node | 115007 | 114942 | 0.999435 | JIT spread, informational |
| pipeline | C++ | 232103 | 232103 | 1.000000 | within band |
| pipeline | node | 25135777 | 25141239 | 1.000217 | JIT spread, informational |
| record-word-counts | C++ | 295481 | 295481 | 1.000000 | within band |
| record-word-counts | node | 269972 | 259233 | 0.960222 | JIT spread, informational |
| release-acyclic | C++ | 4230170 | 4230121 | 0.999988 | within band |
| release-acyclic | node | 1840107 | 1270351 | 0.690368 | JIT spread, informational |
| sort-objects | C++ | 733449 | 733449 | 1.000000 | within band |
| sort-objects | node | 1497315 | 1492777 | 0.996969 | JIT spread, informational |
| sort-objects-runs | C++ | 479914 | 479914 | 1.000000 | within band |
| sort-objects-runs | node | 1562565 | 1560726 | 0.998823 | JIT spread, informational |
| sort-objects-shuffled | C++ | 855387 | 855387 | 1.000000 | within band |
| sort-objects-shuffled | node | 4541688 | 6121312 | 1.347805 | JIT spread, informational |
| string-sort-control | C++ | 1700 | 1700 | 1.000000 | within band |
| string-sort-control | node | 5802 | 6012 | 1.036194 | JIT spread, informational |
| tree-teardown | C++ | 3236823 | 3236823 | 1.000000 | within band |
| tree-teardown | node | 1393354 | 1393209 | 0.999896 | JIT spread, informational |

### Comparator and counting controls

Seed 0 means one batch of 256 objects sorted 16 times: 4,096 element-sort
visits per work call, not one 4,096-element array. The string control uses
seed 7 and six elements. Both backends have identical comparator counts,
unchanged from the selected monolithic policy. Shuffled input uses 1.185%
more comparisons than the original bottom-up merge: that losing count is
retained even though native wall time and instructions improve.

| Row | Original calls | Split calls, C=LLVM | / original | Original calls/element-sort | Split calls/element-sort |
|---|---:|---:|---:|---:|---:|
| sort-objects | 17101 | 5561 | 0.325186 | 4.175049 | 1.357666 |
| sort-objects-shuffled | 27592 | 27919 | 1.011851 | 6.736328 | 6.816162 |
| sort-objects-runs | 18472 | 4435 | 0.240093 | 4.509766 | 1.082764 |
| string-sort-control | 11 | 10 | 0.909091 | 1.833333 | 1.666667 |

Both C and LLVM retain exactly R4096 / D4387 / A298, result 66980960,
with zero live objects and bytes. These counts include the immutable owner
snapshots. Permutation moves and unchanged-prefix commits count nothing;
toSorted owns its private result and applies cycles. The helper split adds
no argument counting. The snapshot floor is one retain per element-sort
visit; arbitrary comparators may drop the original references.

### One locked three-arm sitting

Main, monolithic adaptive and split adaptive run six times in alternating
arm order per row on CPU 4 with sibling 5 quiet. All checksums match; all 15
rows are unspoiled. Values below are medians and the full observed min/max.
The 3% descriptive band is applied consistently, including the losing JVM
shuffle median. It is separate from the JVM's observed repeat spread.
Compilation logs are enabled identically on all JVM arms; huge methods stay
at the default policy. The admitted payload's recorded leaf memory.max is
`max`; the launcher's requested cap does not bound its separate scope. No
absolute times are compared with the older 1 GiB flag-control sitting.
That older cap was explicitly passed through admit's --memory-max, as its
retained unit journal confirms.

| Row | Backend | Arm | Median µs | Min µs | Max µs | / main | Verdict vs main, 3% |
|---|---|---|---:|---:|---:|---:|---|
| sort-objects | nts | main | 58.594499 | 57.466105 | 59.435641 | 1.000000 | within band |
| sort-objects | nts | monolithic | 28.914522 | 28.827175 | 29.055078 | 0.493468 | gain |
| sort-objects | nts | split | 28.873171 | 28.660425 | 29.115438 | 0.492762 | gain |
| sort-objects | ntsllvm | main | 62.959022 | 62.329225 | 63.654234 | 1.000000 | within band |
| sort-objects | ntsllvm | monolithic | 28.618360 | 28.198054 | 28.706087 | 0.454555 | gain |
| sort-objects | ntsllvm | split | 28.688686 | 28.507029 | 28.807393 | 0.455672 | gain |
| sort-objects | jvm | main | 96.389597 | 94.205404 | 98.871095 | 1.000000 | within band |
| sort-objects | jvm | monolithic | 761.532803 | 741.608963 | 763.649388 | 7.900570 | LOSS |
| sort-objects | jvm | split | 39.650814 | 38.037168 | 39.806518 | 0.411360 | gain |
| sort-objects-shuffled | nts | main | 185.820363 | 179.667840 | 187.147093 | 1.000000 | within band |
| sort-objects-shuffled | nts | monolithic | 169.132617 | 168.146971 | 171.652611 | 0.910194 | gain |
| sort-objects-shuffled | nts | split | 172.795076 | 169.499585 | 174.032513 | 0.929904 | gain |
| sort-objects-shuffled | ntsllvm | main | 187.011526 | 184.452341 | 188.564460 | 1.000000 | within band |
| sort-objects-shuffled | ntsllvm | monolithic | 177.123843 | 175.612123 | 178.609118 | 0.947128 | gain |
| sort-objects-shuffled | ntsllvm | split | 166.388998 | 165.270650 | 168.038697 | 0.889726 | gain |
| sort-objects-shuffled | jvm | main | 265.816816 | 259.249778 | 275.092712 | 1.000000 | within band |
| sort-objects-shuffled | jvm | monolithic | 4123.204010 | 4066.336783 | 4214.527348 | 15.511449 | LOSS |
| sort-objects-shuffled | jvm | split | 274.634234 | 272.451496 | 284.496852 | 1.033171 | LOSS |
| sort-objects-runs | nts | main | 71.161714 | 70.419296 | 71.593669 | 1.000000 | within band |
| sort-objects-runs | nts | monolithic | 40.702600 | 40.292418 | 40.785971 | 0.571973 | gain |
| sort-objects-runs | nts | split | 39.856686 | 39.259435 | 40.450443 | 0.560086 | gain |
| sort-objects-runs | ntsllvm | main | 71.938835 | 71.912859 | 72.800322 | 1.000000 | within band |
| sort-objects-runs | ntsllvm | monolithic | 39.906032 | 39.725105 | 40.329046 | 0.554722 | gain |
| sort-objects-runs | ntsllvm | split | 40.607878 | 40.350374 | 40.754342 | 0.564478 | gain |
| sort-objects-runs | jvm | main | 110.167782 | 108.456809 | 110.841520 | 1.000000 | within band |
| sort-objects-runs | jvm | monolithic | 865.725691 | 860.256351 | 868.955856 | 7.858247 | LOSS |
| sort-objects-runs | jvm | split | 45.575068 | 44.356772 | 46.453050 | 0.413688 | gain |
| map-entries-top-k | nts | main | 17.911995 | 17.769260 | 18.166969 | 1.000000 | within band |
| map-entries-top-k | nts | monolithic | 17.077601 | 16.923084 | 17.434129 | 0.953417 | gain |
| map-entries-top-k | nts | split | 17.154098 | 16.980421 | 17.339862 | 0.957688 | gain |
| map-entries-top-k | ntsllvm | main | 18.333258 | 18.272387 | 18.984322 | 1.000000 | within band |
| map-entries-top-k | ntsllvm | monolithic | 17.957046 | 17.832488 | 17.994878 | 0.979479 | within band |
| map-entries-top-k | ntsllvm | split | 17.514841 | 17.459035 | 17.702125 | 0.955359 | gain |
| map-entries-top-k | jvm | main | 19.458215 | 19.095168 | 19.869459 | 1.000000 | within band |
| map-entries-top-k | jvm | monolithic | 284.354908 | 283.103442 | 287.970636 | 14.613618 | LOSS |
| map-entries-top-k | jvm | split | 19.229528 | 19.012934 | 19.469488 | 0.988247 | within band |
| string-sort-control | nts | main | 0.132071 | 0.130705 | 0.132839 | 1.000000 | within band |
| string-sort-control | nts | monolithic | 0.115196 | 0.114453 | 0.116780 | 0.872225 | gain |
| string-sort-control | nts | split | 0.109707 | 0.109049 | 0.111293 | 0.830667 | gain |
| string-sort-control | ntsllvm | main | 0.134389 | 0.133836 | 0.135224 | 1.000000 | within band |
| string-sort-control | ntsllvm | monolithic | 0.112279 | 0.111837 | 0.112737 | 0.835479 | gain |
| string-sort-control | ntsllvm | split | 0.108219 | 0.107455 | 0.109004 | 0.805271 | gain |
| string-sort-control | jvm | main | 0.097959 | 0.097245 | 0.116975 | 1.000000 | within band |
| string-sort-control | jvm | monolithic | 2.760039 | 2.746928 | 2.783501 | 28.175432 | LOSS |
| string-sort-control | jvm | split | 0.078716 | 0.077316 | 0.097421 | 0.803559 | gain |

| Row | Backend | Load before → after | CPU-5 user+nice ticks before → after | Spoiled |
|---|---|---|---|---|
| sort-objects | nts | 21.66 → 20.71 | 10174 → 10174 | False |
| sort-objects | ntsllvm | 20.71 → 20.50 | 10174 → 10174 | False |
| sort-objects | jvm | 20.50 → 18.65 | 10174 → 10174 | False |
| sort-objects-shuffled | nts | 18.65 → 18.93 | 10174 → 10174 | False |
| sort-objects-shuffled | ntsllvm | 18.93 → 18.62 | 10174 → 10174 | False |
| sort-objects-shuffled | jvm | 18.62 → 19.29 | 10174 → 10174 | False |
| sort-objects-runs | nts | 20.47 → 21.23 | 10175 → 10175 | False |
| sort-objects-runs | ntsllvm | 21.23 → 23.46 | 10175 → 10175 | False |
| sort-objects-runs | jvm | 23.46 → 24.21 | 10175 → 10175 | False |
| map-entries-top-k | nts | 24.21 → 24.21 | 10175 → 10175 | False |
| map-entries-top-k | ntsllvm | 24.21 → 24.83 | 10175 → 10175 | False |
| map-entries-top-k | jvm | 24.83 → 23.31 | 10175 → 10175 | False |
| string-sort-control | nts | 23.31 → 23.31 | 10175 → 10175 | False |
| string-sort-control | ntsllvm | 23.31 → 23.53 | 10175 → 10175 | False |
| string-sort-control | jvm | 23.53 → 22.63 | 10175 → 10175 | False |

The JVM shuffle median is 1.033171× main, a LOSS against the descriptive 3%
band. Main's max/min spread is 6.111% (259.250–275.093 µs), split's 4.421%
(272.451–284.497 µs); the ranges overlap. Five of six paired trials are
slower, so this is not presented as a speedup or statistical equivalence.
The median gap is inside both observed JVM repeat spreads, meeting the
coordinator's stated guard. The other four JVM rows are at or below main.
Every JVM workload reaches C2 in all six split trials.

### Native inlining and remaining JVM profile

All six native profiles are unspoiled. ThinLTO inlines insertion and all
four gallop helpers into their phase callers. Run and merge remain outlined;
the call per run or merge is amortized by their loops. All five native rows
retain gains. The coordinator explicitly accepted this measured partial
inlining under guard 2; no forced native inlining contract was added.
Native branch-miss/stall counters, flat cycle profiles, symbols and complete
disassembly are retained for sort, shuffled and map on both backends.

JFR sampled the main thread at 1 ms in three alternating main/split pairs,
all unspoiled. Percentages below use samples with a Program frame and the
nearest sort phase anywhere in the stack, including inlined frames. The
monolithic baseline's algorithm remains in its root, so phase percentages
are not directly comparable. These are profiles, not acceptance timings.

| Arm | Main-thread samples | Samples with Program frame | Phase | Samples | % of Program samples |
|---|---:|---:|---|---:|---:|
| main | 3064 | 2978 | root | 2978 | 100.000 |
| split | 2808 | 2658 | merge | 1269 | 47.743 |
| split | 2808 | 2658 | root | 550 | 20.692 |
| split | 2808 | 2658 | insert | 820 | 30.850 |
| split | 2808 | 2658 | run | 13 | 0.489 |
| split | 2808 | 2658 | gallop | 6 | 0.226 |

Only about 1.2% of Program-frame samples are interpreted warmup in either
arm. The split's largest shares are merge (47.743%) and binary insertion
(30.850%). Each of the six shuffled C2 compilation logs records 12–13 hot
comparator inline successes and one cold-context “too big” refusal; all
refusals remain in the raw logs. There is no huge-method interpreted
fallback or comparator megamorphic symptom in this evidence. The remaining
shuffle point estimate is retained as residue inside observed JVM spread;
no additional helper emission change is justified by these measurements.

### Complete all-engine sitting

One CPU-4 sitting contains all 18 memory rows and k-nucleotide, with sibling
5 quiet. Shipping native flags and RC, pinned Node, Bun JIT, Bun AOT and
ScriptC. All 19 rows are complete and unspoiled. Each ratio is within this
sitting; no absolute time is compared across sittings. JVM ratios have no
standing tool verdict and are labelled unassessed, while native tool
verdicts are reproduced exactly.

Sort is below Node and Bun JIT on both native backends. Bun JIT margins are
0.920× / 0.921× and the tool labels them SHORT; this is not reported as a
WON margin. Map's matched before/after gains are 4.23% / 4.46%. The earlier
INVALID sitting and every losing policy/huge-method arm remain above.
Warnings about repeat spread in immutable-update C/Java, pipeline Java,
shuffled Java and string-control JVM are retained; the complete JSON and
journal include every sample and condition.

The automatic results-only commit was dropped. This agent sitting is kept
only in issue scratch; the nightly remains the publisher of run records.

### helper-final/sitting.json

Source `b1cf5c24d9d60ac03f3fda693470a0ee1a641009`; 2026-11-20T09:05:40.327Z to 2026-11-20T09:22:24.992Z.

Times in µs; ratios are backend / engine. Verdicts are the tool’s recorded verdicts, including losses and ties.

| Row | Backend | µs | / node | / Bun JIT | / Bun AOT | / ScriptC | Backend repeat spread |
|---|---|---:|---:|---:|---:|---:|---:|
| array-copying-methods | nts C | 23.6236 | 0.340 WON | 0.418 WON | 0.469 WON | 0.731 WON | 1.0285× |
| array-copying-methods | nts LLVM | 24.9542 | 0.360 WON | 0.442 WON | 0.495 WON | 0.772 WON | 1.0164× |
| array-copying-methods | nts JVM | 31.3824 | 0.452 WON | 0.555 WON | 0.623 WON | 0.971 TIE | 1.0280× |
| awfy-towers | nts C | 35.3815 | 0.966 SHORT | 1.524 LOSS | 0.971 TIE | 0.375 WON | 1.0554× |
| awfy-towers | nts LLVM | 33.3121 | 0.910 SHORT | 1.435 LOSS | 0.914 WON | 0.353 WON | 1.0245× |
| awfy-towers | nts JVM | 28.8739 | 0.788 WON | 1.244 LOSS | 0.792 WON | 0.306 WON | 1.0065× |
| clbg-k-nucleotide | nts C | 1052.1425 | 0.570 WON | 0.663 WON | 0.852 WON | 0.917 WON | 1.0180× |
| clbg-k-nucleotide | nts LLVM | 1052.3053 | 0.570 WON | 0.663 WON | 0.853 WON | 0.917 WON | 1.0134× |
| clbg-k-nucleotide | nts JVM | 1205.1966 | 0.653 WON | 0.760 WON | 0.976 TIE | 1.050 TIE | 1.4650× |
| cyclic-churn | nts C | 95.9993 | 9.364 LOSS | 8.342 LOSS | 9.394 LOSS | 1.868 LOSS | 1.0118× |
| cyclic-churn | nts LLVM | 97.9000 | 9.550 LOSS | 8.507 LOSS | 9.580 LOSS | 1.905 LOSS | 1.0155× |
| cyclic-churn | nts JVM | 11.1864 | 1.091 LOSS | 0.972 SHORT | 1.095 TIE | 0.218 WON | 1.0295× |
| event-state | nts C | 0.1066 | 0.080 WON | 0.637 WON | 0.829 WON | 0.801 WON | 1.0272× |
| event-state | nts LLVM | 0.1055 | 0.079 WON | 0.630 WON | 0.820 WON | 0.792 WON | 1.0223× |
| event-state | nts JVM | 0.0983 | 0.073 WON | 0.587 WON | 0.764 WON | 0.738 WON | 1.0954× |
| immutable-update | nts C | 71.4331 | 0.699 WON | 0.611 WON | 0.786 WON | 1.970 LOSS | 1.0301× |
| immutable-update | nts LLVM | 79.6777 | 0.779 WON | 0.681 WON | 0.877 WON | 2.197 LOSS | 1.0057× |
| immutable-update | nts JVM | 117.8069 | 1.152 LOSS | 1.008 LOSS | 1.296 LOSS | 3.249 LOSS | 1.0331× |
| json-build-append | nts C | 8.3018 | 0.524 WON | 0.893 SHORT | 0.449 WON | 0.354 WON | 1.0084× |
| json-build-append | nts LLVM | 8.5228 | 0.537 WON | 0.917 SHORT | 0.461 WON | 0.363 WON | 1.0206× |
| json-build-append | nts JVM | 13.0779 | 0.825 SHORT | 1.407 LOSS | 0.707 WON | 0.557 WON | 1.0414× |
| json-stringify-doc | nts C | 1317.8219 | 0.636 WON | 0.697 WON | 0.603 WON | 0.540 WON | 1.4616× |
| json-stringify-doc | nts LLVM | 1345.2698 | 0.649 WON | 0.712 WON | 0.615 WON | 0.551 WON | 1.1787× |
| json-stringify-doc | nts JVM | 1207.0745 | 0.583 WON | 0.639 WON | 0.552 WON | 0.494 WON | 1.0852× |
| map-entries-top-k | nts C | 16.6336 | 0.625 WON | 0.716 WON | 0.781 WON | 1.229 LOSS | 1.0219× |
| map-entries-top-k | nts LLVM | 16.2852 | 0.612 WON | 0.701 WON | 0.765 WON | 1.203 LOSS | 1.0329× |
| map-entries-top-k | nts JVM | 17.5690 | 0.660 WON | 0.757 WON | 0.825 WON | 1.298 LOSS | 1.0544× |
| module-loop-retained | nts C | 8.7908 | 1.843 LOSS | 2.876 LOSS | 3.628 LOSS | 1.327 LOSS | 1.0132× |
| module-loop-retained | nts LLVM | 8.9995 | 1.887 LOSS | 2.944 LOSS | 3.714 LOSS | 1.359 LOSS | 1.0394× |
| module-loop-retained | nts JVM | 1.7624 | 0.370 WON | 0.577 WON | 0.727 WON | 0.266 WON | 1.0174× |
| objects | nts C | 1.6709 | 0.142 WON | 0.754 WON | 0.727 WON | 1.000 TIE | 1.0118× |
| objects | nts LLVM | 1.6564 | 0.141 WON | 0.747 WON | 0.721 WON | 0.992 TIE | 1.0131× |
| objects | nts JVM | 1.8212 | 0.155 WON | 0.821 SHORT | 0.793 WON | 1.091 LOSS | 1.0074× |
| pipeline | nts C | 29.2695 | 0.202 WON | 0.186 WON | 0.280 WON | 1.167 LOSS | 1.0029× |
| pipeline | nts LLVM | 29.1198 | 0.201 WON | 0.185 WON | 0.278 WON | 1.162 LOSS | 1.0135× |
| pipeline | nts JVM | 52.3601 | 0.362 WON | 0.333 WON | 0.500 WON | 2.089 LOSS | 1.0907× |
| record-word-counts | nts C | 5.1834 | 0.552 WON | 1.143 LOSS | 1.702 LOSS | 0.258 WON | 1.0404× |
| record-word-counts | nts LLVM | 5.1994 | 0.553 WON | 1.146 LOSS | 1.708 LOSS | 0.259 WON | 1.0194× |
| record-word-counts | nts JVM | 6.5164 | 0.694 WON | 1.436 LOSS | 2.140 LOSS | 0.325 WON | 1.0137× |
| release-acyclic | nts C | 98.3220 | 2.372 LOSS | 2.635 LOSS | 2.721 LOSS | 2.260 LOSS | 1.0288× |
| release-acyclic | nts LLVM | 102.8845 | 2.482 LOSS | 2.757 LOSS | 2.847 LOSS | 2.365 LOSS | 1.0363× |
| release-acyclic | nts JVM | 38.8827 | 0.938 SHORT | 1.042 LOSS | 1.076 LOSS | 0.894 WON | 1.0135× |
| sort-objects | nts C | 29.0511 | 0.576 WON | 0.920 SHORT | 0.809 WON | 0.392 WON | 1.0185× |
| sort-objects | nts LLVM | 29.0947 | 0.577 WON | 0.921 SHORT | 0.811 WON | 0.393 WON | 1.0059× |
| sort-objects | nts JVM | 37.2554 | 0.738 WON | 1.180 LOSS | 1.038 TIE | 0.503 WON | 1.0208× |
| sort-objects-runs | nts C | 37.8109 | 0.723 WON | 0.961 SHORT | 0.766 WON | 0.435 WON | 1.0303× |
| sort-objects-runs | nts LLVM | 38.3036 | 0.732 WON | 0.974 SHORT | 0.776 WON | 0.441 WON | 1.0372× |
| sort-objects-runs | nts JVM | 39.9650 | 0.764 WON | 1.016 LOSS | 0.810 WON | 0.460 WON | 1.0355× |
| sort-objects-shuffled | nts C | 169.3850 | 0.497 WON | 0.674 WON | 0.611 WON | 1.867 LOSS | 1.0230× |
| sort-objects-shuffled | nts LLVM | 156.8789 | 0.461 WON | 0.625 WON | 0.565 WON | 1.730 LOSS | 1.0192× |
| sort-objects-shuffled | nts JVM | 258.5752 | 0.759 WON | 1.029 LOSS | 0.932 WON | 2.851 LOSS | 1.0948× |
| string-sort-control | nts C | 0.1087 | 0.445 WON | 1.014 LOSS | 1.265 LOSS | 0.788 WON | 1.0191× |
| string-sort-control | nts LLVM | 0.1037 | 0.424 WON | 0.967 SHORT | 1.207 LOSS | 0.752 WON | 1.0149× |
| string-sort-control | nts JVM | 0.0738 | 0.302 WON | 0.688 WON | 0.858 WON | 0.535 WON | 1.2696× |
| tree-teardown | nts C | 29.2408 | 0.609 WON | 0.591 WON | 1.067 TIE | 1.078 TIE | 1.1280× |
| tree-teardown | nts LLVM | 30.1866 | 0.629 WON | 0.610 WON | 1.102 TIE | 1.113 TIE | 1.1416× |
| tree-teardown | nts JVM | 31.1276 | 0.648 WON | 0.629 WON | 1.136 LOSS | 1.148 LOSS | 1.0198× |

| Row | Node µs | Bun JIT µs | Bun AOT µs | ScriptC µs | Load before → after | Available GiB before → after | Spoiled |
|---|---:|---:|---:|---:|---|---:|---|
| array-copying-methods | 69.3804 | 56.4943 | 50.3635 | 32.3151 | 14.52 → 13.83 | 11.22 → 15.71 | False |
| awfy-towers | 36.6190 | 23.2189 | 36.4531 | 94.4472 | 13.83 → 10.28 | 15.71 → 15.35 | False |
| clbg-k-nucleotide | 1846.3301 | 1586.5307 | 1234.3064 | 1147.4842 | 10.28 → 8.29 | 15.33 → 17.91 | False |
| cyclic-churn | 10.2515 | 11.5076 | 10.2197 | 51.3860 | 8.27 → 9.07 | 18.38 → 16.30 | False |
| event-state | 1.3382 | 0.1675 | 0.1287 | 0.1332 | 9.31 → 9.41 | 15.98 → 17.12 | False |
| immutable-update | 102.2320 | 116.9201 | 90.9030 | 36.2633 | 9.41 → 16.14 | 17.69 → 16.41 | False |
| json-build-append | 15.8582 | 9.2969 | 18.4876 | 23.4816 | 16.14 → 34.40 | 16.69 → 11.07 | False |
| json-stringify-doc | 2071.7015 | 1890.1645 | 2186.3722 | 2441.3060 | 34.40 → 25.52 | 10.83 → 13.69 | False |
| map-entries-top-k | 26.6109 | 23.2187 | 21.2952 | 13.5351 | 25.52 → 19.06 | 13.89 → 9.78 | False |
| module-loop-retained | 4.7690 | 3.0569 | 2.4230 | 6.6227 | 19.06 → 15.71 | 9.72 → 9.12 | False |
| objects | 11.7427 | 2.2171 | 2.2976 | 1.6701 | 15.71 → 17.68 | 8.93 → 8.81 | False |
| pipeline | 144.7854 | 157.3076 | 104.7082 | 25.0705 | 19.31 → 25.26 | 8.91 → 9.62 | False |
| record-word-counts | 9.3948 | 4.5364 | 3.0447 | 20.0754 | 25.26 → 18.86 | 10.09 → 9.89 | False |
| release-acyclic | 41.4571 | 37.3124 | 36.1366 | 43.4974 | 19.83 → 15.93 | 10.33 → 9.07 | False |
| sort-objects | 50.4626 | 31.5858 | 35.8901 | 74.0197 | 15.93 → 14.83 | 8.96 → 10.36 | False |
| sort-objects-runs | 52.3269 | 39.3357 | 49.3395 | 86.8722 | 14.83 → 15.58 | 10.44 → 9.94 | False |
| sort-objects-shuffled | 340.5708 | 251.1728 | 277.4182 | 90.7066 | 15.58 → 18.95 | 9.96 → 9.27 | False |
| string-sort-control | 0.2446 | 0.1072 | 0.0859 | 0.1380 | 18.95 → 18.53 | 8.83 → 9.83 | False |
| tree-teardown | 48.0262 | 49.5107 | 27.3950 | 27.1136 | 18.33 → 12.99 | 9.77 → 12.31 | False |

Raw evidence manifest: `/home/akisarou/.cache/nts-scratch/876/helper-final-evidence.json`, SHA-256 `c888d8534d70cf174421238e2c7aacf238b4829a2e705510437194ace6cc42e7`.

## Final conformance and memory proof

The final release compiler passed `tooling/memory/run.sh`: all 78 cases
met both the operation and allocation floors, in naive and elided modes,
with no leaks or changed answers. This includes the sort ownership controls.

The five recorded test262 slices ran sequentially through `admit.ts`'s
`test262-records` owner, with eight census workers and the clean pin
`/home/akisarou/.cache/nts-pins/3313015deaa8/nts`. The pin's compiler SHA-256
was checked against its provenance before running. These are reconciliations
against the existing records, not claims that every attempted case passes.

| Slice | Attempted | Pass-count | Regressed | Changed | Missing | Unstable |
|---|---:|---:|---:|---:|---:|---:|
| language | 8401 | 7014 | 0 | 0 | 0 | 0 |
| builtins | 1085 | 888 | 0 | 0 | 0 | 0 |
| annexb | 12 | 9 | 0 | 0 | 0 | 0 |
| staging | 59 | 54 | 0 | 0 | 0 | 0 |
| harness | 17 | 17 | 0 | 0 | 0 | 0 |

An initial launcher failed before attempting a case because its explicit
`NTS_CENSUS_DIR` was outside the oracle owner's registered temporary. The
retry let `ownCensusScratch` choose that directory and retained the public
`--rows` and `--json` outputs in issue scratch. The failed setup log and
original launcher remain alongside the successful evidence. No passed slice
was discarded or repeated.

After those runs finished, the branch was rebased from `1dccb9d1090c` onto
`3df1845fafc26b20498a0d607b5c8e50dc7432e1`. All 35 task patches are equal
in `git range-diff`; main's intervening commits changed no compiler or
`runtime/c` source. The pre-rebase branch is preserved in
`/home/akisarou/.cache/nts-scratch/876/pre-final-rebase.bundle`.

Raw conformance evidence manifest: `/home/akisarou/.cache/nts-scratch/876/final-conformance-evidence.json`, SHA-256 `fe7d1cd40ad3b6390fb6fc13d611f24fb3dfd675936a20a9f23935c7a1207959`.

## Final inner proof

Checked source: `edbf216ff` (the final changes before this proof record are lint-only).

The full `node tooling/gate/inner.ts` run included agreement on C, LLVM and JVM,
then C and LLVM with reference counting enabled, against main
`3df1845fafc26b20498a0d607b5c8e50dc7432e1`. It ran as
`nts-876-final-inner-3`, with the ordinary inner admission and worker settings.

| Phase | Verdict | Wall seconds (including admission) |
|---|---|---:|
| fmt | PASS | 6 |
| clang-format | PASS | 1 |
| clippy | PASS | 5 |
| build | PASS | 98 |
| tests | PASS | 727 |
| agree c | PASS | 1083 |
| agree llvm | PASS | 818 |
| agree jvm | PASS | 1569 |
| agree c rc | PASS | 1151 |
| agree llvm rc | PASS | 621 |

The crate and backend tests reported 1,897 passes, zero failures and one
existing ignored full-GIR test (`NTS_IMPLEMENTATION_PROJECTS` is not supplied).
The adaptive-sort Node controls, unsigned cursor boundaries, helper-family
sharing and default HotSpot method-size guard passed.

The first launch lacked Node on systemd's PATH and ran no check. The next
two attempts stopped at Clippy: four infallible helper wrappers and an Rc
parameter, then Markdown quoting of `HotSpot` in a test comment. The final
source simplifies those Rust wrappers and borrows that Rc; it emits the same
HIR as the measured source. No sorting policy or runtime code changed.

- `agree c`: 1091 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not comparable (new), 0 not measured, 29 pending, in 920 s
  150053 of 151213 case(s) compared; not compared: 1160 declined, 0 timed out, 0 unreached.
  Unchanged limitation: `wrong, both   typed-array-aliasing                             disagrees, 637 of 643 compared, 6 declined`.
- `agree llvm`: 1091 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not comparable (new), 0 not measured, 29 pending, in 807 s
  150053 of 151213 case(s) compared; not compared: 1160 declined, 0 timed out, 0 unreached.
  Unchanged limitation: `wrong, both   typed-array-aliasing                             disagrees, 637 of 643 compared, 6 declined`.
- `agree jvm`: 1091 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not comparable (new), 0 not measured, 29 pending, in 639 s
  150053 of 151213 case(s) compared; not compared: 1160 declined, 0 timed out, 0 unreached.
  Unchanged limitation: `wrong, both   typed-array-aliasing                             disagrees, 637 of 643 compared, 6 declined`.
- `agree c rc`: 1091 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not comparable (new), 0 not measured, 29 pending, in 706 s
  150053 of 151213 case(s) compared; not compared: 1160 declined, 0 timed out, 0 unreached.
  Unchanged limitation: `wrong, both   typed-array-aliasing                             disagrees, 637 of 643 compared, 6 declined`.
- `agree llvm rc`: 1091 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not comparable (new), 0 not measured, 29 pending, in 619 s
  150053 of 151213 case(s) compared; not compared: 1160 declined, 0 timed out, 0 unreached.
  Unchanged limitation: `wrong, both   typed-array-aliasing                             disagrees, 637 of 643 compared, 6 declined`.

Raw final-inner evidence manifest: `/home/akisarou/.cache/nts-scratch/876/final-inner-evidence.json`, SHA-256 `1649fbfa0a3920c71e9cbec069d7afa2b3ed511f12d7970a97e67859ab9ab72b`.

## JVM namespace audit correction

The first complete landing-check attempt reached the selected checks and
rejected the helper-family spelling in `jvm-members`: `¢nts$` belongs to
the JVM member catalogue. It reported both the lowering source and its
core guard. The ordinary HIR helper names now begin with `¢sort`, and the
JVM emitter applies its own catalogue encoding. No gate exception or sort
policy change is involved. The direct `node tooling/jvm/members.ts --check`
then passed all 28 member sources.

Earlier setup attempts ran no landing tests: one needed the tree's installation
catalog republished after rebasing, and the next launcher lacked the login
shell's `JAVA_HOME` and `ANDROID_HOME`. The tree's own offline linker refreshed
the catalog; the launcher now supplies both SDK paths and the full host PATH.
All of those logs remain in the issue scratch. The namespace-failing run was
stopped through its own `nts-876-final-here-3` unit before changing sources.

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

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

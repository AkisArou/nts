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

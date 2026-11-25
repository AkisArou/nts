# Releases specialized by type (#878)

This record holds the evidence for #878, stage 1 of the memory ladder under
#513. Releasing a reference whose static type names a layout now calls a
release made for that layout, instead of `nts_release` and the generic death
path (`nts_release_counted`, `nts_destroy`, the descriptor's `release_fields`).
The cycle collector's four walks call a layout's own `trace_fields` directly
where it has one, instead of going through `nts_each_reference`.

## What a typed release is

A static type is a lower bound on a layout: a slot typed `Leaf` can hold any
object laid out like `Leaf`, a subclass included. So
`__nts_typed_release_<layout>` first checks the object's descriptor against
every descriptor of that layout: the shape's own, plus one for each class that
shares it. On a mismatch, or a null, it calls `nts_release`. On a match it
does what `nts_release` and `nts_destroy` would do for that object:

| Generic death does | The typed release does |
|---|---|
| returns at once for `NTS_IMMORTAL` (regions, frames, static closures) | the same |
| returns for an object already dying (`NTS_DYING`) | the same |
| decrements a count above one, and buffers a cyclic candidate | decrements; an eligible layout is acyclic, and `nts_possible_root` buffers only cyclic descriptors and holders, so nothing is skipped |
| at zero: count word to 0, `NTS_DYING` set, then `release_fields` | the same, each field released by its own typed release when it has one, otherwise `nts_release` |
| `release_foreign`, side storage for arrays, maps and strings | not reachable: an eligible layout has no erased or foreign field, and its kind is `OBJECT` or `TUPLE` |
| `reclaimed++`, `nts_free_block` (its poison and buffered checks included) | `nts_object_reclaim`: `reclaimed++`, `typed_deaths++` under counting, then `nts_free_block` |
| assertions under `NTS_POISON` | the same, and `nts_object_reclaim` additionally aborts if the object is not dying, still counted, cyclic, foreign or of another kind |

Weak references are not implemented in the runtime, so no typed release can
miss one. The collector never calls a typed release. A nested generic death
or collection cannot reach a count-zero acyclic object, because nothing
buffers it.

**Eligibility** comes from the cycle graph (`program.cycles()`), never from a
declaration. A layout gets a typed release only when an object of it is made
by the program's own code, the graph proves it acyclic, it has no erased
(`unknown` or `any`) field, and no field is counted another way.
`TypedReleases::plan` (`compiler/codegen/common/src/release.rs`) decides once
for both C and LLVM. A layout that is acyclic only because an erased field
hides what it holds gets no typed release (`Opaque` in the graph test).

**Depth is bounded.** A typed release calls its children's typed releases
inline to `TYPED_RELEASE_DEPTH` (8) frames. A child at that depth releases
through `nts_release`, which drains the dying list without recursion. The
graph test checks a ten-class chain at the boundary: depth 8 is typed, depth 9
is not.

A reference array whose element type has a typed release gets its own
descriptor (`__nts_typed_array_<layout>`), whose slot walker calls the
element's typed release. Its element type must not reach a cycle
(`Cycles::array`).

## Instrument

Both arms are release builds made in this tree:

| Arm | Content | `nts-bench` SHA-256 |
|---|---|---|
| before | main at `36edc25876c9` (a temporary revert commit, then reset) | `7cb8c35f5d65d75731f00ed9bc78f8f968a4f42419d4827808eab56237c4f2e7` |
| after | `e0003ba25230`, the change on that main | `c8bd614077feb70a77a9397961f28a53cde43b3e85d1ddc9b626660c13bc849e` |

`nts-bench --root <tree> --count --group memory` ran on CPU 0 under other
agents' load. The count is net user instructions per operation, so load does
not move it. Each nts column's band is 1 basis point. In both arms the node
oracle's probe sometimes counted fewer instructions than its empty bracket,
which fails the row; the nts columns are read from each row's retained
`net-count.json` (instructions ÷ operations), the value the table prints.

The perf profiles compile each benchmark case with `work` called 3000 times,
as a standalone native program (`--rc`, clang `-O2 -flto=thin`), on CPU 6,
with main's pin `~/.cache/nts-pins/36edc25876c9/nts` against the after build.

The timed sittings ran under `with-lock.sh --wait --key bench-session` on
CPU 4, before then after. Load averages ran from 35 to 139 during the before
sitting and from 31 to 70 during the after sitting. Ratios are within each
sitting; a change is the after ratio over the before ratio.

The raw outputs are kept in `~/.cache/nts-scratch/878/`:

| File | SHA-256 |
|---|---|
| `arms/count-before.txt` | `39b929752cc4b3af6339d0c8253c0019b1c87d61353966072dc6dce28a369d2c` |
| `arms/count-after.txt` | `8e3f9eb45e3b8e2a1e7f504c80d45a47548be6c5842c50954ace357d84b8c9d1` |
| `arms/before-net.tar` | `d11df712272e7842c14e926b7df9c9ca7078ecd6b0d35519fd8fe2150e3e9f7e` |
| `arms/after-net.tar` | `c34cc5ea6ca096c501805713f2a0f8c8d8f6f7d9ec76a1e267ff7b40e32d6853` |
| `profile/reports.tar` | `356c6f323ea28629978adbc7ac4f3ed7370b98967875d90942d970f867af8e9b` |
| `sittings/before-memory/…-12c247337cf74d108f5f130e789f0e97-sitting.json` | `3dc8111816715f8c3fa0830e249ffb62b508ba729ffbef6d87d51fed2978856e` |
| `sittings/after-memory/…-42eddb43f57344459a955f20cd4e584d-sitting.json` | `3e2621b8a6dda4675f6f797784dd06161b171be6bd17a148e652f3eba0aa4b69` |
| `sittings/before-size/…-af2ccfbb0e834c72a238858f3c198d3d-sitting.json` | `9ac2fdd3ce190ed29ee4634a7e60139c70c4a0b3c3751609322f23f442a42562` |
| `sittings/after-size/…-36bb6201998b46e09289cf317ad9c2b6-sitting.json` | `a0c37512c8ccf31801c6e6622a3eb8c3061715009f6864833314b8c2f022e0e2` |
| `logs/t262.log` | `dc68821718cca57efed3f8095a945514847a5562ef899d0e941548d729c9b71b` |

## The walker's share

| Row | Backend | Before: generic death or walk | After |
|---|---|---|---|
| release-acyclic | C | `nts_destroy` 33.7%, `nts_release_counted` 12.2%, `nts_release_reference_slots` 2.0%, `__nts_release_fields_NtsObj_Pair` 4.2% | gone; `__nts_typed_slots_NtsObj_Pair` 27.9% (the typed array walk and the `Pair` deaths it calls inline), `nts_destroy` 0.3% |
| release-acyclic | LLVM | `nts_destroy` 35.0%, `nts_release_counted` 13.0%, slots 1.9%, `Pair` fields 3.7% | gone; `__nts_typed_slots_Pair` 26.3% |
| cyclic-churn | C | `nts_each_reference` 13.3% | gone; `nts_collect_pass` 59.1%, `__nts_trace_fields_NtsObj_Link` 6.2% |
| cyclic-churn | LLVM | `nts_each_reference` 12.7% | gone; `nts_collect_pass` 60.4%, `__nts_trace_fields_Link` 5.7% |
| tree-teardown | both | region teardown only; `nts_destroy` 0.6% | unchanged |

Whole-program user instructions for the same programs:

| Row | Backend | Before | After | Change |
|---|---|---:|---:|---:|
| release-acyclic | C | 13,097,199,754 | 7,015,478,471 | −46.4% |
| release-acyclic | LLVM | 13,097,318,362 | 7,015,479,656 | −46.4% |
| cyclic-churn | C | 14,482,518,545 | 12,379,507,733 | −14.5% |
| cyclic-churn | LLVM | 14,482,517,242 | 12,379,507,793 | −14.5% |
| tree-teardown | C | 4,480,662,571 | 4,480,662,605 | +0.0% |
| tree-teardown | LLVM | 4,480,662,591 | 4,480,662,585 | −0.0% |

## Counts

| Row | Column | Before | After | Change | Verdict |
|---|---|---:|---:|---:|---|
| array-copying-methods | nts C | 481,928 | 481,932 | +4 (+0.00%) | within the band |
| array-copying-methods | nts LLVM | 537,932 | 537,932 | 0 | unchanged |
| awfy-towers | nts C | 751,765 | 751,765 | 0 | unchanged |
| awfy-towers | nts LLVM | 735,350 | 735,350 | 0 | unchanged |
| cyclic-churn | nts C | 1,965,234 | 1,677,102 | −288,132 (−14.66%) | improvement |
| cyclic-churn | nts LLVM | 1,971,383 | 1,683,251 | −288,132 (−14.62%) | improvement |
| event-state | nts C | 1,668 | 1,621 | −47 (−2.82%) | improvement |
| event-state | nts LLVM | 1,666 | 1,617 | −49 (−2.94%) | improvement |
| immutable-update | nts C | 2,022,670 | 1,937,699 | −84,971 (−4.20%) | improvement |
| immutable-update | nts LLVM | 2,024,713 | 1,940,805 | −83,908 (−4.14%) | improvement |
| json-build-append | nts C | 222,777 | 222,777 | 0 | unchanged |
| json-build-append | nts LLVM | 222,777 | 222,777 | 0 | unchanged |
| json-stringify-doc | nts C | 27,152,267 | 26,668,953 | −483,314 (−1.78%) | improvement |
| json-stringify-doc | nts LLVM | 26,977,148 | 26,530,410 | −446,738 (−1.66%) | improvement |
| map-entries-top-k | nts C | 383,484 | 371,593 | −11,891 (−3.10%) | improvement |
| map-entries-top-k | nts LLVM | 394,949 | 382,666 | −12,283 (−3.11%) | improvement |
| module-loop-retained | nts C | 262,197 | 262,196 | −1 | within the band |
| module-loop-retained | nts LLVM | 262,197 | 262,197 | 0 | unchanged |
| objects | nts C | 27,684 | 27,684 | 0 | unchanged |
| objects | nts LLVM | 27,684 | 27,684 | 0 | unchanged |
| pipeline | nts C | 239,298 | 239,298 | 0 | unchanged |
| pipeline | nts LLVM | 239,298 | 239,298 | 0 | unchanged |
| record-word-counts | nts C | 152,642 | 152,643 | +1 | within the band |
| record-word-counts | nts LLVM | 154,113 | 154,113 | 0 | unchanged |
| release-acyclic | nts C | 1,746,297 | 935,430 | −810,867 (−46.43%) | improvement |
| release-acyclic | nts LLVM | 1,746,317 | 935,407 | −810,910 (−46.44%) | improvement |
| sort-objects | nts C | 436,884 | 416,442 | −20,442 (−4.68%) | improvement |
| sort-objects | nts LLVM | 448,948 | 440,774 | −8,174 (−1.82%) | improvement |
| sort-objects-runs | nts C | 608,611 | 584,103 | −24,508 (−4.03%) | improvement |
| sort-objects-runs | nts LLVM | 613,697 | 613,724 | +27 (+0.00%) | within the band |
| sort-objects-shuffled | nts C | 1,393,216 | 1,368,723 | −24,493 (−1.76%) | improvement |
| sort-objects-shuffled | nts LLVM | 1,499,915 | 1,499,945 | +30 (+0.00%) | within the band |
| string-sort-control | nts C | 2,262 | 2,262 | 0 | unchanged |
| string-sort-control | nts LLVM | 2,326 | 2,326 | 0 | unchanged |
| tree-teardown | nts C | 597,435 | 597,442 | +7 (+0.00%) | within the band |
| tree-teardown | nts LLVM | 597,436 | 597,436 | 0 | unchanged |

No row's count got worse past its band. The executable-size rows are launch
rows, timed and never counted.

## Timed sittings

Each cell is the before sitting's ratio and verdict, then the after
sitting's, then after ÷ before.

| Row | nts C/node | nts LLVM/node | nts C/Bun AOT | nts LLVM/Bun AOT |
|---|---|---|---|---|
| array-copying-methods | 0.320× WON → 0.325× WON (1.016×) | 0.333× WON → 0.335× WON (1.006×) | 0.455× WON → 0.455× WON (1.000×) | 0.473× WON → 0.468× WON (0.989×) |
| awfy-towers | 0.812× SHORT → 0.808× SHORT (0.995×) | 0.790× WON → 0.795× WON (1.006×) | 0.842× WON → 0.855× WON (1.015×) | 0.820× WON → 0.842× WON (1.027×) |
| cyclic-churn | 4.631× LOSS → 3.964× LOSS (0.856×) | 4.404× LOSS → 4.046× LOSS (0.919×) | 5.768× LOSS → 4.342× LOSS (0.753×) | 5.485× LOSS → 4.432× LOSS (0.808×) |
| event-state | 0.075× WON → 0.074× WON (0.987×) | 0.074× WON → 0.073× WON (0.986×) | 0.824× WON → 0.791× WON (0.960×) | 0.807× WON → 0.781× WON (0.968×) |
| immutable-update | 0.680× WON → 0.607× WON (0.893×) | 0.685× WON → 0.614× WON (0.896×) | 0.767× WON → 0.564× WON (0.735×) | 0.773× WON → 0.572× WON (0.740×) |
| json-build-append | 0.542× WON → 0.601× WON (1.109×) | 0.569× WON → 0.576× WON (1.012×) | 0.488× WON → 0.548× WON (1.123×) | 0.512× WON → 0.525× WON (1.025×) |
| json-stringify-doc | 0.886× SHORT → 0.567× WON (0.640×) | 0.687× WON → 0.670× WON (0.975×) | 0.834× WON → 0.501× WON (0.601×) | 0.647× WON → 0.592× WON (0.915×) |
| map-entries-top-k | 0.586× WON → 0.550× WON (0.939×) | 0.591× WON → 0.552× WON (0.934×) | 0.751× WON → 0.696× WON (0.927×) | 0.758× WON → 0.699× WON (0.922×) |
| module-loop-retained | 1.825× LOSS → 2.010× LOSS (1.101×) | 1.771× LOSS → 1.951× LOSS (1.102×) | 3.351× LOSS → 3.491× LOSS (1.042×) | 3.252× LOSS → 3.390× LOSS (1.042×) |
| objects | 0.139× WON → 0.139× WON (1.000×) | 0.140× WON → 0.136× WON (0.971×) | 0.743× WON → 0.723× WON (0.973×) | 0.746× WON → 0.712× WON (0.954×) |
| pipeline | 0.183× WON → 0.227× WON (1.240×) | 0.183× WON → 0.226× WON (1.235×) | 0.285× WON → 0.328× WON (1.151×) | 0.286× WON → 0.326× WON (1.140×) |
| record-word-counts | 0.529× WON → 0.554× WON (1.047×) | 0.518× WON → 0.534× WON (1.031×) | 1.600× LOSS → 1.688× LOSS (1.055×) | 1.564× LOSS → 1.627× LOSS (1.040×) |
| release-acyclic | 1.637× LOSS → 1.088× LOSS (0.665×) | 1.684× LOSS → 1.112× LOSS (0.660×) | 2.693× LOSS → 1.603× LOSS (0.595×) | 2.770× LOSS → 1.638× LOSS (0.591×) |
| sort-objects | 0.544× WON → 0.516× WON (0.949×) | 0.559× WON → 0.533× WON (0.953×) | 0.731× WON → 0.725× WON (0.992×) | 0.751× WON → 0.749× WON (0.997×) |
| sort-objects-runs | 0.600× WON → 0.516× WON (0.860×) | 0.610× WON → 0.527× WON (0.864×) | 0.654× WON → 0.582× WON (0.890×) | 0.665× WON → 0.594× WON (0.893×) |
| sort-objects-shuffled | 0.489× WON → 0.516× WON (1.055×) | 0.492× WON → 0.487× WON (0.990×) | 0.596× WON → 0.631× WON (1.059×) | 0.600× WON → 0.595× WON (0.992×) |
| string-sort-control | 0.440× WON → 0.400× WON (0.909×) | 0.431× WON → 0.398× WON (0.923×) | 1.255× LOSS → 1.159× LOSS (0.924×) | 1.228× LOSS → 1.153× LOSS (0.939×) |
| tree-teardown | 0.427× WON → 0.442× WON (1.035×) | 0.460× WON → 0.450× WON (0.978×) | 0.824× WON → 0.822× WON (0.998×) | 0.888× WON → 0.838× WON (0.944×) |

release-acyclic and cyclic-churn both move on both backends. release-acyclic
still loses to node (1.09×, 1.11×) and Bun: stage 3's regions hold that row,
as the memory page says. cyclic-churn still loses by about 4×: what remains is
the collector itself (`nts_collect_pass`), which M6 leaves for later.

Three rows moved the wrong way in time without moving in count. `pipeline`'s
emitted C differs from main's only by the new `NTS_DYING` static assert, so
its 1.24× is the sitting's noise under that load. `module-loop-retained`
gains a typed release for a closure cell, and `json-build-append` counts
exactly the same in both arms; neither count moved. A count is the landing
evidence for a code-generation change; these timings are noise, not
regressions.

The after sitting, every comparison:

| Row | nts C/node | nts C/Bun JIT | nts C/Bun AOT | nts C/ScriptC | nts LLVM/node | nts LLVM/Bun JIT | nts LLVM/Bun AOT | nts LLVM/ScriptC |
|---|---|---|---|---|---|---|---|---|
| array-copying-methods | 0.325× WON | 0.393× WON | 0.455× WON | 0.726× WON | 0.335× WON | 0.405× WON | 0.468× WON | 0.748× WON |
| awfy-towers | 0.808× SHORT | 1.277× LOSS | 0.855× WON | 0.311× WON | 0.795× WON | 1.258× LOSS | 0.842× WON | 0.307× WON |
| cyclic-churn | 3.964× LOSS | 2.904× LOSS | 4.342× LOSS | 1.587× LOSS | 4.046× LOSS | 2.964× LOSS | 4.432× LOSS | 1.619× LOSS |
| event-state | 0.074× WON | 0.614× WON | 0.791× WON | 0.741× WON | 0.073× WON | 0.605× WON | 0.781× WON | 0.731× WON |
| immutable-update | 0.607× WON | 0.529× WON | 0.564× WON | 1.938× LOSS | 0.614× WON | 0.536× WON | 0.572× WON | 1.962× LOSS |
| json-build-append | 0.601× WON | 1.125× LOSS | 0.548× WON | 0.410× WON | 0.576× WON | 1.078× LOSS | 0.525× WON | 0.392× WON |
| json-stringify-doc | 0.567× WON | 0.490× WON | 0.501× WON | 0.444× WON | 0.670× WON | 0.578× WON | 0.592× WON | 0.524× WON |
| map-entries-top-k | 0.550× WON | 0.657× WON | 0.696× WON | 1.155× LOSS | 0.552× WON | 0.660× WON | 0.699× WON | 1.159× LOSS |
| module-loop-retained | 2.010× LOSS | 2.736× LOSS | 3.491× LOSS | 1.417× LOSS | 1.951× LOSS | 2.657× LOSS | 3.390× LOSS | 1.376× LOSS |
| objects | 0.139× WON | 0.756× WON | 0.723× WON | 0.984× TIE | 0.136× WON | 0.745× WON | 0.712× WON | 0.969× TIE |
| pipeline | 0.227× WON | 0.206× WON | 0.328× WON | 1.175× LOSS | 0.226× WON | 0.205× WON | 0.326× WON | 1.167× LOSS |
| record-word-counts | 0.554× WON | 1.173× LOSS | 1.688× LOSS | 0.261× WON | 0.534× WON | 1.131× LOSS | 1.627× LOSS | 0.252× WON |
| release-acyclic | 1.088× LOSS | 1.579× LOSS | 1.603× LOSS | 1.353× LOSS | 1.112× LOSS | 1.614× LOSS | 1.638× LOSS | 1.382× LOSS |
| sort-objects | 0.516× WON | 0.827× SHORT | 0.725× WON | 0.336× WON | 0.533× WON | 0.855× SHORT | 0.749× WON | 0.348× WON |
| sort-objects-runs | 0.516× WON | 0.749× WON | 0.582× WON | 0.376× WON | 0.527× WON | 0.765× WON | 0.594× WON | 0.384× WON |
| sort-objects-shuffled | 0.516× WON | 0.681× WON | 0.631× WON | 1.869× LOSS | 0.487× WON | 0.642× WON | 0.595× WON | 1.762× LOSS |
| string-sort-control | 0.400× WON | 0.938× SHORT | 1.159× LOSS | 0.732× WON | 0.398× WON | 0.933× SHORT | 1.153× LOSS | 0.728× WON |
| tree-teardown | 0.442× WON | 0.427× WON | 0.822× WON | 1.044× TIE | 0.450× WON | 0.435× WON | 0.838× WON | 1.064× TIE |

Executable size: `size-hello` is 494.7 KiB before and 494.8 KiB after
(stripped 103.2 KiB in both; 0.007× Bun AOT, WON; 7.61× ScriptC unstripped
and 1.99× stripped, LOSS, in both). `size-json` and `size-flight-planner` are
refused by nts C and LLVM in both arms, so they have no ratio.

## Exactness

- `tests/memory` stays at its minimum: every case passes with its expected
  operations and allocations. `run.sh` now also checks an optional `typed N`
  line: the deaths taken by a typed release (`nts_counted_typed_deaths`).
- `field-holds-subtype` stores a `Heavy` (a `Leaf` subclass with one more
  field) in a slot typed `Leaf`. Its control `field-holds-subtype-control`
  stores a plain `Leaf`. `array-holds-subtype` and its control do the same
  through an array. All four pass on an earlier main's pin
  (`~/.cache/nts-pins/d9941ea0f4e8`) with the same operation and allocation
  counts and no leak. With the descriptor check removed (a committed
  sabotage, applied to the emitted C), both subtype fixtures leak five
  objects.
  After the change, the `typed` line shows the deaths going through typed
  releases: 15, 15, 10 and 10.
- `tests/programs/a-field-holding-a-subtype-is-released` agrees with node.
- All four memory fixtures and the program fixture pass plain, under
  `NTS_RC=1 NTS_POISON=1` and under ASan, on C and LLVM.
- `typed_releases_follow_the_proved_layout_graph` (LLVM crate) emits C and
  LLVM for a layout graph and checks the plan (an erased field and a cyclic
  ring get none; the chain is typed to depth 8 and not at 9). It runs both
  programs, and runs a mutant that assumes the static layout, which must
  fail.
- The five test262 records (language, built-ins, annexB, staging, harness)
  have 0 regressed, 0 changed and 0 missing cases. `inner.ts` with agree
  passed on C, LLVM, the JVM and both RC columns.

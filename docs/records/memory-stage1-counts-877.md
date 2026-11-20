# Stage 1 ownership-count inventory

This census addresses #877 under #513. Its source revision is main's
`f59a533044b346c62749292ccbc08c48a9b08e90`. The clean release pin at
`~/.cache/nts-pins/b9dd04e8fa8b/nts` was built from
`b9dd04e8fa8b73cf4e0f197ff74105d404e7952c`, the pre-landing build identity
that landed as `f59a533044`; the build commit itself is not on main.
The coordinator retained it through
`refs/cited/b9dd04e8fa8b73cf4e0f197ff74105d404e7952c`.
The compiler's SHA-256 is
`f1572974d9bc1c104c3801afbbc4119ecad5614b282df4348ad51ff26c73f601`.
All five workloads and their instruction counts use this one compiler.

The following comparisons both exit 0. They establish byte-identical
`compiler/`, `runtime/`, CLI/build inputs and all five benchmark case trees
between the pin's build identity, the source revision on main, and this
record's base `0e8ba833a42b532e3d132bb89feb98b5cfa32d10`:

```sh
for revision in \
  f59a533044b346c62749292ccbc08c48a9b08e90 \
  0e8ba833a42b532e3d132bb89feb98b5cfa32d10; do
  git --no-optional-locks diff --quiet \
    b9dd04e8fa8b73cf4e0f197ff74105d404e7952c "$revision" -- \
    compiler runtime tooling/cli Cargo.toml Cargo.lock \
    benchmarks/common tsconfig.fixtures.json \
    benchmarks/cases/{sort-objects,release-acyclic,cyclic-churn,map-entries-top-k,awfy-towers} \
    || exit
done
```

## Instrument and controls

The executable workload is each row's numeric entry called with its exported
`seed`: `work(0)` for sort-objects, release-acyclic and cyclic-churn,
`topWords(3)` for map-entries-top-k, and `work(1)` for awfy-towers.
Module initialization, the checksum call and the counter's exact fixed warm-up
precede observation. The census measures the counter's same fixed repetition
count and normalizes to one workload call. Production
collection during a call is included; an extra forced collection is excluded.
The two memory controls instead follow `tooling/memory/harness.c`, forcing
collection outside the count window to check live-object balance.

Instrumentation exists only in emitted scratch copies. It wraps direct calls
and function-pointer uses of `nts_retain`, `nts_release`, `nts_value_retain`
and `nts_value_release`, retaining the original operation. Each observation
names the original emitted file and line, the outer ownership operation, the
immediate caller operation, the descriptor and the incoming reference state.
The low-level retain/release totals must equal `NTS_COUNT_OPERATIONS` exactly.
Erased-operation attempts are reported separately: a scalar tag performs no
low-level count operation. Null, immortal and dying-object early returns remain
executed operations, separately identified from live reference changes.

The plain executable uses the shipping native flags: `-O2 -ffp-contract=off
-fno-math-errno -flto=thin -march=x86-64-v3 -falign-loops=32`, with
`-Wl,-plugin-opt=-align-loops=32`, RC and debug information for attribution.
The instruction denominator uses the repository's canonical benchmark driver
and `tooling/bench/count-driver.ts`: fixed work calibrated by instructions,
matched warm-up and empty-bracket subtraction, on CPU 0. The ownership census
uses the same emitted program, input and work counts. Callgrind observes
uninstrumented program/runtime objects linked with the same numeric driver;
only the canonical harness has Valgrind start/stop markers around its measured
loop. Its source-attributed instruction counts are distinguished from the
native PMU denominator.

Raw evidence, the exact instrument, generated sources, command receipts and
outputs are kept under `~/.cache/nts-scratch/877/`. No compiler, runtime or
benchmark source is changed by this task.

## Census

All counts below are per workload call. The actual observed brackets contain
71, 55, 69, 242 and 107 calls respectively; these are the native counter's
instruction-calibrated repetitions, with the same warm-up. The two controls
each measure one call after one warm-up. Retain/release columns count arrivals
at the low-level operations, including null. Erased-wrapper attempts are
additional observations of those operations' dispatch, **not additive counts**.

| Row | Retains | Releases | Erased retain attempts | Erased release attempts | Native instructions/call |
|---|---:|---:|---:|---:|---:|
| sort-objects | 8,192 | 8,497 | 0 | 0 | 1,411,192.31 |
| release-acyclic | 0 | 12,304 | 0 | 0 | 1,832,669.36 |
| cyclic-churn | 9,984 | 9,985 | 0 | 0 | 2,375,868.45 |
| map-entries-top-k | 1,848 | 2,258 | 3,476 | 1,846 | 414,057.40 |
| awfy-towers | 8,208 | 8,224 | 0 | 0 | 941,643.85 |
| borrowed-call control | 0 | 1 | 0 | 0 | not a benchmark row |
| erased-slot control | 0 | 0 | 0 | 0 | not a benchmark row |

Every row's instrumented low-level totals equal the ordinary
`NTS_COUNT_OPERATIONS` build exactly. All three executables (plain, ordinary
counters, site counters) give Node's answer. Both repetitions of every census
are byte-identical. The ordinary-counter and site-counter allocation totals
also agree. Both memory controls have zero live-object growth after collection.
`borrowed-call` executes only `program.c:93`'s release of the region handle:
33 links plus one handle are its 34 allocations. `erased-slot` has no allocation,
no low-level operation and no erased-wrapper attempt. Thus the minimum control
has **zero unexplained operations**, and the zero control produces none.

## Every executed site

Locations are in the original emitted `base/` files in the cited scratch
directory. `P` means `program.c`; `R` means `nts_runtime.c`. Generated clone
names and source HIR are retained in the raw evidence. A callback's location is
the site that installs it, with its outer release shown below; this covers
`nts_release` passed to `nts_each_reference`, not just textual call expressions.
The scratch summaries infer function labels heuristically; original file/line
locations checked against the emitted C determine the attribution below.
The tables partition the low-level totals exactly. Erased dispatch is detailed
separately afterward.

### sort-objects

| Site | Retains | Releases | Reason and owner |
|---|---:|---:|---|
| R:3411, from `nts_array_slice_ref` | 4,096 | 0 | 256 snapshot elements × 16 sorts; #876 |
| P:898 | 4,096 | 0 | sorted writeback takes an owned copy; #876 |
| P:909 | 0 | 4,096 | writeback gives up the old element; #876 |
| P:920 → R:1902 callback | 0 | 4,096 | snapshot's element references; #876 |
| P:920 | 0 | 16 | snapshot arrays; #876 |
| P:883 and P:921 | 0 | 32 | the two integer permutation buffers, once per sort |
| P:963 → R:1902 callback | 0 | 256 | final `Item` array contents |
| P:963 | 0 | 1 | final `xs` array |

The merge loop itself already has no count operations, as be0ca2e1b7 intended.
Removing the observed snapshot/writeback traffic leaves **0 retains and 289
releases**: 32 integer buffers, 256 Items and their array. This is the residual
inventory conditional on #876 removing those sites, not a measurement of #876's
unlanded implementation. No new count-free-sort card is warranted.

### release-acyclic

| Site | Retains | Releases | Reason and mechanism |
|---|---:|---:|---|
| P:359 | 0 | 16 | one owning array per batch |
| P:359 → R:1902 callback | 0 | 4,096 | the arrays' `Pair` elements; generic array contents traversal |
| P:37 | 0 | 4,096 | each Pair's left Leaf, already a specialized contents callback |
| P:38 | 0 | 4,096 | each Pair's right Leaf, already a specialized contents callback |

All 12,304 releases give up real owning references. The object-field walker has
already been specialized; the remaining generic walker is the array's loop.
Specializing that loop changes dispatch and inlining, not the number of child
references that must be released. Per-object destruction and allocator work
remain stage 3's region opportunity, as memory.md explicitly requires.

### cyclic-churn

| Site | Retains | Releases | Reason and mechanism |
|---|---:|---:|---|
| P:638 / P:667 | 1,984 | 1,984 | copy `old` from the ring across the null-check branches |
| P:640 / P:662 | 1,984 | 1,984 | first `old.child` read |
| P:666 / P:689 | 1,984 | 1,984 | second `old.child` read |
| P:688 / P:710 | 1,984 | 1,984 | `old.child.parent` read |
| P:722 | 2,048 | 0 | parent has two owners: child.parent and the ring |
| P:737 | 0 | 1,984 | replacement gives up the ring's old reference |
| P:835 → R:1902 callback | 0 | 64 | final ring contents |
| P:835 | 0 | 1 | final ring array |

The first four pairs total **15,872 operations**. All their field reads finish
before this iteration replaces a ring slot; no call or store intervenes in the
observation. The ring keeps the old graph alive during those reads. The
conservative cross-block borrow proof nevertheless treats the later mutation
as an invalidator. This is a borrow window ending at the last borrow, not a
reason to eliminate the 2,048 genuine shared parent references. The final
read-only traversal of the ring already emits no element copies. The Link
contents and tracing callbacks are also already specialized. Collector trial
counts, graph visits and candidate bookkeeping are different operations from
the retain/release entry counts here; their instruction cost is not claimed as
an extra removable stage-1 share.

### map-entries-top-k

| Site or outer release | Retains | Releases | Reason and mechanism |
|---|---:|---:|---|
| P:954 → R:1856 / P:983 → R:1880 | 1,024 | 1,024 | temporary erased vocabulary key copied around `entry` get/set; one count per map key |
| R:10928 → R:1856 | 202 | 0 | first insertion gives the map its key reference |
| R:11433 → R:1856 | 202 | 0 | cursor gives the new tuple its own key reference |
| R:3411 from snapshot / P:1195 | 404 | 0 | 202 snapshot copies and 202 writeback copies; #876 |
| P:1206 | 0 | 202 | old writeback references; #876 |
| P:1217 → R:1902 callback | 0 | 202 | snapshot contents; #876 |
| P:1217 | 0 | 1 | snapshot array; #876 |
| R:3411 from the final slice | 16 | 0 | the top sixteen outlive the full entries array |
| P:1025 | 0 | 202 | overwritten slots in the newly zero-filled entries array: all null |
| P:1040 | 0 | 1 | map itself |
| P:1040 → R:1902 callback | 0 | 202 | map's key references |
| P:1180 / P:1218 | 0 | 2 | integer permutation buffers |
| P:1222 → R:1902 callback | 0 | 202 | original entries array's tuple references |
| P:1222 | 0 | 1 | original entries array |
| P:1261 → R:1902 callback | 0 | 16 | final slice's tuple references |
| P:1261 | 0 | 1 | final slice array |
| P:39 in tuple destruction | 0 | 202 | tuples' key references, already specialized |

The keys in the global vocabulary remain alive throughout. Updating a map
does not require copying that lookup argument on every round. Its actual
key store already retains only on first insertion: 202 times, not 1,024.
Removing the lookup temporaries therefore preserves the map's 202 references
and the 202 distinct tuple references. Calling the latter duplicates would
confuse two real owners with the unnecessary transient owner.

After the observed #876 sites disappear, this inventory leaves **1,444 retains
and 1,853 releases**, before addressing key temporaries or null slots.
Of these, 1,024 retain/release pairs are the key-temporary opportunity and
202 releases are of known-zero result slots.

Erased dispatch adds the following observations. They do not add to the
low-level totals above:

| Erased site | Retain attempts | Release attempts | What actually happens |
|---|---:|---:|---|
| P:954 / P:983 | 1,024 | 1,024 | managed string key; counted above |
| R:10928, `nts_map_insert_at` key | 202 | 0 | managed string key; counted above |
| R:11433, `nts_map_key_at` | 202 | 0 | managed string key; counted above |
| R:11035, `nts_map_entry_get` | 822 | 0 | number, no low-level retain |
| R:10917 / R:10918, `nts_map_overwrite` | 822 | 822 | new/old number; no low-level count change |
| R:10930, inserted map value | 202 | 0 | number, no low-level retain |
| R:11441, `nts_map_value_at` | 202 | 0 | number, no low-level retain |

Most retains of newly constructed numeric erased values already disappear
under native optimization. The old-value release and cursor value read still
execute tag dispatch. An erased-value slice must preserve the real contract
when an alias widens or changes the map's value representation; this row's
scalar observations alone do not authorize removing a general helper's counts.

### awfy-towers: its cause

| Site | Retains | Releases | Reason and mechanism |
|---|---:|---:|---|
| P:334, `Towers__pushDisk` | 8,205 | 0 | copy the borrowed disk parameter into the pile |
| P:399, `Towers__moveTopDisk` | 0 | 8,191 | caller gives up the popped disk after `pushDisk` |
| P:430, `Towers__buildTowerAt` | 0 | 14 | caller gives up the newly made disk after `pushDisk` |
| R:3411 / R:3415 in array fill | 3 | 3 | null values copied and replaced by `fill(null)` |
| P:253, `Towers__benchmark` | 0 | 1 | replace the initially null `piles` field |
| P:493 | 0 | 1 | owning piles array at workload exit |
| P:493 → R:1902 callback | 0 | 2 | the two non-null pile heads |
| P:108, disk contents callback | 0 | 12 | the other disks reached through `next` |

**The dominant remaining cost is the borrowed public-parameter convention at
`pushDisk`, not allocation or a missing move out of the pile.** The prepared
HIR marks `Towers#pushDisk` exported. `own::summarize` adds the EntrySurface's
published functions to `lent`, excluding them from consuming-parameter inference.
That is necessary for a published caller that lends its argument. Consequently
`pushDisk` retains at its store and its two direct callers release immediately
after the call, even though each has an owned disk it could hand over.

The emitted `popDiskFrom` already moves the pile head out and moves its `next`
back into the pile, with no count operation. The graph is not reallocated per
move: the observed workload makes only 15 allocations (fourteen disks and one
array). All 8,205 push retains arrive at count one and the matching caller
releases arrive with another reference present. The typed disk destruction
callback is already specialized. Neither shorter anchor lifetime, erased-value
release specialization nor count-free sorting removes this public ABI pair.

A separate consuming internal entry, with the public borrowed entry enforcing
its boundary, could remove these pairs for direct callers. Dropping the public
retain unconditionally would be wrong. This is a distinct ownership/entry
specialization slice, not a claim that the five named stage-1 mechanisms alone
cover Towers. The four null releases and three null retains are separately
accounted for; they are not its performance cause.

## Instruction shares and follow-ups

The published C count band is **1 basis point = 0.01%**, from the shared native
cohort in `results/benchmarks/count-bands.json`. This is a column band applied
to these rows, not five newly measured row-specific bands. Its per-call
thresholds are 141.12 instructions for sort-objects, 183.27 for release-acyclic,
237.59 for cyclic-churn, 41.41 for map-entries-top-k and 94.16 for awfy-towers.

The following ranking uses **instruction share, not call share**. The numerator
is the source-attributed machine instructions executed in the uninstrumented
program's selected ownership paths; the denominator is the same pin's native
instruction count above. Inline stacks resolve the operation's original source
site. Only direct count-path instructions are charged to the first four slices:
no allocator cost, dependent teardown, collector work or guessed saving is added.
The generic array row counts the walker's own instructions, excluding child
release/destruction, but includes the loop that a specialized implementation
will still need. These are measured current costs and opportunity bounds,
not before/after improvements or promises to remove every instruction listed.

| Order | Slice | Row | Attributed instructions/call | Share | Follow-up |
|---|---|---|---:|---:|---|
| 1 | internal consuming entry with a borrowed published boundary | awfy-towers | 241,999.00 | 25.6996% | #900 |
| 2 | borrow window ends at last borrow, before later mutation | cyclic-churn | 244,033.17 | 10.2713% | #901 |
| 3 | remove transient map lookup-key ownership | map-entries-top-k | 29,119.00 | 7.0326% | #902 |
| 4 | unboxed numeric Map value layout removes erased dispatch | map-entries-top-k | 14,336.00 | 3.4623% | #903 under #552 |
| 5 | specialized managed-array contents release | release-acyclic | 41,472.00 | 2.2629% | #904 |
| 6 | releases of proved never-written zero slots | map-entries-top-k | 404.00 | 0.0976% | #899 |

For comparison, #876 owns at least 165,920 directly attributed count-path
instructions/call on sort-objects, **11.7574%**. This excludes the snapshot's
element-release callback path and allocation costs; it is a lower bound on the
observed sites that work owns. The corresponding directly inlined writeback
retain/release paths on map-entries-top-k are 5,656 instructions/call,
**1.3660%**, excluding its out-of-line snapshot copies. No duplicate task is
requested for either.

The 822 scalar old-value releases contribute 11,508 instructions/call
(2.7793%); the 202 scalar cursor retains add 2,828 (0.6830%). The other 1,846
numeric retain attempts already contribute no surviving ownership-dispatch
instructions in this build. The four null releases and three null retains in
Towers have only eight attributed instructions/call in total, **0.00085%**,
below its band: measured, explained, and **not worth a separate slice**.

Callgrind's total agrees with the native denominator within 0.00024% on four
rows. On map-entries-top-k it executes approximately 4,096 extra instructions
per call (0.9892%). Its total is therefore not substituted for the native
counter. Native precise retired-instruction samples separately corroborate
the source paths and their ordering; the sampling check and its limitations
are recorded with the raw evidence below.

The named stage-1 mechanisms cover the remaining work as follows:

| Row | Count operations a slice can discharge | Operations that remain necessary or below band |
|---|---|---|
| sort-objects | #876 snapshot/writeback: 8,192 retains +8,208 releases | 289 releases; integer buffers and final object graph |
| release-acyclic | no ownership obligation removed; specialize the generic array contents implementation | all 12,304 releases; per-object teardown remains stage 3 |
| cyclic-churn | last-borrow window: 7,936 retains +7,936 releases | 2,048 retains +2,049 releases for real graph sharing and ring ownership |
| map-entries-top-k | lookup key: 1,024 retains +1,024 releases; #876: 404 retains +405 releases; #899: 202 null releases; scalar erased dispatch has zero low-level count effects | 420 retains +627 releases for distinct real owners after those slices |
| awfy-towers | internal consuming entry: 8,205 retains +8,205 releases; none of the five named mechanisms removes that ABI pair | 15 real destruction releases and seven below-band null operations |

Specialized object-field release and the count-free merge loop are already
built. Shorter anchors alone do not explain Towers. A per-map-key slice must
target the transient argument, not the map's already single insertion count.
The two additional sites (published/internal conventions and known-zero array
slots) are explicitly identified so stage 1 is not forced into an inaccurate
five-way classification. #899 extends the existing contents/freshness owners
(`hir/contents/`, `contents.rs`, `initialized.rs`, `appended_results.rs`,
`own.rs`, `rc.rs`); it does not introduce another memory analysis.
#900 makes the borrowed published entry a thin adapter over one consuming body
and measures its code-size cost. The ABI boundary, rather than the number of
disk allocations, is the cause assigned to awfy-towers.
For the scalar map cost, the coordinator rejected a tagged scalar fast path
as an interim representation. #903 belongs to #552's existing design: a raw,
unboxed numeric Map value layout selected by the shared contents proof removes
the erased representation at its cause. The 3.4623% is evidence for that final
layout, not authorization for a parallel scalar path inside the tagged layout.
#904 extends the existing `nts_desc_ref` / `nts_desc_ref_acyclic` and
`nts_release_contents` callback contract. All managed element types already
share that pointer-slot representation. It needs neither #552's raw Map value
layout nor #488's future hole representation, and introduces no per-element-type
array layout. #901 extends `own.rs`'s borrow/effect windows; #902 extends its
Erase identity and stable anchors together with `entries.rs`'s existing key
identity. Shared file claims are serialized; these are not semantic dependencies.

## Raw evidence

The immutable census evidence is in
`/home/akisarou/.cache/nts-scratch/877/`. Its `SHA256SUMS` manifest covers 639
files (sources, instruments, executables, raw counters, native brackets,
attribution and validation), excluding intermediate object files, superseded
perf files and repository-proof logs. The manifest's SHA-256 is
**`f4c2376dbc78c1d7716f3e45942d7318ebfc6cdab7bcdb588cbcb99da7f100ab`**.
Each listed artifact has its own SHA-256 in that manifest.

- `pin-provenance.json`, `tools.json`, `commands.json`, `prepare.py` and
  `measure.py` identify the compiler, tool versions and build/driver recipe.
- Each row's `base/` contains original emitted C/header/runtime and the
  uninstrumented binaries. `count/`, `sites.json`, `instrument.py` and
  `annotated-counts.json` give the complete instrument and site/reason context.
- `standard-{0,1}.txt`, `counted-{0,1}.txt`, `plain-{0,1}.txt`, `node.txt`,
  `workload.json` and the root `validation.json` prove exact reconciliation,
  repetitions, work counts, answer agreement and minimum controls.
- `instructions/net-count.json` and its four raw `perf.csv` brackets retain
  the native numerator, empty subtraction and calibration for each row.
- `callgrind.out`, `symbols.jsonl`, `attribution.json`, `count-instructions.tsv`,
  `attribute.py`, `costs.py` and `native_shares.py` retain complete instruction
  accounting and inline source attribution. Self costs sum exactly to each
  Callgrind total; call-edge inclusive costs are kept separately, never added
  again to self costs.
- `instructions.perf`, `sample-pcs.txt`, `sample-command.json`, `sample.log`,
  `native-attribution.json`, `native-shares.json`, `sampling-validation.json`
  and `sample.py` retain the native corroboration. The event is
  `cpu_core/instructions/upp`, period 1,000,003, on CPU 0. Each sampled loop
  executes exactly 1,000 times its native counter's work count, with matching
  checksum and declared warm-up. All five final samples have **no reported
  lost events**. No machine policy was changed for sampling.

| Row and selected paths | Native instruction samples | Selected sample share |
|---|---:|---:|
| sort-objects, #876 directly attributable paths | 100,091 | 12.67% |
| release-acyclic, generic array walker self | 100,770 | 3.31% |
| cyclic-churn, last-borrow read counts | 163,163 | 10.08% |
| map-entries-top-k, transient key counts | 100,151 | 8.39% |
| map-entries-top-k, scalar erased dispatch | same sample | 3.93% |
| map-entries-top-k, #876 direct writeback counts only | same sample | 1.44% |
| map-entries-top-k, null-slot release | same sample | 0.18% |
| awfy-towers, consuming-entry pair | 100,742 | 19.50% |

These are sampled instruction-pointer shares, not another exact operation
census. Retirement-IP attribution at source/call boundaries and periodic
sampling explain why they need not equal the deterministic source instruction
counts. They corroborate the selected hot paths and ranking, including the
small zero-slot site being above the band. They are not substituted for the
exact site-cost ranking, and their binomial intervals in the raw JSON do not
model source-boundary bias or promise a speedup. No before/after optimization
or wall-time improvement is claimed by this inventory.

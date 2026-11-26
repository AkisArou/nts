# json-parse's allocation sites in the stage-2 memory report

Issue: #1042 (part of #513). Date: 2026-11-26. Base: main `78effeb9fe`.

The slice is report-only: ordinary preparation never runs the memory solver,
and every change below lives in `compiler/core/src/hir/memory/`. Each of
json-parse's 99 allocation sites, prepared as `nts-bench` prepares it (closed
roots `work` and module evaluation, C, reference counting), now has a home
and a proof, or a named failure. `compiler/core/tests/memory_analysis.rs`
names each site's role and pins every published answer in
`compiler/core/tests/memory_json_parse.tsv`.

## Why every site was on the heap

Measured at `78effeb9fe` (`nts regions --entry work --main --rc`): 99 sites,
306 contexts, all heap. None of the reasons was a property of the parser:

| cause | what it did | change |
|---|---|---|
| a widened alias class started at `Outside(WeakUnionBudget)` | 184 of 306 frontiers unknown | the class's bound joins its members' scopes; every edge into a member reaches the class |
| each literal was its own immortal object, and the universal outside object joined weak classes | one class absorbed every set it touched | the outside object and one immortal summary are sentinels; the outside object keeps no slots: a load is any outside value, a store opens and roots what it stores |
| repetition was inherited from every ancestor up to the entry | the Scanner was "repeated" though it dies once per parse | multiplicity counts only repetition between an allocation and its frontier, including the frontier's own recursion, reentry or merging |
| the context depth limit (4) and merged contexts without lineage | `JsonValue.objectValue`'s helpers merged; anything they touched became `ContextBudget` | no depth limit; a merged context takes its callers' longest common chain |
| `nts_uncaught` counted as a transfer under a terminal product | every reference live at a `throw` was fenced, and every caller counted as reentrant | `outcomes::Exit`: under `EntryUnwind::Terminal` the process ends; ownership's sealing keeps `Exit::Unknown` |
| the collector rule raised bounds to `RuntimeRootContract` | no frontier was visible for any site with references | the runtime root is an obligation column; the bound stays the program's own |

## The context budget's bound

A function has at most `contexts_per_function` (4) caller-specific contexts
and one merged context, so the operations analysed in all contexts are at most
`(contexts_per_function + 1) x` the program's: the input that already sized
the work and edge budgets. A chain needs no depth limit: a recursive call
reuses its ancestor's context, so a chain is at most the height of the
condensed call graph. Merged-context lineage is a refinement with its own
budget (eight passes, paid from the remaining work budget); unsettled, every
context keeps the chain it was built with. Stated in `memory.rs`'s `Limits`.

## What json-parse's sites prove now

| role | sites | proof published | named failure |
|---|---|---|---|
| scratch: Scanner, frame stack, number slices, `objectValue`'s slow-path lists | 14 | Scanner and frame stack: frontier their own frame, no holder; `numberValueOf`'s slice: one per activation | `RepeatedInstances` (`parseJsonText` counts as reentrant through unsealed helpers), `RuntimeRootContract`, `StorageBoundUnproved`; the slow-path key lists share a weak class with module constants |
| frame: `new Frame()` | 1 | frontier `readValue`'s frame; held only by the frame stack's elements | `OutlivesFrame` (by design: it outlives its container), `RepeatedInstances` (one per depth) |
| result: JsonValues, item/value arrays, read strings | 24 | key lists and item arrays are told apart by their holders | `Outside("stored into storage outside the program")`: a result pushed through `UNUSED_ITEMS`, a module slot every opaque helper may replace; read strings: `Outside("external or immortal storage")` through unsealed append helpers |
| keys: `addKey`/`finishedKeys` slices, rebuilt key lists | 3 | held by a frame's `template`/`plainKeys`/`keys` and by a result's `keys` (asserted) | the class spans module constants: `Outside("no activation holds both …")` |
| growth (22), raised (11), module (6), driver (18) | 57 | each names its owner, its exception path or its module slot | unsealed call storage; uncaught error paths; module slots |

Every site maps to an emitted variant. 23 of 342 contexts, at 6 sites, differ
from today's placement, all toward the heap and each with its reason:
the Scanner (2 contexts, legacy frame, here `RepeatedInstances`), the driver's
`String(index)` (legacy frame, `RepeatedInstances`), and `ascendingByIndex`'s
two arrays with their two backings (20 contexts, legacy call region, here
`OutlivesFrame` toward `objectValue`'s frame or `ContextBudget` in its merged
context).

**What remains is one cause:** `nts_str_append_char_at`,
`nts_str_append_char_code`, `nts_str_append_number` and `nts_array_slice_ref`
have no row in `regions::helper`, so the memory builder treats them as opaque:
each opens its arguments, makes its result outside storage, marks its caller
reentrant and lets every module slot be replaced. The owner of that contract
is `regions::helper`, which legacy region placement also reads, so adding the
rows changes prepared HIR and is its own task. Two more follow-ups stand:
ownership reading `outcomes::Exit` (a preparation change), and the runtime-root
contract, which keeps every repeated object with reference fields on the heap
until stage 3's reset proof discharges it.

## Proof

| check | result |
|---|---|
| `nts-bench --count json-parse`, nts C (before / after) | 21,219,210 / 21,219,209 per op, inside the 1-basis-point band: no row moved |
| `nts-bench --count json-parse`, nts LLVM | 21,538,352 / 21,538,351 |
| corpus comparison, pins `78effeb9fe` and `c09abb8a88`, 2,511 projects x 5 outputs (prepared HIR for C and LLVM under RC, emitted C and LLVM under RC, prepared C under no-GC) | 2,321 byte-identical; 10 `tests/refusals` projects differed in stderr only and reproduce identical; 180 benchmark cases not run (the script keyed their ledger case wrongly) |
| corpus comparison, pins `78effeb9fe` and the landed commit, 423 projects x 5 outputs: every tenth project of the manifest, the 10 stderr differences and the 180 benchmark cases | 423 byte-identical, none failed |
| three preparations | byte-identical `render()` and prepared program (json-parse, traversal, shared-tail) |
| `inner.ts --no-agree` | green (fmt, clippy, build, tests) |

The landed commit differs from `c09abb8a88` only in the report's holder
column and its test (`retention.rs`, `report.rs`, `build.rs`'s report
construction), which no preparation runs.

The analysis's own cost (`nts regions --census --rc`), both pins interleaved
twice on the E-cores (16-31), where user instructions have one counter:

| project | instructions before | after | ratio | peak RSS before (MiB) | after | ratio |
|---|---|---|---|---|---|---|
| runtime/node/fs | 486.8 G | 498.8 G | 1.025 | 4926 | 5794 | 1.18 |
| runtime/node/crypto | 427.8 G | 438.7 G | 1.026 | 4728 | 5578 | 1.18 |
| runtime/node/events | 222.4 G | 224.0 G | 1.007 | 702 | 774 | 1.10 |
| runtime/web-platform | 269.3 G | 272.0 G | 1.010 | 1066 | 1204 | 1.13 |
| tests/compile-time/escape-analysis-scaling | 2.426 G | 2.366 G | 0.975 | 43 | 40 | 0.95 |
| tests/compile-time/literal-text-scaling | 19.64 G | 19.58 G | 0.997 | 453 | 465 | 1.03 |
| #916 chain, number-32000 | 12.031 G | 12.013 G | 0.999 | 550 | 547 | 0.99 |
| #916 chain, unknown-32000 | 12.803 G | 12.783 G | 0.998 | 550 | 547 | 0.99 |

Across all 34 tripwire modules and #916's chain repro, one pass each, peak
RSS rose by at most 1.26x (`runtime/node/console`) and no census failed. The
compile-time tripwires measure `nts hir --prepared`, which runs no solver, so
none moves. An earlier draft that copied a weak class's holders into every
member raised `crypto`'s peak from 4.6 GB to 12.8 GB; holders are now
published once per class (`Report::class_holders`).

The 18 records in `results/memory-census/` go pending through the census
producer digest (`memory-census.ts --check` lists all 18); none was edited,
and the final pin's census still validates.

Raw evidence, in `~/.cache/nts-scratch/1042/`:

| file | sha256 |
|---|---|
| `cost-pair.tsv` | `cbc30231e49fed11abc6b26ba9ab7d4fb1fe2bf4334713bcec79084bcf4b9b58` |
| `cost-before.tsv` | `672cba1f33051a0ad9aade95bfcd6d336cae449e95b693a9fd79476a002e3e1f` |
| `cost-final.tsv` | `7c52bcd9e0cba6f6d0fa190c75e8c8aba2082c0d53bd85fd9da749bdb6a87d83` |
| `count-before.txt` | `fe68ef1e11e808e2a02517c548f7f36d0f287feb97920608a2d1503da9c64b5c` |
| `count-after.txt` | `555dca51b8161df44a49852cebdd651fc51b5660c2383f45e7488346bd72117f` |
| `hir-compare-results-1.jsonl` | `8576e1249c7fe7f61c9ee2e313a703021adf0e96ff598849cab27c0ad9c3e2bf` |
| `hir-compare-results-final.jsonl` | `25f92a8f4abc274d89f3cf0c55b517f156ae7d46277ef913d31479e5a2e65297` |
| `sample.txt` (the 423 projects) | `eeeee18f52717d0519d2247fa24e1f7eaa9a70b7a0d26a93ec413b9d04f4b2bc` |

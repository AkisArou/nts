# Published entries over consuming implementations

The rebased current-main comparison and remaining harness dependency are in
[the resumed proof](published-consuming-resume-900.md). Earlier measurements
below retain their original source baselines.

Issue #900 addresses the ownership pair around a direct call to a method that
the program also publishes. `own::summarize` correctly excludes the published
name from `consumes`: an external caller lends its arguments, and its cleanup
runs both after a normal call and after a throw. Removing that exclusion would
make a published store steal the caller's reference.

## Design

`compiler/core/src/hir/own/entries.rs` owns a HIR rewrite, driven by the
existing `own::consuming` answer. The reference-counting arm of `provide` calls
it before recording pre-counting arena lengths for `contents::elide`.
`own.rs` remains the ownership analysis; `rc.rs` remains the emitter of counts.
There is no second per-value ownership analysis or backend-specific body.

Selection requires a consuming stored parameter, an actual placed
`Callee::Direct` caller after devirtualization, specialization and placement,
and a remaining use that must borrow: publication, dispatch, a foreign entry,
callback or bridge. `reachable::borrowed_names` is the one union ownership and
materialization read.
Publication comes from `reachable::published_names`, which combines
`root_names(EntrySurface)` with the entries reached through callable surface
types. Pruning uses the same enumeration for its selected roots. The published
source-member rule in `reachable/surface.rs` is also the Node-API emitter's
rule. Numeric `#whole` implementations are not published source members: they
keep their existing name and ordinary consuming convention, with no adapter,
subject to the resumable-frame guard below.
Constructors, async functions, generators,
their suspension entries, abstract declarations and region clones are outside
this change. Default/rest binding has already been lowered: the rewrite passes
the exact lowered arguments, including the receiver and hidden bindings,
without lowering a default initializer a second time.

For a selected function, the rewrite takes its executable arena and blocks
out of the original `Func`, moves them into `@consuming:<original>`, and leaves
a borrowed adapter at the original name. Only signature metadata is copied.
Placed direct calls, recursive calls included, target the private body.
The adapter has parameter definitions, one direct call, and a return.
`own::summarize` and `rc::insert` then operate on the rewritten program.

| Caller | Entry | Argument contract |
|---|---|---|
| Direct, last use | private implementation | transfers the caller's reference |
| Direct, argument used again | private implementation | supplies another reference |
| Published native/Node-API/Java | original adapter | borrows the caller's reference |
| Virtual or closure dispatch | original table entry | borrows |
| Foreign method or callback bridge | original recorded target | borrows |

The adapter's direct call supplies a retain for each consuming slot. That
reference belongs to the implementation, which stores or releases it. The
adapter does not release a transferred reference after the call. The published
owned-result convention is maintained by the ordinary ownership pass.
External conversion-owned arguments still reach the existing wrapper cleanup
on return and on throw. Explicit throws before a store release the private
implementation's incoming reference; throws after it leave that reference in
the slot. Raising calls through a compiled `try` continue to use ordinary
return edges for cleanup.

A body whose callee or implicit producer can raise past the adapter is not
selected. Its reason is `can raise past the adapter`, and it keeps the current
borrowed convention. Selection reads the existing `memory/outcomes.rs`
escaping/unsealed column through its direct-call view, including transitive
calls and the shared runtime helper contracts. Unknown, native and indirect
producers fail closed. A local terminal `nts_uncaught` is allowed because it
leaves its own frame, where counting places the incoming reference's cleanup.
There is no new exception predicate, side channel or landing cleanup mechanism.

The initial implementation exposed the need for that condition: a nested
throw before the store skipped the consuming frame's incoming reference,
leaving 80 live bytes in the C addon. The identical fixture passes on main's
pin on C and LLVM, including explicit and nested before/after-store throws.
The flag-returning form does not exist for these ordinary entries on main;
adding it here would require another body or changing plain callers' error
protocol. Such bodies therefore retain the borrowed convention. The nested
control remains, with a second control throwing from two compiled frames deep.

Callable identity remains on the original entry and closure layout: function
name, length and rendering are decided before this rewrite. Unsupported stack
reads must retain main's refusal; no passing stack observation is inferred.
`own::source_name`, implemented beside materialization, projects the private
name for C, LLVM and JVM refusal presentation. Forced backend refusals exercise
that projection inside an implementation created by the real rewrite.

`materialize` returns the decisions it consumed. The provider's named result
passes them to `Prepared::entry_decisions`; they are not part of `Program`,
its Debug snapshots or the semantic schema. The opt-in
`nts hir --prepared --rc --entry-decisions` lists those sorted owner decisions,
one row per function, including generated implementations. Normal listings
carry none of this metadata. The corpus proof counts selected and excluded
functions by reason directly from these rows.

The code-size cost per selected function is one additional adapter and private
symbol, never another copy of the user body: arity parameter definitions, one
call, one return, and the ownership operations required for the borrowed
boundary. Functions without a consuming store or placed direct caller add
nothing. Corpus evidence must distinguish the new adapter, the moved body,
retargeted direct calls and the corresponding ownership changes; unrelated
changes are findings.

## Baseline

The baseline compiler is `~/.cache/nts-pins/b9dd04e8fa8b/nts`, SHA-256
`f1572974d9bc1c104c3801afbbc4119ecad5614b282df4348ad51ff26c73f601`.
It is the clean build used by #877. The following command prints no paths:

```sh
git --no-optional-locks diff --name-only b9dd04e8fa8b \
  81eb596e68ce158ef8a73d3d30bc5894f62b96a2 -- \
  compiler runtime tooling/cli Cargo.toml Cargo.lock rust-toolchain.toml
```

Benchmark sources and row definitions come from the task tree, independently
of the compiler pin's source revision. Raw proof output belongs under
`~/.cache/nts-scratch/900/`; committed measurements cite its hashes.

## Metadata audit

`own/entries.rs` contains the complete move/stay table. Exhaustive `Program`
and `Func` patterns force a new field to receive a disposition there. A unit
inventory holds the private fields of `interface_access::Plan` to that same
audit. Executable values, blocks, exact facts and validation move; the existing
`storage_bodies` permission moves to the private body and is removed from its
borrowed adapter. Debug assertions check that permissions still name their
owner's body and that excluded getter, constructor, generator and guarded-stop
roles were not selected.

Logical ABI/identity and receiving relations remain on the original entry,
whose value behavior and signature the adapter preserves. Publication,
namespace, boundary-type, foreign/callback, printing, selector/table,
source-name and refusal records also keep the original borrowed name.
Native dispatch, ownership, bounds and backend symbol indexes are constructed
after the rewrite. Type, layout, global and module facts are unchanged.

The detached Stage 2 memory report is a seam **outside `Program`**. Its source
sites and contexts stay original; its post-placement comparison consumes the
rewrite's own decision vector to resolve a source entry to the moved arena.
Those bodies retain ordinary heap/frame homes, independently of the untouched
region lineage. Report/census comparisons require identical sites, contexts
and homes. The truthful comparison-work counter is classified separately;
changes in whether its budget is exhausted are findings.

The CLI's accepted-option table in `tooling/cli/src/arguments.rs` declares the
opt-in flag beside `--prepared`. The added report seam also changes
`hir/memory.rs`, `hir/memory/comparison.rs` and the existing comparison unit
controls, with one new argument at `hir/mod.rs`'s existing report call.

## Consuming-summary guard experiment

Materialization alone exposed a second seam: numeric method specialization
leaves `SpecializedKeeper#keep#whole` unpublished and therefore eligible for
the ordinary consuming convention. A borrowed published caller retains an
argument to transfer into that body. If `nestedThrow` longjmps through the
body before its store, the new incoming reference is skipped. The source
creates the keeper rather than asking Node to invoke its constructor.
On both C and LLVM, main's native live bytes stay at 32; the candidate reaches
112 on the first nested throw. This is a candidate regression, not a baseline
leak. Raw output is `~/.cache/nts-scratch/900/specialized-global.log`, SHA-256
`cb948b26836e5a04b7ca92e3df4261681218654bde1de7cd97529329ad65c5dc`.

The approved guard withholds consumes answers when the existing DirectEffects
view cannot prove that the body's operations return through its frame. A
terminal local `nts_uncaught` remains allowed: its own frame can release the
incoming reference before transferring control. The experiment compares no
guard (`off`), a program-wide guard (`all`), and a guard applied only to a
program with a resumable landing (`resumable`). It filters the existing final
consumes map, including appended parameters; it introduces no ownership
analysis. Destinations also ask that owner, so a withheld answer can prevent a
destination variant from being made, before final reference counting.

The semantic owner is `reachable::Roots`, persisted as `Program::roots`:
`Entry` is closed; `EveryExport`, `EntrySurface` and `Declared` admit an outside
caller. Unknown roots fail closed. Benchmark workloads prepare with `Entry`
and are standalone. Runtime corpora here are prepared as Node addons without
an explicit entry flag. Their open root selection is therefore truthful.
The CLI already knows the actual `Shape`; its explicit-entry path incorrectly
chooses `Entry` even for addons and named libraries. That defect is #911. The
production guard must depend on #911 rather than add a second build-shape
interpretation in ownership. This experiment does not edit emission.rs.

The experiment was built from commit
`565337e4df5acdb78aa9282ebd734aa2d566c6b4`, logged separately before edits.
Only temporary instrumentation in own.rs and tooling/bench/src/main.rs plus
visibility of the existing predicate in own/entries.rs changed. The bench
census stops after the actual workload's preparation and before emission,
linking or measurement. The full `cargo build --release` used the tree's normal
target/profile. Saved files, patch, commands, logs and checksums are under
`~/.cache/nts-scratch/900/guard-experiment/`.

| Saved experiment binary | SHA-256 |
|---|---|
| bin/nts | 15269910c61b2850688abec16eeb363107f227057809dd293c369339597abc8c |
| bin/nts-bench | 23944e7ff27424360ee4ce6bd5d66e524651e2358ed1e7aaedee55fba48afc04 |

Restoration copied each saved file back. `git diff --exit-code HEAD` then
printed nothing. `restoration.json` verifies each restored file's SHA-256
against its committed blob: own.rs
`417e69384869d9167710a6fa9b6dd06dada34bf4f212f123d62eaf1b6ffda665`,
own/entries.rs
`286ad259633341d238b77fdad68d6dc28d7aa8ad96ae5659dc37b3fd3434f9ba`,
and bench main.rs
`aee3832c328cb12dfeddf1f361fbd784bb408c54be5127a6e0955461c04c62b5`.
The immutable saved experiment binaries remain separate from a production
candidate. `target/release` currently contains that instrumented build and
must be rebuilt before final compiler proof or timing.

## LLVM addon constructor control

The constructor arm is excluded under #500. The identical addon source is
tested with Node constructing `new SpecializedKeeper(7)` and with Node calling
`specializedPublished`, which constructs or uses the keeper inside TypeScript.
On main and candidate, C returns 11 in both arms. On main and candidate, LLVM
returns 11 in the control, while Node construction exits 127 with undefined
`nts_construct_NtsObj_SpecializedKeeper`. No new constructor support is claimed.
The coordinator copied this fixture/control pair to #500.
Commands, statuses and output are in
`~/.cache/nts-scratch/900/llvm-napi-constructor-fixture/results.json`, SHA-256
`e3990a0faac3726ebd7c2c2b3e07d8fceb09786fc779f70a80f0a88bff73a32e`.


## Per-row guard coverage

The census covers 180 benchmark rows and all 30 runtime corpora. It uses the
actual benchmark workload's preparation; launch rows use their module entry.
The library corpora use `--napi`, with no ambiguous explicit-entry flag.
[The complete table](published-consuming-guard-900.tsv) records every row.
`E` means executable and `L` means host-entered library/addon. `F/S` counts
functions with a consumes answer and their consuming parameter slots. The
`off`, `all` and `resumable` columns are the final maps after each guard.
`all-final-withheld` records that final summary's removed answers;
`all-ever-withheld` is the union of names/slots removed in any earlier summary
as well. A destination variant can disappear before the final summary, so
final withholding and final map shrinkage differ. These counts are not adapter
selection counts. `NA` records an unavailable preparation, never zero.

All 178 available benchmark rows have identical complete consumes-summary
traces in off and resumable-only modes. The program-wide guard affects one:
WSL loses `_generateSwizzle#into`, used during module initialization. That
program-wide guard is rejected. The two unavailable rows are Lebab (source
checking before any summary) and Offline Assembler (BrokenBase verification
errors after preparation); both fail in all three modes. Baseline-pin controls reproduce both failures. Lebab exits 1 for source
checking; Offline Assembler prints the same four BrokenBase errors while
`nts hir` exits 0, whereas the benchmark owner rejects invalid HIR.

Across the 30 open runtime corpora, the final map totals 4,871 consuming
functions without the guard and 3,606 with it. The 1,265 difference comprises
1,186 answers withheld at the final summary and 79 destination variants no
longer generated. The latter are 26 copies each of `inspectString#into` and
`inspectValueWithin#into`, 25 of `inspectValue#into`, the collision-renamed
`inspectValue@errors#into` in assert, and `formatTime#into` in ECMAScript.
There are no added function bodies in the guarded runtime HIR. Program-wide
and resumable-only modes produce byte-identical HIR on every runtime corpus;
their complete summary traces also agree apart from the mode label.

This cost belongs to host-entered programs. Regaining these answers and
variants requires a resumable landing that runs the intermediate frames'
releases. It is not a reason to transfer owned references through frames the
current landing can skip. The guard does not repair arbitrary owned locals
already skipped on main. Its proof must keep that limitation separate.

Materialization-only report/census identity is still required with this guard
off. The guard's own report changes are expected; every site, context and home
difference must be recorded as its effect. Full corpus report comparison,
native counts and the new guard controls are reported below.

Raw census traces and commands: `~/.cache/nts-scratch/900/guard-experiment/census/summary.json`,
SHA-256 `be7bf673159213ca12aeb3935e3326042d8546a56b37ab0fa46fd7e0fbbc7002`.
The complete missing-body inventory is `guard-experiment/body-inventory.json`,
SHA-256 `17afc1ced813ff35f24a0a739e9823734567d7b594bcbd2138de172b53cc244a`.
The census ran as `nts-900-guard-census` under admission key `hir-compare`.


## Guard instruction-count controls

The same saved experiment binaries ran all three modes, sequentially on CPU 2
outside the measurement pair, from the same tree and release target. The
command was `nts-bench --root <tree> --count awfy-towers sort-objects
release-acyclic cyclic-churn map-entries-top-k jetstream-wsl`, with
`NTS_BENCH_LANES=c,llvm`, one checker, and the guard mode as the only compiler
control. Each mode exited 0. The named unit was `nts-900-guard-counts`, admitted
under `perf-count`; these standard count runs take no measurement lock.

| Row | Off C | Wide C | Scoped C | Off LLVM | Wide LLVM | Scoped LLVM |
|---|---:|---:|---:|---:|---:|---:|
| awfy-towers | 751869 | 751869 | 751867 | 735454 | 735445 | 735452 |
| sort-objects | 1411192 | 1411206 | 1411192 | 1501934 | 1501920 | 1501920 |
| release-acyclic | 1832669 | 1832669 | 1832669 | 1832665 | 1832669 | 1832665 |
| cyclic-churn | 2375868 | 2375872 | 2375872 | 2377856 | 2377870 | 2377856 |
| map-entries-top-k | 414062 | 414052 | 414053 | 415504 | 415509 | 415509 |
| jetstream-wsl | -- | -- | -- | -- | -- | -- |

The header's bands, in basis points (1 = 0.01%), are C 1, LLVM 1, C++ 1,
ScriptC 1, Node 25, Bun JIT 206, Bun AOT 43, JVM 968 and Java 868. They come
from 20 fib runs at `681114285dcca4bce83aa57231009966429ece8f`, nts-dev, CPU 0.
The five measured native rows stay inside their C/LLVM bands in every mode.
WSL's native workload is refused, so its unavailable cells establish no native
cost; the Node cell still runs. Its affected helper is initialization work,
which a warm row excludes in any event.

All 33 saved emitted-source and executable artifacts are byte-identical between
off and scoped modes. Wide mode differs only in WSL's specialized C, plain C
and LLVM source outputs. The other five rows' artifacts are byte-identical in
all three modes. Small count differences between identical binaries are
observations within the bands, not compiler effects.

Full headers, all cells, commands, guard traces and artifact SHA-256s are kept
in `~/.cache/nts-scratch/900/guard-experiment/counts/`. The count-receipt monitor
also preserves the raw production instrument's per-bracket results under
`guard-experiment/count-receipts/`. This is a guard comparison with
materialization enabled in every mode; it is separate from the main-versus-fix
materialization performance comparison or the final timing sitting.
The count command/artifact inventory SHA-256 is `4ad8933ae2f8c71cce0975e60905812ffd372354ae7ae54a43be7ead8f8e3026`.


## The separate resumable-landing defect (#912)

The coordinator filed #912 with the fixture/control under
`~/.cache/nts-scratch/912`. Main's pin already skips owned locals when an
uncaught throw lands back in Node. `localAcrossNestedThrow` obtains an owned
array, lends it to a published store, clears that slot, and calls a helper two
frames deep while keeping the array for a later read. Thus the array is heap
storage, and the local is its remaining owner across the call. The control
changes only the helper's throw flag. Both poison-built C and LLVM addons give:

| Calls through the published entry | Baseline live bytes | Final live bytes |
|---|---:|---:|
| 100, helper returns | 0 | 0 |
| 100, helper throws uncaught to Node | 0 | 9,600 |

The observer forces collection. There is no managed incoming argument in this
entry, so withholding consumes answers cannot fix this skipped local cleanup.
#912, a resumable landing that runs intermediate frames' releases, is the way
to regain the guard's withheld answers and destination variants. This task
makes no landing cleanup change.

Source, client and exact observations are under
`~/.cache/nts-scratch/900/guard-experiment/landing-fixture/`; `proof.json` SHA-256
`4bd0776c2d0da3748012cc312911350e4a81f293fc701e2fb0e0b2ea745ffecb`.
The main-pin source SHA-256 is
`44fa1020b04dafa820d1e0c8752d62ef29768edb6a7c12b8eca27c812caa4cdb`.
Commands, statuses and output are in `guard-experiment/landing-0.stdout` and
`landing-1.stdout`. The admitted unit was `nts-900-landing-probe`.


## Exercised inspection-variant cost

A library probe imports the real runtime `inspectValue` and returns a prefixed
and suffixed rendering of a nested array containing numbers, quoted strings,
a backslash and a control character. Its source is
`guard-experiment/inspect-cost/main.ts`. HIR assertions require all three
`inspectString#into`, `inspectValue#into` and `inspectValueWithin#into` bodies
in off mode and none in either guarded mode. C and LLVM agree with Node for
inputs -3, 0, 3 and 123 (lengths 55, 53, 53, 57). Unrelated runtime constructor
refusals remain reported; the measured exports compile and link in every arm.

Per `work(3)`, both backends report 7 retains, 35 releases and 22 allocations
off, versus 7 retains, 36 releases and 22 allocations guarded. Poison builds
return native live bytes to the same 14,400-byte initialized-module baseline
after 1,000 further calls and forced collection. The disappeared variants
therefore cost one emitted release and no additional heap-object allocations
on this exercised path; their loss does not imply the same cost on every input.

The native library row is counted with the production `netCount` instrument:
instruction-chosen repetitions, matching warmup and empty-bracket subtraction.
This custom probe has no standing band of its own, so its hardware counts run
on CPU 4 under `with-lock.sh --wait --key perf-count`, sibling 5 quiet, as
`nts-900-inspection-count`. There is no outer admission reservation. The wrapper
waited for the measurement pair to stay at least 90% idle for 45 seconds.
Each backend/mode has five process repetitions in this single locked sitting.
All checksums are `404a800000000000` (53).

| Backend | Mode | Median instructions/op | Observed min–max | Ratio to off median |
|---|---|---:|---:|---:|
| c | off | 8789.001 | 8788.897–8834.083 | 1.000000 |
| c | all | 8763.083 | 8762.980–8807.980 | 0.997051 |
| c | resumable | 8763.083 | 8762.980–8763.083 | 0.997051 |
| llvm | off | 8931.979 | 8931.896–8932.001 | 1.000000 |
| llvm | all | 8892.001 | 8891.896–8892.084 | 0.995524 |
| llvm | resumable | 8891.981 | 8891.896–8892.084 | 0.995522 |

There is no measured instruction regression in this row. The C off/wide samples
have a roughly 0.51% span, so the approximately 0.29% median reduction is not a
C improvement claim. LLVM's guarded medians are about 0.45% lower, with observed
spans below 0.003%. These are instruction observations, not wall-time ratios,
and are separate from the candidate Towers timing sitting and the
published adapter's separate external-call cost row.

Build, semantic, operation and live-byte commands are in
`guard-experiment/inspect-cost/receipts.json`. Every counted bracket, fixed n,
perf CSV, command and result is retained under `inspect-cost/locked-count/`;
its summary SHA-256 is `0ba2489d1119ebe87abb5bb41d09fcb9564f7e80601c6240b4a2107bd91e2ad9`.
The client reuses the production counting definition; its CPU-4 FIFO transport
is `guard-experiment/inspect_count_locked.ts`, SHA-256
`c1696aea5326441978e0c44325deceed110dc6ee06ed4dd4b2fd0fc5a9f45a3b`.


## Focused-control corrections

The initial memory fixture used open `emit-c` roots while its intended floor
was for the closed benchmark. It measured 24,637 operations on main and 24,609
on the candidate, with 15 allocations; that is a different program. Its floor
was not raised. The fixture now belongs to the existing C integration harness:
`published_consuming::closed_towers_hands_over_every_push_at_the_memory_minimum`
in `compiler/codegen/c/tests/published_consuming.rs`. It prepares through
`prepare_with` and `Roots::Entry([work, module#init])`, matching the benchmark,
and links the existing `tooling/memory/harness.c`. The measured, justified floor
is 8,227 attempted operations and 15 allocations, detailed below. The memory
runner is unchanged. The input and argument are under
`compiler/codegen/c/tests/programs/published-consuming-towers`. The owning test
passed the fresh inner run, including its exact effective-count assertions.

The mutable keeper's cleanup arm also exposed #912: `specializedPublished`
retains its mutable-global receiver across the raising method call. Main and
the candidate leave that same 32-byte receiver alive after clearing its slot.
This is not a cache and not an incoming-array leak. The boundary control now
requires no-throw keeper cleanup to reach zero, keeps every per-call array
assertion exact, and permits only main's known 32-byte residual (or zero if
improved) after throwing cleanup, with an explicit #912 comment. The previous
unqualified zero expectation was incorrect for this baseline. Both corrected
arms passed on the pin and the fresh candidate on C and LLVM: the no-throw
keeper clears to zero, and the throwing cleanup matches main's 32-byte #912
residual with every incoming-array assertion exact.


## Attempted releases and the #916 floor

Closed Entry preparation proves all 8,205 handovers: main has 8,208 attempted
retains and 8,224 releases (16,432 operations); the candidate has 3 retains
and 8,224 releases (8,227 operations), 15 allocations and zero leaked objects.
The emitted caller has no retain/release pair around the consuming call.
A per-site runtime observation, with `nts_release` kept out of line and its
return address resolved through DWARF, separates attempts from decrements.
Its summed site attempts equal the ordinary runtime counter on both compilers.

| Site | Main attempts / effective | Candidate attempts / effective | Assignment |
|---|---:|---:|---|
| `Towers#buildTowerAt`, caller disk cleanup | 14 / 14 | 0 / 0 | removed by #900 |
| `Towers#moveTopDisk`, caller disk cleanup | 8,191 / 8,191 | 0 / 0 | removed by #900 |
| consuming `Towers#pushDisk`, old `disk.next` on store | 0 / 0 | 8,205 / 0 | null old object field; #916 |
| array fill `nts_uncount_managed` | 3 / 0 | 3 / 0 | common null-slot attempts |
| `Towers#benchmark`, initial `piles` replacement | 1 / 0 | 1 / 0 | common null-slot attempt |
| `work`, root cleanup | 1 / 1 | 1 / 1 | common effective release |
| `nts_each_reference`, array references | 2 / 2 | 2 / 2 | common effective releases |
| `nts_release_contents`, disk-next edges | 12 / 12 | 12 / 12 | common effective releases |

The new old-value release is at emitted candidate `program.c:563`: it reads
`disk.next` before assigning `top` there. `popDiskFrom` has already left this
field null. It is not a cleanup of the handed-over argument. The coordinator
assigned this cross-call object-field null fact to #916, separately from #899's
fresh array slots. The justified current attempted floor is therefore 8,227:
3 null retains, 19 common releases and the 8,205 named #916 attempts. The target
after #916 remains 22. The harness also requires exactly 15 effective releases,
15 allocations and zero leaks, and observes null retains/releases separately.
No production runtime helper or memory-runner route changed for this census.

Exact emitted file/line/function and inline chains, addresses, commands and
counter totals are in `~/.cache/nts-scratch/900/release-sites/summary.json`,
SHA-256 `a05d0fc75274fcea69141057696bd4597391f7c5cb05e4fdc43bed1762c9e5c4`.
The owning integration test remains
`published_consuming::closed_towers_hands_over_every_push_at_the_memory_minimum`.


## Roots audit and the guard's unknown case

`Program.roots = None` means preparation has not supplied a product contract.
The guard treats that unknown as resumable and fails closed. This is distinct
from `selected_roots` returning `None` in the CLI: the latter explicitly maps
to `EveryExport` or `EntrySurface`, and preparation stores that answer as
`Some(OwnedRoots)`. `prepare_lowered` stores it before `settle` and every
ownership consumer. Neither provider choice nor backend changes this rule.

| Production route reaching ownership | Root contract at ownership |
|---|---|
| `prepare`, `prepare_with`, `prepare_unverified`, all `RawProgram` preparation methods | `prepare_lowered` always installs `Some(options.roots.to_owned())`; defaults explicitly mean `EveryExport` |
| `destinations` trial and `rc::insert` in preparation | Trial clones retain those explicit roots; counts use the prepared product |
| CLI C/LLVM/JVM emit and build; multi-emit branches | `Metadata::options`: selected standalone roots become `Entry`; configured surface defaults to `EntrySurface`, unknown library to `EveryExport` |
| CLI `hir --prepared`, regions/report/census | `prepare_as` selects the same explicit roots; `--main` without `--entry` means `Entry([module#init])` |
| CLI layouts, refusals, prepared facts and raw-HIR verification | Default preparation explicitly means open `EveryExport`; these commands do not claim a closed executable |
| `nts-bench` (all three backends) | `prepare_snapshot` explicitly sets `Entry(workload.roots)`; `Workload` includes module initialization |
| Differential and record/conformance routes | `pool_options` prepares the callable exported-case surface, explicitly open through default `EveryExport`; backend emission consumes that prepared program |
| `nts-suite` and `expect-ir` | Default open `EveryExport` preparation, including backend checks of that program |
| JVM `string_chain_census` example | Default open `EveryExport` preparation, then `Plan::new` on its prepared program |
| JVM emission's `Plan::new`, NAPI emission's `summarize` | Read the supplied prepared program without clearing roots; low-level APIs handed a raw/hand-made `Program` preserve the unknown case |
| Raw `hir::lower::lower` inspection commands | May retain `None`, but do not run ownership; raw lowering's transient Program is prepared before any production emission/ownership consumer |

No production route claiming a closed product passes `None` to ownership.
The hand-made JVM refusal fixture was the exception in tests: its documented
closed private ABI now names `Entry([pairCaller])`. The explicit-roots core
control asks ownership about one unchanged open NoGC IR under each of the four
root contracts, retaining the raising helper call in every arm.

The separate #911 defect is a wrong **explicit** root convention, not a missing
root: named addons and libraries currently get `Entry` where their real product
requires `Declared`. Its correction belongs to the CLI emission owner, outside
#900. No edit to `emission.rs` is included here.

## Prepared-HIR corpus classification

The `hir-compare` admitted capture compares 1,125 configurations in
`tests/programs` and the 30 runtime corpora, with RC and C preparation. The
materialization-only control uses the approved guard-off build; the permanent
guard has a separate comparison. `tests/programs/invalid` is unmeasured on
both compilers: each capture exits 1. Among measured captures, 169 adapters
move one body each, 89,731 unselected functions are byte-identical, and 115
functions have classified call/count changes. Every prune kept set is identical
(after removing the new implementation symbols). No executable-body, adapter,
added/dropped-function or unexplained-HIR finding remains.

Classification first removes retain/release lines, projects private call
targets to source names, and then canonicalizes SSA IDs by first occurrence.
Only added parameterless blocks whose remaining operation is exactly one jump
may be contracted, preserving that jump's target and arguments. The seven
publication-rule corrections are an expected gain: formerly wrongly lent
`Socket#@private19:#resetAsyncIdentity`, `Event#@private14:#beginDispatch` and
`Sink#keep#whole` become consuming; their callers `Socket#asyncReset`,
`Event#@symbol6`, `Closure9#call` and `Sink#keep` adjust counts. Those three
bodies account for the added release-only edge blocks. Every other difference
remains a finding. Footer changes are classified only when function-count
growth exactly equals the owner's selected-adapter count and the complete
refusal inventory and every other non-function byte are unchanged; zero
refusals may use the `nothing refused` spelling.

The rules are executable in `~/.cache/nts-scratch/900/hir_classify_saved.py`,
with full raw captures and classified summary under
`hir-materialization/c-rc-exports/`. The actual guarded candidate captures,
including every removed destination variant and changed function, are under
`hir-guard/`; the guard's deliberate changes are reported separately rather
than attributed to materialization.

## Owner-reported runtime selections

These counts come from the permanent candidate's sorted `--entry-decisions`
output carried on `Prepared`, not a repeated selection algorithm. Columns
name each first exclusion reason: D = no placed direct caller; B = no borrowed
entry use; C = no consuming stored parameter; R = can raise past the adapter;
K = constructor; S = suspension entry; A = abstract declaration. Roots are the
open corpus roots used by the comparison, not the closed benchmark roots.

| Corpus | Selected | D | B | C | R | K | S | A |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ecmascript | 0 | 232 | 1066 | 32 | 0 | 14 | 0 | 4 |
| node/assert | 1 | 868 | 2199 | 91 | 0 | 0 | 2 | 0 |
| node/async_hooks | 0 | 203 | 246 | 15 | 1 | 1 | 0 | 0 |
| node/buffer | 0 | 161 | 253 | 2 | 0 | 0 | 0 | 0 |
| node/child_process | 19 | 1195 | 2519 | 176 | 0 | 0 | 2 | 0 |
| node/cluster | 4 | 1440 | 2715 | 159 | 0 | 0 | 2 | 0 |
| node/console | 1 | 969 | 2254 | 108 | 0 | 0 | 2 | 0 |
| node/crypto | 4 | 2136 | 2724 | 194 | 3 | 6 | 2 | 0 |
| node/dgram | 4 | 1342 | 2684 | 155 | 0 | 0 | 2 | 0 |
| node/diagnostics_channel | 0 | 166 | 243 | 3 | 0 | 0 | 0 | 0 |
| node/dns | 15 | 229 | 475 | 47 | 1 | 0 | 0 | 0 |
| node/events | 1 | 854 | 2161 | 95 | 0 | 0 | 2 | 0 |
| node/fs | 20 | 1932 | 2925 | 250 | 1 | 0 | 2 | 2 |
| node/http | 4 | 2015 | 3039 | 201 | 0 | 0 | 2 | 0 |
| node/net | 4 | 1342 | 2628 | 159 | 0 | 0 | 2 | 0 |
| node/os | 0 | 172 | 264 | 2 | 0 | 0 | 0 | 0 |
| node/path | 0 | 162 | 212 | 6 | 0 | 0 | 0 | 0 |
| node/perf_hooks | 16 | 919 | 2310 | 170 | 0 | 4 | 2 | 0 |
| node/process | 4 | 2094 | 3098 | 208 | 1 | 0 | 2 | 0 |
| node/punycode | 0 | 9 | 13 | 6 | 0 | 0 | 0 | 0 |
| node/querystring | 0 | 164 | 268 | 9 | 0 | 0 | 0 | 0 |
| node/readline | 17 | 979 | 2359 | 139 | 0 | 0 | 2 | 2 |
| node/stream | 5 | 1560 | 2472 | 170 | 0 | 0 | 2 | 0 |
| node/string_decoder | 0 | 155 | 261 | 2 | 0 | 0 | 0 | 0 |
| node/timers | 15 | 180 | 309 | 41 | 0 | 0 | 0 | 0 |
| node/tty | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| node/url | 0 | 210 | 432 | 13 | 0 | 0 | 0 | 0 |
| node/util | 2 | 933 | 2174 | 102 | 0 | 0 | 2 | 0 |
| node/zlib | 20 | 1745 | 2737 | 212 | 1 | 1 | 2 | 1 |
| web-platform | 2 | 1375 | 1852 | 192 | 0 | 17 | 20 | 0 |

## Five test262 records

All five recorded populations passed against the immutable permanent candidate
(SHA-256 `61d75b169e6df872a88a9bfe8113d66b40e2c534a4fcd719842e20ad58d65b6c`)
in `nts-900-test262-records`, admitted with key `test262-records`: language,
builtins, Annex B, staging and harness. No recorded outcome regressed. Commands,
exit statuses and log hashes are in `~/.cache/nts-scratch/900/test262/summary.json`.


The closed no-`--entry` probe uses
`tests/programs/a-closure-handed-to-a-loop-is-called-directly` and `--main`.
On C, LLVM and the JVM, implicit module evaluation and explicit
`--entry module#init` produce byte-identical prepared HIR. Main's pin, the
materialization-enabled guard-off control and the permanent candidate also
produce identical HIR in every arm: all 18 captures pass. The probe preserves
six functions, rather than proving equality by pruning the program away.
Commands, listings, diagnostics and status are retained in
`~/.cache/nts-scratch/900/closed-no-entry/summary.json`, SHA-256
`34094f38ef80af938966d17b959a7bef5b6cae687f34bb0a08f77bd8cf1b9409`.

Raw classification evidence is retained with these SHA-256 values:

| Artifact under `~/.cache/nts-scratch/900/` | SHA-256 |
|---|---|
| `hir_classify_saved.py` | `47ad5554424d9621bc0bb43a53ca229bbee73461de55884444a626d2c2ed214f` |
| `hir-materialization/c-rc-exports/classified-summary.json` | `225936697e8c4310b542b236f60f15e7a968d807a203494ce4e8a46a17a466ee` |
| `hir-guard/summary.json` | `0a650a3467a993c246fe1940c456cb46053f5b05f238a8bf6a6a409ff666d6ba` |
| `test262/summary.json` | `c619910d664ac06ba0dbbbab8465ccec13baddeb5b44c5b3aec26a67b4f4fe90` |


## Materialization-only memory and census identity

All 108 configurations (30 runtime corpora and 78 `tests/memory` projects)
passed the main-pin comparison with the guard off: every site, context, home
and census field is unchanged. Census output is byte-identical; the detached
memory report is byte-identical after removing only its truthful comparison-work
counter. Every capture exits zero, and no comparison changes budget exhaustion
or any other failure state. This is the materialization's result, not a claim
that the deliberate guard withdrawals leave memory reports unchanged.

The work-counter difference is exactly the net placed-operation difference
(added adapter operations minus removed count operations), plus two index
charges per selected adapter: one function-index visit and one source/body
entry-mapping visit. A separate accounting script verifies that equation for
each runtime corpus against the raw HIR and actual before/after work counters.
Terminator lines do not count as placed operations; all counted values remain
the instrument's original values.

| Corpus | Main work | Candidate work | Net placed ops | Adapter index charges | Work delta |
|---|---:|---:|---:|---:|---:|
| ecmascript | 100068 | 100068 | 0 | 0 | 0 |
| node/assert | 214982 | 214988 | 4 | 2 | 6 |
| node/async_hooks | 15997 | 15997 | 0 | 0 | 0 |
| node/buffer | 15414 | 15414 | 0 | 0 | 0 |
| node/child_process | 539740 | 539830 | 52 | 38 | 90 |
| node/cluster | 737909 | 737930 | 13 | 8 | 21 |
| node/console | 372925 | 372933 | 6 | 2 | 8 |
| node/crypto | 1374017 | 1374038 | 13 | 8 | 21 |
| node/dgram | 687119 | 687140 | 13 | 8 | 21 |
| node/diagnostics_channel | 12282 | 12282 | 0 | 0 | 0 |
| node/dns | 55719 | 55788 | 39 | 30 | 69 |
| node/events | 204175 | 204181 | 4 | 2 | 6 |
| node/fs | 1415469 | 1415567 | 58 | 40 | 98 |
| node/http | 1222011 | 1222030 | 11 | 8 | 19 |
| node/net | 656099 | 656116 | 9 | 8 | 17 |
| node/os | 16751 | 16751 | 0 | 0 | 0 |
| node/path | 13961 | 13961 | 0 | 0 | 0 |
| node/perf_hooks | 296806 | 296881 | 43 | 32 | 75 |
| node/process | 1449316 | 1449337 | 13 | 8 | 21 |
| node/punycode | 1443 | 1443 | 0 | 0 | 0 |
| node/querystring | 20539 | 20539 | 0 | 0 | 0 |
| node/readline | 386586 | 386669 | 49 | 34 | 83 |
| node/stream | 582431 | 582457 | 16 | 10 | 26 |
| node/string_decoder | 15424 | 15424 | 0 | 0 | 0 |
| node/timers | 26046 | 26115 | 39 | 30 | 69 |
| node/tty | 28 | 28 | 0 | 0 | 0 |
| node/url | 34484 | 34484 | 0 | 0 | 0 |
| node/util | 225741 | 225755 | 10 | 4 | 14 |
| node/zlib | 816072 | 816170 | 58 | 40 | 98 |
| web-platform | 341275 | 341255 | -24 | 4 | -20 |

Raw captures and status are retained under
`~/.cache/nts-scratch/900/memory-materialization/`. Reproduction and accounting:

| Artifact under `~/.cache/nts-scratch/900/` | SHA-256 |
|---|---|
| `memory-materialization/summary.json` | `c1b1452c1283c129ffc2072c89123c001e6033da21436a4323109ce17b04e792` |
| `memory_work_accounting.py` | `bd4cc93df08296eb79782eefc812e7eb54e025acfd4ea4386fea51318fbefdef` |
| `memory-work-accounting.json` | `67232444bd26551af936f9ac5d132b0453668fa229afc54188a72e621b1b37fd` |


## Fresh inner proof

`node tooling/gate/inner.ts --no-agree` passed in `nts-900-inner-guard6`:
formatting, Clippy, fresh compiler build, all touched crates and C/LLVM/JVM
backend tests. Test execution took 607 seconds. The four-roots guard control
uses private free storing helpers behind published forwarding methods, rather
than assuming a numeric specialization exists. Shape assertions keep the
unsafe helper's call to `relayThrow`, that helper's call to `nestedThrow`, and
the quiet helper's read before its store. On the same unchanged open NoGC IR,
the unsafe helper consumes only under `Entry`; the quiet helper consumes under
all four explicit root contracts. The closed Towers exact effective counters,
backend source-name refusals and the explicit-closed JVM refusal control pass.

The earlier inner failures were confined to two test contexts: a nonexistent
`#whole` specialization assumption, and a hand-made JVM fixture describing a
closed ABI with unknown roots. Both were corrected without changing production
ownership or effects. The final full inner log is
`~/.cache/nts-scratch/900/inner-guard6.log`, SHA-256
`6f36416fd73379180a1eec583793d4b9a37b58107d29ed0c34e5ae4fc861df8a`.


Preparation comments are audited separately instead of silently discarding
facts with the executable listing. Across all 1,125 captures, 24 contents or
accumulator comment sets change. After source-name projection and isolating
operation-visit counters, every read/cleanup/rewrite count, source site, value,
answer and budget-exhaustion count is identical. Unselected rows keep their
order; selected body rows keep their relative order while moving with those
bodies. No fact/status finding or budget-exhaustion change remains. The audit
is executable and retains each before/after instrumentation header:

| Artifact under `~/.cache/nts-scratch/900/` | SHA-256 |
|---|---|
| `hir_comment_audit.py` | `48213881f0835b7ebe0651c017c8192457135a0f7a8d549e7345770119233349` |
| `hir-comment-audit.json` | `7495bce4aa9a78db17d72a971618e06c8ec2f4472a6e0c871f5f2d09911a5e98` |


## Concrete adapter size and external-entry control

The external row calls the published `store(xs, before, after)` entry through
its borrowed ABI. On C and LLVM, normal, poison/forced-collection and ASan
builds agree (answer 700,000; final live bytes zero). Both baseline and candidate
have the same row source and checks. Separate artifact controls keep the call
to the consuming body visible: C uses `-fno-inline-functions`; LLVM's control
adds `noinline` to every definition in a saved IR copy on **both** compilers,
then links with the same flags. The original emitted IR remains untouched.
The LLVM frontend flag alone does not suppress LLVM-IR inlining and is not
claimed as the visible-call control.

For this three-parameter function, the surviving adapter is 29 bytes on C and
32 bytes on LLVM. Each reaches the same one consuming body with a tail jump;
its only ownership work is supplying the borrowed argument's reference. The
moved body is 217 bytes on each backend, versus the original 240-byte borrowed
body. Their combined symbol sizes therefore grow by 6 bytes (C) and 9 bytes
(LLVM), before alignment and other row functions. This is a concrete adapter
size, not a fixed byte charge for every signature or an assumption of inlining.
The corpus figures report linked net text separately, including count elision,
inlining and layout; their per-adapter figures are net averages, not gross
wrapper sizes.

Symbol sizes and emitted addresses are retained in
`~/.cache/nts-scratch/900/external-adapter-symbol-sizes.json`, SHA-256
`f98fbdf26673c15ac3705db0db144fdc53c3b40e9c6bd6bb3d5ed00211f1e0b7`.
The LLVM control's exact commands, original/patched IR and executable hashes
are in `llvm-external-noinline.json`; the binaries' objdump files retain the
visible adapter-to-body jump.


## Runtime linked text: materialization isolated

All 30 corpora emit and link on C and LLVM with the guard disabled, isolating
the entry rewrite. Every NAPI `addon.c` is byte-identical to main's output on
both backends, including corpora with no selected entry. Shared libraries use
`clang -std=c11 -O2 -fPIC -shared -DNTS_PROVIDER_RC`, identical runtime/header
inputs, and the same tree. `size -A -d` measures `.text`; raw `nm -S` output and
linked-file hashes are retained. Net growth includes all count, inlining and
layout changes. Per-adapter figures divide that measured net growth by the
owner's selected count; a corpus with no adapter has no per-adapter figure.
The safety guard's additional changes are not charged to materialization here.

| Corpus | Adapters | C main bytes | C delta | C delta/adapter | LLVM main bytes | LLVM delta | LLVM delta/adapter |
|---|---:|---:|---:|---:|---:|---:|---:|
| ecmascript | 0 | 795119 | 0 | — | 747455 | 0 | — |
| node/assert | 1 | 729039 | 0 | 0.00 | 715663 | 0 | 0.00 |
| node/async_hooks | 0 | 357199 | 0 | — | 363455 | 0 | — |
| node/buffer | 0 | 370591 | 0 | — | 374495 | 0 | — |
| node/child_process | 19 | 874559 | -256 | -13.47 | 836447 | -208 | -10.95 |
| node/cluster | 4 | 928319 | -112 | -28.00 | 882287 | -96 | -24.00 |
| node/console | 1 | 754255 | 0 | 0.00 | 738575 | 0 | 0.00 |
| node/crypto | 4 | 961791 | -96 | -24.00 | 911727 | -96 | -24.00 |
| node/dgram | 4 | 907359 | -112 | -28.00 | 863199 | -96 | -24.00 |
| node/diagnostics_channel | 0 | 325567 | 0 | — | 328031 | 0 | — |
| node/dns | 15 | 429311 | -144 | -9.60 | 425519 | -112 | -7.47 |
| node/events | 1 | 716383 | 0 | 0.00 | 702943 | 0 | 0.00 |
| node/fs | 20 | 1023231 | -256 | -12.80 | 954719 | -208 | -10.40 |
| node/http | 4 | 1064911 | -496 | -124.00 | 987439 | -480 | -120.00 |
| node/net | 4 | 919247 | -208 | -52.00 | 874047 | -192 | -48.00 |
| node/os | 0 | 387151 | 0 | — | 392095 | 0 | — |
| node/path | 0 | 367055 | 0 | — | 368911 | 0 | — |
| node/perf_hooks | 16 | 808431 | -144 | -9.00 | 776319 | -112 | -7.00 |
| node/process | 4 | 1042943 | -112 | -28.00 | 969055 | -96 | -24.00 |
| node/punycode | 0 | 258783 | 0 | — | 257887 | 0 | — |
| node/querystring | 0 | 405567 | 0 | — | 396943 | 0 | — |
| node/readline | 17 | 788447 | -144 | -8.47 | 770191 | -112 | -6.59 |
| node/stream | 5 | 841151 | -144 | -28.80 | 804015 | -144 | -28.80 |
| node/string_decoder | 0 | 365007 | 0 | — | 368863 | 0 | — |
| node/timers | 15 | 365119 | -128 | -8.53 | 366735 | -112 | -7.47 |
| node/tty | 0 | 238799 | 0 | — | 238799 | 0 | — |
| node/url | 0 | 474911 | 0 | — | 457119 | 0 | — |
| node/util | 2 | 768783 | 0 | 0.00 | 756079 | 0 | 0.00 |
| node/zlib | 20 | 985423 | -256 | -12.80 | 915423 | -208 | -10.40 |
| web-platform | 2 | 888703 | -352 | -176.00 | 850479 | -656 | -328.00 |

Commands, emitted source, link diagnostics, section sizes and symbols are under
`~/.cache/nts-scratch/900/runtime-size-materialization/`; the summary SHA-256
is `bbb75dc632c0660743441d9d6281231578b87f655e16d9ba46c2af414658f645`.
The materialization-only text pass and publication comparison have no finding.


## Named guard finding: ECMAScript's contents size gate

The guarded open ECMAScript corpus exhausts the contents provider's budget once
less often (4 → 3) while operation visits increase by 594 (48,340 → 48,934).
The exact headers are:

```text
before: // contents: 3 read(s), 0 inert cleanup elision(s), 48340 operation visit(s), 4 budget exhaustion(s)
after:  // contents: 3 read(s), 0 inert cleanup elision(s), 48934 operation visit(s), 3 budget exhaustion(s)
```

Withholding `ISOParser#constructor@raises`'s consumed input removes 15
parameter-release edge blocks: 259 blocks become 244. The existing contents
owner rejects functions above 256 blocks before scanning. The unguarded
function therefore costs one visit and publishes Unknown(Budget); the guarded
function scans 244 blocks and 456 placed operations (700 visits), finds no
`nts_map_new` or `nts_table_new`, and publishes Unknown(AmbiguousIdentity).
This function's scan gains 699 visits; the other guard count/variant changes
net −105, giving the measured +594. The three other over-limit functions
remain over the gate. This is a pre-existing size cliff, not a budget changed
by #900.

No recorded read answer changes. The three reads remain byte-identical:
`getSubstitution %73` at `regexp/builtins.ts:519`, and
`JsonValue.objectValue %54` at `json/value.ts:359` and `%91` at line 373; each
is `Unknown(not one closed fresh identity)`. The affected constructor has no
contents read and no proved container, so no newly known fact reaches emitted
code. Both builds make zero inert cleanup elisions. Its prepared HIR is
identical after count removal and exact contraction of those 15 release/jump
blocks. Refusals stay at 401. Accumulator statistics are unchanged (2
candidates, 0 wrapping rewrites, 91,880 visits, 3 exhausted budgets).

The guard-only header audit covers all 1,125 captures: this is the only change
in contents/accumulator budget exhaustion, and refusal counts never change.
The closed standalone proof remains unchanged (178 consumes traces and all
33 counted artifacts), so this finding belongs only to the host-entered guard.
It is retained as a finding, not discarded as visit-count instrumentation.

| Artifact under `~/.cache/nts-scratch/900/` | SHA-256 |
|---|---|
| `guard_budget_audit.py` | `47bd7fa0e27076b78ae082a5f589ecad1bd737917f2aa64a73ee07620e89f3c9` |
| `guard-budget-audit.json` | `e079478c00516492d755ab775a6a5ef1d556e0e583b59ed4b1acc2239bb262c0` |
| `ecmascript_contents_finding.py` | `9931a01c33eabd62518c2f627650e5e687645c88e421d1119f918192d0547864` |
| `ecmascript-contents-finding.json` | `5a685c3f5b360f11faee6295c8f2801c55a080155808fba64920af573aec13c0` |


## Guard-only memory and census differences

All 108 configurations pass the guard comparison with zero capture failures.
No memory-v3, legacy-comparison, census-failure or completeness status changes.
There are no report order-only differences. All 78 `tests/memory` projects keep
their site/context/home and census results; only `async-method` changes its
truthful legacy-comparison work counter. The table retains the guard's changed
runtime results rather than applying the materialization identity claim to them.
“Site” includes additions/removals and changed site fields; “Context” includes
arrival identity and context presence changes; “Home” counts changed home or
variant fields in matched contexts. Every before/after value is retained in
each corpus's `.classification.json`. Census summary counters are listed
separately. All changed report rows, with exact multiplicities, are retained
in `.report.diff`; no work or result field is invented or normalized away.

| Corpus | Site changes | Context changes | Home changes | Census summary changes | Off comparison work | Guarded comparison work |
|---|---:|---:|---:|---:|---:|---:|
| ecmascript | 7 | 1592 | 6 | 2 | 100068 | 100033 |
| node/assert | 68 | 4721 | 0 | 2 | 214988 | 214013 |
| node/async_hooks | 68 | 1019 | 0 | 2 | 15997 | 14982 |
| node/buffer | 68 | 991 | 0 | 2 | 15414 | 14403 |
| node/child_process | 68 | 6845 | 0 | 2 | 539830 | 538841 |
| node/cluster | 68 | 7868 | 0 | 2 | 737930 | 736957 |
| node/console | 68 | 5321 | 0 | 2 | 372933 | 371962 |
| node/crypto | 68 | 8418 | 0 | 2 | 1374038 | 1373057 |
| node/dgram | 68 | 7596 | 0 | 2 | 687140 | 686166 |
| node/diagnostics_channel | 68 | 860 | 0 | 2 | 12282 | 11268 |
| node/dns | 68 | 2097 | 0 | 2 | 55788 | 54770 |
| node/events | 68 | 4561 | 0 | 2 | 204181 | 203204 |
| node/fs | 68 | 8565 | 0 | 2 | 1415567 | 1414599 |
| node/http | 68 | 8946 | 0 | 2 | 1222030 | 1221073 |
| node/net | 68 | 7541 | 0 | 2 | 656116 | 655143 |
| node/os | 68 | 1059 | 0 | 2 | 16751 | 15740 |
| node/path | 68 | 960 | 0 | 2 | 13961 | 12946 |
| node/perf_hooks | 68 | 4754 | 0 | 2 | 296881 | 295893 |
| node/process | 68 | 9105 | 0 | 2 | 1449337 | 1448385 |
| node/punycode | 0 | 0 | 0 | 0 | 1443 | 1446 |
| node/querystring | 68 | 1309 | 0 | 2 | 20539 | 19528 |
| node/readline | 68 | 5803 | 0 | 2 | 386669 | 385684 |
| node/stream | 68 | 5837 | 0 | 2 | 582457 | 581497 |
| node/string_decoder | 68 | 991 | 0 | 2 | 15424 | 14413 |
| node/timers | 68 | 1516 | 0 | 2 | 26115 | 25092 |
| node/tty | 0 | 0 | 0 | 0 | 28 | 28 |
| node/url | 68 | 1965 | 0 | 2 | 34484 | 33472 |
| node/util | 68 | 4827 | 0 | 2 | 225755 | 224781 |
| node/zlib | 68 | 6292 | 0 | 2 | 816170 | 815205 |
| web-platform | 0 | 0 | 0 | 0 | 341255 | 341261 |

`tests/memory/async-method` comparison work is 165 → 166; its census and every other report row are unchanged.

The control captures reuse the completed guard-off materialization pass with
`reused_from` and its original command/flags recorded on every reused row.
The first four corpora's independently captured report and census outputs are
byte-identical (8/8 SHA pairs). Both command forms prepare the same open roots;
`regions` does not change its callback policy from `--napi`. A later completed
fresh control capture is checked against its saved counterpart before reuse;
any mismatch terminates the comparison and requires the full matrix fresh.
No mismatch occurred. Cached candidate captures retain their actual commands.
The admitted completion unit is `nts-900-memory-guard-reuse2`, key `hir-compare`.

| Artifact under `~/.cache/nts-scratch/900/` | SHA-256 |
|---|---|
| `guard-experiment/guard_memory_reuse.py` | `0322160b4acdbdbe695ee5dcafd4a353868fb9dd4debdb4d8a927a2201e152d7` |
| `guard-experiment/memory-guard/summary.json` | `6d336e90aa411c7defe730f1cdebf0f93ccbc64872e8458650f926640ab1b4b2` |
| `guard-off-capture-reuse.json` | `85ce8f48703c8f0677c6beaf60152469f066d4a4ce885a5f245ba5b0e2fc2ab8` |

The 79 disappeared destination variants, including all three inspection
variants and `formatTime#into`, are the guard's stated price on host-entered
programs. The table and raw inventories include their site, context and home
effects. #912 is the route to recover this cost by cleaning intermediate frames
at a resumable landing; #900 does not widen that landing.

The landing dry run also exposed the missing portable declarations for the
eight new Rust readers. Their sorted rows in
`tooling/gate/rust-runtime-inputs.json` grant the fixture projects, inherited
configuration and the memory harness file. The Node API headers follow the
existing `class_exports.rs` route through the pinned third-party Node inputs;
they are not owned source files and receive no file grant. Shared
Rust helper traversal uses the structural module owner. The declaration
manifest is hand-authored; no selector/gate logic or broad directory grant was
added. This is necessary reader bookkeeping, separate from compiler behavior.


## Full candidate linked text and publication

The permanent candidate, with the approved host-only safety guard enabled,
emits and links all 30 runtime corpora on C and LLVM. Every `addon.c` remains
byte-identical to main's publication output. The compiler is the same immutable
candidate used for the guard comparisons and test262; flags and baseline
libraries match the materialization-only pass. The table separates the full
candidate delta from the guard's additional delta over materialization alone.
These net totals include the 79 omitted destination variants and guard count
changes; their size effects are not attributed to adapter wrappers.

| Corpus | Adapters | Full C bytes | C delta to main | Guard C delta | Full LLVM bytes | LLVM delta to main | Guard LLVM delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| ecmascript | 0 | 794559 | -560 | -560 | 746847 | -608 | -608 |
| node/assert | 1 | 722751 | -6288 | -6288 | 707487 | -8176 | -8176 |
| node/async_hooks | 0 | 351183 | -6016 | -6016 | 355791 | -7664 | -7664 |
| node/buffer | 0 | 364223 | -6368 | -6368 | 366287 | -8208 | -8208 |
| node/child_process | 19 | 867871 | -6688 | -6432 | 827439 | -9008 | -8800 |
| node/cluster | 4 | 922319 | -6000 | -5888 | 873935 | -8352 | -8256 |
| node/console | 1 | 747759 | -6496 | -6496 | 729967 | -8608 | -8608 |
| node/crypto | 4 | 956239 | -5552 | -5456 | 903295 | -8432 | -8336 |
| node/dgram | 4 | 901359 | -6000 | -5888 | 854863 | -8336 | -8240 |
| node/diagnostics_channel | 0 | 319551 | -6016 | -6016 | 320319 | -7712 | -7712 |
| node/dns | 15 | 423023 | -6288 | -6144 | 417471 | -8048 | -7936 |
| node/events | 1 | 710399 | -5984 | -5984 | 694927 | -8016 | -8016 |
| node/fs | 20 | 1016735 | -6496 | -6240 | 946031 | -8688 | -8480 |
| node/http | 4 | 1058767 | -6144 | -5648 | 978559 | -8880 | -8400 |
| node/net | 4 | 913135 | -6112 | -5904 | 865599 | -8448 | -8256 |
| node/os | 0 | 380783 | -6368 | -6368 | 383887 | -8208 | -8208 |
| node/path | 0 | 361023 | -6032 | -6032 | 361231 | -7680 | -7680 |
| node/perf_hooks | 16 | 801951 | -6480 | -6336 | 767839 | -8480 | -8368 |
| node/process | 4 | 1037279 | -5664 | -5552 | 961055 | -8000 | -7904 |
| node/punycode | 0 | 258623 | -160 | -160 | 257727 | -160 | -160 |
| node/querystring | 0 | 399183 | -6384 | -6384 | 388735 | -8208 | -8208 |
| node/readline | 17 | 781695 | -6752 | -6608 | 761199 | -8992 | -8880 |
| node/stream | 5 | 835647 | -5504 | -5360 | 795647 | -8368 | -8224 |
| node/string_decoder | 0 | 358639 | -6368 | -6368 | 360655 | -8208 | -8208 |
| node/timers | 15 | 358655 | -6464 | -6336 | 358511 | -8224 | -8112 |
| node/tty | 0 | 238799 | 0 | 0 | 238799 | 0 | 0 |
| node/url | 0 | 468543 | -6368 | -6368 | 448911 | -8208 | -8208 |
| node/util | 2 | 762463 | -6320 | -6320 | 747631 | -8448 | -8448 |
| node/zlib | 20 | 978863 | -6560 | -6304 | 906687 | -8736 | -8528 |
| web-platform | 2 | 888527 | -176 | 176 | 850271 | -208 | 448 |

All section sizes, symbols, compiler commands, link diagnostics and executable
hashes remain under `~/.cache/nts-scratch/900/runtime-size-candidate/`.
Its summary SHA-256 is
`675fbd0addebe4bda4fe40b0fa95276405aff8d90ab9c0a5b834f64a55ec46aa`.
The full-candidate text/publication unit is `nts-900-runtime-size-candidate`,
admitted with key `runtime-text-size`.

After the eight reader rows and the established third-party Node route were
committed, the landing dry run planned without source or reader refusal.
It selects 21 landing steps on 24 slots; its 11.6-minute estimate includes the
existing 11.5-minute tooling step, with a 34.8-minute step ceiling. No landing
was queued. The successful plan is retained at
`~/.cache/nts-scratch/900/check-dry-run-readers2.log`, SHA-256
`9e412ca89951482faf0d08be496e659409f4146e714596acbb409858573a8771`.


## Recoverable raw captures and landing admission

The completed materialization memory reports and census captures are retained
losslessly in `~/.cache/nts-scratch/900/memory-materialization-captures.tar.zst`
(SHA-256 `b30a73e23d0a5ad7ed25929b16b34bf1b8949805ed98917e9dae7e95e6d18ef2`).
All 432 archived members were decoded and checked against their original SHA-256
before removing the uncompressed copies. Their original paths, sizes and hashes
are indexed in `memory-materialization-archive.json` in the same directory
(SHA-256 `54d9f697f2182115d4cadc406eb094660d83bb52d26691b3a1556c1a79c5c9f2`).
The archive is 188,350,194 bytes for 18,261,018,146 original bytes. Restore with
`tar --use-compress-program=zstd -xf ~/.cache/nts-scratch/900/memory-materialization-captures.tar.zst -C ~/.cache/nts-scratch/900`.
The archive script and its verification log remain beside it.

The first local landing attempt lacked JAVA_HOME and ANDROID_HOME in its unit.
The corrected attempt on `353e80473e3154a9a480bdf81c28d94669f2a994` was held
before build admission: it needed another 4,891,320,320 disk bytes above the
40 GiB floor and active build promises. No check result is claimed from either
attempt. Logs are `here.log` and `here2.log` in the issue scratch directory.
The verified archive recovers space for a further attempt.


## Passing observations and unchanged refusals

The local landing check on `88be96f0783abf75991b70d5216e591d11f44d15`
passed 20 of 21 steps, including tests, Clippy, doctests, tooling, gate-inputs
and test262. It found one fixture-placement error: the program fixture held
three deliberately unsupported observations. Its example-refusals step correctly
refused that shape. The run is
`~/.cache/nts-landing/runs/here-88be96f0783a-1795215935377`; the complete
verdict is in `~/.cache/nts-scratch/900/here3.log`.

Those three exports move into dedicated refusal fixtures, each retaining a
compilable direct caller and the published store body:

- `a-published-functions-length-is-refused`
- `a-stack-read-after-a-direct-published-call-is-refused`
- `an-arguments-read-after-a-direct-published-call-is-refused`

Their `// expect:` messages are the exact NTS1001 messages from main's pin.
The program fixture retains name, the toString prefix, and rest/default
observations, with no refusal allowance. No gate ledger or script changes.
The broad HIR captures predate this split; its only effect on that measured
program is removing the three uncompiled exports and their refusal footer.
The dedicated main/candidate refusal comparison and the next landing run
validate the final placement.


## Final Towers instruction counts

The no-rewrite control disables only `materialize`, using a saved byte copy
of committed `own/entries.rs`, after commit
`88be96f0783abf75991b70d5216e591d11f44d15` and a separate `git log -1`
observation. Both control and restored candidate use plain `cargo build
--release` in this tree and target. After restoration, `git diff --exit-code
HEAD` returned 0 and the restored file exactly matched its committed blob,
SHA-256 `5d7d82b3f8b7de8684edeb5e7964ffcfb7af2021052fee08172a87273c554112`.
The temporary control source SHA-256 was
`6f2b1a213d71bf873112a1f2a6bb67a7d64e5a5bc96231ff606b2fbf2f24dbb7`.
The fixture split followed that audit and changes only test data and this record.

| Build | nts SHA-256 | nts-bench SHA-256 |
|---|---|---|
| No materialization | 1114dc4be204af68ffaa34947703a51018ac296f27f7048fd1f6eb01f5333fd5 | 3d1e07eaa5198d761c76e7aad7ca707514cefe46013a4090a2b50186a455ed0b |
| Restored candidate | fb33d174c9ebc7c3bec0998cd1145318891a8c9197099c38563e5503eebc8cea | 2726d7a8e62feaa09aee4a47b5eda9fa48a8dc8f1f276c7a12d5b670960fe260 |

The control is main-equivalent on the actual tree's benchmark workload: its
`hir --prepared --rc --backend <c|llvm> --main --entry work` output is
byte-identical to the b9dd04e8fa8b pin on both backends. C HIR SHA-256 is
`54f05bfe9d9ad84df6ee0cb5ec7176cec02bf6487c2be85868460ac4bb667d82`; LLVM is
`88dfe91db939fbee70649acf732093f6951c641d2e7ebf47bfdbda33f323bf97`.
The benchmark config comes from this tree, not the pin's benchmarks.

Both `nts-bench --root <tree> --count awfy-towers` headers identify CPU 0,
outside the measurement pair. The supplied `NTS_BENCH_COUNT_CPU=2` variable
was unused; the actual CPU is 0 for both runs. Both native column bands are
1 basis point (0.01%), from the header's 20-run fib cohort at
681114285dcca4bce83aa57231009966429ece8f.

| Column | Main-equivalent control | Candidate | Delta | Candidate/control | Reduction | Band |
|---|---:|---:|---:|---:|---:|---:|
| nts C | 941646 | 751869 | -189777 | 0.79846248 | 20.15375% | 0.01% |
| nts LLVM | 908821 | 735454 | -173367 | 0.80923966 | 19.07603% | 0.01% |

Both improvements exceed their observed bands. C++ counts 347328 in each
run; node counts 1148465 and 1148303 within its 25-basis-point band.
The control and candidate builds, commands, source restoration audit,
benchmark-generated files and binary hashes remain under
`~/.cache/nts-scratch/900/towers-final/`. The units are
`nts-900-towers-final-counts` (control build) and
`nts-900-towers-final-counts3` (fixture guards, counts and candidate build).
The full-corpus reservation was not reused for the four sequential HIR
identity captures: their focused whole-job admission uses `hir-control`;
the completed 1125-config comparison retains the required `hir-compare` key.

| Evidence in issue scratch | SHA-256 |
|---|---|
| towers-final/build-audit.json | b656acb1a6e3a430d26d8bc02a7594f3790523b1bf292e3c10c438a31325ae59 |
| towers-final/control/hir-identity.json | 019edc0e1f9935a8d2ee2fcd752e10d90770e5509526a78289529fedd30db43f |
| towers-final/control/count.stdout | f77fd15bb266b987766119924a7d50fb2ac0632236f828c6bdb8f3c19d7759dd |
| towers-final/candidate/count.stdout | 382257e38c8e7a2bc0ed7e501ecd452dff52d6ecd102cbb7b8e213077a766f15 |
| refusal-split/summary.json | 92dbc24a56e21ca49e02e77f494001d0e558850eefca2e776c92553ee45b977f |
| refusal-split/pair-audit.json | 1ac7a050beb1a60f986bfe26147c0b056267f0d311e38ccfa0cadc5131e84f75 |

All 24 raw/prepared refusal captures match the exact main-pin text; JVM
uses its managed-memory route, C and LLVM use RC. The passing program
refuses nothing on both compilers. In each new refusal fixture's direct
control, C and LLVM show one parameter retain in main's published body and
one caller argument release; the candidate's single consuming body and
direct caller show neither. The executable saved-capture audit checks all
six pairs. No unsupported observation is made to pass.


## Locked candidate timing and external entry cost

One candidate-only sitting ran with
`with-lock.sh --wait --key bench-session`, on CPU 4 with sibling 5 reserved
and quiet admission satisfied. No outer memory reservation or column filter
was used. The machine was an i9-14900K, 32 logical CPUs, Linux
7.2.11-arch1-1, powersave governor with turbo enabled. The sitting spans
23:51:54–23:52:47 UTC. Load moved from 15.65/21.63/29.23 to
12.01/19.59/28.10; available memory from 21.71 to 19.82 GB.
The captured package thermal-zone value was 87 C at both ends. The row is
unspoiled, every cell is verified, all checksums are `3ff0000000000000`,
and no JVM/native warmup was capped.

| Column | Microseconds/op | Repeat max/min |
|---|---:|---:|
| nts C | 28.97955 | 1.072518 |
| nts LLVM | 28.31433 | 1.358979 |
| nts JVM | 28.31216 | 1.016861 |
| C++ | 12.84722 | 1.044353 |
| Java | 19.90289 | 1.048103 |
| node | 35.08672 | 1.036573 |
| Bun JIT | 23.08746 | 1.021773 |
| Bun AOT | 35.14014 | 1.033038 |
| ScriptC | 93.48308 | 1.021307 |
| nts f64 | 28.46709 | 1.025041 |

Every verdict ratio in the saved row is included here:

| Column | /node | /Bun JIT | /Bun AOT | /ScriptC |
|---|---|---|---|---|
| nts C | 0.825940 SHORT | 1.255207 LOSS | 0.824685 WON | 0.309998 WON |
| nts LLVM | 0.806981 SHORT | 1.226394 LOSS | 0.805755 WON | 0.302882 WON |
| nts JVM | 0.806920 SHORT | 1.226300 LOSS | 0.805693 WON | 0.302859 WON |

The native instruction savings are established by counts. This timing sitting
still loses against Bun JIT, and is short of the node ratio bar; those cells
are retained. LLVM's repeat max/min is 1.358979, so the timing is not evidence
of a precise before/after wall-time percentage. Ratios compare columns within
this sitting only. The f64 cell is the tool's additional diagnostic column.

The tool-written result is copied to
`~/.cache/nts-scratch/900/towers-final/sitting/run.json` (SHA-256
`4e3e4b41011d2c72611a94640c1627cc0ddb2b66fae6023f4d3c9d52bfe306bd`).
Its stdout SHA-256 is
`2ab4f25f8a168ed2ae30eb68c0bbbc18f4dd08ceb8d3deffa291302764f0f013`;
`conditions.json` beside it has SHA-256
`4de48a48011501a46c7e322e33e1a20f3fdba30e832a92f4491618980c9c285b`.
Comparator build commands, versions, hashes, affinity, warmup details and
sibling samples remain in the saved result. The named unit is
`nts-900-final-locked-proof`.

The already-built LLVM published-entry control with explicit IR `noinline`
finishes the external-call cost measurement. Both IR copies have the same
noinline policy; original emitted IR is unchanged. Five instruction samples
under the `perf-count` lock on CPU 4 give medians 8,677,318 on main and
9,377,317 on the candidate for 100,000 calls: +6.99999 instructions/call,
1.08066997 candidate/main. The sample spreads are 0.00002305% and
0.00002133%; all runs return the expected 700,000 with no live bytes.
This agrees with C's visible-call +7.00004 instructions/call control.
The normal optimized C/LLVM external row, where the adapter can inline,
was reported separately above. The LLVM noinline count evidence is
`~/.cache/nts-scratch/900/llvm-external-noinline-counts.json`, SHA-256
`d8519575794c08f0cba58210b1b690379983f72a630b0982e079180d112d848c`.
The gross adapter sizes remain 29 C bytes and 32 LLVM bytes in this
three-argument row; there is one consuming body.


## Foreign handle blocker contract

The corrected-fixture local check on `8004abb49dc393b99ca4c0e6b100376e753e0097`
passed 21 of 22 steps, including the new refusal fixtures, example-refusals,
all Rust/backend tests, tooling and gate-inputs. Its sole red was the old
`once-c __nts_guarded_nts_dom_release((void *)` assertion in
`an-owned-handle-used-in-a-loop-is-never-released`. Its exact run is
`~/.cache/nts-landing/runs/here-8004abb49dc3-1795219279577`; the final
verdict is retained in `~/.cache/nts-scratch/900/here4.log`.

A focused main/candidate execution establishes the ownership change. It emits
the exact fixture with `emit-c --napi --rc`, links the same counted foreign
Document mock under `NTS_POISON`, and forces collection after each call,
after clearing the deliberately kept closure root, and after releasing the
mock host's root. Both compilers dispose 1000 of 1000 documents, have two
references after `go`, one after closure cleanup, and zero managed-byte growth.

| Compiler | Foreign retains | Foreign releases, including host root | Documents disposed | Managed live delta |
|---|---:|---:|---:|---:|
| Main pin | 4000 | 5000 | 1000/1000 | 0 |
| Candidate | 2000 | 3000 | 1000/1000 | 0 |

The emitted C diff removes exactly two caller retains in `go` and the
parameter release at `each`'s loop exit. Under the resumable guard that
parameter borrows: those temporary caller references are never created.
The closure capture retain, its foreign-slot descriptor and release-family
hook remain byte-identical. There is no moved body in this fixture.
This is an eliminated balancing pair, not a lost owned release.

The blocker harness's runtime form can load a Node addon, but cannot supply
this fixture's native DOM mock. Its approved text contract therefore changes
to `once-c ((void *)__nts_v0);`: the sole cast call is the capture retain.
Either an added caller retain or an erroneous parameter release would add
another occurrence and fail. Main has four occurrences; the candidate one.
The TypeScript program body is unchanged, and the fixture names this evidence.

All commands, poison builds and executions remain in
`~/.cache/nts-scratch/900/foreign-handle-boundary/`. Main `program.c` has
SHA-256 `b68830611ea445de8aa0ca280d007834e2ec834cfffea436cebcfea1e4af6d4e`;
candidate `program.c` has
`3417e6852fce2f77320bdbd94c8f864a59e95a75b857907fb20d468f533a532f`.
The shared harness SHA-256 is
`6bd59bccb895aa0a2c3f5c49bef4d63d15ba30e119ad599fd257a5990069db17`;
`summary.json` has
`a0a5b708775b32cbe139c4cb1664cd73eb782c7e008297e6ab9405dc69d88945`.
The unit is `nts-900-foreign-handle-boundary`, admitted with
`foreign-handle-probe`. No compiler change was needed.

## Named-addon guard coverage

The first named-entry addon probe passed on C and LLVM, but did not exercise
the consumes guard: its raising routines were published and already borrowed,
and this root selection produced no `keep#whole` specialization. The test is
strengthened, rather than counting that as evidence about private frames.
Published `deepStore` and `quietStore` now forward to private
`storeAfterRelay` and `storeAfterQuietRead`, matching the core four-roots
matrix. The helpers retain the raising/reading call before their store.
Shape assertions require private helpers, a relay through `nestedThrow`,
a thin public forward, and unsafe consumes withheld while quiet consumes
remain available. Client return/throw/live-byte assertions are unchanged.


## Final private-frame boundary result and dependency

The strengthened NAPI test is green in the delta inner run
`nts-900-inner-boundary3`: `inner.ts --no-agree --base
8004abb49dc393b99ca4c0e6b100376e753e0097`. Formatting, Clippy, fresh compiler
build and tests pass; the tests take 465 seconds. This checks the changed
NAPI crate and the mandatory C, LLVM and JVM backends, after the earlier
full-card inner run. The actual private-helper shape assertions and all
return/throw/live-byte observations pass.

The corrected external probe uses the same unchanged client and private-helper
source on main's pin and the final candidate. The exact outcomes are:

| Build and roots | C | LLVM | Observation |
|---|---|---|---|
| Main pin, open addon | strict deep-input assertion fails | same | 80 live bytes versus expected 0 |
| Candidate, open addon | passes | passes | all incoming arguments balance; final keeper residual 32 bytes |
| Candidate, named `--napi --entry` addon | strict deep-input assertion fails | same | 80 live bytes versus expected 0 |

The 80-byte incoming-array leak is separate from the already documented
32-byte keeper-receiver residue. There is no allowance for the incoming
argument leak: the assertion stays exact at zero. Main itself leaks across
this private frame today (#912); the guard fixes that shape under open roots.
The named CLI build still incorrectly supplies closed `Entry` roots, so the
guard is not asked to protect that resumable host. This is #911's root-owner
classification defect. No second product predicate or emission.rs workaround
is added here. After #911, the named addon must pass the same assertions.

Raw corrected captures are under
`~/.cache/nts-scratch/900/boundary/{main-private,candidate-private-open,candidate-private-named}/`;
`corrected-boundary.json` in the issue scratch directory records all commands
and statuses, SHA-256
`524df9809b07759b378d77fb66fe1f4fdae61d0daf3ea25662dadd6f7629456f`.
The four main/named C/LLVM failure stderr captures are byte-identical,
SHA-256 `5e03f653c52880b63a851361381294ead7a7ad6965061e5da80593d14732db03`.
The two open-candidate success stdout captures are byte-identical, SHA-256
`4f3fa966f097b0f4dfa061f98bf86a78a74523ffbb8bc7652d86c42b7569380d`.
The named unit is `nts-900-corrected-addon-boundary`, admitted with
`addon-boundary`.

The Towers counts and locked sitting are complete above. The Bun JIT cells
remain losses: 1.255207 C and 1.226394 LLVM. The census identifies the
remaining work: 8,205 null old-`disk.next` releases assigned to #916; three
common null retains; four common null releases (three array-fill slots and
one initial piles replacement); and 15 necessary effective final releases.
There are 15 allocations and no leaked objects. The common operations and
all emitted release sites are listed in the census table above; #916's
removal would lower the attempted floor from 8,227 to 22. No further timing
claim or measurement is inferred from that target.

The last full local landing run passed 21/22 before the approved foreign-handle
expectation correction. That sole red was settled by the 1000/1000 poison
disposal comparison and the approved balanced-shape text assertion; no
compiler fix was necessary. Its log SHA-256 is
`a3071f9d6f5ed44964cf80450fc1dae097b5fe3f0616805bbe0760182f003a45`.
Per the dependency handoff, the remaining proof after integrating #911 is
the named addon arm and the final `check.ts <commit> --here`. The task is
not reported ready and no landing is queued.

The green delta inner log is `~/.cache/nts-scratch/900/inner-boundary3.log`, SHA-256 `033ded58c76adbc09b91a0e4d2a90b2e2ea57b2a4e8ea1cb730fbae144431cf3`.

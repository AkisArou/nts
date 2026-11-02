# Memory stage 2: facts before consumers

Review against main `409dd8fee813`, before compiler edits. Prototype
`0eb343cd6` remains prior evidence, not current-main qualification.

**Governing decisions.** [Memory](../../foundations/memory.md) is the authority:
M1 redirects R4(b); principles 1–8, the ladder, formulation table and stage-2
row govern every fact below. Supporting contracts are record 0006,
[closures](../../language/functions.md#closures),
[errors](../../language/errors.md#decisions),
[bounds](../../foundations/objects.md#arrays) and the block-lending audit in
[calling C](../../targets/calling-c.md#decisions).

**Boundary — M1, principles 1/5, stage 2.** One `hir::memory` analysis observes
live SSA after closure/coroutine transformation, specialization, boxing and
`destinations::pass`, before `place_allocations`, region rewriting and counting.
Visit placed operations and `Func::parameter_values`, excluding orphan arena values.
**“Computed but unused first” means diagnostic/comparison demand**, once per
immutable revision (principle 5); ordinary builds invoke it zero times. Every
registered program is still compared. `nts regions` obtains its detached report
there, not by analyzing counted code. This first landing enables no allocator, capture or counting consumer. Native NoGC
and RC are observed; HostGc makes no native-home claim.

**Validity — principle 1; architecture's convergence decision; L14/L15.** Facts
belong to the exact bodies, CFG, roots, layouts, representations, provider and
runtime contracts analyzed. Any rewrite of these invalidates them. Live queries borrow that revision; detached diagnostics grant no permission.
Every exceptional successor must exist before ownership/counting, including
Invoke/outcome and bounds-failure edges. Missing outcome/callee information
is unknown, never a proof of purity or confinement.

On main409 this ordering is **not universal**: local throw jumps and some
lowered call/rejection branches already exist, but generic `Call` has no
Invoke/outcome successor; runtime `MayRaise`, unsealed indirect/implicit calls
and backend-only checks lack a universal pre-RC edge. At every unsealed may-raise, live-before references (including last-use
operands) and raised payload reach an unknown root; confinement, retention and
later-write proofs are Unknown. Proved native terminal stops remain distinct. The 409 source audit and complete helper inventory are retained at
`~/.cache/nts-handover/compiler3/memory-stage2-exception-audit.json` and
`memory-stage2-may-raise.tsv`. A paired HIR fixture must deny confinement
and root the payload for a missing-edge raise; changing only its callee to a
proved-NoRaise body is the positive control.

| Part | Formulation and proof obligation | Decided basis |
|---|---|---|
| Aliases | Directional inclusion over allocations, formals, globals and outside identities. Views/erasure preserve identity. May-alias is not equality; unification is fallback only. | M1, formulation: aliases; principles 1/2 |
| Locals | SSA edge arguments and sparse current-block facts via `get_at`, global `get`, `guarded_by`. Joins union possibilities; pending is not proved empty. | M1, locals; convergence decision |
| Fields | Semantic private/inherited field identity; shared memory-use chains. Strong updates require one dynamic instance, never one site name. | M1, fields; principle 4 |
| Containers/value facts | One array-element summary; separate map keys/values and headers/backing stores. Join tags, presence and numbers over every writer; unseen writers poison facts. Declared types license nothing. | M1, arrays/maps and value facts; principle 2 |
| Instances | Recent plus older-instance summary; re-execution demotes existing aliases. Share #168's proposed `cfg::cyclic_blocks(&Func)` membership, computed once by iterative SCC traversal; add overlap/liveness proofs for loops, recursion, reentrancy and suspension. Publish per site/context: 1, a bound k with witness, or unbounded. Invalid CFG/domain queries are error/Unknown. No transitive-closure fixpoint. | M1, dynamic instances; principles 2/4 |
| Calls | Parametric returned/projected aliases, correlated stores/captures, callbacks, raises, suspension and reentrancy; substitute actuals together. Accessors, conversions (`toString`, `valueOf`, `Symbol.toPrimitive`), iterators and thenables are call edges. Missing/abstract bodies and unaudited helpers have top effects. | M1, calls; L14/L15 |
| Context | Bottom-up call-graph SCCs; shared recursive summary, bounded selective instantiation. Preserve correlated actuals; share dispatch-slot nodes instead of copying target vectors. | M1, context; convergence decision |
| Roots | Environments/cells, coroutine frames, reactions, modules, erased/raised payloads, host callbacks and runtime roots have explicit lifetimes. Unknown external retention is conservative. C loans carry block/parameter/temporary anchors, including suspension. | M1, roots; block-lending audit |
| Homes | Derive register/scalar, immortal, frame, cohort or heap independently of legacy placement. Frame needs bounded storage and non-overlap; a mixed ephemeral/survivor site stays heap without splitting proof. Cohort needs both lifetime and bounded-retention proofs, including dead fields' heap graphs and backing storage. | Ladder; principles 2/4/7; region's two proofs |
| Runtime obligations | Collector candidates/work lists and traced fields cannot reach reset storage. Weakly observable objects remain heap, with no reuse while observable; registry-held values are strong. No collector/allocator/weak-policy change or annotations. | M3/M5/M6; reset safety; M2/M4 stages unchanged |
| Budgets | Charge indexing, propagation, joins, substitutions, migrations, report construction and dispatch fan-out before expansion. Size-scaled work/edge limits; incomplete dependencies publish top and heap with named reasons. Widening is irreversible per monotone node/memory-event version; strong updates create new versions. | Principle 8; audit P-7; architecture's convergence decision |

**Shared effects and captures — M1; bounds decision; closures/#184.** The same
store summary identifies slot writes, length growth/shrink, buffer resize/detach
and reference-slot replacement. Bounds substitutes actual identities and keeps
length facts only when these effects cannot invalidate them; it adds no second
call-effect analysis.

Publish `later_write(binding_instance, capture)` as proved-none, may-write with
witness, or unknown. Sparse memory-event edges use the same aliases, call
summaries and instance boundaries; propagate possible writes backward without
a whole-CFG search per capture. Missing implicit-outcome/producer edges give named Unknown, including this
query; an empty event set is not proof. A new iteration ends the old *direct-instance*
path, but retained aliases, callbacks and suspended work remain represented.
Object mutation is distinct from reassignment of the captured binding. Only a
complete no-later-write proof licenses the future by-value consumer. The first
facts-only landing leaves #164's cells unchanged; enabling #184's consumer
would change emitted code and the retained row, so it is a subsequent measured
consumer change, not silently included in this diagnostic landing.

**Reuse and cost — M1; principles 5/8.** Keep escape's forwarding/helper contracts, liveness, tests and SCC fact. Keep regions'
frontiers, R4(b)'s report/failure types, fixtures and reset audits. Replace duplicated alias/writer derivations only as consumers migrate;
keep ownership/count insertion. Do not reconstruct ownership from retain/drop
intervals. Revalidate the prototype; do not transplant its ancestry.

Summary substitution and alias/store propagation are the principal cost risk.
Use bounded symbolic summaries, delta worklists, change-tracked effect joins
and size-weighted weak-class unions. For alias limit K, sticky widening permits
at most K+1 points-to promotions per node/event version; assert that bound,
charging redirections and summary substitutions separately. Never reset and
repopulate a strong-updated slot under the same counter. Guard chains, stores, recursive/distributed cycles at
16/32/64 and dense-parent/shared-slot cases at 16/64/256, including duplicates
and order. Keep simultaneous recursive allocations and retained callback/loop
roots as recency-demotion controls. Report work, maximum promotions and simultaneous live analysis
bytes, including initial indexing. Require at most approximately n log n growth
and completed controls, not success by budget exhaustion. Measure ordinary
preparation and explicit diagnostic cost separately on web-platform,
fs/http/process and zlib, NoGC/RC; ordinary solver-entry count must be zero.
Use internal storage counters; no whole-module heaptrack interpretation.

**Report and first slice — M1, stage 2; principles 2/7/8.** Stable TSV rows name
program/options, function/context lineage, site/storage identity, aliases,
stored-value facts, multiplicity, roots/frontier, bytes held to that frontier,
proposed and legacy home, and
proof/failure witness. Use deterministic origins/ordinals, not addresses or
hash iteration. Three complete runs must match byte for byte; unmapped sites
or unexplained differences block acceptance. Retention bytes are bounded with
a witness or explicitly Unknown, including backing stores and transitively held
heap graphs; shared graphs are counted once. Choose the frame-limited bound
from census data (audit M-1), never an invented quota. Compare every registered
`tests/memory`, `tests/programs` and `benchmarks/cases` project on C/LLVM,
NoGC/RC, retaining refusals and unavailable facts explicitly.

First: json-parse/tree-teardown, with traversal/shared-tail controls.
Separate parser scratch/reused frames, results, key templates and backing growth; retain the parser unchanged, including shared placeholders
(their `null` replacement is stage 3). Explain tree overlap, sharing and reset obligations. Rebuild the placement-difference worklist on the final parent. A new
heap answer against legacy frame/region requires an independent witness and
remains a precision obligation before any placement consumer. Prove emitted
code, behavior, allocation/count/leak rows and ordinary preparation unchanged;
use existing compile-time tripwires and record readers at their own budgets.

**Departures:** none proposed for this landing. Placement/parser changes, allocator/collector work and #184
rewriting remain outside this landing. Enabling them here would depart from
stage 2 and goes to the user before implementation.

# Exceptional transfers and activation overlap

Design for #18 on landed `1e1a3ae21339`, before implementation. The producer
serves both [plan item 11, L15](../../plan.md) and
[memory stage 2](../../foundations/memory.md). Compiler4 reviews the mechanics;
Main reviews the decided contracts. The catch interface is coordinated with
tsrs2's #188. No departure from a user decision is proposed.

## One graph, before ownership

**Basis: memory M1, principles 1/2/8, formulation rows calls and roots;
errors' L14/L15 decision; record 0343.** Every potentially raising operation
has its actual normal and exceptional successors before escape, regions,
ownership or count insertion. Introduce a logical Invoke/outcome representation
in HIR, with one checked edge/operand enumeration consumed by CFG, dominance,
liveness, reachability, memory and the verifier. It is a producer of executable
control flow, not a second diagnostic exception graph.

Current main has local throw jumps and lowered raising-copy tests, plus Await
rejection edges, but no universal HIR Invoke terminator. Thus this is not merely
moving an existing pass. Lowering records the actual handler/continuation and
invocation identity; one preparation pass completes and validates the edges.
Every operation introduced by a later rewrite must either supply its sealed
outcomes or invalidate and rebuild this representation before its consumers.

| Outcome | Control and values available |
|---|---|
| Normal | The result is defined only on this successor; normal block arguments carry the live caller state. |
| Raise/transfer | The original erased payload, any independent detail owner, and actual continuation arguments reach the exceptional successor. The normal result does not exist. |
| Terminal native stop | There is no surviving JavaScript continuation, catch or finally edge. |
| Unknown | Missing body, contract, producer or edge denies dependent lifetime, overlap and later-write proofs; memory keeps a named UnknownRoot fence. |

The runtime's shared `Raising`/`has_exceptional_outcome` contract remains the
authority for helpers. `Transfers` is not `NoRaise`: physical `noreturn` says
that a helper does not return normally, not that its payload dies. A proven
process-ending helper has no landing; `nts_uncaught` can reach an outer landing.
Its payload, retained children/backing storage and an independently supplied
detail therefore remain roots until that landing consumes them. Unsupported
foreign outcomes stay Unknown. A helper's spelling, return type, absent target
row or missing raising-copy name is never a NoRaise proof. Complete dispatch
uses the existing actual `dispatch_entries`, including interface defaults.

Install this producer after bodies, adapters and coroutine transformations have
made their calls explicit, and seal it before the first placement/ownership
consumer. Audit earlier optimizations that currently infer absence of raising;
they must consume the same outcome authority or retain a conservative answer.
The existing demand-only memory observation remains after destinations and
before placement, on the final sealed revision. A backend can lower the edge
but cannot create an exceptional edge that ownership never saw.

The proposed HIR shape is pinned before the first implementation probe:

```text
Invoke { operation: ValueId, normal: OutcomeEdge, raised: OutcomeEdge }
OutcomeEdge { target: BlockId, args: [Existing(ValueId) | Result | Thrown | Detail] }
Transfer { operation: ValueId, destination: KnownBoundary(BoundaryId) | UnknownBoundary(reason) }
```

The terminator owns and executes `operation` exactly once; its arena entry
holds the existing callee/arguments/result type and original operation identity.
It is a placed operation identity, not an SSA result available to readers.
`Result` is permitted only in the normal edge and defines its target's typed
block parameter; `Thrown` and `Detail` only in the raised edge, defining erased
payload and nullable managed-string parameters. Existing arguments must be
available before the invocation on both paths. Ordinary jumps have no outcome
tokens. Verify edge counts/types, token positions, single ownership, domains
and normal-result dominance before any indexed consumer. Every placed-operation
enumerator, including DCE and memory's inventory, must include terminator-owned
operations. Splits preserve the original operation/catch ValueIds and record
the new edge-parameter/remap relation, rather than reusing a normal result ID
as a thrown value. Payload/detail owner edges use the existing alias graph.

## Calling and catching

**Basis: errors' Decisions, plan item 11, record 0343; #188's producer contract.**
Keep raising copies and the raising flag in every indirect calling convention.
An indirect call's exceptional channel exists independently of whether the
compiler can name its current target. The common entry/dispatch plan records
the actual raising entry and its availability, for closures, bound functions,
virtual methods, accessors and generated wrappers. Ordinary-entry availability
does not prove that a raising entry is equivalent. A proven NoRaise target may
share its body; every other admitted target supplies the raising entry.

C and LLVM lower Invoke of a compiled/cooperating raising entry to that entry,
an immediate flag test and two real edges. A dummy machine return on a raise
is not an SSA result and cannot feed
the next expression. The existing flag/payload handoff is taken into SSA before
any finally, iterator close or other user code runs; a pending exception is not
left in a singleton slot while another call can overwrite it. Java's physical
throw/catch lowering implements the same logical edges and original value.
Canonical receiver/arity parameters and result widths remain the shared ABI
plan's responsibility. Direct closed NoRaise calls need no flag test.

The same proof removes an indirect site's test and raising-entry selection:
its complete reaching target set, from actual dispatch entries and closed-world
closure flow, must be proved NoRaise. Missing/unavailable targets, omitted
defaults and unknown writers keep the test; an empty or partial set proves
nothing. Reuse
the shared target/effect producer rather than adding another closure analysis.
The census names every site, its completeness/NoRaise witness or missing fact,
and whether it selects an ordinary entry without a test or a raising entry
with one. Report both counts, including generated and implicit calls.

A physical nonreturning external transfer is different. `nts_uncaught` stores
payload/detail into an active `NtsLanding` and longjmps; a flag test after it
cannot implement that edge. `Transfer` has no ordinary successor. Its contract
comes from the actual boundary-entry/landing producer and names the destination,
root lifetime and consuming payload/detail owner edges before cleanup. A known
outer landing is an outside root, not a fabricated local BlockId. An opaque
host landing or unaccounted skipped cleanup remains a named UnknownBoundary
and denies dependent confinement/overlap proofs.

On a cooperating compiled path, raising returns carry the packet and run each
frame's edge cleanups up to the outer entry; only there does the final uncaught
fallback materialize the physical nonreturning transfer. Preserve payload and
detail owners before releasing unrelated locals; the landing assumes those
roots and consumes/releases them at its actual lifetime frontier. Do not seal
a mid-stack longjmp as if intervening cleanups ran. Any runtime/foreign path
that cannot supply this contract keeps its conservative boundary. The decided
no-unwind-through-uncooperating-C policy still applies.

The original throw expression is evaluated once. Cleanup carries that value;
a terminating finally replaces its completion, while a normally completing
finally preserves it. A lexical catch wins before async rejection or a
synchronous raising return. A generator's throw reaches its actual resumer.
Async functions reject their promise rather than synchronously pretending to
return a missing promise. Callback and native-host boundaries preserve their
decided policies: no throw unwinds through an uncooperating C function pointer.
Terminal native declines still stop immediately without JavaScript unwinding.

#188 supplies each placed operation's actual ValueId and innermost catch thrown
identity through `lower.rs::push`/`lower_catch_body`. Copies and remaps preserve
both IDs, original call-origin ownership and handler arguments. Hoisted cells
and block parameters do not become prerequisites for entering a catch. An
unavailable concrete callee is handled only at its actually reached site;
ordinary diagnostics propagate, and a possibly reached throw is not a static
whole-program refusal. The final implementation composes the landed #188
interface, or explicitly coordinates the same interface while it is held.

For a null detail, #188's actual descriptor message slot is a borrow from the
original payload owner. An explicit non-null detail can have another owner and
must be carried separately. No reconstructed object or message sidecar replaces
the thrown value. Ownership transfers the payload once and releases each
abandoned local on the corresponding real edge. There is no backend cleanup
list that independently re-derives the graph.

## Activation overlap is a fact from the same memory analysis

**Basis: M1's dynamic-instance/context rows, principles 2/4/7/8; frame placement
requires a non-overlap proof.** Publish multiplicity per actual site, calling
context and storage-owning activation: One, Bounded(k) with a witness, or
Unbounded/Unknown with a reason. Also distinguish the number live across all
activations. Recursion can have arbitrarily many live native frames while each
frame needs one slot; repeated calls do not by themselves prove repeated
instances in a single frame. Returning an object to an ancestor still fails
the allocating activation's lifetime proof.

Use the shared validated CFG/SCC snapshot for cyclic execution and the existing
call-component, callback and suspension facts. An acyclic allocation executes
once per ordinary activation. Within a cycle, prove that no older instance is
reachable at re-execution from carried SSA values, live container fields,
captures, runtime roots, C loans or suspended work. Use memory's existing
recent/older identities and memory-event versions, not allocation-site equality
or a type test. If an older instance survives, require an actual finite bound
and witness or answer unbounded. A last surviving instance and short-lived
instances at one site are not split by assumption.

Synchronous recursive/reentrant calls have distinct activation owners. Retained
callbacks, coroutine frames and native re-entry can prolong those owners;
suspension is not a proof that a native stack frame survives. Exceptional edges
participate in the same reachability and liveness calculation, including
last-use operands and raw-view/erased carriers with independently held owners.
A missing edge therefore invalidates overlap as well as confinement. C loans
keep the block/statement/function anchors decided in memory's calling-C audit.

This is an extension of the one alias/store/lifetime graph, not a separate
escape pass. SCC construction is shared once per immutable CFG; use sparse
delta propagation with monotone facts and existing failure publication. Charge
actual indexing, edge/set visits, copies, substitutions and report construction.
No transitive-closure sweep or hypothetical quadratic precharge returns.
Budget exhaustion publishes Unknown, never a partial small multiplicity.

## Precision and payoff

**Basis: stage 2's migration rule, principles 1/2/5/7/8.** Correct the legacy
comparison in a separate prerequisite before interpreting its direction:
match actual post-placement clone/caller/callee lineage and stable ValueIds,
preserve all reachable variants, and name unresolved lineage Unknown. Do not
union homes by source-function name or infer context from a printed suffix.
Then audit the sharp Outside/RuntimeRoot/OutlivesFrame/Returned disagreements;
any real unsafe legacy placement needs a gated subject/control and a fix.
The existing direction counts remain provisional until that work is complete.

The retained frontier has seven source sites in four configurations each,
all with MissingOutcome plus RepeatedInstances. Re-run all 28 with explicit
payload/frontier/overlap witnesses, reporting how many now propose Frame and
why every other site remains heap. Report the larger same-context population
by missing producer too, with selective-context merge witnesses. Neither sealing
an edge nor recognizing an activation is enough alone to promise a heap saving.
Memory remains diagnostic. A placement consumer requires zero frame-to-heap
differences against the corrected actual parent, after each independently
demonstrated legacy defect has been fixed. Explained stage-2 precision gaps
still block; a legacy fix waives none of them.

Measure affected parser, tree/list and destructuring rows against the actual
parent, including ordinary preparation, size, allocation/count traffic and
runtime A/B on C/LLVM NoGC and RC. Any executable change due to exception
correctness is attributed separately from a diagnostic home proposal. Keep
#184's capture consumer, cohort placement, parser changes and collector changes
outside this producer. Frontier retention still includes backing stores and
transitively retained heap graphs; no quota substitutes for its proof.

Measure the cost of the added call test where calls dominate too:
`sort-objects` and its comparator, the callback-heavy AWFY and CLBG rows that
currently run, and JSON reviver/replacer rows where present. Freeze and name
that population before measurement, with explicit absence or refusal rows.
Run actual-parent A/B on C/LLVM NoGC and RC, on CPU 4 under `with-lock`, and
retain instruction counts and ratios beside the site census. Distinguish
proved-NoRaise sites whose tests disappear from the remaining raising sites;
a total time alone cannot show which paid the new cost.

## Guards and retained evidence

**Basis: fail closed, L15 correctness and the repository's fixture contract.**
First pin public malformed-IR endpoints: missing/extra edge operands, bad IDs,
normal-result use on a raise edge and lost/remapped handler identity. Require
named verification failure and complete conservative diagnostic inventory.
Use verified source/control programs for field-held and replaced callbacks,
overrides/interface defaults, bound/returned functions, generated wrappers,
generators and promise reactions, with nested catch/finally/iterator cleanup.
Cover a finally that replaces the exception, a finally that only prints, a
terminal decline, and a real outer landing. Missing handlers keep reached-only
behavior. Include -0/NaN bits, BigInt, undefined and reference identity.

Commit a permanent ASan throwing fixture with its normal-path control: a callee
creates an owned object with a retained child plus an independent live owner,
then throws across an indirect call into a catch that reads the original
payload after the callee returns. Exercise cleanup through intervening frames;
check actual inserted ownership edges and zero remaining RC objects/bytes.
The before measurement must reproduce the failure rather than silently omit a
declined function. Run C/LLVM NoGC+RC and JVM behavior; sanitizer evidence is
native and explicitly tied to the actual instrumented builds.

The old C-EH matrix's claimed 4,752 observations are **not available evidence**.
Rebuild its described transport experiment from a committed generator and
runner: 528 logical cases, clang/GCC/Zig clang, each in NoGC, RC+POISON and
sanitizer-linked RC. Cover cleanup-owned strings through depths 0–32, erased
undefined and special-number bits, strings and BigInt, a finally that throws
only after the original error is taken, and RC live counts/bytes returning to
zero. Retain one LLVM catcher/Itanium personality and verify no C++ runtime
dependency. A new manifest defines the exact 528 cases; it does not pretend to
reconstruct the lost generator. Retain a normal-path control and actual source,
toolchain, options, executable hashes, raw streams and statuses for every arm.

That matrix researches table transport and foreign unwinding (I-2); it does
not select the production exception convention. The decided flag lowering and
a possible future table lowering implement the same graph. Measuring tests
after raising calls remains separate from choosing a new transport. Any
departure from the decided convention requires the user's decision.

Scale ordinary, recursive, reentrant and dense-selector controls under default
budgets; compare charged work with measured instructions/CPU, with actual entry
counts and live analysis bytes. Keep normal-build memory entries at zero.
Finish strict/backend/frontend tests, the five test262 records plus the JVM
reader, TypeScript/outcomes and the dry-run's actual owed set, on the final
composed parent at the readers' own budgets. Generated cases and reports live
in results with committed generation commands; raw evidence is hash-bound and
preserved. No historical execution is relabelled as a current denominator.

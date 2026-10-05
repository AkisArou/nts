# Main compiler delivery

The working process for isolated subagents, serial integration and efficient
validation is documented in [parallel-compiler-workflow.md](parallel-compiler-workflow.md).

Current plan, 2026-10-04. The original baseline was `c132dbf6e`; delivered
changes and their acceptance evidence are recorded below. Main owns this plan
and the compiler work; platform and runtime peers retain their lanes.

## Implemented architecture

The checked tsgo semantic snapshot lowers directly to typed SSA HIR. Preparation
settles representations, specializes and simplifies code, analyzes escape and
ownership, inserts reference counting where selected, and verifies HIR before C,
LLVM or JVM emission. The memory-lowering and debug-lowering crates remain
placeholders. The RFC is historical design material, not an implementation map.

Closures use managed layouts, with typed and uniform erased call entries and a
uniform raising entry. Closed class-union method calls already lower to ordinary
HIR branches. Representation and lifetime choices require evidence; unsupported
operations remain named refusals.

## Delivery order

1. **Exception propagation through specialization (#42), delivered in `188141404`.** Keep a
   function copy's specialization context independent of its exception mode.
   Pair eligible generic and structural function specializations with raising
   forms. Preserve nested-call substitutions and closure capture layouts. Methods
   with their own generic parameters remain a named boundary. Witnesses cover
   numeric, reference and closure arguments, imported calls and repeated captures.
   The structural witness also catches an existing wrong answer: a specialization
   inside `try` can call its ordinary entry and terminate instead of being caught.
2. **Precise in-module TDZ (#33), delivered in `7040cb229`.** Derive early execution from bodies and function
   values available before initialization. Share that proof with existing
   initialization-order decisions. Guard only potentially early accesses,
   including accesses otherwise folded to constants; initialize per binding.
   Preserve existing import-cycle boundaries. Proven-safe accesses gain no check.
   The parked module-wide `wild` design grew runtime modules by about 100 KB and
   is not the implementation to land.
3. **Tagged-template call semantics and identity (#32), delivered in `51bcef99c`.** Reuse argument lowering
   for excess arguments, missing arguments, defaults and rest packing. Intern
   supported immutable template arrays by source site, across specializations.
   Evaluate substitutions once in order. Raw-string access remains explicitly
   refused in this milestone.
4. **Missing destructuring elements, delivered in `c7bcbccb1`.** Carry `undefined` from an absent reference
   element to its default or coercion check. Nested patterns must throw the
   specified `TypeError`, rather than decline on indexing or dereference null.
   Keep lowering and throwing analysis in agreement; close the eight recorded
   destructuring cases left by #24.
5. **Evidence-based erased-value coverage.** Consume whole-program analysis keyed
   by binding and parameter position. Specialize examined parameters from known
   call sites, propagate representations through locals and returns, and infer
   eligible object-literal fields. Extend existing field and branch dispatch for
   finite receiver sets. Exported, escaping and unresolved flows remain
   conservative. Bound specialization and retain named refusals without evidence.
   Ownership optimizations require caller freshness proofs, including for bodies
   entered by the runtime.

## Acceptance and cost

Each rule has one shared derivation. Keep specialization identities independent
of emitted-name formatting, preserve uniform dispatch conventions, and preserve
one layout per type id. JVM `UNRESOLVED`, `SHADOWED` and `UNFILLED` are hard failures;
module-scope tests use `NtsMain` with `-Xverify:all`.

A repaired program must produce the right observable behavior on C, LLVM and JVM,
including counted native execution. New witnesses must expose the old defect and
retain their intended roots. Lower refusal counts alone are not acceptance.
Inspect changed emitted functions, allocation placement, counting operations and
code growth against a pinned control. Measure hot paths when those changes imply
a runtime cost. Avoid broad guards or duplicate semantic machinery.

## Efficient validation and landing

During iteration, run reduced witnesses, relevant unit tests and focused backend
comparisons. Before landing, pin the final patch, frontend and corpus; run recorded
conformance, affected outcomes and blockers, and relevant backend checks. Copy and
representation changes include JVM verification; class/call changes include
interop; lifetime changes include counted execution and emitted-code inspection.

Use `owed.mjs` to track broader obligations. Run a broad sweep at stable
checkpoints: after items 1–3 and after item 4 plus the first behavioral slice of
item 5. Later erasure slices establish their own obligations. Deferred checks
remain pending until discharged. Reuse evidence only for identical inputs; rerun affected checks after
subsequent changes. Bound worker concurrency on the shared machine.

Coordinate shared-file access before landing. Assistant owns repaired blocker
moves, conformance records and post-landing census measurements. Land the exact
tested patch, without unrelated peer changes.

## First milestone evidence, 2026-10-03

The isolated #42 candidate has passed 319 scalar cases on each of C, LLVM, JVM,
C with reference counting and LLVM with reference counting. Its root-coverage
test prevents an old compiler from reporting agreement after dropping the generic
subjects. React's reduced module-scope case answers `6 caught effect` on C and
the verified JVM whole-program launcher.

All five recorded test262 sets reconcile without moved rows; all 116 outcome
fixtures retain their records. The additional field-callee exception fixture in
`3efcac518` reproduces independently; it remains a separate defect. JVM
verification covers all 29 runtime projects
and all 116 outcome fixtures, retaining the three known runtime limitations.
The conformance lane can bank the generic throw below `try` and add a guard for
the supported generic callback case. Its gate-off negative now uses a method
with its own type parameters, preserving that boundary.
Focused interop covers the Java API and consumer, Java bindings, C callbacks and
captured closures. The Java API capture requires the locale used by its record.

Emitted comparison measures all 29 runtime projects: 11 are byte-identical,
17 gain only five or six exception entries (about 10–12 KB), and `url` gains
85 functions as its exception gate becomes usable (about 253 KB). Its promise
jobs now route callback exceptions into rejection. The compiled `url` and
`events` rows have zero real passes on both pins; they provide no positive
coverage. Reduced regression programs and code inspection supply that evidence.
The existing eight-copy numeric budget moves a `Buffer.allocUnsafe` integer
copy to its exception entry. An alternating, single-CPU native measurement of
500,000 allocations per process under NoGc found no slowdown (ten samples per
arm, medians 27.43 ms before and 26.76 ms after); this is a narrow measurement.

Integrated after GTK's schema-42 landing, with the final combined compiler pinned
as `d58b3008f324` (SHA256 prefix `07ce5b3e52b9dd87`). The landed compiler sources
are identical to that pin. Repeated focused checks cover core tests and clippy,
all five scalar configurations, recorded conformance, JVM verification, Java API,
native callbacks, captured closures, integrity and the React module-scope probe.
The broad platform interop sweep and other deferred checks remain owed at the
milestone after items 1–3. Next implementation: precise in-module TDZ (#33).

## Second milestone evidence, 2026-10-03

The TDZ implementation shares one initialization analysis across representation
selection, exception propagation and lowering. Cached body summaries and a
bounded worklist follow calls and function values available at each binding's
initialization frontier. Unknown calls stop exposing values when they return;
repeated calls consider newly created callbacks. Guards belong to access sites,
so a later-only reader remains unguarded even when another reader can be early.
Folded constants retain their exceptions. Patterns publish each element before
the next default runs, with explicit module/local storage selection. Class
definition and construction have separate execution walks. Import cycles retain
their previous boundaries.

Acceptance: 20 relevant core tests and core all-targets clippy; an error-rendering
unit test and CLI all-targets clippy; 667/667 cases on each of C, LLVM, JVM, C+RC
and LLVM+RC. The control crashes on the new witness rather than retaining its
behavioral roots. Across all 423 C examples, 422 records remain unchanged and
the new witness is fixed: zero regressions, changes or unstable comparisons.
Both native and verified JVM startup preserve the folded initializer's
ReferenceError. Verified JVM execution of the repaired outcome reads
`let=ReferenceError;var=none;`, including its cast to `Error`.

All five recorded test262 sets reconcile. Language gains four passes (6,081
recorded passes), with the negative-acceptance count unchanged at 1,353. The
conformance lane's `1c3a3bee3` distinguishes an accepted negative's changed
execution phase from a changed verdict. Outcomes retain 118 records and fix
the let-before-declaration fixture; 244 blockers remain as expected. Integrity
measures 787 valid projects and finds no violation beyond the existing 95 known
entries. JVM verifies 25,073/25,079 runtime classes across all 29 projects, with
only the three known limitations, and 1,676/1,676 classes across all 119 outcomes.
The Java API/consumer, native callback and captured-closure probes pass.

Emitted comparison covers all 29 runtime projects. Eleven change only descriptor
metadata at no byte cost and one is byte-identical. Seventeen lose the unnecessary
`DOMException` constructor exception copy: its static definition is not part of
construction. These removals are the refusal comparison's 17 apparent losses;
no ordinary function is lost, and JVM linkage checks all remaining calls.
Stream constructors gain no helper calls. Most remaining size changes are under
1 KB; `assert` grows 1,363 bytes with four ancestry tests, and `crypto` grows
2,540 bytes with one guarded singleton read in its `subtle` getter. Its added
allocation is confined to the ReferenceError branch. The events flags have only
initializer stores in both ordinary and counted emission. These code checks
establish cost and reach, not new passing Node tests.

Integrated after the ECMAScript runtime addition `4eced6ca0`. The final pin
`7040cb229c45` is byte-identical to the fully validated `e37d2c0a1ddb` compiler
(SHA256 prefix `9509cdb5c11e700e`); the new runtime does not alter the existing
corpus inputs. Broader obligations from `owed.mjs` remain pending at the full
sweep after item 3. Next implementation: tagged-template calls and identity.

## Third milestone and broader checkpoint, 2026-10-03

Tagged templates landed as one coherent change in `51bcef99c`; `77b2457c5`
keeps Builtins' dependency-resource packaging lint-clean. The cooked template
object is immutable, keyed by its original source site, and shared across copies.
Tags and ordinary calls share argument/default/rest lowering. Raw access, invalid
cooked escapes, mutation through aliases and missing cooked reads remain named
boundaries. A checked read remains observable when its result is unused.

The 23-root identity witness compares 667 cases on each of the five backend and
provider configurations. The old template witness and writable-array controls
hold. C and counted-C comparisons cover all 424 examples: 423 unchanged and one
fixed, without regression. The final JVM comparison finds 422 unchanged, one
fixed and one unstable control (the existing iteration-protocol flake), without
regression. An existing counted-C field-initializer abort reproduces on both arms.

The broader checkpoint after items 1–3 is complete. Workspace tests, lint,
recorded conformance, outcomes, integrity, definitions, runtime validity, LLVM
assembly, snapshot caching, all backend example checks, counting and memory,
benchmarks, addons and interop pass. Interop builds and runs 58 projects; four
Windows projects skip because no Windows host is reachable. Those four paths
have no new execution evidence. The interop step alone takes almost an hour;
reuse unchanged inputs instead of repeating the sweep during iteration.

NoGc and counted emission comparisons cover all 29 runtime projects. Most growth
is an 82-byte compile-time assertion. Five modules also gain four unused closure
layout declarations. Crypto changes two literal argument bindings relative to
parameter defaults; helper and allocation counts do not grow. Its compiled axis
has zero real passes on both pins and supplies no positive coverage.

Integration preserves the concurrent Builtins runtime additions and the JVM
peer's updated launcher test. All five recorded sets and all 120 outcomes hold;
JVM verifies 25,093/25,099 runtime classes with the same three known limitations
and 1,678/1,678 outcome classes. The integrated workspace tests pass. The landed
tree equals pin `1e3c7997d491`; its compiler is byte-identical to `d85c63f959bb`
(SHA256 prefix `a3291deffe28ba8f`).

## Fourth milestone and loop correction, 2026-10-03

Missing-reference destructuring landed in `c7bcbccb1`. A nested JavaScript pattern
reads through the existing erased array-element operation, checks for absence,
then reconstructs the present type proved by the source array. One predicate
selects the read and reconstruction. Defaults and the direct generator frame
path retain their lowering. Assistant's `36908c7f7` checks the reconstruction's
array origin and resolved layout identity, including its negative controls.

All eight strict test262 cases and the empty-generator control pass. The witness
compares 145 cases on each of the five configurations. The final C comparison
covers 425 examples: 424 unchanged, one fixed, no regression or unstable result.
The initial prototype emits all 29 runtime programs byte-identically to its
control; that emission comparison precedes the direct-generator correction.

The separate `e46ddae84` repairs writes in while, do and for conditions. Lowering
carries those bindings around repetition and passes their post-condition values
on exit. The new ten-root witness compares 290 cases per configuration. The
bounded wrong-answer outcome now agrees. Across 426 C examples, 425 are unchanged
and one is fixed. Runtime changes are limited to `normalize____win#` in seven
modules, each 184 bytes smaller, in both ordinary and counted emission. The real
compiled path axis retains its 15 passes; there is no measured speed claim.

The combined final pin `37a8d077835f` is byte-identical to the validated
`056cdd7aad9b` compiler (SHA256 prefix `96e2f269dfb7ec03`). All five recorded sets
reconcile; outcomes retain 119 records and report the loop fixture fixed, without
a new refusal. Integrity adds no violation beyond the 95 known entries. Runtime
and outcome JVM verification retain the same counts and limitations as above.
Core/CLI tests and lint pass, as do the updated six whole-program JVM tests.
Twenty focused checks cover templates, tagged calls, destructuring and loop
conditions across all five configurations. Assistant owns independent banking.

## Erasure-analysis foundation, delivered in `9aba5cbb2`

Classifications now retain binding identity, declaration identity and written
parameter position. The immutable collection has one binding index. Every
returned-value consumer and unresolved boundary contributes independently; a
bounded reverse-edge worklist settles their verdicts. The deciding use propagates
to the originating binding through forwarding chains. Ten analysis tests and
core/CLI lint pass. The current status in `docs/any-unknown.md` is corrected.

This foundation does not change lowering or prove a flow closed. Known examined
uses can coexist with unresolved uses, and classifications do not prove storage
consumers, all writers or callable escape. The closed-call implementation below
adds that proof separately. General alias/return/field recovery, finite dispatch and
caller freshness remain later slices.

An isolated-cache compilation comparison used seven alternating warm samples per
arm for crypto, util and stream. Coarse whole-process medians were 0.13→0.11 s,
0.06→0.05 s and 0.06→0.07 s, with similar memory use. This finds no large cost
growth in that analysis revision; it does not isolate analysis cost or measure
runtime speed. The final deciding-origin correction adds one provenance lookup.

## Erased-value implementation slices

The next milestone extends the existing mechanisms in this order:

1. **Make analysis usable by lowering.** Give each erasure site its binding and
   declaration IDs and, for a parameter, its declaration and written position.
   Keep the classification collection immutable and index it once. Reporting and
   planning use these identities; names, source spans and shared `any` type IDs
   cannot identify a value. Delivered in `9aba5cbb2`, including two parameters with the same checker
   type and different uses.
2. **Recover examined parameters at closed direct calls, delivered in
   `9533b3a5e`.** Recover numbers and strings for private,
   nongeneric function declarations. Feed independently proved argument
   representations into existing source-level function copies.
   Keep substitutions positional and separate copy identity from exception mode.
   Propagate the copy's parameter and constant-alias evidence through existing
   nested-call machinery. Captures remain outside this proof. Deduplicate
   equivalent representations and cap new erased-parameter variants at eight per
   declaration, separately from exception mode and established structural copies.
   Preserve the ordinary entry and published callable identity.
3. **Carry evidence through locals and returns.** Extend the same flow result to
   immutable aliases, branch joins and call results. Shared mutable storage needs
   all-writer evidence. Infer eligible object-literal fields from their producers;
   an operation's required type is never evidence of its operand's type.
4. **Dispatch finite receiver sets.** Extend existing field and branch dispatch
   using proved alternatives. Each alternative must have a member and compatible
   call contract. Keep uniform erased/raising slots and one layout per type ID;
   avoid a second callable hierarchy or signature-specific raising slots.
5. **Optimize lifetimes from caller evidence.** Publish freshness and escape
   summaries only after representation recovery is stable. Runtime-entered bodies
   and callbacks require their own caller proof; they cannot inherit a local
   constructor's zero-field assumption.

The erasure report now retains every consumer and the unresolved bit independently
of its strongest verdict. This is necessary evidence, not a closed-flow proof.
Slice 2 must separately prove its accepted call and parameter uses closed;
exported, escaping and unresolved flows remain conservative.

Each behavioral slice needs a failing control, retained roots, all-backend
answers and a measured effect in a real corpus. Mixed parameters, recursive
forwarding, mutable aliases, returned values, external callbacks and copy-budget
exhaustion are refuting cases. Compare changed emitted bodies, allocation and
counting placement, code size and compilation cost. Run focused checks while
iterating; the current checkpoint closes item 4 and the first behavioral slice
of item 5, while the later erasure slices remain separate work.

## Closed-call specialization evidence, 2026-10-04

The implementation in `9533b3a5e` combines erasure classification with an independent
closed-flow proof. Binding and written parameter position identify a candidate;
the shared `any` type ID does not. Calls must resolve directly to private plain
function declarations. Exported or escaping callables remain conservative, as
do mutable aliases, stores, returned parameters, captures, unresolved calls,
defaults, spreads, mixed BigInt/native integer operands and unsupported
exponentiation uses. Checked narrowing retains its ordinary path. An assertion or a consumer's required type supplies no
producer evidence.

Source copies reuse positional structural substitutions and their constant-alias
propagation. Closed forwarding edges settle through a removal worklist, including
recursive components. Exception eligibility belongs to the selected source copy:
it reuses the existing call proof in that representation context and removes
upstream copies when a selected callee cannot carry exceptions. Ordinary and
raising entries share the source specialization. This adds no layout, synthetic
type band, callable hierarchy or signature-specific uniform raising slot.

The witness retains 18 behavioral roots and agrees on 522 cases under each of C,
LLVM, JVM, C with reference counting and LLVM with reference counting. The control
retains five roots and compares 145 cases. The witness covers independent
parameter positions, constant aliases, recursive forwarding, argument effects,
ordinary erased entries, arithmetic, string ordering, `unknown`, and exceptions
through both forwarded calls and primitive methods. Boundary tests check both
compiled and refused copy offers, including budget exhaustion. The final review
found that contextual literal lowering could round a BigInt operand to double
in a recovered context. Such binary uses and their upstream forwarding paths
are excluded; guards cover literals, immutable BigInt aliases and the forwarding
edge. A reduction beyond the exact-double integer range reproduces the private
candidate's wrong answer and becomes an honest refusal after the correction.

The full workspace tests and all-target lint pass. All five recorded test262 sets
reconcile with zero changed, fixed or regressed cases: language 6,109, built-ins
776, annexB 9, staging 46 and harness 12. The 121 outcome fixtures retain their
63 guards and 58 defects. A targeted judged-outcome comparison of 429 erased-value
refusals finds no change. This is a measured boundary: those cases mainly involve
harness `Function` parameters, catch bindings and erased properties. No test262
coverage gain is attributed to this slice. The full 429-example comparisons on
C and JVM each retain 428 unchanged results and fix the new witness, with zero
regressions, changed results or unstable comparisons. All 29 runtime projects
emit byte-identically under both NoGc and reference counting; the runtime refusal
comparison finds no losses. There is no new passing Node-path claim.

Number arithmetic copies emit multiplication and addition directly, without an
erased wrapper or allocation. String arithmetic reuses `ToNumber`; string-to-string
ordering retains lexical comparison. Mixed strict equality preserves existing
mixed erased/reference handling and native integer-width widening. Counted
execution passes the behavioral witness and allocation-floor checks, with no
leaks or changed answers. Runtime JVM verification retains its three known
limitations and adds no linkage or raising-slot failure; all 1,680 outcome classes
verify. The nine ordinary erased-entry refusal roots in the new example are
recorded alongside it; all 18 exported roots still run. Compilation probes use
separate warm snapshot caches and alternating arms; the small sample ran alongside correctness
checks, so it establishes neither a speedup nor precise analysis overhead.
The new-copy cap and the single program-wide classification bound the work.

The broad checkpoint is complete. Workspace tests and lint, recorded
conformance, outcomes, integrity, runtime definitions and validity, LLVM assembly,
snapshot caching, backend examples, counting and memory, benchmark builds, DEX,
addons and interop meet their gates. Interop builds and runs 58 projects; four
Windows projects cross-build and skip execution because no Windows host is
reachable. The Java API capture needs its original `en_US.UTF-8` sorting locale;
its initial ordering-only failure reproduces on the control, and the final
capture and verified Java consumer pass in that locale.

After the BigInt boundary correction, exact prepared HIR and diagnostic outputs
match the tested checkpoint on all 904 example, runtime, interop, outcome and
blocker configurations, including their existing refusals and type errors.
Final-pin C code and headers also match on all 29 runtime projects. Those
comparisons support reuse of unchanged checkpoint evidence. Workspace tests and
lint, all five witness configurations, recorded sets, outcomes, blockers, example
refusal accounting, benchmark builds and the memory suite were rerun on the
final source or pin. The landed compiler is pin `9533b3a5e62e`, SHA256
`9b707d7e81e2a94bc6afe2514f4bff0152bd92353fc3c501286cd79982702512`.
No Android device was present, so the DEX gate adds no ART execution evidence.

The remaining locals/returns, object-field, finite-dispatch and caller-freshness
slices are future work. Main stops here for the user's requested parallel
compiler planning discussion before starting a different task.

# Main compiler delivery

Current plan, 2026-10-03. Baseline: `c132dbf6e`. Main owns this plan and the
compiler work; platform and runtime peers retain their lanes.

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
3. **Tagged-template call semantics and identity (#32).** Reuse argument lowering
   for excess arguments, missing arguments, defaults and rest packing. Intern
   supported immutable template arrays by source site, across specializations.
   Evaluate substitutions once in order. Raw-string access remains explicitly
   refused in this milestone.
4. **Missing destructuring elements.** Carry `undefined` from an absent reference
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

Use `owed.mjs` to track broader obligations. Run one full sweep on a stable pin
after items 1–3 and another after items 4–5. Deferred checks remain pending until
discharged. Reuse evidence only for identical inputs; rerun affected checks after
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

# Integral ranges and exact arithmetic regions

Design note for the shared core producer, its FASTA and spectral-norm consumers,
and bounded loop versioning. Implementation starts only after the
parameter-arrival correction has actually landed. The compiler lane reviews each
implementation commit.

## Evidence and decision

The authoritative measurements are the tool-written
[arithmetic attribution](../../../results/integral-arithmetic-attribution.json),
recorded by `tooling/jvm/investigations/record-integral-arithmetic.py` in
`e0bfdcef9`. Its raw directory, artifact identities, per-bracket counts, identity
controls, arithmetic controls and code sizes are in that record. The experiment
changed emitted artifacts; it did not change compiler production code. Its
three A/B/A brackets per comparator establish that artifact's effect, not a
confidence interval across code layouts.

The general integer product improves both native backends and the JVM. Carrying
an exact dyadic scale through the denominator removes more work on all three.
The whole-integer denominator has similar latency, but requires an evenness
proof and executes more instructions on two backends. The scaled denominator
needs no such special case. FASTA's measured integer-region gain is distinct
from `fmod`'s larger share of baseline profile samples.

Build one numeric fact producer and a consumer of its certificates in core.
Use the existing flow and closed-contents authorities. Extend neither an emitter
nor a benchmark-name recognizer with this optimization. This follows the
[one numeric engine](scalar-numbers.md) design.

## Existing authorities and the implementation seam

- `facts::Facts` owns numeric bounds, wholeness, NaN and negative zero.
- `flow::Analysis` owns facts at values and guarded program points. Its
  interprocedural context owns actual arrivals, returns and storage facts.
- `loops::accumulator_caps` supplies counter and accumulation bounds using the
  existing predecessor, dominance, loop-shape and back-edge reasoning.
- `globals`, `fields` and `elements` supply their existing complete-writer
  authorities. `contents::FunctionFacts` owns closure of container identities
  and writers, including wider aliases; `ValueFact::numeric()` requires every
  alternative to be numeric, preserving absence and unknown writers.
- `exact.rs` marks final integer operations that cannot overflow their final
  machine types. That late mark is not a proof that an earlier floating-point
  expression may be reassociated.

The producer extends these facts and queries. It does not perform another
arrival, alias, writer or range walk. In particular, migrate the existing
`accumulators` consumer away from candidate-only ordinary scalar inference in
`contents::FunctionFacts::for_arithmetic`. Ordinary scalar facts come from
`flow`; container closure continues to come from `contents`. A numeric bridge
must consume that existing closure and the same scalar transfer functions,
without recursively launching flow from the contents provider or treating a
partial inspection trace as an authoritative writer set. The concrete bridge
API is reviewed before integration; runtime retains ownership of container
closure and cleanup elision.

The initial producer commit exposes checked integral queries without changing
representations. The conceptual API is a projection of an existing analysis at
`(block, value)`, returning an ingress certificate or an explicit reason such
as unknown ingress, nonnumeric alternative, nonintegral value, nonfinite value,
observable negative zero, unbounded range, unconverged analysis or budget.
Names are provisional; these are separate answers, not another fact lattice.

A certificate belongs to the exact function and immutable analysis revision.
No fact from a graph before a rewrite can be looked up against the graph after
it. Query failure never reruns an unbounded analysis. Unknown is not bottom;
a missing writer or predecessor cannot become an empty successful union.

## Two independent proofs

### Actual numeric ingress and bounds

Every arriving value must be numeric and integral on every applicable entry,
with finite inclusive bounds. An exported root, callback, virtual/foreign entry,
closure supplier, mutable property or escaped container cannot acquire a range
from its written literal type or one observed caller. The parameter-arrival
correction defines this boundary; this work builds on its actual landing.

A real dominating guard may refine stable SSA values. Loop bounds come from
actual induction, entry values, steps and trip counts, including the zero-trip
case and all back edges. A counter's body fact is not its exit fact. An array
length used as a trip count must be the stable length actually controlling the
loop. A later length read, getter invocation or captured write cannot inherit
that stability by having the same source spelling.

For stored values, the complete existing writer authority must license the
numeric fact. A container containing number-or-undefined is not numeric. An
unknown wider-alias write revokes the claim. FASTA's private state also needs
all initializers, resets and updates, not just the arithmetic at one read.

### Original prefix and selected machine prefix

For each admitted region, retain a certificate for every original operation,
its operands, order and numeric domain. Separately prove that every proposed
machine operation fits its selected width. Compiler-side interval arithmetic
uses checked integer bounds; a rounded `f64` endpoint is not an exact `i64`
product bound.

An exact integer ingress can still feed an inexact floating product. The
consumer either stops there, placing the integer-to-double conversion at the
same rounding boundary, or proves the whole prefix exact before carrying an
integer or dyadic representation further. A small final result proves neither
of these. For example, a product outside signed `i64` cannot be justified by a
later division that brings it back into range.

The certificate carries a dyadic representation `k * 2^(-q)`, an interval for
`k`, its scale, selected width and exactness obligations. It also retains zero
sign and finite/overflow/underflow obligations. Addition aligns scales only
when checked shifts fit and both the original and replacement prefixes are
exact. A join keeps a certificate only when every live incoming certificate
has a compatible scale and safely representable union. Otherwise that region
remains floating point. This is a bounded expression plan over established
facts, not a new dataflow or alias analysis.

No reassociation crosses an effect, a call, a visible materialization or an
unproved rounding boundary. Multiple uses keep their original values unless
each rewritten use has its own valid plan. Ordinary JavaScript remainder keeps
its dividend's zero sign; integer remainder is licensed only when that
observable distinction is excluded or separately preserved. NaN, infinities,
subnormals, overflow and underflow remain explicit proof obligations, never
implicit consequences of an integral-looking source expression.

The plan is applied transactionally while ownership and exception edges are
still available, before reference counting and final machine exactness marks.
Operand/type reconciliation, fresh flow facts and final `exact.rs` checks run
on the changed graph. A later mutation that changes an operand, type,
dominance, writer set or relevant edge invalidates/recomputes the certificate;
it cannot merely retain an earlier rounding claim.

## The two consumers

### FASTA affine update and remainder

The measured recurrence is:

```text
next = (seed * 3877 + 29573) % 139968
```

Its closed initial/reset/update writer set establishes integral state in
`[0, 139968)`. The region proves multiplication and addition exact, the modulus
positive, the dividend nonnegative, and the remainder in the same state range.
Then integer evaluation agrees with the original floating operations. The
selected arithmetic width comes from the proved intermediate ranges; do not
keep the experiment's `i64` merely because it was convenient for attribution.
Storage and external numeric uses follow the same facts and reconciliation.

The exhaustive transition/output control in the evidence covers every state,
including zero, the initial state and the upper endpoint. Separate negative
controls introduce an unproved writer, fractional state, missing alternative,
negative zero and nonfinite arrivals. Removing the integer consumer must fail
an emitted-operation guard while preserving the original numeric answers.

The existing proved-int32 accumulator rewrite becomes another consumer of this
shared producer. Its terminal ToInt32 may discard zero sign; the untruncated
original value and other uses do not inherit that permission. Container
content facts and inert cleanup elision remain runtime's work.

### Spectral-norm exact dyadic denominator

Let `s = i + j` and `p = s * (s + 1)`. The conservative measured fast domain is
nonnegative induction indices below an actual trip count at most `2^25`.
Every original prefix below is exact there:

```text
1.0 / (double(p) / 2.0 + double(i) + 1.0)
2.0 / double(p + 2*i + 2)
```

The second line is the chosen representation. It carries the division's scale
through the exact additions and performs one conversion at the reciprocal.
Scaling numerator and denominator by a power of two preserves the rounded
quotient under the certificate's finite/exact-prefix obligations. Integer
truncating `p/2` would need an extra evenness proof. The odd-product controls
show why bounds alone do not license truncation, and why the scaled consumer
is the more general mechanism.

The looser measured `2^26` guard supports the general integer product followed
by floating `/2`, `+i`, `+1`: even if the product is outside the safe-integer
interval, its one rounding can be matched at conversion. That is a distinct
rounding-boundary certificate. Neither constant is a production input fact or
a global domain restriction. A production guard is derived from its region's
proved bounds and selected width, rather than recognized from this benchmark.

The unsigned-half experiment is only a comparator. Over the full signed-i32
sum domain the product fits unsigned `i64` but not signed `i64`; the later half
fits signed `i64`. Its proof is for the complete denominator and result, not
for the half-expression's signed zero. Keep both i32 extremes and the
`(-1, 0)` / `(0, -1)` controls. It is not the production transform.

## Loop versioning

Use the existing loop-shape/dominance information once per immutable function.
If a static certificate is insufficient, synthesize one preheader predicate
over stable controlling SSA values or real trip counts. The predicate must
imply every required ingress/range/finite/zero-sign obligation for the fast
region. It cannot narrow a mutable source name or assume the benchmark seed.

The true edge enters a cloned fast loop with facts derived from that actual
predicate. The false edge enters the original floating loop unchanged. Preserve
entry/exit block arguments, zero trips, breaks, returns and all normal/error
continuations. Do not rerun a getter, allocate, convert a nonnumeric input or
move an effect to construct the predicate. Unsupported loop forms or implicit
exception continuations yield no version; they do not acquire an optimistic
normal-only CFG. Recompute ownership/counting for the resulting full graph.

One versioning decision covers the complete nested region it clones. Do not
recursively version the clone or independently multiply nested alternatives.
Versioning is optional optimization: exceeding a work or growth limit leaves
the original program and records the reason.

## Initial work and growth bounds

These are proposed initial limits, reviewed and calibrated with the producer
commit. They limit new optimization work, not what source programs compile.
Existing flow/interprocedural convergence and loop caps remain authoritative;
exhaustion cannot publish facts from an unfinished iteration.

- Reuse the current accumulator/contents prechecks of 4096 values and 256
  blocks for a function entering the new certificate planner. Larger functions
  keep their existing flow analysis and get no new region rewrite.
- One cumulative per-function budget for new certificate, region and version
  work: at most `min(65536, 32 * (values + blocks + operand/edge entries + 1))`
  charged units. Charge every actual traversal, set/vector entry copied,
  comparison and queued edge before visiting or allocating it. Saturating
  arithmetic and a failed charge return `Unknown(Budget)` transactionally.
- At most 64 original operations and an absolute dyadic scale of 32 in one
  region. Use an iterative, memoized dependency walk; cycles and incompatible
  joins reject that region. Unsupported exactness domains retain floating code.
- At most one additional version of an original function's selected loop
  region, never a version of a version. Copy at most 256 live HIR operations
  per function. There is no program-wide count of admitted loop regions.
- The program-wide added-operation budget, including predicates, conversions,
  block-argument transport and copies, is at most
  `max(256, original live operations / 20)`. The small-program allowance admits
  the measured two-loop program; the proportional bound controls large builds.
  All limits count from the original graph, before any rewrite. If the growth
  budget binds, consider candidates deterministically: innermost loop first,
  then source order (with original function/block/value identity as a stable
  tie-break for generated sites). Report every skipped region and its reason
  in the census; do not silently admit whichever functions a hash map visits.
- Candidate discovery and no-candidate handling share existing analysis work;
  no extra whole-program fixpoint runs just to discover that nothing applies.
  Any necessary refresh uses the existing flow driver, not a second solver.

Report admitted regions, rejection reasons, actual work charged, budget
exhaustions, guards and added operations. The compile-time census must explain
what these limits reject; a Budget result is not reported as a semantic failure
or a successful proof. Limits are checked-in policy, not environment overrides.

## Delivery and acceptance

1. Publish this note and evidence. Wait for the parameter-arrival fix's actual
   fast-forward, then freeze the implementation base.
2. Extend the shared producer with ingress/range queries and fail-closed
   controls. Preserve the existing scalar/type distinction and migrate the
   accumulator's ordinary numeric query to the same authority. Establish
   Unknown-on-budget/nonconvergence and exact-subject invalidation controls
   before a consumer changes emitted arithmetic.
3. Add the FASTA affine/multiply/remainder consumer and its operation-survival,
   writer-closure, exhaustive-state, negative and old-compiler controls.
4. Add the dyadic consumer and bounded loop versioning, with both predicate
   outcomes executed, boundary/odd-product/signed-zero/alias/error controls and
   growth/work-exhaustion mutations that leave the original body intact.

Each implementation commit goes to the compiler lane. Run the touched core,
backend and both frontend matrix, five recorded test262 checks, runtime/JVM
verification and LLVM assembly commands required by the changed paths. Run
`land --dry-run` and report the real owed set before requesting landing.

Each consumer ships its own `clbg-fasta` or `clbg-spectral-norm` benchmark record
on C, LLVM and JVM, with the other reference columns retained. Keep all losses,
refusals, capped warmups and unavailable measurements visible. No function-body
edit to manufacture a smaller workload is part of this optimization.

Measure both NoGC and RC compile-time arms and JVM emission cost on the frozen
before/after binaries. Record guard and clone size/cost beside the wins, and
include no-candidate programs. Use the shared layout-interval instrument where
the apparent effect is comparable to placement variation. Keep measurements in
`results/`, written by the tool, with the raw run and identities retained.

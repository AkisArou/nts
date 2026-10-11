# Captured var typeof uses assignment readiness

A function-scoped `var` starts as `undefined`, even when its later
initializer makes TypeScript infer `number`. Folding `typeof` from that
inferred type can silently answer `"number"` before the assignment.
Record 0353 made captured lexical reads throw, but a `var` has no lexical
dead zone and must use a different rule.

`initialization::Analysis` distinguishes captured symbols whose declarations
are all `var`. A merged parameter or function declaration does not qualify.
A bare captured `typeof` operand, including parentheses, reads the existing
cell's readiness field: false selects `"undefined"`; true selects the kind
that ordinary lowering already proves from the checker. It never reads the
unwritten payload. The selection uses ordinary HIR branches and string
values, with no backend or runtime helper and no change to the result ABI.
Cases without a statically known initialized kind retain their existing
lowering and refusal behavior.

Readiness means **assigned**, rather than **declaration statement visited**.
Every write to a guarded pure-var cell sets it. In particular,
`x = n; var x;` retains both the value and readiness; a declaration without
an initializer does not reset them. The private-reader proof still omits
readiness storage for readers proven to run after their initializer.

Every other not-ready pure-var read remains a named unsupported-transport
stop. Its text explains JavaScript's value rather than claiming a lexical
error:

> `x` (var) was read before its assignment; JS gives undefined here, which
> this compiler cannot carry where `x`'s type is number

Absence comparisons already stop on the control pin; this change retains
those stops. The separately probed reader declared after `var` already
produces a named `NTS1003` refusal, so it needs no hoisting change here.

## Reach and boundary

A temporary source inspector examines the compiler's guarded captures,
restricts them to symbols whose declarations are all `var`, and counts
read nodes inside accepted capturing functions before HIR folding can hide
them. Sites are deduplicated by source node and symbol. These are potential
guarded reads, not observed executions before assignment; private-reader
readiness is reported separately.

| Corpus | Configs inspected | Potential guarded reads |
| --- | ---: | ---: |
| Node runtime and web-platform | 29 | 0 |
| Examples on the control, before fixture promotion | 517 | 0 |
| React GTK counter whole program | 1 | 0 |
| Recovered TypeScript npm packages | 25 | 0 |
| test262 language, partial scan | 10,473 | 2 |

The npm scan reads the existing recovered TypeScript projects in
`tooling/npm-survey/vendored`; it does not claim coverage of the 458
unrecovered tarballs or a separate corpus of transpiled ES5 files. The
test262 scan stops after the above partial result. Its two sites are
`identifier-resolution/S10.2.2_A1_T3.js` and `S10.2.2_A1_T4.js`; the latter
is proven late by the private-reader analysis. A known early-read outcome
and an extended local probe confirm the inspector can detect this pattern.

Full undefined transport remains deferred and is not queued without a
real-code witness. If needed later, the source fact would seed an
undefined-capable representation and propagate it through aliases,
returns, calls and callable faces before fixing storage and ABI together.
Only after every consumer can carry the entry value may its value-read
guard disappear. Adding an erased cell alone, or dropping a scalar guard,
would expose a wrong value or an incompatible call boundary. Local
`typeof` needs none of that propagation because its answer is a string.

## Evidence

The control is the landed `9d75f9e89ed8` pin, SHA-256
`389cef487814ca6cc5e95b8d4e72663c7ef64696949566b89da3581f7a90bf4f`.
The final source pin is `9eb02222a94a`, SHA-256
`9dcae4df007c2489af18a602c3e58cf16bc2b38939eb00e2ca67afab5a2604a7`.
The frontend remains the one recorded in 0353.

The fourteen-function focused fixture agrees with node on all 300 cases
on C, LLVM, JVM and reference-counted C. It covers both readiness states,
assignment before a declaration without an initializer, parentheses,
callbacks, repeated invocations, boolean and managed string payloads,
conditional typeof, and a merged-parameter control. The focused prepared-HIR
test verifies that typeof does not load an unwritten payload and a bare var
declaration does not reset assignment readiness. All 551 core tests pass;
strict workspace Clippy passes, followed by strict core Clippy after the
final eligibility-query refinement.

C and LLVM compare all 516 examples against the initial implementation pin
`cdc48e7d4592`: 515 unchanged, one fixed, zero regressed, changed, unstable or
unmeasured results. That pin differs from the final compiler only in the
ordering of a pure type lookup and eligibility checks. The final pin checks
eligibility first to avoid an extra query on ordinary typeof expressions.
Reference-counted C and JVM repeat the same full comparison on the final
pin. An initial JVM run reports one unstable example because the control
disagrees with its own rerun; the quieter final run has no unstable result.
The fixed outcome becomes a before/after example with an assignment control.
The existing early value-read outcome is re-recorded solely for its truthful
stop text: it remains an abort. All 139 remaining outcomes reconcile
(67 holds, 72 reproduce); all 323 blockers behave as expected. Both relevant
test262 witnesses reconcile: T3 still stops, and the proven-late T4 passes.
The full test262 source scan and full undefined propagation are not run.

All 62 benchmark C sources, translated LTO objects and linked binaries are
byte-identical to the control on the final source pin; no paired timing run
is needed. Prepared runtime HIR retains 51,680 definitions and 2,872 raising
entries, with 36,266 unchanged refusal occurrences and zero new or removed
sites. On the final pin, every one of the 29 runtime modules has byte-identical
prepared HIR, C products and O2 objects. Native tables remain 62,592 bytes,
and aggregate O2 object size remains 11,703,001 bytes. This local source fact
introduces no runtime raising growth or changed lowering refusals. JVM
verification remains 25,166 of 25,172 classes across all 29 modules, with
six existing missing-class explanations and every dispatch decline
classified. Final strict workspace Clippy and formatting checks pass.
The full gate remains required before this change lands.

# Captured lexical reads throw through the shared raising path

After record 0352 made frame initialization deterministic, a captured
lexical read before its declaration still stopped the process. JavaScript
throws a catchable `ReferenceError`. Local class reads could bypass even
that stop because the constructor was resolved statically, and `typeof`
could fold away the read.

`initialization::Analysis` now owns captured lexical readiness and source
effects, alongside module readiness. These facts are established before
throwing analysis and raising-copy selection, and folding consults the same
effects. A lexical cell read loads readiness and uses the existing HIR
`refuse_when` -> provided `ReferenceError` -> `throw_erased` path. Module,
lexical-cell and class checks share the exact message construction:
`Cannot access 'x' before initialization`. No backend throw helper is added.

A source-use index built once before capture collection proves readiness
only for private readers whose every use is a direct call in the declaring
invocation, after an unconditional declaration. The proof is permission to
omit a check. Escapes, indirect calls and conditional declarations retain
their check. Proven-ready value cells lose their readiness field as well
as its loads and stores.

A statically resolved local class captures a readiness cell rather than a
constructor value. The cell is allocated at the declaring function's entry,
captured using ordinary managed-field ownership, and marked ready only
after class evaluation succeeds. Keeping this storage separate from value
bindings preserves existing constructor resolution. A hoisted reader can
carry the cell even when its source declaration follows the class. A
proven-late class reader needs no cell at all. A class in a re-entered scope
is refused by name until lowering can allocate fresh storage per entry;
the scope check includes Promise executors lowered inline inside loops.

The same work exposed a separate dispatch defect on main: a nested function
declaration with captures was lowered as a closure but classified as a
direct callee during raising analysis. An ordinary explicit throw could
therefore escape its caller's handler. The closure table now classifies
these calls during both analysis and lowering. This fix is a separate
commit, with an outcome recorded against main and a parameter-only control.
Of its 58 baseline cases, six capturing cases disagreed; the control agreed.

## Evidence

The control pin is `20d0c4ea9d61`, SHA-256
`e0fd00828a8bb191a0de630265327e7a0ff8f9608f81ff37afee2fb9a8816788`.
The source pin is `aa3df5fe0b28`, SHA-256
`389cef487814ca6cc5e95b8d4e72663c7ef64696949566b89da3581f7a90bf4f`.
The frontend is unchanged from record 0351.

The five-function TDZ probe agrees with node on all 145 cases on C, LLVM,
JVM and reference-counted C. An extended twelve-function fixture agrees
on all 348 cases on each lane, including an escaped class reader, repeated
invocations, a hoisted reader after the class, `typeof`, static member
reads, and controls with no readiness storage. Its five class readiness
identities share one physical bool-only layout; the proven-late class
control has no cell. The re-entered-block witness disagreed on all 29
baseline cases and now gives the expected fresh-storage refusal.

All four differential lanes report 512 unchanged examples, three fixed,
zero regressions, and no changed, unstable or unmeasured results. The three
fixed outcomes move to examples; the re-entry outcome moves to blockers.
All 323 blockers behave as expected, and the remaining 139 outcome records
reconcile: 67 holds and 72 reproductions.

Direct source-fact measurements cover all 29 runtime modules. Both the
global `closures_carry` decision and the exact `what_holds_the_gate_off`
holder remain unchanged in each module, as do the raising-symbol and
selected raising-copy sets. No runtime module requires a class readiness
cell. Prepared HIR retains 51,680 definitions and 2,872 raising entries.
All 36,266 normalized refusal-site occurrences are unchanged, with zero
new or removed sites, and the 29-module function-state comparison has no
moves. All 62 benchmark C sources, translated objects and linked binaries
are byte-identical to the control, so paired timings are unnecessary.
All 29 runtime modules emit valid C and compile at O2. Native tables remain
62,592 bytes and aggregate O2 object size remains 11,703,001 bytes. Twenty-eight
runtime C texts and objects are byte-identical; `fs` replaces the existing
`onError` cell's named stop with the ordinary ReferenceError path, retaining
the same object size. Its reader escapes through an event listener, so the
private direct-call proof does not remove its existing readiness check.
The JVM verifier checks 25,172 classes across all 29 modules: 25,166 verify
and six retain their existing missing-class explanations. Every dispatch
decline is classified.

All 550 core tests pass. Focused IR tests verify closure raising-entry
selection, retained TDZ handler edges, and omitted readiness storage for
proven-late readers. Strict workspace Clippy and formatting checks pass.
The existing 8,317 recorded test262 language cases reconcile unchanged,
including all 6,627 previous passes. A full language run
attempts 22,127 cases and adds exactly one pass, the formerly unrecorded
captured-const TDZ witness. The record now contains 8,318 cases: 6,628 passes
and 1,690 unchanged failures. The pass floor rises to 6,628; the accepted
negative ceiling stays 1,353. The forward-var witness still stops by name.

## Boundary

Forward `var` reads still use their named stop. Removing it while a scalar
cell cannot hold `undefined` would give a deterministic wrong scalar. That
representation and the value-read guard must change together.
[Record 0354](0354-captured-var-typeof-uses-assignment-readiness.md) handles
bare typeof observations locally and defers broader undefined transport
until a real-code witness justifies it.
Fresh lexical storage for re-entered blocks remains a separate gap.

# WebAssembly backend: design and bring-up plan

Status: M0 approved by MainClaude, 2026-10-12 (Athens; initial probes recorded
on 2026-10-11 UTC). Additional exception evidence is recorded below.
M0 scanned revision: `e52ddc97e160` on `wasm/m0`. M1a scalar bring-up landed
as `2a4e53739bf2`, with the execution evidence below. The shared HostGc provider
landed as `786f23a48f11` after MainClaude approved the scoped core overlap
and the independent JVM review. The full green gate ran on source-identical
`e9fab5a2730c`; the reviewer accepted the rebase that preserved two unrelated
notes lines. Its core hunks are limited to the provider enum and native
placement/provision selection. The Wasm driver selects HostGc. M1b is at static
implementation following review of the scan amendment below. Managed type
planning is the first step; no M1b corpus or new performance result is claimed.

## Current M1a implementation and evidence

`compiler/codegen/wasm` emits a core module directly from prepared HIR. It
predeclares callable signatures and imports, assigns typed locals, emits every
reachable body, records instruction Origins, and validates the completed bytes
before returning an `Emitted`. Unsupported scalar representations, operations,
external helpers and public shapes return a named `NTS5001`; malformed HIR and
generated-byte validation errors remain distinct integrity failures. No declined
program returns partial bytes. The CLI also stops on preparation errors before
creating its output directory.

The current module has numeric storage, bools, direct calls and recursion,
numeric globals and module initialization. It supports f32/f64 and signed or
unsigned 8/16/32/64-bit integer slots. Integer storage conversions consume HIR's
range and zero-sign proofs; they do not implement JavaScript's coercions.
`ToInt32`/`ToUint32` have a separate total wasm algorithm using IEEE exponent and
significand bits. `Math.round` uses floor plus a fractional comparison and keeps
negative zero. Floating remainder imports the host's exact `%` implementation;
it is the only host import in the comprehensive scalar fixture. Integral
division/remainder use signed or unsigned wasm instructions under the same
prepared numeric proof contract as C and LLVM; ordinary JS division and
possibly NaN/observable-negative-zero remainders retain floating storage. Managed
types, strings, arrays, classes, closures, exception/runtime helpers and native
ABIs remain outside this slice. The inventory below describes **planned M1**,
not current M1a support.

Reducible functions use Ramsey's dominator-tree translation. Merge children are
placed in RPO order after nested block labels; nonmerge successors are inlined
at their original branch position, and loop headers bind enclosing loop labels.
Each edge performs the common parallel copies before transfer. A backward edge
whose target does not dominate its source certifies irreducibility; only that
route emits a PC local, loop and `br_table`. The emitter checks block and edge
coverage, duplicate emission and lexical scope. A structuring failure is a named
internal compiler error, never a source decline or a route change.

`Program.public_api` determines publication, including aliases and live global
getters. `Func.exported` determines reachability and `Global.exported` marks
settled exports; neither substitutes for the publication contract. The Node
loader checks import/export names and kinds before module initialization,
checks arity and logical scalar types, and enforces the parameter facts used by
specialization. It refuses non-fitting numeric inputs by name, including `-0`
at integer boundaries and nonexact f32 inputs. The 64-bit numeric boundary uses
BigInt as wasm's physical carrier but accepts/returns only safe JS numbers;
unsupported BigInt language values do not enter through that path. Public
optional/default/rest parameter shapes decline, while compiled private calls
may use the defaults already evaluated by lowering.

Publication tables carry names without Origins. An unsupported public surface
therefore has an explicitly named `UnsupportedSurface` refusal, rather than a
fabricated location. Operation/type refusals retain their HIR source Origins.
The CLI writes `program.origins.json` beside the production artifacts, with
function indices, offsets inside function payloads, Origins and normalized
source URIs/digests/rewrite metadata. It includes no source text or diagnostic
display paths. Debug names are included in the module sizes below.

Run the experimental command and inspect its output:

```sh
cargo run -p nts-cli -- emit-wasm tooling/wasm/fixtures/scalars --no-acquire --out /tmp/nts-wasm
node tooling/wasm/inspect.mjs /tmp/nts-wasm
node tooling/wasm/check-scalars.mjs /tmp/nts-wasm tooling/wasm/fixtures/scalars/src/main.ts
```

The loader exports `instantiate(bytes, manifest)` and `load(moduleUrl,
manifestUrl)`; `load` defaults to the sibling `program.json`. Loading evaluates
the module initializer once and returns a frozen namespace with live getters.
Use `NTS_TSGO` to select the repository's pinned frontend for compilation/tests.

`Backend::Wasm` is recognized explicitly. `Backend::ALL` is still exactly
`[C, Llvm, Jvm]`, with a regression assertion; existing gate loops are unchanged.
`NTS_BACKEND=wasm nts check` refuses by name until the M1 runner is implemented.
It cannot enter the existing native runner and report C's answers as wasm.
`emit-wasm --rc` refuses by name through the shared managed-provider planner
(`NTS2001`). Preparation selects `HostGc`; surviving counting operations are
source diagnostics at the emitter boundary. Unsupported language shapes use
`NTS5001`.

Execution evidence on Node 24.20.0, using the landed HostGc core:

| Population | Result |
| --- | --- |
| Same-source scalar TS fixture | 165,016 exact `Object.is` comparisons, including full-exponent IEEE bit-pattern sampling, NaN, infinities, signed zero, rounding ties, shifts, arithmetic/comparison, labelled loops, recursion and live globals; 42 functions, all structured |
| Arbitrary CFGs | 600 graphs checked against an independent T1/T2 reducibility oracle: 256 structured, 344 dispatcher; 48,000 exact execution comparisons with bounded fuel and side-effect traces; every generated module validates |
| Saved full `triangle__resume` CFG and cyclic phi swap | 20,514 exact comparisons; all 16 original generator graph blocks and 18 edges; 4,835 cyclic paths, maximum 39 visits; generator graph dispatches, phi swap is structured |
| Typed numeric HIR fixture | 188 exact cases for unsigned widening/comparison/min/max, i32-min absolute value, negation retaining `-0`, safe i64 carriers, proven signed/unsigned integer div/rem and float-to-integer storage; no imports |
| Public boundary fixture | 164 checks including void/undefined, scalar widths, aliases, declared facts, explicit infinite bounds, wrong arity, unsafe 64-bit results and five malformed manifests |
| Existing `examples/loops` and `examples/bitwise` | 102 and 136 bounded scalar comparisons respectively; zero input declines, no dispatch, no imports; loops includes three nested labels and a break through `finally` |
| Structurer integrity | A corrupted enclosing-loop scope plan produces a named internal compiler error; no source decline or dispatcher fallback |
| Integrity/refusal tests | Seven tests distinguish named helper/optional/public-shape/provider declines from unresolved direct callees, invalid mixed bool/number equality HIR, invalid stack typing and unapproved GC features |
| All discovered examples | 518 projects accounted for: 40 emitted, validated/linked and bounded-agree; 478 named project declines (including one intentional frontend TS2322 fixture); 2,061 compared cases and 18 named input declines; 0 observed wrong answers, integrity failures, unmeasured projects or timeouts |
| Actual `emit-wasm` CLI | Executes the same scalar source population; writes source Origins; required `--out`, named `--rc` and `nts_math_cos` refusals precede output mutation; existing check runner refuses wasm |
| Existing C / LLVM / JVM / RC check runners | Each agrees with Node on all 232 `examples/bitwise` cases; this is a selection smoke check, not the full regression gate |

The saved generator fixture preserves the complete original CFG but substitutes
scalar operations for frame access. It establishes structuring and branch-copy
correctness; it does not establish generator runtime support. The ordinary
example smoke and all-project census use bounded populations and are not the
repository's full hostile-pool `agree` instrument. The census sweeps numeric/bool
arguments and checks live scalar globals; its 478 named declines and 18 input
declines are reported separately from agreement. Follow-up runs resolved the
`.js` entry, multi-source publication and local config-package resolution gaps;
all 518 discovered projects are accounted for in the refreshed
`m1a-ramsey-corpus/report.json`. Every emitted module records each function
with its route and reachable block/edge counts; the retained fixture manifests
and census route inventory expose those records for review.

Deterministic artifact inventory (`inspect.mjs`, gzip level 9; independently
compressed files summed, no startup/throughput claim):

| Artifact | Wasm raw / gzip | Manifest raw / gzip | Loader raw / gzip | Production total raw / gzip |
| --- | --- | --- | --- | --- |
| Scalar fixture | 3,818 / 1,842 B | 17,195 / 803 B | 4,993 / 1,760 B | 26,006 / 4,405 B |
| `examples/loops` | 3,718 / 1,332 B | 3,095 / 391 B | 4,993 / 1,760 B | 11,806 / 3,483 B |
| `examples/bitwise` | 1,484 / 791 B | 3,195 / 364 B | 4,993 / 1,760 B | 9,672 / 2,915 B |

The scalar total, including the loader and manifest, is below the provisional
32 KiB raw smoke budget. The optional Origins sidecar is 88,113 raw / 2,663 gzip bytes;
the loader does not read it. No unused helper family is emitted in these modules.

The workspace-wide `Backend` audit finds two affected exhaustive matches:
`Backend::name` handles `Self::Wasm` as `"wasm"`; differential `check` refuses
`Backend::Wasm` explicitly before preparation or runner selection. The private
native renderer is reached only after that guard. Neither match has a wildcard.
`ALL` remains C/LLVM/JVM and `RECOGNIZED` adds Wasm, checked by the common test.
The lockfile was regenerated through Cargo and the baseline resolutions
retained: no existing crate version moved. Added packages are the Wasm crate,
wasm-encoder/wasmparser, bitflags and leb128fmt.

Dependencies are exactly pinned to wasm-encoder/wasmparser 0.261.0. Their
published Cargo manifests declare Rust 1.88.0 and
`Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`, compatible with this
workspace's Rust 1.97/Apache-2.0 policy. Both disable default features; encoder
enables `std`, parser enables `std`, `validate`, `features`. The scalar validator
allows only floats, mutable globals, sign extension and saturating float-to-int
instructions. GC/reference/EH proposals join explicitly with their implementation,
not through library defaults. No npm or external wasm tool was added.

Checks run for the Ramsey revision: `cargo fmt --all`, strict workspace clippy
with all targets, 33 common unit tests, 14 wasm integration tests plus the
structurer scope-fault unit test, and the actual CLI and early JVM `--rc` tests.
The shared HostGc gate additionally passed the full workspace checks, including
the logical-layout and async/`for await` preparation tests. Test/build workers
are capped at two; frontend test workers are one. Evidence logs, per-function
route manifests and emitted modules are retained under the lane's
`mainctl/wasm-evidence` directory.
MainClaude approved M1a and its tooling reach repair. The final pinned full gate
`20261012T013517-714631` passed: 42 PASS, 0 FAIL, one approved on-device skip,
23 min 35 s at 24 CPU slots. All landing commits were owed-audited; the final
rebase preserved the implementation patch exactly over unrelated main docs.
The full hostile-pool M1 wasm differential and startup/performance measurements
have not run; those claims are not implied by these bring-up results.

## M1b implementation scan and review points

This amendment is a static scan at landed M1a `2a4e53739bf2`, not an M1b
implementation or a new execution/performance result. The representation plan
below consumes the approved M0 design. MainClaude decided the amendment on
2026-10-12 (~05:40 Athens): the expanded typed manifest ABI and public
uncaught-object decline are approved. The literal fidelity repair stays in the
shared core/front-end queue after stage B and the native escape repair.

Keep the route populations separate:

| Population | Measured route inventory |
| --- | --- |
| Real examples at M1a | 518 projects; 40 emitted and bounded-agree, 478 named declines; 288 emitted functions, all structured, zero dispatcher |
| Generated arbitrary graphs | 600 functions; 256 structured, 344 dispatcher; independent T1/T2 classification and 48,000 bounded execution comparisons |
| Saved generator CFG | Scalarized `triangle__resume`, 16 blocks/18 edges, dispatcher; establishes control flow, not generator execution |
| Real runtime modules on Wasm | Unmeasured: the 29-module emission/route scan was explicitly deferred to M1b acceptance. Native/JVM runtime comparisons do not measure Wasm routes |

Retain the serial runtime runner and parameterize its candidate pin for M1b;
its current saved version targets M1a. Record each emitted runtime module's
function routes, named declines, invalid modules and unclassified failures.
Emission/validation alone does not establish runtime behavioral agreement.

### Input contracts confirmed by the scan

At this revision there are 56 `OpKind`, 15 `ManagedType` and five `Callee`
variants. The 283 literal names in `runtime::declared_names()` are all present
in the existing conservative 505-name appendix. Its planned M1 groups contain
50 numeric, 48 string, 52 array and 54 value/control names; the other 301 names
have explicit decline reasons. These counts describe obligations, not 204
implemented helpers. Generated-name and conditional header declarations still
need the header-oracle check described below.

| Source contract | M1b consequence |
| --- | --- |
| `HirType::Managed`; `Layout.base`, fields and methods | Plan GC types before instructions; native byte offsets are irrelevant. Validate invariant mutable base storage and each callable slot |
| `Program.classes`; `InstanceOf.classes` | Preserve semantic identity separately from structurally equal GC types |
| `Erase.absent`; `ConstNull`/`ConstUndefined` | Null storage does not determine an erased absence tag. Consume the explicit `Absent` fact |
| `ClosureStatic`; fresh `ObjectNew` closures | Cache the named function object only; capture-free arrows still have fresh identity |
| `ArrayNew.zeroed`; `ArrayGet.checked`; `ArraySet` | Initialization and index semantics are distinct facts. No holes-as-zero substitution or fractional-index truncation |
| `StringUnitAt.checked` and the string helpers | An unchecked unit read requires HIR's range proof; checked `charCodeAt` preserves NaN rather than a builtin trap |
| `nts_raise`, `nts_raising`, `nts_raise_take`, `nts_uncaught` | Lower the existing explicit convention. Functions carry no general `may_raise` effect field; do not guess one from names |
| `hir/runtime.rs` scalar signatures | `None` means omitted non-scalar storage, not a type suitable for a GC signature. Resolve actual HIR argument/result types |
| JVM `closures.rs`, `unbox.rs`, `ops.rs` | Carry over verified owner/common-base checks. Their target-specific boxing/representation passes are not Wasm preparation passes |

MainCodex's stage B adds `FieldView` and an explicit accessor capability.
The Wasm review of `93fcf107d` plus `31a20cf72` is complete: body emission
refuses FieldView by name, helper discovery explicitly needs no scalar helper,
and both the CLI and tests select `PreserveFieldAccess`. `Options::new` requires
that choice; `InterfaceAccess` and `Options` have no default. Preserve these
choices when rebasing; HostGc does not imply interface dispatch support.

### Implementation order within the approved representation

1. Build one immutable physical-type/host/helper plan before encoding. Extend
   `types.rs` beyond numeric `Slot`, resolving each reference through the plan;
   `body.rs` and parallel edge copies use that same physical slot. Add the GC
   dependency graph and deterministic recursive groups, class descriptors,
   signature interning and exhaustive managed-type classification. Unsupported
   reachable types produce named declines; a missing planned symbol is an
   integrity error. Keep scalar-only modules free of managed runtime helpers.
2. Add JS strings: literal globals, length/unit reads, equality/order/concat,
   normalized substring operations and selected captured formatting/math
   imports. One `StringOps` plan supplies concrete storage and instructions.
   It does not copy strings through linear memory. Extend the public wrapper
   with strict primitive-string input/output checks and existing numeric facts.
3. Add supported erased values with the approved i31/boxed-f64 representation,
   distinct absence/boolean singletons and string boxes. Preserve negative zero,
   NaN, infinities, cross-representation numeric equality and reference identity.
   `Erase`, `TagOf`, `Unerase` and helper implementations share one tag contract.
4. Add ordinary object/array allocation and fields, stable array wrappers,
   growth, checked reads/stores and the supported array helper catalog. Add
   class/closure entries and typed `call_ref` thunks using HIR-established
   callable signatures and bases. Keep interface access/dispatch, foreign
   storage, presence-bit families and unsupported sparse shapes named declines.
5. Implement the explicit raising helpers and instance-local state. Run caught
   throw/finally traces through direct, virtual and closure calls, then the
   reviewed public boundary subset. Async/generator protocols and native EH
   remain their later milestones; state-machine CFGs already have a sound route.

The implementation stays in `compiler/codegen/wasm`, `runtime/wasm`,
`tooling/wasm`, their fixtures and this document. No new dependency, native
runtime change, core pass or `Backend::ALL` expansion is proposed here.
New shared CLI/gate/differential edits require a separate scoped announcement.

### Literal fidelity: core/front-end request before safe string landing

The existing
[isolating blocker](../tooling/conformance/blockers/a-lone-surrogate-in-a-string-literal/src/main.ts)
and [comparison outcome](../tooling/conformance/outcomes/lone-surrogates-compare-as-one-character/src/main.ts)
record corruption of unpaired surrogate literals before prepared HIR. The
current code confirms the transport limitation: semantic
`LiteralValue::String(String)` becomes `OpKind::ConstString(String)`;
`lower_string` reads the checker's literal type and does not read source escapes.
The frontend classifier copies a JSON string value into that Rust string.
This scan did not rerun the recorded defect or adjudicate the older fixtures'
differing descriptions of the wire encoder.

JS extern strings preserve a lone code unit supplied by the host or built with
`String.fromCharCode`. They cannot recover a source literal whose cooked value
already changed. A backend cannot distinguish legitimate U+FFFD from replacement
characters, and constant folding can consume the corrupted value before emission.
Do not re-cook source text in Wasm or infer fidelity from replacement characters.

Request one backend-neutral contract from the core/front-end owner: either
faithful cooked UTF-16 units (or a specified lossless encoding) through semantic
values, literal HIR, constant consumers and all emitters, or an authoritative
named frontend refusal before information is lost. A refusal needs to cover all
literal-derived constants, not only residual ConstString operations. The named
blocker, valid-pair control, runtime-built lone unit, legitimate U+FFFD, embedded
NUL and foldable comparisons are the acceptance fixtures.

MainClaude explicitly decided this existing shared defect is not an M1b landing
prerequisite. Its recorded outcomes must be reported separately against the
other lanes; they are not agreements with Node and must not be relabelled as
successes. A new Wasm mismatch still fails acceptance. The backend-neutral
repair is queued after stage B and the native escape repair. No front-end/core
file was changed by the scan or by M1b type planning.

### Host ABI details approved for implementation

The M0 import surface and primitive scalar/string boundary are approved. The
following concrete manifest/loader details were approved in the amendment review:

- Use a new manifest ABI version when the physical/import contract expands.
  Describe each required import with module, name, kind and resolved type;
  immutable literal globals carry their string value separately from their
  stable identifier. Keep the reviewed `nts:constants` namespace and validate
  every ordinary import before initialization. Do not overload ABI 1's list
  of scalar `nts` function names with mixed globals and builtin records.
- Keep builtin requirements separate from ordinary reflected imports.
  Enabled builtins are checked at compile time and disappear from
  `WebAssembly.Module.imports()`. The loader therefore checks ordinary imports
  against that reflection and verifies builtin capability with an execution
  probe. Missing support produces a named capability refusal, never silent
  substitution. Builtin substring and code-unit reads need the adapters
  already required by M0 because their range conventions differ from JS methods.
  See the [primary builtin specification](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md).
- Retain the public scalar/string subset. Public arrays, compiled object
  references, callable references and general erased values remain named
  signature declines until their bridge is reviewed. Internal use of these
  representations is M1b work. An opaque engine GC value does not establish
  transparent JS property access or JS object identity.
- Separate input refusal and internal invariant failures from source raising.
  Checked typed indices outside the supported input contract retain a named
  input refusal; source `throw` follows HIR's raising edges. A failed compiled
  call's placeholder result must never reach a public result decoder.
  The JS adapter's cold `nts:host/v1.inputDecline(externref) -> void`
  import reports a named `NTS5001` for an invalid typed-storage input before
  a cast or receiver access can trap. Its argument is the compiled function's
  name, supplied through the same immutable string-global contract. It does
  not enter a source catch handler; it marks an execution outside the supported
  input contract. Source exceptions instead use the explicit raising state.
- Clarify uncaught compiled-object payloads at the JS boundary before claiming
  exception parity. Scalar/string/absence payloads can preserve their JS value;
  an opaque GC object does not expose source `message`, properties or prototype.
  Recommendation: keep that unsupported publication path a named decline until
  an identity-preserving bridge is reviewed. Do not manufacture a JS Error or
  stringify an arbitrary thrown value. Caught compiled errors remain internal.

The exception flag/payload remain per instance. Activation entry/leave restores
state on normal completion, named boundary refusal and a host exception;
`raise_take` clears only a pending raise. Host imports that can throw need an
explicit adapter into the raising convention or a named decline. They cannot
unwind past HIR catch/finally blocks accidentally. A JS reentry test must isolate
nested state once a supported callback boundary exists; M1b has no generic
callback bridge from which to claim that test passed.

### Acceptance population and instruments

Extend the existing same-source oracle before counting any newly emitted
project as agreeing. Its current argument pool is numeric/bool and its thrown
answers are always classified as mismatches. Add primitive string pools
(empty, NUL, BMP, astral pairs, host-supplied lone units) and source throw values;
compare code units and side-effect/finally traces, preserving `Object.is`
numeric behavior. A case skipped for an unsupported boundary is counted
explicitly. Malformed manifests, missing builtins, corrupt recursive types,
missing dispatch entries and wrong typed fields must fail the integrity runner.

Required fixtures cover number/string erasure, absence versus null, two classes
with equal storage, base-field ownership, recursive reference fields, class
virtual calls, mixed closures with a real common base, static/fresh function
identity, alias-preserving array growth, nested/reference/erased arrays and
checked fractional/NaN indices. For unsupported holes, interface access and
presence semantics, verify the named refusal rather than an expected wrong value.
Check the literal-fidelity fixtures above even when a frontend refusal is used.

Refresh all discovered examples, not just those newly supported, with every
project accounted for and zero wrong answers/invalid modules. Freeze the exact
project list in evidence; the M1a baseline contains 518, but do not silently
omit any subsequently added examples. Report per-function structured/dispatcher
routes separately for emitted real examples, emitted runtime modules, generated
graphs and saved CFG fixtures. Include the 29-module serial runtime emission
census; behavioral runtime checks are a separate instrument.

Refresh raw/gzip module, manifest, loader and support-runtime sizes, including a
scalar-only artifact proving unused managed families stay absent. Run strict
format/clippy, relevant Wasm/host/oracle tests, the Backend-match audit and the
Cargo.lock resolution check. Native lanes must remain unchanged and all full
regression-gate obligations remain. No throughput/startup claim comes from this
scan; real paired benchmarks and native-EH experiments remain M2 work.

Gate and land only when the reviewed acceptance is green.
Use the lane inbox handshake and atomic GATE-RUNNING claim, default full gate
parallelism and its memory budget; the two-worker limit applies to ad-hoc
frontend work. Record owed.mjs for the final commit and preserve exact pins.

## Recommendation and build composition

Emit WasmGC directly from verified, prepared HIR. Add a sibling of
`compiler/codegen/jvm`, with typed GC references and engine-owned collection.
Use one emitter, one semantic runtime-helper contract, and explicit host
specialization. Node is the first JS host; browsers follow. A WASI 0.2 component
host is a later milestone. React plus application code in wasm remains the
long-run target, measured against React plus the same application in JS.

| Build dimension | Recommendation |
| --- | --- |
| Target | `wasm`, with wasm32 offsets only for optional boundary linear memory; GC references have no declared pointer width |
| Backend | `wasm`, direct binary emission |
| Runtime family | `wasm`, compiler-generated typed helpers plus selected host services |
| Memory provider | One `HostGc` HIR provider shared with JVM; the engine owns wasm allocations and barriers |
| Host environment | `js` (Node/browser) or `wasi-0.2` |
| String provider | Explicit `js-string` or `gc-utf16`, derived from the host and checked in the build plan |
| API profiles | Core ECMAScript first; native host Web APIs where present; TS fallback algorithms where absent |
| Capabilities | Manifest of required logging, scheduling, clock, Web API, filesystem and network imports; absent required capability refuses |
| Product | Core module plus generated JS host; later a component wrapping the WASI specialization |
| Debug | Names initially; instruction Origins retained for a later `.ntsdbg`/source-map view |

“One core module” means one core implementation and one module per product,
not byte-identical artifacts across incompatible string types. JS strings use
`externref`; WASI strings use GC arrays of UTF-16 units. The selected concrete
representation is resolved once in a `HostPlan`, ahead of instruction emission.
No host conditionals belong inside every operation match. The resulting
artifacts declare their host ABI and feature requirements.

A WASI component needs a canonical-ABI adapter, including linear memory for
ordinary string/list transfers and resource handling. Its interfaces cannot
simply expose our GC references as WIT values. Keep that memory at the boundary;
it does not become the object heap. WASI 0.2 is the brief's chosen interface
version, not a claim that it is the newest version. Runtime support for the
combined GC/component feature set must be probed on the selected M4 engine.
See the [canonical ABI](https://component-model.bytecodealliance.org/advanced/canonical-abi.html).

Reject C-to-wasm as the primary path: native HIR layouts and the C runtime
currently assume eight-byte pointers, while a linear-memory port would bring an
owned heap and conversion boundaries. Reject a JS implementation of every
primitive: it loses the reason to compile loops and object operations into wasm.
Reject a browser/WASI fork of the backend: host choices are data at composition.

## Repository map and preparation contract

The RFC's MIR/provider split describes the intended architecture. The executable
pipeline today is snapshot → HIR preparation → backend; the memory-lowering
crate is presently a scaffold. Wasm should plug into the executable pipeline,
without claiming a MIR layer or a host-GC provider already exists.

| Read surface | What wasm must take from it |
| --- | --- |
| `README.md`; `docs/RFC.md` §§6–8 | Build dimensions are independent; TypeScript stays behind the semantic snapshot; closures and suspension frames are objects |
| `compiler/core/src/hir/mod.rs` | Backend input is `Prepared.program`; 56 `OpKind` variants, five terminators, typed values, layouts, semantic class/interface identities and callable slots |
| `hir/verify.rs` | Checks value references, dominance, edge arity/types, parameters/returns, operand legality, call signatures, stores/layouts, numeric coercions, erasures, native storage/dispatch and subscriptions; no proof of CFG reducibility or wasm physical typing |
| `hir/runtime.rs`; `hir/signatures.rs`; `core/tests/runtime_signatures.rs` | Helper-boundary scalar conversions and interprocedural specialization belong in the core; signedness matters even where wasm types share a bit width |
| `codegen/common/{backend,lib,linearize,destruct}.rs` | Backend names parse centrally; reuse RPO and sequenced parallel edge copies, including cycle temporaries; add wasm structuring locally |
| `tooling/cli/src/main.rs` | Follow `emit_jvm`'s frontend/cache/root selection and verified preparation; add an `emit-wasm` command and check runner through coordinated small shared diffs |
| `codegen/jvm/{lib,types,hierarchy,face,closures,ops,unbox,widen}.rs` | Separate physical types, hierarchy/slot resolution, callable entry faces, body emission, runtime mapping and measured representation planning |
| `compiler/jvm-emitter` | Encoding is independent of HIR; Origins and stack invariants are mandatory, not optional debugging conventions |
| `runtime/jvm`; `docs/jvm-interop.md` | Host-managed references do not remove numeric, erased-value, method-resolution or foreign-boundary semantics |
| `docs/scalar-numbers.md` | Operators compute Node's values; proofs/written kinds govern fixed-width storage. Width annotations do not license wrapping ordinary arithmetic |
| `hir/lower.rs`; `hir/suspend.rs`; `docs/async.md` | Raising calls and coroutine frames are already compiler decisions; preserve them rather than depending on JSPI |
| `tooling/differential`, `conformance`, `gate`, `census`, `bench` | Refusal counts do not prove answers; artifacts need validator and linkage checks as well as Node comparison |
| `docs/nts-config.md`; `tooling/config/src/target.ts` | Restore wasm with a real target constructor, not `linux({arch: 'wasm32'})`; exclude wasm from `NativeBackend` |
| `runtime/web-platform`, `runtime/node`; Web platform plan | Typed portable algorithms and platform primitives have separate ownership; choose host-native APIs where their profile semantics agree |
| `docs/react-integration.md`; `runtime/react` | React's observable ordering and compiler blockers carry over; target this repo's React runtime, with upstream as the oracle |
| `docs/electron-like.md`; `docs/web-worker.md` | Browser wasm is a renderer-host option; it does not replace the existing direct native Blink lane. Worker ownership/transfer requires evidence, not TS type inference alone |

### What preparation does today, and the requested provider change

`Provider` has only `NoGc` and `ReferenceCounting`. `emit_jvm` calls the common
`emit_options`, which reads `selected_provider`; it has no distinct JVM provider.
Preparation calls `place_allocations` unconditionally, then `provide` inserts RC
only for the RC provider. The JVM refuses counting operations and allocates its
objects on the host heap despite native frame hints. Therefore “copy what JVM
turns off” is not presently an available provider configuration.

Approved provider work: add one **`HostGc` provider** for JVM and wasm, and
select it explicitly in their drivers. MainClaude authorized this lane to make
that small core commit as a scoped exception to core file ownership. MainClaude explicitly approved the named `hir/mod.rs` overlap; keep its hunks
limited to the provider enum and placement/provision selection so the core
lane's rebase remains mechanical. It must suppress
native ownership lowering and native frame placement, while preserving semantic
analysis and logical layouts. Do not reinterpret `NoGc` as host-managed memory.
Reject `--rc` with either managed backend by name at build planning.
Before landing, the JVM lane reviews byte-identical artifacts or every named,
explained difference; C, LLVM and RC must remain unchanged. Land the provider
commit before M1a, with a diagnostic for surviving `Retain`/`Release` operations.
Provider lowering is the single place that omits native managed-reference
lifetimes, including markers from async/generator and `for await` lowering.
Insertion sites remain provider-neutral; foreign/nonmanaged ownership markers
remain and the boundary check diagnoses them. MainClaude explicitly approved
one test-only `HostGc` arm in the C execution helper; no C emission code changes.

Reviewed core `e9fab5a2730c` was compared against a clean `e52ddc97e160` pin.
The final candidate binary's SHA-256 is
`058df473eb81301e1ae1f05842a23aae0b8d28b448b77f16698a0dfbc2273301`;
both arms record their source and applied-diff provenance. Across all 518
examples, C and RC each have 511 byte-identical emitted outputs and seven
unchanged refusals; LLVM has 517 and one. JVM has 489 byte-identical projects,
28 with only `LineNumberTable` changes, and one unchanged frontend refusal.
Across all 29 Node/Web runtime modules, JVM has 12 byte-identical outputs and
17 with only `LineNumberTable` changes. Compiler status and diagnostics are
unchanged throughout. These are artifact comparisons, including partially
emitted projects with existing declines; they do not claim full language support.

Removing zero-instruction lifetime markers changes the JVM emitter's source-line
bookkeeping. Every changed class is identical after removing only its nested
`LineNumberTable` attributes; constant pools, instructions, exception tables,
stack maps, all other attributes and runtime jars remain byte-identical. The
reports name every changed class and method and record both line tables and
normalized hashes. The comparator fails on unexplained bytes, status/diagnostic
changes or lost classes/jars, and rejects the historical preflight that caught
two `for await` refusals. Final reports and exact hashes are indexed in
`mainctl/wasm-evidence/HOSTGC-FINAL-EVIDENCE.md`; the failed preflight is archived
separately. Independent JVM review accepted the corrected evidence. The full
core gate passed 42 checks with the approved Android device skip and the
provider landed. The subsequent benchmark-driver artifact comparison accounts
for all 62 cases: all 166 classes and all 62 runtime jars are byte-identical,
with no status or diagnostic changes. Those JVM timings carry without a
paired re-time.
Before the Ramsey amendment, all 40 emitted Wasm corpus modules, manifests
and loaders stayed byte-identical after HostGc integration. The Ramsey
revision preserves that population and its bounded answers; all 288 emitted
corpus functions use the structured route. Its new CFG translation changes
wasm bytes and instruction Origins; refreshed sizes are recorded above.

| HIR work | Under `HostGc` |
| --- | --- |
| Lowering, obligation checks, refusal cascade, root selection, monomorphization and reachability | Keep |
| Layout collection, base-field ordering, `Layout.base`, class/interface identities and callable adapters | Keep: these are logical structure and dispatch contracts |
| Numeric facts, folding, signature/storage narrowing, specialization, reconciliation and bounds proofs | Keep |
| Erasure narrowing, tag simplification, boxing legalization, CSE, DCE, store forwarding and substring simplification | Keep; consume the resulting semantic operations |
| Async/generator state-machine lowering | Keep; M1 declines the unsupported runtime operations, M5 implements them |
| `place_allocations`, `ObjectNew.frame`, `Call.frame` and `frame_capacity` | Disable native frame placement; do not emit stack addresses for GC objects |
| `rc::insert`, ownership-driven retains/releases and native release-edge work | Disable; any surviving `Retain`/`Release` is a provider mismatch diagnostic |
| Escape analysis used solely to pick native storage | Skip for this purpose; retain any independently justified analysis use |
| `layout.rs` byte offsets, header size, native descriptor scanning maps | Do not consume for GC representation; native memory layout queries decline |
| Foreign ownership/handle sinking and native dispatch planning | No supported M1 native families; decline them. The new provider must not imply “native NoGc” foreign lifetime behavior |

Wasm struct fields have **indices**, not exposed byte offsets. The engine chooses
allocation layout and barriers. Preserve field identity (`declared_by`) and
base prefixes even though the physical byte-layout calculator is not used.
Do not disable all `Layout` work merely because it shares a name with byte layout.

### Prepared-HIR evidence

Ran the exact pinned binary for the scanned revision, serially, with the shared
`NTS_TSGO`, against eight projects using `nts hir --prepared`. Compiler SHA-256:
`9dcae4df007c2489af18a602c3e58cf16bc2b38939eb00e2ca67afab5a2604a7`.
All commands exited 0; their stderr was empty. This is inspection evidence,
not an emission or differential verdict. The CLI's HIR dump can display an
invalid prepared program; the new backend must call `prepare_with`, never
`prepare_unverified`.

| Project | Functions, including abstract declarations | Blocks | Irreducible functions |
| --- | ---: | ---: | ---: |
| arrays | 16 | 32 | 0 |
| async | 71 | 298 | 0 |
| classes | 5 | 5 | 0 |
| closures | 66 | 121 | 0 |
| exceptions | 29 | 248 | 0 |
| generators | 61 | 403 | 1 |
| loops | 12 | 144 | 0 |
| strings | 61 | 268 | 0 |

Population: 321 functions and 1,519 blocks; 39 distinct external helper names.
A separate `two-classes-one-descriptor` inspection checked semantic identity
versus equal storage. No all-example agreement count exists for wasm at M0.
There are 518 immediate `examples/*/tsconfig.json` files at this revision;
future reports must use the instrument's actual discovery count.

The CFG audit computes dominators, removes edges to dominating headers, and
checks the remaining reachable graph for cycles. `triangle__resume` in
`examples/generators` is irreducible: initial state enters through `b3 → … → b7`
while resumed state enters through `b13 → b14 → b11`. The cycle
`b7 → b8 → b11 → b15 → b9 → b7` therefore has multiple entries.
This is an observed counterexample to assuming that TypeScript syntax implies
reducible prepared CFGs.

## Value and dispatch representation

### Numbers

| HIR representation | wasm representation |
| --- | --- |
| Bool | Canonical 0/1 in i32 |
| Signed/unsigned 8/16-bit | i32 locals; packed i8/i16 GC fields/arrays where permitted; signed/unsigned loads explicitly differ |
| Signed/unsigned 32-bit | i32; signedness chooses comparison, widening, division and conversion instructions |
| Signed/unsigned 64-bit | i64; ordinary number specialization remains limited by HIR's exact-number facts |
| f32/f64 | f32/f64, preserving NaN behavior and signed zero |
| BigInt, boxed BigInt, integer widths above 64 and unsupported float widths | Named M1 decline; no truncation to i64 |
| Void/Never | No value; nonreturning code ends with a checked control-flow claim |
| NativePointer | Named decline; never treated as an integer or GC reference |

Managed-type inventory is also explicit:

| ManagedType | M1 decision |
| --- | --- |
| String | JS extern reference |
| BoxedBigInt | Named bigint decline |
| Object | GC class/record/closure struct; interface dispatch and foreign layouts decline |
| Array | GC identity wrapper and typed backing storage |
| Template | Named template-reflection decline |
| Promise | Named Promise/scheduler decline until M5 |
| Map | Named collection-runtime decline |
| Table | Named collection-runtime decline; must remain observably distinct from Map |
| Set | Named collection-runtime decline |
| Date | Named date-runtime decline |
| Buffer | Named buffer-runtime decline |
| View | Named typed-view decline |
| AnyView | Named unspecialized-view decline |
| DataView | Named DataView decline |
| Symbol | Named symbol-runtime decline |

Use HIR's decided result width. `Uint8` storage does not mean an i8 add;
ordinary add/multiply cannot acquire wraparound just because the inputs are
narrow. `ToInt32`/`ToUint32` need JavaScript's modulo conversion: wasm trapping
or saturating float-to-int conversion alone is incorrect. `Math.round` differs
from ties-to-even; f64 remainder needs JS-compatible behavior rather than integer
remainder; shift counts follow the source operator's 32-bit rules. Min/max,
NaN, division by zero and negative zero need explicit oracle coverage.
Wasm f64 min/max may be used where their required behavior matches HIR semantics.

Use imports of captured Node `Math` primitives for transcendental functions in
M1; elementary arithmetic, sqrt, floor, ceil, trunc and bit operations stay in
wasm. The import contract counts these calls. Do not import a JS function for
every integer add. For i64 exports, generated wrappers distinguish JS number
semantics from a written bigint ABI; they never round an exact scalar silently.

### Strings

One internal `StringOps` contract selects physical type, constants, length,
unit access, equality/comparison, concat and substring primitives. Helpers
preserve JS UTF-16 indexing, including lone surrogates. `charCodeAt` out of range
returns NaN; `charAt` returns the empty string; `at` can return undefined.
Bounds-proven internal accesses may use stricter builtins only when HIR proves
that the call will not trap.

On JS, use strings directly as extern references and
[JS String Builtins](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md)
for supported primitives. Missing builtin operations use narrow captured JS
imports, such as case conversion and numeric formatting. Literal strings are
immutable externref global imports supplied by generated JS, so loading a
literal makes no host call. Neither source strings nor DOM references are
UTF-8-encoded merely to cross the wasm/JS boundary.

On WASI, recommend immutable GC UTF-16 array storage (with length/view metadata
if substring benchmarks justify it). Serialize strings at the canonical-ABI
boundary using its declared encoding. Lone-surrogate behavior needs an explicit
policy for WIT strings, which cannot be assumed to preserve arbitrary JS code
units. Decline incompatible crossings or expose bytes/resources explicitly;
never silently replace code units. This is an M4 design/interop test obligation.
Reject the unrequired stringref proposal and a second compiler-wide string type.

### Erased values (`unknown` and heterogeneous unions)

C uses a 16-byte tagged `NtsValue`; LLVM uses `{ i32, i64 }` plus ABI-specific
calling conventions; JVM uses `NtsValue {tag, num, ref}` and a proven unboxing
plan. Wasm gets its own representation while preserving the existing semantic
tag numbers and the `Erase.absent` distinction.

Recommend `(ref null any)` as the transport type, with disjoint runtime cases:
small signed 31-bit integer **numbers** as i31ref; other numbers as immutable
f64 boxes; booleans, null and undefined as distinct singleton GC objects;
strings as tagged boxes containing the selected string representation; objects,
arrays and closures as their original GC references, tagged by their descriptor.
Actual wasm null is internal nullable storage, not a substitute for both erased
null and erased undefined. Erasing a nullable reference reads `Absent` to choose
the right singleton. `-0`, NaN, infinities and integers outside i31 remain f64
boxes. No pointer or GC reference is hidden inside numeric bits.

`TagOf` tests the physical cases and returns HIR's semantic tag. Numeric equality
compares values across immediate and boxed cases; string equality compares code
units; object/function equality compares identity. `Unerase` requires the
matching semantic case and preserves absent-number NaN behavior. A cast outside the supported runtime input contract
must produce its specified named failure; a source assertion alone does not
justify an unchecked physical cast or invented coercion semantics.

The local stored-number-array kernel below motivates testing i31, rather than
forcing an allocation for every small erased number. It does not establish that
this is fastest for all unions. Prototype a simple all-boxed reference arm too,
then compare actual `erasure-*`, `in-narrowing` and mixed-union fixtures before
locking the representation. Defer unboxed external strings until an independent
plan proves tag tests and absence are preserved. Reject NaN-boxing GC references
into i64: the host collector cannot trace numeric payloads.

### Objects, nominal identity and arrays

Generate GC structs following `Layout.base` and its field prefix. Build recursive
type groups from the physical-type dependency graph; deterministic SCC ordering
handles cyclic fields and callable signatures. Do not mark a field immutable
merely because HIR calls it readonly: constructors emit later FieldSet operations.
M1 fields stay mutable unless construction can be emitted atomically; a later
measured plan can recover immutable fields safely.

Each root object has an immutable descriptor reference; subtype structs preserve
that prefix. Mutable base fields require invariant physical storage types;
if a derived layout disagrees, decline by field/class name and request the core
contract rather than casting between incompatible struct types.
Descriptor data names semantic class identity, ancestry and runtime
kind, plus the selected dispatch object. It contains no size/scan map for a GC.
Physical wasm types cannot be the sole nominal identity oracle: equal storage
and wasm structural type matching do not establish that two declared classes are
the same class. `InstanceOf` uses safe physical narrowing plus descriptor ancestry
resolved from `Program.classes`, not field prefixes. The fixture
`two-classes-one-descriptor` is mandatory. Unknown classes/layouts refuse.
See the [core type model](https://webassembly.github.io/spec/core/syntax/types.html).

Arrays use an identity-bearing mutable wrapper `{kind, length, backing}` and
GC backing arrays by element representation: packed bytes/shorts, i32, i64,
f32, f64, typed references and erased anyref. Growth swaps the backing array,
not the wrapper, so aliases retain identity. Reference-array invariance remains:
a mutable subtype element array cannot masquerade as a base element array.
Checked erased reads return undefined where HIR asks for it; typed reads beyond
the compiler's supported input contract produce the harness's named decline,
not a validator/runtime trap. Sparse growth and holes must follow the prepared
array contract; decline shapes whose storage cannot express them.
In particular, HIR's zero fill of a typed `new Array(n)` is not an undefined
element representation. Wasm checks initialization before admitting observations:
stores in the allocation block prove individual constant slots ready, complete
initialization permits aliases/escape, and length-only use needs no such proof.
Branch-local stores cannot prove readiness on all paths. Unproven typed holes
decline by function and source origin; `zeroed: false` retains HIR's explicit
promise that lowering fills every slot before observation. Erased backing starts
with the undefined singleton. This admission check changes no native lane.
Closed push/pop/fill/truncation helper rows use the same wrapper and backing.
Push can grow reference and erased arrays while preserving aliases; pop and
truncation clear removed backing slots so retained capacity does not keep them
alive. `pop_value` reads a number array and returns an erased optional number;
`push_value` writes erased elements, following their distinct header contracts.
Fill and truncation to zero establish readiness even for an unknown allocated
length. Shrink validation precedes conversion and storage; hole-producing growth
refuses through the input contract. Native buffer or foreign variants stay named
declines. The remainder of the planned helper appendix is not yet implemented.
M1 excludes buffer/view/DataView families; they are a separate boundary design.

### Closures and virtual calls

A closure is a GC struct with captures and a descriptor/callable entry. Use a
shared callable base per HIR-proven signature, containing an immutable typed
funcref; its thunk casts the base receiver to the exact capture struct and calls
the generated body. Invocation uses `call_ref`. Uniform erased and raising entry
slots remain distinct. If merged closure flows lack a HIR-established common
callable type, decline rather than casting a sibling capture struct.

Recommend immutable GC dispatch structs of typed funcrefs, with a common
slot-signature convention determined from HIR. Descendants preserve the base
slot contract; generated receiver/result adapters fill it. `Layout.methods` is
already the answer to which body occupies which slot, including ordinary bodies
in raising slots. Never derive raising names by simply appending `@raises`.
Closure calls use the same typed entry machinery as class calls.

The M1b closure implementation uses only the root and slot relationships HIR
declares. Each demanded slot contributes an immutable typed entry to its callable
base; capture fields follow that resolved prefix. Ordinary and raising slots
remain separate even when their physical signatures match. Only allocated
concrete layouts receive thunks, and an unfilled or incompatible entry refuses
before emission. Named-function globals preserve singleton identity; fresh
`ObjectNew` allocations retain their own identity. Declarative element segments
register the referenced thunks. Modules using those entries require an executed
`function-references` host probe, including `ref.func`, `call_ref` and declarative
elements; capability failure is a named refusal.

The class path puts a separate immutable dispatch struct in the descriptor.
Its demanded slots use a common receiver contract and typed funcrefs; per-layout
thunks select the actual inherited or overridden body. The declared call
signature is checked against that contract before emission. Capturing closures
and class entries have distinct plan keys. An object's result can widen along a
declared GC subtype relation while retaining its reference and descriptor;
unproven argument/result contracts decline. No class method table is inferred
from physical layout equality.

A flat global function table with `call_indirect` is the alternative. It may win
on code size or an engine's optimizer; benchmark monomorphic and polymorphic
`dispatch`/`closures` kernels before finalizing the dispatch storage. It introduces
an additional index/type check and gives less direct typed reachability than the
recommended GC field. No unmeasured performance advantage is asserted here.

Interface-typed member dispatch and interface field access decline by declaration
name through `Program.interface_identities`/layout metadata until the core redesign
in `docs/interfaces-by-shape.md` settles. A class may implement an interface without
making its direct class call unsupported; decline the unsupported operation,
not every class with a nonempty `interfaces` list.

JVM lessons to carry over: keep closure joins at a true common base; model
uniform callable faces separately from concrete capture classes; validate inherited
fields by their declaring owner; check every dispatch slot is filled and signature
compatible. The JVM's `unbox` and `widen` are measured target choices, not passes
wasm should transplant. Its verifier harness also needed unresolved/shadowed/unfilled
member checks because bytecode verification alone did not prove dispatch correctness.

## Control flow and exhaustive operation coverage

Use typed locals for values and an empty operand stack at each original CFG edge.
Reuse `common::edge_copies` for simultaneous block-parameter assignment, including
swaps; temporary locals have the actual physical type. Emit every operation in
its original side-effect order before considering stackification.

Use [Ramsey's ICFP 2022 algorithm, sections 5–6](https://www.cs.tufts.edu/~nr/pubs/relooper.pdf).
Compute reachable RPO and the immediate-dominator tree. Count forward inedges
to identify merges; identify loop headers from backward edges. Traverse the
dominator tree recursively, wrap merge children in reverse RPO order, and place
their code after the corresponding block in forward order. Inline each nonmerge
successor at its source branch, with parallel copies before the transfer. Loop
headers bind enclosing loop labels. This handles reducible graphs generally,
without recognizing source loop syntax or duplicating basic-block actions.
Coverage and lexical-scope failures are named internal compiler errors. The
translation must cover every reachable block exactly once and every original
edge; it cannot change routes on a structuring failure. M1a must exercise
multiple exits, joins and
block-parameter cycles as well as simple source loops.
Stackify single-use pure values within a block only after this path is sound.

The fallback is a **per-function dispatcher for irreducible functions only**:
first prove the reachable graph has an irreducible cycle; then use an i32
program counter, an outer loop, nested case blocks and `br_table`; each original
terminator performs edge copies, sets the next case, and branches to the loop.
Return/unreachable exit normally. No local reassignment or side effect is cloned.
The full observed `examples/generators` `triangle__resume` graph is its required
fixture; scalar-only versions of its edge topology can exercise M1a before the
generator runtime is supported. Later use per-SCC dispatch or node splitting only if
measurement pays for its extra code and proof surface. Reject a “loop syntax only”
structurer, guessing from block order, and universal dispatch as the final fast
path. M1 reports each function's route, reachable block count and mapped edge
count, plus route totals, and times structured ordinary
loops plus the irreducible dispatcher fixture.

In the following inventory, **M1** means planned support at M1 completion,
not a claim of implementation today. Type/boundary limitations above apply.
**Decline** means a source-located shape name before publishing an artifact.
Backend operation and type matches must be exhaustive, without a catch-all arm.

| OpKind | WasmGC lowering | M1 status |
| --- | --- | --- |
| `NativeLoad` | Native memory access requires an explicit boundary ABI | Decline |
| `NativeStore` | Native memory store requires an explicit boundary ABI | Decline |
| `NativeLocal` | Native local storage has no GC struct equivalent | Decline |
| `ObjcClass` | Apple runtime class lookup | Decline |
| `ObjcSelector` | Apple selector lookup | Decline |
| `NativeSizeOf` | Native byte-layout query | Decline |
| `NativeMalloc` | Native allocation | Decline |
| `NativeFree` | Native release | Decline |
| `NativeIndexAddress` | Native pointer arithmetic | Decline |
| `NativeFieldAddress` | Native field address | Decline |
| `NativeBitLoad` | Native ABI bitfield load | Decline |
| `NativeBitStore` | Native ABI bitfield store | Decline |
| `NativeCopy` | Native aggregate copy | Decline |
| `NativeBridge` | Foreign callback bridge needs host/lifetime metadata | Decline |
| `NativeBlock` | Objective-C block ABI | Decline |
| `DelegateInvoke` | COM delegate invoke ABI | Decline |
| `Param` | Typed function parameter/local.get | M1 |
| `BlockParam` | Typed local filled by sequenced edge copies | M1 |
| `ConstInt` | i32.const/i64.const at the HIR width | M1 ≤64 bits; other widths decline |
| `ConstFloat` | f32.const/f64.const, preserving exact bits | M1 f32/f64 |
| `DispatchSlot` | i32 constant selecting a declared typed callable entry | M1 class/closure slots; interfaces decline |
| `ConstBool` | i32.const 0/1 | M1 |
| `ConstString` | Immutable imported externref global; WASI later GC constant | M1 JS |
| `ConstTemplate` | Site-identity GC template with cooked/raw immutable arrays | Decline until template reflection is supported |
| `Erase` | Immediate/reference/singleton/box with Absent semantics | M1 supported types |
| `TagOf` | Semantic tag from immediate or descriptor/box kind | M1 |
| `Unerase` | Case test and payload extraction/ref cast; specified absence handling | M1 supported types |
| `Binary` | Typed arithmetic/comparison, JS-correct strings/equality/coercion | M1 numbers/bools/strings/references; BigInt declines |
| `Unary` | Typed instruction or semantic conversion/truthiness helper | M1 supported types |
| `Convert` | Proven scalar conversion/checked reference widening | M1 supported widths/types |
| `Call` | Direct call, mapped external helper, typed class/closure call_ref | M1 approved helper/slot; other external/interface calls decline |
| `Return` | Function return respecting physical result type | M1 |
| `ArrayNew` | Identity wrapper plus typed GC backing array, zeroing per contract | M1 supported element types |
| `Length` | Wrapper length, builtin string length, or checked erased case | M1 arrays/strings; other containers decline |
| `ArrayGet` | Check logical length, GC array.get/s/u; specified missing erased value | M1 |
| `Retain` | Provider mismatch; never silently discarded | Decline |
| `Release` | Provider mismatch; never silently discarded | Decline |
| `StringUnitAt` | Builtin charCodeAt under HIR bounds contract | M1 JS |
| `GlobalGet` | global.get at physical type; module evaluation initializes deferred values | M1 |
| `GlobalSet` | global.set at physical type | M1 |
| `ConstNull` | ref.null for typed nullable storage; erased null singleton | M1 |
| `ConstUndefined` | Undefined singleton where erased; typed absence per HIR | M1 |
| `ObjectNew` | struct.new_default/struct.new with initialized descriptor and legal field defaults | M1 supported layouts; native frame flag must be disabled |
| `CellReady` | Read initialization state; throw TDZ ReferenceError through raising convention | M1 |
| `ClosureStatic` | Shared initialized closure singleton global | M1 |
| `InstanceOf` | Safe narrowing plus semantic descriptor ancestry | M1 known classes |
| `FieldGet` | struct.get with declaring field/base contract | M1 class/closure/record; interface dispatch declines |
| `SharedFieldGet` | Proven shared base load, otherwise finite descriptor-tested arms | M1 compatible supported arms |
| `OpenFieldGet` | Semantic arm guards, absent defaults, then typed field load | M1 supported class/record arms; interface/optional presence shapes decline |
| `OpenFieldSet` | Semantic arm guards then typed field store | M1 supported class/record arms; interface/optional presence shapes decline |
| `FieldSet` | struct.set using actual field storage type | M1 class/closure/record |
| `Await` | Should have been lowered by suspend; surviving op is an invariant diagnostic | Decline |
| `Yield` | Should have been lowered by suspend; surviving op is an invariant diagnostic | Decline |
| `Suspend` | Frame plus runtime subscription and resumption entry | Decline until M5 |
| `PromiseSubscribe` | Typed reaction plus selected promise/runtime scheduler | Decline until M5 |
| `ArraySet` | Bounds/growth semantics then GC array.set | M1 supported element types |

Terminator inventory: `Return` → return; `Jump` → copies then structured branch
or dispatcher step; `Branch` → conditional edge copies and branch; `Unreachable`
→ wasm unreachable only for the core's established nonreturning claim;
reachable `FellThrough` → invalid-HIR error, never a fabricated return value.
Abstract declarations are signatures/slot obligations, not executable bodies.

## Exceptions and the measured choice

Prepared HIR does not retain a lexical try region for the backend to translate.
A local throw can already be an ordinary jump into its handler. Cross-function
try paths call `@raises` entries, test `nts_raising`, and only on the raised arm
call `nts_raise_take` to consume and clear the payload. Unhandled raising paths
return the result's placeholder without reading it; ordinary uncaught paths use
`nts_uncaught`. Uniform closures and virtual methods have raising slots, sometimes
filled by their ordinary body. Preserve that exact slot mapping.

Recommend **explicit raising returns for M1**, implemented as per-instance
pending-raise state (flag plus erased payload), with enter/leave activation rules
that isolate synchronous host re-entry. `raise_take` clears the slot; a failed
call's placeholder result is never consumed. No process-global singleton state.
`nts_uncaught` crosses to the JS host as the actual thrown value; compiler defects
and named input declines remain distinct from source-language exceptions.

Native wasm `throw`/`try_table`/exnref are available, as the probes show. Native
EH is an **M2 priority**, requiring region-aware exception lowering, not an instruction-for-
instruction replacement of `nts_raise`: immediate native unwinding would bypass
HIR's explicit handler edges and cleanup/finally behavior. A transformation must
establish call, handler and finalizer regions and preserve arbitrary thrown values.
If core metadata is needed, request it rather than recognizing helper-name patterns
as a proof. The [exception model](https://github.com/WebAssembly/exception-handling/blob/main/proposals/exception-handling/Exceptions.md)
provides tags and catch targets, not TypeScript handler semantics.

### Core proposal: preserve exception semantics through preparation

**Request to MainCodex for cross-backend review with the JVM lane.** This is a
proposed shared HIR contract, not an implemented extension or a change to M1.
Native unwinding needs a semantic input that wasm, LLVM and JVM can consume.
The exploratory deep no-throw kernels put explicit raising at about 3.4–3.9
times Node's cost; this motivates prioritizing the contract in M2, with the
actual emitted-code comparison still required before choosing its final lowering.

Today `lower.rs` retains `Exit::Handler`, `Exit::Finally`, throw-time binding
snapshots and the transitive raising-call decision while constructing a body.
It then expresses handler transfer as ordinary jumps, duplicates finalizer
bodies at exits, and expresses cross-call propagation through raising copies
and flag/payload helpers. `Func` and `Terminator` do not carry the protected
regions that explain those operations. Preserve the semantic information before
this expansion, and carry it through optimization into prepared HIR. A backend
must not reconstruct it from `@raises` names, helper sequences or source spans.

The following are proposed data responsibilities; their Rust spelling belongs
to the core design. Stable IDs must survive block splitting and cloning, with
explicit remapping when IDs change.

| Prepared HIR responsibility | Required information and meaning |
| --- | --- |
| Protected regions | A per-function region graph with parent, kind (`try` body, catch body or finalizer), source Origin, handler/finalizer references, and the ordered active-region stack at each potentially raising operation and exit. Split blocks at region changes or record operation-level membership: one block-wide label cannot describe a block crossing a `try` boundary. Byte offsets are backend output, never the source of this contract |
| Handler entries and exceptional edges | An explicit exceptional successor for each raising site, or an explicit escape from the function. The edge carries the original erased thrown value and the SSA bindings visible at that site as typed handler parameters. Give synthetic exception results their own edge definitions: the normal call result exists only on the normal edge |
| Raising operations and call effects | Semantic throw/propagate operations and a checked `CannotRaise` or `MayRaise` effect for calls and helpers. Direct summaries are transitive through recursion; virtual/interface/closure summaries include every permitted target, including adapters and overrides. Accessors, constructors, callback-bearing runtime helpers and imported calls participate. Unknown host effects are conservative or declined, never implicitly `CannotRaise` |
| Finalizers and pending completion | The finalizer entry/body and the ordered finalizer chain crossed by each normal or abrupt exit. A pending completion carries its kind, payload and continuation: fall-through/jump, return, throw, break or continue. Evaluate return and throw operands before finalization. A normally completed finalizer resumes that completion; its own return, throw, break or continue replaces it |
| Function escape and callable identity | Explicit uncaught propagation with its original payload and a semantic callable identity separate from any ordinary/raising ABI copies. Preserve override/closure slot obligations so a backend cannot select a nonpropagating entry for a potentially raising call |
| Suspension and re-entry | The handler/finalizer continuation and live completion state at an `await`/`yield`, remapped onto resume entry paths by state-machine lowering. Host stack unwinding cannot cross a suspended activation. Callback/host re-entry has explicit propagation boundaries, and uncaught throws preserve the published host behavior |

A raising call should have invoke-like semantics in the shared IR: successful
execution enters its normal successor with the result; raising enters its
exceptional successor with the thrown value and the preexisting live bindings.
The backend may encode it as a call in a protected range rather than an actual
`Invoke` instruction. Preserve which effects happened before the raising site.
For `x = 1; mayThrow(); x = 2`, the catch sees `x === 1` when the call raises;
an exceptional-edge parameter must not use the normal successor's assignment.
Runtime operations with user-observable throwing behavior need this contract
even if they were not written as source calls.

Region nesting defines handler selection. A catch protects its associated try
body, not its own catch body or finalizer. A throw from either searches the next
active outer handler after running the finalizers it crosses. A finalizer runs
exactly once on each path that leaves its scope, in innermost-first order,
including return and labeled loop exits. Local caught throws may remain direct
edges when that preserves all intervening finalizers and effects. Distinguish
language exceptions from validator failures, compiler defects and host traps;
do not make internal failures newly catchable as TS thrown values.

This contract also defines exceptional liveness. Values needed by a handler or
cleanup are live on the exceptional edge. Native ownership providers derive
their releases and cleanup actions from those edges; host-GC providers preserve
the values as collector-visible references without native retain/release work.
Source finalizers remain semantic code under every provider. GC does not run a
source `finally` in place of control-flow cleanup.

Preparation must select a shared exception lowering after the semantic passes,
using an explicit capability/convention request distinct from memory provider.
The existing explicit lowering remains available for C and M1. A native-EH
prepared form preserves the region/edge contract and does not contain a second
flag-check convention for the same calls. Mixed foreign conventions require an
explicit boundary adapter; no undocumented helper-pattern rewrite or automatic
hybrid is proposed. Inlining, specialization, CSE, DCE, refusal cascade and
reachability must preserve or deliberately discharge exceptional edges, roots
and effects. Removing a handler requires a proof that no raising path reaches
it; moving an operation across a region boundary requires the same semantic
proof as moving it across an observable effect.

The core verifier should check region nesting and membership, handler selection,
edge arity/types and exceptional dominance, absence of a normal-only result on
an exceptional edge, finalizer order and completion replacement, valid escaping
payloads, and call-effect consistency. A changed callee set invalidates a
`CannotRaise` proof. Unrepresentable host propagation or suspension shapes refuse
by name. In particular, this proposal does not remove the current refusal for
iterator-closing finalizers spanning `yield` without implementing that contract.

| Consumer | Lowering enabled by the same semantic contract |
| --- | --- |
| Wasm | Native throw/`try_table` with a language payload carrier and explicit finalizer/resume paths; host exceptions translated only at specified boundaries |
| LLVM | `invoke`/landing-pad or target-appropriate EH operations, with the personality, payload carrier and cleanup ABI implemented and tested for each supported target |
| JVM | Protected bytecode ranges and exception tables, using a throwable carrier that preserves arbitrary TS payloads and their identity; finalizer exits remain explicit where required |
| C / explicit lowering | The current ordinary CFG and raising flag/payload ABI, derived centrally from these regions and edges |

Acceptance requires the same TS fixtures under both shared lowerings and each
participating backend: nested catch/finally; calls inside and outside try;
return-value evaluation before finally; finalizers that replace return/throw;
labeled break/continue through nested finalizers; arbitrary thrown primitives,
`undefined`, `null` and object identity; mutated locals observed by catch;
recursive, virtual, interface, accessor and closure calls; callback/host re-entry;
and fulfilled/rejected await resumptions. Retain current classified refusals for
unsupported generator/foreign behavior. Verify artifacts and compare full result
and effect traces to Node, then measure no-throw, rare-throw and throw-heavy paths
on real emitted code against plain JS with equivalent Error/stack semantics.
MainClaude arranges that M2 quiet window; no additional microprobe timing is owed
now. Native EH remains the intended eventual single default for wasm, contingent
on this contract and its correctness evidence.

### Local microbench evidence

Hand-encoded standalone kernels, not nts-generated output. Node v24.20.0,
V8 13.6.233.17-node.53, no feature flags. Each exception case warms each arm
100 times, then runs seven interleaved repeats, reversing arm order each round.
A sample runs 100 × 30,000 iterations. A callee either returns i or raises -i;
checksums match a JS-computed integer sum. The explicit arm propagates a flag
and payload through every caller; the native arm catches the tagged payload
at the outer handler. Depth counts the seed callee plus forwarding calls.

| Depth | Throw frequency | Explicit median ms [min, max] | Native median ms [min, max] |
| ---: | --- | ---: | ---: |
| 1 | never | 1.072 [1.065, 1.080] | 1.146 [1.140, 1.164] |
| 1 | 1/1024 | 1.062 [1.049, 1.224] | 1.304 [1.292, 1.350] |
| 1 | always | 1.545 [1.530, 1.726] | 211.365 [207.855, 222.453] |
| 8 | never | 9.222 [8.737, 9.694] | 2.379 [2.368, 2.407] |
| 8 | 1/1024 | 4.135 [4.109, 4.197] | 2.746 [2.723, 2.772] |
| 8 | always | 4.612 [4.579, 4.650] | 309.825 [301.489, 316.003] |

The deeper no-throw path favors native unwinding without per-call flag checks;
frequent throws strongly favor explicit returns. The depth-eight explicit arm
also changes performance across frequency populations, so do not infer a fixed
per-call cost from these rows. They justify keeping the existing convention for
bring-up, not permanently ruling out native EH. Future choices require the actual
`exceptions` fixture, finally/rethrow/virtual-raising correctness, tier/spread
reports, code size and startup in the real lane.

An erased-array kernel stores 40,000 varying small integers into a GC anyref
backing array, then reads/unboxes and sums them in a second loop. Each sample
repeats that 100 times; seven interleaved repeats follow 100 warmups. It compares
allocation-free i31 payloads with f64 GC boxes using identical array accesses.

- i31: median 13.018 ms; range [12.525, 13.760]; max/min 1.10.
- boxed_f64: median 22.373 ms; range [19.485, 25.771]; max/min 1.32.

The boxed spread includes collection and allocation and is too wide for a precise
speedup claim. This population includes no mixed tags, negative zero, large
numbers, imports or compiler output. It makes i31 a prototype worth testing,
not a general V8 performance guarantee. Both kernels verify checksums and time
work inside wasm; they make no per-element JS boundary calls. The first shorter
run was discarded as a decision instrument because warmup and sample size were
inadequate. A quiet repeat is requested if this evidence is used beyond exploratory
representation selection in M2; no quiet window is requested for the current
exploratory boxing probe. The design uses i31 for small integers, with boxed f64 otherwise;
the real M2 erasure benchmarks decide the representation's performance.

Raw scripts, dumps and JSON are retained for review under
`/home/akisarou/.cache/nts-parallel-20261004/mainctl/wasm-evidence/`:
`node-features.mjs`, `modern-eh.mjs`, `kernels.mjs`, `kernels.json`,
`cfg-audit.py`, `cfg-audit.json` and the named `.hir` files. Script SHA-256 for the measured kernels:
`71d948ea87ff828bfd34ad510e653f5a56a0ae9295d447db2fb3717599422aff`.
These are local M0
experiments, not compiler implementation or gate tests. The reviewed M1 work
will add durable probes/fixtures under the owned wasm paths.

### Follow-up: no-throw hot paths and the Node arm

This corrected table is exploratory; explicit raising is settled for M1.
The follow-up kernel explicitly compares calls **outside try** and **inside
try**, both with no throws. It also measures rare throws, every-call throws and
a declared hot-path mix. Node/V8 versions and flags are unchanged. Each of the
three arms warms for at least 600 ms; seven interleaved samples reverse arm order
on successive rounds. Checksums are verified before warmup and after every
sample. Forwarders are distinct static direct calls in both wasm and JS, allowing
each compiler to choose inlining; the initial JS closure-forwarder variant is
retained as rejected evidence, because its call shape was different.

The JS arm uses `throw new Error('kernel')` with the negative-i result in a
`value` property. It includes Error allocation; the native wasm arm throws an
i32 tag payload, and the explicit arm stores flag/payload globals. They do not
create a JS Error or reproduce its stack. This is an instruction/convention
experiment, not the required same-TS-source benchmark of a compiled Error object.
A realistic mix below is a **synthetic model**, not a measured application trace:
15/16 of calls are outside try, 1/16 inside, with exactly one throw per 30,000
iterations (one per 1,875 inside-try calls in this finite population). The rare
all-inside case uses mask 1023, giving 29 throws per 30,000 iterations. Frequency
labels describe this finite population; they are not production workload claims.

Cells show **median ns per seed iteration [min, max] (max/min spread)**. Every
ordinary sample contains 30 million iterations. For the always-throw case,
explicit samples contain 30 million, native 3 million and JS 90,000 iterations;
batch counts differ to keep native/JS Error runs practical and explicit timings
above a few milliseconds. All arms use the identical 30,000-iteration kernel and
verified integer checksum; raw JSON includes absolute ms, counts and all samples.
Depth counts the seed plus forwarders, not an assumed number of residual machine
calls after optimization.

| Depth | Path/population | Explicit | Native wasm EH | Plain JS, Error |
| ---: | --- | ---: | ---: | ---: |
| 1 | outside-never | 0.343 [0.341, 0.345] (1.01) | 0.327 [0.323, 0.331] (1.02) | 0.766 [0.755, 0.794] (1.05) |
| 1 | inside-never | 0.339 [0.338, 0.346] (1.02) | 0.363 [0.362, 0.368] (1.02) | 0.757 [0.755, 0.760] (1.01) |
| 1 | inside-rare | 0.352 [0.350, 0.356] (1.02) | 0.435 [0.433, 0.438] (1.01) | 2.439 [2.433, 2.487] (1.02) |
| 1 | inside-always | 0.515 [0.515, 0.534] (1.04) | 70.472 [70.211, 70.999] (1.01) | 1725.665 [1721.991, 1733.993] (1.01) |
| 1 | mixed-synthetic | 0.597 [0.591, 0.604] (1.02) | 0.434 [0.430, 0.444] (1.03) | 1.405 [1.403, 1.439] (1.03) |
| 8 | outside-never | 2.610 [2.563, 2.756] (1.08) | 0.810 [0.808, 0.812] (1.01) | 0.757 [0.754, 0.759] (1.01) |
| 8 | inside-never | 2.932 [2.738, 3.129] (1.14) | 0.795 [0.793, 0.797] (1.00) | 0.757 [0.755, 0.781] (1.03) |
| 8 | inside-rare | 1.420 [1.366, 1.923] (1.41) | 0.908 [0.907, 0.911] (1.00) | 3.645 [3.641, 3.708] (1.02) |
| 8 | inside-always | 1.538 [1.530, 1.545] (1.01) | 102.121 [100.815, 102.322] (1.01) | 2379.635 [2376.491, 2385.583] (1.00) |
| 8 | mixed-synthetic | 3.193 [2.946, 3.270] (1.11) | 1.358 [1.327, 1.422] (1.07) | 1.426 [1.425, 1.431] (1.00) |

The deepest no-throw cases favor native EH both inside and outside try; JS can
inline these trivial direct calls too and is slightly faster than native wasm in
that population. Per-call explicit checks are a material hot-path cost, so the
throw-heavy row must not dominate the architecture choice when real programs
rarely throw. The modeled mix also favors native over explicit at depth eight;
its native median is close to JS and its spread prevents a precise claim of a
win over Node. Conversely, actually throwing on every call strongly favors
explicit returns, with native unwinding much cheaper than allocating a JS Error.
The explicit rare-throw depth-eight spread remains 1.41 and its cost changes
between frequency populations. Per MainClaude's follow-up, no quiet window or
further timing is requested for this microprobe: it cannot change the M1 decision.
Repeat the comparison in M2 on real emitted code, in a quiet window MainClaude
will arrange, with the same plain-JS Error arm and all medians and spreads.

Native tag-payload throw costs are within the JS Error arm's costs for both rare
and every-call throwing. Prioritize native EH in M2 as the **eventual single default**
once a region-aware core contract permits correct lowering; dominant no-throw
paths weigh heavily in that choice. Keep explicit raising for M1 under the later
M0 approval because prepared HIR lacks that contract and native unwinding would
not preserve handlers/finalizers. Confirm the eventual choice in M2 with the
same actual TS workload in Node and nts, equal thrown-value/stack semantics,
measured throw distributions, correctness, size and startup. No hybrid is
proposed; a real benchmark must demonstrate the need before adding another
convention. This kernel is not a general compiler speedup claim.

Evidence: `exception-paths.mjs`, `exception-paths.json` and
`exception-paths.log` in the same local evidence directory; script SHA-256:
`9cada9b88e147fbfd296eceaa6d8e2dcc4b72ba43a20027c498f75a7744f3f15`. The rejected closure-forwarder run is
kept as `exception-paths-closure-forwarders.{mjs,json,log}` for audit.

## Encoding, validation and dependency proposal

Create `compiler/codegen/wasm` with separate type/host planning, support checking,
CFG structuring, body emission, runtime helper resolution and JS glue generation.
Expose an `Emitted` result containing bytes, import/export metadata, source origins
and diagnostics. Do not publish bytes when a required reachable root/initializer
is declined or when validation fails. Publish selected complete products rather
than a module with silently absent callees, globals or dispatch bodies.

Recommend [wasm-encoder](https://docs.rs/wasm-encoder/latest/wasm_encoder/) for
section/instruction binary encoding, plus a narrow origin-aware builder inside
the backend. The crate has GC structs/arrays, subtype/rec-group support, names,
tags and `call_ref` encodings. Start without a separate wasm-emitter crate:
encoding is already isolated by the dependency; split only when a genuine reusable
reader/writer boundary emerges. Keep the builder independent of HIR value IDs.

Proposed new dependencies, **none installed or added in M0**:

| Dependency | Scope and approval proposal |
| --- | --- |
| `wasm-encoder` 0.261.0 | Direct binary encoding in the wasm backend; propose this inspected release, pin through Cargo.lock and confirm MSRV/features before adding |
| `wasmparser` 0.261.0 | Validation in emission and tests, with an explicit feature set; same release family as encoder |
| `wasmprinter` matching release | Optional developer/test disassembly; defer unless raw validation diagnostics need it |
| `wasm-tools` | Optional inspect/component packaging tool in M4; no dependency for M1 users |
| Binaryen `wasm-opt` | Optional post-pass in M2, pinned version only after measured benefit; never needed to make an emitted module valid |
| Wasmtime | Candidate M4 engine, not an M1 dependency; version/GC/component compatibility still unprobed |
| npm packages | None for M1; generated hosts use platform JS APIs and Node builtins |

Use [wasmparser's validator](https://docs.rs/wasmparser/latest/wasmparser/struct.Validator.html)
with GC, typed function references, reference types, multivalue and the chosen EH
features enabled; disallow unrelated proposals rather than inheriting future
library defaults. Run it on every emitted module, then instantiate the identical
bytes on the target Node engine with the exact compile options. Core validation
does not supply JS builtins/imports or prove correct helper signatures.

Validate import/export manifests, global initialization and all concrete dispatch
slots separately. Required helper signatures are derived from physical HIR types
and helper contracts, not C pointer widths. Validation/link failures are compiler
integrity failures, never expected declines. Optional wasm-opt must preserve
Origins/debug mapping or explicitly produce remapping, then undergo validation
and differential checking again. Include function/local/type/field names in a
name section; strip it only in a measured shipping profile.

## Host import surface and generated JS

The manifest lists only transitively used imports. Separate semantic helper
resolution from the final imports: a helper may lower to wasm instructions,
a GC helper function or a host builtin without acquiring a host call.
Recommended namespaces: `wasm:js-string` for recognized builtins,
`nts:constants` for immutable string globals, `nts:host/v1` for platform calls.
A build/ABI version covers selected representation, tag numbering, callable
signatures and feature requirements. No process-global object handle registry.

| Boundary | Required data/method | Crossing budget |
| --- | --- | --- |
| Entry/export | Typed scalar/string args and result; later opaque compiled-object handles | One JS→wasm call per coarse operation; no wrapper call for each arithmetic op |
| Builtin string primitive | externref plus scalar offsets/result | One builtin invocation, zero user-JS glue callbacks; still count it separately from local instructions |
| Missing string/math primitive | Captured native JS operation | One wasm→JS call; no string encoding/copy |
| Host object/Web API member | externref receiver/arguments; generated direct member call | One import per actual API operation; store/reference pass costs zero host calls |
| Foreign callback | Stable generated trampoline, wasm closure reference, owner instance | One re-entry per callback; memoize wrapper identity and explicitly own registration/unregistration |
| Scheduling, later | Typed reaction/task plus host queue operation | One enqueue/completion crossing; no extra microtask per internal arithmetic step |
| WASI string/list/resource, later | Canonical ABI transfer/resource lifetime | Explicit boundary bytes/resources; no claimed zero-copy strings |

Load module bytes with `WebAssembly.compile(bytes, {builtins: ['js-string']})`,
then instantiate with the generated manifest imports. Require a real startup probe,
not merely acceptance of an options argument, because unsupported options can be
ignored. The feature probe below verifies builtin recognition and execution.
Choose captured primitives once per instance/host to avoid accidental mutable
`globalThis` dispatch. Run module initialization once before publishing exports;
M5 must respect ESM/microtask ordering as specified by `docs/async.md`.

GC structs are opaque to ordinary JS; JS arrays/records cannot become mutable GC
arrays/records by a free reference cast. Keep host-owned DOM/JS objects as
externref and generated member imports. Keep compiled objects as GC objects with
explicit opaque handles/accessors at public boundaries. Do not silently copy a
JS object/array and lose aliasing, cycles or mutations. A transparent plain-JS
object/module ABI requires a separately reviewed identity-preserving bridge and
is outside M1. Unsupported public input/output shapes refuse by name. The
comparison harness may serialize observations through generated accessors, but
that is not a promise of transparent JS-object interoperability.

M1 host imports are only mapped primitives, constants, logging/failure reporting
and the differential harness surface. General foreign calls decline. Later JS
bindings must route host-thrown values into the same raising convention and
preserve try/finally; JS imports throwing through explicit-HIR handlers without
an adapter are incorrect. Compiler traps remain integrity failures. Async
lowering stays ours; native host Promise adapters and microtask integration are
separate correctness work, not a dependency on JSPI.

### Startup probe (10 lines)

Executed without flags on Node v24.20.0 / V8 13.6.233.17-node.53:

```js
const sec=(id,x)=>[id,x.length,...x], str=s=>[s.length,...Buffer.from(s)], mod=(...s)=>new Uint8Array([0,97,115,109,1,0,0,0,...s.flat()]);
const fun=x=>sec(10,[1,x.length+1,0,...x]), exp=(name,kind,index)=>sec(7,[1,...str(name),kind,index]);
const gc=mod(sec(1,[2,95,1,127,1,96,0,1,127]),sec(3,[1,1]),exp('run',0,0),fun([65,42,251,0,0,251,2,0,0,11]));
const strings=mod(sec(1,[1,96,1,111,1,127]),sec(2,[1,...str('wasm:js-string'),...str('length'),0,0]),exp('length',0,0));
const eh=mod(sec(1,[2,96,1,127,0,96,0,0]),sec(3,[1,1]),sec(13,[1,0,0]),sec(7,[2,...str('run'),0,0,...str('tag'),4,0]),fun([65,42,8,0,11]));
console.log(JSON.stringify({node:process.version,v8:process.versions.v8,gc:new WebAssembly.Instance(await WebAssembly.compile(gc)).exports.run()}));
const sm=await WebAssembly.compile(strings,{builtins:['js-string']}); console.log(JSON.stringify({stringImports:WebAssembly.Module.imports(sm),utf16Length:new WebAssembly.Instance(sm).exports.length('A😀B')}));
try{await WebAssembly.instantiate(strings,{});console.log('ERROR: missing builtin accepted')}catch(e){console.log('withoutBuiltins='+e.name)}
const e=new WebAssembly.Instance(await WebAssembly.compile(eh)); try{e.exports.run()}catch(x){console.log(JSON.stringify({wasmException:x instanceof WebAssembly.Exception,tag:x.is(e.exports.tag),payload:x.getArg(e.exports.tag,0)}))}
console.log('sha256='+await import('node:crypto').then(c=>c.createHash('sha256').update(Buffer.concat([gc,strings,eh])).digest('hex')));
```

Exact observed results:

```text
{"node":"v24.20.0","v8":"13.6.233.17-node.53","gc":42}
{"stringImports":[],"utf16Length":4}
withoutBuiltins=TypeError
{"wasmException":true,"tag":true,"payload":42}
sha256=322d3b5d762cb2d95fb2e54b1e4042234e111c3dc369b57f174f7e9576fa3d02
```

`stringImports: []` proves recognition of the builtin import, rather than an
ignored compile option plus supplied polyfill. The negative control had no
builtin option and no import namespace. A separate native-EH probe compiled and
executed both `try_table` with a tagged catch and `catch_ref` with an exnref stack
value; each returned 42. No browser or WASI engine was probed.

## Runtime-helper inventory and coverage rule

There are 283 literal names in the scalar conversion table `hir/runtime.rs`.
It is **not** the entire runtime: non-scalar helpers such as `nts_raise` and
`nts_promise_new` need no row there. A comment-stripped lexical scan of callable
`nts_*` identifiers in `runtime/c/nts_runtime.h` finds 503 names across its
conditional declarations and inline bodies; case-conversion declarations generated
by macros contribute two additional names from the scalar table. The union is
505 names. The appendix inventories this conservative name population, not a
claim that every identifier is an externally linked function or a HIR caller.
Future generated/dynamic helpers require additional classification too.

The M1 subset includes numeric/coercion predicates, string helpers and formatting,
ordinary arrays, erased-value tags/tests/conversions, class/closure metadata,
TDZ/failure reporting and raising state. Exclude Promise/scheduler, symbols,
Map/Table/Set, buffer/view/DataView, native allocation/ownership, all foreign
families, native frame-storage helpers and tagged-template reflection. Optional
field presence is a named M1 decline until a GC representation preserves its
separate presence bit; null storage is not proof of property absence.

Each appendix M1 name has one of four implementation categories:
`numeric`, `string`, `array`, `value/control`. `_fn` aliases share semantics,
not duplicate implementations. Each is a planned contract, with checked scalar
arguments even when C's runtime signature currently uses f64/u64 for an index.
An `_into` native-frame helper is not silently treated as ordinary concat; that
provider transformation must be absent under HostGc. Unknown external names,
including names without `nts_`, decline unless explicitly bound to a supported
contract (for example sqrt/floor/ceil/fabs/trunc).

Implementation coverage rule: keep a literal `Support` catalog for each known
helper, with `Intrinsic`, `WasmHelper`, `HostImport` or `Decline(reason)`, and a
checked physical signature. Tests assert coverage against
`runtime::declared_names()` **and** a header-declaration inventory generated by
the same clang-oracle approach as the existing signature test, with conditional
families represented in a checked source manifest. Do not make missing entries
pass by assigning a generic default decline in that test. Also enumerate actual
external calls in prepared fixtures/runtime corpora, including synthesized names.
A new helper must make a test fail until it receives a named support decision.

Do not use the scalar signature table as a full GC type schema: its `None`
positions intentionally omit the managed/non-scalar type. Backend helper planning
must check actual HIR arguments/results and the semantic contract. Full typed
shared helper IDs/signatures would be a useful core-owned follow-up; until then
keep the fifth map mechanical and drift-tested. Adding it does not require changing
other backends' behavior.

## Correctness instruments and gate integration

Initially run the wasm lane manually, outside the shared gate. Coordinate small
edits to `Backend`, CLI/check, workspace members and `agree.mjs`; adding an enum
variant must not cause existing `Backend::ALL` loops to gate an unstable lane.
Do not add wasm to required gate selections until it satisfies the acceptance
line and MainClaude reviews the integration.

`nts check` must run wasm inside Node against the same TS input pool and preserve
the existing full outcome record: requested/checked cases, named compile declines,
input declines, disagreements, aborts, timeouts and unmeasured failures. A backend
compile diagnostic is not an abort and is not agreement; an arbitrary wasm trap
or missing host is not a named decline. All-example reports include every
fixture, including the ones not supported, and print the exact agreement count.

Use a proposed `NTS5001` namespace for wasm shape declines (JVM owns NTS4001),
with origin, function/operation and missing capability/type named. Add
`tooling/conformance/wasm-declines.known` with stable shape keys, reason, ownership
and an exercising fixture. New unclassified declines fail classification;
stale entries fail and get removed. Never whitelist wrong answers, invalid
modules or unresolved dispatch bodies. The precise table format should follow
the existing JVM classifier when that integration is made.

An independent `tooling/wasm` integrity runner enumerates emitted bytes, runs the
validator and Node instantiation, and verifies all referenced funcs, helper
contracts and filled callable slots. Required summary: **unverifiable 0,
unresolved 0, wrong answers 0**. Use sabotage arms: corrupted opcode, wrong
field/slot type, missing builtin, absent direct callee, incompatible callable and
a named refusal masquerading as success. This tests the instrument's ability to
fail, not merely the compiler's output.

Before each implementation review/landing: exact-path commit, format and strict
clippy, `owed.mjs --commit <sha>`, required instruments, then the coordinated
single gate with its marker. Use the isolated `wasm-target`, frontend/worker cap
of two, and partial-result files. Baseline agreement on C, LLVM, JVM and RC must
show zero regressions; a new backend's gains do not compensate for another lane's
regression. M0 has no compiler/benchmark-suite change and no wasm agreement lane;
do not report unrun gate or performance suite as passing.

## Performance plan and milestones

Node running the **same TS source** is the bar. Extend the real `nts-bench`
instrument with wasm as a named lane after correctness stabilizes. Consume the
same entry/checksum/warmup/calibration contracts; record Node/V8 versions, compiler
and artifact hashes. Run at least two paired interleaved rounds in an agreed
quiet window and report absolute medians, spread and paired ratios. Refused cases
stay visible, without a fabricated geomean over only winners.

Prioritize `loop`, `checksum`, `accumulate`, `fib`, `arrays`, `array-mutations`,
`growth-fixed`, `growth-grown`, `objects`, `dispatch`, `closures`, `closure-merge`,
`strings`, `substrings`, `case-convert`, `number-format`, `exceptions`,
`erasure-typed`, `erasure-unknown`, `erasure-stored-*` and `in-narrowing`.
Map this list to the bench instrument's discovered names rather than creating
similar substitute benchmarks. Later: generator, async ordering, JSON/Web API
streams, DOM mutation batches and React mount/update/reorder/effects.
The M2 EH experiment includes Node running the same kernel with
`throw new Error()`, besides explicit and native wasm raising. Measure mixed
`string | number` erasure, closure-thunk casts and dispatch-route counts rather
than inferring those costs from a scalar-only kernel.

Measure separately: compile, instantiate, module initialization, first call,
steady work, total process startup and GC/allocation. Publish raw/gzip bytes of
core, generated JS, optional names and required runtime, plus bytes per reachable
function/type. Provisional M1 review budgets: a scalar-only smoke module plus
loader ≤32 KiB raw; core-language support runtime plus host overhead ≤256 KiB raw,
excluding application code and optional debug names; no unused helper family in
a scalar artifact. These are falsifiable budgets to validate, not achieved sizes.
When M6 is near, compare the reported raw/gzip runtime and host bytes with the
React plus ReactDOM JS bundle for the same application.

Startup target: report cold compile/instantiate/initialize separately from Node
startup and compare a fresh-process first useful operation against importing the
same TS. A warm module cache is a distinct population. Set a numerical startup
budget after the first emitted artifacts provide a real baseline; M0 has no
artifact from which to invent one. Count string/math/DOM imports and callback
entries per benchmark to identify whether a gap is inside wasm or at the boundary.

| Milestone | Work and acceptance |
| --- | --- |
| M0 | Scan and this design; startup probes and exploratory kernels disclosed; MainClaude review before compiler code |
| M1a | Provider hook, encoder/validator, scalars, functions, globals, arbitrary CFG support, Node loader. Direct and irreducible fixtures agree or decline by name; every emitted artifact validates |
| M1b | JS strings, ordinary arrays, classes without interface dispatch, closures, erased supported values and explicit exceptions. Public boundary limitations are named |
| M1 complete | `nts emit-wasm`, Node check/glue and manual `agree` lane over **all** discovered examples: **0 wrong answers**, every emitted module validates/links, matches and named declines counted separately, every example accounted for, and **0 regressions** on C/LLVM/JVM/RC. Report exact counts and supported core-language fixtures; a lane declining everything does not meet M1 |
| M1c | Map, Set and Date, prioritized immediately after M1 and before browser work; corresponding fixtures agree with Node and validate/link |
| M2 | Real nts-bench paired rows versus Node, size/startup and boundary-call counts; fix measured gaps at their root, including structuring, boxing and dispatch; prioritize the shared exception-region contract and native EH experiment |
| M3 | Browser adapter and generated DOM/Web API bindings; native host URL/fetch/streams when compatible; identity, callback and microtask tests plus measured DOM boundary costs |
| M4 | WASI 0.2 CLI component with gc-utf16 specialization, canonical adapter/resources and verified engine compatibility; CLI output/exception/resource/encoding fixtures agree |
| M5 | Settled interface dispatch plus full async/generators, including the observed irreducible resume graph; mixed JS/wasm microtask, finally, rejection and generator-protocol traces match |
| M6 | Compile this repo's React and application code once their native blockers clear; upstream behavioral oracle and same-app JS/wasm benchmarks decide every performance claim |

Reviewed decisions: shared HostGc, wasm-encoder plus wasmparser 0.261.0,
explicit raising for M1, host-specific binaries, provisional size budgets and
the M1 public boundary scope are approved. Pin the dependencies in Cargo.lock
and check their license/MSRV against workspace policy before implementation.
Optional-field presence must follow the upcoming core initialization/absence
contract; ask the core owner when implementing it rather than adding a wasm-only
presence convention. Keep wasm out of every existing `Backend::ALL` gate loop
and show that invariant in the M1a review.
Dispatch/erasure optimizations remain measured choices, not claims derived from
target features. M0 was documentation-only; the current scoped shared changes
and their validation are recorded in the M1a section above.

## Appendix: complete helper-name classification at the scanned revision

`M1` is a planned implementation obligation, not current support. `Decline`
entries remain in the catalog with the concrete reason shown. M1 array helpers
are conditional on supported element types and semantics; e.g. bigint/reflection
or native storage does not become supported because its name shares a prefix.

| Helper | M1 category or decline reason |
| --- | --- |
| `nts_alloc` | Decline: native memory/provider contract |
| `nts_append_slot` | Decline: native memory/provider contract |
| `nts_array_at` | M1 array |
| `nts_array_at_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_at_ref` | M1 array |
| `nts_array_at_value` | M1 array |
| `nts_array_concat` | M1 array |
| `nts_array_concat_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_concat_ref` | M1 array |
| `nts_array_concat_value` | M1 array |
| `nts_array_element` | M1 array |
| `nts_array_extend` | M1 array |
| `nts_array_extend_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_extend_ref` | M1 array |
| `nts_array_fill` | M1 array |
| `nts_array_fill_bool` | M1 array |
| `nts_array_fill_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_fill_from_nsarray` | Decline: foreign/native ABI or ownership |
| `nts_array_fill_ref` | M1 array |
| `nts_array_fill_strings_from_nsarray` | Decline: foreign/native ABI or ownership |
| `nts_array_from_handles` | Decline: foreign/native ABI or ownership |
| `nts_array_handles` | Decline: foreign/native ABI or ownership |
| `nts_array_includes` | M1 array |
| `nts_array_includes_ref` | M1 array |
| `nts_array_includes_str` | M1 array |
| `nts_array_includes_str_value` | M1 array |
| `nts_array_index_of` | M1 array |
| `nts_array_index_of_ref` | M1 array |
| `nts_array_index_of_str` | M1 array |
| `nts_array_index_of_str_value` | M1 array |
| `nts_array_join_num` | M1 array |
| `nts_array_join_str` | M1 array |
| `nts_array_keep_first` | M1 array |
| `nts_array_last_index_of` | M1 array |
| `nts_array_length` | M1 array |
| `nts_array_new` | M1 array |
| `nts_array_new_uninitialized` | M1 array |
| `nts_array_of_numbers` | M1 array |
| `nts_array_of_values` | M1 array |
| `nts_array_pop` | M1 array |
| `nts_array_pop_ref` | M1 array |
| `nts_array_pop_value` | M1 array |
| `nts_array_push` | M1 array |
| `nts_array_push_ref` | M1 array |
| `nts_array_push_value` | M1 array |
| `nts_array_reverse` | M1 array |
| `nts_array_reverse_ref` | M1 array |
| `nts_array_set_length` | M1 array |
| `nts_array_set_length_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_set_length_ref` | M1 array |
| `nts_array_set_length_value` | M1 array |
| `nts_array_shift` | M1 array |
| `nts_array_shift_ref` | M1 array |
| `nts_array_shift_value` | M1 array |
| `nts_array_slice` | M1 array |
| `nts_array_slice_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_slice_ref` | M1 array |
| `nts_array_sort_str` | M1 array |
| `nts_array_splice` | M1 array |
| `nts_array_splice_ref` | M1 array |
| `nts_array_to_string` | M1 array |
| `nts_array_unlend` | Decline: native/string-buffer boundary |
| `nts_array_unshift` | M1 array |
| `nts_array_unshift_ref` | M1 array |
| `nts_array_writable` | M1 array |
| `nts_assertion_failed` | M1 value/control |
| `nts_bigint_as_intn` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_as_uintn` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_box` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_compare_string` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_from_number` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_shl` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_shr` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_to_string` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_unbox` | Decline: bigint/symbol/date/promise family |
| `nts_block_carry` | Decline: foreign/native ABI or ownership |
| `nts_block_unlend` | Decline: foreign/native ABI or ownership |
| `nts_bool_to_string` | M1 string |
| `nts_bound_function_to_string` | M1 value/control |
| `nts_bounds` | M1 value/control |
| `nts_boxed_new` | Decline: native memory/provider contract |
| `nts_boxed_unlend` | Decline: native memory/provider contract |
| `nts_buffer_byte_length` | Decline: buffer/view/DataView representation |
| `nts_buffer_detached` | Decline: buffer/view/DataView representation |
| `nts_buffer_max_byte_length` | Decline: buffer/view/DataView representation |
| `nts_buffer_new` | Decline: buffer/view/DataView representation |
| `nts_buffer_new_resizable` | Decline: buffer/view/DataView representation |
| `nts_buffer_resizable` | Decline: buffer/view/DataView representation |
| `nts_buffer_resize` | Decline: buffer/view/DataView representation |
| `nts_buffer_slice` | Decline: buffer/view/DataView representation |
| `nts_buffer_transfer` | Decline: buffer/view/DataView representation |
| `nts_callback_enter` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callback_leave` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callback_task` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callbacks_return_to_loop_when` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_cancel_delayed` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_cell_unready` | M1 value/control |
| `nts_check` | M1 value/control |
| `nts_check_fn` | M1 value/control |
| `nts_check_or_grow` | M1 value/control |
| `nts_check_or_grow_fn` | M1 value/control |
| `nts_checkpoint` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_checkpoint_after_callbacks` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_clear_timeout` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_closure_lend` | Decline: foreign/native ABI or ownership |
| `nts_closure_lend_once` | Decline: foreign/native ABI or ownership |
| `nts_closure_notify` | Decline: foreign/native ABI or ownership |
| `nts_closure_unlend` | Decline: foreign/native ABI or ownership |
| `nts_closure_unlend_once` | Decline: foreign/native ABI or ownership |
| `nts_closures_owed` | Decline: foreign/native callback lifecycle |
| `nts_collect_cycles` | Decline: native memory/provider contract |
| `nts_collection_epoch` | Decline: native memory/provider contract |
| `nts_com_addref` | Decline: foreign/native ABI or ownership |
| `nts_com_answer` | Decline: foreign/native ABI or ownership |
| `nts_com_answer_string` | Decline: foreign/native ABI or ownership |
| `nts_com_base` | Decline: foreign/native ABI or ownership |
| `nts_com_carry` | Decline: foreign/native ABI or ownership |
| `nts_com_compose` | Decline: foreign/native ABI or ownership |
| `nts_com_compose_named` | Decline: foreign/native ABI or ownership |
| `nts_com_delegate` | Decline: foreign/native ABI or ownership |
| `nts_com_delegates` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_addref` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_base` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_iids` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_instance` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_name` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_query` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_release` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_trust` | Decline: foreign/native ABI or ownership |
| `nts_com_query` | Decline: foreign/native ABI or ownership |
| `nts_com_query_array` | Decline: foreign/native ABI or ownership |
| `nts_com_register` | Decline: foreign/native ABI or ownership |
| `nts_com_release` | Decline: foreign/native ABI or ownership |
| `nts_com_release_array` | Decline: foreign/native ABI or ownership |
| `nts_com_releases` | Decline: foreign/native ABI or ownership |
| `nts_com_state` | Decline: foreign/native ABI or ownership |
| `nts_com_take` | Decline: foreign/native ABI or ownership |
| `nts_com_unlend` | Decline: foreign/native ABI or ownership |
| `nts_concat` | M1 string |
| `nts_concat_into` | Decline: native frame-storage helper |
| `nts_console_write` | M1 value/control |
| `nts_counted_allocations` | Decline: native memory/provider contract |
| `nts_counted_releases` | Decline: native memory/provider contract |
| `nts_counted_retains` | Decline: native memory/provider contract |
| `nts_counting_reset` | Decline: native memory/provider contract |
| `nts_cstring_release` | Decline: foreign/native ABI or ownership |
| `nts_cstrings_release` | Decline: foreign/native ABI or ownership |
| `nts_cycle_candidates` | Decline: native memory/provider contract |
| `nts_dataview_buffer` | Decline: buffer/view/DataView representation |
| `nts_dataview_byte_length` | Decline: buffer/view/DataView representation |
| `nts_dataview_byte_offset` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_bigint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_biguint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_float32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_float64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int16` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int8` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint16` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint8` | Decline: buffer/view/DataView representation |
| `nts_dataview_over` | Decline: buffer/view/DataView representation |
| `nts_dataview_part` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_bigint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_biguint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_float32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_float64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int16` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int8` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint16` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint8` | Decline: buffer/view/DataView representation |
| `nts_date_new` | Decline: bigint/symbol/date/promise family |
| `nts_date_value` | Decline: bigint/symbol/date/promise family |
| `nts_decode_uri` | M1 string |
| `nts_delay` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_dictionary_fill_from_nsdictionary` | Decline: foreign/native ABI or ownership |
| `nts_dictionary_fill_strings_from_nsdictionary` | Decline: foreign/native ABI or ownership |
| `nts_encode_uri` | M1 string |
| `nts_enqueue_job` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enqueue_microtask` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enqueue_tick` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enter` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_environment_create` | Decline: native memory/provider contract |
| `nts_environment_current` | Decline: native memory/provider contract |
| `nts_environment_destroy` | Decline: native memory/provider contract |
| `nts_environment_enter` | Decline: native memory/provider contract |
| `nts_environment_has_platform` | Decline: native memory/provider contract |
| `nts_environment_install_platform` | Decline: native memory/provider contract |
| `nts_environment_leave` | Decline: native memory/provider contract |
| `nts_environment_platform` | Decline: native memory/provider contract |
| `nts_function_name` | M1 value/control |
| `nts_function_to_string` | M1 value/control |
| `nts_gobject_boxed` | Decline: foreign/native ABI or ownership |
| `nts_gobject_boxed_copy` | Decline: foreign/native ABI or ownership |
| `nts_gobject_boxed_new` | Decline: foreign/native ABI or ownership |
| `nts_gobject_is_boxed` | Decline: foreign/native ABI or ownership |
| `nts_gobject_made` | Decline: foreign/native ABI or ownership |
| `nts_gobject_state` | Decline: foreign/native ABI or ownership |
| `nts_handle_check` | Decline: foreign/native ABI or ownership |
| `nts_handle_family_register` | Decline: foreign/native ABI or ownership |
| `nts_has_pending_work` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_host_checkpoint_end` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_host_install` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_hresult_message` | Decline: foreign/native ABI or ownership |
| `nts_hstring_release` | Decline: foreign/native ABI or ownership |
| `nts_hstrings_release` | Decline: foreign/native ABI or ownership |
| `nts_in_callback` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_index` | M1 value/control |
| `nts_index_fn` | M1 value/control |
| `nts_is_array` | M1 value/control |
| `nts_is_buffer` | Decline: buffer/view/DataView representation |
| `nts_is_class` | M1 value/control |
| `nts_is_data_view` | Decline: buffer/view/DataView representation |
| `nts_is_date` | Decline: bigint/symbol/date/promise family |
| `nts_is_finite` | M1 numeric |
| `nts_is_integer` | M1 numeric |
| `nts_is_map` | Decline: Map/Table/Set runtime |
| `nts_is_owner_thread` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_is_promise` | Decline: bigint/symbol/date/promise family |
| `nts_is_safe_integer` | M1 numeric |
| `nts_is_set` | Decline: Map/Table/Set runtime |
| `nts_is_view_kind` | Decline: buffer/view/DataView representation |
| `nts_landing_detail` | Decline: native setjmp landing state |
| `nts_landing_pop` | Decline: native setjmp landing state |
| `nts_landing_push` | Decline: native setjmp landing state |
| `nts_landing_thrown` | Decline: native setjmp landing state |
| `nts_leave` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_live_bytes` | Decline: native memory/provider contract |
| `nts_live_count` | Decline: native memory/provider contract |
| `nts_map_clear` | Decline: Map/Table/Set runtime |
| `nts_map_copy` | Decline: Map/Table/Set runtime |
| `nts_map_delete` | Decline: Map/Table/Set runtime |
| `nts_map_extend` | Decline: Map/Table/Set runtime |
| `nts_map_get` | Decline: Map/Table/Set runtime |
| `nts_map_has` | Decline: Map/Table/Set runtime |
| `nts_map_key_at` | Decline: Map/Table/Set runtime |
| `nts_map_keys_str` | Decline: Map/Table/Set runtime |
| `nts_map_new` | Decline: Map/Table/Set runtime |
| `nts_map_next` | Decline: Map/Table/Set runtime |
| `nts_map_set` | Decline: Map/Table/Set runtime |
| `nts_map_value_at` | Decline: Map/Table/Set runtime |
| `nts_math_acos` | M1 numeric |
| `nts_math_asin` | M1 numeric |
| `nts_math_atan` | M1 numeric |
| `nts_math_atan2` | M1 numeric |
| `nts_math_cbrt` | M1 numeric |
| `nts_math_cos` | M1 numeric |
| `nts_math_cosh` | M1 numeric |
| `nts_math_exp` | M1 numeric |
| `nts_math_expm1` | M1 numeric |
| `nts_math_fround` | M1 numeric |
| `nts_math_hypot` | M1 numeric |
| `nts_math_imul` | M1 numeric |
| `nts_math_log` | M1 numeric |
| `nts_math_log10` | M1 numeric |
| `nts_math_log1p` | M1 numeric |
| `nts_math_log2` | M1 numeric |
| `nts_math_pow` | M1 numeric |
| `nts_math_sign` | M1 numeric |
| `nts_math_sin` | M1 numeric |
| `nts_math_sinh` | M1 numeric |
| `nts_math_tan` | M1 numeric |
| `nts_math_tanh` | M1 numeric |
| `nts_max` | M1 numeric |
| `nts_max_fn` | M1 numeric |
| `nts_min` | M1 numeric |
| `nts_min_fn` | M1 numeric |
| `nts_no_arm` | M1 value/control |
| `nts_no_arm_of` | M1 value/control |
| `nts_nsarray_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsarray_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsdictionary_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsdictionary_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsset_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsset_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsstring_of` | Decline: foreign/native ABI or ownership |
| `nts_number_to_fixed` | M1 string |
| `nts_number_to_string` | M1 string |
| `nts_number_to_string_into` | Decline: native frame-storage helper |
| `nts_number_to_string_radix` | M1 string |
| `nts_objc_adopt` | Decline: foreign/native ABI or ownership |
| `nts_objc_register_class` | Decline: foreign/native ABI or ownership |
| `nts_objc_state` | Decline: foreign/native ABI or ownership |
| `nts_object_new` | Decline: native memory/provider contract |
| `nts_object_to_string` | M1 value/control |
| `nts_parse_float` | M1 numeric |
| `nts_parse_int` | M1 numeric |
| `nts_pending_begin` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_pending_count` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_pending_end` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_permanent_count` | Decline: native memory/provider contract |
| `nts_post_delayed` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_post_from_any_thread` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_post_task` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_presence_clear` | Decline: optional-field presence representation |
| `nts_presence_clear_fn` | Decline: optional-field presence representation |
| `nts_presence_has` | Decline: optional-field presence representation |
| `nts_presence_has_fn` | Decline: optional-field presence representation |
| `nts_presence_has_value` | Decline: optional-field presence representation |
| `nts_presence_init` | Decline: optional-field presence representation |
| `nts_presence_init_fn` | Decline: optional-field presence representation |
| `nts_presence_set` | Decline: optional-field presence representation |
| `nts_presence_set_fn` | Decline: optional-field presence representation |
| `nts_promise_adopt` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_all` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_claim` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_number` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_pointer` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_reference` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_tagged` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_void` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_is_rejected` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_join` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_new` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_number` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_pair` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_pointer` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_race` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reason` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reference` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_error` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_with` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_resolve_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_state` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_subscribe` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_raise` | M1 value/control |
| `nts_raise_take` | M1 value/control |
| `nts_raising` | M1 value/control |
| `nts_refused` | M1 value/control |
| `nts_register_holders` | Decline: native memory/provider contract |
| `nts_release` | Decline: native memory/provider contract |
| `nts_retain` | Decline: native memory/provider contract |
| `nts_round` | M1 numeric |
| `nts_round_fn` | M1 numeric |
| `nts_set_add` | Decline: Map/Table/Set runtime |
| `nts_set_new` | Decline: Map/Table/Set runtime |
| `nts_set_timeout` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_shl` | M1 numeric |
| `nts_shr` | M1 numeric |
| `nts_slot_or_grow` | M1 value/control |
| `nts_slot_or_grow_fn` | M1 value/control |
| `nts_str_alloc` | M1 string |
| `nts_str_append` | M1 string |
| `nts_str_at` | M1 string |
| `nts_str_at_into` | Decline: native frame-storage helper |
| `nts_str_char_at` | M1 string |
| `nts_str_char_at_into` | Decline: native frame-storage helper |
| `nts_str_char_code_at` | M1 string |
| `nts_str_char_code_at_fn` | M1 string |
| `nts_str_char_code_at_int` | M1 string |
| `nts_str_char_code_at_int_fn` | M1 string |
| `nts_str_code_point_at` | M1 string |
| `nts_str_ends_with` | M1 string |
| `nts_str_includes` | M1 string |
| `nts_str_index_of` | M1 string |
| `nts_str_index_of_from` | M1 string |
| `nts_str_is_well_formed` | M1 string |
| `nts_str_last_index_of` | M1 string |
| `nts_str_pad_end` | M1 string |
| `nts_str_pad_start` | M1 string |
| `nts_str_point_width` | M1 string |
| `nts_str_raw` | M1 string |
| `nts_str_relative_at` | M1 string |
| `nts_str_repeat` | M1 string |
| `nts_str_replace` | M1 string |
| `nts_str_replace_all` | M1 string |
| `nts_str_slice` | M1 string |
| `nts_str_slice_into` | Decline: native frame-storage helper |
| `nts_str_split` | M1 string |
| `nts_str_starts_with` | M1 string |
| `nts_str_substring` | M1 string |
| `nts_str_substring_general` | M1 string |
| `nts_str_substring_into` | Decline: native frame-storage helper |
| `nts_str_substring_into_fn` | Decline: native frame-storage helper |
| `nts_str_to_lower_case` | M1 string |
| `nts_str_to_number` | M1 string |
| `nts_str_to_upper_case` | M1 string |
| `nts_str_to_well_formed` | M1 string |
| `nts_str_trim` | M1 string |
| `nts_str_trim_end` | M1 string |
| `nts_str_trim_start` | M1 string |
| `nts_string_cmp` | M1 string |
| `nts_string_copy_hstring` | Decline: WinRT HSTRING boundary |
| `nts_string_eq` | M1 string |
| `nts_string_from_char_code` | M1 string |
| `nts_string_from_char_code_into` | Decline: native frame-storage helper |
| `nts_string_from_code_point` | M1 string |
| `nts_string_from_code_point_into` | Decline: native frame-storage helper |
| `nts_string_from_cstring` | Decline: native/string-buffer boundary |
| `nts_string_from_hstring` | Decline: WinRT HSTRING boundary |
| `nts_string_from_required_cstring` | Decline: native/string-buffer boundary |
| `nts_string_from_required_view` | Decline: native/string-buffer boundary |
| `nts_string_from_utf8` | Decline: native/string-buffer boundary |
| `nts_string_from_view` | Decline: native/string-buffer boundary |
| `nts_string_of_nsstring` | Decline: Objective-C NSString boundary |
| `nts_string_to_cstring` | Decline: native/string-buffer boundary |
| `nts_string_to_hstring` | Decline: native/string-buffer boundary |
| `nts_string_to_owned_cstring` | Decline: native/string-buffer boundary |
| `nts_string_to_utf16` | Decline: native/string-buffer boundary |
| `nts_string_truthy` | M1 string |
| `nts_string_unlend` | Decline: native/string-buffer boundary |
| `nts_strings_from_cstrings` | Decline: foreign/native ABI or ownership |
| `nts_strings_to_cstrings` | Decline: foreign/native ABI or ownership |
| `nts_strings_to_hstrings` | Decline: foreign/native ABI or ownership |
| `nts_symbol_description` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_for` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_key_for` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_new` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_to_string` | Decline: bigint/symbol/date/promise family |
| `nts_table_new` | Decline: Map/Table/Set runtime |
| `nts_tag_name` | M1 string |
| `nts_tag_of_reference` | M1 value/control |
| `nts_task_run` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_template_reflection` | Decline: template reflection |
| `nts_thrown_class` | M1 value/control |
| `nts_to_index` | M1 numeric |
| `nts_to_int16` | M1 numeric |
| `nts_to_int16_fn` | M1 numeric |
| `nts_to_int32` | M1 numeric |
| `nts_to_int32_fn` | M1 numeric |
| `nts_to_int8` | M1 numeric |
| `nts_to_int8_fn` | M1 numeric |
| `nts_to_integer` | M1 numeric |
| `nts_to_uint16` | M1 numeric |
| `nts_to_uint16_fn` | M1 numeric |
| `nts_to_uint32` | M1 numeric |
| `nts_to_uint32_fn` | M1 numeric |
| `nts_to_uint8` | M1 numeric |
| `nts_to_uint8_fn` | M1 numeric |
| `nts_uncaught` | M1 value/control |
| `nts_unit` | M1 value/control |
| `nts_unit_fn` | M1 value/control |
| `nts_ushr` | M1 numeric |
| `nts_utf16_release` | Decline: foreign/native ABI or ownership |
| `nts_value_boolean` | M1 value/control |
| `nts_value_eq_boolean` | M1 value/control |
| `nts_value_eq_boolean_fn` | M1 value/control |
| `nts_value_eq_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_eq_number` | M1 value/control |
| `nts_value_eq_number_fn` | M1 value/control |
| `nts_value_eq_reference` | M1 value/control |
| `nts_value_eq_string` | M1 value/control |
| `nts_value_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_inspect` | M1 value/control |
| `nts_value_is_view` | Decline: buffer/view/DataView representation |
| `nts_value_number` | M1 value/control |
| `nts_value_number_or` | M1 value/control |
| `nts_value_of_boolean` | M1 value/control |
| `nts_value_of_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_of_null` | M1 value/control |
| `nts_value_of_number` | M1 value/control |
| `nts_value_of_reference` | M1 value/control |
| `nts_value_of_undefined` | M1 value/control |
| `nts_value_reference` | M1 value/control |
| `nts_value_release` | M1 value/control |
| `nts_value_retain` | M1 value/control |
| `nts_value_strict_eq` | M1 value/control |
| `nts_value_tag` | M1 value/control |
| `nts_value_to_number` | M1 value/control |
| `nts_value_to_number_explicit` | M1 value/control |
| `nts_value_to_string` | M1 value/control |
| `nts_value_truthy` | M1 value/control |
| `nts_value_truthy_fn` | M1 value/control |
| `nts_view_buffer` | Decline: buffer/view/DataView representation |
| `nts_view_byte_length` | Decline: buffer/view/DataView representation |
| `nts_view_byte_offset` | Decline: buffer/view/DataView representation |
| `nts_view_bytes` | Decline: buffer/view/DataView representation |
| `nts_view_check` | Decline: buffer/view/DataView representation |
| `nts_view_check_fn` | Decline: buffer/view/DataView representation |
| `nts_view_copy_within` | Decline: buffer/view/DataView representation |
| `nts_view_fill` | Decline: buffer/view/DataView representation |
| `nts_view_from_bytes` | Decline: buffer/view/DataView representation |
| `nts_view_from_elements` | Decline: buffer/view/DataView representation |
| `nts_view_get` | Decline: buffer/view/DataView representation |
| `nts_view_index` | Decline: buffer/view/DataView representation |
| `nts_view_index_fn` | Decline: buffer/view/DataView representation |
| `nts_view_join` | Decline: buffer/view/DataView representation |
| `nts_view_length` | Decline: buffer/view/DataView representation |
| `nts_view_new` | Decline: buffer/view/DataView representation |
| `nts_view_put` | Decline: buffer/view/DataView representation |
| `nts_view_set` | Decline: buffer/view/DataView representation |
| `nts_view_slice` | Decline: buffer/view/DataView representation |
| `nts_view_subarray` | Decline: buffer/view/DataView representation |
| `nts_view_unlend` | Decline: buffer/view/DataView representation |
| `nts_winrt_activate` | Decline: foreign/native ABI or ownership |
| `nts_winrt_activations` | Decline: foreign/native ABI or ownership |
| `nts_winrt_alloc` | Decline: foreign/native ABI or ownership |
| `nts_winrt_array_items` | Decline: foreign/native ABI or ownership |
| `nts_winrt_box` | Decline: foreign/native ABI or ownership |
| `nts_winrt_factory` | Decline: foreign/native ABI or ownership |
| `nts_winrt_free` | Decline: foreign/native ABI or ownership |
| `nts_winrt_is` | Decline: foreign/native ABI or ownership |
| `nts_winrt_listen` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received_handles` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received_strings` | Decline: foreign/native ABI or ownership |
| `nts_winrt_reference` | Decline: foreign/native ABI or ownership |
| `nts_winrt_unbox` | Decline: foreign/native ABI or ownership |
| `nts_winrt_unlisten` | Decline: foreign/native ABI or ownership |

Inventory: 505 distinct names: 204 planned M1 contracts and 301 named declines.

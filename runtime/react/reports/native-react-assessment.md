# Native React assessment

## Decision

Keep upstream React and React Compiler pinned as source-of-truth inputs. Run
the upstream compiler at application build time, recover the static TypeScript
facts erased from its generated output, and compile the selected upstream React
runtime, reconciler, compiler-runtime contract and platform HostConfig through
NTS. Do not maintain a handwritten TypeScript or C rewrite of React.

This route now has a concrete conversion result: the normalized,
production-specialized and linked trees each contain 123 strict TypeScript
files and pass native TypeScript 7.0.2 with zero diagnostics. The generated-code
audit finds no `any`, TypeScript directive or nested assertion in 369 files.
The exact-source JavaScript oracle still passes eight scenarios after all
conversion and link transforms.

## Reusable upstream conversion

The reusable layer consists of deterministic transforms rather than a fork:

- Hermes parses the exact pinned Flow source, including React-specific syntax.
- General Flow normalization restores TypeScript annotations, overload
  placement, refinements, deferred-variable types and checked heterogeneous
  projections.
- Resolved monorepo imports become explicit relative imports.
- Profile constants remove only branches proven dead by the selected build.
- The link pass propagates exported primitive `const` values across retained
  imports. It currently replaces 2,448 reads and folds 610 `if` statements.
- Native TypeScript, runtime-syntax equivalence, source hashes, an escape audit
  and the upstream behavioral oracle gate regeneration.

A call-shape transform is admissible only with a proof for receiver value,
argument/evaluation order, `arguments` aliasing, exception and return behavior.
There is no blanket `fn.apply(null, arguments)` to `fn(...args)` rewrite: an
allocating rest array in a hot path or a changed `this` value would be a
semantic and performance regression. Fixed arity calls are preferable when the
source and call graph prove the arity.

Source-specific TypeScript facts remain in the hash-guarded override manifest.
They are regenerated from upstream and disappear when the input changes; no
generated file is maintained by hand.

## React-specific contracts

`ReactValue` is the checked name for genuinely heterogeneous storage. It is not
a dynamic JavaScript value. Fibers, elements, the general hook list and update
queues may carry it, but every inspection must follow a tag/descriptor check or
a statically proven projection.

Public React APIs remain generic. A general Fiber points to an arbitrary
component through an existential descriptor, while a known component can use
typed props, a typed hook frame, monomorphized reducers/queues and typed React
Compiler cache slots. A generic `Hook<State>` alone cannot make one upstream
hook list homogeneous because adjacent hooks store unrelated kinds of state.

React Compiler's `_c(N)` should be a trusted descriptor-carrying intrinsic with
upstream `useMemoCache` ownership and interruption semantics. The recovered
Counter already gives six cache slots concrete HIR fields. That layout is 72
bytes; six erased slots would be 120 bytes with the same header, a measured
48-byte/40% density advantage. The isolated two-field hook is 32 bytes typed
and 56 bytes erased. These measurements justify specialization after the
correct erased baseline exists; they do not justify changing upstream behavior.

The renderer boundary is an ordinary React HostConfig. The recording mutation
host supplies 47 bindings, passes 12 Node checks and 15 native C checks, and is
the differential oracle for future iOS, macOS and Android adapters. Platform
adapters should expose generated typed native APIs and construct fixed prop
records for known JSX intrinsics before packing the general React element.

## Current NTS boundary

At the NTS commit recorded by `runtime-native-probe.json`, the full strict
runtime probe reports 941 refused constructs across 385 functions. The process exits
zero, but the prepared HIR has nine `FellThrough` verifier failures and none of
the seven required public reconciler exports. It is therefore not a usable
native React build. The machine-readable report classifies all 941 diagnostics
and the nine-fixture blocker suite reproduces the shared roots.

The dominant requirements are:

| Area | Current evidence | Required behavior | Expected native cost |
| --- | --- | --- | --- |
| React key/node unions | 528 key-related and 24 node diagnostics | recursive checked tagged representation, including unique symbols | 16-byte boundary value; inline primitive payloads; checks removable after specialization |
| Object intersections | 138 diagnostics although the conformance ledger marks them supported | flatten compatible records into one layout | zero tags, boxes or extra allocations |
| Module values/functions | 36 value and 26 mutable-function diagnostics | represent valid module state and one typed callable slot | one indirect call only where the callback is truly mutable |
| Null/undefined | 29 diagnostics | preserve distinct absence tags and null-only signatures | pointer null for one absence; tagged value where two absences require it |
| Structural methods | strict method/function-field fixtures reproduce | canonical structural naming and checker-directed field versus method lowering | direct method-table call where statically known; no forced closure field |
| Production fallthrough | nine invalid HIR functions with no reported refusal | emit the implicit `undefined` return | one constant/tag return, optimized away at dead call sites |
| Native scheduler/host | clock, task channel, error sink and abort diagnostics | typed native Scheduler ABI modeled on upstream `SchedulerNative.js` | direct host calls; no browser probing or transport-selection closures |
| Module cycles | primitive propagation reduced 30 diagnostics to seven | preserve genuine TDZ errors; fix only proven false value edges/late reads | compile-time graph work only |
| JSX and `_c` | focused HIR/ABI repros | typed configured JSX calls and descriptor-carrying memo-cache intrinsic | fixed prop/cache layouts and literal-index field access |

NTS explicitly excludes a dynamic property map, prototype mutation and the
JavaScript metaobject protocol. `Component`/`PureComponent` observably use
prototype-based class behavior, so deleting those operations or faking them is
not acceptable. A source-hash-guarded conversion to real TypeScript classes or
a static component descriptor is plausible only after differential cases cover
subclassing, `instanceof`, class detection, state/update methods and pure-class
markers. `FiberNode` is safer to turn into a fixed class/record because upstream
states that it has no instance methods and must not be tested with
`instanceof`; that contract still needs an oracle before adoption.

Regex, `for...in`, optional-property presence, dynamic string coercion and
function metadata have explicit focused evidence. Features marked as wanted
gaps remain idiomatic TypeScript for NTS to implement. Reachable behavior that
depends on an explicit non-goal stays documented until specialization removes
it or a proven static React adaptation preserves it.

## Recommended implementation order

1. Fix intersection lowering and implicit-undefined HIR verification. Both are
   static, locally reproduced and should add no runtime overhead.
2. Extend tagged representation to recursive React nodes and unique-symbol key
   unions, with checked projection facts visible to HIR.
3. Fix canonical structural methods/function fields, supported capture/rest
   regressions and valid module state. Re-run the nine fixtures after each
   compiler change instead of adapting React source around them.
4. Select a native Scheduler fork and typed host ABI for time, work posting,
   priorities, errors and abort behavior.
5. Implement configured JSX lowering and the `_c<Slots>` intrinsic, then link
   the full recording renderer through C.
6. Run the same eight scenarios natively before measuring the reconciler. Add
   Suspense retry, interrupted work, transitions and error recovery before
   calling the semantics complete.
7. Enable typed component frames, hook queues and cache tuples one proof at a
   time, retaining the erased upstream-compatible fallback and inspecting C,
   LLVM and JVM output for allocations, tags and indirect calls.

This keeps maintenance centered on one upstream pin, deterministic transforms,
small platform HostConfigs and explicit compiler contracts. React semantics
remain owned by upstream, while NTS owns the static representations and the
optimizations that remove boundary overhead.

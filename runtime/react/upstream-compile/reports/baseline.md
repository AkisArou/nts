# Client runtime baseline

The first production profile is pinned to React
`1d34f91dfde6bba84d08b683aaba164c7194dacb`. It starts at the public React
client, Scheduler and `ReactFiberReconciler`, with the upstream default feature
flags and a virtual NTS mutation HostConfig.

React's `scripts/flow/environment.js` is recorded separately with its source
hash because its `ConsoleTask` declaration is consumed by the generated
profile. Numeric `TimeoutID` and opaque-only `CallSite` are explicit target
environment declarations. Together they remove 33 false missing-name
diagnostics without introducing a dynamic value.

The resolved closure contains 122 files and 57,515 physical source lines. Of
those files, 117 carry runtime code and five are type-only. Every bare import
inside this closure resolves to another pinned React package file; the one
deliberate virtual dependency is `ReactFiberConfig`, referenced by 30 import
edges.

## Flow normalization

The React-aligned Hermes parser and the existing
`@zxbodya/babel-plugin-flow-to-typescript` transform converts all 122 files to
parseable TypeScript. For each file, stripping types from the Flow input and
from the TypeScript output produces identical normalized runtime JavaScript.
That proves the baseline transform did not intentionally rewrite executable
code; it does not prove that TypeScript gives every converted annotation the
same meaning as Flow.

The current transform produces 31,950 generated lines, zero `any` nodes, 449
`unknown` nodes and no TypeScript suppression comments. Native TypeScript 7.0.2
accepts the normalized tree with zero diagnostics. `unknown` remains only where
the source carries a genuinely heterogeneous value or where a checked local
projection is required; it grants no property access, call or arithmetic
operation by itself.

The converter is therefore both a deterministic syntax baseline and strict
TypeScript input. NTS representation work begins after this gate, especially at
the recursive React node, key, Fiber and Hook boundaries.

The generator also rewrites resolved monorepo aliases to relative module
specifiers. This is a mechanical graph rewrite backed by the analyzer's exact
target for each import; it does not rely on package-manager or `paths`
behavior.

The manifest applies 1,248 deterministic, source-hash-guarded projections and
signature facts across the selected closure. General converter rules handle
recurring Flow constructs; the manifest records only facts tied to an exact
upstream file. Six executable-source adaptations affect five files and are
checked separately. Stripping all added TypeScript types still gives identical
runtime syntax for 122 of 122 files.

## Runtime operations visible before lowering

The closure contains 319 computed member accesses, 75 `.bind` calls, 35
`.call` calls, 10 `.apply` calls, 22 `for-in` loops, 17
`Object.defineProperty` calls and 15 spread operations. These counts are an
inventory, not a refusal count: feature flags and reachability can remove some,
and several can lower statically. `npm run analyze` records the per-file source
hashes and complete counts in `client-mutation-production.json`.

## Current conclusion

A maintained handwritten TypeScript fork is unnecessary. Keep the pinned
upstream Flow files as the source of truth, regenerate TypeScript, and allow
only reviewed hash-guarded overrides with conformance evidence. The remaining
work is in NTS representation/lowering, the native host interface, JSX and
backend coverage.

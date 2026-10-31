# JetStream 3: TypeScript-lib

This real-code row runs the complete **TypeScript 5.9.2 compiler** over the
release's original **118-file Immer/declaration fixture**. Every iteration
creates the original compiler host and program, calls `emit`, obtains all
pre-emit and emit diagnostics, and formats the same complete diagnostic list.
It has no C++ reference; the reference engines are Node and Bun.

## Source and licences

JetStream 3.0 is pinned to
[`3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript).
The row uses these original files:

- `TypeScript/benchmark.js` and `TypeScript/src/test.mjs`;
- `TypeScript/dist/bundle.js`, `TypeScript/dist/LICENSE.txt` and the lockfile's
  TypeScript 5.9.2 version;
- `TypeScript/src/gen/immer-tiny/files.json` and `tsconfig.json`, unchanged;
- the browser/mock-host selection in `TypeScript/src/mock/sys.js` and the
  original webpack bundle's empty Node-module replacements.

The bundled compiler's authored source is restored from
[`microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9`](https://github.com/microsoft/TypeScript/tree/5be33469d551655d878876faa9e30aa3b49f8ee9),
the source revision for **v5.9.2**. All **276 authored modules** match that pinned
archive byte for byte before transcription. The generated diagnostic map and
12 added files for checked layouts complete the 289-module source tree. The
compiler is checked directly as TypeScript; it is not imported as unchecked
JavaScript, loaded from an installed compiler, or evaluated from source strings.

The driver is **BSD-2-Clause**, the Microsoft compiler and its **102 declaration
inputs** have their original **Apache-2.0** grants, and all **16 Immer inputs**
match the **MIT** source at
[`immerjs/immer@19cbe47ae3db3b4a8940409ab1814ce1a9af3458`](https://github.com/immerjs/immer/tree/19cbe47ae3db3b4a8940409ab1814ce1a9af3458).
All input-internal notices remain untouched. Microsoft's full
`ThirdPartyNoticeText.txt` is retained byte for byte, as well as in
`../LICENSE-jetstream`. The WHATWG material incorporated into source code uses
the offered **BSD-3-Clause** option; the W3C, Background Sync, Unicode,
DefinitelyTyped and Khronos notices remain. The exact grants, dates and provider
links are recorded in [license-review.md](license-review.md).

## Complete original operation and observation

`work(n)` repeats the full original operation `n` times. `seed = 1` is the
smallest positive number of complete compilations. The original options,
including `noEmit: true`, are unchanged. The host's original case-sensitive
`fileExists` and lowercasing `readFile` are also unchanged. They produce the
original missing-file diagnostics for this fixture; this port does not repair
or pre-process the input project.

The upstream driver has no success-only assertion. It returns the formatted
diagnostics and the number of generated files. The port preserves this behavior.
Its observer folds the file count, each diagnostic's length, and every UTF-16
code unit into an unsigned base-31 checksum, then folds complete iteration
checksums in the same way. `inspect()` exposes one full result for untimed
correctness checks. The observer is an adapter, not an additional compiler
validation rule.

| Observation | Value |
| --- | ---: |
| Complete input files | 118 |
| Original input JSON bytes | 3,884,943 |
| Original configuration bytes | 456 |
| Formatted diagnostics | 54 |
| Emitted result files | 0 |
| Complete result JSON bytes | 17,247 |
| `seed` | 1 |
| `work(0)` | 0 |
| `work(1)` | 1,068,476,791 |
| `work(2)` | 4,126,486,240 |

The complete result's SHA-256, obtained independently from the untouched
release bundle, is:

```text
9be28762d730a63e90608ece97056c497b1c4255f13a9bec5f79b14d6495b089
```

The original formatted input JSON and configuration SHA-256 values are:

```text
files.json:    226f42cad886f188fafb4f070c37c34d50f19b766f5576330beec03b5e7f9e0f
tsconfig.json: b60bfd39b19f6cd444a7a0f4e8933dacd9fb86b0fffebdcdac8a4270cc7a6af7
```

## Transcription and strict typing

The compiler's existing scanner, parser, binder, checker, emitter, transforms,
module resolver, builders, language services and server algorithms remain.
Restoring their authored source preserves their names and control flow rather
than attempting to infer every layout from minified local names.
`source-audit.json` records provenance, per-file hashes, packaging counts and
validation evidence. The following adaptations are required by the repository's
strict TypeScript and Node's erasable TypeScript syntax.

1. **Module and syntax packaging.** Imports stay within the case. Runtime
   imports and type-only imports are distinguished, and source `.js` import
   suffixes become `.ts`. The 249 enum declarations become typed constant
   objects with all 4,868 forward/reverse entries in original insertion order.
   Nineteen runtime namespace fragments in 14 files become local typed IIFEs or
   their existing function namespace objects. Exported identity and mutable
   namespace state are retained.
2. **Class layouts.** The original class fields are declared with erased
   `declare` fields. Parameter properties and initializers become their original
   constructor assignments, preserving constructor order and arguments. The
   seven allocator constructor functions (`Symbol`, `Type`, `Signature`, `Node`,
   `Token`, `Identifier`, `SourceMapSource`) become classes with the same fields.
   `NodeLinks` and `SymbolLinks` remain real objects with their original
   initialization phases. No forwarding representation or data tag substitutes
   for an original object.
3. **Checked types and original phase states.** Original `any` and casts become
   concrete layouts, truthful optional fields, finite kind/layout overloads, or
   `unknown` with checked readers. JSON and host-returned arbitrary values stay
   `unknown` until the original read point. Runtime AST recovery states remain
   valid, including adjacent JSX's binary-expression recovery, invalid import
   attributes, empty pragmas and the parser's two-field isolated-JSDoc file.
   Erased non-null annotations preserve original initialized-phase assumptions
   and deliberate `undefined` forwarding. Added required-value checks that
   rejected those original sentinels were removed with per-expression equality
   audits. The source has **zero `any` keywords, zero `as` type casts and zero angle-bracket type
   assertion expressions; 19 `as const` assertions retain literal inference**. A whole-program semantic scan also finds zero
   inferred `any` declaration, `this`, generic-reference or function-return
   layouts.
4. **JavaScript coercions and generic correlations.** Concrete method callback
   types and finite overloads preserve original function identities, arguments
   and dispatch. Bitwise/coercion reads retain the original value and ordering.
   `Version<T>` truthfully retains raw package-lock values in `major`; the
   original `new Version(version)` call remains. The original `major >= 0`
   assertion uses `Number(major) >= 0` to express the same numeric comparison in
   strict TypeScript. Its field is not converted. `compareValues` retains its
   original identity/undefined ordering and native `<` operation. Dedicated
   primitive, array, object, symbol and coercion-order fixtures match upstream.
5. **Browser host selection.** Only the inventory-approved dormant Node host and
   loader bootstrap is omitted. The compiler's `sys` binding has the browser
   result `undefined`; watcher/build algorithms and `setSys` remain. The Node
   `perf_hooks` discovery branch is omitted. Tracing's `fs` replacement is the
   original webpack module 21's empty exports object, so its dormant missing
   method call remains a missing-method failure. The measured driver uses its
   original in-memory `CompilerHost`. The benchmark's no-op logging binding is
   local instead of mutating the global console.

The checked readers execute in the port and contribute to Node/Bun timing.
They are not declared to be free or identical to TypeScript's erased casts.
The comparisons below establish the observed behavior of the complete original
operation and the exercised recovery/service/host paths. They do not assert
that every possible compiler API input has been exhaustively tested.

## Fidelity checks

The untouched pinned webpack bundle is the independent oracle. No installed
newer TypeScript compiler supplies expected output. In addition to the complete
118-file operation, **567 deterministic original-versus-port fixtures** cover:

| Area | Fixtures | What is compared |
| --- | ---: | --- |
| Parser | 20 | Full AST/property and diagnostic traversal, incremental edits, JSX/JSDoc/import-attribute/pragma recovery. |
| Language services | 8 | Navigation, classification, completion, refactoring and isolated JSDoc behavior. |
| Builder and emit | 4 | Incremental state, changes and complete emitted outputs, including CommonJS. |
| Typings/package metadata | 35 | Raw JSON, missing or malformed metadata and package-lock values. |
| Watch and solution builder | 17 | Deterministic fake scheduling, original callback arguments, build-info and malformed-version handling. |
| Module resolution | 37 | Resolver results, traces, raw cache contents and resolution-mode cache operations. |
| Server | 12 | Line-tree edits, version-ring snapshots, options and diagnostic protocol output. |
| Version/coercion behavior | 434 | Raw constructor fields, comparisons and coercion order. |

A separate static-data comparison matches all **2,121 diagnostic records** and
**129 exported enum tables**, including property order and explicit undefined
fields, against the release bundle. The source retains its original descriptor
and prototype operations; an instrumented complete operation records zero such
calls in both the original and the port. Their call sites are listed in the
source audit for maintainers' nts refusal analysis.

No fixture asserts elapsed time. The watcher fixtures use deterministic explicit
callbacks, not machine-speed expectations. Their complete output hashes and
source-bundle hash are retained in `validation-audit.json`.

The literal audit accounts for **19,558 original runtime literals** across the
276 authored modules. Every original template segment and regular-expression
literal outside the omitted Node host remains exact, including embedded emitter
helper code. The 90 omitted literals all belong to the four documented host
packaging sites: `sys.ts` (86), `isNodeLikeSystem` (2), Node `perf_hooks` loading
(1), and the tracing `fs` loader binding (1). Type-only strings and import paths
are excluded from this runtime-literal comparison. Physical CRLF template line
endings are normalized to LF, as JavaScript itself does; escape sequences and
content are preserved.

## Required validation

Using Node **24.20.0**, pnpm **10.15.0**, and the repository's TypeScript
**7.0.2**:

```sh
pnpm install
node --test benchmarks/jetstream.test.ts
node node_modules/typescript/bin/tsc --strict --noEmit \
  --target esnext --module esnext --moduleResolution bundler \
  --skipLibCheck --allowImportingTsExtensions --ignoreConfig \
  benchmarks/cases/jetstream-typescript-lib/case.ts
```

The shared suite passes **7/7 tests**, with the base JSON-stringify row and this
row installed. Strict TypeScript reports **zero diagnostics** for the full
transitive case source. The dependency installation is shared with the isolated
worktree. The added tests verify the complete original input bytes and values,
all diagnostic output bytes, the original zero-output count, and complete opaque
iteration counts.

## Timing constraint

The best of five fresh Node **24.20.0** processes is
**1135.598815 ms per `work(1)`**, measured with the unchanged
`benchmarks/common/bench.mjs` harness. Each process uses its original warmup,
calibration and minimum of five timed trials. The five process minima are
**1142.669950, 1135.598815, 1138.760900, 1223.165171, 1254.141882 ms**. All five return checksum
bits **`41cfd7d4bb800000`**.

Timing exception (approved): **1135.598815 ms at `seed = 1`**.
One is already the smallest positive count of complete original operations.
The full compiler and complete fixture are retained. These are local scale
measurements; maintainers measure their own machines.

No nts compilation, gate result, input-domain file, or node-oracle count is
claimed. The maintainers own those steps and measurements on their machines.

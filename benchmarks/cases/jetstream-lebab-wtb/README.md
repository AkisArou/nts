# JetStream 3: Lebab Web Tooling Benchmark

This real-code row transforms the complete Preact 8.2.5 source with Lebab 3.2.7
and all ten original transforms. It has no C++ reference; maintainers compare
nts with Node and Bun.

## Source and licences

The release pin is
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [Exact bundled program](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/lebab.bundle.js)
- [Original workload](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/src/lebab.mjs)
- [Complete Preact input](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/third_party/preact-8.2.5.js)
- [JetStream wrapper](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/benchmark.js)
- [Bundled notices](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/lebab.LICENSE.txt)
- [Workload licence and input credits](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/LICENSE)

The V8 workload is BSD-3-Clause, the Apple wrapper BSD-2-Clause, and Lebab and
Preact MIT. The complete dependency audit covers 56 exact package archives,
including Preact, under MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC or 0BSD.
Every retained notice, including notices absent from the bundle's abbreviated
notice file, is in `../LICENSE-jetstream`. `licence-audit.json` records the
package versions, archive integrity checks, notice hashes and preservation.
Original notices remain in source comments and the complete input string.

The bundle has 242 module factories. These include Recast 0.23.11,
ast-types 0.16.1, source-map 0.6.1, Esprima 4.0.1, escope 4.0.0,
Lodash 4.17.21, Acorn 8.15.0 and Espree 9.6.1. The port keeps the dependency
programs and dormant transforms. It does not replace them with a reduced
implementation tailored to the Preact input.

## Transcription and adapter

Static Webpack module IDs become local TypeScript imports. Lazy `load()` calls
remain at the original dependency call sites, with the original cached export
objects and initialization cycles. Bundle-local global references become the
local bundler root; no transformed source is executed.

Constructor functions become classes with declared original fields. Existing
prototype assignments remain except for the class restorations described below;
field writes, deletions, object identities and collection contents remain.
Where original TypeScript source exists, its exact
release provenance is checked against the npm output and bundled module;
`typed-source-provenance.json` records 42 matching Recast/ast-types modules.
The Esprima audit likewise checks the exact bundled parser and its source.

Strict layouts describe ASTs, scope entries, mapping records, export objects,
collections and callable helpers. `unknown` values are checked where the
original code consumes them. These checks return the original values and
objects; they do not copy ASTs, flatten scope entries, replace node prototypes,
or coerce stored mapping values. Non-null annotations express existing phase
invariants and disappear under Node's type stripping. The checked adapters are
part of the measured program.

The original payload table and transform order remain:
`arg-rest`, `arg-spread`, `arrow`, `class`, `for-of`, `let`, `template`,
`includes`, `obj-method`, `obj-shorthand`. `runTest` retains the two original
`map` calls and the complete `lebab.transform(payload, options)` call.
`work(n)` repeats this complete operation and hashes every UTF-16 code unit of
its serialized code and warnings with FNV-1a, adding each unsigned hash into
the returned checksum. `render(n)` observes the complete result outside timing.
The original success criterion is completion with the returned code and
warnings; the independent original bundle supplies the full-output oracle.

### Class and packaging adaptations

Native class syntax forces a few explicit differences from emitted JavaScript:

- Babel/TypeScript constructor scaffolding becomes the original class and
  `extends` structure. Lebab's seven inherited classes account for 221
  original direct `Reflect.construct` helper calls in one complete operation;
  native superclass construction replaces those emitted helper calls. Their
  constructor bodies, fields and source-level inheritance remain. The original
  compatibility helper bodies remain in the modules.
- A class's `prototype` property cannot be reassigned. Static prototype setup
  therefore installs the original parent on the existing class prototype and
  preserves the original explicitly installed method/constructor descriptors.
  This applies to the
  original Lodash wrapper classes, ast-types visitor/context classes and
  source-map consumer classes. Per-node `TreeCopier` allocation is unchanged.
- The 55 methods restored from the authored TypeScript classes in `ast-types/lib/types`,
  Recast `Lines` and Recast `Mapping` retain their original bodies. Native class
  methods are non-enumerable and receive their method names; the bundled ES5
  prototype assignments produced enumerable, anonymous functions. These static
  metadata differences are a consequence of restoring the original classes.
  The exact-source provenance and runtime fixtures cover their bodies and use.
- Basic source-map consumers retain their original inherited constructor;
  indexed consumers retain their original enumerable constructor assignment.
  Declared prototype methods retain the original enumerable assignments.
- Assertion error classes retain the original native-error construction,
  `Reflect.construct`, descriptor installation, prototype reads and exception
  fields. The original empty prototype allocators remain plain functions where
  they have no instance fields and the original construction helper requires
  their function behavior.
- Original sloppy-call receiver behavior in utility wrappers and browser timer
  fallbacks is made explicit in strict modules. Isolated fallback fixtures
  compare this behavior and wrapper arities with the original modules.
- The dormant tslib `__await` constructor becomes a class with its original
  `v` assignment and conditional return body. Its one internal factory call in
  `__asyncDelegator` becomes `new __await(...)`; calling the exported class
  without `new` is no longer supported. The original delegator value/return
  behavior is checked separately. The temporary class in `__extends` returns
  the original prototype-shaped object because its own class prototype cannot
  be replaced.
- The source-map indexed-offset boundary keeps the original raw offset values,
  comparison order and `+ 1` conversion rules, including string concatenation.
  Focused fixtures check primitive conversion order, hints and rejection cases.

The audits separate these forced adaptations from original algorithms. Native
class constructor `prototype` properties are non-writable. Static initialization
counts can differ from the emitted bundle for this reason and for module wiring.
No claim of identical emitted scaffolding is made.

## Prototype and descriptor operations retained

The handoff explicitly authorizes this row unchanged as a compiler target.
Recast still calls
`Object.create(Object.getPrototypeOf(node), { original: ... })`
for **all 3,310 AST copies in each full operation**. Each copy has the original
node's actual prototype and an `original` backlink to that identical node,
with `enumerable: false`, `configurable: false`, `writable: true`.
Every copy invariant passes for both the first and repeated original/port runs.

An audit of direct Object/Reflect method call sites observes the following
inside each complete operation, identically in first and repeated runs:

| Direct Object operation | Original | Port |
| --- | ---: | ---: |
| `Object.create` | 3,649 | 3,649 |
| `Object.getPrototypeOf` | 3,310 | 3,310 |
| `Object.defineProperty` | 2 | 2 |
| `Object.getOwnPropertyDescriptor` | 1 | 1 |
| `Object.getOwnPropertySymbols` | 2 | 2 |

`operation-audit.json` records the exact sites and initialization separately.
These totals cover direct call sites; bound/native aliases are not counted.
Instrumentation observes calls without replacing the intrinsics, which is
necessary to preserve Lodash's native-function detection. The actual case has
no observers. The 221 superclass-helper calls described above are the measured
Reflect difference forced by restoring native class syntax.

Original dormant dynamic-Function and prototype compatibility paths remain.
The Lodash/utility site audit observes zero dynamic-Function calls through
initialization and two complete operations; positive controls show the
observer detects those paths when explicitly exercised. An nts refusal on
these or any retained reflection operation is a maintainer finding.

## Complete-input validation

The original bundle ran independently under Node **24.20.0**. Original and
port preserve the complete 20,772-byte Preact input and return the same code,
warnings and serialization, including repeat-call state.

| Observation | Value |
| --- | ---: |
| Input bytes | 20,772 |
| Transformed code characters | 21,316 |
| Warnings | 35 |
| Complete serialized characters | 23,935 |
| `seed` | 1 |
| `work(0)` | 0 |
| `work(1)` | 1,344,693,304 |
| `work(2)` | 2,689,386,608 |

Input SHA-256:
`e5b962b9e5d1ee004d580358fa2e3432599b46fbb413a6d67f02709eb4c72922`.
Complete output SHA-256:
`7fa0f78858a5a3ecf83de29f500e9d43aea825e93be3e11c66ba11c028a906f1`.
Original bundle SHA-256:
`5f58ee28553a14af685b475a20a65a1dd66e6086e72886ac4d1e9da4f557421d`.

Validation commands use `.tool-versions` and `packageManager`:

```sh
pnpm install
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --lib esnext,dom --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-lebab-wtb/case.ts
node --test benchmarks/jetstream.test.ts
```

The ESNext and DOM declaration libraries type the original `Float16Array`,
`Iterator`, resource-management and browser feature probes. Their runtime bodies
remain intact; the actual workload runs under Node without browser services.

With pnpm **10.15.0** and TypeScript **7.0.2**, installation completes, strict
checking reports **zero diagnostics**, and the shared suite passes **7/7 tests**
with zero failures or skips. Tests never depend on elapsed time.

The final syntax audit covers **298 TypeScript files**, including declarations:
zero `any` keywords, `as` expressions, type assertions or suppression comments.
It records 217 classes, 1,498 declared properties and 614 erased non-null
annotations. The complete semantic type scan finds zero inferred-`any`
declarations and zero inferred-`any` returns, including nested generic/default
iterator types. `syntax-audit.json` includes a hash manifest of every TypeScript
file; `type-audit.json` records the type scan.

The differential evidence exercises the retained programs beyond the measured
Preact input. These are source/behavior checks outside the benchmark:

| Area | Original-versus-port checks |
| --- | --- |
| All 24 upstream transform test files | 545 exact code/warning cases, also checked against upstream expected output; two original skips retained |
| Esprima | 4,728 corpus comparisons across 1,576 fixtures, plus focused parser checks |
| Scope and traversal | 52 scope and 108 traversal cases |
| Lodash and FP | 696 cases |
| Recast printer | 153 cases: 145 matching outputs and eight matching rejections |
| Assertions | 178 cases |
| Source maps | 181 consumer/generator/SourceNode cases and 128 support cases |
| Utility shims | 324 native and ten fallback cases |
| TypeScript compatibility helpers | 35 cases, including iterator access order, raw `done` values and delegated-result identity |
| AST/Recast runtime | 20 cases |

`transforms-audit.json`, `helpers-audit.json` and the component reports record
the complete-output hashes and sources. `retained-source-audit.json` accounts
for 1,315 original definitions in 100 modules: 677 identical bodies, 576 equal
after checked-boundary normalization, 60 reviewed class/type adaptations and
two emitted default constructors represented by native implicit constructors.
The separate AST/Recast/assertion audit retains 599 original non-wrapper
signatures and all 96 switch cases, and classifies each added checked reader
and removed class factory. No unexplained source removal is recorded.

## Local scale and approved timing exception

One complete original operation exceeds 10 ms. **Approved timing exception:
147.895118 ms at `seed = 1` under Node 24.20.0.** The complete Preact input,
all ten original transforms and their returned warnings remain in every call.

Five sequential fresh processes using the unchanged
`benchmarks/common/bench.mjs` helper measured **151.542991, 164.263194,
200.842804, 147.895118 and 155.675951 ms** per complete operation. Every process
returned Float64 checksum bits `41d409990e000000`. Other agent checks were
paused during the timing window. `timing.json` records the process observations
and harness hash; these are local scale observations for the maintainers'
subsequent compilation, gate and measurement work.
